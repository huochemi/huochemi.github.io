# 测试（testing）

本项目有**三条互不干扰的测试链**，以及"想测什么、该写在哪条链上"的形态约束。

| 链 | 跑法 | 覆盖范围 |
|---|---|---|
| CRA jest | `npm test`（= `react-scripts test`） | 仅 `src/`（roots 固定为 `<rootDir>/src`） |
| CLI 单测 | `npm run test:cli`（= `node --test test/*.test.js`） | 仓库根 CLI 脚本（`fix-gps.js` / `process-photos.js` / `delete-photo.js` / `new-place.js`） |
| 构建 | `CI=true npm run build` | 只沿 `src/` 的 import 图打包，不碰 CLI |

三条链在 CI（`.github/workflows/build-deploy.yml`）上都会跑；CLI 单测在 CI 里是**独立
step**（`Run CLI tests`），所以新增 `test/*.test.js` 一定会被 CI 执行。

2026-10-07 从 `docs/toolchain.md` 拆出（该文件当时混了多个知识域，拆分依据见
`docs/plans/2026-10-07-docs-split-by-domain.md`）。跑不动 CLI 单测时先看
`docs/agent-env.md`（沙箱 PATH 缺 `exiftool` 会让 fixture 造不出来）。

---

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
    但 **Node 18 无 glob 支持**，会被当字面路径 → 跑不起来（当初 CI 正是 18.x，故弃用；
    2026-10-06 起 CI 已升 22.x，见 `docs/toolchain.md` 的 sharp engines 一节——但
    **写法保持不变**：shell 展开与 Node 版本无关）
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

## 测"页面内联脚本"的行为：jsdom + `runScripts: 'dangerously'`（2026-10-07）

`fix-gps-review-template.html` 是"数据注入 + 内联 `<script>` 渲染"的单文件页面。要断言
它的**交互行为**（三态渲染、`done` 条是否绑定了事件、点不点得开、进不进 plan JSON），
不必起浏览器，用 jsdom 即可真跑：

- `new JSDOM(html, { runScripts: 'dangerously' })` 载入**注入了真实数据的**模板，页面
  内联脚本会**真执行**；随后读 `document` 断言 DOM（见
  `test/review-page-three-state.test.js`，8 条用例）
- ⚠️ **必须 `runScripts: 'dangerously'`**：默认不执行内联脚本 → 页面渲染成空壳 →
  断言全部"假通过"（这是最危险的一类坑）
- **底图脚本不加载**：测试用的是内存构造的合成数据，不读原图仓、不需要高德 key
  （避免把外部依赖拖进单测）
- 与 `npm run test:cli` 同一条链（node 内置 runner + jsdom），零浏览器依赖
- ⚠️ **jsdom 未在 `package.json` 显式声明**，由 react-scripts 的 jest-environment-jsdom
  **传递带入**。测试里 `require('jsdom')` 失败时**明确抛错并给出补法**（`npm i -D jsdom`），
  **不 skip**——skip 会把"环境没配好"伪装成"测试通过"（同 `test/gps-sign.test.js`
  对 exiftool 的口径）

## 前端纯函数若想被 CLI 单测覆盖，只有"src 内 CJS"这一种形态（2026-10-06）

需求：某个**前端**用的纯函数（例：`src/Application/Map/AMap/overseasTiles.js` 的
`overseasTileUrl`）既要被 webpack 打包进前端，又要被 `npm run test:cli` 的单测
`require` 到。两边各有一条硬约束，交集只有一个：

| 约束 | 后果 |
|---|---|
| CRA 的 `ModuleScopePlugin` 禁止 `src/` **之外**的相对 import | 放仓库根目录 ❌ 前端 import 不了 |
| `package.json` 无 `"type": "module"`，`.js` 按 CJS 解析 | `src/` 下写 ESM 的文件 ❌ node 无法 `require`（SyntaxError） |
| `test/` 是 `node --test` + CJS | 只能 `require`，不能 `import` |
| ⇒ **`src/` 内的 CommonJS**（`module.exports = {...}`） | ✅ 唯一交集：webpack 5 对 CJS 具名导入支持良好，node 也能 require |

补充事实（实测，避免重复调研）：

- ESLint 不会因此报错：`eslint-config-react-app/base.js` 的 `env` 开了 `commonjs: true`
  `node: true`，且整份配置**没有启用 `no-undef`**
- babel-preset-react-app 的 `sourceType` 无论取 `unambiguous` 还是 `module`，该文件都
  没有 ESM 语法可转，最终以 CJS 形式交给 webpack，故具名导入 `import { x } from './y'`
  按 CJS 互操作解析
- **代价**：文件头必须写明"勿顺手统一成 ESM"——否则后来者一次美化就会让
  `npm run test:cli` 整个文件报 `SyntaxError`
- 已否决的替代：根目录 CJS（ModuleScopePlugin 拦）、`.mjs` + node 动态 `import`
  （eslint/import 插件兼容性未验证）
