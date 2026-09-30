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
- **手动指定参照**（2026-09-27 新增）：自动推荐的参照不合适时，可按 `q` 退出后用
  `npm run fix-gps -- 文件夹 --target 目标文件名 --ref 参照文件名` 点名参照（仅限同
  文件夹，仍走预览确认，`--yes` 跳过确认）；`--ref` 缺省时指定目标走自动推荐。
  交互流程中每次展示参照时会在按键提示上方打印这条命令实例（含真实文件夹/文件名）
  及本文件夹可用参照清单（≤5 张时列出），无需查文档。约束：目标必须缺 GPS（已有
  GPS 不做覆盖，报错退出）；参照必须有 GPS；ref/target 文件不存在或不是可处理的
  图片文件均报错退出。文件夹内没有任何带 GPS 参照时，交互会提示从手机导出一张
  当时在附近拍的照片放入该文件夹后重跑

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

## 删除照片 `npm run del-photo`（2026-09-30 新增）

计划与决策记录：`docs/plans/2026-09-30-photo-deletion-workflow.md`。

```
npm run del-photo -- "<文件夹名>" "<文件名>"     # 需在站点仓库根目录执行
```

`delete-photo.js` 的流程：参数/路径校验（拒绝 `..` 与路径分隔符）→ 封面硬拦 →
「删后为空」硬拦 → 删除原图 + `<名>_thumb.webp` + `<名>_display.webp` → 打印一行
提示（`output.json` **尚未更新**，需自行执行 `npm run photos`）。

**刻意不自动重跑管线**（2026-09-30 修订 v4，源自用户反馈）：删单张的耗时几乎全是
重跑管线（175 张全量约 15s），连删多张就要为每张付一次等待。改后单次执行降到毫秒级，
由用户攒够了一次性跑 `npm run photos`。代价有两条：① 即时校验变延迟校验——v3 里
"删完立刻重跑"顺带充当了一道校验，管线报错当场暴露，现在要等下一次重跑；但删**之前**
的两道硬拦（封面、删后为空）不依赖管线，删除动作本身的安全性不变；② `output.json`
与磁盘会短暂不一致——网页上该照片仍在、缩略图破图，直到重跑。

关键约定与理由：

- **封面不可删除**（硬 error 退出）：封面提供该分组的坐标与缩略图来源，必须由人先改
  `index.json` 的 `index_photo`（新封面必须有 GPS）再来删。**不做**自动挑替补救封面
- **原图直接删除、不进回收站**（用户 2026-09-30 决定）：执行该命令本身即为破坏性操作
  的当次确认，故不加二次确认提示，保住"粘贴即跑"；代价是不可恢复
- **「删后为空」也硬拦**：管线要求每组至少 1 张原图；整组下线需手动删文件夹
- **两道硬拦的执行顺序**：封面校验排在「删后为空」**之前**，所以正常数据里删除只剩
  一张的组时，先命中"封面不可删除"；「删后为空」实际只在 `index.json` 的
  `index_photo` 已失效（指向一张已被删掉的照片）时才可达——这正是 2026-09-30 郑州
  组的真实状态（封面被手工从 `IMG_8201.JPG` 改成 `DSC06233.JPG`）。两道拦都在删除
  动作之前执行，拒绝时目录零变化
- **零外部命令依赖**：只用 Node 内置模块 `fs` / `path`，**不启动任何子进程**
  （v4 起 `child_process` 已移除），没有启动预检、没有兜底链（AGENTS.md S3）
- **UI 入口**：Lightbox 右侧 `ⓘ` 面板的「删除这张照片」区块可复制该命令。封面照片
  只显示「封面照片 · 不可删除」标注、不给复制按钮。封面判定由 `output.json` 的
  组级 `fileName`（= 封面名）与当前照片 `fileName` 比较得出；**照片分组模式下**组级
  封面名由 `flattenPhotos` 下发的 `coverFileName` 提供（照片模式下选中项就是照片
  自身，用 `selectedGroup.fileName` 判定会恒为真）
- **git 不自动化**：脚本不执行任何 git 操作，也不打印完整命令；成功时只输出一行提示
  （`output.json` 尚未更新 → 跑 `npm run photos` → 提交 `../data` 与本站点两个仓库），
  避免连删多张时刷屏

## 数据一致性报告（2026-09-30 新增）

`npm run photos` 末尾会打印一段「数据一致性检查」：

- 检查项：**孤儿派生文件**——`_thumb.webp` / `_display.webp` 找不到同名原图。
  它们会随 `data` 仓库一起部署（占体积、且说明原图已删但派生图漏删）
- 只报告，**不修改任何文件、不改变退出码、不调用任何外部命令**（含 git）；
  不一致时列出全部路径，并附一行可自行复制的 `rm` 清理命令文本
- 报告前缀用 `[不一致]` 而非 `[警告]`，避免与「输出无 GPS 警告即为成功」的既有
  判定口径混淆
- 已知现存孤儿：`乌兰察布市集宁区-北官房铁路小区3号楼附近/` 的 `IMG_5184`、
  `IMG_5185` 各 2 个派生文件（原图已删）——清理与否由用户决定
- 刻意**不**机械检查 `../data` 仓库的 git 状态（用户 2026-09-30 决定），故本段
  零 git 依赖；双仓库是否都已推送仍需人工留意（`del-photo` 收尾的一行提示是弱提醒）
