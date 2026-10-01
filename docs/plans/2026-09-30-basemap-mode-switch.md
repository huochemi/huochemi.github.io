# Plan: 底图三档切换（卫星 / 卫星+路网 / 路网）

- 日期：2026-09-30
- 状态：已实现（2026-10-01，待用户真机验收）
- 方案选型：**B（自研悬浮分段按钮 + 声明式 `TileLayer`）**，已与用户确认
- 档位形态：三档（卫星 / 卫星+路网 / 路网），已与用户确认
- 入口：独立悬浮按钮（非顶部胶囊条、非 Menu 抽屉），已与用户确认
- 被否决：
  - 方案 A（官方 `MapTypeControl` 控件）——零 UI 开发，但控件与 `layers` prop
    构成双头状态：用户切到"底图"后，只要父组件再渲染一次，@uiw 的
    `useSettingProperties(['Layers'])` 就会把卫星图层塞回去，表现为"切换被弹回"。
    样式也是 AMap 原生皮肤，与 CityChips 毛玻璃胶囊不一致。
  - 方案 C（命令式 `map.add/remove`）——图层实例生命周期需手工管，
    重复 add 会叠层，且与 React 状态同步要自己保证。
  - `map.setMapStyle('amap://styles/...')`——配色主题维度（grey / darkblue /
    自定义样式 ID），没有"卫星"这一项，做不了底图切换。

## 需求

地图底图可在三个档位间切换，一键直达、当前档可辨：

| 档位 | 视觉 |
| --- | --- |
| 卫星 | 卫星影像（当前默认观感） |
| 卫星+路网 | 卫星影像 + 路网线叠加 |
| 路网 | AMap 标准矢量路网底图 |

## 现状与根因

`src/Application/Map/AMap/index.jsx:19-26`：卫星图层是**硬编码在 render 体内的
临时数组**，没有任何 state 承载"当前底图模式"，因此不存在切换入口。

```jsx
const layers = [];
if (window.AMap) {
  layers.push(new window.AMap.TileLayer.Satellite());
}
// ...
<Map ... layers={layers}>
```

附带隐患（本次一并消除）：`<Map layers>` 在 @uiw 内部走
`useSettingProperties(['Layers'])`（`@uiw/react-amap-map/src/useMap.tsx:88`），
比较方式是**数组引用不等就调 `map.setLayers()`**（实现见
`@uiw/react-amap-utils/src/index.tsx:136-151`）。当前写法每次渲染都新建数组 +
新建卫星实例，等于每次渲染都重设图层。做切换会把它暴露出来，必须先移出 render 期。

## 技术事实（证据）

1. 官方图层指南（`lbs.amap.com/api/javascript-api/guide/layers/official-layers`）：
   "卫星图层与路网图层通常一起使用"，示例即 `layers:[satellite, roadNet]`。
   → "卫星+路网"档就是这两个图层的组合，不是新发明。
2. `AMap.TileLayer` 有 `show()` / `hide()` 方法（官方参考手册 TileLayer 方法表）。
   → `visible` prop 走 `layer.show()/hide()` 可行，**切换不重建图层**。
3. `@uiw/react-amap@7.1.15` 导出 `TileLayer` 组件与 `TileLayerType` 枚举
   （`SATELLITE='satellite'` / `ROADNET='roadnet'` / `TRAFFIC='traffic'`，
   见 `@uiw/react-amap-tile-layer/esm/index.js`）。
4. `TileLayer` 的 `visible` 实现：`useVisiable` → `instance.show()/hide()`
   （`@uiw/react-amap-utils/src/index.tsx:46-61`），不触发图层重建。
   而 `useTileLayer` 的 effect 依赖是 `[map, type, options]`
   （`@uiw/react-amap-tile-layer/src/useTileLayer.tsx`），
   **`visible` 不在依赖里**——这正是"切换无闪烁"的依据。
5. `Map` 组件在 `Context.Provider` 内渲染 children，且等 `map` 就绪才渲染
   （`@uiw/react-amap-map/src/index.tsx`）→ `TileLayer` 放在 children 里必能拿到 map。
6. AMap 2.0 的默认底图（标准图层）就是矢量路网图；`layers` 缺省时自动创建。
   → "路网"档 = 两个图层都隐藏，什么都不用加。

## 改动内容

### 1. 新增 `src/Application/Map/AMap/BaseMapSwitch.jsx` + `.module.css`

组件同时负责三件事：持有档位状态、渲染两个 `TileLayer`、渲染悬浮分段按钮。

```jsx
import React, { useState } from 'react';
import { TileLayer, TileLayerType } from '@uiw/react-amap';

import styles from './BaseMapSwitch.module.css';

const STORAGE_KEY = 'hcm_base_map';
export const BASE_MAP_MODES = {
  SATELLITE: 'satellite',
  SATELLITE_ROAD: 'satellite-road',
  ROAD: 'road',
};
const DEFAULT_MODE = BASE_MAP_MODES.SATELLITE;

// localStorage 唯一读取点：模块级一次，避免 hcm_group_by 三处读取的老问题
const readStoredMode = () => {
  const stored = localStorage.getItem(STORAGE_KEY);
  return Object.values(BASE_MAP_MODES).includes(stored) ? stored : DEFAULT_MODE;
};

const BaseMapSwitch = () => {
  const [mode, setMode] = useState(readStoredMode);

  const handleSelect = (next) => {
    setMode(next);
    localStorage.setItem(STORAGE_KEY, next);
  };

  return (
    <>
      <TileLayer
        type={TileLayerType.SATELLITE}
        visible={mode !== BASE_MAP_MODES.ROAD}
      />
      <TileLayer
        type={TileLayerType.ROADNET}
        visible={mode === BASE_MAP_MODES.SATELLITE_ROAD}
      />
      {/* 悬浮分段按钮：三段平铺，当前档高亮 */}
    </>
  );
};

export default BaseMapSwitch;
```

档位 → 图层映射（唯一事实源就是这一个 `mode` state）：

| mode | Satellite | RoadNet | 观感 |
| --- | --- | --- | --- |
| `satellite`（默认） | 显示 | 隐藏 | 卫星影像 |
| `satellite-road` | 显示 | 显示 | 卫星影像 + 路网 |
| `road` | 隐藏 | 隐藏 | 标准矢量路网底图 |

### 2. 改 `src/Application/Map/AMap/index.jsx`

- 删除 `layers` 硬编码与 `layers={layers}` prop；
- 在 children render prop 的返回数组里插入 `<BaseMapSwitch key="basemap" />`
  （放在 `MapChildren` 之前，图层先于 marker 注册）。

### 3. 悬浮按钮形态

- 位置：右下角 `position: fixed; right: 16px; bottom: 24px; z-index: 999`
  （低于抽屉遮罩的 1000：抽屉/Lightbox 打开时被自然盖住，不需要切底图；
  高于地图画布。左上角是 Menu 按钮、顶部是 CityChips，均不冲突）。
- 形态：三段平铺的 segmented control，当前档高亮；**不用单按钮循环**
  （三档循环需点两次才能往返，且看不出当前在哪一档）。
- 文案：`卫星` / `卫星+路网` / `路网`。
- 样式沿用 CityChips 的视觉语言（白底 0.85 半透明 + blur + 圆角胶囊 +
  选中态 `#1677ff`），保持全站一致。
- 移动端：允许换行或收窄内边距，不做折叠交互。

### 4. 持久化

沿用 `hcm_` 前缀，key 为 `hcm_base_map`；刷新后保持上次选择。
读取点唯一（组件模块级），写入点唯一（切换时）。

## 不做的事（出界清单）

- 不动 `CityChips` / `MenuDrawer` / 照片抽屉 / Lightbox / `MapChildren.jsx`
- 不引入 `MapTypeControl` / `ToolBarControl` / `ScaleControl` 等官方控件
- 不动 `map.setMapStyle()`（配色主题与底图无关）
- 不用 `map.setFeatures()` 收窄标注层（除非验收第 3 条不通过，见"待验证点"）
- 不改 `process-photos.js` / `output.json` / 任何数据文件
- 不顺手清理 `index.jsx` 里的残留调试 `useEffect(console.debug('mapRef:'))`
  —— 与本次需求无关，另开一单
- 不加底图切换的键盘快捷键（`KeyM` 已被 Menu 占用，且无强需求）
- 不新建 `docs/` 域文件（本次无新领域知识产出；若后续确需记录 AMap 图层机制，
  按 AGENTS.md 流程 3 建域文件并补路由）

## 验收标准

1. `./node_modules/.bin/eslint src --ext .js,.jsx,.ts,.tsx --max-warnings=0` 零 warning
2. 本地（用户自查，`npm start`）三档均生效，且**三档视觉可区分**：
   - `卫星`：卫星影像
   - `卫星+路网`：比上一档明显多出道路网格线
   - `路网`：标准矢量底图（中文路名 + POI）
3. 切换过程无白屏、无图层重载闪烁（`visible` 走 show/hide，不是卸载重建）
4. 切换到"路网"档后，若父组件发生重渲染，底图**不会**被弹回卫星
   （即已确认消除了 `layers` prop 双头管理）
5. 刷新页面保持上次选择；手动改坏 localStorage 值（如 `hcm_base_map=xx`）时
   回落 `satellite` 且不报错
6. 底图切换不影响 marker 显示、城市胶囊飞行、抽屉与 Lightbox 的任何行为
7. CI：`CI=true ./node_modules/.bin/react-scripts build` 通过
   （按 docs/toolchain.md：`build/` 存在时须由用户在自己的终端执行）

## 待验证点（实现时确认，不预设结论）

1. **`RoadNet` 的层级**：`useTileLayer` 里 RoadNet 实例化用的是空 options
   （`new AMap.TileLayer.RoadNet({})`）。若路网被卫星影像盖住不显示，
   需通过 ref 拿 `tileLayer` 调 `setzIndex()` 抬高
   （`TileLayer` 的 ref 已暴露 `tileLayer`）。
   注意**不能**用 `options` prop 传 zIndex——`useTileLayer` 的 options 分支会
   覆盖 type 分支，把实例换成标准 `TileLayer`。
2. **档 1 与档 2 的区分度**：卫星影像上本来就会浮着标准图层的地物标注，
   若实测发现 RoadNet 带来的差异不明显，则需改用
   `map.setFeatures(['bg'])` 收窄档 1 的标注层。届时在本 plan 追加记录。
3. 悬浮按钮与 AMap 左下角版权信息、移动端安全区的重叠情况。

## 实现记录（2026-10-01）

- 改动（2 新增 + 1 修改）：
  - 新增 `src/Application/Map/AMap/BaseMapSwitch.jsx`：三档 state +
    两个声明式 `TileLayer` + 悬浮分段按钮；`BASE_MAP_MODES` 同时作为
    localStorage 取值域的校验依据，避免可选值散落两处
  - 新增 `src/Application/Map/AMap/BaseMapSwitch.module.css`
  - 修改 `src/Application/Map/AMap/index.jsx`：删除 render 体内的 `layers`
    硬编码数组与 `layers={layers}` prop，children 数组插入
    `<BaseMapSwitch key="basemap" />`
- 验证：
  - `eslint src --ext .js,.jsx,.ts,.tsx --max-warnings=0` → exit 0
  - `CI=true react-scripts test --ci --watchAll=false` → 3 suites / 3 tests 通过
  - CI build 未跑：`build/` 已存在，按 `docs/toolchain.md` 的门禁交用户终端执行
- 与 plan 的一处偏差：未加移动端 media query（plan 原写"允许换行或收窄内边距"）。
  三档按钮按 13px 字号估算总宽约 200px，右下角与顶部 CityChips 不在同一区域，
  暂不需要；改为只加 `env(safe-area-inset-bottom)` 避开 iOS home indicator。
  若真机在窄屏上发现遮挡再补。
- 待用户真机验收（代码层已备好退路，见「待验证点」）：
  - 验收标准第 2 条：三档视觉可区分
  - 待验证点第 1 条：RoadNet 层级（若不显示则用 ref 调 `setzIndex`）
  - 待验证点第 2 条：档 1 / 档 2 区分度（若不足则用 `setFeatures(['bg'])`）

## 变更记录：第三档文案「路网」→「标准地图」（2026-10-01）

- 触发：用户提问「路网 / 卫星是不是高德官方术语」时核对出——「路网」确为高德
  官方 API 术语（`AMap.TileLayer.RoadNet`，官方中文名「路网图层」，与
  `Satellite`「卫星图层」、`Traffic`「实时路况图层」并列）。但**第三档并没有
  显示 RoadNet**：该档 Satellite 与 RoadNet 均 `visible=false`，用户看到的是
  AMap 默认矢量底图，即高德 App 口中的「标准地图」。原文案名不符实。
- 改动：仅 `MODE_OPTIONS` 的 label 与相关注释（`BaseMapSwitch.jsx`）。
- **未改**：常量名 `ROAD` 与值 `'road'`。该值已写入用户 localStorage
  （`hcm_base_map`），是持久化契约；改值会让存量选择回落默认档（虽有回落逻辑、
  不报错，但属于计划外的用户偏好重置）。代码内已加注释说明此约束。
- 附带澄清：「路网」（RoadNet，道路线画网络）≠「路况」（Traffic，红黄绿拥堵
  着色），二者常被混用；本组件不涉及 Traffic 图层。
- 验证：`eslint src --ext .js,.jsx,.ts,.tsx --max-warnings=0` → exit 0。
  CI build 未跑（`build/` 存在，按 `docs/toolchain.md` 交用户终端执行）。
