# Plan: 底图第四档「海外影像」（手动档，境内瓦片自动透明回退高德）

状态：**已实现**（2026-10-06 用户「开工」放行 → 实施完成并通过自检；用户终端
`npm start` 目视确认后推送上线。实现与本文原方案的差异、以及实施期查实的 API 事实
见文末「实施记录」）
日期：2026-10-06

相关文档：`docs/app-structure.md`（底图三档契约，本 plan 扩为四档）、
`docs/plans/2026-09-30-basemap-mode-switch.md`（三档切换的决策记录，P1 不改）、
`docs/plans/2026-10-06-gps-sign-loss-and-jakarta.md`（雅加达上线；其"伪问题 3：高德底图
海外覆盖弱——已搁置"即本 plan 的起因）、`docs/photo-metadata.md`（GCJ02 与海外直通）、
`docs/toolchain.md`（`test:cli` 的 Node 版本坑）

## 背景（自包含，零上下文可读）

主站底图三档（卫星 / 卫星+路网 / 标准地图）全部来自高德。2026-10-06 用户发现雅加达
点位放大后整片灰底只剩路网线。排查结论（当日实测，curl 瓦片 + md5 比对）：

- **高德卫星影像对海外只有 z≤7**：雅加达/东京/新加坡 z8–z14 **全部**返回同一张
  4235 B 占位瓦片（md5 `a85b8640d75d21ca31aa928225590f50`，水印文字「此区域无卫星图」）；
  雅加达 z8/9/10 的 3×3 邻域 27 块全是占位 → 整片缺失，非零星断图。北京/香港 z11 正常
  → 限制只针对海外。换主机/参数（wprd01、`scl=2` 等）结果相同。
- 高德**标准底图**（style=7）海外同样是 179 B 空瓦片；只有**路网**（style=8）海外有数据
  → 灰底 + 橙色路网线的观感即由此来，切任何一档都救不了。
- 雅加达 chip 的 `zoom: 11` 落在无影像区，且海外点位今后会持续增多（用户确认）。

方案对比（A 不做 / B 自动判定 / C 手动档 / D 自托管 / E 双引擎 / F 降 zoom 治标 /
G 外链替代）已于当轮给用户，用户拍板：**手动档 C**，影像源待用户在自己网络验证后定。

## 决策（用户 2026-10-06 拍板）

| # | 决策点 | 用户结论 |
|---|---|---|
| ① | 海外点位会不会变多 | **会**（值得做第四档） |
| ② | 自动判定（B）还是手动档（C） | **暂时手动 C** |
| ③ | 影像源可达性 | agent 沙箱连不了的源已整理成**验证页**交用户实测，结果回填本 plan 后定稿常量 |

## 只读核实（本轮已完成）

### 影像源候选与 agent 侧探测（2026-10-06）

| 源 | agent 侧 curl | 关键条款（据来源） | 备注 |
|---|---|---|---|
| **Esri World Imagery** `server.arcgisonline.com` | ✅ 200/1.9s | 非创收应用 + <100 万瓦片/月可免费用，需署名（OSM wiki 转述 Esri 口径 + Esri 支持文档） | **雅加达 z13 可见整个机场、z17 可见停机坪上的飞机**（agent 已拼图目检）；**明确禁止离线导出**（否决自托管方案） |
| Esri `services.arcgisonline.com` | ✕ 000（10s 超时） | 同上 | 同一服务的另一域名，内容相同；哪个域可达由用户网络决定 |
| EOX Sentinel-2 cloudless | ✅ 200/3.7s | CC BY 4.0，无需 key | 分辨率 10 m、最大 z14：能看清机场轮廓、看不清飞机 |
| OSM 光栅 | ✕ 000 | © OSM contributors；官方瓦片有使用政策（禁重负载） | 非影像，矢量风格，兜底观感 |
| Bing virtualearth（免 key 旧接口） | ✅ 200/2.6s | 条款未明确授权第三方直连 | **不建议采用** |
| Google 卫星 | ✕ 000 | 违反 Google ToS | **不采用**，仅网络诊断 |
| Mapbox / MapTiler / 天地图 | 401/未测 | 需 key 或 token | 后备，暂不申请 |

验证页：`/tmp/overseas-imagery-check/index.html`（清单式：每源一行 + 缩略图 + ✅/✕ 状态 +
单张直达 + 终端一键版；img 带 `referrerPolicy=no-referrer`）。

### 验证结果汇总（2026-10-06 14:39，用户回执 + agent 复测）

| 事实 | 结论 | 证据 |
|---|---|---|
| **Esri `services` 域** | ✅ 用户浏览器可用，确认为卫星影像 | 用户原话："我打开是可用的，是卫星图"（agent 侧此域 000，双方网络不同） |
| **Esri `server` 域** | ✅ **用户侧也通**（14:45 实测）；agent 侧连测 5 次 4/5 成功（失败均为 ~10.0s 连接超时，非被拒）→ **选定为生产常量** | 用户实测 + agent curl |
| **Esri 不校验 Referer** | ✅ 带 `Referer: https://huochemi.github.io/` 仍 200（18 KB，同无 Referer） | agent curl——**排除了"页面里加载会被拦"的风险**；`<img>` 请求只发 Referer 不发 Origin，故 Origin 无需测 |
| **Esri 最高级别** | ✅ z19 仍有影像（agent 200） | agent curl |
| **OSM** | 用户网络可达，但**不是卫星影像**（矢量路网图）→ **从影像源候选中除名**。原因：OSM 的瓦片是**志愿者矢量数据（ODbL）渲染出来的图**，本身不含任何影像；编辑器里能看到的航空影像由第三方（Bing/Esri/Mapbox）提供，许可是"给描摹用"，**不允许再分发** | 用户原话："我打开确实可用的，但是这个不是卫星图" |
| EOX Sentinel-2 | agent 侧 z13/z14 均 200；降级为**仅记录的备选**（Esri 已可用，不实现） | agent curl |
| Bing 免 key | agent 200，条款未授权 → **不采用**（不变） | agent curl |
| 高德对照 | z7 影像 / z11 占位图（与既有实测一致） | agent curl |

清晰度对比图（agent 侧拼图，雅加达机场）：高德 z7 只能看群岛轮廓 → **Esri z11 可见
海岸线与机场位置** → z13 可见整个机场 → z17 可见停机坪上的飞机 → z19 仍有效。

**域名选型（已决，2026-10-06 14:45）**：用户实测 `server.arcgisonline.com` **也能打开**
→ 定 **`server.arcgisonline.com`**（agent 侧同样可达，后续排查可复验）。`services` 域
（用户曾验证可用）与 EOX 作为"已知备选"只记录在本 plan，**代码中不出现**——不做主备切换。

### 技术通道（自定义瓦片层，不换库）

`node_modules/@uiw/react-amap-tile-layer/esm/useTileLayer.js:35-37`：传 `options` prop 即
`new AMap.TileLayer(options)`。社区多例（含 JS API 2.0 离线部署）用
`new AMap.TileLayer({ getTileUrl: function (x, y, z) { ... } })`；官方另有
`AMap.TileLayer.Flexible({ createTile })` 通道。⚠️ 该 effect 依赖数组是
`[map, type, options]` → **options 必须用模块级常量固定引用**，内联对象字面量会导致
每次渲染重建图层。

### 两条硬约束（本 plan 的设计前提）

1. **中国境内不得显示外部影像**：① 合规——境内地图须用有资质的合规底图；② 技术——
   高德瓦片网格在境内是 GCJ02，外部 WGS84 影像直接叠加**必然偏移数百米**（境外
   GCJ02 ≡ WGS84 才对齐，`test/gcj02.test.js` 已有境外直通实测）。
2. **境内瓦片不得回落抓高德瓦片**：高德开放平台服务协议 3.5（一手条款）明确不得
   抓取/缓存高德数据图片；且下层本来就有 AMap Satellite 图层可露出来。

## 方案

### 核心机制：逐瓦片判定，境内透明、境外外部源

自定义图层挂在 AMap Satellite **之上**，`getTileUrl(x, y, z)` 里做三步：

```
瓦片坐标 (x,y,z) → Web Mercator 反算瓦片中心经纬度 → outOfChina 判定
  境外 → 返回 Esri 瓦片 URL（有影像，盖住高德的占位图）
  境内 → 返回 1×1 透明 GIF data URI（浏览器不发起对外请求，露出下层高德卫星）
```

为什么逐瓦片而不是 `moveend` + 视野四角判定：**无状态、无事件监听、无档位互斥**；
跨境内外的视野天然逐瓦片正确（境内露出高德、境外换 Esri）；判定点单一（一个纯函数，
可测）。取舍：边界瓦片按中心判定（误差 ≤ 半个瓦片，z19 时约 200 m），写进注释。

档位语义（唯一事实源仍是 BaseMapSwitch 的 mode state）：

| mode | Satellite | RoadNet | Esri 自定义层 | 观感 |
|---|---|---|---|---|
| `satellite` | 显示 | 隐藏 | 不挂 | 卫星影像（现状） |
| `satellite-road` | 显示 | 显示 | 不挂 | 卫星+路网（现状） |
| `road` | 隐藏 | 隐藏 | 不挂 | 标准地图（现状） |
| `overseas`（新） | **显示** | 隐藏 | 显示 | 境外=Esri 高清；境内=露出高德卫星 |

- Satellite 在第四档保持显示是**有意的**：它是境内瓦片的露出层（合规底图），不是遗留。
- RoadNet 第四档隐藏：高清影像上路网线冗余且遮挡细节。

### 改动 1 · 新增 `src/Application/Map/AMap/overseasTiles.js`（CommonJS）

内容（全部纯函数/常量，`module.exports` 导出）：

- `OUT_OF_CHINA_BOUNDS = { lngMin: 72.004, lngMax: 137.8347, latMin: 0.8293, latMax: 55.8271 }`
  ——与 `fix-gps.js:598` `outOfChina()` **同值常量**，注释指向来源；两处一致性由测试锁死
  （与 `test/video-support.test.js` 锁三处 `DERIVED_SUFFIXES` 同一手法，不抽共享模块）。
- `tileToLngLat(x, y, z)`：Web Mercator 反算瓦片中心经纬度（纯函数）。
- `TRANSPARENT_TILE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'`
  （1×1 透明 GIF，境内瓦片的返回值）。
- `overseasTileUrl(x, y, z)`：中心在境外 → 返回 `ESRI_URL`，境内 → `TRANSPARENT_TILE`。
- `ESRI_URL` 常量 = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`
  （2026-10-06 定稿，用户实测可达。⚠️ **参数顺序是 `/{z}/{y}/{x}`**，与 OSM 的 `/{z}/{x}/{y}`
  相反——写反了不会报错、只会静默错位）。**写死单域名，不做运行时探测/降级/主备切换**
  （S3 与用户"拒绝兜底"纪律）；失效时改一个常量即可。

**模块形态为什么是 src 内 CommonJS**（设计要点，防后来者"顺手统一成 ESM"）：

- `test/` 是 `node --test` + `require`（CJS），要测的纯函数必须能被 require；
- CRA 的 ModuleScopePlugin **禁止 src 外的相对 import** → 不能放仓库根目录；
- src 下的 ESM 文件无法被 node require（package.json 无 `"type": "module"`，`.js` 按
  CJS 解析 ESM 语法直接 SyntaxError）；
- ⇒ src 内 **CJS** 是唯一同时满足"webpack 可 import + node 可 require"的形态；
  webpack 5 对 CJS 具名导入支持良好。被否决的替代：根目录 CJS（ModuleScopePlugin 拦截）、
  `.mjs` + node 动态 import（eslint/import 插件兼容性未验证）。
  若 eslint 对 `module.exports` 报 sourceType 类错误（实施时实跑确认），则整体切
  `.mjs` 方案——两选一，无第三种。

### 改动 2 · `fix-gps.js`：导出 `outOfChina`

`module.exports` 追加 `outOfChina`（纯增量，无行为变化），供改动 4 的跨文件一致性
断言使用。与该文件既有"最小公共面 + 供测试断言口径一致"的导出模式一致。

### 改动 3 · `BaseMapSwitch.jsx` + `BaseMapSwitch.module.css`

- `BASE_MAP_MODES.OVERSEAS = 'overseas'`；`MODE_OPTIONS` 追加
  `{ value: OVERSEAS, label: '海外影像' }`。文件头"档位-图层关系"注释更新为四档表。
- 新增 `<TileLayer options={OVERSEAS_TILE_OPTIONS} visible={mode === OVERSEAS} />`；
  `OVERSEAS_TILE_OPTIONS = { getTileUrl: overseasTileUrl, zooms: [8, 19] }` 为**模块级常量**
  （原因见"只读核实"）。`zooms` 下限 8：z≤7 高德自有影像，外部层不必请求。
- 署名 + 提示（Esri 条款要求 on or near the map）：第四档激活时地图左下角渲染一行
  小字：`影像 © Esri, Maxar, Earthstar Geographics · 仅境外生效，境内显示高德卫星`
  （若最终源非 Esri，按所选源署名）。CSS 在 module 里加 `.attribution`（字号 11px、
  左下角 fixed、z-index 999 同 switcher、pointer-events: none）。
- localStorage 契约：`hcm_base_map` 值域从 3 个扩为 4 个；`readStoredMode` 的白名单
  校验天然兼容存量值（旧值仍是合法值，新值在旧代码上回落默认档，无迁移需求）。

### 改动 4 · 新增 `test/overseas-tiles.test.js`（node 内置 runner，纯函数零外部依赖）

`require('../src/Application/Map/AMap/overseasTiles.js')` 与 `require('../fix-gps')`：

1. **断言 A（境外放行）**：雅加达 z11/z13/z17 的瓦片 → `overseasTileUrl` 返回值以
   Esri 域名开头且包含正确的 z/y/x 数字。
2. **断言 B（境内透明）**：北京 z10、乌兰察布 z12、广州 z10 → 返回值 === `TRANSPARENT_TILE`。
3. **断言 C（跨文件一致性）**：`overseasTiles.js` 的 `OUT_OF_CHINA_BOUNDS` 四个界值与
   `fix-gps.js` 的 `outOfChina` 阈值逐项相等（防两处口径漂移——阈值若漂移，境内边界
   瓦片会静默错位或违规）。
4. **断言 D（反算控制点）**：`tileToLngLat` 反算的瓦片中心距雅加达
   (−6.118417, 106.664689) **不超过半个瓦片宽**（防反算公式写错——它"算错也不响"，
   错位会静默发生，故设控制点；与 `test/gcj02.test.js` 的主张同源）。
   ⚠️ 原稿写的 `0.05°` 是错的：z11 瓦片宽 0.1758°、半宽 0.0879°，而实测中心偏差
   0.0534° > 0.05° —— 按原稿写会在实施时误报。容差改为"半个瓦片宽"这一**随级别
   自解释**的判据，实测偏差（z11 0.053° / z13 0.013° / z17 0.001°）全部通过。
5. **断言 E（超限折算）**：z 超过源原生上限（19）时，返回的是 z19 的（x/2, y/2）瓦片；
   未超限时不得折算（见「实施记录」新增特性）。
6. **断言 A2 / B2（锁死面）**：A2 锁影像源域名（改源必须是一次被看见的改动）；
   B2 全域抽样扫描断言返回值只可能是透明瓦片或影像源 URL，**绝不含 `autonavi`/`amap.com`**
   （合规红线，且抽样中两类必须都出现，防止判定函数退化成常量）。

### 改动 5 · docs 回写

- `docs/app-structure.md`：底图三档契约更新为四档；记录"高德海外影像上限 z7"实测结论
  与逐瓦片判定设计（含"境内透明为什么不回落抓高德"的条款依据）。
- `docs/toolchain.md`：补"CRA ModuleScopePlugin ⇒ test 要测的前端纯函数必须放 src 内
  CJS"这个坑（本次选型时踩到的知识）。
- AGENTS.md 路由不动（`app-structure.md`、`toolchain.md` 均已在路由）。

## 实施期需在浏览器核对的两个 API 事实（不编造 API）

1. ~~`new AMap.TileLayer({ getTileUrl })` 在 JS API 2.0.5 下是否生效~~ → **已证实成立**，
   依据与旁证见「实施记录」§1。仍建议你 `npm start` 时顺手在 Network 面板确认瓦片
   请求确实打到 `server.arcgisonline.com`（这是"文档说支持"落地成"真的在请求"的最后
   一步确认，成本几秒）。
2. ~~`getTileUrl` 的参数顺序按 (x, y, z)~~ → **已证实**：官方 typings 的签名是
   `Function(x,y,z)`，官方示例直接用 `&x=' + x + '&y=' + y + '&zoom=' + (17 - z)` 拼
   XYZ 瓦片地址（也证明 y 不是 TMS 翻转）。本实现的 `tileToLngLat` 按标准 XYZ 处理，
   并由 `test/overseas-tiles.test.js` 的控制点断言（雅加达 z11/13/17）兜住。

## 验收标准

1. `npm run test:cli` 全绿；新测试在改动前必然失败（模块不存在，天然红）。
2. `./node_modules/.bin/eslint src test --ext .js,.jsx,.ts,.tsx --max-warnings=0` 通过
   （含新增文件；`module.exports` 若报错按"模块形态"一节的替代路径处理）。
3. 本地 `npm start` 目视（你终端跑）：
   - 雅加达 chip 落地 → 切「海外影像」：z11–z17 显示 Esri 高清影像，marker 落点不变
     （坐标纪律不受影响——只是底图叠加，marker 仍走 `AMap.convertFrom`）；
   - 北京/广州 → 切「海外影像」：观感与「卫星」档一致（透明层露出高德、无错位），
     左下角出现署名 + "仅境外生效"提示；
   - 三个旧档行为不变；刷新后第四档选择被记住（localStorage 契约）；
   - 雅加达切第四档后 Network 面板：瓦片请求只打到所选源域名，**无任何高德瓦片
     直连请求**（透明瓦片是 data URI）。
4. 推送后：线上雅加达验证 + Pages 部署成功（data 仓无需动——本 plan 零数据改动）。
5. plan 状态改「已实现」，实测数字回填（保留不删，P1）。

## 风险评估

| 风险 | 对策 |
|---|---|
| 所选源在部分访客网络不可达 | 已验证两域名各有一方可达 + Referer 不拦；写死单域名，失效时改一个常量 |
| Esri 未来改条款/限流 | 个人站请求量极低（<100 万瓦片/月条件富余）；失效时改一个常量即可 |
| `getTileUrl` 签名/行为与预期不符 | **已由官方 typings 证实**（见「实施记录」§1）；实施时不再需要 Flexible 备选路径 |
| eslint 对 src 内 CJS 报错 | **已排除**：`eslint` 全量 `--max-warnings=0` exit 0（原因见 docs/toolchain.md 新增章节） |
| 边界瓦片半境内半境外 | 中心判定，误差 ≤ 半个瓦片；注释写明取舍 |
| localStorage 存量值 | 白名单校验天然兼容，无迁移 |
| 并行会话撞车 | 提交前重看 `git status`/`git diff`；推送前 `git ls-remote` 比对 tip |

## 出界清单（本 plan 明确不做）

- 不做自动境外判定切换（方案 B）：用户拍板手动档，后续海外点位多了可另起 plan 升级。
- 不做自托管瓦片（方案 D）：Esri 明确禁止离线导出；可再分发源（Sentinel-2）分辨率不足
  且 z8–z15 约 1900 块/数十 MB，为当前体量不值。
- 不接 Mapbox/MapTiler/天地图（需 key 申请流程；Esri+EOX 双双不可用时再议）。
- 不采用 Google/Bing 源（ToS）。
- 不动三个旧档语义、不动 `RoadNet`、不动 `GLOBAL_VIEW`/`cities.js`。
- 不改 `fix-gps.js` 的 `outOfChina` 逻辑本身（只加导出）。
- 不引入任何新 npm 依赖（用现有 `@uiw` TileLayer 的 options 通道）。
- 不做雅加达以外任何点位的数据/管线改动。

## 实施顺序

1. ✅ 影像源已定稿（`server.arcgisonline.com`，用户实测可达）；
2. ✅ 改动 1 + 改动 2（共享模块 + fix-gps 导出）；
3. ✅ 改动 4（测试）→ `npm run test:cli` 40/40 绿（含新增 7 条）；
4. ✅ 改动 3（BaseMapSwitch + 署名）→ eslint 全量 `--max-warnings=0` 通过；
5. ✅ **用户终端** `npm start` 目视（验收 3）→ 用户确认通过；
6. ✅ 推送（pre-push eslint 钩子即门禁）；
7. ✅ 改动 5（docs 回写），plan 状态转「已实现」。

## 实施记录（2026-10-06，与原方案的差异与新增决策）

实际落地的文件：`src/Application/Map/AMap/overseasTiles.js`（新增，CJS）、
`test/overseas-tiles.test.js`（新增，7 条断言）、`BaseMapSwitch.jsx` / `.module.css`
（四档 + 署名）、`fix-gps.js`（只加 `outOfChina` 导出）、`docs/app-structure.md`、
`docs/toolchain.md`。

### 新查实的两条 API 事实（本轮实测，替代原稿的"待浏览器核对"）

1. **`new AMap.TileLayer({ getTileUrl: Function(x,y,z) })` 在 JSAPI 2.0 成立**——
   依据是**高德官方 typings**（`@amap/amap-jsapi-types@0.0.15`，README 自述"高德开放
   平台官网提供的 JSAPI2.0 声明文件"）里 `AMap.TileLayer` 的 JSDoc：
   `@param {Function(x,y,z)} opts.getTileUrl`，并附官方 2.0 示例链接
   `jsapi-v2/example/thirdlayer/custom-grid-map`。旁证：2024 年的 2.0 内网离线瓦片
   实践、以及 @uiw README 的天地图示例均用同一通道。
   ⚠️ 该 typings 的 `TileLayerOptions` **接口**里没列 `getTileUrl`（只有 `tileUrl`），
   是文档与接口不同步的已知缺漏——**以 JSDoc + 官方示例为准**。
   ⇒ 因此**没有**走原稿的备选 `TileLayer.Flexible`（`createTile` 需自己建 `<img>`、
   还有 `cacheSize` 缓存问题），也就**不需要**绕过 @uiw 的 `TileLayer` 组件自己去
   `map.add()`——`options` prop 通道足够，改动面比原稿更小。
2. **`zIndex` 默认值**：官方文档明确 `AMap.TileLayer` 默认 zIndex=4，而
   Satellite=2、RoadNet=3 ⇒ 自定义层默认就盖在卫星与路网之上。仍显式写出 `zIndex: 4`，
   作为"必须盖在 2/3 之上"的自解释。

### 新增特性（原方案没有，实施时判断为必要）

**z 超过源原生上限时按 z19 取图**：原稿只写 `zooms: [8, 19]`（下界 8 是为了不抢高德
自带的 z≤7 海外影像）。但 AMap 地图默认最大级别可到 20，若上界取 19，用户在 z20 会
**重新看到灰占位图**——正是本功能要修的症状。故 `zooms: [8, 20]` + `overseasTileUrl`
内部把 z 折算到 19（`Math.floor(x / 2)`，因 z19 一块正好覆盖 z20 的四块）。这与 Leaflet
的 `maxNativeZoom` 同义，是瓦片金字塔的常规处理，**不是**"替用户猜默认值"式的兜底
（用户 2026-10-05 反对的是后者）。`ESRI_MAX_NATIVE_ZOOM` 独立成常量，不认可此行为时
删掉折算分支即可。落点核对：雅加达 z20 → `/19/271071/417485`，正是此前实测过
200/8974 B 的那块瓦片。

### 原稿的三处修正（都是原稿写错，已按实况改）

| 位置 | 原稿 | 实况/修正 |
|---|---|---|
| 断言 D 容差 | 0.05° | **0.05° 太紧会误报**：z11 实测中心偏差 0.0534° > 0.05°。改为"半个瓦片宽"（z11 为 0.0879°），随级别自解释 |
| 改动 5 的落点 | "`docs/app-structure.md` 更新三档契约为四档" | 该文件**当时根本没有底图章节**（原稿误记）——本轮是**新增**「底图四档与影像源契约」整节 |
| 改动 1 的 `ESRI_URL` | 常量名 `ESRI_URL` | 落地名 `ESRI_TILE_URL_TEMPLATE`（明确它是含 `{z}/{y}/{x}` 占位符的模板，不是成品 URL） |

### 自检结果（agent 侧可执行的部分）

- `./node_modules/.bin/eslint src test --ext .js,.jsx,.ts,.tsx --max-warnings=0` → **exit 0**
  （新增/改动 3 个文件 errors 0 / warnings 0，已用 `-f json` 逐个确认被真正检查到）
- `npm run test:cli` → 40/40 绿、exit 0。⚠️ **必须** `PATH=/opt/homebrew/bin:$PATH`：
  不加则 `test/gps-sign.test.js` 的两条 fixture 断言因沙箱无 `exiftool` 被取消
  （`fail 0` 与 `cancelled 2` 并存、退出码 1），这是**环境**问题不是代码回归——
  已写进 `docs/toolchain.md`
- 实跑模块输出核对（`node -e` 直接 require）：雅加达 z11/z13/z17 → 三个 Esri URL 与
  坐标逐位对应；北京 z10 / 广州 z10 / 乌兰察布 z12 → 透明 GIF；雅加达 z20 → 折算到 z19
- **仍未验证（交用户）**：`npm start` 下 AMap 是否真按预期逐块请求（Network 面板）、
  切档观感、`CI=true npm run build`、推送后线上
