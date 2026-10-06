# Plan: CI 自 b49c557 起全红（Node 18 下 npm 静默跳过 sharp 平台包）+ 线上站点停更

状态：**已实现**（2026-10-06 16:33 推送 `ae403f1` → CI 全绿、`Deploy to gh-pages`
success、`gh-pages` tip 出现 `deploy: ae403f1…`、线上 bundle 已含「雅加达」与
`server.arcgisonline` ⇒ **雅加达与「海外影像」第四档均已上线**。用户选 **A**：
CI 的 `node-version` 由 `18.x` → `22.x`；**原「可选 D」亦获批准并已实施**
（2026-10-06 16:47，`package.json` 加 `engines.node = ">=20.9.0"`，见文末追加节）；
浏览器目视**用户已确认无问题** —— 验收标准 5 闭合）
日期：2026-10-06
相关文档：`docs/toolchain.md`（`test:cli` 的写法与外部命令）、
`docs/plans/2026-10-06-gps-sign-loss-and-jakarta.md`（把 CLI 单测接进 CI 的那次提交）、
`docs/plans/2026-10-06-overseas-imagery-manual-mode.md`（被本问题挡住上线的第四档）

## 背景（自包含，零上下文可读）

`b49c557`（"修 EXIF 南纬符号丢失 + 雅加达上线"）在 `.github/workflows/build-deploy.yml`
里新增了两步：`Install exiftool` 与 `Run CLI tests`（`npm run test:cli`）。CI 的
`build` job 顺序为：install → **Run CLI tests** → Build → Run tests → Upload；`deploy`
job 依赖 `build`，失败即整体跳过，`Deploy to gh-pages` 不执行。

自那次提交起，每次推送的 CI 都在 `Run CLI tests` 失败 → Build/Deploy 全部 skipped →
**线上站点不再更新**。

## 现象与线上实况（只读核实，2026-10-06 16:0x）

CI 运行（GitHub API，无鉴权可读）：

| run | commit | 结论 | 失败步骤 |
|---|---|---|---|
| 37413555730 | `e93ab15`（docs only） | ✅ success | —（该提交早于 CI 接线，无 `Run CLI tests` 步） |
| 37422521092 | `b49c557`（雅加达上线） | ❌ failure | `Run CLI tests`；Build/Deploy skipped |
| 37434167332 | `020e465`（海外影像档） | ❌ failure | `Run CLI tests`；Build/Deploy skipped |

线上实况（三处独立证据一致）：

- `gh-pages` 分支 tip = `a509802`，提交信息 `deploy: 208baaa313832b123691d0c594f77a11b268090c`
  → 最后一次**实际生效**的部署产物来自 `208baaa`（MapIcon 死链修复那次）；
- `e93ab15` 那次 Deploy 步骤**成功**但未产生新提交（它只改 README/docs，构建产物与
  `208baaa` 逐字节相同，发布目录无变化 → 无新提交）。**推断**，由"Deploy success +
  gh-pages tip 消息仍是 `deploy: 208baaa` "反推；
- 线上 `https://huochemi.github.io/static/js/main.b5479f99.js`（593 864 B）关键字统计
  （bundle 把中文转义成 `\uXXXX`，按转义串检索）：含 `乌兰察布` 129 次、`北京` 121 次，
  **含 `雅加达` 0 次**，含 `arcgisonline` 0 次。

⇒ **雅加达从未上线**（你在本地 `npm start` 里看到的是本地构建），本次的「海外影像」
第四档同样未上线。

## 根因（已本地精确复现）

**`sharp@0.35.4` 声明 `engines.node >= 20.9.0`，而 CI 用 Node 18.x。** npm 对
**optionalDependencies**（sharp 的平台二进制正是写在 optionalDependencies 里）遇到
engine 不匹配时**不报错、只警告，并静默跳过该包**。于是全新 `npm install` 后：
`@img/sharp-libvips-<platform>`（无 engines 字段）装上了，而真正含 `.node` 的
`@img/sharp-<platform>` 被跳过 → `require('sharp')` 抛
`Could not load the "sharp" module using the <platform> runtime`。

`test/gps-sign.test.js` 是**唯一** `require('sharp')` 的测试文件（它用 sharp 现造 8×8
fixture；且它 require 的 `process-photos.js` 顶层也 require sharp）→ 该文件整体失败 →
`Run CLI tests` 退出码 1 → Build/Deploy 跳过。其余 6 个测试文件都不碰 sharp，故它们
在 CI 上是绿的。

本地复现（隔离目录，不影响仓库；Node 18.20.8 取自 npmmirror，Node 22 为本地）：

```
# Node 18.20.8：全新装 sharp
npm warn EBADENGINE Unsupported engine {
npm warn EBADENGINE   package: 'sharp@0.35.4',
npm warn EBADENGINE   required: { node: '>=20.9.0' },
npm warn EBADENGINE   current: { node: 'v18.20.8', npm: '10.8.2' }
npm warn EBADENGINE }
added 5 packages in 5s
$ ls node_modules/@img
colour
sharp-libvips-darwin-arm64          ← 只有 libvips；含 .node 的 sharp-darwin-arm64 被跳过
$ node -e "require('sharp')"
Could not load the "sharp" module using the darwin-arm64 runtime

# Node 22.22.2 对照
added 9 packages in 348ms
$ ls node_modules/@img
colour  sharp-darwin-arm64  sharp-libvips-darwin-arm64  sharp-wasm32
$ node -e "require('sharp')" → OK
```

CI 侧同一机制落在 `linux-x64` 上：`@img/sharp-linux-x64`（`engines >=20.9.0`）被跳过，
`@img/sharp-libvips-linux-x64`（无 engines）照装 → 与上面同一句报错。

**为什么本地一直看不出来**：本机 `node_modules` 是 9 月底在 Node ≥ 20.9 下装的
（`node_modules/sharp` 文件时间 9-20、`node_modules` 目录 9-29），二进制已在，
所以 `npm run test:cli` 在本地恒绿——**node_modules 的安装时环境与 CI 的安装环境
不同，这个差异在本地不可见**。

## 为什么直到 `b49c557` 才暴露（潜伏期时间线）

**不是"雅加达引入了问题"，而是那次提交第一次让 CI 有机会碰到 sharp。** 全部由 git
历史核实（`git log -- .github/workflows/`、`git show b49c557 -- .github/workflows/`、
`git log -S "test:cli"`）：

| 时间 | 提交 | 与 CI 相关的动作 | CI 结果 |
|---|---|---|---|
| 2026-09-13 | `e974fc4` | 建 `build-deploy.yml`，`node-version: 18.x`（**至今从未改过**） | ✅ |
| 2026-09-20 | `adee277` | `package.json` 加入 `sharp`（锁 `0.35.4`，`engines >=20.9.0`）→ **潜伏期起点** | ✅ |
| … | `e93ab15` 等 | 步骤恒为 install → build → `npm test` | ✅ |
| 2026-10-04 | `9a1cdb5` | `package.json` 加 `test:cli` **脚本**，但**未接进 CI**（只是本地脚本） | ✅ |
| 2026-10-06 14:09 | `b49c557` | **CI 新增 `Install exiftool` + `Run CLI tests`**，同时新增 `test/gps-sign.test.js`（**唯一** require sharp 的测试） | ❌ 首次红 |

三个"看起来该红却没红"的解释：

1. **装包步骤一直是绿的**：Node 18 下 `npm install` **exit 0**，`EBADENGINE` 只是
   warning → 红点只出现在 `Run CLI tests`，`Install NPM packages` 毫无破绽；
2. **build 步骤不碰 sharp**：webpack 只沿 `src/` 的 import 图打包，而 `process-photos.js`
   是仓库根的 CLI 脚本、不在 `src/` 内（且被 CRA 的 ModuleScopePlugin 挡着），
   `npm run build` 永远不会 require 到它；
3. **`Run tests` 这个步骤名有误导性**：它跑的是 `npm test` → `react-scripts test`，
   roots 只有 `src/`（AGENTS.md 流程 1 明写两套测试互不干扰）——`test/*.test.js` 那 6 个
   CLI 测试在 `b49c557` 之前**从未被 CI 执行过**。

旁证：上一次成功的运行 `37413555730`（head `e93ab15`，2026-10-06 04:24，success）的
步骤清单里**确无** `Install exiftool` / `Run CLI tests`。

⇒ 结论：这是**观测点从无到有**，不是回归。同一机制将来只要有人在 CI 里跑
`npm run photos`（照片管线大量用 sharp）也会撞上，所以"把 CI 的 Node 提到 ≥ 20.9"
是必须项而非权宜。

## 已排除的假设（记录在案，避免后来者重查）

| 假设 | 结论 | 证据 |
|---|---|---|
| Node 18 的 test runner 语义不同（`describe` 内 `before` 不执行） | ❌ 不是 | 18.9.0 确实有该 bug（最小复现：钩子不执行 → fixture undefined → 与 CI 同形态报错）；但 **18.20.8（= CI 的 `18.x` 实际解析值）下 40/40 全绿** |
| Ubuntu 的 exiftool 版本（12.76）与本地（13.55）行为不同 | ❌ 不是 | 自 CPAN 取 exiftool **12.76** 本地实跑：写出/读取结果与 13.55 **逐位相同**（`latitude=-6.1184166`、`ref=S/W`、断言 A/B 均通过） |
| lockfile 缺 Linux 平台包（macOS 上生成的 lock） | ❌ 不缺 | `package-lock.json` 含 `@img/sharp-linux-x64`（os=linux, cpu=x64）等全部平台包 |
| `sharp` 的 engines 只是"安装警告"，不影响运行 | ❌ 错 | 对 optionalDependencies 来说它是**跳过安装**的理由（上节复现即为证据） |
| Ubuntu 26 迁移（`ubuntu-latest`） | 与本问题无关 | CI 注解：`ubuntu-latest` 将于 **2026-10-19** 才迁到 Ubuntu 26，现在仍是 24.04 |

## 方案对比

| # | 方案 | 改动面 | 优点 | 缺点 / 风险 |
|---|---|---|---|---|
| **A** | **CI 的 `node-version` 由 `18.x` 提到 `22.x`**（与本地/本机一致） | `.github/workflows/build-deploy.yml` **1 行** | 最小改动；满足 sharp `>=20.9.0`；CI 与本地开发环境口径统一；不动照片管线与任何测试 | 需确认 Node 22 下 `react-scripts build` 正常（本地已在 ≥20.9 的 Node 上构建过；CI 会在同一次运行里给出答案） |
| B | 把 sharp 降到支持 Node 18 的版本（0.33.x） | `package.json` + lockfile | 保住 CI 的 Node 18 | 动的是**照片管线的编码器版本**（AVIF 档位/产物可能变）→ 面大、要重验，且与"派生图档位已拍板"冲突 |
| C | 让测试不再依赖 sharp（内嵌极小 JPEG 字节） | 1 个测试文件 | 测试更少依赖 | **救不了**：`process-photos.js` 顶层 require sharp，`incremental-skip.test.js` 与 `gps-sign.test.js` 都 require 它；且与"运行时现造、仓里不放二进制"的既有原则冲突 |
| D | `package.json` 加 `engines: { node: ">=20.9.0" }` | 1 行 | 把"Node 太低"从静默跳过变成显式告警 | 单用不解决，**是 A 的补充** |

**推荐 A（可附 D）**。B/C 都不解决（B 是拆管线、C 绕不开 process-photos），D 只能
提前告警。

## 选定方案（待用户确认版本）

改动清单（**待批准后才动手**）：

1. `.github/workflows/build-deploy.yml`：`node-version: 18.x` → **`22.x`**
   （若你本地是 20.x，则改成 `20.x` 以完全对齐——请给我 `node -v` 的输出）。
   依赖 `sharp` 需要 **≥ 20.9.0**，20.x / 22.x 都满足。
2. （可选，建议）`package.json` 增加 `"engines": { "node": ">=20.9.0" }`：
   让下次有人在低版本 Node 上 `npm install` 时**至少看到告警**，而不是再次静默跳过。
3. docs 回写：`docs/toolchain.md` 记这个坑（"npm 对 optionalDependencies 遇 engines
   不匹配会静默跳过 → 平台二进制缺失 → require 期才爆；CI 与本地 node_modules 安装
   环境不同时本地不可见"）。

## 验收标准

1. `git diff` 只有上述文件、改动行数 ≤ 2（除 docs）；
2. 推送后该次 workflow：`Run CLI tests` / `Build project` / `Run tests` 全 success，
   `deploy` job success；
3. `gh-pages` tip 出现新提交 `deploy: <本次 main 的 sha>`（≠ `208baaa`）；
4. 线上 `main.<hash>.js` 用**转义串**检索：含 `\u96c5\u52a0\u8fbe`（雅加达）与
   `arcgisonline`（第四档）；
5. 浏览器目视：雅加达切「海外影像」出 Esri 高清；北京/广州切同档与「卫星」一致。

## 风险评估

| 风险 | 对策 |
|---|---|
| Node 22 下 `react-scripts build` 失败 | 该次 CI 会立刻暴露；若失败则回退到 `20.x` 再试（同一次排查内不做无限重试） |
| 本地 Node 若也是 18，则本地重装 `node_modules` 同样会坏（当前只是"以前装的还在"） | 建议本机 Node 也升到 ≥ 20.9（或与 CI 同版）；`package.json` 的 `engines`（改动 2）会提前告警 |
| 改 CI 会不会影响既有构建产物 | 不影响内容：只换 Node 大版本，`CI=true npm run build` 的输出内容与源无关；产物 hash 可能变（正常） |

## 出界清单（本 plan 明确不做）

- **不动 sharp 版本**（不碰照片管线与派生产物）；
- **不改任何测试断言、不 skip 任何测试**（S2：不为迁就环境改代码）；
- 不做 Node 版本矩阵（neither 18/20/22 三跑，也不加 `strategy.matrix`）；
- 不重写/不回滚 `gh-pages` 分支历史，不做 force-push；
- 不改 `test:cli` 的写法（shell 展开写法对 18/20/22 通用，保持）；
- 不追查 "雅加达未上线" 之外的既有线上差异（本 plan 只负责让部署恢复）。

## 实施顺序

1. ✅ 用户回 **A**；本机 `node -v` = `v22.22.2` → CI 定 `22.x`；`engines` 未表态；
2. ✅ 改 workflow（`18.x` → `22.x` + 2 行说明注释）；
3. ✅ 提交推送（`ae403f1`；pre-push ESLint 通过）→ 该次 workflow 全绿、`deploy` success；
4. ✅ 线上验收（gh-pages tip + bundle 关键字；浏览器目视待用户）；
5. ✅ docs 回写（`docs/toolchain.md` 新增一节 + 修正"CI 用 Node 18"的过时表述）。

6. ✅ 用户批准「可选 D」→ `package.json` 加 `engines`（16:47）+ `docs/toolchain.md`
   同步（见下节）。

## 实施记录（2026-10-06 16:3x）

- 用户只回了一个字 **"A"**，未答 `engines` → 按 plan 的改动清单**只动 workflow 一行**，
  **不擅自加 `engines`**（P2：用户未表态的可选项不动手；待其表态后再补）；
- 本机 `node -v` = `v22.22.2`，本机 `require('sharp')` 正常（libvips 8.18.6）→ CI 定
  `22.x`，与本地口径统一（不需要改 `20.x`）；
- 改动：`.github/workflows/build-deploy.yml` 的 `node-version: 18.x` → **`22.x`**，
  另加 2 行注释（写明 sharp 的 engines 下限与后果 + 指向本 plan），防止后人改回；
- 连带提交：本 plan 自身（含「为什么直到 `b49c557` 才暴露」一节）**首次入库**
  （P1：决策记录留痕）；`huochemi-projects.code-workspace` 的改动**非本次所改，已排除**；
- **验收实测（全部通过）**：
  - run `37436850420`（head `ae403f1`）**success**：`Run CLI tests` success、
    `Build project` success、`Run tests` success、`Deploy to gh-pages` success
    （对照：前两次 run 都挂在 `Run CLI tests`、Deploy 被 skipped）
  - `gh-pages` tip = `d0cc78666f11`，提交信息 **`deploy: ae403f1df97a4317a198619e29661e2fe341f2fc`**
    （= 本次 main 的 sha）→ 部署确实由本次提交产生
  - 线上首页引用 **`static/js/main.3a37bdbc.js`**（596 075 B；旧为 `main.b5479f99.js`），
    按转义串检索：`\u96c5\u52a0\u8fbe`（雅加达）**7 次**（改前 0 次）、
    `\u6d77\u5916\u5f71\u50cf`（海外影像）1 次、`arcgisonline` 1 次、
    `server.arcgisonline` 1 次（与定稿域名一致）；`乌兰察布` 129 / `北京` 121 与改前一致
  - ⇒ **线上站点已恢复更新**；雅加达与「海外影像」第四档**首次真正上线**
  - 剩余：浏览器目视（切「海外影像」看 Esri 高清、境内档无错位、左下角署名），
    以及用户对「可选 D（`engines`）」表态

## 追加实施：可选 D（`package.json` 加 `engines`）（2026-10-06 16:47）

- 用户 16:46 表态「改」（指方案 D）；同一条消息确认**浏览器目视已看过、无问题**
  → 验收标准 5 闭合，本 plan 无剩余待办
- 改动：`package.json` 在 `private` 之后插入 `"engines": { "node": ">=20.9.0" }`
  （值取 `sharp` 的 engines 下限，非随手取整），`git diff` 仅此 3 行
- **实测（隔离目录 `/tmp/engprobe` 复刻同字段，不动工作区 `node_modules`）**：
  - Node **18.20.8** + npm 10.8.2 → `npm warn EBADENGINE Unsupported engine {
    package: 'engprobe@1.0.0', required: { node: '>=20.9.0' },
    current: { node: 'v18.20.8', npm: '10.8.2' } }` → **exit 0**
  - Node **22.22.2** + npm 10.9.7 → 无任何警告，exit 0
  - 工作区 `npm pkg get engines` → `{ "node": ">=20.9.0" }`
- ⚠️ **性质必须说清**：`engines` 只把"Node 太低"从**完全静默**变成**安装期告警**，
  **不拦截**（npm 默认 `engine-strict=false`，exit 仍 0，仍会继续装上"能装的部分"，
  sharp 的平台二进制照样缺席、仍在 `require` 期才爆）。要变硬拦需 `.npmrc` 的
  `engine-strict=true` —— **本项目未启用**（未获授权，且它会连 20.9 以下的一切
  npm 操作一起挡住，超出本 plan 的出界清单）
- 出界项照旧未碰：不动 `sharp` 版本、不改测试断言、不动 CI workflow（已是 `22.x`）、
  不新建 `.nvmrc` / `.node-version`
- **lockfile 无需更新（已实测）**：`package-lock.json` 的根包条目只有
  `name` / `version` / `dependencies`（**不记录 `engines`**），故加 `engines` 后
  lock 与 `package.json` 仍同步 —— 用隔离副本（`package.json` + `package-lock.json`）
  跑 `npm ci --dry-run` → **exit 0、无 "in sync" 报错**；CI 现用 `npm install`
  （`build-deploy.yml` 第 31 行），即使将来改成 `npm ci` 也不会因 `engines` 报错
- **验收**：run `37438465022`（head `1d7e80e`）**success** —— `Install NPM packages` /
  `Install exiftool` / `Run CLI tests` / `Build project` / `Run tests` /
  `Deploy to gh-pages` 全部 success。注意 `gh-pages` tip **未变**（仍是
  `deploy: ae403f1…`、线上 bundle 仍是 `main.3a37bdbc.js`）—— 这是**预期而非异常**：
  本次改动不含 `src/` / `public/` 任何文件，构建产物与上次逐字节相同，部署内容无变化
  故无新提交
