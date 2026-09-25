# 工具链已知坑（toolchain）

构建 / lint / React 工具链积累的坑。AGENTS.md 只保留一行摘要，完整内容以本文件为准。

## ESLint CLI lint 目录默认只查 `.js`

用 `eslint src` 这类目录形式时，`.jsx/.ts/.tsx` 文件会被**静默跳过**，检查形同虚设。

- 解法：目录形式必须显式加 `--ext .js,.jsx,.ts,.tsx`
- 本项目标准命令：`./node_modules/.bin/eslint src --ext .js,.jsx,.ts,.tsx --max-warnings=0`

## react-scripts build 报 `EEXIST: file already exists, mkdir build`

webpack 残留缓存问题。

- 解法：删除 `node_modules/.cache` 后重试
- 注意：不要动 `build/` 目录本身

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
