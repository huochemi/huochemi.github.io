# 照片数据处理（data-pipeline）

`process-photos.js`（根目录脚本）相关的工具链知识。AGENTS.md 只保留一行摘要，完整内容以本文件为准。

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

## `.HEIC` 不可直接作为 web 分发链接（未处理，遗留）

`webViewLink` 指向 `.HEIC` 原图时，大部分浏览器无法渲染：

| 浏览器 | HEIC 渲染 |
|---|---|
| Safari（macOS/iOS） | ✅ |
| Chrome on macOS | ✅（走系统解码器） |
| Chrome on Windows | ⚠️ 需自装 HEVC 扩展，绝大多数用户没有 |
| Chrome on Linux / Firefox | ❌ |

Chrome 从 118 起也只是把解码委托给操作系统，不自带 HEVC 解码器。

可能的后续方案（未采纳）：sips 额外生成 web 浏览版（长边 2048px JPEG）供
`webViewLink` 指向。2026-09-25 用户决策：本次只修缩略图，此项遗留。

## GPS 坐标缺失策略（2026-09-25 新增）

- **普通照片**缺 EXIF GPS：`exifr.gps()` 正常返回但无坐标（不抛异常），构建期打
  `console.warn`（文案点明"回退为封面坐标"后果，保证警告可操作）并跳过 lat/lng
  字段；前端 `flattenPhotos` 有 `photo.lat ?? group.lat` 回退，照片会钉在所属
  文件夹封面坐标上（位置可能不精确，属可接受降级）
- **封面照片**缺 GPS：仍为硬 error（throw 退出）——组级坐标直接来自封面，不能降级
- **补坐标工具 `fix-gps.js`**（`npm run fix-gps [-- 文件夹]`）：交互式从同文件夹内
  有 GPS 的照片（按拍摄时间就近推荐）复制坐标写入目标原图 EXIF（exiftool
  `-overwrite_original`，依赖 `brew install exiftool`，缺失即报错退出不兜底），并排
  预览两张照片辅助确认；修复后重跑 `npm run photos` 警告消失
- **手动指定参照**（2026-09-27 新增）：自动推荐不合适时，改用 `--target 目标文件名
  --ref 参照文件名` 点名参照（`--yes` 跳过确认）。约束：仅限同文件夹、目标必须缺
  GPS（已有 GPS 不做覆盖）、参照必须有 GPS，不满足即报错退出。自动推荐与可用参照
  清单会打印在按键提示上方，无需查文档；无参照时提示先放入一张附近拍的照片再重跑

## 展示图档位 displayLink（2026-09-25 新增）

### 背景

Lightbox 高清图原先直接用 `webViewLink`（原始 JPG 2~5MB/张），首开大图要完整
下载数 MB，是"打开大图很慢"的根因。

### 方案

在缩略图（300px）与原图之间新增展示图档位：长边限制 1920px、WebP、quality 75，
命名 `<原文件名>_display.webp`，单张 129~390KB（约为原图 1/10）。派生图与原图
**同目录**（仓库外的 `../data/photos/<dirName>/`，即管线的 `IMGS_DIR`），随
`data/photos` 一起部署。

- `process-photos.js`：`generateDisplayImage()` 与缩略图同流程（HEIC 同样走
  sips 转码兜底），输出 `displayLink` 字段（组级封面 + 每张照片均有）
- 前端 `MapChildren.jsx`：Lightbox 高清 `<img>` 与前后张预加载优先用
  `displayLink`（fallback `webViewLink` → `thumbnailLink`）；
  `flattenPhotos` 必须透传 `displayLink`，否则"按照片分组"模式退化为原图
- "查看原始文件"入口仍指向 `webViewLink` 原图

## 删除照片 `npm run del-photo`（2026-09-30 新增）

完整决策过程与修订记录：`docs/plans/2026-09-30-photo-deletion-workflow.md`。

```
npm run del-photo -- "<文件夹名>" "<文件名>"     # 需在站点仓库根目录执行
```

`delete-photo.js` 流程：参数/路径校验（拒绝 `..` 与路径分隔符）→ 封面硬拦 →
「删后为空」硬拦 → 删除原图 + `<名>_thumb.webp` + `<名>_display.webp` → 打印一行
提示（`output.json` **尚未更新**，需自行执行 `npm run photos`）。

**不自动重跑管线**（2026-09-30 修订 v4）：删单张的耗时几乎全是全量重跑，连删多张
会为每张各付一次，故改为由用户攒够了一次性跑。代价是 `output.json` 与磁盘短暂
不一致（网页上照片仍在、缩略图破图），且管线报错要等下一次重跑才暴露——删**之前**
的两道硬拦不依赖管线，删除动作本身的安全性不变。

关键约定与理由：

- **封面不可删除**（硬 error 退出）：封面提供组级坐标与缩略图来源，须先改
  `index.json` 的 `index_photo`（新封面必须有 GPS）再来删；**不做**自动挑替补救封面
- **原图直接删除、不进回收站**（用户 2026-09-30 决定）：执行该命令本身即为破坏性
  操作的当次确认，故不加二次确认提示，保住"粘贴即跑"；代价是不可恢复
- **「删后为空」也硬拦**：管线要求每组至少 1 张原图；整组下线需手动删文件夹
- **两道硬拦都排在删除动作之前**，拒绝时目录零变化。封面校验在「删后为空」之前，
  故后者只在 `index.json` 的 `index_photo` 已失效（指向已被删掉的照片）时可达
- **零外部命令依赖**：只用 Node 内置 `fs` / `path`，不启动任何子进程，无启动预检、
  无兜底链（AGENTS.md S3）
- **UI 入口**：Lightbox 右侧 `ⓘ` 面板的「删除这张照片」区块可复制该命令；封面照片
  只显示「封面照片 · 不可删除」标注、不给复制按钮
- **git 不自动化**：脚本不执行也不打印 git 命令，成功时只输出一行提示，避免连删
  多张时刷屏；两个仓库的提交仍需人工完成

## 数据一致性报告（2026-09-30 新增）

`npm run photos` 末尾会打印一段「数据一致性检查」：

- 检查项：**孤儿派生文件**——`_thumb.webp` / `_display.webp` 找不到同名原图。
  它们会随 `data` 仓库一起部署（占体积、且说明原图已删但派生图漏删）
- 只报告，**不修改任何文件、不改变退出码、不调用任何外部命令**（含 git）；
  发现不一致时列出全部路径，并附一行可自行复制的 `rm` 清理命令文本
- 报告前缀用 `[不一致]` 而非 `[警告]`，避免与「输出无 GPS 警告即为成功」的既有
  判定口径混淆
- 刻意**不**机械检查 `../data` 仓库的 git 状态（用户 2026-09-30 决定），故本段零
  git 依赖；双仓库是否都已推送仍需人工留意（`del-photo` 收尾提示是弱提醒）

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
  拿不到；HEIC 的 EXIF 由 exifr 直接读（见上文 HEIC 小节）

### 提取与分类

- 与 `DateTimeOriginal` **共用同一次 `exifr.parse`**（`pick: ['DateTimeOriginal',
  'Make', 'Model']`），不额外多读一遍 EXIF
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
- 前缀刻意不用 `[警告]`，避免与「输出无 GPS 警告即为成功」的既有判定口径混淆
  （同数据一致性报告的既定做法）

### 前端配合

- `MapChildren.jsx` 的 `DeviceBadgeIcon` 组件做枚举 → **内联 SVG** 映射，渲染在角标
  文本段之后（`时间 · 格式 · 图标`）；**`flattenPhotos` 必须透传 `device`**，否则
  "按照片分组"模式角标丢图标——与 `displayLink` 当初漏透传是同一类坑
- **图标不用 emoji**（2026-09-30 修订）：彩色 emoji 的配色固定在位图字体里、CSS
  `color` 完全无效，`📷` 的深灰机身叠在角标半透明黑底 + 深色照片上明度差≈0，
  实测等于隐形；且 emoji 字形跨平台差异大。SVG 用 `stroke="currentColor"` 继承
  角标白色，任何底图与平台都清晰
