# 照片数据处理（data-pipeline）

`process-photos.js` / `delete-photo.js`（根目录脚本）相关的工具链知识。AGENTS.md 只保留
一行摘要，完整内容以本文件为准。

**元数据口径不在本文件**：GPS 判定与硬拦、坐标溯源 `geoSource`、拍摄设备 `device`
分类 → `docs/photo-metadata.md`（2026-10-03 按"单文件 ≤200 行"拆分而来）。

## 双根管线（2026-10-05 起，形态 B）

照片数据源拆成两个**根目录**。三个 CLI 各存一份同值常量（刻意不抽共享模块；
`test/dual-root.test.js` 锁三处一致，改一处不同步会在 `npm run test:cli` 爆）：

| 常量 | 路径 | 角色 |
|---|---|---|
| `ORIGIN_DIR` | `../photos-originals/photos` | **原图**（真相源、不可再生）——私有存档仓，不开 Pages |
| `IMGS_DIR` | `../data/photos` | **派生图**（可再生）+ `index.json`——Pages 项目站点 |

分工与读写方向：

- `process-photos.js`：**从 `ORIGIN_DIR` 读原图 → 向 `IMGS_DIR` 写派生图**；
  `index.json` 仍从 `IMGS_DIR` 读。预检的媒体清单取自原图仓（"原图是否完整"是判定输入）
- `fix-gps.js`：EXIF **回写到 `ORIGIN_DIR`**；审阅页缩略图从 `IMGS_DIR` 取
- `delete-photo.js`：原图删 `ORIGIN_DIR`、派生文件删 `IMGS_DIR`；**两个根都要有该
  点位目录**，缺一即报错退出（不静默删一半）
- 一致性检查（孤儿派生文件）的配对基准取自 `ORIGIN_DIR`——基准取错会让全部派生文件
  被误报成孤儿

启动预检（S3：只预检一次、缺失即报错退出、不做兜底）：两个根都必须存在；**双根扫描
全程只读**（2026-10-05 起：原先"只在原图仓有点位"会在 data 侧建空目录，已移除——空目录
git 不可见、且在原图仓该点位被删后会命中"只在 data 侧"而整轮误报，见
`plans/2026-10-05-photos-no-empty-dir.md`）。点位目录只在 `data` 侧有 → **报错退出**
（原图是唯一输入源，极可能是搬家漏拷）；只在原图仓有 → **不写任何东西**，该点位在文件夹级
预检里因缺 `index.json` 被跳过。**导入新照片**：原图落原图仓、`index.json` 与派生图落
data 仓。data 侧的目录与 `index.json` 可用
`npm run new-place -- "<点位>" --cover "<文件名>"` 一次建好（`description` 取点位名，
要换成更短的展示名就建好后直接编辑该文件；原图仓目录仍须手工建并放入
媒体；见 `photo-workflow.md` 标准流程第 3 步）。

（为何拆：原图占 92.3% 却不可再生、派生图占 6.8% 可再生——混在一个 Pages 站点里，
不可再生的大文件很快撞 1 GB 配额。决策全过程见 `docs/plans/2026-10-04-data-repo-longevity.md`。）

## 增量跳过（2026-10-05 新增）

**全部派生图共用一条判据**：`派生文件存在且 mtime ≥ 原片 mtime` → 跳过重编码
（`derivedIsUpToDate`，落在 4 个生成函数的入口：缩略图 / 展示图 / 视频转码版 / 视频封面帧）。

为什么必须有：展示图 AVIF 编码单张 ~0.8 s，占单张总耗时约 84%（缩略图只要 ~35 ms）；
而全量 326 个派生文件里通常只有个位数需要重算——"加几张照片看效果"却要等**首次全量
2 分 24 秒**那个量级，是本次改动的直接动因。

实测（2026-10-05，真实仓库 163 媒体 / 326 派生文件）：

| 情形 | 收尾汇总行 | 耗时 |
|---|---|---|
| 稳态重跑（无新增） | 复用 326 / 重新生成 0 | **0.2 秒** |
| 新加 1 张照片 | 复用 324 / 重新生成 2 | ~1.2 秒 |
| `--force` 强制全量 | 复用 0 / 重新生成 326 | 2 分 24 秒量级 |

- **判据的失败方向是安全的**：原片 mtime 变新（fix-gps 补坐标、重新拷贝覆盖）即重建，
  宁可多算不会漏算
- **`--force` 是判据失灵场景的统一显式出口**（`npm run photos -- --force`：忽略全部
  mtime 判据；**只影响"是否重算"**，不改变任何判定、跳过清单、退出码与 `output.json`
  内容——已实测增量跑与 `--force` 跑出的 `output.json` 逐字节一致）：
  ① **改了档位常量**（`DISPLAY_QUALITY` / `DISPLAY_SIZE` / `VIDEO_CRF` 等）——旧派生图
  仍会被判"最新"，**不 `--force` 就静默沿用旧档位**；② 派生文件损坏 / 0 字节（上次生成
  中途中断）；③ 原地覆盖同名原片且新文件 mtime 更早（如从备份 `rsync -a` 恢复）
- **不做自动探测**（内容哈希、派生文件名带档位指纹、档位指纹文件均被否决）：那会成为
  第二套判据，与"判定点单一"冲突。判据失灵一律走 `--force`，不做静默修补
- 收尾打印一行 `派生图增量：ℹ️ 复用 N 个（原图未变动）、重新生成 N 个`——用 `ℹ️` 而非
  `⏭️`，后者在本 repo 契约里是"有问题或本轮未产出、须注意"（黄色，现用于未通过预检的文件夹）
- 参数解析只认 `--force`，其它 `--xxx` 一律 `❌ 未知参数：…` + 用法 + 退出码 1
  （与 `new-place.js` 同风格）；单测 `test/incremental-skip.test.js` 锁判据边界
  （`>=` 而非 `>`、派生缺失即重建）
- 决策过程与被否决方案：`plans/2026-10-05-photos-incremental-skip.md`

## sharp 无法解码 HEIC（2026-09 已解决）

### 现象

iPhone 拍摄的 `.HEIC` 生成缩略图全部失败，报错：

```
/Users/.../IMG_8169.HEIC: bad seek to 2306568
heif: Decoder plugin generated an error: Unspecified (7.0)
```

### 根因（实测确认，非推测）

- sharp 的**预编译二进制**出于 HEVC 专利授权原因，内置 libheif **不含 HEVC 解码插件**
- 证据：`sharp.format.heif.input.fileSuffix` 返回 `[".avif"]`（无 heic）；
  `sharp(f).metadata()` 能成功（`compression: hevc`），像素解码必失败
- bad seek 的偏移量全部精确超出文件末尾 32 字节，是解码器找不到 HEVC
  tile 数据的系统性表现，**不是文件损坏**（macOS `sips` 可正常解码全部问题文件）
- **升级 sharp 无效**：本地 0.35.4 已是 npm 最新稳定版；社区实测（appsemble#2216）
  任何版本的预编译包都一样
- `failOn: 'none'` 也无效：这是解码器缺失的硬错误，不是可容忍的警告

### 解法（已实现于 process-photos.js 的 generateThumbnail）

1. `.heic` 先经 macOS 原生 `sips -s format jpeg` 转码到 `os.tmpdir()`（唯一临时
   文件名防并行冲突，`finally` 中清理）
2. 再交给 sharp 缩放输出 WebP 缩略图
3. JPG/TIFF 路径不变，直接走 sharp

### 元数据不受影响

GPS / `DateTimeOriginal` 由 `exifr` 直接读 HEIC 内嵌 EXIF（元数据 box 解析，
不需要 HEVC 解码像素），始终正常。缩略图转码与元数据提取互不依赖。

## `.HEIC` 原图不可直接作为 web 分发链接（2026-10-05 起已无此问题）

**现状**：全站已取消"查看原始文件"入口（`webViewLink` 字段与前端消费点一并移除，
见 `docs/plans/2026-10-04-data-repo-longevity.md` 决策 6）。原图不再直接分发给浏览器，
所以下面这条"HEIC 渲染兼容性"问题**不再有触发面**，本节只留作历史记录。

原问题如下：`webViewLink` 指向 `.HEIC` 原图时，大部分浏览器无法渲染：

| 浏览器 | HEIC 渲染 |
|---|---|
| Safari（macOS/iOS） | ✅ |
| Chrome on macOS | ✅（走系统解码器） |
| Chrome on Windows | ⚠️ 需自装 HEVC 扩展，绝大多数用户没有 |
| Chrome on Linux / Firefox | ❌ |

Chrome 从 118 起也只是把解码委托给操作系统，不自带 HEVC 解码器。

曾经的备选（未采纳，现已作废）：sips 额外生成 web 浏览版（长边 2048px JPEG）。

## 元数据口径（GPS 硬拦 / 坐标溯源 / 设备分类）

2026-10-03 起这三块移入 **`docs/photo-metadata.md`**（本文件超 200 行，按 AGENTS.md
的"单文件超 200 行按域拆分"拆出）：组内任一张缺坐标即整组跳过（预检零写操作）、
`output.json` 的 `geoSource` 溯源字段、`device` 分类规则与未识别降级，均见该文件。

## 展示图档位 displayLink（2026-09-25 新增；2026-10-05 换 AVIF）

### 背景

Lightbox 高清图原先直接用原图（原始 JPG 2~5MB/张），首开大图要完整下载数 MB，
是"打开大图很慢"的根因。

### 方案

在缩略图（300px）与原图之间设展示图档位：长边限制 1920px，命名
`<原文件名>_display.<ext>`，单张约 100~500KB（约为原图 1/10）。派生图落在
`IMGS_DIR`（`../data/photos/<dirName>/`），随 `data/photos` 一起部署。

**编码格式：2026-10-05 起由 WebP 换为 AVIF**（`DISPLAY_QUALITY` 是 AVIF 质量档）：

| 档位 | 全量 152 张合计 | 相对 WebP q75 |
|---|---|---|
| WebP q75（旧） | 44.6 MB | 基准 |
| AVIF q60 | 38.9 MB | -12.8% |
| **AVIF q50（当前采用，2026-10-05 拍板）** | **26.7 MB** | **-40.1%** |

- ⚠️ **验收口径修正**：plan 阶段 0 曾用**合成噪声图**测得 -45%，但真实照片实测只有
  -12.8%（q60）——合成噪声是 WebP 的最不利情形，**不能外推到真实照片**；达标需降到
  **q50**（实测 -40.1%，刚好过 ≥40% 线）
- ⚠️ **AVIF q70 反而比 WebP q75 更大**（+14%）：两格式的质量刻度不同名同值，
  跨格式比体积必须实测，不能按"同 q 值"直觉等价
- 编码耗时：**首次全量**（当时 152 张展示图 + 153 张缩略图 + 视频抽帧）实测 2 分 24 秒；
  2026-10-05 起**重跑默认增量**（派生图未变动即跳过），稳态实测 0.2 秒——见「增量跳过」节
- 坑：`sharp.format.avif` 是 `undefined` 属**正常**——AVIF 归在 `sharp.format.heif`
  下（`alias: ["avif"]`），`.avif()` 方法照常可用
- 质量档位选型的实测脚本与并排预览页：`.workbuddy/tools/display-format-experiment.js`

要点：

- `process-photos.js`：`generateDisplayImage()` 与缩略图同流程（HEIC 同样走
  sips 转码兜底），输出 `displayLink` 字段（组级封面 + 每张照片均有）
- 前端 `MapChildren.jsx`：Lightbox 高清 `<img>` 与前后张预加载优先用
  `displayLink`（fallback `thumbnailLink`）；`flattenPhotos` 必须透传
  `displayLink`，否则"按照片分组"模式退化
- **不再有"查看原始文件"入口**（2026-10-05 取消）：`webViewLink` 字段、前端 6 处
  消费点、`.lightboxLink` 样式一并移除；展示图即最高画质档，原图只进原图仓

## 视频管线（2026-10-04 新增）

决策过程、12 档转码体积实测与画质对比依据：`docs/plans/2026-10-04-video-mp4-support.md`。

### 文件模型（真相源 = 原片）

| 文件 | 角色 | 归属 |
|---|---|---|
| `X.mp4`（原片） | 真相源：坐标/拍摄时间的唯一权威，fix-gps 写它 | **原图仓** `ORIGIN_DIR`（不入 data 仓 git） |
| `X_web.mp4` | 转码版，浏览器实际播放的文件 | data 仓 git ✓ |
| `X_thumb.webp` | 封面帧缩略图 | data 仓 git ✓ |

> 2026-10-05 形态 B 之前，原片靠 `../data/.gitignore` 的 `*.mp4` 规则留在本地；
> 现在原片归原图仓，`*.mp4` 规则仅在过渡期保留（见 plan 阶段 3）。

### 转码（`generateWebVideo`）

```
ffmpeg -c:v libx264 -crf 30 -preset medium -pix_fmt yuv420p \
       -vf scale=-2:'min(720,ih)' -c:a aac -b:a 128k -movflags +faststart
```

- **CRF30 / 720p60 是用户 2026-10-04 拍板档位**（65.5 MB 原片 → 8.6 MB）；降帧到
  30fps 只省 13% 却损失货车通过段（全片帧差峰值）的流畅度，故保留源帧率
- `min(720,ih)`：低分辨率视频不被放大；`'…'` 是 ffmpeg filtergraph 自己的引号
  （保护 min() 的逗号），经 execFile 无 shell 直传实测可用
- **`+faststart` 是可流式播放的前提**：iPhone 原片 moov 在文件末尾，不加则浏览器
  要下完整个文件才能起播（实测转码后 atom 序 `ftyp → moov`）
- **ffmpeg 转码丢光全部元数据**（`-map_metadata 0` 也无效），随后
  `exiftool -tagsfromfile 原片 -Keys:GPSCoordinates -Keys:CreationDate -Make -Model -XMP:all`
  从原片捞回 → **坐标 fix-gps 写在原片上，改档位重转不会丢坐标**
- **增量**：与全部派生图同一判据（见「增量跳过」节）——`_web.mp4` mtime ≥ 原片 mtime
  则跳过（实测重跑 1.5 s vs 首转 16.7 s）；fix-gps 补坐标会更新原片 mtime，补完坐标
  重跑会正确重转

### 封面帧（`generateVideoThumbnail`）

`ffmpeg -ss <min(5, duration/2)>` 抽一帧到临时 PNG → 复用照片缩略图的 sharp 链
（300×300 cover + entropy → webp，与 `generateThumbnail` 同参数）。

### output.json 契约（视频项）

`type: "video"` + `videoLink` + `duration`（秒）；**缺 `type` 即照片**，老数据向后
兼容。视频**没有** `displayLink`（无展示图档，Lightbox 直接播 `videoLink`）也**没有**
`webViewLink`（原片不入库，"查看原始文件"对视频无意义）。封面可以是视频
（用户拍板，数据层与照片等价）：封面为视频时组级是 `type` + `videoLink`。
前端 `flattenPhotos` 必须透传 `type` / `videoLink` / `duration`（`displayLink`
漏透传的老坑同样适用于这三个字段）。

### 口径与判据

- 三处 `ALLOWED_EXTS`（process-photos / fix-gps / delete-photo）同步加 `.mp4`；
  三处 `DERIVED_SUFFIXES = [_thumb.webp, _display.avif, _web.mp4]` 有跨文件单测
  锁定一致（`test/video-support.test.js`），改任何一处不同步都会在 `test:cli` 爆
- 视频与照片**同口径参与 GPS 硬拦**（缺坐标整组跳过）；`geoSource` 对视频同样有效
- 视频元数据读取走 exiftool（exifr 读不了 mp4），详见 `photo-metadata.md` 视频小节
- **ffmpeg / exiftool 预检仅当本轮扫描到视频才执行**——S3 的必要偏离（plan 已确认）：
  纯照片文件夹缺 ffmpeg 不该被拦。注意 exiftool 版本参数是 `-ver`（`-version` 会被
  它当成"读 version 标签"→ "No file specified"）
- 一致性检查的孤儿后缀集合含 `_web.mp4`；视频原片进基名集合，转码版不算孤儿

## 轨迹文件 `.gpx` 刻意不进媒体白名单（2026-10-07）

点位目录里会放 Apple Watch 导出的 `.gpx` 轨迹（供轨迹路 `fix-gps:track` 插值补坐标，见
`photo-workflow.md`）。它**故意不加入任何 `ALLOWED_EXTS`**（`process-photos.js` /
`fix-gps.js` / `delete-photo.js` 三处的白名单都不含它），理由：轨迹**不是媒体**——
一旦进白名单就会变成 `output.json` 的一条 photo 条目、参与缺坐标硬拦、进派生图流程，
全都错。

- 管线另用 `TRACK_EXTS = new Set(['.gpx'])` 判断"该点位是否有轨迹"：预检失败 hint 在
  目录含轨迹时**把轨迹路顶到最前**（先给 `npm run fix-gps:track -- <点位>`、再附锚点路，
  两条都给——轨迹只覆盖录制时段，窗口外的照片仍需锚点，提示不互相取代）
- 与 `fix-gps.js` 的同名常量是**同值副本**（沿用"刻意不抽共享模块"惯例），由
  `test/geo-provenance.test.js` 锁两处同值、且断言两个 `ALLOWED_EXTS` 都不含 `.gpx`
- 决策记录：`docs/plans/2026-10-07-gpx-coordinate-channel.md`

## 删除照片 / 数据一致性报告

2026-10-05 拆出 → **`docs/photo-ops.md`**（本文件超 200 行，按 AGENTS.md 按域拆分）：
`npm run del-photo` 的流程与约定、`npm run photos` 末尾「数据一致性检查」的口径。
