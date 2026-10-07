# 参考图并回主管线：源图进原图仓 refs/ → 管线压 → data 仓 refs/

状态：**已实施（2026-10-07）** —— 通道选**甲**（用户 2026-10-07 拍板"我觉得甲合适"）；
实现与验收记录见文末。
日期：2026-10-07
来源会话：参考点位功能（`2026-10-07-ref-places.md`）上线后，用户对参考图的**入库通道**
提出三点质疑，逐条核实代码后确认是设计缺陷 —— 参考图被做成了主管线旁边的一条**旁路**：
① "这里有好多步骤可以做成工具的，你为啥让我自己做…我觉得太繁琐了"；
② "为什么我们不能做成跟之前其他管线相同的处理步骤呢，之前也是你会跑脚本将图片给压缩了，
我觉得完全可以复用"；
③ "为啥你会把名字给改成 01，这样的名字，这样会造成丢失原始文件名的，之前压缩之后也会把
文件名改成这样的吗"。
相关：`docs/plans/2026-10-07-ref-places.md`（参考点位主方案，本文件**受控修订**它）、
`docs/plans/2026-10-04-data-repo-longevity.md`（双根结构、母线闸门的来历）、
`docs/plans/2026-10-05-photos-no-empty-dir.md`（"管线不自动建目录"，
本文件**受控修订**它）、`docs/plans/2026-10-05-photos-incremental-skip.md`（增量复用）、
`docs/photo-ops.md`（参考点位运维）、`AGENTS.md`（S1 原图仓定位、S3 不兜底）

## 背景（自包含，零上下文可读）

站点是火车迷的照片地图，一个点位 = data 仓的一个目录。还没去过的点位走**参考态**：
原图仓没有媒体文件时，管线读 `refs/point.json` 的坐标（GCJ02）与 `refs/` 里的参考图，
产出 `pinKind: 'ref'` 的条目 —— 地图上出现橙色虚线图钉，点开能看参考图、能唤起高德导航。

**现状（本次要改的）**：参考图这条通道被设计成了主管线的**旁路**——

| 环节 | 实拍照片（主管线） | 参考图（现状·旁路） |
|---|---|---|
| 源图放哪 | 原图仓 `photos/<点位>/` | **data 仓** `photos/<点位>/refs/` |
| 谁压缩 | `npm run photos`（sharp 生成两个档位） | **用户手敲 `sips`** |
| 压缩档位 | `_thumb.webp` 300px / `_display.avif` 1920px | 1024px / q70，一档到底 |
| 文件名 | **保留原名**（`IMG_5165.HEIC` → `IMG_5165_display.avif`） | **重命名为 `01.jpg` / `02.jpg`** |
| marker 用图 | `_thumb.webp`（23–26 KB） | 整张图（≈235 KB） |
| 封面怎么定 | `index.json` 的 `index_photo` **显式指名** | **字典序第一张**，所以逼人命名 `01` |

## 事实核查：主管线压缩**从不改名**（回答用户第 ③ 问）

代码实读（非推断）：

- `process-photos.js:80-81` — `const THUMB_SUFFIX = '_thumb.webp'` / `DISPLAY_SUFFIX = '_display.avif'`
- `process-photos.js:1297-1298` — `const thumbFileName = \`${parsed.name}${THUMB_SUFFIX}\``
  ⇒ 后缀**拼在 `path.parse(file).name` 之后**，原名一个字符都不动。
- `process-photos.js:1374/1380` — `output.json` 的 `fileName` 写的是 `file`（原图名）

实测样本（现网 `output.json`）：

| 原图名 | 缩略图 | 展示图 | `fileName` 字段 |
|---|---|---|---|
| `IMG_5165.HEIC` | `IMG_5165_thumb.webp` | `IMG_5165_display.avif` | `IMG_5165.HEIC` |
| `DSC04376.JPG` | `DSC04376_thumb.webp` | `DSC04376_display.avif` | `DSC04376.JPG` |

⇒ **`01.jpg` 这套编号是我在参考态这条旁路上新编的规则，与全部既有惯例相反，且确实会丢原名。**
它只出现在参考态一条线上：`process-photos.js:1020-1023`（预检 hint）、
`new-place.js:465,468`（`--wish` 的下一步提示）、`docs/photo-ops.md` 四处
（`:93,114,121,146,176`）、`test/ref-places.test.js` 多组断言。

## 根因：为什么会退化成"用户自己压 + 编号序号"

编号规则的**唯一动机**是封面：参考态的封面取 `photos[0]`，即**字典序第一张**
（`process-photos.js:1255` —— `const cover = photos[0]`），而参考态当初被设计成
"**零派生图、一档到底**"（`buildRefGroup` 注释，`:1228-1230`），于是封面没有可以承载
"指哪张"的字段 ⇒ 只能把担子甩给文件名 ⇒ 逼人命名 `01`。

而实拍态的封面是 `index.json` 的 `index_photo` **显式指名**
（`buildGroup:1408`：`images.find((image) => image.file === coverFileName)`）。

**两个不一致，同一个根因**：参考态没有并进主管线，所以它自己长出了一套输入约定
（自己压、自己编号）。命名只是这条旁路露出来的尾巴。用户第 ①② 问指向的正是旁路本身。

## 决策记录：甲 / 乙（用户 2026-10-07 拍板甲）

| 判据 | **甲（拍板）** 源图进原图仓 | 乙 源图留 data 仓就地压 |
|---|---|---|
| 源图位置 | `../photos-originals/photos/<点位>/refs/` | `../data/photos/<点位>/refs/`（现状） |
| 谁压缩 | `npm run photos`（复用既有 `generateThumbnail` / `generateDisplayImage`） | 管线就地压（读 data 仓、写 data 仓） |
| 文件名 | `<原名>`（与实拍态**同一条规则**） | 可保留原名 |
| data 仓 `refs/` 里最终 | 只有派生图 + `point.json` | 压好的派生图 **＋ 未压的源图** |
| 未压大图会不会进公开仓 | **不会**（源图在原图仓，data 仓的扩展名排除规则天然挡住） | **会** —— 得把 `.gitignore` 从"放行整个 `refs/`"收窄成"只放行派生后缀"，否则 8.9 MB 源图进公开仓 |
| `.gitignore` | **撤掉**那条放行 ⇒ 母片闸门回到**零例外** | 需反向收窄，规则更绕 |
| 与实拍态的结构 | **完全一样**（源图在原图仓、派生图在 data 仓） | 多一种"同仓自产自销"的形态 |
| 判据：少一条规则 | ✅ 少一条 `.gitignore` 例外、少一套命名规则 | ❌ 两样都多 |

⇒ **甲在每一条判据上占优，唯一代价是原图仓的定位被扩展了一层**（见下节）。

## 必须正面处理：原图仓的定位（对 D7 的受控修订）

`2026-10-07-ref-places.md` 的 **D7 明确写过"不把参考图放进原图仓（会污染该事实源）"**，
而甲方案恰恰要放进去。不回避，把口径写清：

- **D7 真正要禁止的两件事仍然禁止**：① 给参考图写 EXIF GPS（不碰 `fix-gps`）；
  ② 把参考图当成"我拍的照片"混进实拍体系（不参与设备识别、不参与缺坐标硬拦、
  不参与混合来源统计 —— 管线已按 `pinKind` 排除，`process-photos.js:1671-1676`）。
- **甲方案新增的是位置**：参考图住原图仓的 **`refs/` 子目录**。原 plan 已经确立
  "**参考态的全部痕迹落在 `refs/` 一个目录里**"（`refs/` 即"参考态开关"），所以
  "哪些是我拍的"这个问题仍可由**结构性判据**回答：

  | 位置 | 是什么 |
  |---|---|
  | 原图仓 `photos/<点位>/` **顶层** | 我拍的原片（真相源，不可再生） |
  | 原图仓 `photos/<点位>/refs/` | 参考图源图（他人的，可从来源重下） |
  | data 仓 `photos/<点位>/refs/` | 参考图派生图（**可再生**） |

  这个区分是**结构性的**（看在不在 `refs/` 里），不需要人记住任何新规则。
- **为什么源图必须进某一个仓的 git**：`2026-10-07-ref-places.md` 的 D6b 已经评估并
  **否决**过"让参考图走管线派生"，理由正是"那样源图谁都不存 ⇒ 派生图在换机器后无法重生
  成，破坏 data 仓『里面的东西都能重跑出来』这条契约"。甲方案必须正面满足这一点 ⇒
  源图进**原图仓的 git**（私有仓，放几张参考图没有 Pages 配额压力，与 data 仓的 1 GB
  台账无关）。
- ⚠️ **如实记录一个残余风险**：原图仓的定位从"只有原片"变成"原片 + `refs/` 里的参考图"。
  缓解三件：① `refs/` 目录名自带含义；② 原图仓 `.gitignore` 已排除
  `*_thumb.webp` / `*_display.avif` / `*_web.mp4`（防误拷），误放派生图会被挡住；
  ③ 本文件与 `docs/photo-ops.md` 各写一处口径。

## 实现方案

### D1 判定点：不变（唯一，仍是"原图仓顶层有没有媒体"）

| 原图仓 `photos/<点位>/` **顶层** | 阶段 | 组级坐标来源 |
|---|---|---|
| 有媒体文件 | 实拍态 | 封面 EXIF（现状） |
| 无媒体文件 | 参考态候选 | `refs/point.json` 的 `lng`/`lat`（GCJ02） |

读的是**顶层**（`fs.readdir`，不下钻）⇒ `refs/` 里的图不会被当成"我拍的照片"
（`preflightDir:1083-1094` 的 `mediaFiles` 过滤）。这条前提原 plan 已核实，本次不变。

### D2 源图位置（新）

```
../photos-originals/photos/<点位>/
    refs/
        <你下载的原名>.jpg      ← 原样放：不压缩、不改名、不写 EXIF
```

- 格式：`.jpg` / `.jpeg` / `.png` / `.webp` / `.avif`（沿用 `REF_IMAGE_EXTS`，`:59`）
- **不支持视频**（`REF_IMAGE_EXTS` 不含 `.mp4`）—— 如实记为已知限制，见「出界清单」

### D3 派生图与命名（新，与实拍态同一条规则）

管线用**既有**两个函数为每张参考图生成两个档位，写到 data 仓：

| 生成函数（现成，不改） | 输出 | 档位 |
|---|---|---|
| `generateThumbnail`（`:239`） | `../data/photos/<点位>/refs/<原名>_thumb.webp` | 300×300（`:77`） |
| `generateDisplayImage`（`:285`） | `../data/photos/<点位>/refs/<原名>_display.avif` | 长边 1920（`:118`） |

- 命名 = `<原名>` + 既有后缀常量（`THUMB_SUFFIX` / `DISPLAY_SUFFIX`）⇒ **零新规则**。
- **`01.jpg` 那套编号规则作废**，`new-place.js` 与 docs 里的 `sips` 命令一并删掉。
- 两个函数**自带增量复用**（`derivedIsUpToDate`，`:333`）⇒ 重跑时参考图派生图走"复用"，
  免费获得与实拍态一致的增量语义；也会计入 `reportDerivedStats` 的汇总。
- **顺带收益**：marker 不再拉 235 KB 整图，改用 23–26 KB 的 `_thumb.webp`
  ⇒ 原 plan「风险」里那条"一档到底的代价（首屏 marker 流量）"**自动消失**。

### D4 封面：`refs/point.json` 增加**可选** `cover` 键（对齐 `index_photo`）

```json
{
  "lng": 112.6201,
  "lat": 26.8839,
  "cover": "2021022708_pdf-page1-image9.jpg"
}
```

- 值是**原图文件名**（含扩展名），语义与 `index.json` 的 `index_photo` 完全一致
  ⇒ 想换 marker 用图**改一个字段，不用改名**。
- **不填 ⇒ 字典序第一张**（保持现状默认行为，向后兼容）。
- 填了但不在参考图清单里 ⇒ **报错并列出候选**（不静默忽略、不猜）。
- 校验类型：字符串；非字符串视为错误（与 `lng`/`lat` 同口径：不替人猜）。
- ⚠️ **为什么不住 `index.json`**（如实记录这处与实拍态的不对称）：`index_photo` 对实拍态
  是**长期元数据**（点位一直有照片）；`cover` 是**参考态专属**信息（去过之后无意义）⇒
  住 `refs/`，去过之后随 `rm -rf refs/` 一起消失，不留"要记得回来删"的字段。这与主方案
  D2（"坐标不进 `index.json`"）是同一条判据。

### D5 撤掉 data 仓 `.gitignore` 的放行（母片闸门回到零例外）

走甲之后，进 data 仓 `refs/` 的只有三种文件，后缀**本来就不在排除名单里**
（名单：`*.mp4` / `*.JPG` / `*.jpg` / `*.HEIC` / `*.heic` / `*.jpeg` / `*.JPEG`）：

| 会进 data 仓 `refs/` 的文件 | 后缀是否被排除 | 结果 |
|---|---|---|
| `<原名>_display.avif` | 否 | 天然放行 |
| `<原名>_thumb.webp` | 否 | 天然放行 |
| `point.json` | 否 | 天然放行 |
| `<你误放的源图>.jpg` | **是** | **被挡**（正是我们要的） |

⇒ **撤掉 `!photos/*/refs/**` 及其注释**，`.gitignore` 回到
`2026-10-04-data-repo-longevity.md` 定下的原样（零例外）。
这比"加一条放行"更符合用户 2026-10-07 那句"不能删这条规则"的初衷 —— 现在不仅不删，
连例外都不需要了。

### D6 错仓提示（新增）：把"放错仓"从静默变成显式报错

迁移时用户手上正好有 3 张**放在 data 仓**的源图（8.9 MB），且这是新通道最容易踩的坑。
默认表现却是"被 `.gitignore` 静默挡住 + 管线报一句含义模糊的『`refs/` 下没有图片文件』"。

⇒ 预检参考态失败时**多看一眼**：若**原图仓 `refs/` 里没有图**、而 **data 仓 `refs/` 里有
非派生后缀的图片**，报错文案改为明确指出"参考图应放**原图仓**"，并附现成命令：

```
    mv "<data 仓 refs/ 里的文件>" "<原图仓 refs/>"
```

只读检查、不改任何文件；只在失败路径上多一句，不影响成功路径。

### D7 孤儿派生图检查扩展到 `refs/` 一层（建议，可延后）

`reportInconsistencies`（`:465`）现在只扫点位目录**顶层** ⇒ 参考态的派生图在 `refs/`
子目录里、**完全无保护**（源图被删或改名后，孤儿派生图不会被发现）。

建议原媒体基名集合与孤儿扫描各加一层 `refs/`（约 20 行），让孤儿检查对两种形态一视同仁，
省掉"参考态是孤儿检查的盲区"这个要记住的例外。

⚠️ 注意不能因此破坏"扫描不下钻"这条前提 —— 它说的是**顶层媒体清单**不下钻（`refs/` 的图
不能被当成实拍照片），而这里是要**单独多扫一个已知子目录**，两者不冲突。

### D8 前端：预期**零改动**（实施时复核一次）

`output.json` 里参考态与实拍态仍字段同形，所有 `pinKind` 分支逻辑不变。仅两处取值变化：

| 字段 | 现状 | 改后 |
|---|---|---|
| `fileName` | `refs/01.jpg`（带子目录前缀） | `<原名>.jpg`（裸名，**对齐实拍态**） |
| `thumbnailLink` / `displayLink` | 同一个值（整图） | 分别是 `_thumb.webp` / `_display.avif`（对齐实拍态） |

⚠️ 实施时**复核一次** `src/` 里对 `fileName` 的用法（原 plan 核实过"前端只把两个 Link
当字符串用、无 `/data/` 前缀假设"，但那是在 `fileName` 带 `refs/` 前缀的前提下核实的）。

## 改动清单

### `process-photos.js`

| # | 位置 | 现状 | 改成 |
|---|---|---|---|
| 1 | `preflightRefPlace`（`:961`） | 从 **data 仓** `dirPath/refs/` 列图（`:997-1013`） | 从**原图仓** `ORIGIN_DIR/<点位>/refs/` 列图；解析可选 `cover` 并校验（D4）；失败 hint 改为"放原图仓"（删掉 `sips` 命令，`:1020-1023`） |
| 2 | `preflightDir`（`:1052`） | `return preflightRefPlace(dirName, dirPath, indexConfig)`（`:1119`） | 透传原图仓路径；`mediaFiles.length === 0` 那条分叉与实拍态文案**逐字不变** |
| 3 | `buildRefGroup`（`:1242`） | 同步函数、零派生图、`fileName: 'refs/01.jpg'`、链接 = 整图 | **改 async**：为每张图生成两档派生图到 data 仓 `refs/`；`fileName` = 裸原名；两个 Link 指向派生图（D3）；封面取 `point.cover` 或字典序第一（D4） |
| 4 | `buildGroup`（`:1283`） | `if (refImages) return buildRefGroup({...})`（`:1292`） | 改为 `await`，并透传 `originDirPath` |
| 5 | `collectStaleRefsDir` / `reportStaleRefsDirs`（`:629` / `:646`） | 只登记 data 仓 `refs/` | **两处都登记**（原图仓 + data 仓），提示里的 `rm -rf` 覆盖两个目录；计数加 `!isDerivedFile` 过滤（数的是源图/派生图，不是 `point.json`） |
| 6 | 新增（预检失败路径） | — | 错仓提示（D6） |
| 7 | `reportInconsistencies`（`:465`） | 只扫顶层 | （D7，建议）扩展 `refs/` 一层 |
| 8 | 常量注释块（`:41-63`）与 `REF_IMAGE_EXTS` 注释（`:56-59`） | 写"`refs/01.jpg`…字典序第一张即 marker 用"、"不做转码、不生成派生档位" | 改写为"`refs/<原名>`…派生图由管线生成、封面由 `point.json` 的 `cover` 指定" |

`module.exports`（`:1730`）保持不变（导出的常量与函数名不动）。

### `new-place.js`

| # | 位置 | 现状 | 改成 |
|---|---|---|---|
| 1 | `createWishPlace` 写入（`:440`） | 只建 data 仓 `refs/` | **同时建原图仓** `refs/`（`ORIGIN_DIR/<点位>/refs/`），让"图往哪放"在文件系统上就是明确的 |
| 2 | 提示文案（`:460-474`） | "压好放进 data 仓 `refs/`，命名 `01.jpg`…" + `sips` 命令 | "把下载的图**原样**放进原图仓 `refs/`（不压、不改名）→ `npm run photos`"；另提一句 `point.json` 的 `cover` 可指定 marker 用图 |
| 3 | 常量 `REF_IMAGE_MAX_PX` / `REF_IMAGE_QUALITY`（`:96-97`） | 供提示文案用 | **删除**（管线用既有档位 `THUMB_SIZE`/`DISPLAY_SIZE`，不再需要第二套数字） |
| 4 | `tryUpgradeRefPlace` 收尾提示（`:293-297`） | `rm -rf "<data 仓 refs/>"` | 覆盖**两个** `refs/`（原图仓 + data 仓） |
| 5 | 文件头注释（`:59-66`） | "参考图由**用户自己**下载并压缩后放进 data 仓的 `refs/`" | 改写为"源图放原图仓 `refs/`（本工具不代下），压缩由 `npm run photos` 负责" |

`parseArgs` / `parseCoord` / `assertPlainName` / `tryUpgradeRefPlace` 的**签名与语义均不变**
（只改提示文案与新增一个 mkdir），现有单测基本可复用。

### 其他文件

| 文件 | 改动 |
|---|---|
| `../data/.gitignore` | **撤掉** `!photos/*/refs/**` 与其整段注释（D5） |
| `../data/photos/衡阳市-湘江公铁大桥道口/refs/` | 现有 3 张未压源图（8.9 MB）**移出**该目录；管线重跑后这里只剩派生图 + `point.json` |
| `../photos-originals/photos/衡阳市-湘江公铁大桥道口/refs/` | **新增**（放源图） |
| `test/ref-places.test.js` | 断言改写：`01.jpg` → 原名；新增 `cover` 分支（有/无/非法）；新增"派生图生成到 data 仓 `refs/`"；`preflightRefPlace` 的目录参数变化 |
| `docs/photo-ops.md` | 「参考图：放哪、压多大」整节改写（位置 / 命名 / 谁压 / `cover` / `.gitignore` 那节删掉放行说明）；「失败语义」表更新；「三条不下钻前提」补一句 |
| `docs/plans/2026-10-07-ref-places.md` | 追加「受控修订（2026-10-07）：参考图并回主管线」节，指向本文件；标注 D6b（放行）**已撤销**、D6c（命名与档位）**被取代**、D7（不碰原图仓）**部分修订**、管线改动 #3（`buildGroup` 参考态分支）**被取代** |
| 前端 `src/` | **不动**（实施时复核 `fileName` 用法一次） |

**不新增**任何 npm 脚本、不引入新依赖（复用既有 sharp + sips 链路）。

## 出界清单（本次明确不做）

- **不支持参考态放视频**（`REF_IMAGE_EXTS` 只收图片）：视频需 ffmpeg 转码 + `_thumb` 抽帧，
  与"参考图"的用途（看一眼环境）不匹配 ⇒ 记为已知限制，需要时另开
- **不给参考图写 EXIF GPS**、不碰 `fix-gps`（原 plan D7 仍然有效）
- **不把源图放进 data 仓**（撤回 D6b 的放行口子）；也不靠 `.webp`/`.avif` 扩展名绕规则
- **不做**"参考图数量超过 N 张就警告"之类的软规则（脚本不替人拍板）
- **不做**参考图水印/裁剪/EXIF 剥离等加工（管线只做尺寸档位，与实拍态一致）
- **不做**"参考图档位单独配置"（用管线的 300/1920，不引入第二套数字）

## 验收标准

1. **通道打通**：把 3 张原图（原样、不改名）放进原图仓 `refs/` → `npm run photos` →
   data 仓 `refs/` 里出现 `<原名>_thumb.webp` + `<原名>_display.avif`，
   **源图不在 data 仓**。
2. **字段对齐**：`output.json` 里参考态条目 `fileName` = 裸原名；`thumbnailLink` →
   `_thumb.webp`、`displayLink` → `_display.avif`；`pinKind: 'ref'`；
   坐标 = `point.json` 的 GCJ02（原样透传，不经 `convertFrom`）。
3. **封面**：不填 `cover` ⇒ 字典序第一张（与现状默认一致）；填 `cover` ⇒ 指定那张成为
   `photos[0]` 与组级链接；填了不存在的名字 ⇒ 报错并列出候选清单。
4. **闸门完好**：`cd ../data && git check-ignore -q "photos/<任一点位>/refs/<名>_display.avif"`
   ⇒ 退出码 1（放行）；`…/refs/<名>.jpg`（源图误放）⇒ 退出码 0（**被挡**）；
   `…/IMG_0001.JPG` ⇒ 退出码 0（仍被挡，母片闸门零例外）。
5. **错仓提示**：把图放 data 仓 `refs/`、原图仓 `refs/` 空着 ⇒ 管线报错明确指出
   "应放原图仓"并给出 `mv` 命令（不是模糊的"`refs/` 下没有图片文件"）。
6. **零回归**：实拍态点位的 `output.json` **逐字段不变**（比对改造前后）。
7. **增量**：紧接着再跑一次 `npm run photos` ⇒ 参考图派生图计入"复用"而非"重新生成"。
8. **前端零改动**：参考态点位在地图上是橙色虚线图钉 + 「参考」角标；点开能看大图与
   `ⓘ` 面板；`ⓘ` 里不出现删除命令、坐标标题是「点位坐标（人工标注，GCJ02）」。
9. **切档不变**：`new-place --cover` 对参考态仍只新增 `index_photo` 一个键；
   收尾提示给出**两个** `refs/` 的 `rm -rf`。
10. **门禁**：`npm run test:cli` 全绿；`eslint src test --max-warnings=0` 零 warning
    （CI 把 warning 当 error）。

## 风险

- **原图仓定位被扩展**（本方案唯一实质风险）：`refs/` 里住的不是原片。缓解见
  「必须正面处理」节（结构性判据 + 目录名自带含义 + 原图仓 `.gitignore` 已排除派生后缀）。
- **撤掉放行后，源图误放 data 仓会被静默挡住**：缓解 = D6 的显式错仓报错。
- **参考图变成"两仓各一份"**：源图在原图仓、派生图在 data 仓 —— 这与实拍照片的结构
  **完全一致**（不是新概念）；代价是"原地改源图后必须重跑 `npm run photos`"，
  与实拍态同一语义。
- **`refs/` 里多了一层派生图**：靠"顶层媒体清单不下钻"隔离（已验证）；D7 若实施，
  是**单独多扫一个已知子目录**，不改变这条前提。
- 破坏性风险：**低**。撤 `.gitignore` 一条放行是**收紧**（不是放宽）；其余全是改脚本提示
  文案与新增分支，不删除任何既有判定。

## 实施顺序

1. 改 `process-photos.js`（参考态一族 7 处）+ `test/ref-places.test.js` → 门禁跑绿
2. 改 `new-place.js`（5 处）+ 复用/补单测
3. 撤 `../data/.gitignore` 那条放行，并用 `git check-ignore -q` 看退出码复验（标准 4）
4. 迁移衡阳那 3 张源图：`../data/.../refs/` → `../photos-originals/.../refs/`
5. 跑 `npm run photos` 验端到端（标准 1/2/3/5/7）
6. 改 docs（`photo-ops.md` 那节 + 旧 plan 追加「受控修订」指针）
7. 提交推送：**data 仓先于站点仓**（避免线上引用断裂）

## 实现与验收记录（2026-10-07）

按「实施顺序」逐条执行完毕，每条验收标准都有实测证据。

| 标准 | 结果 |
|---|---|
| 1 通道打通 | ✅ 3 张源图（原样、原名）放原图仓 `refs/` → `npm run photos` → data 仓 `refs/` 出现 6 个派生图（`<原名>_thumb.webp` + `<原名>_display.avif`）；源图**不在** data 仓 |
| 2 字段对齐 | ✅ 参考态条目 `fileName` = 裸原名 `2021022708_pdf-page1-image2.jpg`；`thumbnailLink` → `_thumb.webp`、`displayLink` → `_display.avif`；`pinKind: 'ref'`；坐标 = `point.json` 的 GCJ02（`112.6201, 26.8839` 原样透传，不经 `convertFrom`） |
| 3 封面 | ✅ 不填 `cover` ⇒ 字典序第一张（`…image2.jpg`）；单测另覆盖"填合法 cover ⇒ 指定那张成为 `photos[0]` 与组级链接"、"填不存在的名字 / 非字符串 ⇒ 报错并列出候选" |
| 4 闸门完好 | ✅ 退出码实测：`refs/x_display.avif` → 1（放行）、`refs/x_thumb.webp` → 1、`refs/point.json` → 1、`refs/x.jpg`（源图误放）→ **0（被挡）**、`IMG_0001.JPG` → 0、`IMG_0001.HEIC` → 0 |
| 5 错仓提示 | ✅ 端到端实测：源图移到 data 仓 `refs/`、原图仓 `refs/` 空着 ⇒ 管线报「参考图放错仓了：源图应放**原图仓**…」并给可复制的 `mkdir -p … && mv …` |
| 6 零回归 | ✅ 19 条实拍态条目改造前后**逐字段**比对：无变化 |
| 7 增量 | ✅ 紧接着再跑 ⇒ 「复用 672 个、重新生成 0 个」 |
| 8 前端零改动 | ✅ 复核 `src/` 对 `fileName` 的 4 处用法：`formatFileExt`（取扩展名）、`coverFileName` 相等比较、信息面板展示、`del-photo` 命令（已 `!isRef` 前置）——**均无 `/data/` 或 `refs/` 前缀假设**。实际改动**仅 1 行注释**（`MapChildren.jsx` 里"扩展名（`refs/01.jpg`）也不代表任何东西"这句举例已过时，去掉） |
| 9 切档不变 | ✅ 单测覆盖：`new-place --cover` 对参考态仍只新增 `index_photo`，其余键逐字保留、`refs/` 不动；收尾提示的 `rm -rf` 现覆盖**两处** `refs/` |
| 10 门禁 | ✅ `npm run test:cli` **161 全绿**（`ref-places.test.js` 重写后 37 条）；`eslint src test --max-warnings=0` 零 warning |

**D7（建议项）也做了**：一致性检查现在会单独多扫 `refs/` 一层（不递归）。端到端实测：
把源图移走后重跑 ⇒ 「❗ 发现 6 个孤儿派生文件」，前缀标到 `衡阳市-湘江公铁大桥道口/refs/`，
`rm` 命令可直接复制。

**实现中的一处调整（与设计稿的差异，如实记录）**：D6 的错仓检测只写在「原图仓 `refs/`
里没有图」这条失败路径上——实测确认，若原图仓 `refs/` **有**图（正常态）而 data 仓 `refs/`
里多了一张源图，管线**不会**报错（那张图被 `.gitignore` 挡住，也不被当成派生图，属"放错但
无害"）。这与 D6 的字面设计一致（前提本就是"原图仓没有图"），未扩大检测范围——避免把
"用户有意在 data 仓留一份"误判成错误。

**已知未做（不阻塞）**：参考态不支持视频（`REF_IMAGE_EXTS` 只收图片，见「出界清单」）。
