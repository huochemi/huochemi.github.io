# 照片元数据（photo-metadata）

`process-photos.js` / `fix-gps.js` 如何读写照片 EXIF 元数据：**坐标口径、坐标溯源、
拍摄设备分类**。管线机制（HEIC 转码、派生图档位、删除照片、一致性报告）见
`data-pipeline.md`；"为什么缺坐标算未完成"这类产品定义见 `photo-workflow.md`。

## GPS 坐标缺失策略（2026-10-03 重写）

决策记录：`docs/plans/2026-10-03-gps-gate-hardening.md`。

### 判定：组内任一张缺坐标 ⇒ 该文件夹整体不产出

- `process-photos.js` 把每个文件夹拆成**预检**与**生成**两段；**从双根扫描到全部预检
  结束，全程零写操作**（2026-10-05 起真无条件成立——见
  `plans/2026-10-05-photos-no-empty-dir.md`）：读 `index.json` + 对全部图片做一次 EXIF
  解析（实测 156 张约 220ms，占整轮 2% 量级）；生成阶段复用这份元数据，不重复读 EXIF
- 预检失败判据（任一命中即失败）：缺 `index.json` / JSON 非法 / 未指定
  `index_photo` / **`description` 缺失或非字符串**（必填契约，空串合法；见
  `plans/2026-10-05-new-place-scaffold.md`）/ 无图片文件 / 封面文件不存在 /
  **组内任一张缺坐标（含封面）**
- 失败粒度：**失败的文件夹跳过、其余文件夹照常产出**，退出码 `1`；`[跳过]` 汇总
  逐个列出原因与下一步命令（缺坐标时给出可直接粘贴的 `fix-gps` 命令）
- 预检排在一切写操作之前，所以失败的文件夹**一张派生图都不会留下**（2026-10-03
  之前的实现是"先写完派生图、最后才校验封面"，失败时留下半成品且污染兄弟文件夹）
- **全部文件夹都失败时不覆盖 `output.json`**（否则会把已发布数据清空），只报错退出
- 前端不再有坐标回退：`flattenPhotos` 直接取 `photo.lat/lng`，缺坐标的项不进
  marker 列表并 `console.error`。**绝不能让 `undefined` 进 `AMap.convertFrom`**——
  坐标数组里任一元素非法可能让整批 marker 都不渲染，故必须过滤后再进数组

### 前端解析配置的坑（改 pick 前必读）

预检用**分块 pick**：`ifd0: { Make, Model }` / `exif: { DateTimeOriginal }` /
**`gps: {}`（GPS 块刻意不做 pick）**。三点实测结论：

- **不能用顶层 `pick`**：它会把 XMP 块一并滤掉，而分块 pick 才能精确定位到各块
- **`exif.latitude` / `exif.longitude` 这两个十进制派生字段只在同时 pick 了
  `GPSLatitude` 与 `GPSLongitude` 时才出现**；只 pick 其中一项会读不到坐标，
  表现为"全部照片都缺坐标"
- **pick 了原始标签，还必须把 `GPSLatitudeRef` / `GPSLongitudeRef` 一并 pick**，
  否则派生值 `latitude` / `longitude` **静默丢失符号**（南纬/西经读成正值），且全程
  无任何报错。⇒ 当前口径：**读坐标时 GPS 块不做 pick**，由 exifr 自己按 Ref 派生——
  正确性不再依赖"调用方记得带上 Ref"这条只写在注释里的隐式契约（第三块坑的真实
  实例见下节）

### 南纬符号丢失实例与测试兜底（2026-10-06）

- **真实案例：雅加达（首个南半球点位，苏加诺-哈达国际机场）**。原图 EXIF 写作
  `6°7'6.30" S`（`GPSLatitudeRef: South`），管线却产出 `"lat": 6.118416666666667`
  ⇒ marker 被钉到北纬 6.118°（南海西南海面、马来西亚外海约 100 km），**静默偏移约
  1362 km**。此前 17 个点位全在北纬东经、符号无差异，故历史数据从未暴露该缺陷
- 决策记录与完整取证（五通道对比、根因、出界清单）：
  `docs/plans/2026-10-06-gps-sign-loss-and-jakarta.md`
- **测试兜底**：`test/gps-sign.test.js`（随 `npm run test:cli` 跑，已进 CI）——三条
  断言：**绝对正确性**（防两个读取点一起错）、**跨文件一致性**（`process-photos.js` 的
  `PREFLIGHT_EXIF_OPTS` 与 `fix-gps.js` 的 `REVIEW_EXIF_OPTS` 对同一 fixture 必须逐位
  相同，防只改一处）、**结构锁**（两个配置的 GPS 块不含 `pick`，防有人改回分块 pick）。
  fixture 由 `sharp` + `exiftool` 在 `os.tmpdir()` 现造，仓库不留二进制

### 前置步骤：`npm run fix-gps`

- **补坐标工具 `fix-gps.js`**（入口 `npm run fix-gps`；通道由**脚本名或裸 flag** 选：
  `fix-gps:anchor`（= 裸 `--anchor`）/ `fix-gps:track`（= 裸 `--track`），两者**互斥**，
  判定点唯一 = 出现 `--track` 即轨迹路）：两条**互斥的补坐标通道**——① 锚点路（默认，
  本处）从同文件夹内**手机**照片（原生 GPS）复制坐标；② 轨迹路（`--track`，2026-10-07
  新增，原名 `--gpx`）按拍摄时刻在轨迹上插值，见下条。两条通道都写同一个溯源标记
  （`GPSProcessingMethod`）、都写入目标原图 EXIF（exiftool
  `-overwrite_original`，依赖 `brew install exiftool`，缺失即报错退出不兜底），写入后
  立即重读校验。锚点路会并排预览两张照片辅助确认
- **手动指定参照**（2026-09-27 新增）：自动推荐不合适时，改用 `--target 目标文件名
  --ref 参照文件名` 点名参照（`--yes` 跳过确认）。约束：仅限同文件夹、目标必须缺
  GPS（已有 GPS 不做覆盖）、参照必须有 GPS，不满足即报错退出。自动推荐与可用参照
  清单会打印在按键提示上方，无需查文档；无参照时提示先放入一张附近拍的照片再重跑。
  ⚠️ **`--ref` / `--target` 是大小写敏感的精确匹配**（`r.fileName === args.ref`）：
  传 `IMG_5815.jpg` 匹配不到实际文件 `IMG_5815.JPG`，会报"未找到"——复制命令时保留
  原始大小写
- **轨迹路（`npm run fix-gps:track -- 文件夹`，2026-10-07 新增）**：读目录内的 `.gpx`
  轨迹（Apple Watch「户外步行」导出，**同目录只能有 1 个**，多个即报错要求处置、不猜选），
  按拍摄时刻在轨迹上线性插值取坐标写入缺坐标的照片。时区**自动判定**（用目录内**原生
  坐标**的手机照交叉验证：枚举整数小时，取"落入轨迹时间窗的照片最多、并列时平均残差
  最小"者），`--tz +8 / UTC+8 / +5:30` 可覆盖；**无原生手机照可校准 → 报错要求显式
  `--tz`**（不静默推导）。
  **能补就补**（2026-10-07 修订）：窗内的写、窗外的**逐张打印后跳过**，**不整体失败**
  ——轨迹只覆盖"按下记录"之后的时段，窗外是日常现象（手表晚按几分钟才开始拍、或拍完
  才结束记录），不是错误。收尾会把窗外那批连同可复制的一行锚点路命令再打印一次。
  **退出码语义**：窗内有内容写入、或本就无事可做 → `0`；**有待补照片但一张都写不了**
  （全部落窗外）→ `1`（这不是普通失败，而是"这条轨迹覆盖不到这批照片"，多半是轨迹
  选错或时区判错）。安全性不靠"整批闸门"：时区判错由**时区判据自己**拦（calibrators
  为空 / 没有任何整数小时偏移能把手机照放进窗内 → 报错）。这与锚点路"部分目标已带坐标
  就跳过那些、写其余"一致，也使"窗内走轨迹、窗外走锚点"能在同目录先后跑完、无需挪文件
- **轨迹审阅页（`npm run fix-gps:track -- 文件夹 --review`，2026-10-07 新增）**：
  高德底图 + 轨迹折线 + 按拍摄时间编号的落点 + 手机锚点照（唯一外部真值）；可在图上
  **排除**某几张（落点明显不对时）后「复制写入命令」，计划 JSON 带 `mode:"gpx"`，回终端
  `--plan-stdin` 一次写入。模板 `fix-gps-track-review-template.html`
- **分组审阅页**（锚点路，2026-10-03 新增，2026-10-04 补同位置合并与清理）：锚点落在多处时
  （如"南京南站附近1"5 张锚点落 2 处），`npm run fix-gps:anchor -- 文件夹 --review` 生成
  只读 HTML 到临时目录并打开（模板 `fix-gps-review-template.html`，页面按拍摄时间
  铺开、GPS 状态标识、点图与所属位置代表并排对照）。**相距 < 5 米的锚点自动合并为
  一处**（`ANCHOR_MERGE_METERS`，判据与 `process-photos.js` 的同名常量必须一致），
  组代表取组内最早拍摄的那张，plan 的 `ref` 用代表——连拍多张手机照不再各自成组。
  写入入口只有一条：页面「复制写入命令」给出一行
  `echo '<单行 JSON>' | npm run fix-gps -- "<文件夹>" --plan-stdin`（JSON 与命令同一
  次复制，避免剪贴板单槽竞争；`--plan <file>` 文件入口已于 2026-10-04 移除）。
  ⚠️ **`--plan-stdin` 用通用入口 `fix-gps`，不带 `:anchor` / `:track`**——通道由计划
  JSON 自带的 `mode` 字段判定（判定点唯一，见下），命令行再指定通道会被拒绝
  （`--plan-stdin` 与 `--anchor` / `--track` 互斥）。两条路导出的计划走**同一个**写入入口。
  写入前的安全校验：**参照实际 EXIF 坐标必须与计划 JSON 内坐标一致**（偏差
  > 0.0001 度即拒绝，防页面开着太久、参照被改后写入过期计划）；目标已带坐标自动
  跳过（幂等续作）；写入仍走 writeGps 的逐张验证。页面上照片分三态（见「锚点池判据
  与三态 kind」节）= `anchor`（有坐标的**手机**照，📍 原生 GPS / 📋 复制坐标；可作参照）/
  `target`（→ 待补）/ `done`（**✅ 灰色只读条**：已带坐标的**非手机**设备，点不开、
  不进分组、不进写入计划）
- 没跑 `fix-gps` 就跑 `npm run photos` 会在**启动阶段（约 0.2 秒）**被拦住：缺坐标的
  文件夹直接跳过并报错，不会等到生成完毕才失败、也不会留下半成品

## 坐标溯源 geoSource（2026-10-03 新增；2026-10-07 加 `mode=` 维）

目的：区分"照片自带的原生坐标"与"补来的坐标"，并回答两个问题——「这张照片的坐标是
哪张锚点给的、锚点选错没有」+「它是走哪条通道补的」。之前两者在数据里长得一模一样。

### 写入（fix-gps.js）

- 写入（复制或插值）坐标时同时写标准 EXIF 标签 `GPSProcessingMethod`，值形如
  `hcm-geosource mode=anchor ref=IMG_5815.jpg date=2026-10-03`（锚点路）/
  `hcm-geosource mode=gpx ref=Walking 2026-10-06T112533Z.gpx date=2026-10-07`（轨迹路）
- 前缀 `hcm-geosource` **必需**：相机会自己写该标签（如 `GPS` / `Apple`），
  没有前缀就无法区分原生与复制
- **`mode=` 记录坐标来自哪条补坐标通道**（2026-10-07 新增，决策 ⑤）：取值只有
  `anchor`（从手机照复制）与 `gpx`（按拍摄时刻在轨迹上插值）两种，将来要细分再加
  （加维是向后兼容的增量）。⚠️ **`gpx` 是持久化契约，不随命令行参数改名**——CLI 的
  `--gpx` 已改名为 `--track`（2026-10-07，理由：通道名从"数据格式"改成"数据实体"），
  但 EXIF 里仍写 `mode=gpx`，已写入的原片不需要、也无法回填。写入端由 `GEO_MODES`
  白名单拦住拼写错误——一旦写进原片 EXIF 就要逐张重写才能改，不给"写进去再发愁"的机会
- **不再复制 `GPSHPositioningError`**：它是参照照片那次定位的误差（本次锚点实测
  52.3 m），照搬等于让相机照声称拥有手机的定位精度，而真相是"同址推断"；
  留空表示精度未知（宁缺毋假）
- **写入端一律带 `-n`（海拔保真，2026-10-07 补齐）**：exiftool 复制 / 赋值 rational
  标签时，不加 `-n` 会走**打印格式**，把 `GPSAltitude` 截成一位小数（实测
  `69.84174921` → `69.8`）；而经纬度走的是另一条保真通路、完全不受影响 ——
  「经纬度对、海拔被削」这种半边损失不报错、不警告、肉眼也看不出来。锚点路
  `writeGps()` 原先漏了 `-n`（轨迹路 `writeGpsFromTrack()` 一开始就有），使两条通道的
  海拔精度差 7 个数量级（轨迹源 GPX 的 `<ele>` 是 14 位小数）。口径定为**写入端保真、
  舍入留给展示层**：原片 EXIF 写入不可回溯，截断无法恢复；保真后想显示一位小数，
  消费者 `toFixed(1)` 即可。控制点见 `test/gps-altitude-precision.test.js`——含
  "不加 `-n` 必然截断"的**反面证据**，将来谁把 `-n` 删掉，那条会连同结构锁一起变红

### 字段选型是实测结果（2026-10-03，在 /tmp 副本上验证）

| 候选 | 结论 |
|---|---|
| 自定义 XMP 命名空间 | ❌ exiftool 拒绝写入（`Tag 'XMP-hcm:...' is not defined`），需用户级 `~/.ExifTool_config` |
| `XMP-exif:UserComment` | ⚠️ exiftool 可写、JPEG 能读，但 **exifr 完全读不到 HEIC 的 XMP**（`xmp:true` 返回 undefined）→ 现状数据含 48 张 HEIC，会静默丢溯源 |
| **`GPSProcessingMethod`（采用）** | ✅ 语义即"坐标是怎么定位出来的"；exifr 能从 JPEG 与 HEIC 的 GPS 块**同一次解析**读到 |

### 读取（process-photos.js）

- 由预检的同一次 `exifr.parse` 一并取回，不额外读盘
- 该标签是 EXIF `UNDEFINED` 类型：**前 8 字节是字符集标识**（`ASCII\0\0\0` 或
  `UNICODE\0`），其后才是正文；exifr 原样返回字节，由 `decodeUndefinedText()` 解码
  （UNICODE 按 UTF-16 小端还原——exiftool 写非 ASCII 值走这条路径，实测中文文件名
  可完整往返）
- `output.json` 每张照片新增 `geoSource`：**无该字段 = 原生坐标**；有 = 补来的坐标，
  值为参照文件名（锚点文件名或 `.gpx` 文件名）；标记存在但参照名不可解析 →
  `'unknown'`（绝不能误判成原生）
- **`geoSource` 的返回形态不随 `mode=` 改变**（仍是字符串或 undefined）：解析走
  `parseGeoTag(raw) → { mode, ref } | undefined`，`parseGeoSource(raw)` 只是
  `parseGeoTag(raw)?.ref` 的薄封装，两脚本各一份（刻意不抽共享模块），由
  `test/geo-provenance.test.js` 锁两处同结果
- **`output.json` 不新增 `geoMode` 字段**（2026-10-07 用户拍板）：它是可从
  `geoSource` 推导的冗余副本、且无消费者（前端 `src/**` 既不消费 `geoSource` 也不
  消费 `geoMode`）；将来需要时解析 `geoSource` 即得，不存在"现在不存以后补不了"。
  `geoMode` 只是 `process-photos.js` 内部收尾汇总用的临时量，不落进 JSON
- **缺 `mode=` ⇒ 读作 `anchor`**（2026-10-07 加 `mode=`）。**这不是 fallback，是准确
  的历史陈述**：溯源标记 2026-10-03（提交 `236d984`）引入、`mode=` 2026-10-07 才加，
  中间写入的全部坐标只可能来自锚点这一条通道（GPX 通道当时还不存在），且那些照片
  无法回填（要逐张重写原片 EXIF）。该理由与代码注释、本文件同处留存
- **历史数据无法回填**：2026-10-03 之前已补过坐标的 11 个文件夹没有标记，只能表现
  为"原生坐标"；本字段只对之后写入的坐标有效

## 锚点池判据与三态 kind（2026-10-07）

决策记录：`docs/plans/2026-10-07-gpx-coordinate-channel.md`。补坐标入口从"一条路"
变成"两条互斥通道"（锚点复制 / GPX 插值）后，**"哪些照片能当坐标提供方"的判据
必须换掉**——否则第一条路修好的相机照会在第二条路里充数当锚点，让两条通道互相污染、
结果与执行顺序相关。

### 判据：设备维度，而非"有没有坐标"

三态取代原来的二态（原来的判据只看"有没有坐标"）：

| 状态       | 判据                                    | 在审阅页的角色                       |
| -------- | ------------------------------------- | ------------------------------ |
| `anchor` | `classifyDevice === 'phone'` **且**有坐标 | 可被选作参照的坐标提供方                   |
| `target` | **无坐标**（不论设备）                          | 待补坐标的待办                        |
| `done`   | 有坐标 **且** 设备不是手机                        | **只读灰色历史条，无任何交互控件**（2026-10-07 新增） |

⚠️ `done`（已补过坐标的相机照）**既不能进锚点池**（会污染另一条通道），**也不能进
待办**（已修好）。第一条路跑完后，它的产物在第二条路的页面里必须**可见但不可选**。
前端 `src/**` 不消费 `geoSource`、也不消费逐张 `lat/lng`，故两条通道共存对线上展示零影响。

### 未知设备 = 硬错（fail first / fail early）

扫描阶段只要有一张照片 `classifyDevice` 返回 `null`，`fix-gps.js` 立即报错退出（退出码
非 0），报错内容含：**文件名 + 原始 `Make`/`Model` + 去哪加映射**
（`process-photos.js` 的 `PHONE_MAKES` / `CAMERA_MAKES`，**并提示 `fix-gps.js` 也有一份
副本要同改**）。刻意**不留 fallback**——未知品牌默默降级只会让问题推迟暴露。
`process-photos.js` 口径不同：未识别**不作参照**、但只报告不中断（"宁缺毋假 + 报出来"，
与它既有的 `device` 未识别降级一致），两处判据分别由各自收尾汇总显式报出。

### 混合点位下"点位坐标 = 封面坐标"是偶然的（已知性质，不改口径）

- 排他粒度是**照片级**（同一张照片不被两条通道各写一次），**不是目录级**——同一点位内
  两路并用是**合法状态**（轨迹只覆盖录制时段，窗口外只能借锚点）
- 点位坐标仍取封面照片坐标（`process-photos.js`）。混合点位里**换封面会让 marker 移动**
  （封面若是锚点路的照片，marker 落在该锚点处；若是 GPX 路插值的照片，落在轨迹上）——
  这是已知性质，**不改口径**；`npm run photos` 收尾对含 ≥2 种来源的点位打印一行提示
  （**只报告、不阻断构建**）提醒此事

## GPX 轨迹的时间口径（2026-10-07）

GPX 轨点时间是 **UTC 瞬时**（如 `2026-10-06T11:25:33Z`），而照片 EXIF 的
`DateTimeOriginal` 是**当地墙上时间**（**不含时区**）。插值前必须把后者换算成可比瞬时：

- `wallTimeToEpoch(wallIso, offsetHours)`：**显式补 `Z`** 把墙上时间读成 UTC 得到
  "伪 epoch"，再减 `offsetHours * 3600000`（墙上时间 = UTC + offset ⇒
  UTC = 墙上时间 − offset）
- ⚠️ **不能让 `Date.parse` 自己解释无偏移串**：它按**运行机器的本地时区**解释，结果会
  随机器环境漂移（同一份数据在不同机器上插出不同坐标）。必须显式补 `Z` 再减偏移。
  这是本轮亲手踩过的坑（轨迹点被多加 8 小时 → 所有照片看似落在窗口外），已写进
  `test/gpx-track.test.js` 的用例注释
- **时区偏移自动判定**：枚举整数小时 `h ∈ [-12, +14]`，判据 = **①使落入轨迹时间窗的
  照片最多、②并列时平均残差最小**；判定结果显式打印依据，`--tz` 可覆盖；**没有可用于
  校准的原生手机照时报错退出、要求显式 `--tz`**（不静默推导）。信噪比：步行速度下
  1 小时 ≈ 1584 m，远高于 GPS 噪声（30–50 m）⇒ 可自动定准；而相机时钟 30 s ≈ 42 m，
  与噪声同量级 ⇒ **不做自动标定**（改用"全部照片是否系统性偏向轨迹同一侧"的可见性提示）
- ⚠️ **不要按经度推时区**（`round(lon/15)`）：中国全境统一 UTC+8，乌鲁木齐经度 87.6°
  会被推成 UTC+6，必然出错

## 拍摄设备类型 device（2026-09-30 新增）

决策记录：`docs/plans/2026-09-30-photo-device-badge.md`（图标呈现方式的修订见
`docs/plans/2026-09-30-photo-device-badge-svg-icon.md`）。用途：抽屉网格缩略图角标
显示手机 / 相机图标，**只放图标、不放品牌型号文本**（角标空间有限）。

### 字段定义

- 每张照片可有 `device: 'phone' | 'camera'`；**无法判定时不写该字段**（宁缺毋假，
  与 `lat` / `takenAt` 同惯例，前端 `filter(Boolean)` 自动省略）
- **组级对象不写** `device`：实测存在混机文件夹，组级单一值表达不了真实情况
- 存的是**语义枚举**，不是 emoji——emoji 属展示层，数据层不耦合呈现形式
- 必须走管线才能拿到：缩略图与展示图是 sharp 生成的 WebP，**EXIF 已被抹掉**，前端
  拿不到；HEIC 的 EXIF 由 exifr 直接读（见 `data-pipeline.md` 的 HEIC 小节）

### 提取与分类

- 与 `DateTimeOriginal` **共用同一次 `exifr.parse`**（分块 pick：
  `ifd0: { Make, Model }` + `exif: { DateTimeOriginal }` + `gps: {}`，
  见上文"前端解析配置的坑"），不额外多读一遍 EXIF
- `classifyDevice(make, model)` 按顺序命中即返回（规则与两张品牌表
  `PHONE_MAKES` / `CAMERA_MAKES` 均在 `process-photos.js` 内）：

  1. `Model` 匹配 `/xperia/i` → `phone`
     （**SONY 既产相机又产手机**，品牌表无法区分，故用 Model 级特例优先判定）
  2. `Make`（trim + 转小写）∈ `CAMERA_MAKES` → `camera`
  3. `Make` ∈ `PHONE_MAKES` → `phone`
  4. 其余 → 不写字段

- **不能用文件名前缀推断**（已否决方案）：`DSC*` = 相机、`IMG_*` = 手机只是当前
  数据的巧合，换机或改名即失效；完整反例与论证见 plan 的「否决 B」

### 未识别时的降级

- 逐张**静默**不写 `device`（角标少一个图标，不报错、不中断）；收尾汇总一次
  （`[提示]` 前缀，**只报告、不影响退出码**）列出未识别的 `Make / Model` 组合，
  否则新增设备品牌只会无声无息地不显示图标
- 前缀刻意不用 `[警告]`，与"未通过预检的文件夹"（`[跳过]`、会改退出码）这一层
  判定区分开（同数据一致性报告的既定做法）

### 前端配合

- `MapChildren.jsx` 的 `DeviceBadgeIcon` 组件做枚举 → **内联 SVG** 映射，渲染在角标
  文本段之后（`时间 · 格式 · 图标`）；**`flattenPhotos` 必须透传 `device`**，否则
  "按照片分组"模式角标丢图标——与 `displayLink` 当初漏透传是同一类坑
- **图标不用 emoji**（2026-09-30 修订）：彩色 emoji 的配色固定在位图字体里、CSS
  `color` 完全无效，`📷` 的深灰机身叠在角标半透明黑底 + 深色照片上明度差≈0，
  实测等于隐形；且 emoji 字形跨平台差异大。SVG 用 `stroke="currentColor"` 继承
  角标白色，任何底图与平台都清晰

## 视频元数据（2026-10-04 新增，mp4）

mp4 没有 EXIF 容器，**exifr 读不了 mp4**——所有视频元数据读取（预检、fix-gps 扫描、
审阅页）按扩展名分叉到 `exiftool -j -n`（实测 JSON 键名：`GPSLatitude` /
`GPSLongitude` 十进制数、`Make` / `Model`、`Duration` 秒）。管线机制见
`data-pipeline.md` 视频小节，这里记字段口径的坑：

### 拍摄时间：取 `Keys:CreationDate`，不是 `QuickTime:CreateDate`

- `[Keys] CreationDate = 2026:10:03 11:18:54+08:00`——**真拍摄时间**，带时区后缀，
  显式切掉后缀（`stripTimezoneSuffix`）后走照片同款 `normalizeExifDateTime`
- `[QuickTime] CreateDate = 2026:10:04 07:42:53`——**导出时间**（从相册导出的时刻），
  与拍摄时间可差一整天，用错字段 `takenAt` 直接错位

### 溯源标记落在 `[XMP-exif]` 组

mp4 没有 EXIF GPS IFD，fix-gps 写入的 `GPSProcessingMethod` 会落到 **`[XMP-exif]`**
组——这是正常现象，不要试图改写成 EXIF 组（写不进去）。exiftool `-j` 读回的是
纯字符串，`parseGeoSource` 原样可解析，`geoSource` 契约对视频不变。

### 写入路径（实测）

| 写法 | 结果 |
| --- | --- |
| `-Keys:GPSCoordinates="…"` | ❌ 写不进（PrintConvInv，只读的转换标签） |
| `-UserData:GPSCoordinates="+lat+lng/"` | ✅ 可写 |
| 合成标签 `-GPSLatitude=… -GPSLatitudeRef=N …`（fix-gps 现用） | ✅ 可写 |
| `-tagsfromfile <参照> -GPSLatitude …`（fix-gps 现有命令） | ✅ **对 mp4 原样可用**，零改动 |

fix-gps 补视频坐标**写在原片上**（原片是真相源），`npm run photos` 转码时经
`-tagsfromfile` 自动带进 `_web.mp4`。剥坐标（造缺坐标测试样本）用
`exiftool -overwrite_original -gps:all= -Keys:GPSCoordinates= -XMP:all=`。

### 原生 GPS 的存储位置与读回优先级（实测 2026-10-04）

iPhone 视频的坐标存在 `[Keys] GPSCoordinates`（mdta userdata），exiftool 把它合成为
`GPSLatitude` 读出。**读回优先级：原生 `Keys:GPSCoordinates` > 后写入的 XMP-exif
GPSLatitude**——对已有原生 GPS 的视频再用 fix-gps 写法写不同坐标，读回仍是原生值
（实测写入 31.0/121.0 后读回仍 32.0181/118.808）。这不构成真实路径问题：fix-gps
只把"缺坐标"的媒体进目标清单、永不覆盖已有坐标（与照片同纪律），因此 XMP 写入
只发生在无原生坐标的视频上，此时读回即写入值（端到端实测一致）。

## 坐标系纪律：存储永远是 WGS84，GCJ02 只是显示派生（2026-10-05）

决策记录：`docs/plans/2026-10-05-fix-gps-review-amap-embed.md`。

- **全站统一口径**：EXIF、`output.json`、`--plan-stdin` 的 plan JSON、写入链路，坐标
  一律 WGS84。GCJ02（高德火星坐标）**只允许出现在"紧贴地图渲染"的显示层**——主站
  经 `AMap.convertFrom` 在线转换，fix-gps 审阅页经 `wgs84ToGcj02()`（fix-gps.js 内嵌
  纯算法，node 侧离线算）在**生成 data 时**为每个锚点附加 `gcjLat` / `gcjLng` 两个字段
- **唯一例外：人手填的点位坐标存 GCJ02、不做换算**（2026-10-07，参考点位）。这类坐标
  （`../data/photos/<点位>/refs/point.json`，见 `photo-ops.md`「参考点位」）与
  `cities.js` 的城市落点是**同一类数据**：来源都是高德坐标拾取器、用途都是"直给高德
  显示"，所以存它原生的 GCJ02、前端**不再**过 `convertFrom`（再转一次就是二次偏移）。
  判据收敛成两句话：**人手填的一律 GCJ02；照片 EXIF 的一律 WGS84 并换算**。
  两者在同一个 `output.json` 里靠 `pinKind` 区分（`photo` = EXIF/WGS84、
  `ref` = 手填/GCJ02）。⇒ `pinKind` 不是装饰字段，而是**坐标通道开关**：全站唯一一处
  "字段同名、坐标系不同源"，改它或加新通道时必须同步前端两个转换分支
  （`MapChildren.jsx` 的 marker 落点、`LightboxInfoPanel.jsx` 的高德链接）。
  境外沿用既有例外：偏置只对境内坐标有定义，境外直接填 WGS84 即可
- **审阅页数据契约**：`anchors[]` 项的 `lat` / `lng` 永远是 WGS84 原值，`gcjLat` /
  `gcjLng` 是仅供第 5 区底图落点的派生值——两者共存，改代码时不得让后者覆盖前者
  （覆盖即坐标污染，写入链路读的是 WGS84 那对）
- `wgs84ToGcj02` 的境外直通不是兜底：GCJ02 偏移只对中国境内坐标有定义，境外原样返回
  （与高德官方 convertFrom 行为一致，实测东京点逐位相同）；境内控制点与官方偏差
  < 0.1 m（对照值锁在 `test/gcj02.test.js`，取自 2026-10-05 官方 convertFrom 实测）
- **审阅页第 5 区底图**：卫星影像 + 路网线（主站 `BaseMapSwitch` 的 `satellite-road`
  同款组合）。key 取自 `.env` 的 `REACT_APP_AMAP_API_KEY`（JS API 平台，静态地图/
  Web 服务类型不适用——实测返回 `USERKEY_PLAT_NOMATCH`），缺 key 时 `--review` 在
  node 侧预检报错退出（附解决步骤），key 的判定点**只有这一处**，页面不做二次探测
- file:// 实测（2026-10-05）：审阅页在 `file://` 协议下加载高德 JS API、渲染卫星底图
  全部正常，无域名白名单/安全密钥阻塞；**key 无效时地图照样完整渲染**（坏 key 页与
  正常页截图 MD5 一致）——渲染层的 key 校验目前不生效，审阅页仍保留"complete 事件
  8 秒未触发即显式报错"的判据作未来防线
