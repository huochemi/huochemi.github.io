# 视频（mp4）支持

状态：已实现（2026-10-04，实现后修订见文末）
日期：2026-10-04
来源会话：用户发现 `南京中和桥道口` 目录含 `IMG_5810.mp4`，询问"是否所有环节都支持视频"。
调研确认**九个环节零支持且视频静默消失**；用户决定支持 mp4，并已就四个方向拍板（见下）。
本计划的全部技术结论均来自本次实测（非推测），实测明细见"已实测确认的事实"。

## 背景与现状

站点是"在地图上展示照片"的产品，管线（`process-photos.js` / `fix-gps.js` /
`delete-photo.js`）与前端（`MapChildren.jsx`）全线以
`ALLOWED_EXTS = {.jpg,.jpeg,.heic,.tiff}` 为唯一媒体判据。视频的处境：

| 环节 | 现状 |
| --- | --- |
| index.json 封面 | 视频不能当封面（`imageFiles.includes(coverFileName)` 校验） |
| fix-gps 补坐标 | 不扫视频，坐标写不了 |
| photos 预检 | **静默过滤非图片——不报错、不警告、零提示** |
| 派生图生成 | 无视频转码 / 截帧 |
| output.json 契约 | 无 `type` 字段，结构上无法表达"这是视频" |
| marker / 缩略图网格 / Lightbox | 全 `<img>`，无 `<video>` |
| del-photo 删除 | 硬拒"不支持的图片格式" |
| data 仓库部署 | `.gitignore` 未排除 mp4，会随 git 提交 |

**"静默消失"是本计划要修掉的头号问题**：它与 repo 一贯的"早报错早知道、不做静默降级"
（`photo-workflow.md` 设计约束 1）直接冲突。即使视频支持分期做，这一条也应优先。

## 已定决策（用户 2026-10-04 拍板）

1. **存储策略**：转码压缩后进 git（原片不入库，避免 1 GB 配额与不可逆历史膨胀）
2. **工具链**：装 ffmpeg（已装 9.0.2，libx264 / aac 均可用）
3. **GPS 口径**：视频与照片**同口径**——缺坐标也要走既有 fix-gps 流程指定坐标
4. **首版范围**：完整版，含相册流与预加载
5. **入库命名**：方案 A（原片留原位进 gitignore、转码版 `X_web.mp4` 入库）
6. **视频可以当封面**（数据层与照片等价）
7. **视频本体不预加载、只预加载封面帧**（接受 agent 的理由化实现）

## 已实测确认的事实（下游 agent 不必重测）

被测对象：`../data/photos/南京中和桥道口/IMG_5810.mp4`（65.5 MB / 1920×1080 /
59.94 fps / 34.3 s / H.264 avc1 + AAC）。全部验证在 `/tmp` 副本上完成，原数据零改动。

### 视频自带完整元数据（不是"缺元数据的二等公民"）

| 字段 | 值 | 复用性 |
| --- | --- | --- |
| `[Keys] Make` / `Model` | Apple / iPhone 14 Pro Max | **直接复用 `classifyDevice`** |
| `[Keys] GPSCoordinates` | 32.0181, 118.808 | 有坐标 |
| `[Keys] CreationDate` | `2026:10:03 11:18:54+08:00` | **真拍摄时间** |
| `[QuickTime] CreateDate` | `2026:10:04 07:42:53` | ⚠️ **导出时间，不是拍摄时间** |

### 工具链实测

- 抽帧：`ffmpeg -ss 5 -i x.mp4 -frames:v 1 out.png` → **0.27 s**，出 1920×1080 PNG
- 缩略图：PNG → `sharp` 300×300 cover + entropy → webp → **35 ms / 15.9 KB**
  （与现有 `generateThumbnail` 完全同一调用，**链路零改造**）
- 转码（libx264 preset medium + AAC 128k）：

  | 配置 | 体积 | 码率 | 压缩比 | 耗时 |
  | --- | --- | --- | --- | --- |
  | 原始 | 65.5 MB | 15.3 Mbps | 1.0× | — |
  | CRF23 1080p60 | 39.5 MB | 9.2 Mbps | 1.7× | 19 s |
  | CRF26 1080p60 | 27.4 MB | 6.4 Mbps | 2.4× | 18 s |
  | CRF26 1080p30 | 24.0 MB | 5.6 Mbps | 2.7× | 12 s |
  | CRF28 1080p30 | 18.7 MB | 4.4 Mbps | 3.5× | 12 s |
  | CRF30 1080p30 | 14.7 MB | 3.4 Mbps | 4.5× | 10 s |
  | CRF26 720p60 | 13.7 MB | 3.2 Mbps | 4.8× | 11 s |
  | CRF26 720p30 | 12.1 MB | 2.8 Mbps | 5.4× | 7 s |
  | CRF28 720p60 | 10.8 MB | 2.5 Mbps | 6.1× | 9 s |
  | CRF28 720p30 | 9.4 MB | 2.2 Mbps | 7.0× | 5 s |
  | CRF30 720p60 | 8.6 MB | 2.0 Mbps | 7.6× | 9 s |
  | CRF30 720p30 | 7.5 MB | 1.8 Mbps | 8.7× | 6 s |

- **运动强度实测**（全片 60fps 逐帧差、低分辨率灰度口径）：相邻 1/60s 帧差 7.3/255、
  相邻 1/30s 10.4/255；**t≈15–17s 货车近景通过时帧差 21/255，为静止段（t≈11s，5.0）的 4 倍**
  → 降帧的顿挫恰好落在货车通过的主菜片段；而 CRF30 口径 720p30→720p60 只多 1.1 MB（13%）

- `-movflags +faststart` **生效**：原片 atom 序为 `ftyp → wide → mdat → moov`
  （moov 在末尾，浏览器首播要下完整个 65 MB）；转码后为 `ftyp → moov` ✓
- **转码会丢光全部元数据**（GPS / CreationDate / Make / Model 全空，`-map_metadata 0` 无效）
  → 但 `-tagsfromfile 原片 -Keys:GPSCoordinates -Keys:CreationDate -Make -Model -XMP:all`
  **可完整捞回**（实测 GPS、拍摄时间、设备三项全部还原）✓

### exiftool 读写 mp4 的坑（全部实测）

| 写法 | 结果 |
| --- | --- |
| `-Keys:GPSCoordinates="31.2 121.4 5"` | ❌ `Error converting value ... (PrintConvInv)` |
| `-GPSLatitude=… -GPSLatitudeRef=N -GPSLongitude=… -GPSLongitudeRef=E` | ✅ 可写 |
| `-UserData:GPSCoordinates="+lat+lng/"` | ✅ 可写 |
| `-tagsfromfile <参照> -GPSLatitude …`（**fix-gps 现有命令**） | ✅ **原样可用** |
| `-GPSProcessingMethod="hcm-geosource …"` | ✅ 可写，但落在 **`[XMP-exif]`** 组（mp4 无 EXIF GPS IFD） |

- **fix-gps 的 `writeGps()` 命令行对 mp4 零改动**（实测把坐标 31.0/121.0 从参照照片
  复制进 mp4，读回 31/121）✓
- 单个 65 MB 文件读写各 **0.18 s**
- **exifr 读不了 mp4** → 读取通道必须分叉到 exiftool
- 缺坐标时 exiftool 读回空、可正常检出 ✓

### 配额（硬约束）

- data 仓库工作区 **667 MB**（= Pages 实际发布内容），`.git` 另有 575 MB
- GitHub Pages 官方限制：发布站点 ≤ 1 GB、源仓库建议 ≤ 1 GB、带宽 100 GB/月（软）、
  单文件硬限 100 MB
- **GitHub Pages 官方明确不支持 Git LFS**（"Git LFS cannot be used with GitHub Pages
  sites"）→ LFS 路线已排除，不再评估

## 决策点（2026-10-04 更新）

### 决策 1：转码档位 —— 唯一待定项

用户倾向"720p + 30fps 够用"。实测后的**建议：CRF30 / 720p60（8.6 MB）**，理由：

- **降帧不划算**：720p30 → 720p60 只多 1.1 MB（13%），却丢掉 60fps；本片帧差峰值
  （t≈15–17s，21/255）恰是货车近景通过——火车视频的主菜片段，30fps 顿挫在这里最显眼
- **720p30 是"两头不占优"档**：比 720p60 省得最少，同时牺牲清晰度与流畅度。
  想省体积，砍分辨率（1080→720 省 ~45%）才是大头，帧率不是
- **若在意认车号/车体细节**（车迷视角），分辨率优先：选 CRF30/1080p30（14.7 MB，
  余量 333 MB ≈ 再放 22 个）。720p 的裁切放大对比图在对比页第二组（t=16s 货车近景），可直接目验

→ 二选一：**720p60/CRF30（建议）** 或 **1080p30/CRF30**。定完写入
`process-photos.js` 的一组常量（可随时改，改后删 `_web.mp4` 重跑即可）。

### 决策 2：入库文件名与流程顺序 —— ✅ 已定：方案 A

原片 `IMG_5810.mp4` 留在原位、进 `.gitignore`；转码版 `IMG_5810_web.mp4` 入库。
原片保持"真相源"地位（fix-gps 补坐标写在原片），与现有 `_thumb` / `_display`
派生命名惯例一致，且不动用户原始文件名。（用户 2026-10-04 确认）

### 决策 3：视频能否当封面 —— ✅ 已定：允许

视频有坐标，与照片在数据层等价；`index.json` 的 `index_photo` 本来就是
"任意一张媒体文件名"。（用户 2026-10-04 确认）

### 决策 4：视频本体不预加载 —— ✅ 已定：接受

照片沿用现有 `new Image()` 预加载；视频只预加载 `poster`（`_thumb.webp`）。
（用户 2026-10-04 确认）

## 设计（按方案 A）

### 1. 文件模型与真相源

| 文件 | 角色 | 入库 | 谁写 |
| --- | --- | --- | --- |
| `X.mp4`（原片） | **真相源**：坐标/时间的唯一权威 | ✗ gitignore | 用户导入；fix-gps 补坐标 |
| `X_web.mp4` | 转码版，HTML5 直出 | ✓ | `npm run photos` 生成 |
| `X_thumb.webp` | 封面帧缩略图 | ✓ | `npm run photos` 生成 |

**为什么原片仍是真相源**：转码会丢光元数据，但 `-tagsfromfile` 能从原片完整捞回
（已实测）。因此坐标写在原片 → 每次转码自动带上 → 改转码档位重跑不会丢坐标。
这与"原图是真相源、派生图可重建"的既有哲学一致。

### 2. output.json 契约

新增视频项（**`type` 缺省即照片，向后兼容老数据**）：

```json
{
  "fileName": "IMG_5810.mp4",
  "type": "video",
  "thumbnailLink": "/data/photos/<dir>/IMG_5810_thumb.webp",
  "videoLink": "/data/photos/<dir>/IMG_5810_web.mp4",
  "duration": 34.3,
  "lat": 32.0181, "lng": 118.808,
  "takenAt": "2026-10-03T11:18:54",
  "device": "phone",
  "geoSource": "IMG_5805.HEIC"
}
```

- `fileName` 用**原片名**（与照片语义一致：fileName = 真相源文件名；del-photo 用它）
- 视频**不设 `displayLink`**（没有"1920px 展示图"这一层，直接播 `videoLink`）
- `duration` 供前端角标显示时长

### 3. 媒体判据统一

三处 `ALLOWED_EXTS` 语义不同，**不合并成一个常量**，但各自扩展：

| 文件 | 常量 | 新增 |
| --- | --- | --- |
| `process-photos.js` | 扫描口径 | 加 `.mp4`，并过滤 `_web` |
| `fix-gps.js` | 可写入口径 | 加 `.mp4`，并过滤 `_web`（坐标只写原片） |
| `delete-photo.js` | 可删除口径 | 加 `.mp4` |

`_thumb` / `_display` / `_web` 三个后缀在**任何扫描里都要显式排除**——
建议各脚本用同名的 `DERIVED_SUFFIXES` 常量集中表达，避免又出现"三处漂移"。

### 4. process-photos.js

- **预检**：`readPhotoMeta()` 按扩展名分叉——图片走 exifr（现状不动），
  视频走 exiftool（建议整目录一次 `exiftool -j -n` 批量调用，而非逐文件起进程）。
  视频字段映射：`GPSLatitude/ GPSLongitude` → lat/lng；
  **`Keys:CreationDate`（切掉 `+08:00` 时区后缀后走 `normalizeExifDateTime`）** → takenAt；
  `Make` / `Model` → 复用 `classifyDevice`；`XMP-exif:GPSProcessingMethod` → `parseGeoSource`。
- **GPS 硬拦口径不变**：视频与照片一起参与"组内任一张缺坐标即整组跳过"。
  预检读的是**原片**（真相源），排在转码之前 → 失败时零写操作、不转码、不留半成品。
- **生成阶段**：新增 `generateWebVideo(原片, 转码版)`：
  1. `ffmpeg -i 原片 -c:v libx264 -crf <档位> -preset medium -pix_fmt yuv420p
     -c:a aac -b:a 128k -movflags +faststart 转码版`
  2. `exiftool -overwrite_original -tagsfromfile 原片 -Keys:GPSCoordinates
     -Keys:CreationDate -Make -Model -XMP:all 转码版`（捞回被 ffmpeg 丢弃的元数据）
  3. **增量**：若 `_web.mp4` 已存在且 mtime ≥ 原片 mtime 则跳过（重跑管线不必重转）
- 新增 `generateVideoThumbnail()`：`ffmpeg` 抽第 N 秒一帧到 `os.tmpdir()` 的 PNG
  → 复用现有 `generateThumbnail` 的 sharp 链 → `_thumb.webp`（`finally` 清理临时文件，
  与 HEIC 的 sips 兜底同款写法）。抽帧时间点取 `min(5, duration/2)` 秒，避免片头黑帧。
- **启动预检（AGENTS.md S3）**：建议"仅当扫描到视频文件时才检查 ffmpeg"——
  纯照片文件夹缺 ffmpeg 不该被拦住。这是对现状的必要偏离，请一并确认。

### 5. fix-gps.js

- **扫描**：加 `.mp4`，过滤 `_web` / `_thumb` / `_display`（只处理原片）
- **`readGps()` / `readTakenAt()`**：按扩展名分叉，视频走 exiftool（`-j -n`）
- **`writeGps()`**：**命令行零改动**（实测 `-tagsfromfile` 对 mp4 原样可用）。
  仅需把"写入后验证"的读取也走分叉通道。溯源标记落到 `XMP-exif` 组是正常现象，
  不要试图改写成 EXIF 组（写不进去）
- **审阅页 `--review`**：`toImgSrc()` / `resolveThumbSrc()` 对 mp4 不能走 sips，
  改用 ffmpeg 抽帧出临时 JPEG（与 HEIC 分支并列）
- 交互模式、`--all` 批量、`--plan-stdin`、锚点合并逻辑**全部不变**

### 6. delete-photo.js

- `ALLOWED_EXTS` 加 `.mp4`
- 待删清单扩为：原片 + `_web.mp4` + `_thumb.webp`（缺则跳过，不报错）
- "删后为空"判定把视频计入媒体总数
- 封面保护逻辑不变

### 7. 数据一致性检查

`reportInconsistencies()` 的孤儿后缀集合加 `_web.mp4`；`stems` 集合需包含视频原片，
否则 `IMG_5810_web.mp4` 会被误报为孤儿。

### 8. 前端（MapChildren.jsx / LightboxInfoPanel.jsx）

- `flattenPhotos()`：两条分支都要透传 `type` / `videoLink` / `duration`
  （**漏透传是历史踩过的坑**——`displayLink` 就曾因此退化）
- marker / 抽屉网格：`type === 'video'` 时封面帧上叠**播放三角 + 时长角标**
  （时长格式 `m:ss`，与 `formatTakenAtShort` 同族的纯函数）
- Lightbox：`type === 'video'` 渲染 `<video controls playsInline preload="metadata"
  poster={thumbnailLink} src={videoLink}>` 替代 `<img>`；关闭/切张时组件卸载即停止播放
- **键盘事件要让路**：现有 `keydown` 监听左右键切图，但 `<video>` 原生控件也吃左右键
  （快退/快进）。处理器须先判断 `e.target` 是否为 video/其控件，是则放行给原生控件
- **预加载策略（用户要求"含预加载"，这里给出理由化实现）**：
  照片沿用现有 `new Image()` 预加载 `displayLink`；**视频本体不预加载**
  （单个 8~40 MB，预加载等于替用户浪费流量，且在移动网络上会拖慢相邻照片）。
  视频只预加载 `poster`（即 `_thumb.webp`，通常已随抽屉网格加载过，等于零成本）。
  这是"视频的预加载"在工程上唯一合理的形态，**若你期望"切到下一个视频时预取视频本体"，
  请明确说明**——那需要额外的带宽预算决策
- `LightboxInfoPanel`：封面判定复用 `currentPhoto.fileName === coverFileName`；
  删除命令复制、坐标复制对视频同样适用（文件名就是原片名）

### 9. data 仓库 `.gitignore`

```gitignore
# 视频：原片不入库（体积/配额），仅入库转码版
*.mp4
!*_web.mp4
```

**必须加在 `../data/.gitignore`**（不是站点仓库）。当前 data 仓库已跟踪 0 个 mp4 ✓

## 验收标准

1. 放一个含视频的目录，`npm run photos`：其余照片照常产出，视频生成 `_web.mp4` +
   `_thumb.webp`，`output.json` 出现 `type: "video"` 项；转码版 faststart（`ftyp → moov`）
   且 GPS / takenAt / device 三项与源视频一致。
2. 视频缺坐标时，`npm run photos` **报错并整组跳过**（与照片同口径），提示可复制的
   fix-gps 命令；此时不产生任何 `_web.mp4` / 派生图。
3. `npm run fix-gps -- "<含视频且缺坐标的目录>"` 能把参照坐标写入 **mp4 原片**，
   `geoSource` 标记可被 `parseGeoSource` 读出（XMP 组）。
4. `npm run del-photo -- "<目录>" "<视频原片名>"` 同时删除原片 / `_web.mp4` / `_thumb.webp`。
5. 前端：视频的地图 marker 有播放三角与时长角标；Lightbox 内 `<video>` 可播放、
   可拖进度条；相册流左右键在视频上让路给原生控件；关闭后无残留播放。
6. `npm run test:cli` 通过（新增视频判据/时长格式等纯函数单测）；
   `./node_modules/.bin/eslint src test --ext .js,.jsx,.ts,.tsx --max-warnings=0` 通过，
   根目录两脚本另跑 `npx eslint process-photos.js fix-gps.js delete-photo.js --max-warnings=0`。
7. **部署后**（agent 环境无 GitHub 出网，交你终端）：确认 Pages 对 `_web.mp4` 返回
   206 Partial Content（可拖进度条）——这是唯一必须上线后才能验的项。
8. **数据隔离（AGENTS.md S1）**：`../data/photos` 的原始视频与照片全程零写入；
   验证一律在临时副本上做，写入类验证交你的终端执行。

## 出界清单（本计划明确不做）

- **`.mov` / `.avi` / HEVC 视频**：本次只做 mp4 + H.264。用户 iPhone 若切到"高效"模式
  产出 HEVC，浏览器兼容性会退化（Firefox 不支持），届时另议
- **Git LFS**：官方明确不支持 Pages，已排除
- **外部对象存储 / CDN**：你选了"转码进 git"，不引入外部依赖与费用
- **视频自动播放**：不自动播（含静音自动播），一律用户点击
- **视频转码的进度条 / 并发控制**：按现有管线串行并发模型（`Promise.all`）即可，
  单视频 9~19 s，不额外做进度 UI
- **视频编辑能力**（裁剪 / 拼接 / 旋转校正）：只做无损转码 + 元数据搬运
- **原片的本地归档策略**：原片留在原位不动（方案 A），不做异地备份/归档
- **`displayLink` 视频档位**（如 720p 预览版）：不做，只有"封面帧 + 单一视频档"

## 风险与对策

| 风险 | 对策 |
| --- | --- |
| 1 GB 发布站点上限被视频快速吃掉 | 转码档位可随时调；体积数据已在决策点 1 给出；一致性检查会报孤儿文件 |
| 每次 `fix-gps` 后原片 mtime 变化触发重转码 | 属**正确**行为（坐标变了就该重转），但 N 个视频会多花 N×15 s，可接受 |
| 视频原生控件与相册流键盘冲突 | 已列为设计项（keydown 让路），验收标准 5 覆盖 |
| `-Keys:CreationDate` 带时区，与 EXIF 口径不一致 | 切掉 `+08:00` 后缀后走同一 `normalizeExifDateTime`，口径统一 |
| ffmpeg 在 GUI/IDE 启动的进程里可能不在 PATH | 启动预检 + 报错附安装命令（S3），不做多路兜底 |

## 知识回写（实现后）

- `docs/data-pipeline.md`：新增"视频管线"小节（转码档位、faststart、元数据捞回、
  `_web` 命名与增量规则）
- `docs/photo-metadata.md`：新增"视频元数据"小节（`Keys:CreationDate` vs
  `QuickTime:CreateDate` 的岔路、`XMP-exif` 溯源组、`Keys:GPSCoordinates` 写不了）
- `docs/photo-workflow.md`：标准流程补视频分支（原片 → fix-gps → photos）；
  产品定义从"展示照片"扩为"展示照片与视频"
- `docs/app-structure.md`：`output.json` 契约加 `type` / `videoLink` / `duration`
- `AGENTS.md` 路由：若新建域文件才加行（按流程 3，知识进既有域文件则本文件不动）

## 实现后修订（2026-10-04）

- **转码档位定案：CRF30 / 720p60**（用户接受实测建议；原决策点 1 的两个候选取前者）
- **决策 2 / 3 / 4 落定**：方案 A、视频可当封面、视频本体不预加载（只预加载 poster）
- **验收结果**（全部在 /tmp 隔离沙箱上端到端实测，../data/photos 零写入）：
  带坐标视频目录正常产出（type/videoLink/duration/device/geoSource 全对、
  `_web.mp4` faststart `ftyp→moov`、元数据捞回齐全）；缺坐标视频整组跳过且 hint
  正确；`fix-gps --all` 对 mp4 写入并过写入后验证、溯源标记落 XMP-exif；
  `del-photo` 三件套齐删；重跑增量生效（16.7 s → 1.5 s，未重转码）；孤儿 `_web.mp4`
  正确报告；`test:cli` 21/21（含新增 `test/video-support.test.js` 的三 CLI 契约锁）；
  三脚本与 src/test 的 eslint 全绿
- **实现中新发现的坑（已修）**：exiftool 的版本参数是 `-ver`，`-version` 会被它
  当成"读 version 标签"→ "No file specified"，预检曾因此误报"未安装"
- **实现中新发现的坑（已记不改码，S2）**：对已有原生 GPS 的视频写新坐标，读回
  仍是原生值（exiftool 优先 `Keys:GPSCoordinates`）——真实路径不可达（fix-gps
  永不覆盖已有坐标），已记入 `photo-metadata.md` 视频小节
- **对设计的偏离（知识回写时确认）**：output.json 字段契约写进
  `data-pipeline.md` 视频小节而非 `app-structure.md`——后者本就不承载 output.json
  字段契约，另开一节会造成双源
- **验收 7（部署后验证）留待上线**：Pages 对 `_web.mp4` 返回 206 需推送后确认；
  CI build 验证按 AGENTS.md 交用户终端执行（agent 环境 build/ 已存在会假失败）
