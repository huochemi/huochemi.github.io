# demo 扩展性：分发升级为注册表 + 查询参数

状态：已实现（阶段一，2026-09-30；eslint --max-warnings=0 通过；`CI=true` 测试
3 套件全绿；CI build 按 `docs/toolchain.md` 交用户终端执行；浏览器行为验收待用户
`npm start`。阶段二仍未实施，见下）
日期：2026-09-30

## 背景（自包含，零上下文可读）

- 现状：`src/Application/index.jsx` 兼任"应用壳 + demo 分发"。第 31-32 行用
  `URLSearchParams` 读取 `demo` 参数，第 36 行三目判断渲染 `<Map />`（生产地图
  页）或 `renderDemo()`（第 22-28 行，硬编码返回 `<MapIcon />`）。
- 问题：`demoParam` 的**值从未被使用**，只要参数存在就渲染同一个 demo。加第二个
  demo 必须修改入口代码，扩展性为零（详见下文"现状问题"）。
- `src/Application/MapIcon/MapIcon.jsx` 是一个未挂牌的 demo：内部组件名为
  `MapDemo`（第 8 行），硬编码 GPS `[116.166786, 39.760883]`（第 6 行）、硬编码
  线上图片 URL（第 43、58 行）、保留三处 `console.debug`/`console.log`
  （第 14、15、33、50 行），仅渲染 1 个 marker。
- 目标：让"新增一个 demo"变成"新建目录 + 注册表加一行"，入口代码永不改动；且
  分发机制不引入任何部署期风险。
- 本 plan 的用户诉求原文：MapIcon.jsx 是不是 demo、当前目录结构是否合适、以后
  加更多 demo 如何保证扩展性。

## 现状问题（三处耦合，按严重度排序）

### 1. demo 目录是产品样式的实际宿主（最严重）

- `.hcm-photo-pin` / `> .hcm-photo-wrapper` / `> .hcm-photo-wrapper img` /
  `> .hcm-photo-wrapper > .hcm-photo-count` / `::after` 整套 marker 外观定义在
  `src/Application/MapIcon/index.css`（第 2-54 行）。
- 生产页 `MapChildren.jsx:223-229` 正使用这套 class 字符串。
- 它能生效的原因是 `Application/index.jsx:5` 静态 import 了 `MapIcon`，其
  `index.css` 因此被打进主 bundle 并全局生效。
- 而同族的 `.hcm-marker-image` 却在产品侧 `Map/AMap/index.css:6`——即这套样式被
  劈成了两半，一半在产品、一半在 demo。
- 后果：① 删掉或改写 demo 会让生产 marker 掉样式；② 改 demo 样式等于直接改线上
  视觉，demo 失去了"安全试错"这一存在意义。

### 2. 分发是三目，不是注册表

- `Application/index.jsx:36`：`{!demoParam ? <Map /> : renderDemo()}`。
- `renderDemo()` 硬编码返回 `<MapIcon />`；`demoParam` 的值未被使用，
  `?demo=map-icon`、`?demo=anyone`、`?demo=喵` 渲染结果完全相同。
- 无未命中反馈：拼错参数名或值均静默进入同一个 demo。

### 3. demo 内部没有边界

- 数据（硬编码坐标、图片 URL）、样式（全局非 module 的 `index.css`）、调试输出
  （`console.debug`）混在同一文件。
- 产品侧用 CSS Modules（`MapChildren.module.css`），demo 侧用全局 CSS，两套约定
  并存且无标注说明哪个是规范。

## 技术边界（已核实，非推测）

- **代码基线 `ffd7e91`（2026-09-30），并于当日 17:52 逐文件复核**：
  `Application/index.jsx`、`MapIcon/MapIcon.jsx`、`MapIcon/index.css`、
  `Map/AMap/index.css`、`.github/workflows/build-deploy.yml`、`docs/toolchain.md`、
  `AGENTS.md` 均未变动，本 plan 对它们的引用有效；仅 `MapChildren.jsx` 因照片删除
  工作流新增 `coverFileName` / `isCover` / 删除命令 UI，由 452 行增至 463 行，其行号
  引用已同步修正。样式耦合的前提经复核仍然成立——该文件仍以字符串类名引用
  `.hcm-photo-pin`，而该样式仍只定义在 `MapIcon/index.css`。
- `Application/index.jsx` 为 class 组件，`componentDidMount` 里已调用
  `initApplication()`（第 13-19 行）。本方案保持 class 形态，不改为函数组件，
  以减少改动面。
- 本项目为纯 CSR（CRA + GitHub Pages，`package.json` 无 `homepage` 字段，默认
  根路径），无 SSR，因此模块级读取 `window.location.search` 是安全的。
- CI 门禁（`.github/workflows/build-deploy.yml`）：第 31-32 行 `npm run build`
  （`CI=true` 由 Actions 自动注入），第 34-35 行 `npm test`——**测试是门禁的一
  部分**，新增测试必须通过。
- pre-push 钩子（`.git/hooks/pre-push`）执行
  `./node_modules/.bin/eslint src --ext .js,.jsx,.ts,.tsx --max-warnings=0`，与 CI
  一致。
- 现有测试惯例：纯函数测试与被测文件同目录，命名 `<name>.test.js`
  （见 `src/Application/utils/utils.test.js`）。CI 中 `react-scripts test` 在
  `CI=true` 下自动单次运行，非 watch。
- 本轮不涉及 `../data/photos` 任何读写（AGENTS.md S1 数据隔离）。

## 方案

### 阶段一（本轮实施范围）

纯分发机制升级，改动面 = 3 个新文件 + 1 个修改文件，不触碰任何产品侧文件。

#### 1. 新增 `src/Application/demos/parseDemoName.js`

纯函数，零依赖，便于单测（也避免测试连带加载 AMap 组件树）：

```js
// 从查询字符串解析 demo 名。抽为纯函数：零依赖、可单测。
// - 参数名固定为 demo，值即 demo 名；缺失或空值返回 ''（视为未指定）
// - trim + toLowerCase：避免 `?demo=Map-Icon` 静默失灵
// - 用 URLSearchParams 取指定键，不受其他查询参数干扰
export const parseDemoName = (search) => {
  const value = new URLSearchParams(search).get('demo') || '';
  return value.trim().toLowerCase();
};
```

#### 2. 新增 `src/Application/demos/registry.js`

```js
import MapIcon from '../MapIcon/MapIcon';

// demo 注册表：新增 demo 只需在此加一行，入口（index.jsx）代码无需改动。
export const demoRegistry = {
  'map-icon': MapIcon,
};
```

说明：阶段一 demo 实体仍在 `MapIcon/`（阶段二搬迁），故此处路径指向该目录。
`demos/` 目录先承载"注册与解析"职责。

#### 3. 新增 `src/Application/demos/parseDemoName.test.js`

```js
import { parseDemoName } from './parseDemoName';

test('parseDemoName', () => {
  expect(parseDemoName('?demo=map-icon')).toBe('map-icon');
  // 大小写与首尾空白归一
  expect(parseDemoName('?demo=%20Map-Icon%20')).toBe('map-icon');
  // 与其他查询参数共存时不干扰
  expect(parseDemoName('?utm_source=x&demo=map-icon')).toBe('map-icon');
  // 未指定 / 空值 → ''
  expect(parseDemoName('?other=1')).toBe('');
  expect(parseDemoName('?demo=')).toBe('');
  expect(parseDemoName('')).toBe('');
});
```

#### 4. 修改 `src/Application/index.jsx`

- 删除 `import MapIcon from './MapIcon/MapIcon';`（第 5 行），改为引入注册表与解析
  函数。
- 删除 `renderDemo()`（第 22-28 行）与其三目调用。
- 在模块级完成"唯一一次"参数解析与查表；未命中时告警一次：

```jsx
import React, { Component } from 'react';

import { registerShortcut } from './init';
import Map from './Map';
import { demoRegistry } from './demos/registry';
import { parseDemoName } from './demos/parseDemoName';

import './index.css';

// demo 查询参数的唯一读取点。模块级求值一次，避免在 render 中重复解析，
// 也避免告警随每次渲染重复打印。详见
// docs/plans/2026-09-30-demo-registry-query-param.md
const demoName = parseDemoName(window.location.search);
const DemoComponent = demoName ? demoRegistry[demoName] : null;

if (demoName && !DemoComponent) {
  console.warn(
    `[demo] 未知的 demo 名 "${demoName}"，可用：${
      Object.keys(demoRegistry).join(', ') || '（暂无）'
    }`,
  );
}

export default class Application extends Component {
  componentDidMount() {
    this.initApplication();
  }

  initApplication = () => {
    registerShortcut();
  };

  render() {
    return (
      <div className="application huochemi">
        {DemoComponent ? <DemoComponent /> : <Map />}
      </div>
    );
  }
}
```

设计约定（本轮固化，实施时写进注释）：**新增 demo 参数必须由入口解析后经 props
下发，禁止 demo 组件自行读取 `window.location`**。理由是避免重演本 repo 已有的
双源问题——`localStorage.getItem('hcm_group_by')` 目前在 `MapChildren.jsx` 的
第 77、127、213 行被读取三次，每加一处分支都要额外确认一致性。当前没有 demo
需要参数，故阶段一不实现 props 下发（避免为尚不存在的需求预置接口）。

### 阶段二（本 plan 内列出，不在本轮实施；待单独确认后执行）

样式解耦 + 目录整理。**顺序不可颠倒，且 1-3 与 4-6 之间应有验收点**：

1. 将 `.hcm-photo-pin` 系列（5 条规则）从 `MapIcon/index.css` **复制**到产品侧
   `Map/AMap/index.css`——该文件已含同族的 `.hcm-marker-image`（第 6-9 行），是
   天然归属地，且它由产品链路 `Map/AMap/index.jsx` 静态 import，必然进主 bundle。
2. 验证生产地图页 marker 外观无变化（用户终端 `npm start`）。
3. 从 `MapIcon/index.css` 删除已迁移的规则（迁移后该文件大概率为空——demo 没有
   自己的私有样式，它的外观全部来自被借用的产品样式）。
4. 目录搬迁：`MapIcon/MapIcon.jsx` → `demos/map-icon/index.jsx`，
   `MapIcon/index.css` → `demos/map-icon/index.css`；移除 `src/Application/MapIcon/`
   目录；更新 `demos/registry.js` 的 import 路径。
5. 验证 demo 页仍正常（用户终端 `npm start`）。
6. 依赖方向由"产品 → demo 目录"纠正为"demo → 产品侧共享样式"。

副产品：`docs/plans/2026-09-30-marker-tooltip-content.md` 第 127-129 行对
`.hcm-photo-pin` 位置的描述会成为历史快照（该文件按 AGENTS.md P1 保留不改，
其状态行已标注"已实现"，描述的是当时现状）。

## 实现记录（2026-09-30）

- 新增 `src/Application/demos/parseDemoName.js`、`demos/registry.js`、
  `demos/parseDemoName.test.js`；修改 `src/Application/index.jsx`（移除
  `renderDemo()` 与三目分发、移除 `MapIcon` 直接 import，改为模块级解析一次 +
  查表 + 未命中 `console.warn`）。改动恰为 4 个文件，与方案一致。
- 未动任何产品侧文件：`MapChildren.jsx`、`Map/index.jsx`、`Map/AMap/index.css`、
  `MapIcon/` 全部保持原样。
- 校验：
  - `./node_modules/.bin/eslint src --ext .js,.jsx,.ts,.tsx --max-warnings=0`
    退出码 0（stderr 仅有 CRA 的 `babel-preset-react-app` 未声明依赖告警，属既有
    噪声，与本次改动无关）；
  - `CI=true ./node_modules/.bin/react-scripts test` 退出码 0，Test Suites
    3 passed / Tests 3 passed，含新增 `parseDemoName` 的 6 个断言。
- 知识回写（AGENTS.md 流程 3）：新建域文件 `docs/app-structure.md`，并在
  AGENTS.md「路由」加一行指针（仅新建域文件时才加，符合流程 3）。
- CI build（`CI=true ./node_modules/.bin/react-scripts build`）按
  `docs/toolchain.md`，repo 根已有 `build/` 时 agent 在本环境执行必失败，交用户
  终端执行。
- 浏览器行为验收（验收标准第 1-6 条，需 `npm start`）属用户终端步骤，未在 agent
  环境执行。

## 验收标准

阶段一：

1. `npm start` 后访问 `/`（无参数）：渲染生产地图页，marker 样式、抽屉、Lightbox
   行为与改动前完全一致；
2. `/?demo=map-icon`：渲染 demo 页（与改动前 `?demo=任意值` 的效果相同）；
3. `/?demo=Map-Icon`：同上（验证大小写不敏感）；
4. `/?demo=nonexistent`：回落生产地图页，且控制台出现**一条**
   `[demo] 未知的 demo 名 "nonexistent"，可用：map-icon`，刷新不累积多条；
5. `/?demo=`（空值）：回落生产地图页，**无**警告；
6. `/?utm_source=x&demo=map-icon`：渲染 demo 页（其他参数不干扰）；
7. `./node_modules/.bin/eslint src --ext .js,.jsx,.ts,.tsx --max-warnings=0`
   退出码 0（AGENTS.md 流程 1）；
8. `CI=true npm test` 全绿，含新增的 `parseDemoName` 测试（CI 门禁，见
   `build-deploy.yml:34-35`）；
9. CI `CI=true ./node_modules/.bin/react-scripts build`——按 `docs/toolchain.md`，
   repo 根已有 `build/` 时 agent 在本环境执行必失败（broker 对已存在 build/ 的
   mkdir 伪错误），此步交由用户终端执行；
10. 扩展性回归：在 `demos/registry.js` 中临时新增一行假 demo
    （`'tmp': MapIcon`）后，`/?demo=tmp` 无需改动 `index.jsx` 即可渲染；验证后移除。

阶段二：另见上文"阶段二"各步的验证点。

## 出界清单（本轮不做，及不做理由）

- **懒加载 / `React.lazy` / 代码分包**：不做。demo 自有代码（`MapIcon.jsx` 80 行
  + `index.css` 55 行）压缩后 <1.5KB，且它复用的 `@uiw/react-amap` 产品页本就在
  用、必在主 bundle，故收益≈0；代价是多一层 `Suspense` 异步边界、一次额外 chunk
  请求，且必须先完成阶段二（否则 `.hcm-photo-pin` 会随 demo chunk 被拆走、静默
  弄坏生产页）。触发条件：某个 demo 开始引入 demo 专属依赖（d3 / deck.gl /
  three.js 之类）时再议。
- **pathname 分发（`/demos/xxx/`）+ `404.html`**：不做。GitHub Pages 纯静态无
  rewrite，深链与刷新必 404，要修得加 postbuild 复制 `index.html → 404.html` 的
  构建期 hack，且 HTTP 状态码仍是 404。更关键的是该缺陷在本地 dev（CRA
  `historyApiFallback` 会正常渲染）与 CI build 中都**不会暴露**，只在真实托管
  环境暴露——任何本地闸门都拦不住。
- **react-router / HashRouter**：不做。当前只有"生产地图页 + demo"两类路由，
  引路由库属于为未来付费。若将来站点出现第二个正式页面（相册页 / 关于页），或
  demo 数量 >5 且需要互相跳转，再议；届时 hash 形式（刷新不 404）优于 path。
- **Storybook / 独立 demo 站**：不做，对本项目体量属过度工程。
- **参数经 props 下发**：阶段一不实现（当前无 demo 需要参数），但约定已在上文
  固化。
- **阶段二的样式解耦与目录整理**：不在本轮实施范围，待用户单独确认。
- 不动 `src/Application/output.json`、`process-photos.js`、`fix-gps.js`、
  `delete-photo.js`（后两者属照片管线与照片删除工作流，见
  `docs/plans/2026-09-30-photo-deletion-workflow.md`）；
- 不改 `MapIcon/MapIcon.jsx` 内部的硬编码内容（坐标、示例图片 URL、
  `title="Marker"`）——那是该 demo 的属性，非本轮目标；
- 不改 `MapChildren.jsx`、`Map/index.jsx`、`MenuDrawer/` 等产品侧文件；
- 不顺带清理 `Map/index.jsx:16-17` 的重复 topic 常量与 `handleMapChange`
  （调用不存在的 `setMap`）、空的 `removeSubscribers`——属独立重构，另开；
- 不改写 `docs/` 既有文档与 `AGENTS.md`（除按 AGENTS.md 流程 3 需回流知识时）。
