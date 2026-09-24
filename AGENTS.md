# AGENTS.md

给 AI 编码助手（WorkBuddy / Codex / Cursor / Claude Code 等）的项目工作指引。

## 项目概况

- 技术栈：React 18 + react-scripts 5（Create React App），AMap 地图（@uiw/react-amap），部署到 GitHub Pages
- ESLint：8.57.0，由 react-scripts 自带，配置在 `package.json` 的 `eslintConfig`（extends `react-app`）
- 业务领域：照片地图站（`src/output.json` 为构建产物数据，勿手改）

## 硬性约束

- **CI 把所有 ESLint warning 当 error**（`CI=true` 时 react-scripts 的行为）。因此代码里不允许留下任何 lint warning，不要写 `eslint-disable` 压制，要修根因
- 本地验证 CI 结果：`CI=true ./node_modules/.bin/react-scripts build`
- 推送前有 pre-push 钩子（`.git/hooks/pre-push`）跑
  `eslint src --ext .js,.jsx,.ts,.tsx --max-warnings=0`，有 warning 会被拒绝推送

## 已知坑

- **ESLint CLI lint 目录默认只查 `.js`**，`.jsx/.ts/.tsx` 会被静默跳过，
  必须加 `--ext .js,.jsx,.ts,.tsx`，否则检查形同虚设
- `react-scripts build` 报 `EEXIST: file already exists, mkdir build`：
  webpack 残留缓存问题，删除 `node_modules/.cache` 后重试即可，不要动 `build/` 本身
- 组件内派生的数组/对象（如 `MapChildren.jsx` 的 `photoList`）若被 `useEffect`
  依赖，必须用 `useMemo` 包住以保持引用稳定，否则触发
  `react-hooks/exhaustive-deps` 警告（CI 中即编译失败）
- `localStorage` 相关读取在模块顶层执行过（如 `hcm_group_by`），改动相关逻辑时
  注意 SSR/测试环境兼容性

## 工作约定

- 修改代码后先跑 `./node_modules/.bin/eslint src --ext .js,.jsx,.ts,.tsx --max-warnings=0`
  再交付
- `.vscode/` 与 `.gitignore`、`AGENTS.md` 应提交；`.workbuddy/` 已被 gitignore，勿提交
- 领域知识（AMap API 链接等）由用户手动维护在 `DEVELOP.md`，Agent 不要改写它；
  Agent 积累的工具链/流程知识写入本文件
