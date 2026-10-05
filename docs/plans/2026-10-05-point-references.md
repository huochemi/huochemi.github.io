# 点位级外部参考链接（`references`，挂在 `index.json`）

状态：已实现（2026-10-05）
日期：2026-10-05
修订：2026-10-05 —— 用户拍板 `references` 定为**可选**（缺省 = 该点位没有外部链接）。
本文档唯一待拍板项已关闭，无其它悬空决策。
实现说明：2026-10-05 落地。站点仓 6 文件 **+116 行**（`process-photos.js` 条件展开透传、
`MapChildren.jsx` 下发 prop、`LightboxInfoPanel.jsx` + `.module.css` 新增「延伸阅读」区块、
`docs/photo-workflow.md` 补字段说明、`output.json` 为管线产出）；data 仓
`photos/北京市-大兴机场/index.json` 加 3 条。**验收 1/2/3/7/8 已机器验证**：
`diff` 全文仅一处插入块（第 817 行后 17 行）；14 条未配置点位与基线**逐条深度相等**；
条目数 15→15、顺序不变；管线跑 **0.4 秒 / 派生图复用 370、重新生成 0**（零副作用，退出码 0）；
eslint（`src test process-photos.js`，`--max-warnings=0`）零 warning；`npm run test:cli`
**30/30 全绿**。**验收 4/5/6（浏览器内的渲染与点击行为）未机器验证**——需 `npm start`
后目视（无头驱动要先开 marker → 进 Lightbox → 点 ⓘ，成本不成比例）；其中 5 的
`target="_blank"` / `rel="noreferrer"` 属性已从代码读出。**未提交任何仓库**（交用户）。
来源会话：用户（飞机迷）想把两个外部来源接进本站照片地图——
① X-Plane Scenery Gateway 的 ZBAD 机场页 `https://gateway.x-plane.com/airports/ZBAD/show`；
② yinlei.org「自娱自乐航空米」的大兴机场航图笔记
`https://yinlei.org/x-plane10/2019/09/zbad.html`。
上一轮已实测并给出 A（iframe 直嵌）/ B（只做深链）/ C（构建期抓数自绘卡）/ D（CORS 代理）
四方案对比，用户拍板 **B**；并拍板**链接挂在点位（文件夹）级**。本计划是该决定的落地设计。

相关：`docs/data-pipeline.md`（双根与 `index.json` 归属）、`docs/photo-workflow.md`
（标准流程第 3 步「维护 index.json」）、`docs/app-structure.md`（`src/Application/` 结构与
demo 机制）、`docs/photo-metadata.md`（预检是"能不能产出"的唯一判定点）

## 背景（自包含，零上下文可读）

站点是照片地图。真相源（原图，不可再生）在仓库外的
`../photos-originals/photos/<点位>/`；派生图（可再生）与 `index.json` 在
`../data/photos/<点位>/`（双根改造见 `2026-10-04-data-repo-longevity.md`）。

每个点位一个 `index.json`，当前两个字段**均必填**：

```json
{ "index_photo": "IMG_4657.HEIC", "description": "北京市-大兴机场" }
```

数据流（三段，单一方向）：

```
../data/photos/<点位>/index.json   ← 人工维护，脚本硬拦不覆盖
        ↓  process-photos.js 读（preflightDir 校验 + 生成段写入，第 1054–1058 行附近）
src/Application/output.json        ← 管线产出，勿手改
        ↓  MapChildren.jsx 第 9 行 import（构建期打包进 bundle）
LightboxInfoPanel.jsx              ← 照片详情面板，渲染 description 等
```

**关键：`output.json` 是构建期打包的，不是运行时 fetch**——所以 index.json 里加任何字段，
都要经管线透传才会出现在前端。

## 实测事实（决定了"只能做链接"）

两个来源用 `curl` 实测（2026-10-05）：

| | X-Plane Gateway | yinlei.org |
|---|---|---|
| `X-Frame-Options` | **无**（可 iframe） | **`SAMEORIGIN`（全站，含 PDF 与 PDF.js 阅读器）** |
| 可用 API | `apiv1/airport/<ICAO>` 免鉴权 JSON | 无 |
| `Access-Control-Allow-Origin` | **无** → 浏览器 fetch 被拦 | — |
| 页面形态 | Vue SPA，客户端渲染 | 静态文章 |

推论：Gateway「能嵌但没道理嵌」（外站浅色主题与本站暗色冲突、脆弱、不可控）；yinlei.org
**根本不让嵌**。两者共有的唯一形态就是**链接**——这正是用户选 B 的依据。

## 数据放哪：放 `index.json`

用户提议放 `index.json`，**成立**，理由三条：

1. **层级吻合**：`index.json` 就是"点位级的人工维护元数据"，外部参考链接同属点位级人工内容。
2. **随点位走**：点位删掉 = 目录删掉 = 链接一起消失，不会留下孤儿引用。
3. **工作流现成**：`npm run new-place` 起草、文档里"维护 index.json"的流程与纪律都已存在，
   加一个字段是顺势扩展。

**代价（必须接受）**：加一条链接 = 编辑 data 仓 `index.json` → 跑一次 `npm run photos`
（增量，稳态 0.2 秒；有视频点位会走 exiftool/ffmpeg，agent 环境须先前置
`/opt/homebrew/bin` 到 PATH）→ **提交两个仓**。若这条流程日后觉得重，才是转向"站点仓手写表"
（见「被否决的方案 D」）的信号。

## 字段语义：可选（**已拍板 2026-10-05**）

**拍板记录**：用户 2026-10-05 明确「`references` 定可选」。下文论证保留，作为该决定的依据；
「方案 F（必填）」分支仅作留档，不再启用。

新增字段 `references`，**可选**，缺省 = 该点位没有外部链接：

```json
{
  "index_photo": "IMG_4657.HEIC",
  "description": "北京市-大兴机场",
  "references": [
    { "kind": "data",    "label": "X-Plane 场景包（Scenery Gateway）", "url": "https://gateway.x-plane.com/airports/ZBAD/show" },
    { "kind": "chart",   "label": "大兴机场航图（CAAC）",              "url": "https://yinlei.org/x-plane10/web/doc/ZBAD.pdf" },
    { "kind": "article", "label": "大兴机场航图笔记（2019）",          "url": "https://yinlei.org/x-plane10/2019/09/zbad.html" }
  ]
}
```

`kind` ∈ `data` / `chart` / `article`（仅用于渲染分组标签，**不参与任何判定**）。

**为什么是"可选"，而不是照 `description` 那样必填**：`description` 必填成立的前提是
①缺了它点位语义不完整、②预检要拿它做判定。`references` 两条都不满足——它是**纯展示字段**，
缺省即"这个点位没有外部链接"，语义完整，不产生歧义，也不需要脚本替人猜任何值。

更关键的是**它不该成为判定项**：「没写链接」绝不该导致整组照片被预检跳过、从线上消失。
把展示字段升格为判定项是判据成本与收益的严重不匹配。

技术依据（已实测）：`preflightDir` 只校验 `index_photo` 与 `description`，**额外字段本就
被忽略** → 现有 14 个点位的 `index.json` **零迁移**、不动一个字节。

> 若用户改主意要"必填（恒存在、可为 `[]`）"：则需 ① 预检新增 `Array.isArray` 判据
> ② 14 个点位全部补齐 ③ **必须"先补完 14 个 index.json、再改预检、最后跑 photos"**——
> 次序颠倒会让未补点位的照片在线上整组消失（半迁移态 = 部分点位产出失败）。
> 该分支的收益只是"前端不必写 `|| []`"，代价是新增一个判定项 + 一次性迁移。

## 实现要点

| 文件 | 改动 |
|---|---|
| `process-photos.js` | 生成段（第 1052–1060 行对象）按 `...(Array.isArray(indexConfig.references) ? { references: indexConfig.references } : {})` 透传——与相邻 `takenAt` 同款条件展开（该处注释已确立"真实可缺字段"用条件展开的先例）。**预检区一行不动**（不新增判据） |
| `MapChildren.jsx` | 第 616 行附近，与 `groupDescription` 并列下发 `groupReferences={selectedGroup?.references}` |
| `LightboxInfoPanel.jsx` | 新增「延伸阅读」区块，插在「所属文件夹」区块之后（约 175 行）；列表项用 `target="_blank" rel="noreferrer"`（与既有 `styles.amapLink` 外链同款） |
| `LightboxInfoPanel.module.css` | 复用/新增 `section` / `label` / 链接行样式（暗色主题） |
| `docs/photo-workflow.md` | 第 3 步「维护 index.json」补一段：可选字段 `references` 的格式与用途 |
| `../data/photos/北京市-大兴机场/index.json` | **数据仓**，加上述三条（不属站点仓） |

**首条数据**：只给 `北京市-大兴机场` 配 —— 站内唯一已有点位中与该主题相关的。其他点位保持零改动。

## 验收标准

1. **零回归**：未写 `references` 的点位 → `output.json` 输出与现状**逐字节一致**（不新增 `references` 键）。
2. **透传正确**：写了 `references` 的点位 → `output.json` 出现该数组，内容与顺序与 `index.json` 一致。
3. **零迁移**：14 个既有 `index.json` 一个都不改（大兴机场除外，那是新增内容）；`npm run photos` 退出码 `0`。
4. **渲染**：照片详情面板在所属点位有 `references` 时显示「延伸阅读」，无该字段时**该区块不渲染**（不留空壳）。
5. **外链行为**：点击在新窗口打开，`rel` 含 `noreferrer`。
6. **坏数据显式可见**：字段写错（如 `reference`）→ 前端不显示该区块（肉眼即知）；元素缺 `url` → 渲染出坏链接而非被静默过滤。**不做校验、不做过滤**（见出界清单）。
7. `./node_modules/.bin/eslint src test --ext .js,.jsx,.ts,.tsx --max-warnings=0` 零 warning。
8. `npm run test:cli` 全绿（见下条：不加测试，但不得打破既有测试）。

## 出界清单（明确不做）

- **不嵌入任何外部内容**：不 iframe、不抓取、不镜像、不热链他人图片（yinlei 配图为作者
  自己的 Flickr 图，且该站无许可声明、robots 只有 Cloudflare content-signals 说明文字）。
- **不给 `references` 加校验，也不做静默过滤**：不新增判定项；缺 `url` 就让坏链接显式可见。
- **不做排序 / 去重 / 去死链 / 抓取标题**：链接的标题一律人工写（抓标题=运行时依赖 + 版权风险）。
- **不加测试**：`test/` 现有契约测试锁的是跨文件**常量一致性**（双根路径、视频后缀），
  `references` 透传没有此类常量可锁；为它造测试属过度工程。
- **不做 Gateway 数据卡片**（原 C 方案）：若将来要做，是把 `kind: "data"` 那一行升级为卡片，
  不影响其他行，另开 plan。
- **不改 `output.json` 既有字段语义**，不改预检判据与失败粒度。
- **不做运行时 fetch `/data/photos/<点位>/index.json`**（理由见被否决方案 E）。
- 不改 AMap / 地图相关代码（本方案不涉及地图渲染）。

## 被否决的方案（P1：保留决策过程）

| 方案 | 内容 | 否决理由 |
|---|---|---|
| A iframe 直嵌 | Gateway 页面塞进详情面板 | yinlei.org 全站 `SAMEORIGIN` 根本不让嵌，两来源无法统一；外站浅色主题与本站暗色冲突；Laminar 加一个响应头即全站白屏，控制权为零 |
| C 构建期抓 API 自绘数据卡 | 抓 `apiv1/airport/ZBAD` 落 JSON，自绘机场信息卡 | 用户已选 B；且会把站点构建与第三方可用性绑在一起（无 CORS → **只能**构建期抓）。保留为将来 `kind: "data"` 行的升级路径 |
| D 站点仓手写表 `src/Application/references.js` | 与 `cities.js` 同款：手写、站点仓、零管线耦合 | **本方案的真正对手**。优点：加链接 = 改一个文件 + 提交站点仓，不跑管线、不碰 data 仓；表可一眼看全所有点位的链接。否决理由：点位元数据会分裂两处（`index_photo`/`description` 在 data 仓、`references` 在站点仓），违背 P3 单一事实源；且 key 是 dirName 字符串，点位改名会静默失联。**若日后觉得双仓流程太重，应重新评估此项** |
| E 前端运行时 fetch `index.json` | 同源可取（Pages 上 `/data/photos/...` 与站点同源），加链接只推 data 仓、站点无需重建 | 引入运行时网络依赖与失败态（取不到时显示什么？= 兜底问题），与本站"构建期产出静态数据、前端零环境分支"的既有形态相悖 |
| F `references` 定为必填 | 与 `description` 同款契约 | 见「字段语义」一节：展示字段不该升格为判定项；且要迁移 14 个点位、半迁移态会让线上点位消失 |
