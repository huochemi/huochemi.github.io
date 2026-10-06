# MapIcon demo 的失效硬编码图片 URL（.JPG）

状态：**已实现**（2026-10-06 用户批准「按照你推荐」→ 两个决策点均取推荐值并落地；
eslint 因执行沙箱故障未能代跑，见文末「实施记录」）
日期：2026-10-06

相关文档：`docs/app-structure.md`（demo 分发机制 + `/data` 的发布方式）、
`docs/data-pipeline.md`（派生图档位与命名）、
`docs/plans/2026-09-27-local-preview-relative-url.md`（相对路径决策，本 plan 推翻其出界清单第 1 条）、
`docs/plans/2026-10-04-data-repo-longevity.md`（决策 6：取消「查看原始文件」入口）

## 背景（自包含，零上下文可读）

demo 组件 `MapIcon`（`?demo=map-icon` 才渲染，注册于 `src/Application/demos/registry.js`）
里的 `MapDemo` 硬编码了三处**同一个图片 URL**：

```
https://huochemi.github.io/data/photos/房山长阳-碧桂园温泉小区C区/DSC02780.JPG
```

位置：`src/Application/MapIcon/MapIcon.jsx`

| 行 | 用途 |
|---|---|
| 43 | marker 泡泡里的 `<img class="hcm-marker-image">` |
| 57 | InfoWindow 里 `<a href>` 的 href |
| 58 | InfoWindow 里的 `<img class="hcm-marker-image">` |

**为什么它必然 404**：站点图片由公开仓 `huochemi/data` 以 GitHub Pages 项目站点提供
（前缀 `/data/photos/…`），而该仓**只保留派生图**——2026-10-05「形态 B」阶段 3
（提交 `dabcd99`）把**全部原片（`.JPG` / `.HEIC` / `.jpeg`）移出了该仓**；2026-10-06 的
历史重写（`2026-10-05-data-repo-history-rewrite.md`）处理的是历史对象，不改变
「该仓当前不含原片」这一事实。⇒ 凡以原片扩展名结尾的引用**不可能存在**，属历史遗留，
与近期任何操作无关。

## 只读核实（本次已完成，未做任何写操作）

| 项 | 结果 | 证据 |
|---|---|---|
| 该点位目录现存文件 | 12 个 `DSC02780~DSC02791_thumb.webp` + 12 个同名 `_display.avif` + `index.json`；**无任何 `.JPG`** | 直接枚举本地 data 工作区 `../data/photos/房山长阳-碧桂园温泉小区C区/` |
| demo 渲染条件 | 仅 `?demo=map-icon` 时渲染；无参数/未命中渲染主地图页 `<Map />` | `src/Application/index.jsx` 第 15-16、38 行 + `demos/registry.js` |
| 生产页 marker 取哪档 | `thumbnailLink` → `_thumb.webp`（300×300） | `MapChildren.jsx` 第 373 行 |
| 生产页大图取哪档 | `displayLink` → `_display.avif`（长边 1920，当前最高公开档） | `MapChildren.jsx` 第 558-565 行；档位定义见 `docs/data-pipeline.md` |
| 生产页 URL 形式 | **相对路径** `/data/photos/…`（线上 = Pages 项目站点；本地 = `setupProxy.js` 代理 `../../data`） | `output.json` 第 5-7 行；`src/setupProxy.js` |

> ⚠️ **本次未能独立复现 HTTP 404**：会话期间执行沙箱整体故障
> （`SandboxError: center 规则快照不可用`，fail-closed），`curl` 与全文检索均无法启动。
> 上表结论由**本地 data 仓目录内容 + repo 内既有文档**交叉得出。
> **该 404 已被两处独立记录**：交接说明（2026-10-06）与本仓 `.workbuddy/memory/2026-10-06.md`
> 10:05 节（当日另一次排查，结论同为「线上 404，且早于当日任何操作」）。
> 若要字节级复现，命令见「验收标准」第 2 条。

## 同类问题排查（`src/` 全量，含 CSS）

`src/` 共 37 个文件（11 js / 9 jsx / 3 tsx / 3 ts / 9 css / 1 json / 1 svg），逐个读取后：

**结论：只有 `MapIcon.jsx` 这 3 处。** 其余文件**没有任何**指向 `/data/photos/` 的硬编码
字符串，也没有以 `.JPG` / `.HEIC` / `.jpeg` 结尾的硬编码路径。

两点必须说明，免得后来者误判：

- `src/Application/output.json`（`npm run photos` 的产物，AGENTS.md 明令勿手改）里到处出现
  `.JPG`，但只出现在 `fileName` 字段——那是**文件名字符串**，不是 URL；两个链接字段
  `thumbnailLink` / `displayLink` 的扩展名分别是 `.webp` / `.avif`，均正确。
- `src/Application/MapIcon/index.css` 无任何图片 URL，只有 `.hcm-photo-pin` 系列的几何/配色样式。

## 方案

### 改动面：同一文件 3 行

| 行 | 现状 | 改成 | 理由 |
|---|---|---|---|
| 43 | 绝对 URL + `DSC02780.JPG` | 相对路径 + `DSC02780_thumb.webp` | **尺寸档位对齐**：marker 显示框是 120×120 CSS px（`MapIcon/index.css` 的 `.hcm-photo-wrapper`，其 `img` 规则覆盖 `.hcm-marker-image`），DPR 2 下约需 240px，`_thumb.webp` 的 300×300 刚好覆盖。与生产页 marker 用 `thumbnailLink` 完全同构 |
| 58 | 绝对 URL + `DSC02780.JPG` | 相对路径 + `DSC02780_display.avif` | **语义档位对齐**：InfoWindow 是「点开看大图」的位置，生产页同角色（Lightbox 大图）用 `displayLink`；`_display.avif` 是当前可公开分发的最高画质档（1920px）。若你更看重「两个框都是 100px」的一致性，改回 `_thumb.webp` 也自洽——见「决策点 1」 |
| 57 | `<a href>` 指向原图 | **删除整个 `<a>` 包裹**（推荐） | 见「决策点 2」 |

同时把这 3 处从**绝对 URL 换成相对路径**。这不只是风格问题：绝对 URL 只在线上能解析，
本地 `npm start` 打开 `/?demo=map-icon` 时它根本不走 `setupProxy` 的 `/data` 代理，
表现为「图片裂 + 误跳生产域名」。相对路径是本 repo 既有的 URL 纪律
（`2026-09-27-local-preview-relative-url.md`），改后本地与线上共用同一套路径。

### 决策点 1：InfoWindow 用 `_thumb` 还是 `_display`？

| | `_thumb.webp` | `_display.avif`（**推荐**） |
|---|---|---|
| 尺寸 | 300×300 | 长边 1920 |
| 实际显示框 | 100×100（`.hcm-marker-image`，见 `Map/AMap/index.css`） | 同左 |
| 生产页对应物 | marker 缩略图 | Lightbox 大图 |
| 单张体积 | 约 18 KB（2.7 MB ÷ 153） | 约 176 KB（26.7 MB ÷ 152） |
| 判断 | 够用且最省流量 | 更贴近该位置的原始意图（原先指向全尺寸原图） |

**推荐 `_display.avif`**：demo 该处演示的是「点开 marker 看到照片」，
应当展示当前可用的最高画质档。但两个框确实都是 100px，取 `_thumb.webp` 亦无错——
**请在批准时指明取哪个**。

### 决策点 2：第 57 行的 `<a href>` 怎么处理？

| | 删除 `<a>`（**推荐**） | 指向 `_display.avif` |
|---|---|---|
| 语义 | InfoWindow 只做预览，无外链 | 保留「点开大图」的外链行为 |
| 与 2026-10-05 决策 6 的一致性 | **一致**——该决策已取消全站「查看原始文件」入口 | 有张力：等于重新造一个原图替代出口 |
| 风险 | 无 | 新标签页打开 `.avif` 的浏览器行为与「下载原图」那套习惯不同 |

**推荐删除**：这一行 `<a>` 的存在理由就是「指向原图」（生产页 `webViewLink` 的等价物），
而这个入口在 2026-10-05 已被明确取消；demo 的职责是演示 marker / InfoWindow 渲染，
不是提供下载。**请在批准时指明**。

## 验收标准

1. `?demo=map-icon` 下 marker 图片与 InfoWindow 图片**均正常显示**，浏览器控制台无 404；
2. 线上 URL 抽查（**请你在终端执行**；本次 agent 沙箱故障，未能代跑）：

   ```bash
   for u in "/data/photos/房山长阳-碧桂园温泉小区C区/DSC02780_thumb.webp" \
            "/data/photos/房山长阳-碧桂园温泉小区C区/DSC02780_display.avif"; do
     curl -s -o /dev/null -w "%{http_code} $u\n" "https://huochemi.github.io$u"
   done    # 期望 200 / 200
   # 反例（确认基线确为死链）：把文件名换成 DSC02780.JPG，期望 404
   ```

3. `./node_modules/.bin/eslint src test --ext .js,.jsx,.ts,.tsx --max-warnings=0`
   零 error 零 warning（AGENTS.md 流程 1）；
4. `npm start` + `?demo=map-icon` **本地也能看到图**——这是「相对路径 + setupProxy 生效」的
   直接证据；
5. `src/` 内**不再存在**任何以 `.JPG` / `.HEIC` / `.jpeg` 结尾的硬编码 URL。

## 出界清单（本次不做）

- **不改**生产地图页与照片管线：`process-photos.js` 等三个 CLI、`output.json`、
  `docs/data-pipeline.md` 一律不动；
- **不改** demo 其余内容：marker 上硬编码的计数 `10`、`gpsLngLat` 常量、`console.debug` 均保留；
- **不让 demo 改读 `output.json`、也不抽公共常量**——demo 使用硬编码示例数据是刻意的最小实现；
- 不做 `docs/app-structure.md` 文末记的「demo 归位 / marker 样式迁回产品侧」整理
  （那是 `2026-09-30-demo-registry-query-param.md` 阶段二，另一件事）；
- **不跑 `CI=true npm run build`**（AGENTS.md 流程 2：agent 环境必失败，且会清空现有 `build/`）；
- **不自行 push**；站点仓有 pre-push ESLint 钩子，推送失败即交你终端，不在同一回合反复重试；
- 不改任何既有 plan 原件（P1）。`docs/plans/2026-09-27-local-preview-relative-url.md` 的出界清单
  第 1 条写着「`src/Application/MapIcon/MapIcon.jsx`（demo 硬编码，用户明确保留）」——
  本次是**推翻该保留**，按 P1 只在**本 plan** 记录这一反转，不回改那份原件。

## 风险评估

| 风险 | 等级 | 缓解 |
|---|---|---|
| 挑错派生文件名（`_thumb` / `_display` 写反） | 低 | 文件名已在本地 data 仓逐文件确认；验收含线上 200 抽查 |
| 该点位未来被 `npm run del-photo` 删除 → demo 再次死链 | 低 | demo 本就不在用户使用路径上；介意可改为指向一个长期保留的点位 |
| 沙箱故障期间改完无法自行跑 eslint | 中 | 若沙箱仍未恢复，改完把 eslint 命令交你终端执行（与 build 同处理） |

## 实施记录（2026-10-06）

用户逐字批准：「按照你推荐」→ **决策点 1 取 `_display.avif`、决策点 2 取「删除 `<a>`」**。

### 实际改动（唯一文件：`src/Application/MapIcon/MapIcon.jsx`）

| 位置 | 改动 |
|---|---|
| 原第 43 行（marker `<img>`） | `https://huochemi.github.io/data/photos/…/DSC02780.JPG` → `/data/photos/…/DSC02780_thumb.webp` |
| 原第 57 行（`<a href>`） | **整段 `<a target="_blank">…</a>` 删除**，`<img>` 上提到 `<div>` 直下 |
| 原第 58 行（InfoWindow `<img>`） | 绝对 URL + `.JPG` → 相对路径 + `DSC02780_display.avif` |
| 新第 40-43、59-62 行 | 各加 3~4 行注释，写明「相对路径两端同源」「为何取该档位（尺寸/语义对齐生产页）」与「为何不再包 `<a>`（决策 6）」 |

改动后全文仅剩 2 个图片 URL，均为相对路径，且**均无原片扩展名**。

### 与「验收标准」的逐条对照

| # | 验收项 | 状态 |
|---|---|---|
| 1 | demo 下两图正常显示、无 404 | ⏳ 需你目视 / 待部署 |
| 2 | 线上 URL 200 抽查（`curl`） | ❌ **未能代跑**（沙箱故障，见下）；命令见上 |
| 3 | eslint `--max-warnings=0` | ❌ **未能代跑**（沙箱故障）；命令：<br>`./node_modules/.bin/eslint src test --ext .js,.jsx,.ts,.tsx --max-warnings=0` |
| 4 | 本地 `npm start` + `?demo=map-icon` 可见图 | ⏳ 你的终端 |
| 5 | `src/` 内不再有原片扩展名硬编码 URL | ✅ 已达成（改动后重读全文确认） |

### ⚠️ 沙箱故障（如实标注「未能独立复现」）

本轮全程 `Bash` / 全文检索不可用：`SandboxError: center 规则快照不可用（--uid 未传或
center 从未可达且无缓存）——拒绝执行（fail-closed）`，连 `echo` 裸探针都挂、重试无效。
`Read` / `Glob` / `Write` / `Edit` 正常。因此：

- 改动正确性靠**改动后重读全文**核对（非 eslint）；
- 已自查的 lint 风险点：JSX 开标签内属性之间的 `//` 注释是合法语法（Babel 允许，与既有
  `// fitbounds` 注释同族）；CRA 的 `react-app` 配置无 `max-len`，新增的长行不触规则；
  未新增 `console` / 未用 `var` 以外的语法（`var` 为原有代码）。
- `CI=true npm run build` 按 AGENTS.md 流程 2 **刻意未跑**（agent 环境必失败且会清空 `build/`）。

### 后续（交你终端）

1. `./node_modules/.bin/eslint src test --ext .js,.jsx,.ts,.tsx --max-warnings=0`
2. `npm start` → 打开 `http://localhost:3000/?demo=map-icon`，确认 marker 与点击后的
   InfoWindow 都有图（本地能出图 = 相对路径 + `setupProxy` 生效的直接证据）
3. 推送由你决定（站点仓有 pre-push ESLint 钩子；推送失败即交终端，不在同一回合重试）

