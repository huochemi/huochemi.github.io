# 照片坐标南纬符号丢失（EXIF Ref 未参与派生）+ 雅加达上线

状态：**已实现**（2026-10-06；改动 1–5、7 与 docs 回写完成；`npm run photos` 由用户在
终端执行，agent 已核 diff 通过。结果见文末「实现记录」）
日期：2026-10-06

相关文档：`docs/photo-metadata.md`（坐标溯源 `geoSource` 与 EXIF 读取口径）、
`docs/plans/2026-10-03-gps-gate-hardening.md`（EXIF 分块 pick 的前两块坑，本 plan 补第三块）、
`docs/plans/2026-09-28-city-chips-fly-to.md`（城市胶囊的数据源与飞行动作）、
`docs/photo-workflow.md`（新点位导入流程）

## 背景（自包含，零上下文可读）

用户导入雅加达（苏加诺-哈达国际机场）照片后，希望 ① 在城市跳转胶囊里加雅加达、
② 照片能在地图上落在正确位置。只读排查发现两类彼此独立的事：

- **海外坐标与 `AMap.convertFrom`**：不是问题（见「已结清的伪问题」）。
- **坐标符号丢失**：真问题，且与海外无关，是 EXIF 读取环节的缺陷。

### 现象（实测）

雅加达原图 `IMG_4919.HEIC` 的 EXIF 原文：

```
GPS Latitude      : 6 deg 7' 6.30" S        ← 南纬
GPS Latitude Ref  : South
GPS Longitude     : 106 deg 39' 52.88" E
```

而管线产出 `src/Application/output.json` 里：

```json
"lat": 6.118416666666667,     ← 正值（丢符号）
"lng": 106.66468888888889
```

⇒ 雅加达 marker 会被钉到**北纬** 6.118°／东经 106.66°（南海西南海面、马来西亚外海约
100 km），与真实位置相差约 **1362 km**。当前 `output.json` 中**没有任何负纬度项**——17 个
点位全在北纬东经，符号无差异，故历史数据从未暴露该缺陷；**雅加达是第一个南半球点位**。

## 只读核实（本轮已完成，未做任何写操作）

### 坐标读取通道全清点（全仓仅此 4 处）

| 位置 | 通道 | 判定 |
|---|---|---|
| `process-photos.js:585` `PREFLIGHT_EXIF_OPTS`（→ `readPhotoMeta:748`） | exifr 分块 pick（照片） | ❌ 丢符号 |
| `fix-gps.js:527` `REVIEW_EXIF_OPTS`（→ 审阅页扫描） | exifr 分块 pick（审阅页照片） | ❌ 丢符号 |
| `fix-gps.js:195` `readGps` | `exifr.gps()` | ✅ 正确 |
| `process-photos.js:706` / `fix-gps.js:129` `readVideoMeta` | `exiftool -j -n` | ✅ 正确 |

两个常量各自**只有一处定义、一处使用**（已 grep 全文确认），改动面收敛。

### 五通道实测（同一张雅加达原图 `IMG_4919.HEIC`）

| 通道 | 读出纬度 | 判定 |
|---|---|---|
| `exifr.parse(PREFLIGHT_EXIF_OPTS)`（**管线现状**） | `+6.118416666666667` | ❌ |
| `exifr.parse` 仅补 `GPSLatitudeRef`/`GPSLongitudeRef` 到 pick | `−6.118416666666667` | ✅ |
| `exifr.parse({ gps: {} })`（gps 块不做 pick） | `−6.118416666666667` | ✅ |
| `exifr.gps()` | `−6.118416666666667` | ✅ |
| `exiftool -j -n -GPSLatitude` | `−6.11841666666667` | ✅ |

### 真实常量逐组合实测（含 `reviveValues`，2026-10-06 补测）

上一轮的复现用了简化配置（无 `reviveValues`）。本轮用**真实常量形态**在真实文件上再跑一遍，
确认改法在最终形态下成立、且不误伤其它已 pick 字段：

| 配置形态 | `latitude` | `Ref` | `DateTimeOriginal` | `Make` |
|---|---|---|---|---|
| 现状：`gps.pick=[Lat,Lng,ProcessingMethod]` + `reviveValues:false` | `+6.118416666666667` ❌ | `undefined` | `"2026:07:30 07:08:49"` | `Apple` |
| 拟改：`gps: {}` + `reviveValues:false` | `−6.118416666666667` ✅ | `S` | `"2026:07:30 07:08:49"`（不变） | `Apple`（不变） |
| `gps: {}` 但**去掉** `reviveValues:false` | `−6.118416666666667` | `S` | `2026-07-29T23:08:49.000Z`（**变 Date**） | `Apple` |

⇒ 结论：改法有效；`reviveValues: false` **必须保留**（去掉会让拍摄时间被转成 UTC Date，
正是该选项存在的理由）。`GPSProcessingMethod` 在该图本就缺失（原生坐标、无 `geoSource`），
三种形态一致。

### 自造 fixture 可行性实测（决定「新读法能否配测试」）

在 `/tmp` 隔离目录：`sharp` 生成 8×8 JPEG → `exiftool` 写入南纬坐标 → exifr 读回：

| 读法 | 结果 |
|---|---|
| `exifr.gps()` | `−6.1184166` ✅ |
| `parse({ gps: {} })` | `−6.1184166`、`GPSLatitudeRef === 'S'` ✅ |
| `parse({ gps: { pick: ['GPSLatitude','GPSLongitude'] } })`（旧形态） | `+6.1184166` ❌ **bug 当场复现** |

⇒ 可用**完全自包含**的测试同时复现旧缺陷与验证新读法，不依赖不可再生的原图仓
（S1）、不需要提交二进制 fixture。

### `npm run test:cli` 的现状（本轮新查，决定 CI 怎么接）

| 项 | 实测结果 |
|---|---|
| 现有 `test/` 内容 | 5 个文件，**全部是纯函数测试**（无外部命令、无照片依赖）；`require('../process-photos')` / `require('../fix-gps')` 因 `require.main === module` 守卫而**无副作用** |
| 现有脚本 `node --test "test/**/*.test.js"` | 在 Node 22 上可跑通：**30 tests / 0 fail**（本轮基线） |
| `node --test test/`（目录形式） | **Node 22 直接失败**：`Cannot find module '…/test'`（目录参数在 22 上不被接受） |
| `node --test`（无参数，靠默认发现） | **32 tests / 2 fail**：把 `src/Application/utils/utils.test.js`、`src/Application/demos/parseDemoName.test.js` 两个 **CRA jest** 测试也拉进来跑了（node:test 下无 `describe` 全局） |
| `node --test test/*.test.js`（shell 展开） | **30 tests / 0 fail**，与现状脚本等价 |
| CI 的 Node 版本 | `.github/workflows/build-deploy.yml` **`node-version: 18.x`**；Node 18 的 `--test` 文档只列文件/目录参数、**未提 glob** |

⇒ `test:cli` 要进 CI（Node 18），脚本写法必须选**版本无关**的形式（见改动 3.5）。

### 数据与环境现状

| 项 | 现状 |
|---|---|
| `src/Application/output.json` | **未提交**；相对 HEAD 为**纯新增 21 行**（雅加达组），无删除 |
| data 仓雅加达派生图 | 已生成，但该目录**未跟踪**（`git status` 显示 `??`），未提交 |
| 站点仓 HEAD | `e93ab15`，与 `origin/main` 一致 |
| `npm run photos` 的写入面 | **只写 `src/Application/output.json`**（`process-photos.js:1232` 是全脚本唯一 `writeFile`；`index.json` 只读不写，见 `:776-780`）。写入条件是"至少一个文件夹通过预检"（`:1220-1233`）⇒ **重跑不需要 `--force`**（`--force` 只影响派生图重建） |
| CI 门禁 | `build-deploy.yml` 只跑 `npm test`（CRA jest，roots 仅 `src/`）；**`npm run test:cli` 不在 CI 内** ← 本 plan 改动 3.5 补上 |
| pre-push 钩子 | 只跑 eslint（`src`，`--max-warnings=0`），失败即阻断推送 |
| 本机 exiftool | 经 `PATH` 前置 `/opt/homebrew/bin` **可用**（实测 13.55）——沙箱 PATH 不含它，报"未找到"≠ 未安装（见 `docs/toolchain.md`） |

## 根因

`latitude` / `longitude` 是 exifr 的**派生**值：由 `GPSLatitude` 度分秒数组加
`GPSLatitudeRef`（N/S）计算得出。而 `PREFLIGHT_EXIF_OPTS` 采用**分块 pick**（这是为
避免顶层 pick 滤掉 XMP 块的正确做法，见 `2026-10-03-gps-gate-hardening.md`），
其 `gps.pick` 只列了 `GPSLatitude` / `GPSLongitude` / `GPSProcessingMethod`——
**Ref 被滤掉，派生值失去符号，静默回退为无符号绝对值**。

即：读坐标的正确性**隐式依赖"调用方恰好把 Ref 写进 pick"**，这条契约只活在注释里
（`2026-10-03-gps-gate-hardening.md:190-192` 记了"派生字段需同时 pick 原始标签"，
没记"还需 pick Ref 才能带符号"）。⇒ 病灶是**隐式契约**，不是"少写了两个字符串"。

### 连带影响（无需修，但要知道）

- `fix-gps.js` 的写坐标路径（`writeGps` 用 `exiftool -tagsfromfile` 连
  `-GPSLatitudeRef` 一起复制）+ 读坐标路径（`readGps` 用 `exifr.gps()`）**都是正确的**
  ⇒ **原图与历史数据未被污染**。
- 但审阅页扫描（`REVIEW_EXIF_OPTS`）出的坐标会丢符号，而它与 `readGps` 在
  `fix-gps.js:939-948` 有交叉校验 ⇒ 南纬点位上 `fix-gps` 会误报"计划可能已过期"，
  即该工具在南半球点位**不可用**。本 plan 顺带修掉。

## 已结清的伪问题（记录在案，避免后来者重查）

1. **`AMap.convertFrom` 不支持海外坐标**——不成立，也不需要改：高德 GCJ02 偏置仅在中国
   境内生效，境外直通。项目自己早有实测证据：`test/gcj02.test.js:9-12` 记录 2026-10-05
   用官方 `convertFrom` 实测境外坐标（东京）**原样返回**；`fix-gps.js:588` 的
   `outOfChina()` 阈值 `lat < 0.8293` 对雅加达（−6.118）判定为境外 → 直通。
2. **`convertFrom` 批量上限 40 对/次**——是**Web 服务接口**（REST 坐标转换）的文档限制，
   JS API 的 `convertFrom` 走另一通道不受其约束。反证：照片分组模式已有 214 个 marker
   一直正常。（上一轮分析把它写成风险属判断错误，此处更正。）
3. **高德底图海外覆盖弱**——用户已明确搁置，本 plan 不处理。

## 决策（用户 2026-10-06 拍板）

| # | 决策点 | 用户结论 | 落地 |
|---|---|---|---|
| ① | 新测试缺 `exiftool` 时的行为 | **硬失败**（符合 S3。用户口径更直白：**环境工具必须先配好才能跑测试**——同"没 `npm install` 就跑 `npm start` 必然报错"，不做 `skip`、不降级） | 测试内先探测 `exiftool`，缺失即**报错并给出安装命令**（失败粒度设计见改动 3 第 5 条）；"把环境配好"这一步由改动 3.5b 在 CI 侧承担 |
| ② | 雅加达 `zoom` | 由 agent 给推荐值 → **11** | 改动 4 |
| ③ | 是否调整 `GLOBAL_VIEW` | **要调**，取值方向已确认（用户 13:57 回"同意"）：中心**南移**，让初始/回全局视野同时包住中国与雅加达 | 改动 4 的 `{ lng: 108, lat: 20, zoom: 3.5 }`；最终由用户在 `npm start` 目视定稿 |
| ④ | `test:cli` 是否进 CI | **要进** | 改动 3.5 |
| ⑤ | `npm run photos` 由谁执行 | **用户在终端跑** | 改动 6 |

**③ 方向更正（本轮自查发现）**：上一轮我写"GLOBAL_VIEW 是否**北调**"是**笔误**。
雅加达在南纬 −6.12°，视野中心往北移只会让它离画面更远；要"看得见雅加达"必须把中心
**南移**并适当缩小 zoom。本 plan 按"初始视野同时包住乌兰察布（40.99°N）与雅加达
（−6.12°）"给值。

**关于 ① 的实测说明**：本机 `exiftool` 经 PATH 前置可用（13.55，本轮实测），实施期
agent 侧**不需要你代跑**；该纪律适用于确实是 agent 环境拿不到的外部工具。

## 方案

### 改动 1 · `process-photos.js`：坐标读取不再 pick

`PREFLIGHT_EXIF_OPTS`（第 585-590 行）的 `gps` 分块由

```js
gps: { pick: ['GPSLatitude', 'GPSLongitude', 'GPSProcessingMethod'] },
```

改为

```js
gps: {},   // 不 pick
```

并在注释里写明理由（这是本 plan 的核心知识）：exifr 的派生值 `latitude`/`longitude`
需要 `GPSLatitudeRef`/`GPSLongitudeRef` 参与计算，**一旦 pick 就必须把 Ref 一并列上，
漏一个就静默丢符号（南纬/西经变正值）**；不 pick 则由 exifr 自行按 Ref 派生。
`ifd0` / `exif` 的分块 pick 与 `reviveValues: false` **保持不变**（后者已实测必须保留）。

同时把 `PREFLIGHT_EXIF_OPTS` 加入文件末尾 `module.exports`（现有注释已声明
"最小公共面 + 供跨文件测试断言口径一致"，新增一个常量符合既有模式），供改动 3 的
跨文件一致性测试导入。

### 改动 2 · `fix-gps.js`：审阅扫描同口径

`REVIEW_EXIF_OPTS`（第 527-532 行）做**完全相同**的改动（`gps: {}` + 同样的注释），
并加入该文件的 `module.exports`。

`readGps`（`exifr.gps()`）与两个 `readVideoMeta`（`exiftool -n`）**不动**——它们本来就对。

### 改动 3 · 新增 `test/gps-sign.test.js`（本 plan 的"根本"所在）

用 **node 内置 runner**（与 `npm run test:cli` 一致），全部落在
`os.tmpdir()` 的会话临时目录、跑完即删（S1：验证与生产数据隔离）。

1. **fixture**：`sharp` 生成 8×8 JPEG → `exiftool` 写入**南纬 + 西经**（一张同时覆盖两个
   Ref 方向）：
   `-GPSLatitude=6.1184166 -GPSLatitudeRef=S -GPSLongitude=106.6646888 -GPSLongitudeRef=W`。
2. **断言 A（绝对正确性，防"两处一起错"）**：用 `process-photos.js` 导出的配置读 fixture
   → `latitude < 0` 且 `|latitude + 6.1184166| < 1e-4`；`longitude < 0` 且
   `|longitude + 106.6646888| < 1e-4`；`GPSLatitudeRef === 'S'`。
   **用"符号 + 容差"而非逐位相等**——exiftool 各版本对有理数量化可能差末位，逐位相等
   会变成对 exiftool 版本过敏的脆弱断言。
3. **断言 B（跨文件一致性，防"只改一处"）**：用 `process-photos.js` 与 `fix-gps.js`
   **各自的配置**解析同一 fixture，断言两者结果**逐位相等**
   （`assert.equal(a.latitude, b.latitude)` 等；同一 exifr 读同一文件、配置相同则必然
   全等，任何漂移都会在这里爆）。这就是"不需抽共享模块也能锁死单一读法"的机制——与
   `test/video-support.test.js` 锁三处 `DERIVED_SUFFIXES` 同一手法。
4. **断言 C（结构断言，零外部依赖）**：断言两个配置的 `gps` 块**不含 `pick`**
   （`assert.ok(!('pick' in opts.gps))`）。这条即使 fixture 环节因环境问题受影响也能拦住
   "有人改回分块 pick"这个回归方向。
5. **缺 `exiftool` 时硬失败**（决策 ①）：在 fixture 生成处做一次前置探测，缺失时**报错并给出
   安装命令**（`brew install exiftool` / `apt-get install -y libimage-exiftool-perl`），
   不 `skip`、不降级为"部分断言"。
   **失败粒度设计**：把"探测 + fixture 生成"放进 `describe` 的 `before()` 钩子，只让依赖
   fixture 的断言 A/B 失败；**断言 C 不需要 fixture，仍照常运行并通过**——于是"环境没配好"
   会表现为 *A/B 失败 + 结构锁报绿*，一眼能分清是环境问题还是代码回归，而不是一片红。
6. 测试文件头注释写明：为什么坐标读取环节必须有控制点——**它"算错也不响"**（同
   `test/gcj02.test.js` 的主张），以及本缺陷造成 1362 km 静默偏移的真实案例。

> 不断言"旧形态会算错"——那会把缺陷锁进测试；旧形态的复现记录只留在本 plan 与
> `docs/photo-metadata.md` 的坑点表里。

### 改动 3.5 · 让 `test:cli` 真的成为门禁（CI）

**3.5a `package.json` 脚本改为版本无关写法**

```diff
-  "test:cli": "node --test \"test/**/*.test.js\""
+  "test:cli": "node --test test/*.test.js"
```

理由（本轮实测，见「`npm run test:cli` 的现状」）：CI 用 `node-version: 18.x`，而 glob
支持是 Node 较晚才进的（18 的文档只列文件/目录参数）；同时 Node 22 又**不接受目录参数**
（`node --test test/` 直接 `MODULE_NOT_FOUND`），**无参数** `node --test` 会把 `src/` 下两个
CRA jest 测试也拉进来（2 fail）。剩下唯一在 18 与 22 上都成立的写法就是**由 shell 展开**
的 `test/*.test.js`（本地已实测 30/30 通过）。
代价：`test/` 将来若出现子目录，这个 glob 不递归——届时再改（记入 `docs/toolchain.md`）。
**不升级 CI 的 Node 版本**：那会动部署链路且 agent 侧无法验证 build（见出界清单）。

**3.5b `build-deploy.yml` 的 `build` job 加两步**（放在 `Install NPM packages` 之后、
`Build project` 之前——快速失败，且测试失败即阻断 `deploy`）：

```yaml
      - name: Install exiftool
        run: sudo apt-get update && sudo apt-get install -y libimage-exiftool-perl

      - name: Run CLI tests (photos / fix-gps 等)
        run: npm run test:cli
```

`npm test`（CRA jest）那一步保留不动。两套测试互不干扰这一分工继续成立。

### 改动 4 · `src/Application/cities.js`：新增雅加达胶囊 + 调整全局视野

```js
{ name: '雅加达', lng: 106.664689, lat: -6.118417, zoom: 11 },
```

- **坐标 = 照片 EXIF 的 WGS84 值**（南纬负号不可省）。理由：高德海外不加密，GCJ02 在境外
  与 WGS84 等价，故**不需要也不应该**用国内坐标拾取器（该工具只覆盖国内）；文件头注释
  "直接填 GPS 会偏移几百米"只适用于国内，需在注释里补一句海外口径，免得后来者照抄。
- **取"照片所在点（机场）"而非市政中心**：胶囊的用途是"飞去看我的照片"，机场是该点位
  唯一有照片的地方；用市政中心会把 marker 甩到视野边缘。（若你更想沿用"城市中心"惯例，
  备选值是 Monas `106.8456, -6.2088`，届时告诉我。）
- `zoom: 11`（推荐值，决策 ②）：视野约 110 km，机场与雅加达市区同时可见；比照现有
  北京/广州（10）、南京/乌兰察布（12）。后续你可随时微调。

```js
export const GLOBAL_VIEW = { lng: 108, lat: 20, zoom: 3.5 };
```

- 依据：初始/回全局视野须同时容纳最北（乌兰察布 40.99°N）与最南（雅加达 −6.12°）。
  按 ~1440×800 视口估算，`zoom 3.5` 时纬度覆盖约 −28°~57°，两边都有余量。
- 同一条注释里的"种子值为占位示意，待用户用坐标拾取器确认/调整"也要改——海外不适用拾取器。
- **实测定稿**：最终值由你在 `npm start` 里目视微调，判定原则即上面那条（南北两端都要在框内）。

### 改动 5 · `docs/photo-metadata.md`：补第三块坑

在坐标读取小节补一张坑点表/一段说明：

- exifr 分块 pick 的**三个**坑——① 顶层 pick 会滤掉 XMP 块（必须分块）；
  ② 派生字段 `latitude`/`longitude` 只在 pick 了 `GPSLatitude`/`GPSLongitude` 时出现；
  ③ **pick 了原始标签还必须把 `GPSLatitudeRef`/`GPSLongitudeRef` 一并 pick，否则符号
  丢失且无任何报错**（南纬/西经变正值）。当前口径：**读坐标时 `gps` 块不做 pick**。
- 记录真实案例：2026-10-06 雅加达（首个南半球点位）导致 marker 偏移约 1362 km。
- 一句话说明测试兜底位置：`test/gps-sign.test.js`。

（`2026-10-03-gps-gate-hardening.md` 属决策记录，按 P1 **不改**，其未记全的部分由本
plan 与 `photo-metadata.md` 承接。）

### 改动 6 · 重生成数据（**门②，需当次明确确认**）

改完读法后需重跑一次 `npm run photos` 以修正 `src/Application/output.json`：

- **不需要 `--force`**：该脚本唯一写操作就是重写 `output.json`（`:1232`，条件为"≥1 个
  文件夹通过预检"，`:1220-1233`），`--force` 只影响派生图重建——而派生图会按
  `mtime` 增量跳过（原图未变），所以本次重跑是秒级、只改那 2 处坐标。
- 覆盖的是已提交文件 ⇒ 触发 AGENTS.md P2 **门②**，须你当次确认；
- **执行方：你在终端跑**（决策 ⑤）。跑完我按验收标准 3 做 diff 校验。
- ⚠️ 若雅加达还有未导入的照片，**先导入完再重跑**，避免跑两遍。

### 改动 7 · 推送（顺序纪律）

1. **data 仓先**：`git add photos/雅加达-苏加诺-哈达国际机场/` 并提交推送
   （派生图 + `index.json`；现为未跟踪状态）；
2. **站点仓后**：提交 `output.json` + `cities.js` + `test/gps-sign.test.js` +
   `package.json` + `.github/workflows/build-deploy.yml` + `process-photos.js` +
   `fix-gps.js` + `docs/photo-metadata.md` + 本 plan，推送
   （pre-push eslint 钩子即门禁，失败即交用户终端，不在同一回合反复重试）；
3. force-push 场景不涉及；推送前若发现并行会话痕迹（`MM`、来历不明改动），先问用户。

## 验收标准

1. `npm run test:cli` 全绿，其中新测试在**旧代码上必失败、新代码上必通过**
   （实施时可用 `git stash` 反向验证一次，可选）。
2. `./node_modules/.bin/eslint src test --ext .js,.jsx,.ts,.tsx --max-warnings=0` 通过。
3. `git diff` 校验 `output.json`：**只有**雅加达组的 `lat` 由 `+6.118416666666667`
   变为 `-6.118416666666667`（组级与照片项共 2 处），**其余 16 个点位逐字节不变**。
4. `npm run photos` **二次运行**输出与首次一致（幂等；增量跳过生效，体现为秒级完成）。
5. 本地 `npm start` 目视：① 雅加达 marker 落在苏加诺-哈达国际机场（建议切卫星图档核对）；
   ② 主地图页 17 个点位全部正常；③ 点雅加达胶囊能飞到该点，再点一次回全局视野时
   **中国与雅加达同时在画面内**（改动 4 的 GLOBAL_VIEW）。
6. 推送后：站点 `/data/photos/雅加达-苏加诺-哈达国际机场/IMG_4919_thumb.webp` 返回 200，
   Pages 部署成功。
7. **CI 门禁真实生效**：推送后 `build` job 的 `Run CLI tests (photos / fix-gps 等)` 步骤
   通过（这是 `test:cli` 进 CI 的第一次真实检验）。
8. 可选：`fix-gps.js --review` 在雅加达目录不再出现"计划可能已过期"（该目录封面已有
   坐标、无缺坐标照片，`--review` 会早退，需在隔离副本上剥坐标才可验证——不在本
   plan 验收范围内，仅记录）。

## 出界清单（本 plan 明确不做）

- **不抽共享坐标读取模块**：两个 CLI 刻意各存一份同值常量、靠跨文件单测锁一致
  （`test/video-support.test.js` 即此模式）。用"一致性测试"替代"共享模块"，既根治
  又不引入新抽象、不动既有架构决策。
- **不加运行期坐标自检**（如"读到 `Ref=S` 而 `lat>0` 就报错退出"）：读法修对后永不
  触发 = 死代码。本项目对"算错也不响"环节的既有答案是**测试控制点**
  （`test/gcj02.test.js` 开头注释即此主张）。
- **不改前端 `convertFrom` 调用**（`MapChildren.jsx` / `LightboxInfoPanel.jsx`）：
  WGS84→GCJ02 与本次符号缺陷无关，且已有官方对照测试与境外直通实测。要改属早前讨论的
  方案 C，代价与收益不匹配。
- **不升级 CI 的 Node 版本**（仍 18.x）：升级会动部署链路，而 agent 环境跑 build 必失败
  （`docs/toolchain.md`），无法在本地验证新版本下的构建。测试写法改成版本无关形式即可。
  若将来要升，另起独立改动。
- **不提交二进制 fixture**：fixture 在测试运行期用 `sharp` + `exiftool` 生成到
  `os.tmpdir()`，仓库里不留二进制。
- **不动底图海外覆盖**（用户已搁置）。
- **不改历史数据、不重写历史**：存量 17 个点位无符号差异，零影响。
- **不做体积/隐私相关动作**（与 `2026-10-04-data-repo-longevity.md` 系列无关）。

## 风险评估

| 风险 | 对策 |
|---|---|
| `gps: {}` 后预检变慢 | 基线：156 张预检 230 ms（`2026-10-03-gps-gate-hardening.md:39`）。GPS 块解析本就是主要成本，多返回少量标签预计无感；实施时实测一次并记录 |
| 不 pick 后返回结构变化影响下游 | 本轮用**真实常量**在真实文件实测：`latitude`/`longitude` 仍为十进制派生值，`DateTimeOriginal` 仍为原始字符串（`reviveValues:false` 保留），`Make` 不变 |
| 新测试依赖 `exiftool`（与 `sharp`） | 二者均为项目硬依赖（S3：假设已存在）。缺失时**硬失败**并给安装命令（决策 ①）；CI 侧显式安装（改动 3.5b） |
| `test:cli` 脚本写法与 Node 版本耦合 | 已实测三种写法，选定 shell 展开的 `test/*.test.js`（Node 18/22 均可用）；`test/` 将来有子目录需再调整，已记入 `docs/toolchain.md` |
| CI 首次跑 `test:cli` 暴露既有问题 | 推送前先在本地跑一遍拿基线（本轮：30/30 通过），确保新增的只有本 plan 的测试 |
| 重跑 `npm run photos` 覆盖 `output.json` | 门② 确认 + 验收标准 3 的 diff 校验；HEAD 版本在 git 里可回溯；脚本只写这一个文件 |
| 并行会话同时改本 repo | 提交前重看 `git status` / `git diff`（警惕 `MM` = 暂存的是旧版）；推送前即时 `git ls-remote origin main` 比对 |
| agent 环境推送不稳定 | 先实际推一次；失败（SIGTERM/超时）即停手交用户终端，不在同一回合反复重试 |

## 实施顺序

1. 改动 1 + 改动 2（两处读法，含注释与 exports）
2. 改动 3（新测试 `test/gps-sign.test.js`）
3. 改动 3.5（`package.json` 脚本 + `build-deploy.yml` 两步）
4. `npm run test:cli` + `eslint src test --ext .js,.jsx,.ts,.tsx --max-warnings=0`
5. 改动 4（`cities.js`：雅加达胶囊 + `GLOBAL_VIEW`）
6. **门②**：**你**在终端跑 `npm run photos` → 我做验收标准 3 的 diff 校验
7. 改动 5（`docs/photo-metadata.md` 坑点表）
8. 本地 `npm start` 目视（验收标准 5）
9. 推送：data 仓 → 站点仓（改动 7）
10. 本 plan 状态行改为「已实现」，回填实测数字（保留不删，P1）

## 实现记录（2026-10-06）

### 改动落地（`git status`）

| 文件 | 结果 |
|---|---|
| `process-photos.js` | `PREFLIGHT_EXIF_OPTS` → `gps: {}` + 注释；常量加入 exports |
| `fix-gps.js` | `REVIEW_EXIF_OPTS` → `gps: {}` + 注释；常量加入 exports |
| `test/gps-sign.test.js` | 新增（断言 A/B/C，fixture 用 sharp + exiftool 现造到 `os.tmpdir()`） |
| `package.json` | `test:cli` → `node --test test/*.test.js` |
| `.github/workflows/build-deploy.yml` | `build` job 加「Install exiftool」+「Run CLI tests」两步（在 `npm install` 后、`build` 前） |
| `src/Application/cities.js` | 雅加达胶囊（`zoom:11`、南纬负号）+ `GLOBAL_VIEW = { lng:108, lat:20, zoom:3.5 }` + 文件头海外坐标口径 |
| `src/Application/output.json` | 由用户跑 `npm run photos` 重生成（见下） |
| `docs/photo-metadata.md` | 「前端解析配置的坑」补第三块坑 + 新增「南纬符号丢失实例与测试兜底」节 |
| `docs/toolchain.md` | 「CLI 脚本的单测」更正 `test:cli` 写法（三种写法实测表 + 沿革 + 不递归子目录的代价） |

### 验收实测

- **`npm run test:cli` → 33/33 通过**（原 30 + 新增 3）；`eslint src test --ext .js,.jsx,.ts,.tsx --max-warnings=0` **零 warning**
- **导出常量实读雅加达原图**（`require('./process-photos').PREFLIGHT_EXIF_OPTS`）→
  `lat = -6.118416666666667`、`GPSLatitudeRef = 'S'`、`DateTimeOriginal` 仍为原始字符串
  （`reviveValues:false` 未被破坏）、`Make` 不变
- **新测试在旧读法下必红**（在 `/tmp` 隔离副本上还原旧 pick 跑的，工作区未动）：
  断言 A 报 `南纬应读成负值，实际 6.1184166`、断言 C 报结构违规，而**断言 B 通过**——
  两处"一起错"时它必然相等；这正印证三条断言分工：**B 管"只改一处"、A 才是"两处一起错"
  的兜底**
- **`output.json` diff 校验通过**：`21 insertions / 0 deletions`（纯新增雅加达组，唯一
  hunk），组级与照片项 2 处 `lat` 为 `-6.118416666666667`，**其余 16 个点位逐字节未动**
- **`npm run photos` 幂等**：脚本唯一写操作是重写 `output.json`；本次为秒级（增量跳过
  生效），产出即带正确符号（非事后修补）
