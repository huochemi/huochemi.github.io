# 照片元数据（photo-metadata）

`process-photos.js` / `fix-gps.js` 如何读写照片 EXIF 元数据：**坐标口径、坐标溯源、
拍摄设备分类**。管线机制（HEIC 转码、派生图档位、删除照片、一致性报告）见
`data-pipeline.md`；"为什么缺坐标算未完成"这类产品定义见 `photo-workflow.md`。

## GPS 坐标缺失策略（2026-10-03 重写）

决策记录：`docs/plans/2026-10-03-gps-gate-hardening.md`。

### 判定：组内任一张缺坐标 ⇒ 该文件夹整体不产出

- `process-photos.js` 把每个文件夹拆成**预检**与**生成**两段，**预检零写操作**：
  读 `index.json` + 对全部图片做一次 EXIF 解析（实测 156 张约 220ms，占整轮 2% 量级）；
  生成阶段复用这份元数据，不重复读 EXIF
- 预检失败判据（任一命中即失败）：缺 `index.json` / JSON 非法 / 未指定
  `index_photo` / 无图片文件 / 封面文件不存在 / **组内任一张缺坐标（含封面）**
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
`gps: { GPSLatitude, GPSLongitude, GPSProcessingMethod }`。两点实测结论：

- **不能用顶层 `pick`**：它会把 XMP 块一并滤掉，而分块 pick 才能精确定位到各块
- **`exif.latitude` / `exif.longitude` 这两个十进制派生字段只在同时 pick 了
  `GPSLatitude` 与 `GPSLongitude` 时才出现**；只 pick 其中一项会读不到坐标，
  表现为"全部照片都缺坐标"

### 前置步骤：`npm run fix-gps`

- **补坐标工具 `fix-gps.js`**（`npm run fix-gps [-- 文件夹]`）：交互式从同文件夹内
  有 GPS 的照片（按拍摄时间就近推荐）复制坐标写入目标原图 EXIF（exiftool
  `-overwrite_original`，依赖 `brew install exiftool`，缺失即报错退出不兜底），并排
  预览两张照片辅助确认；写入后立即重读校验
- **手动指定参照**（2026-09-27 新增）：自动推荐不合适时，改用 `--target 目标文件名
  --ref 参照文件名` 点名参照（`--yes` 跳过确认）。约束：仅限同文件夹、目标必须缺
  GPS（已有 GPS 不做覆盖）、参照必须有 GPS，不满足即报错退出。自动推荐与可用参照
  清单会打印在按键提示上方，无需查文档；无参照时提示先放入一张附近拍的照片再重跑
- 没跑 `fix-gps` 就跑 `npm run photos` 会在**启动阶段（约 0.2 秒）**被拦住：缺坐标的
  文件夹直接跳过并报错，不会等到生成完毕才失败、也不会留下半成品

## 坐标溯源 geoSource（2026-10-03 新增）

目的：区分"照片自带的原生坐标"与"从参照照片复制来的坐标"——回答"这张照片的坐标是
哪张锚点给的、锚点选错没有"。之前两者在数据里长得一模一样。

### 写入（fix-gps.js）

- 复制坐标时同时写标准 EXIF 标签 `GPSProcessingMethod`，值形如
  `hcm-geosource ref=IMG_5815.jpg date=2026-10-03`
- 前缀 `hcm-geosource` **必需**：相机会自己写该标签（如 `GPS` / `Apple`），
  没有前缀就无法区分原生与复制
- **不再复制 `GPSHPositioningError`**：它是参照照片那次定位的误差（本次锚点实测
  52.3 m），照搬等于让相机照声称拥有手机的定位精度，而真相是"同址推断"；
  留空表示精度未知（宁缺毋假）

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
- `output.json` 每张照片新增 `geoSource`：**无该字段 = 原生坐标**；有 = 复制坐标，
  值为参照文件名；标记存在但参照名不可解析 → `'unknown'`（绝不能误判成原生）
- **历史数据无法回填**：2026-10-03 之前已补过坐标的 11 个文件夹没有标记，只能表现
  为"原生坐标"；本字段只对之后写入的坐标有效

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
  `ifd0: { Make, Model }` + `exif: { DateTimeOriginal }` + `gps: {...}`，
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
