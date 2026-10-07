# docs 拆分判据改为「按域」（废除 200 行行数阈值）

状态：**已实现**（2026-10-07；用户 21:38 批准后执行，验收 6 项全过）
日期：2026-10-07

## 背景（自包含）

`AGENTS.md` 流程 3 有一条「单文件超 200 行按域拆分」。本轮先核实了它的出处与实战成绩。

### 出处：`eb69afc`（2026-09-25），本是配套绊线

当时用户质疑「所有知识堆 AGENTS.md 会导致无限膨胀」，讨论后选定**按知识域分文件**。
同一次改动做了三件事：新建 `docs/toolchain.md` + `docs/data-pipeline.md`、AGENTS.md 瘦身
到 36 行、写下「知识回写纪律」三条——第三条原文即「**单文件超 200 行时按域蒸馏拆分**」。
（可复现：`git log -p -S'200 行' -- AGENTS.md`；记录见 `.workbuddy/memory/2026-09-25.md`
「知识库结构重构（docs/ 方案 2）」一节。）

⇒ 它**本来的意图**是防止刚从 AGENTS.md 拆出去的「什么都往里塞的单体」在 docs 域文件里
重新长出来。但写进宪法时**没带「为什么」**（P1–P4 / S1–S3 每条都带），于是执行时只能
退化成数行数，也没人能判断拆完是否达成目的。

### 实战成绩：三次执行都没撑过一周

| 日期 | 动作 | 结果 |
|---|---|---|
| 09-30 | `data-pipeline.md` 214 行，用户选「去重瘦身不拆」→ 180 | 10-05 又破 200 |
| 10-03 | 拆出 `photo-metadata.md`（`data-pipeline` 185→130） | 10-07 `photo-metadata` 到 351 |
| 10-05 | 拆出 `photo-ops.md`（59 行） | 10-07 `data-pipeline` 到 257 |

域文件总量：**09-30 为 309 行 → 10-07 为 1344 行**（一周 4.3×）。
⇒ 拆分只搬行数、不改总量；「超 200」是**总量在涨**的症状，不是病。

## 判据（改什么）

- 旧：单文件超 200 行 → 按域拆分
- 新：**一个文件 = 一个知识域**；只有当一个文件里住着**两个可独立命名、各自能回答一组
  问题的域**时才拆。行数只作提示（超 400 行时，写新内容前先自问是否混了两个域）

按新判据重判当前 6 个域文件：

| 文件 | 行数 | 旧判据 | 新判据 | 处理 |
|---|---|---|---|---|
| `toolchain.md` | 265 | 拆 | **拆**（住着 4~6 个域：agent 环境 / 测试链 / CI 依赖 / Node 运行时 / React / git 取证；「工具链坑」本身就是兜底命名） | 本次拆 |
| `photo-metadata.md` | 351 | 拆 | 不拆（7 节全属元数据口径，同一域内写得长） | 豁免 |
| `data-pipeline.md` | 257 | 拆 | 不拆（全属管线机制） | 豁免 |
| `photo-workflow.md` | 256 | 拆 | 不拆（全属拍摄与整理） | 豁免 |
| `app-structure.md` | 150 | — | — | 不动 |
| `photo-ops.md` | 65 | — | — | 不动 |

## 改动清单

1. **新建 `docs/agent-env.md`**：迁入 toolchain.md 的「agent 沙箱 shell 的 PATH 不含
   `/opt/homebrew/bin`」「react-scripts build 报 `EEXIST`」两节。头部写共同定性
   （agent 独有现象 / S2 不为它改代码 / S3 交用户终端）
2. **新建 `docs/testing.md`**：迁入「CLI 脚本的单测：与前端 jest 分两条链」「测页面内联
   脚本的行为：jsdom」「前端纯函数若想被 CLI 单测覆盖：src 内 CJS」三节。头部加测试链
   对照表
3. **重写 `docs/toolchain.md`**：保留 ESLint `--ext`、CI 的 Node/`sharp` engines、
   `/dev/tty`、`useMemo`、`localStorage`、git 中文路径 6 节；头部加指向两个新域文件的
   出站指针（保证旧引用「见 docs/toolchain.md」仍可达）
4. **`docs/toolchain.md` 新增一节（今日沉淀）**：命令行工具的「静默归零」——把既有 git
   中文路径坑与今日实测的 BSD `grep` `\|` 坑归并为一节，判据统一为「搜不到 ≠ 不存在；
   否证性结论必须换一种方式交叉验证」
5. **`AGENTS.md`**：流程 3 条款改为域触发 + 补「为什么」；流程 2 的指针改指
   `docs/agent-env.md`；路由加 `agent-env.md` / `testing.md` 两行、改 `toolchain.md` 行描述

## 验收标准

1. `wc -l docs/*.md`：`toolchain.md` ≤ 120，两个新文件各 ≤ 100
2. 迁走的小节**内容零丢失**：逐节核对原文（含实测表格、数字、plan 指针）
3. `AGENTS.md` 路由含 `agent-env.md` / `testing.md` 各一行；流程 2 的指针指向 `agent-env.md`
4. 旧引用可达：`docs/toolchain.md` 头部有两行出站指针；历史 plan 里的 `docs/toolchain.md`
   一律不动（P1）
5. 纯文档改动：`git diff --stat` 只含 `AGENTS.md` 与 `docs/*.md`，**无任何代码 / `test/` 改动**
6. 不跑 build（agent 环境必失败且会清空 `build/`）；不涉及 eslint（无代码改动）

## 出界清单（本次不做）

- 不拆 `photo-metadata.md` / `data-pipeline.md` / `photo-workflow.md`（新判据下不触发；
  本 plan 即为豁免记录）
- 不改任何代码（`fix-gps.js` / `process-photos.js` 等）；不改 `test/*.test.js`——其
  `INSTALL_HINT` 里的「见 docs/toolchain.md」靠 toolchain.md 头部的出站指针保持可达
- 不改 `README.md`；不动 `DEVELOP.md`
- 不删任何 plan 原件、不改 `docs/plans/` 里的历史记录（含那些写着「见 docs/toolchain.md」的）
- 不给域文件加「顶部小节索引」（本轮无此需求；toolchain.md 拆完自然变短）
- 不动 `../data`；不 `git push`（提交与否由用户定）

## 待确认

无。用户 2026-10-07 21:38 已批准本方向，改动范围与上表一致。

---

## 实现记录（2026-10-07 21:40）

改动文件：`AGENTS.md`、`docs/toolchain.md`（重写）、新增 `docs/agent-env.md`、
新增 `docs/testing.md`。**零代码改动**（`src/` / `test/` / 仓库根 CLI 一律未动）。

| 文件 | 前 | 后 |
|---|---|---|
| `docs/toolchain.md` | 265 | **150** |
| `docs/agent-env.md` | — | 96（新） |
| `docs/testing.md` | — | 94（新） |
| 三文件合计 | 265 | 340（+75） |

节数守恒：旧文件 11 节 = `toolchain` 6 + `agent-env` 2 + `testing` 3。
净值 +75 行全部来自本轮**新增的「静默归零」一节**（用户要求沉淀今日知识）。

验收执行结果（6 项）：

1. ⚠️ 行数：`toolchain.md` **150**，与计划的 ≤120 有偏差——原因是按用户要求新增了「静默归零」
   一节（约 40 行）。判断依据（本次要立的判据本身就是这个）：该节属"命令行工具陷阱"，
   与文件声明的域一致，**新增的坑有明确归属地**，故不为此再拆第三个文件
2. ✅ **内容零丢失**（逐行核对）：迁走的 5 节共 **131 个非空行**逐行在新文件里搜，全部命中；
   保留的 6 节共 **81 行**逐行搜，全部仍在。仅两行形态变化，均为计划内改写：
   ① `见下节` → `见 docs/toolchain.md 的 sharp engines 一节`（跨文件后原指针失效，必须改）
   ② 原 `## git 路径含中文…` 标题降为 `### 实例 1：git 路径含中文…`（并入新节）
3. ✅ `AGENTS.md`：流程 2 的指针 → `docs/agent-env.md`；路由三行（`toolchain` / `agent-env` /
   `testing`）；流程 3 已改为域触发 + 补「为什么」
4. ✅ 旧引用可达：`docs/toolchain.md` 头部有出站指针表（两条）；历史 plan 一字未改（P1）
5. ✅ `git diff --stat` 只含 `AGENTS.md` 与 `docs/toolchain.md`——另有一处
   `docs/photo-workflow.md` +29 行是**用户先前的未提交改动**（ref-places 那批），与本次无关、
   一行未触碰
6. ✅ 未跑 build（agent 环境必失败且会清空 `build/`）；未涉及 eslint（无代码改动）

过程备注：写验收脚本时**现场复现了一次刚刚才写进文档的坑** —— 脚本里写了
`grep -n "toolchain.md\|agent-env.md"`，返回空、退出码 1，换 ripgrep 才拿到结果。
与该节"实例 2"描述的行为完全一致，可作该结论的第一手旁证。

## 沉淀去向（用户 21:38「如果有要沉淀的知识，也得进行沉淀」）

| 知识 | 落到哪 |
|---|---|
| 200 行规则的出处（提交 `eb69afc`）与它真正的意图（防"兜底单体"重建） | 本 plan 背景节 + `AGENTS.md` 流程 3 的「为什么」 |
| 行数触发的实战成绩（三次拆分均未撑过一周、总量一周 4.3×） | 本 plan 表格 |
| BSD `grep` 的 `\|` 静默失效 + 最小复现命令 | `docs/toolchain.md`「静默归零」实例 2 |
| 这一类坑的**共同判据**（否证性结论必须换法交叉验证） | 同上，节末「共同判据」 |
| 三条测试链各自跑什么、覆盖哪 | `docs/testing.md` 头部对照表 |
| agent 环境的两层构成（broker 拦截 + 受限 PATH）与共同处置次序 | `docs/agent-env.md` 头部 |
