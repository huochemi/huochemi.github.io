# Plan: 缩略图角标显示拍摄设备类型（手机 / 相机）

- 日期：2026-09-30
- 状态：已实现（2026-09-30）
  - 4 项待确认点已由用户拍板，见文末「决策记录」
  - 代码改动：`process-photos.js`（品牌表 + `classifyDevice` + `device` 字段 +
    收尾识别汇总）、`MapChildren.jsx`（`deviceEmoji` + 角标第三段 +
    `flattenPhotos` 两分支透传），前端仅此一个文件
  - 校验：`eslint --max-warnings=0` 对 `src` 与 `process-photos.js` 均 exit 0；
    用源码中真实的 `classifyDevice` 跑全量 118 张 EXIF，得
    `phone 78 / camera 40 / 未识别 0`，与预期一致
  - 未完成（依赖用户侧）：`npm run photos` 重跑生成带 `device` 的 `output.json`
    （用户自行执行）、`npm start` 目视验收
- 知识回写：`docs/data-pipeline.md` 新增「拍摄设备类型 device（2026-09-30 新增）」
- 前置：`docs/plans/2026-09-30-photo-format-badge.md`（已实现）——本次是在既有
  `时间 · 格式` 角标结构上追加一段，不改其已有两段的顺序与语义

## 需求

照片抽屉网格的缩略图角标，在「拍摄时刻 · 格式」之后再显示一个设备类型图标：
手机拍的 `📱`、相机拍的 `📷`。

用户 2026-09-30 明确的两条约束：

1. **只做缩略图角标**，不做 Lightbox 信息面板
2. **不显示品牌/型号文本**（不显示 "Apple iPhone X"），只用图标表示「手机 / 相机」，
   以节省角标空间

## 方案选型

- **采纳 A（pipeline 提取 + 类型枚举）**：`process-photos.js` 用 exifr 读 `Make` / `Model`，
  归一为类型枚举 `device: 'phone' | 'camera'` 写入 `output.json`；前端只做
  枚举 → emoji 映射。
  - 为什么必须走 pipeline：缩略图与展示图是 sharp 生成的 WebP，**EXIF 已被抹掉**，
    前端拿不到原始 EXIF；HEIC 也能由 exifr 直接读（元数据 box 解析，不依赖像素解码）
- **否决 B（前端从文件名推断）**：`DSC*` = 相机、`IMG_*` = 手机，实测"今天正好对"，
  但文件名是拍摄设备的**巧合而非事实源**。反例已在真实数据中：
  `石景山南站附近1/DF4C-0018-20250830-IMG_9496.JPG` 是 **iPhone 12** 拍的
  （`IMG_` 前缀却来自手机，文件名被改过）。换机、改名即失效，故不可取
- **否决 C（把设备提到组级/文件夹级）**：实测 10 个文件夹里 **3 个混机**
  （北官房 SONY 12 张 + iPhone 14 Pro Max 30 张、通州街 2 + 10、郑州 3 + 1），
  组级单一值表达不了真实情况

## 实测数据（本次调研，118 张 / 10 个文件夹）

| 项 | 实测值 |
|---|---|
| Make | 仅 2 个：`Apple` 78、`SONY` 40 |
| Model | 仅 4 种：`iPhone 14 Pro Max` 48、`NEX-5N` 40、`iPhone X` 19、`iPhone 12` 11 |
| Make 与 Model 是否重复 | 无重复（`SONY` + `NEX-5N`、`Apple` + `iPhone X`），拼接不需要去重 |
| 缺 Make/Model | **0 张** |
| 同文件夹内混机 | 7/10 单机、3/10 混机 |
| 预期分类结果 | phone 78 / camera 40 / 未识别 0 |

顺带核实（本次不取）：`Software`（iOS 版本 / 固件）与 `LensModel` 同一次解析即可拿到。

## 改动内容

### 1. `process-photos.js`（管线）

1.1 **复用既有 exifr.parse，不新增第二次解析**：把 pick 列表扩为

```js
pick: ['DateTimeOriginal', 'Make', 'Model']
```

1.2 新增 `classifyDevice(make, model)`，返回 `'phone' | 'camera' | null`，
规则按顺序命中即返回：

1. `Model` 匹配 `/xperia/i` → `'phone'`
   （SONY 既产相机又产手机，这是唯一的实质性冲突点，故用 Model 级特例覆盖品牌表）
2. `Make`（trim + 转小写）∈ `CAMERA_MAKES` → `'camera'`
3. `Make` ∈ `PHONE_MAKES` → `'phone'`
4. 其余 → `null`（不写字段）

表内容（已确认，属启发式清单而非权威数据源）：

- `PHONE_MAKES`：apple, samsung, huawei, honor, xiaomi, redmi, poco, oppo, vivo,
  oneplus, google, realme, motorola, meizu, zte, nubia, nothing, asus, lenovo, tcl,
  tecno, infinix
- `CAMERA_MAKES`：sony, canon, nikon, fujifilm, panasonic, olympus, om digital
  solutions, ricoh, pentax, leica, hasselblad, sigma, dji, gopro, kodak, casio

1.3 照片对象新增 `device` 字段，**仅当分类非 null 才写**（宁缺毋假，与 `lat` /
   `takenAt` 同惯例）；**组级对象不加**该字段（混机时无意义）

1.4 收尾加一行**设备识别汇总**（报告性质，不修改文件、不影响退出码）：

```
设备类型识别：[提示] phone 78 / camera 40 / 未识别 0
```

未识别数 >0 时列出未识别的 `Make`/`Model` 组合，便于用户发现分类表漏了新设备。
前缀用 `[提示]` 而非 `[警告]`，避免与既有的「输出无 GPS 警告即为成功」判定口径混淆
（同数据一致性报告的既定做法）。

### 2. `src/Application/Map/AMap/MapChildren.jsx`（前端，仅此一个文件）

2.1 新增枚举 → emoji 映射，并把它并入既有角标拼接（`filter(Boolean) + join(' · ')`
惯例不变，缺项自动省略）：

```js
const deviceEmoji = (device) =>
  device === 'phone' ? '📱' : device === 'camera' ? '📷' : '';

const thumbnailBadgeLabel = (photo) =>
  [
    formatTakenAtShort(photo.takenAt),
    formatFileExt(photo.fileName),
    deviceEmoji(photo.device),
  ]
    .filter(Boolean)
    .join(' · ');
```

2.2 **`flattenPhotos` 必须透传 `device`**（两个分支都要：无 `photos` 数组的分支、
   `photos.map` 分支）。这是本 repo 的既有坑——`displayLink` 当初同样因漏透传而
   导致"按照片分组"模式退化；漏掉则照片分组模式下角标丢图标

2.3 **CSS 不动**：`.photoTimeBadge` 现有样式（绝对定位左下、`font-size: 11px`、
   `padding: 3px 6px`）可容纳。该样式无 `max-width` / `ellipsis`，若实测最长的
   `15:19 · JPEG · 📱` 在窄缩略图下溢出，另起 plan 处理，本次不动

### 3. 数据与文档

3.1 重跑 `npm run photos` 生成新 `output.json`。**不手改 `output.json`**（既有约定：
   该文件由管线生成）。全量 118 张会重新生成缩略图与展示图；内容不变则 data 仓库
   应无 diff，若字节有变则随 `data` 仓库一并提交
3.2 `docs/data-pipeline.md` 新增小节「拍摄设备类型（2026-09-30）」：字段定义、分类
   规则与品牌表、为何不能用文件名推断（附反例）、未识别时的降级行为
3.3 `AGENTS.md` **不动**：未新建域文件，按既有流程 3 无需改路由

## 不做的事（出界清单）

- 不显示品牌名或型号文本（用户明确要求）
- 不在 Lightbox 信息面板加「拍摄设备」行（用户本轮明确只做角标）
- 不提取 `Software` / `LensModel`
- 不在组级对象写 `device`
- 不改原图 EXIF，不写任何非 `output.json` 的数据文件（S1：原图只读）
- 不给未识别的 Make 加兜底猜测（不猜；降级为不显示图标）
- 不新增 CSS 类或改 `.photoTimeBadge`
- 不处理无 `takenAt` / 无扩展名的边角数据（沿用既有滤镜式拼接，自动省略）

## 验收标准

1. `./node_modules/.bin/eslint src --ext .js,.jsx,.ts,.tsx --max-warnings=0` 零 warning
2. 管线输出汇总行为：`phone 78 / camera 40 / 未识别 0`
3. 前端自查（用户 `npm start`）：
   - 抽屉网格角标形如 `15:19 · JPEG · 📱`
   - 石景山南站（iPhone X）全为 `📱`；房山长阳-碧桂园温泉小区C区（NEX-5N）全为 `📷`
   - 乌兰察布市集宁区-北官房铁路小区3号楼附近（混机）两种图标各归其位
4. 切到"按照片分组"模式，角标同样带图标（验证 `flattenPhotos` 透传）
5. 缺 `device` 的照片（人工构造校验用样本）角标不出现多余 ` · ` 或空段

## 决策记录（2026-09-30 用户拍板）

1. **分类表内容**：接受（1.2 的两张品牌表 + Xperia 特例 + 未识别不写字段）
2. **emoji 位置**：追加为第三段，即 `15:19 · JPEG · 📱`（采纳推荐，不动现有两段结构）
3. **彩色字形观感**：接受 emoji 彩色字形与角标白色文字混排，不做内联 SVG 图标替换
4. **未识别汇总**：保留（1.4）

原「需用户确认的点」4 项至此全部关闭。

## 后续修订（2026-09-30，决策记录第 3 条被取代）

- 上文决策记录第 3 条「**彩色字形观感**：接受 emoji 彩色字形与角标白色文字混排，
  不做内联 SVG 图标替换」**已失效**，被
  `docs/plans/2026-09-30-photo-device-badge-svg-icon.md`（已实现）取代。
- 取代依据：该条决策的前提是「emoji 与白字混排观感可接受」，此前提当时未经深色
  底图实测即被接受；用户 2026-09-30 截图实测推翻——emoji 走系统彩色字体（Apple
  Color Emoji），**配色固定在位图里、CSS `color` 完全无效**，`📷` 的深灰机身与
  `rgba(0,0,0,.55)` 角标底（再叠深色照片）明度差≈0，等于隐形。
- 修订范围：仅**呈现实现层**——`deviceEmoji()` 换成 `DeviceBadgeIcon` 内联 SVG
  组件。本 plan 的其余 3 条决策（分类表内容、图标为角标第三段、未识别汇总）继续
  有效；数据结构、字段语义、角标段数、`flattenPhotos` 透传全部未变。
- 历史保留不删（P1）：本节为**追加**记录，上文「改动内容 2.1」「验收标准 3」等
  描述的是当时实现，不再代表现状，现状以新 plan 与代码为准。
