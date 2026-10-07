# AGENTS.md — agent 宪法

给所有 AI 编码助手（WorkBuddy / Codex / Cursor / Claude Code 等）。
本文件是本 repo 的行为宪法：**原则 > 流程 > 路由**，冲突时以原则为准。
本文件自我声明：不依赖任何会话上下文即可执行；修订方式见 E1。

## 原则（不可协商；每条 = 规则 + 为什么）

违反原则的"结果正确"仍然是违规。

### P1 决策留痕（ADR）
规则：决策产物（`docs/plans/` 下的 plan、`docs/` 域文档）永不删除，生命周期用状态行
管理（草稿/已批准/已实现/已归档）；"蒸馏知识"指提取进 docs/，原件保留并标注状态。
为什么：决策记录回答"为什么做了 X、为什么没做 Y"（含被否决方案与出界清单），是
review 凭据与跨会话交接契约；删了它，这些"为什么"永久丢失。

### P2 审批门（human-in-the-loop）
规则：两道门——
① **plan 先行**：除用户明确说"直接做"的场景外，一切代码改动先产出计划（自包含、
含验收标准与出界清单）放 `docs/plans/`，经用户明确批准（如"开始/做吧"）后方可
动手；**批准前只允许只读操作**（读代码、调研、起草 plan）。是否需要 plan 由用户
判定，agent 不确定时默认需要。
② **破坏性操作确认**：任何删除/覆盖/恢复类操作，须用户当次明确确认（唯一例外：
agent 本会话自建的临时文件）。
为什么：agent 的"顺手"与"自作主张"是越界；不可逆操作的最终决定权在用户。

### P3 单一事实源（SSOT）
规则：每类知识只有一个 canonical 位置——本文件（宪法+路由）、`docs/`（领域知识）、
`docs/plans/`（决策记录）；agent 个人 memory 不承载 repo 规则，只留指针。
为什么：双源必然漂移；规则活在 repo 里才对所有 agent 可见、才被版本化。

### P4 自包含
规则：本文件的每条表述必须"零上下文可执行"；新增规则进本文件时同样要求。
为什么：任何 agent 可能零上下文进入本 repo（manifest 事实标准的定义）。

### S1 数据隔离
规则：`../data/photos` 下是原始照片（不可再生）。验证会写 EXIF/数据文件的程序时，
复制到临时目录在副本上验证；验证命令交给用户自己跑；不做未经请求的"顺手"修复或
副作用操作。
为什么：不可再生数据被污染即无法还原；验证的目的本身就要求验证对象与生产数据隔离。

### S2 bug 归属分类
规则：修 bug 前先判断触发条件是否在**用户真实使用路径**上；不在（如仅非 TTY/管道
环境触发）则不动代码，只记录现象、改自己的测试方式。
为什么：把测试环境的局限当 bug 修，会用无意义的改动污染用户代码。

### S3 外部命令与环境
规则：代码对外部命令假设已存在，启动预检一次，缺失即报错退出（附安装命令），不做
多重兜底；需要安装系统级工具而环境受限时，直接请用户在终端安装，不自行绕过。
为什么：兜底链掩盖真实依赖；自动绕过既浪费又脆弱（用户 2026-09-26 明确反馈）。

### E1 进化机制
规则：本文件通过复盘修订——复盘产出流程改进（对事不对人），改进落盘为本文件的
修订，随 git 提交留痕；用户是唯一修订批准人。
为什么：没有进化机制的宪法会过时；本文件的 ADR/审批门/数据隔离条款全部源自复盘。

## 流程

1. **改代码** → `./node_modules/.bin/eslint src test --ext .js,.jsx,.ts,.tsx --max-warnings=0`
   再交付。不允许留任何 warning、不用 eslint-disable 压制，修根因——CI（`CI=true`）
   把 warning 当 error，pre-push 钩子同样拒绝推送
   - `test/` 是 CLI 脚本（`fix-gps.js` 等）的单测，跑法 `npm run test:cli`
     （node 内置 runner，**不是** CRA jest——`react-scripts test` 的 roots 只有
     `src/`，两者互不干扰）
2. **CI 验证** → `CI=true npm run build`，由**用户终端或 CI** 执行。agent 环境跑
   **必失败**，且与 `build/` 是否预先存在**无关**（agent 不必先删 `build/`）：broker
   对"已存在目录的非递归 mkdir"伪造错误码，webpack 的 mkdirp 认不出 → 上抛
   （机制与实测见 `docs/agent-env.md`）。副作用：跑 build 会**清空现有 `build/`**，
   agent 不要在用户工作区试跑
3. **知识回写** → 新坑/新知识写入 `docs/` 对应域文件；**没有对应域文件时按知识域
   新建**。拆分判据是**一个文件里是否住着两个可独立命名、各自能回答一组问题的域**，
   **不是文件行数**（行数只作提示：超 400 行时，写新内容前先自问是不是混了两个域）。
   **仅当新建域文件时**，本文件"路由"才加一行，知识进既有域文件时本文件不动；
   不预建空文件
   为什么：200 行阈值是 2026-09-25 拆分 docs 时的**配套绊线**（防"什么都往里塞的
   单体"在域文件里重建），但实战中退化成"数行数"——三次拆分都没撑过一周（实测与
   判据见 `docs/plans/2026-10-07-docs-split-by-domain.md`）。它想防的是**域混合**，
   故直接以域为判据
4. **计划文件** → 完成后状态行更新为"已实现"，保留不删（P1）
5. **门** → 门①：写代码前，plan 是否已获用户批准（P2）；门②：任何删除/覆盖/恢复，
   停下问用户（P2）

## 路由（什么知识去哪找）

- 技术栈：React 18 + react-scripts 5（CRA）、AMap（@uiw/react-amap）、GitHub Pages
- 构建产物：`src/Application/output.json` 勿手改（由 `npm run photos` 生成）
- 工具链坑（ESLint `--ext`、CI 的 Node 与 `sharp` engines、`/dev/tty`、`useMemo`、
  `localStorage`、git 与 grep 的"静默归零"）→ `docs/toolchain.md`
- agent 执行环境（沙箱 PATH 无 Homebrew、broker 拦 build；agent 独有现象，S2 不为它
  改代码）→ `docs/agent-env.md`
- 测试（CRA jest 与 CLI 单测两条链、jsdom 测内联脚本、`src` 内 CJS 可测形态）→ `docs/testing.md`
- 照片管线（HEIC 转码、双根 `ORIGIN_DIR`/`IMGS_DIR`、缩略图与展示图档位 AVIF、视频转码）→ `docs/data-pipeline.md`
- 照片运维（`npm run del-photo` 删除照片、数据一致性报告）→ `docs/photo-ops.md`
- 照片元数据（GPS 硬拦口径、坐标溯源 `geoSource`、设备 `device` 分类）→ `docs/photo-metadata.md`
- 拍摄与整理工作流 / 产品定义（手机锚点照、相机主体、标准流程）→ `docs/photo-workflow.md`
- 应用结构 / demo 分发机制 → `docs/app-structure.md`
- AMap API 等领域链接 → `DEVELOP.md`（用户手动维护，agent 不改写）
- 决策记录 → `docs/plans/`（P1）
- 提交约定：`.vscode/`、`.gitignore`、`AGENTS.md`、`docs/` 应提交；`.workbuddy/`
  已被 gitignore，勿提交
