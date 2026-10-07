# 工具链已知坑（toolchain）

构建 / lint / CI 依赖 / 命令行工具积累的坑。AGENTS.md 只保留一行摘要，完整内容以本文件为准。

**两个知识域已于 2026-10-07 拆出**（依据 `docs/plans/2026-10-07-docs-split-by-domain.md`；
旧引用「见 docs/toolchain.md」按此表跳转）：

| 要查的知识 | 去哪 |
|---|---|
| agent 沙箱 PATH 缺 Homebrew、`react-scripts build` 报 EEXIST（broker 拦截） | `docs/agent-env.md` |
| CLI 单测与 jest 两条链、jsdom 测内联脚本、`src` 内 CJS 可测形态 | `docs/testing.md` |

## ESLint CLI lint 目录默认只查 `.js`

用 `eslint src` 这类目录形式时，`.jsx/.ts/.tsx` 文件会被**静默跳过**，检查形同虚设。

- 解法：目录形式必须显式加 `--ext .js,.jsx,.ts,.tsx`
- 本项目标准命令：`./node_modules/.bin/eslint src test --ext .js,.jsx,.ts,.tsx --max-warnings=0`
  （2026-10-04 起把 `test/` 一并纳入，CLI 单测不再落在 lint 盲区）

## CI 的 Node 版本必须满足 `sharp` 的 `engines`（npm 会静默跳过 optionalDependencies）（2026-10-06）

**症状**：CI 里 `Run CLI tests` 恒红（`test/gps-sign.test.js` 整体失败），其余测试文件全绿；
本地 `npm run test:cli` 却恒绿。

**根因**：`sharp@0.35.4` 的 `engines.node` 是 `>= 20.9.0`，而 CI 当时用 Node 18.x。
`sharp` 的**平台二进制**（`@img/sharp-<platform>`，含 `.node`）写在 **optionalDependencies**
里，而 npm 对 optional 依赖遇 engines 不匹配时**只警告（`npm warn EBADENGINE`）、不报错，
并静默跳过该包** → 无 engines 的 `@img/sharp-libvips-*` 装上了、含二进制的
`@img/sharp-*` 没装 → `require('sharp')` 抛
`Could not load the "sharp" module using the <platform> runtime`。

- **最小复现**（隔离目录，别在生产数据上跑）：Node 18.20.8 下 `npm install sharp@0.35.4`
  → 只有 `npm warn EBADENGINE`、`added 5 packages`、**exit 0**，`node_modules/@img` 里缺
  `sharp-<platform>`；Node 22 对照为 `added 9 packages`、`require('sharp')` 正常
- **只有执行到 `require('sharp')` 的路径才爆**：所以 `Install NPM packages` 与
  `Build project` 两步都是绿的——webpack 只沿 `src/` 的 import 图打包，仓库根的 CLI
  脚本（`process-photos.js` 顶层 `require('sharp')`）不在其中
- **本地不可见的原因**：本地 `node_modules` 是更早在 Node ≥ 20.9 下装的，二进制已在盘上。
  差异只在"安装期"，运行期看不出来——**换机器 / 换 CI 才暴露**
- **判据**：CI 的 `node-version` 必须 ≥ 20.9（本项目 2026-10-06 起为 `22.x`，与本机
  `node -v` 一致）。同理，凡在 CI 里跑照片管线（`npm run photos`）也会撞上这条
- **别只看 exit code**：npm 装包返回 0 不代表依赖齐全；`EBADENGINE` 与"跳过的包数"
  才是信号
- **本项目已加 `engines` 兜告警（2026-10-06，方案 D）**：根 `package.json` 现声明
  `"engines": { "node": ">=20.9.0" }`（值即 `sharp` 的 engines 下限）→ 低版本 Node 下
  `npm install` 会打 `npm warn EBADENGINE Unsupported engine { … required: { node:`
  `'>=20.9.0' }, current: { node: 'v18.20.8' } }`（实测：18.20.8 出现、22.22.2 无）
- ⚠️ **`engines` 只告警、不拦截**：npm 默认 `engine-strict=false` → `EBADENGINE` 之后
  **exit 仍为 0**，照样装完"能装的部分"（sharp 平台二进制依旧缺席、`require` 期才爆）。
  要变成硬拦需 `.npmrc` 的 `engine-strict=true`，本项目**未**启用
- 决策记录：`plans/2026-10-06-ci-red-node18-sharp-optional-skip.md`

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

## 命令行工具的"静默归零"：返回值看着正常，实为空（2026-10-07 归纳）

一类**最危险的坑**：命令不报错、退出码正常，但结果为空或归零 —— 空结果**看起来像证据**，
实际是**假阴性**。已知两个实例，判据相同（见本节末）。

### 实例 1：`git` 路径含中文时被加引号 → 所有"后缀 `$` 匹配"静默失效（2026-10-05 实测）

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

### 实例 2：macOS 自带 `grep` 的 `\|` 交替不生效（2026-10-07 实测）

- 现象：`grep -n "A\|B" 文件` **返回空、退出码 1、零报错** —— 与"文件里既没有 A 也没有 B"
  完全不可区分。根因：`\|` 交替是 GNU grep 的扩展，**BSD grep（macOS 自带）不支持它**，
  于是整个模式被当成一个匹配不到的字面串 ⇒ 静默返回空
- **最小复现**（可直接粘贴验证）：

  ```bash
  printf 'a\nb\n' | grep -c 'a\|b'        # 0  ← 应为 2：假阴性
  printf 'a\nb\n' | grep -cE 'a|b'        # 2  ← 正确（-E 下用裸 |）
  printf 'a\nb\n' | grep -ce 'a' -e 'b'   # 2  ← 正确（分次 -e）
  ```

- 同族（此前已记）：`\b` 在 `-E` 下同样不生效
- 受害面：**"搜不到 ⇒ 不存在"这类否定性结论**。2026-10-07 实测踩中两次：① 用它搜
  `AGENTS.md` 里的 200 行阈值条款 → 返回空（条文其实就在 L70-71）；② 凭同样的空结果
  把"这条规则没有任何决策记录"写成了结论 —— 而工作日志里其实有该规则的 6 处记录
  （含它的出生提交 `eb69afc`，以及"已第二次提醒用户"那条）
- 正确写法（三选一）：① 用 ripgrep（`rg`，支持 `|` 交替）；② 分次单串搜；
  ③ 坚持用 BSD grep 就写 `grep -E 'A|B'` 或 `grep -e A -e B` —— **别写 `\|`**

### 共同判据

**"我搜了、没有"这类结论，必须换一种方式交叉验证后才能落笔**，静默空结果不能当证据。
实例 1 里 `grep '\.webp$'` 返回 0 不等于没有 webp 文件，实例 2 里 `grep 'A\|B'` 返回空
也不等于 A、B 都不存在 —— 机制不同、陷阱同源：**命令"看起来成功了"与"它的结论可靠"
是两件事**。
