# agent 执行环境与用户终端的差异（agent-env）

本文件收的都是 **agent 独有**的现象：同样的命令，agent 侧失败、**用户终端永不触发**。
两条共同定性：

- **不是项目 bug**（S2：触发条件不在用户真实使用路径）⇒ 不要为此改项目代码
- **处置次序**：先用绝对路径试一次 → 仍不行就**交用户终端执行**（S3：不做多重兜底）

环境由两层构成：**broker 权限拦截层**（对文件操作合成错误码，见下第二节）与**受限
PATH**（不含 Homebrew 的 `/opt/homebrew/bin`，与用户终端 zsh 不同，见第一节）。

2026-10-07 从 `docs/toolchain.md` 拆出（该文件当时混了多个知识域，拆分依据见
`docs/plans/2026-10-07-docs-split-by-domain.md`）。

---

## agent 沙箱 shell 的 PATH 不含 `/opt/homebrew/bin`

agent 执行命令用的是一套固定的受限 PATH，不包含 Homebrew 的 `/opt/homebrew/bin`
（用户终端 zsh 通过 shell 配置加载了它）。brew 安装的命令（如 `exiftool`）在
agent 侧 `which` 报 not found **≠ 未安装**。

- 处理：brew 装的命令一律先用绝对路径试（如 `/opt/homebrew/bin/exiftool`，
  已验证存在且可执行）；绝对路径也不行再交用户终端执行（S3：不做多重兜底）
- 定性：这是 agent 环境限制，不是项目 bug（S2：触发条件不在用户真实使用路径，
  用户终端永不触发），不要为此改项目代码
- 本 repo 外部命令依赖盘点（2026-10-03）：`sips`（macOS 原生 `/usr/bin`，
  沙箱 PATH 含 `/usr/bin`，不受影响）与 `exiftool`（唯一 brew 依赖）。注意脚本
  内部用裸命令名调 `exiftool`（`fix-gps.js` 的 `execFileAsync('exiftool',...)`），
  按 PATH 解析——**agent 在沙箱里跑 `npm run fix-gps` 即使知道绝对路径也会在
  预检处报"未找到"**；按 S1/S2，写 EXIF 的执行本就交用户终端，这不是缺陷
- **同源症状（2026-10-06 实测）**：`npm run test:cli` 在沙箱里**退出码 1**，摘要显示
  `pass 38 / fail 0 / cancelled 2` —— 被取消的是 `test/gps-sign.test.js` 那两条依赖
  fixture 的断言（错误文本 `test did not finish before its parent and was cancelled`）。
  根因同上：fixture 由 `exiftool` 现造，PATH 里没有它 → `before` 钩子失败 → 子测试被取消。
  **判据**：`PATH=/opt/homebrew/bin:$PATH npm run test:cli` 即可全绿（实测 40/40、exit 0）。
  所以看到 `cancelledByParent` **先补 PATH，别当成代码回归**去查测试写法
  （`fail 0` 与 `cancelled 2` 并存、且退出码为 1，是这一情形的特征）

## react-scripts build 报 `EEXIST: file already exists, mkdir build`

**真因（2026-09-27 深夜实验钉死）：agent 环境的权限拦截层（broker） deny
了对 `build/` 的非递归 mkdir，并合成 Node 格式的 EEXIST 错误，不是
webpack 缓存问题。**"删 `node_modules/.cache` 可修"是假相关（当晚
缓存删除与构建成功碰巧先后发生），此前归因错误。

证据链（均可复现）：

- agent shell 内 `readdirSync('build')` 正常——目录存在且可读，
  "目录已存在"本身不是问题
- `fs.mkdirSync('build')`（非递归）→ 报 code `CODEBUDDY_BROKER_DENY`，
  message 伪装成 Node 原生 `EEXIST: file already exists, mkdir .../build`；
  而 `fs.mkdirSync('build', {recursive: true})` → 通过
- webpack 5 `lib/util/fs.js` 的 `mkdirp` 用非递归 mkdir + 以
  `err.code === 'EEXIST'` 判断后自愈；broker 伪造错误的 code 不是
  `EEXIST` → 自愈失效 → 错误上抛 → build 失败
- 用户终端无 broker：真实 EEXIST 被 mkdirp 正常自愈 → 成功（这就是
  "用户跑成功、agent 跑失败"的全部原因）
- 已排除：node 版本（v20 / v22 都失败）、缓存状态（用户在未删缓存的
  情况下成功）。注意：拦截层与 bash 沙箱是两套机制——本机
  `sandbox.enabled` 未设置（默认 false，沙箱本来就没开），拦截来自
  文件权限规则层（settings.json 的 orderedRules + 内置安全检查）

**2026-10-05 复核——推翻上一条"`build/` 不存在时 agent 可自行跑"的旧结论：**

三路实测（node v22.22.2，当前 broker 规则）：

| 形式 | 目标目录 | 结果 |
| --- | --- | --- |
| `CI=true npm run build` | `build/` 已存在 | ❌ 同一 `EEXIST ... mkdir build` |
| `CI=true BUILD_PATH=.build-verify npm run build` | **全新**目录 | ❌ 同样失败 |
| 探针 `fs.mkdirSync('<不存在目录>')` | 不存在 | ✅ 成功 |

第三路尤其关键：**目标目录全新也失败**，且失败时该目录已被 CRA 写入 `public/`
拷贝（`favicon.ico` / `logo192.png` / `manifest.json` …）。机制是 CRA 构建**先**
创建输出目录（`emptyDirSync`，内部递归 mkdir → 被放行），**随后** webpack 5 的
`mkdirp` 对该**已存在**目录再做一次非递归 mkdir → 撞上 broker 拦截。所以失败与
`build/` 是否预先存在**无关**。

命令形式也**无关**：`npm run build` 的展开就是 `react-scripts build`（B 路输出首行
`> react-scripts build` 可证），与 `./node_modules/.bin/react-scripts build` 是同一
二进制、同一失败点。

结论与处理：

- **agent 环境跑 CI build 必失败**，与 `build/` 是否预先存在、与命令形式均无关。
  不是项目 bug（S2：触发条件不在用户真实使用路径，用户终端永不触发）
- 门禁操作：CI build **一律交用户终端或 CI 执行**；agent 不必再尝试，也**不必**
  先删 `build/`（删了同样失败——CRA 会先把目录建回来）
- 命令形式取 `CI=true npm run build` 即可（合"npm run 语义化"惯例；用户终端下
  两种写法完全等价）
- ⚠️ **副作用**：agent 一旦执行 build（任一形式），CRA 的"建前清空"会**清空现有
  `build/`**（2026-10-05 实测：原 2026-09-29 的完整产物被清成只剩 public 拷贝）。
  故 agent 不要在用户工作区随手试跑 build
- AGENTS.md 流程 2 的"报 EEXIST 删 node_modules/.cache 重试"按 E1
  走修订流程更正（已于 2026-10-05 `f01c93c` 完成）
