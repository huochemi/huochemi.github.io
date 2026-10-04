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

- 位置 `test/*.test.js`；跑法 `npm run test:cli`（= `node --test "test/**/*.test.js"`，
  Node 内置 runner，零新依赖）
- **两边互不干扰**（实测）：jest `--listTests` 只列出 `src/` 下三个文件，
  `node --test` 只跑 `test/`；CRA 的 `build` 也只打包 `src/`
- **`node --test test/`（目录形式）会失效**：Node 22 把位置参数当 **glob** 而非目录，
  `test/` 匹配到目录本身后按模块加载 → `MODULE_NOT_FOUND`（`ERR_TEST_FAILURE`）。
  必须写成 `node --test "test/**/*.test.js"`——**加引号交给 Node 自己展开**，
  别依赖 shell glob（无匹配时 zsh 会直接报错）
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

结论与处理：

- `build/` 已存在时，agent 环境跑 CI build 必失败。不是项目 bug
  （S2：触发条件不在用户真实使用路径，用户终端永不触发）
- 门禁操作：`build/` 已存在时，CI build 门禁交由用户在终端执行；
  `build/` 不存在时 agent 可自行跑（mkdir 会被放行）
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
