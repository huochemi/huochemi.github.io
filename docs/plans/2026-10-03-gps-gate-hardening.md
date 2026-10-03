# GPS 口径归位：预检前移 + 分目录硬拦 + 坐标溯源标记

状态：已实现（2026-10-03）
日期：2026-10-03
相关：`docs/photo-workflow.md`（工作流与产品定义）、`docs/photo-metadata.md`（GPS 口径 /
坐标溯源，**本计划实施时按 200 行规则从 `data-pipeline.md` 拆出**；本文件正文里的
`data-pipeline.md` 引用指的就是这份新域文件）

## 背景（自包含，零上下文可读）

站点是照片地图（React 18 + @uiw/react-amap + GitHub Pages）。照片真实数据源在**仓库外**
的 `../data/photos/<文件夹>/`，每个文件夹有 `index.json`（`index_photo` 指定封面）。

标准数据流程（见 `photo-workflow.md`）：导入照片 → `npm run fix-gps -- <dir>` 把手机
锚点照的坐标复制到相机照 → 维护 `index.json` → `npm run photos` → 提交两个仓库。
**相机（如 SONY NEX-5N）机身无 GPS，所以"相机照缺坐标"是流程中的中间态。**

### 现状问题（2026-10-03 实测，非推测）

用户刚建的新 dir `南京南站附近1`（29 张，只有手机照 `IMG_5815.jpg` 有坐标，28 张相机照
无坐标），跑 `npm run photos` 的结果：

1. **判定口径是反的**：真正代表"流程没走完"的信号（相机照缺坐标）只打
   `console.warn`、不改变退出码；而"缺 GPS 的封面"才硬失败。一次运行连打 28 行警告后
   才终止，警告不可读，且与"无 GPS 警告即成功"的既有口径冲突。
2. **副作用先于校验**：封面校验位于 `await Promise.all(photoResults)` **之后**，
   而派生图在每张照片的 map 内部就已写完 → 校验失败时，该 dir 29 张
   `_thumb.webp` / `_display.webp` **已全部落盘**（路径不可逆，脚本无回滚）。
3. **失败半径被并发放大**：12 个 dir 由 `Promise.all(tasks)` 并发处理，任一 reject →
   `catch` → `process.exit(1)` 立即杀进程，不等兄弟 task → 实测 `郑州`（4 thumb / 3
   display）、`郑州市-解放路跨铁路桥`（7/1）、`郑州市-铁道丽景苑`（2/1）被切断在半途。
4. **呈现层静默回退**：`MapChildren.jsx` 的 `flattenPhotos` 用 `photo.lat ?? group.lat`
   把缺坐标的照片钉到封面坐标 → 把"未完成"伪装成"已降级"。照片分组模式下会造成
   marker 像素级重合、`ⓘ` 面板把封面坐标当该照片的真实 GPS 展示并给出高德链接
   （与 `LightboxInfoPanel.jsx` 自身注释的"宁缺毋假"矛盾）。

### 关键实测数据

- 156 张照片的 EXIF 全量预检（一次 `exifr.parse` 取全字段）：**230 ms**
  （现状的两次读法 435 ms）；整轮 `npm run photos` 为 **9.0 s** → 预检占整轮约 2.5%
- 若把校验前移，报错时刻从"9.0 s 且派生图已写完"变为"0.23 s 且零副作用"

## 已获用户确认的决策

| 决策 | 选择 |
|---|---|
| 缺坐标判定 | 一律硬拦，**不做** `index.json` 豁免清单 |
| 失败粒度 | **1b**：失败的 dir 跳过，其余 dir 照常产出，退出码非 0 |
| 呈现层回退 | 删除 `photo.lat ?? group.lat` |
| 同坐标聚合 | 本次**不做**（模式保留，另出 plan） |
| 坐标溯源标记 | 本次**做** |

## 目标与验收标准

**目标**：让"忘跑 fix-gps"变成一次**零副作用、秒级、可操作**的显式失败；让"原生坐标
与复制坐标"在数据层可区分。

**验收标准**（在 `/tmp` 副本上验证，见 AGENTS.md S1）：

1. 对未补坐标的 dir 跑管线：**0.3 s 量级**内列出全部被判失败的 dir 及缺坐标张数，
   该 dir 目录内**不新增任何**派生文件（零副作用）
2. 其余 dir 照常生成派生图并写入 `output.json`，退出码为 `1`
3. 补完坐标后重跑：全部 dir 通过，退出码 `0`，`output.json` 含全部 dir
4. 前端两组模式（文件夹 / 照片）均正常渲染；`output.json` 中不存在缺坐标项时，
   不出现任何控制台错误
5. `fix-gps` 补过坐标的照片，在 `output.json` 中带有溯源信息；原生坐标不带

## 设计

### 1. 新增「预检阶段」，排在一切写操作之前（`process-photos.js`）

每个 dir 的处理拆成两段，**预检段零写操作**：

- 读 `index.json`（保留既有校验：文件存在、JSON 合法、`index_photo` 非空）
- 读该 dir 全部图片的 EXIF，**一次 `exifr.parse` 取全字段**
  （`DateTimeOriginal` / `Make` / `Model` / `GPSLatitude` / `GPSLongitude`，
  沿用 `reviveValues: false` 以避免时区偏移），得到每张的
  `{ lat, lng, takenAt, device }`
- 判定该 dir：
  - `index_photo` 指向的文件不存在 → 失败
  - **组内任一张照片缺坐标 → 失败**（含封面；封面硬拦并入此条，不再是独立分支）
  - 全部满足 → 通过

预检对全部 dir 先跑完（并发，实测 230 ms），**再**进入生成阶段。这样一次运行就能看到
全部有问题的 dir，而不是跑到一半才发现。

### 2. 失败粒度 1b：跳过失败 dir，不杀全进程

- 失败的 dir：不生成任何派生图、不进入 `output.json`，收集到 `failedDirs`
- 通过的 dir：照常生成派生图并产出数据
- **移除** `Promise.all(tasks)` 抛出后 `process.exit(1)` 的中途杀进程路径——这是当前
  "兄弟 dir 被切断在半途"的根因

### 3. 生成阶段复用预检结果

- 预检已读到的元数据（`lat` / `lng` / `takenAt` / `device`）传给生成阶段，
  **不再重复读 EXIF**（沿用既有原则：device 与 `DateTimeOriginal` 共用一次 parse）
- 派生图生成、`output.json` 写入逻辑保持不变

### 4. 收尾报告与退出码

- 保留既有 `reportInconsistencies`（孤儿派生文件）与 `reportDeviceTypes`
- 新增失败汇总，一行一个 dir，前缀用 `[跳过]`（与 `[警告]` / `[不一致]` / `[提示]`
  的既有分层互不混淆）：

  ```
  [跳过] 南京南站附近1：28/29 张缺坐标，该目录未产出数据
         补坐标后重跑：npm run fix-gps -- "南京南站附近1"
  ```

- 有任一 dir 失败 → `process.exitCode = 1`（不再中途 `process.exit`）
- 成功路径不打印"缺坐标警告"——缺坐标已升级为失败，警告与失败不再重叠

### 5. 前端删除静默回退（`MapChildren.jsx`）

- `flattenPhotos` 中 `lat: photo.lat ?? group.lat` → 改为直接取 `photo.lat` /
  `photo.lng`；**缺坐标的项不进入 marker 列表**，并 `console.error` 报出文件名
  （显式失败，不是静默兜底）
- 组级对象（文件夹分组模式）仍用 `group.lat` / `group.lng`（预检保证存在）
- 关键约束：**绝不能让 `undefined` 进入 `AMap.convertFrom`**。该方法接收坐标数组，
  任一元素非法可能导致整批转换失败、所有 marker 都不渲染——故必须在进数组前过滤
- 两组模式的数据结构、抽屉与 Lightbox 逻辑均不变

### 6. 坐标溯源标记（方案 4）

- `fix-gps.js` 写入坐标时（`writeGps`），**同时写一个溯源字段**，内容为参照文件名与
  写入日期（如 `ref=IMG_5815.jpg;date=2026-10-03`）
- 字段选择**待落地验证**（候选：EXIF `UserComment` / 自定义 XMP）。需先验证
  `exiftool` 能写入且 `exifr` 能读回；**验证必须在 `/tmp` 副本上进行**（S1）
- `process-photos.js` 读该字段 → `output.json` 每张照片新增 `geoSource`：
  无标记 = 原生坐标；有标记 = 复制坐标（值记录参照来源）
- **顺带修正虚假精度**：当前 `-tagsfromfile` 把参照的 `GPSHPositioningError` 一并
  复制，会让相机照声称拥有手机的定位精度（通常 <10 m），真相是"同址推断" →
  补坐标时不再照搬该值（记为"精度未知"）
- **历史数据无法回填**：已补过坐标的 dir（除 `南京南站附近1` 外的 11 个）没有标记，
  只能表现为"原生坐标"。此限制必须写进 `docs/data-pipeline.md`

## 出界清单（本计划明确不做）

- 不做 `index.json` 的 `no_gps` 豁免清单（用户已定：一律硬拦）
- 不做同坐标 marker 聚合（方案 3，另出 plan）
- 不做 `fix-gps` 批量模式（现状逐张交互确认的设计保留）
- 不修改"照片分组 / 文件夹分组"两套模式的结构
- 不新增除 `geoSource` 外的字段，不改动 `output.json` 既有字段语义
- 不动 `device` 的静默降级口径（未识别即不写字段 + 收尾汇总）
- 不做删除/清理类操作：`南京南站附近1` 磁盘上已有的 29 张派生图**由脚本删除范围之外**，
  本计划不清理它们（脚本从不删文件）

## 风险与对策

| 风险 | 对策 |
|---|---|
| 删掉前端回退后，若 `output.json` 出现缺坐标项会炸掉整批 marker | 进 `AMap.convertFrom` 前过滤 + `console.error` 显式报出 |
| 硬拦后新 dir 未补完时，该 dir 不上线且可能被忽略 | 收尾汇总一行一个 dir + 退出码非 0 + 打印下一步命令 |
| `geoSource` 字段的写入/读取写法在 exiftool+exifr 上不成立 | 实施第一步先在 `/tmp` 副本验证；不成立则降级为 `UserComment` |
| 预检阶段新增 EXIF 读取会拖慢整轮 | 实测预检 230 ms（整轮 9.0 s），且复用结果后生成阶段不再重复读 EXIF |
| 历史 dir 的 `geoSource` 缺失被误读为"数据缺陷" | 在 `data-pipeline.md` 写明："无标记 = 原生坐标或 2026-10 之前补的坐标" |

## 实施顺序

1. `/tmp` 副本上验证溯源字段的写入与读取（纯调研，决定第 6 节的字段选型）
2. `fix-gps.js`：写溯源字段 + 不再照搬 `GPSHPositioningError`
3. `process-photos.js`：预检阶段 → 1b 失败粒度 → 复用元数据 → 收尾汇总与退出码
4. `MapChildren.jsx`：删回退 + 映射过滤
5. 验收：按上节 5 条标准在 `/tmp` 副本执行（验收命令由用户终端执行）
6. 知识回写：`docs/data-pipeline.md` 更新 GPS 策略与 `geoSource`；
   `photo-workflow.md` 的"已定口径"段更新为"已实现"

## 待办（本计划外的下一步）

- 同坐标聚合（方案 3）：模式保留，独立出 plan

## 实施记录（2026-10-03）

### 字段选型：改用 `GPSProcessingMethod`（偏离原候选，理由如下）

计划第 6 节的候选是"EXIF `UserComment` / 自定义 XMP"。在 `/tmp` 副本上实测后全部否决，
改用标准 EXIF 标签 **`GPSProcessingMethod`**（语义即"坐标是怎么定位出来的"）：

| 候选 | 实测结论 |
|---|---|
| 自定义 XMP 命名空间 | ❌ exiftool 拒绝：`Warning: Tag 'XMP-hcm:GeoSource' is not defined`，需用户级 `~/.ExifTool_config`，不引入 |
| `XMP-exif:UserComment` | ⚠️ exiftool 可写、exifr 在 **JPEG** 上可读（`{xmp:true}` 返回 `{lang,value}`），但 **exifr 完全读不到 HEIC 的 XMP**（连 `xmp:{parse:false}` 的原始串都是 undefined）→ 现状数据含 48 张 HEIC（156 张中），会静默丢溯源 |
| EXIF `UserComment` | ⚠️ 可读，但 exifr 返回带 8 字节字符集前缀的原始字节（即使开 `userComment:true` 也不解码），且会覆写相机自己写的同名标签 |
| **`GPSProcessingMethod`（采用）** | ✅ exifr 从 JPEG 与 HEIC 的 GPS 块**同一次解析**读到；写入方 exiftool 对两种格式均支持；中文文件名往返正常（走 `UNICODE`+UTF-16LE，管线侧自行解码） |

写入值：`hcm-geosource ref=<参照文件名> date=<YYYY-MM-DD>`；前缀必需（相机会自己写
该标签，如 `GPS` / `Apple`）。

解析配置上还踩到两个 exifr 的坑，已写进 `data-pipeline.md`：顶层 `pick` 会滤掉 XMP
块（必须用分块 pick）；`latitude`/`longitude` 派生字段只在同时 pick 了 `GPSLatitude`
与 `GPSLongitude` 时才出现。

### 计划外的小增补（2 处，均为防线）

1. **全部文件夹都未通过预检时不覆盖 `output.json`**：否则会把线上已发布的照片数据
   清空成 `[]`。计划只写了"1b：失败的跳过、成功的照常产出"，未覆盖"全失败"这一
   极端分支。
2. **前端组级分支（无 `photos` 数组的项）也加了缺坐标守卫**：计划只要求照片分支过滤。
   组级坐标缺失时 `undefined` 进 `AMap.convertFrom` 会让**整批 marker 都不渲染**，
   代价与收益不成比例，故对称加上。

### 验收结果（全部在 `/tmp` 副本上执行，真实数据零改动）

| 验收项 | 结果 |
|---|---|
| 未补坐标的 dir → 0.3s 内列出失败目录，该 dir **零新增文件**（mtime 指纹前后一致） | ✅ 实测 0.2s 内报错；`南京南站附近1` 88 个文件指纹不变 |
| 其余 dir 照常产出、退出码 1 | ✅ 3 目录取 1 跳过 2 产出，退出码 1 |
| 补齐坐标后重跑全部通过、退出码 0 | ✅ fix-gps 28/28 写入成功；重跑退出码 0、3 目录全产出 |
| 溯源：复制坐标带 `geoSource`、原生坐标不带 | ✅ 28 张相机照 `geoSource = "IMG_5815.jpg"`；锚点 `IMG_5815.jpg` 无该字段 |
| 其余失败路径（index.json 非法 / 封面不存在）同样按目录跳过且零副作用 | ✅ 2 个坏目录被跳过、目录内无派生图、正常目录照常产出 |
| 全失败不覆盖 `output.json` | ✅ 哨兵内容保留、退出码 1 |
| 真实 `output.json`（11 组 127 张）无缺坐标项 → 前端不报 `[数据异常]` | ✅ 0 组 0 张缺坐标 |
| `eslint src --max-warnings=0` | ✅ 0 warning |
| `CI=true react-scripts build` | ⏳ 待用户在终端执行（`build/` 已存在时沙箱内跑 CI build 必失败，见 `toolchain.md`） |

前端浏览器内渲染验证未执行（未起 dev server）；已用静态检查覆盖"不会把 undefined
送进 `convertFrom`"这一唯一风险点。

### 历史数据限制（已写进 docs）

2026-10-03 之前补过坐标的 11 个文件夹没有标记，其 `geoSource` 缺失只能表现为
"原生坐标"，**无法回填**。

### 知识回写时触发了一次文档拆分（超出原计划范围，但属 AGENTS.md 流程 3）

原计划第 6 步写的是"更新 `docs/data-pipeline.md`"，但本轮新增的元数据内容（GPS 硬拦
口径 + 坐标溯源 + 既有 device 节）让该文件从 189 行涨到 249 行，越过 AGENTS.md 流程 3
的「单文件超 200 行按域拆分」阈值。故拆出 **`docs/photo-metadata.md`**（元数据口径：
GPS 硬拦、`geoSource`、`device`），`data-pipeline.md` 保留管线机制（HEIC 转码、派生图
档位、删除照片、一致性报告），两文件现为 135 / 133 行。

这与 `docs/plans/2026-09-30-data-pipeline-slim-down.md` 不冲突：那次用户选的是"去重瘦身、
不拆分"，但明确留了条件——"**若日后再拆，边界应由增长的内容自己显现**"。本次新增内容
正好让"元数据 vs 管线"这条边界显现出来。

连带改动（都是路由准确性，不含知识再创作）：`AGENTS.md` 路由拆成两行、
`photo-workflow.md` 的 5 处交叉引用改指新文件、本文件头部"相关"行。
