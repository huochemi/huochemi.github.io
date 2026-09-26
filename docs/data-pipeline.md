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

- 可能的后续方案：sips 额外生成 web 浏览版（如长边 2048px JPEG），
  `webViewLink` 指向它；HEIC 原图只留本地存档（还能省 GitHub Pages 仓库体积）
- 2026-09-25 用户决策：本次只修缩略图，此项遗留

## GPS 坐标缺失策略（2026-09-25 新增）

- **普通照片**缺 EXIF GPS：`exifr.gps()` 正常返回但无坐标（不抛异常），构建期打
  `console.warn` 并跳过 lat/lng 字段；前端 `flattenPhotos` 有
  `photo.lat ?? group.lat` 回退，照片会钉在所属文件夹封面坐标上（位置可能不精确，
  属可接受降级）
- **封面照片**缺 GPS：仍为硬 error（throw 退出），因为组级坐标直接来自封面，
  不能降级
- 警告文案点明"回退为封面坐标"后果，保证警告可操作
- **补坐标工具 `fix-gps.js`**（`npm run fix-gps [-- 文件夹]`）：交互式从同文件夹内有
  GPS 的照片（按拍摄时间就近推荐）复制坐标写入目标原图 EXIF（exiftool
  `-overwrite_original`，依赖 `brew install exiftool`），并排预览两张照片辅助确认；
  修复后重跑 `npm run photos` 警告消失。依赖外部命令 exiftool，缺失即报错退出（不兜底）

## 展示图档位 displayLink（2026-09-25 新增）

### 背景

Lightbox 高清图原先直接用 `webViewLink`（原始 JPG 2~5MB/张），首开大图要完整
下载数 MB，是"打开大图很慢"的根因。

### 方案

在缩略图（300px）与原图之间新增展示图档位：长边限制 1920px、WebP、quality 75，
命名 `<原文件名>_display.webp`，单张 129~390KB（约为原图 1/10）。

- `process-photos.js`：`generateDisplayImage()` 与缩略图同流程（HEIC 同样走
  sips 转码兜底），输出 `displayLink` 字段（组级封面 + 每张照片均有）
- 前端 `MapChildren.jsx`：Lightbox 高清 `<img>` 与前后张预加载优先用
  `displayLink`（fallback `webViewLink` → `thumbnailLink`）；
  `flattenPhotos` 必须透传 `displayLink`，否则"按照片分组"模式退化为原图
- "查看原始文件"入口仍指向 `webViewLink` 原图

### 历史数据补齐

2026-09-25 用一次性脚本从线上拉原图生成了全部 60 张 `_display.webp` 并注入
`output.json`（展示图与缩略图/原图同目录，即流水线的 `IMGS_DIR`：
仓库外的 `/Users/chenyang/source/huochemi/data/photos/<dirName>/`）。
按用户现有流程随 `data/photos` 一起部署即可。
