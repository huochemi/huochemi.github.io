# 删除照片的工作流：一条可复制命令 + 管线一致性报告（修订版方案 v3）

状态：已实现（2026-09-30；/tmp 镜像目录验收 35 项全通过；eslint `--max-warnings=0`
通过；CI build 按 `docs/toolchain.md` 门禁交用户终端执行；UI 观感待用户 `npm start` 验收）
日期：2026-09-30

## 背景（自包含，零上下文可读）

站点是照片地图（React 18 + @uiw/react-amap + GitHub Pages），照片真实数据源在
**仓库外**的 `../data/photos/<文件夹>/`：

- 每个文件夹一个 `index.json`，`index_photo` 指定封面（封面必须存在且有 GPS，
  否则 `process-photos.js` 直接 throw 退出）
- `npm run photos`（`process-photos.js`）全量扫描，为每张原图生成
  `<名>_thumb.webp`（300px）与 `<名>_display.webp`（1920px），并写出
  `src/Application/output.json`
- 前端只消费 `output.json`；Lightbox 右侧 `ⓘ` 信息面板已展示「文件名 +
  所属文件夹」（`2026-09-28-lightbox-photo-filename.md` /
  `2026-09-27-lightbox-info-panel.md` 已实现）
- 发布要动**两个仓库**：`../data`（照片与派生 webp）与站点仓库（`output.json`）

### 现状：删一张照片 = 9 步人工操作

① UI 开 Lightbox → `ⓘ` 抄「文件名 / 文件夹」 ② 终端进 `../data/photos/<文件夹>/`
③ 对照 `index.json` 确认不是封面 ④ 删 3 个文件（原图 + thumb + display）
⑤ `npm run photos` ⑥ 通读警告 ⑦（可选）`npm start` 本地预览
⑧ `git commit/push` data 仓库 ⑨ `git commit/push` 站点仓库

### 实测证据（2026-09-30，均在 /tmp 副本上跑，未触碰生产数据）

- **重跑不是瓶颈**：79 张（保定 60 + 石景山 19 + 郑州 6）全量管线 wall 6.9s、
  user CPU 25s；单张 JPG(6.6MB) thumb 48ms + display 169ms，HEIC 经 sips 转码
  后约 433ms → 全量 175 张约 15s 量级。故**不做增量跳过优化**。
- **真正的痛在三处人工环节，且已留痕**：
  - 孤儿派生文件：`乌兰察布市集宁区-北官房铁路小区3号楼附近/` 原图 44 张，
    但 `_thumb/_display` 各 46 个 → `IMG_5184`、`IMG_5185` 的 4 个派生文件成孤儿
    （管线不清理、会被一起部署）
  - 封面坑真实发生过：`data/photos/郑州/index.json` 的封面已从 `IMG_8201.JPG`
    （已被删）手工改成 `DSC06233.JPG`
  - 双仓库漂移：`../data` 现有 61 处未提交改动，其中 `保定-保定站附近永瑞园/`
    （60 张）、`郑州市-解放路跨铁路桥/`、`郑州市-铁道丽景苑/` 是**未跟踪**目录，
    而站点仓库 `output.json` 已引用它们——本地预览正常（`setupProxy.js` 走本地
    目录），线上很可能是 404（**本方案不机械拦截，靠人工留意**，见"已拍板"3）

## 已拍板（2026-09-30，用户决定）

1. **原图删除方式 = 直接删除（方式 C）**：`fs.unlink` 原图与两张派生 webp，
   **不使用系统回收站、不做 `../data/.trash` 暂存**。附带好处：脚本不再依赖
   `osascript`，变成纯 Node，无新外部命令依赖，也不会弹自动化授权。
   已知代价（用户已知悉并接受）：原图不可再生，删除即不可恢复；用户主动在终端
   执行该命令本身即为破坏性操作的当次确认（AGENTS.md P2 门②），故脚本不再加
   交互式二次确认，保住"粘贴即跑"的体验。
2. **复制出去的命令形式 = `npm run del-photo -- "<文件夹>" "<文件名>"`**：
   终端需位于站点仓库根目录（UI 提示里写明）。
3. **一致性报告不做「`../data` 仓库状态」检查**：该段由此**完全不依赖 git**，
   只剩文件系统比对（读目录 + 文件名配对）。代价：双仓库漂移没有自动提醒，
   依赖 `del-photo` 末尾打印的两条 git 命令作为弱提醒。

## 方案

### 1. 新增 `delete-photo.js` + `npm run del-photo`（核心）

用法（由 UI 复制的正是这条；需在站点仓库根目录执行）：

```
npm run del-photo -- "保定-保定站附近永瑞园" "DSC03539.JPG"
```

流程（脚本自己完成校验与重跑，用户只粘贴一次）：

1. **参数与路径校验**：两个参数齐全；文件夹名/文件名不得含路径分隔符或 `..`；
   `../data/photos/<文件夹>` 与目标文件存在；扩展名在
   `{.jpg,.jpeg,.heic,.tiff}` 白名单内（与管线同一份判定）
2. **封面校验（硬 error）**：读该文件夹 `index.json`，若 `index_photo === 文件名`
   → 打印错误并 `exit 1`。文案给出下一步：
   「这是 `X` 组的封面照片，封面不可删除。请先改 `index.json` 的 `index_photo`
   指定新封面（新封面必须有 GPS），再重跑本命令。」
3. **删后为空校验（硬 error）**：该文件夹除目标外无其他原图 → error 退出
   （管线要求每组 ≥1 张）
4. **打印将处理的文件清单**（原图 + `<名>_thumb.webp` + `<名>_display.webp`，
   派生文件可能不存在，缺失则跳过而非报错）
5. **执行删除**：原图与两张派生 webp 一律 `fs.unlink`（方式 C，见"已拍板"1）
6. **自动重跑管线**：spawn `node process-photos.js`（`stdio: inherit`，复用同一份
   生成逻辑，不复制代码）；失败则非零退出并提示「文件已删除，请检查错误后手动重跑
   `npm run photos`」
7. **打印后续命令，不执行**（用户保留 git 手动控制）：
   两条 `git add/commit/push`（data 仓库 + 站点仓库），含建议的 commit message

依赖：**仅 Node 内置模块**（fs / path / child_process），无外部命令、无启动预检
（与 AGENTS.md S3 一致：没有依赖就没有兜底链）。

### 2. `process-photos.js` 增加「数据一致性检查」段

在现有完成输出（条数/耗时）之前追加一段**只报告、不修改任何文件、不改变退出码**
的检查（既有硬 error 仍 `exit 1`）：

1. **孤儿派生文件**：扫描各文件夹，列出没有对应原图的 `*_thumb.webp` /
   `*_display.webp`（含完整路径）。当前数据应列出上述 4 个文件
   （IMG_5184/5185 的 thumb + display）。报告末尾附一行可复制的清理命令文本
   （**只是文本提示，脚本不执行删除**，符合用户"不做 `--prune`"的决定）
2. 保留既有校验与警告（`index.json` 缺失 / 无 `index_photo` / 封面缺 GPS /
   照片缺 GPS 或拍摄时间），语义与文案不变

发现不一致时在结尾汇总成一块醒目摘要，便于一屏读完。本段无 git、无外部命令调用。

### 3. 前端 `ⓘ` 信息面板：删除区块（含封面标注）

改动文件：`src/Application/Map/AMap/MapChildren.jsx`、
`.../LightboxInfoPanel.jsx`、`.../LightboxInfoPanel.module.css`。

- `flattenPhotos` 增加 `coverFileName: group.fileName`（照片分组模式下必需；
  文件夹模式的 `currentPhoto` 来自 `group.photos`，需另取封面名）
- `MapChildren` 计算 `coverFileName = selectedGroup.coverFileName ||
  selectedGroup.fileName`，传 `isCover={currentPhoto.fileName === coverFileName}`
  给面板（两种分组模式通用）；`groupName` 已在传（`selectedGroup?.dirName`）
- 面板新增「删除」区块，两种状态互斥：
  - **封面**：显示「封面照片」标记 + 说明「封面不可删除（删除会让本组失去坐标与
    缩略图来源）。如需更换，请先改 `index.json` 的 `index_photo`。」
    **不提供复制按钮**
  - **非封面**：显示「复制删除命令」按钮，点击把
    `npm run del-photo -- "<文件夹>" "<文件名>"` 写入剪贴板，复制成功后按钮
    反馈「已复制」（复用坐标行既有反馈与 try/catch 静默失败约定）；
    下方小字说明「在站点仓库根目录的终端粘贴执行：删除该照片并自动重跑管线；
    原图会直接删除、不进回收站」
- 命令文本由已有字段组装，**不含本机绝对路径**（公网可见的 bundle 不留本机信息）；
  他人复制该命令不可用，无安全影响

### 4. 文档回写（AGENTS.md 流程 3）

- `README.md` 照片导入流程后加一条「删除照片」摘要（指向 `docs/data-pipeline.md`）
- `docs/data-pipeline.md` 新增「删除照片（`npm run del-photo`）」与
  「数据一致性报告」两节
- `AGENTS.md` **不动**（未新增域文件，按流程 3 只在新建域文件时才加路由）

## 实现记录（2026-09-30）

改动文件：

- 新增 `delete-photo.js`；`package.json` 增加 `"del-photo": "node delete-photo.js"`
- `process-photos.js`：新增 `reportInconsistencies()` 与末尾调用；新增
  `THUMB_SUFFIX` / `DISPLAY_SUFFIX` 常量并替换原先内联拼接的文件名
- `src/Application/Map/AMap/MapChildren.jsx`：`flattenPhotos` 两个分支下发
  `coverFileName`；新增 `coverFileName` 计算并传 `isCover`
- `src/Application/Map/AMap/LightboxInfoPanel.jsx` + `.module.css`：新增
  「删除这张照片」区块（封面标注 / 复制命令按钮 / 命令预览）与 4 个样式类
- `README.md`、`docs/data-pipeline.md`：新增「照片删除」与「数据一致性报告」

验收执行结果（`/tmp/delphoto-verify` 镜像目录：真实脚本副本 + 3 张照片副本 +
伪造孤儿 + 单一原图组，`node_modules` 软链；**未触碰生产 `../data/photos`**）：

- 一键脚本 `verify.sh` 共 35 项断言：**PASS=35 / FAIL=0**，覆盖验收标准 1–6：
  - 参数/路径/扩展名/派生文件作目标/照片不存在 等 8 种非法输入全部 exit 1 且
    **校验失败时目录快照 md5 不变**
  - 封面 → error（文案含 `index_photo` 处置提示），拒绝后文件无变化
  - 非封面 → 三个文件确实消失、`output.json` 该组 3→2、打印两个仓库命令、
    重跑管线时报告了已存在的孤儿
  - 「删后为空」→ error 且未删文件
  - 无孤儿时报告 `[通过]`，无假报警
  - 源码审读：`reportInconsistencies` 段 0 处外部命令引用；`delete-photo.js`
    仅 `spawn(process.execPath, …)` 重跑自身管线，无 git/execFile 调用
  - 走 `npm run del-photo -- "测试组" "DSC03539.JPG"` 通道（UI 复制的命令形态）
    同样成功，参数透传正常
  - UI 侧：命令模板与脚本接受形态逐字符一致；CSS 类名与 JSX 引用双向零缺口
- `./node_modules/.bin/eslint src --ext .js,.jsx,.ts,.tsx --max-warnings=0` → 退出码 0
  （stderr 仅有 CRA 的 `babel-preset-react-app` 既有噪声）

待用户侧验收：

- UI 观感（`npm start` 打开 Lightbox → `ⓘ` → 选一张非封面照片与封面照片各看一次）
- CI 门禁 `CI=true ./node_modules/.bin/react-scripts build`（repo 根已有 `build/`，
  按 `docs/toolchain.md` 交用户终端）
- 真实删除建议由用户自己在终端跑一次（本方案未在生产数据上执行任何删除）

## 验收标准

均在 `/tmp` 镜像目录（真实脚本副本 + 少量照片副本、`node_modules` 软链）上验证，
**不在生产 `../data/photos` 上做任何删除验证**（AGENTS.md S1）：

1. `npm run del-photo -- "<文件夹>" "<非封面文件>"`：原图与
   `<名>_thumb.webp`/`<名>_display.webp` 均不再存在、该组张数减 1、
   `output.json` 中该照片消失，脚本末尾打印两条 git 命令
2. 对封面执行同样命令：打印明确 error、`exit 1`、目录内文件**无任何变化**
3. 对"该组最后一张原图"执行：error 退出且无文件变动
4. 参数非法（缺参/不存在/含 `..`/非法扩展名）：清晰报错退出，不做任何写入
5. 一致性报告能列出已知的 4 个孤儿派生文件并给出清理建议文本；
   源码审读确认校验段无任何外部命令调用（无 `execFile`/`spawn`）
6. UI：`ⓘ` 面板对封面照片显示「封面照片 + 不可删除」说明且**无复制按钮**；
   对非封面显示复制按钮，复制内容与手写命令逐字符一致（含引号空格）
7. `./node_modules/.bin/eslint src --ext .js,.jsx,.ts,.tsx --max-warnings=0` 通过
8. CI 门禁 `CI=true ./node_modules/.bin/react-scripts build`——按
   `docs/toolchain.md`，repo 根已有 `build/` 时 agent 在本环境跑必失败，此步交
   用户终端执行

## 出界清单（本轮不做）

- **不做 UI 内删除**：站点是纯静态 Pages、无后端，UI 删除需另搭服务（用户已排除）
- **不做回收站 / `.trash` 暂存**：原图直接删除（用户 2026-09-30 选定方式 C）
- 不做 `--prune` / 自动清理孤儿：只报告（用户明确）
- **不做「`../data` 仓库状态」检查**：本方案不引入 git 依赖（用户 2026-09-30 决定）
- 不做 shell alias（`hcm-del`）与 `~/.zshrc` 改动：命令形式取 npm 原样
- 不自动 `git commit` / `push`：只打印命令
- 不做增量跳过（mtime 比较）：实测全量约 15s，收益不值
- 不做封面自动替换 / 自动从同组挑替补：封面变更必须人类介入（用户明确）
- 不做批量删除（一次多张）：命令一次只处理一张，多张即多条命令
- 不改 `output.json` 数据结构、不改派生图命名与档位（300px / 1920px WebP）
- 不改前端除上述 3 个文件之外的任何文件；不动 `MapIcon/`（demo 页）与
  `.hcm-photo-pin` 样式位置
- 不动 `DEVELOP.md`（用户手动维护，按既有约定 agent 不改写）
- 不在本方案内修复现存数据（4 个孤儿文件、`../data` 的 61 处未提交改动）——
  属于"用户自行决定并执行"的动作，本方案只负责让孤儿可见

---

## 修订 v4：去掉「自动重跑管线」（2026-09-30，草稿，待用户批准）

状态：已实现（2026-09-30 18:00；v4 验收脚本 42 项断言全通过；eslint
`--max-warnings=0` 退出码 0）。上文 v1–v3 全文保留（P1），本节覆盖其中
「步骤 6 自动重跑管线」这条决定。

### 触发原因（用户 2026-09-30 反馈）

> 每次执行 `npm run del-photo -- "保定-保定站附近永瑞园" "IMG_4569.HEIC"` 都得等上一会
> 才能结束，但有时候我需要删除多张照片，那么每张照片之后我都需要等很久。

即：**删单张的耗时几乎全是重跑管线**，而批量删除场景下这次重跑被重复支付 N 次。
v3 的「自动重跑」把"用户少打一条命令"的收益，换成了"N 倍的全量重跑等待"。

### 改动点（5 处）

1. `delete-photo.js`
   - 删除 `runPipeline()`、`require('child_process')`、`PIPELINE_FILE` 常量
     → 脚本**不再启动任何子进程**，依赖收敛为 `fs` / `path`
   - 把 `=== 重跑管线：npm run photos ===` 段替换为**收尾提示**（用户选定"精简成一行"）
   - `printNextSteps()` 改写：现行文案「站点仓库（output.json 已重新生成）」在
     不重跑后即为**错误陈述**，必须改为「先跑 `npm run photos`，再提交两个仓库」
   - 文件头注释第 5 条行为说明同步改
2. `src/Application/Map/AMap/LightboxInfoPanel.jsx`：面板小字「删除这张照片**并自动
   重跑管线**」→「删除后需自行执行一次 `npm run photos` 更新 output.json」
3. `README.md`：「删除照片」节同口径
4. `docs/data-pipeline.md`：`del-photo` 流程描述行 + 「零外部命令依赖」理由
   （由"重跑用 `process.execPath`"改为"不调用任何子进程"）
5. 本文件：即本节

### 收尾输出的确定形态（用户 2026-09-30 选定：精简成一行）

删除成功后只打印一行醒目提示（含可复制的命令本身），**不再每次重复打印两条 git
命令**（连删多张时不刷屏）。提示必须同时点明"output.json 尚未更新"这一状态，
否则网页与磁盘的短暂不一致容易被遗忘。

### 代价（已如实告知用户并获接受）

1. **即时校验 → 延迟校验**：v3 里"删完立刻重跑"顺带充当了一道校验（管线报错即时
   暴露）；改后要等用户下一次 `npm run photos` 才知道。但删**之前**的两道硬拦
   （封面、删后为空）不依赖管线，仍在删除前拦截，**删除动作本身的安全性不变**。
2. **`output.json` 与磁盘短暂不一致**：网页上该照片仍在、缩略图破图，直到重跑。
   这是本方案唯一的用户可见副作用，靠收尾提示与文档提醒覆盖。
3. 「删后为空」的 error 文案提到"再重跑 `npm run photos`"，措辞需跟着微调。

### 收益

- 单次执行耗时从约 15s（175 张全量）降到毫秒级；连删 N 张只需 1 次重跑
- 脚本彻底无子进程依赖（`child_process` 移除），更贴合 AGENTS.md S3 的"无依赖即无兜底"

### 验收标准（在 `/tmp` 镜像目录执行，不碰生产 `../data/photos`，S1）

1. 参数个数不对 / 文件夹不存在 / 照片不存在 / 路径含分隔符 / 扩展名非法 / 派生文件
   作目标 → 全部 `exit 1`，且**目录快照 md5 不变**
2. 删封面 → error 且文案含 `index_photo` 处置提示，目录不变
3. 删后为空 → error 且未删任何文件
4. 删非封面成功 → `exit 0`，三个文件消失，且 **`output.json` 的 md5 与 mtime 均不变**
   （这条是"不再重跑"的强反证）
5. 成功路径输出中必须出现 `npm run photos` 字样与两条 git 命令
6. 源码审读：`delete-photo.js` 内 0 处 `spawn` / `execFile` / `child_process`
7. 单次执行耗时 < 1s（v3 约 15s）
8. `./node_modules/.bin/eslint src --ext .js,.jsx,.ts,.tsx --max-warnings=0` 退出码 0

### 出界清单（本次不做）

- **不做 UI 侧批量多选复制命令**（用户 2026-09-30 明确：先只做"不自动重跑"，
  批量以后真痛了再说）
- 不做 `output.json` 陈旧度自动检测 / 状态文件标记
- 不做增量重跑（mtime 比较）
- 不引入任何 `../data` 仓库 git 状态检查（延续"已拍板"3）
- 不改 `delete-photo.js` 的校验顺序与错误退出语义（只删重跑段）

### 实现记录（2026-09-30）

改动文件（5 处，与上文"改动点"一一对应）：

- `delete-photo.js`：移除 `runPipeline()` / `require('child_process')` /
  `PIPELINE_FILE` / `color.dim`（唯一使用点随 `printNextSteps` 一并删除）；
  `printNextSteps()` → `printReminder()`（单行黄色提示）；`main()` 调用点同步；
  `main().catch` 里"git 始终由你手动执行"那句失去指代对象（不再打印 git 命令），
  一并移除；「删后为空」文案"再重跑"→"再执行"
- `src/Application/Map/AMap/LightboxInfoPanel.jsx`：面板小字改为"删除后需自行执行
  一次 `npm run photos` 更新 output.json"（`styles.code` 复用封面分支已有类，无新增 CSS）
- `README.md`、`docs/data-pipeline.md`：「删除照片」节同口径；并补充一条新发现
  （见下）
- 本文件：本记录

验收执行结果（`/tmp/delphoto-v4` 镜像：`setup.sh` 可重建 + `verify.sh` **42 项断言
PASS=42 / FAIL=0**，未触碰生产 `../data/photos`）：

- 8 种非法输入全部 `exit 1` 且**目录快照 md5 不变**
- 删封面 → error（文案含 `index_photo`）、目录不变；删后为空 → error、目录不变
- 删除成功 → `exit 0`、三件套消失、同组其他照片与封面保留
- **关键反证**：`output.json` 的 md5、mtimeMs、size 三项均不变，且其内容仍记录
  3 张（未随删除更新）→ 确证不再重跑
- 走真实 `npm run del-photo -- …` 通道（UI 复制的命令形态）同样成功，且同样没动
  `output.json`
- 单次成功路径耗时 **28ms**（v3 全量重跑约 15s）
- 源码审计：`delete-photo.js` 内 0 处 `spawn` / `execFile` / `child_process` /
  `PIPELINE_FILE`，旧函数名 0 残留
- 回归：`npm run photos` 的一致性报告仍能列出孤儿并给出清理命令
- ESLint 退出码 0；`node --check delete-photo.js` 通过

### 验证中发现的一个既有事实（非本次引入）

**封面校验排在「删后为空」校验之前**：正常数据里删除"只剩一张的组"会先命中
"封面不可删除"，因此「删后为空」实际只在 `index.json` 的 `index_photo` 已失效
（指向一张已被删掉的照片）时才可达。v3 的验收脚本当时用"构造单张组"的方式测这条，
其实命中不了它——本轮的测试用例最初也踩了同一个坑（已改为构造失效封面场景）。
两道拦都在删除动作之前执行，行为本身无误；该事实已补进 `docs/data-pipeline.md`
的「关键约定与理由」。

---

## 受控修订（2026-10-09）：翻案「不做自动清理孤儿」一条

本文件「出界清单」第 3 条写着：

> 不做 `--prune` / 自动清理孤儿：只报告（用户明确）

该条**已被翻案**，新决策见 `docs/plans/2026-10-09-photos-orphan-prune.md`。翻案后的行为：

- 保留本文件的**全部其它结论**（`del-photo` 双仓双删、封面不可删、「删后为空」硬拦、
  原图直接删除不进回收站、零外部命令依赖、不查 `../data` git 状态）
- 「只报告」改为：`npm run photos` 收尾**自动清理点位目录顶层的孤儿派生图**
  （只认 `_thumb.webp` / `_display.avif` / `_web.mp4`），同时新增**两道硬闸门**
  （原图目录读失败 / 会把某点位删空 ⇒ 整轮零删除 + 退出码 1）；`refs/` 一层维持只报告

**翻案依据（不是"当时判断错了"）**：本文件当时的判定基准容错——`collectStems` 里那个
空 `catch {}` 把"目录读不到"与"目录里没有原片"混成同一个空清单——在"只报告"语境下
没有代价；当真实数据里出现 102 个孤儿、且打印出来的 `rm` 是 7 KB 长串（不可用）时，
"只报告"的边际价值转负。**撤回的前提是补上当日不存在的闸门一**（读失败 ⇒ 零删除报错
退出）：没有那道闸门，这个空 `catch {}` 会直接把"读不到"当成"原片全没了"的铁证，
自动删掉原片还在的整点位好图。两者必须一起改，不是可选项。

`del-photo` 的「删后为空」纪律并未被绕过——本文件那条纪律在闸门二里被**原样复用**。

（本文件其余内容为当时事实，按 P1 保留原样。）
