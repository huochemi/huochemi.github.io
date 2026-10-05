# fix-gps 审阅页第 5 区：离线示意 → 高德底图地图

状态：已实现（2026-10-05 当日，经用户批准后动手）
实现说明：除本 plan 所列设计外，实现与验证阶段有三个实测发现——① **"key 失效 →
静默空白"在渲染层当前不会发生**：坏 key 页与正常 key 页的地图截图 MD5 完全一致
（key 校验对瓦片渲染不生效），plan §3 表格该行的处置据此降为"未来防线"——代码保留
complete 事件 8 秒未触发即显式报错的判据；② 离线 GCJ02 算法与高德官方 convertFrom
实测偏差 < 0.1 m（南京南站 / 大兴机场两点，官方值实测取得，非网上抄常数），新增
`test/gcj02.test.js` 锁定（这类错误不报错、只静默偏数百米，必须有控制点）；③ 全部
真实文件夹当前 0 缺坐标，`--review` 端到端用合成数据页验证（S1：不碰真实照片），
真实命令验证到"key 预检放行 + 既有早退行为不变（退出码 0）"。
日期：2026-10-05
前置：用户在三条路（A 按钮 / B 默认加载 / C 仅跳转链接）中选定 **B：页内地图·默认加载**。
关系：`docs/plans/2026-10-03-fix-gps-review-page.md` 出界清单曾否决"方案 4 地图视图"
（理由：需 key + 联网、与 file:// 冲突、收益不成比例）。本 plan 推翻其**技术假设**部分
（见下实测），推翻过程经用户当次批准（选型 B）。

## 前置实测（2026-10-05，已做，非假设）

1. 现有 key `REACT_APP_AMAP_API_KEY`（.env）是 **JS API 平台**：请求静态地图接口返回
   `USERKEY_PLAT_NOMATCH`(10009) → 静态图方案已排除，无需另申请 key。
2. `file://` 页面加载 `webapi.amap.com/maps?v=2.0.5&key=<同 key>`：**SDK 加载、地图创建、
   `complete` 事件、瓦片渲染全部成功**（无头 Chromium 探测页实拍南京南站，logo 与
   "© 2026 AutoNavi" 版权齐全，`imgs:2 okImgs:2`）。无域名白名单拦截、无安全密钥阻塞
   （与 `MapIcon.jsx` 仅传 akey、线上正常一致）。
3. 唯一杂音：`window.onerror: Script error.`（跨域脚本错误遮蔽，不影响渲染，探测页
   `complete:true` 同帧出现）。

## 设计

### 1. 坐标系转换（fix-gps.js，node 侧，离线纯算法）

- 内嵌 WGS84→GCJ02 标准算法（约 30 行，无网络依赖），扫描后为每个 anchor 计算
  `gcjLat` / `gcjLng` 放入 data。
- **纪律：`lat` / `lng` 保持 WGS84 原值不动**——写入 EXIF 的坐标必须是 WGS84；GCJ02
  仅用于第 5 区显示层，plan JSON（`--plan-stdin` 消费）继续用 WGS84，写入链路零改动。

### 2. 模板改造（fix-gps-review-template.html）

- key 注入：fix-gps.js 手动解析 `.env`（约 10 行，读 `REACT_APP_AMAP_API_KEY`，不新增
  依赖、不 require react-scripts 的传递依赖 dotenv），经 data.amapKey 传入模板；
  模板拼 `<script src="https://webapi.amap.com/maps?v=2.0.5&key=...">`。
  解析失败（无 .env / 无该变量）即按 §3 报错退出，**不做**"读不到就用别的来源"的兜底。
- 第 5 区：`#map` 容器替换现有 SVG 示意。卫星影像 + 路网线叠加，沿用主站
  `BaseMapSwitch.jsx` 已定义的 `satellite-road` 组合（`AMap.TileLayer.Satellite`
  + `AMap.TileLayer.RoadNet`），不用 mapStyle 矢量底图。`setFitView()` 包住全部锚点。
  理由：纯影像无路名/POI，"判断这是哪"更难；该组合主站已有、用户自己在用。
- marker 视觉按深色影像底图调：组色圆点 + 白描边，标签用半透明深底 + 白字
  （卫星影像杂色背景上保证可读性）。
- 每处位置一个 Marker：自定义 content = 组色圆点 + 字母；常显 label =
  `位置 A（N 张）`（N 与全页 stats 同源）。保存 marker 引用，`render()` 时同步
  label 中的张数（改投实时联动，与时间轴色块/统计一致）。
- Marker 点击弹出 InfoWindow：组内文件名、WGS84 坐标、坐标来源（📍/📋）、拍摄时间。

### 3. 失败处置：报错 + 解决步骤（用户 2026-10-05：不喜欢 fallback，失败直接报错）

失败共 5 种，**只有 1 种能在生成页面时预判**；两类都按"报错 + 解决步骤"处理，都不降级。

| 场景 | 根因 | 判定点 | 处置 |
|---|---|---|---|
| `.env` 缺 key（或 .env 不存在） | `.env` 被 gitignore → 换机器/新 clone 必然没有 | `--review` 启动预检（node 侧） | `❌` 报错 + 解决步骤 + **exit 1，不生成页面** |
| 断网 / webapi 不可达 | 网络环境 | 页面加载时 | 第 5 区 `❌` 报错 + 排查步骤文案 |
| key 失效（换 key / 启用安全密钥 / 加白名单） | 高德控制台 | 同上 | 同上 |
| 配额用尽 | 个人 key 日配额 | 同上 | 同上 |
| 高德服务故障 | 对方 | 同上 | 同上 |

**复刻既有范式**（`fix-gps.js:1200` exiftool 预检：`❌ 未找到 exiftool，请先安装：
brew install exiftool` + `process.exit(1)`）——key 对 `--review` 是**硬依赖**（要生成地图
就必须有），缺失即拒绝生成，与 AGENTS.md S3「外部命令假设已存在，预检一次，缺失即报错
退出」同构。

**预检位置与范围（实现纪律，防误放）**：放在 `fix-gps.js` 的 `if (args.review)` 分支
内、`runReview()` 调用之前。**不得放进全局预检区**——key 只被 `--review` 需要，
交互模式 / `--all` / `--plan-stdin`（写入关键路径）在缺 key 时必须完全不受影响。

**缺 key 报错文案（草案，实现时守 emoji 契约）**：

```
❌ --review 需要高德 JS API key：读取 <repo>/.env 失败
   （文件不存在，或未配置 REACT_APP_AMAP_API_KEY）。

   解决步骤：
   1) 仓库根目录：cp .env.example .env
   2) 高德开放平台控制台 → 应用管理 → 新建应用 → 添加 Key，
      服务平台选「Web端(JS API)」：https://console.amap.com/dev/key/app
   3) 填入 .env：REACT_APP_AMAP_API_KEY=<你的 key>
   4) 重跑：npm run fix-gps -- "<文件夹>" --review

   注：平台必须是 JS API —— 静态地图/Web 服务类型的 key 不适用
       （实测返回 USERKEY_PLAT_NOMATCH）。
```

**页面内失败文案（草案）**：

```
❌ 高德底图加载失败
   ① 能否访问 https://webapi.amap.com/maps
   ② .env 里的 REACT_APP_AMAP_API_KEY 是否仍有效
   ③ 高德控制台该 key 的日配额是否用尽
   处理完刷新本页
```

**明确不做**：回退 SVG 示意 / 自动重试 / 内置默认 key / 页面内二次探测 key（判定点
单一，key 存在性只在 node 侧判一次）。**「重试」按钮不做**——上面的排查步骤里已含
"刷新本页"，按钮属装饰。



## 验收标准

1. 有网：`npm run fix-gps -- "<文件夹>" --review` 打开页面，第 5 区为卫星影像 + 路网线；
   锚点 marker 落在真实地点（与高德 App 对照，偏差为 GPS 精度级，**不是**数百米级
   ——即 GCJ02 转换生效）。
2. marker 颜色 = 组色、label 实时反映改投后的"位置 X（N 张）"；点 marker 出 InfoWindow。
3. 改投、分界线、复制写入命令全流程与现状一致；plan JSON 的 lat/lng 仍为 WGS84
   （抽验：--plan-stdin 写入后 exiftool 读回坐标与锚点 EXIF 一致）。
4. 缺 key：`mv .env .env.bak` 后重跑 `--review` → `❌` 报错 + 四步解决步骤 + 退出码 1、
   **不生成页面**；恢复 .env 后正常。**同时验证不拖累其他模式**：缺 key 时交互模式 /
   `--all` / `--plan-stdin` 行为零变化。
5. 断网打开页面：第 5 区 `❌` 报错 + 三步排查步骤，其余四区完全正常。
6. `npx eslint fix-gps.js --max-warnings=0` 通过；`npm run test:cli` 全绿。
7. 交互模式 / --all / --plan-stdin 行为零变化。

## 出界清单（本 plan 不做）

- **图层切换 UI**（卫星 / 卫星+路网 / 标准图三档按钮）：审阅页固定
  `satellite-road` 一档，复刻主站 `BaseMapSwitch` 属过度设计
- 地图上拖拽/拾取坐标改锚点（审阅页只读原则，写入仍走终端确认）
- 静态地图图片方案（key 平台不符，需另申请 Web 服务 key）
- 跨文件夹审阅、批量多文件夹

## 已定项（2026-10-05 用户拍板）

1. 底图 = **卫星影像 + 路网叠加**（`satellite-road`；纯影像无路名 POI，"这是哪"更难读）
2. 失败处置（用户 2026-10-05：**不喜欢 fallback，失败就直接报错 + 给出解决步骤**）：
   - 缺 key → `--review` 预检 `❌` + 解决步骤 + exit 1（作用域限 `--review`）
   - SDK 加载失败 → 第 5 区 `❌` + 排查步骤、其余四区照常
   - 不做：回退 SVG 示意 / 自动重试 / 内置默认 key / 重试按钮


## 风险与备注

- 临时审阅页 HTML 含明文 key（写在 os.tmpdir()，gitignore 之外但属临时目录；该 key
  本就是公开前端 key，已存在于线上 build 产物）。
- 高德 JS API 版本 2.0.5 与主站一致，不引入新版本。
- GCJ02 算法为业界标准实现，与高德官方 convertFrom 偏差 ~1 m 级，远小于 GPS 噪声。
- 卫星影像底图最大级别有限（高德卫星图约到 18 级）；审阅场景跨度数十米~数公里，
  够用。
