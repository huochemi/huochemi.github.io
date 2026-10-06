# 工具链已知坑（toolchain）

构建 / lint / React 工具链积累的坑。AGENTS.md 只保留一行摘要，完整内容以本文件为准。

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

## ESLint CLI lint 目录默认只查 `.js`

用 `eslint src` 这类目录形式时，`.jsx/.ts/.tsx` 文件会被**静默跳过**，检查形同虚设。

- 解法：目录形式必须显式加 `--ext .js,.jsx,.ts,.tsx`
- 本项目标准命令：`./node_modules/.bin/eslint src test --ext .js,.jsx,.ts,.tsx --max-warnings=0`
  （2026-10-04 起把 `test/` 一并纳入，CLI 单测不再落在 lint 盲区）

## CLI 脚本的单测：与前端 jest 分两条链（2026-10-04）

`fix-gps.js` / `process-photos.js` 不是 CRA 的一部分——`react-scripts test` 的
`roots` 固定为 `<rootDir>/src`，扫不到 repo 根的 CLI，所以 CLI 单测另起一条链：

- 位置 `test/*.test.js`；跑法 `npm run test:cli`（= `node --test test/*.test.js`，
  Node 内置 runner，零新依赖）
- **两边互不干扰**（实测）：jest `--listTests` 只列出 `src/` 下三个文件，
  `node --test` 只跑 `test/`；CRA 的 `build` 也只打包 `src/`
- **写法只认"shell 展开"这一种**（2026-10-06 三种写法实测）：
  - `node --test test/`（目录形式）❌ Node 22 报 `Cannot find module '…/test'`
    （22 把位置参数当 glob，`test/` 匹配到目录自身后按模块加载）
  - `node --test "test/**/*.test.js"`（加引号 = 交给 Node 自己展开）⚠️ Node 22 可用，
    但 **CI 用的 Node 18 无 glob 支持**，会被当字面路径 → 跑不起来
  - `node --test`（无参数、靠默认发现）❌ 会把 `src/` 下两个 CRA jest 测试也拉进来
    （node:test 下无 `describe` 全局）→ 2 fail
  - **`node --test test/*.test.js`（shell 展开）✅ 现用**：shell 先展开成显式文件列表
    再交给 Node，与 Node 版本无关（18/22 皆可）
  - 沿革：2026-10-04 首选的是加引号的 glob 形态（`plans/2026-10-04-fix-gps-merge-unit-test.md`），
    因其在 Node 18 上不成立，2026-10-06 改为 shell 展开（`plans/2026-10-06-gps-sign-loss-and-jakarta.md`）
- 代价：shell 展开**不递归子目录**，将来 `test/` 出现子目录需再调整；npm 脚本由 `sh`
  执行（非 zsh），无匹配时把字面量透传给 Node 而不报错，故请勿让 `test/` 变成空目录
- 想让 CLI 里的纯函数可测，必须 `if (require.main === module)` 包住顶层 `main()`
  调用再 `module.exports` 导出；否则 `require` 会直接把整个 CLI 跑起来（这是
  "想测却测不了"的根因，改 CLI 入口时别把守卫去掉）
- **盲区（有意保留）**：合并阈值"恰好 5.000 m"（`<` vs `<=`）没有自动断言。
  构造该距离要经 `sin → asin` 往返，结果带浮点噪声，钉不死这个边界。用变异测试
  实测确认过（把 `mergeAnchors` 的 `<` 改成 `<=`，10 条用例全绿）。实际影响为零：
  真实 GPS 漂移下不会恰好落在 5.000000 m

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
  走修订流程更正

## `fs.createReadStream('/dev/tty')` + readline 会让 CLI 进程永不退出

2026-10-04 在 `fix-gps.js --plan-stdin` 实测（用户报告"汇总打印后程序没退出"）：

- 场景：stdin 被管道占用（`echo '<json>' | npm run fix-gps -- X --plan-stdin`），
  确认键只好改从 `/dev/tty` 读。原实现用
  `readline.createInterface({ input: fs.createReadStream('/dev/tty'), output: process.stdout })`。
- 原因：`fs.ReadStream` 会在 /dev/tty 上留一个**阻塞中的读请求**；`rl.close()` 只是
  暂停接口、`stream.destroy()` 也要等该请求完成，两者都取消不掉 → 该 fs 请求常驻，
  事件循环永不 drain → 汇总打印完就停住（没人动它就永远不退）。
- 解法：换成同步阻塞读，读完即关 fd，零残留句柄——
  `openSync('/dev/tty','r')` → `readSync` → `finally { closeSync(fd) }`；
  canonical 模式下由回车提交（实测 0.7s 正常退出）。
- 已实测**无效**的三种尝试（别重试）：readline 加 `terminal: false`、
  `process.stdin.pause() + unref()`、`finally { rl.close(); stream.destroy(); }`。
- 诊断手法：在收尾处插桩 `process.getActiveResourcesInfo()` /
  `_getActiveHandles()` / `_getActiveRequests()`，直接看谁在吊事件循环。
- 复现工具：`.workbuddy/tools/pty-run.py`（真实 pty 下跑命令并按键、判断是否退出）。

## 派生数组/对象被 useEffect 依赖时必须用 `useMemo` 包住

组件内派生的数组/对象（如 `MapChildren.jsx` 的 `photoList`）若直接写入
`useEffect` 依赖数组，每次渲染都是新引用，触发 `react-hooks/exhaustive-deps`
警告——而 CI（`CI=true`）把所有 warning 当 error，即编译失败。

- 解法：派生值用 `useMemo` 包住保持引用稳定
- 不要用 `eslint-disable` 压制，修根因（见 AGENTS.md 硬性约束）

## `localStorage` 在模块顶层读取的 SSR/测试兼容性

`hcm_group_by` 等模块顶层执行过 `localStorage` 读取。浏览器环境没问题，
但 SSR 或测试环境（无 `window`/`localStorage`）会直接崩。

- 注意：改动相关逻辑时保持惰性求值或加环境守卫

## git 路径含中文时被加引号 → 所有"后缀 `$` 匹配"静默失效（2026-10-05 实测）

`git ls-files` / `git ls-tree` 对**含非 ASCII 字符的路径会加双引号并转义**
（如 `"photos/\345\215\227..."`）。后果是任何形如 `grep '\.webp$'` 的**后缀锚定**
都匹配不上，且**不报错、只是结果为空或 0** —— 属于最危险的一类坑：假通过 / 静默归零。

本 repo 的 `../data` 全部路径都是中文点位名，所以**这个坑每次都会踩到**。

实测踩到的两处（都发生在 2026-10-05）：

| 写法 | 结果 | 真值 |
| --- | --- | --- |
| `git ls-files \| grep -cE '\.(JPG\|HEIC\|JPEG\|MP4)$'` | **0**（"原图零跟踪"假通过） | 152 |
| `git ls-tree -r -l HEAD \| grep '\.webp$' \| awk '{s+=$4}'` | **0.0 MB**（体积统计归零） | 47.3 MB |

**正确写法**（二选一）：

```bash
# ① 首选：-z 交给 NUL 分隔，绕开引号
git ls-files -z | tr '\0' '\n' | grep -ciE '\.(jpg|jpeg|heic|mp4)$'
git ls-tree -r -l -z HEAD | tr '\0' '\n' | grep -E '\.webp$' | awk '{s+=$4} END {printf "%.1f\n", s/1048576}'

# ② 不想加 -z 时，把模式写成允许尾随引号的形式
git ls-tree -r -l HEAD | grep -E '\.webp"?$'
```

- 适用范围：**不止"原图零跟踪"这类判定命令，体积统计同样中招** —— 后面这个更难发现，
  因为它输出的是一个看上去很正常的小数字（0.0 MB）而不是报错
- 连带提醒：`git status --porcelain` 也会有同样的加引号行为，解析它对路径要小心
