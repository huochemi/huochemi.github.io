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

## 已知坑（摘要，细节见 docs/）

- ESLint CLI lint 目录默认只查 `.js`，必须加 `--ext .js,.jsx,.ts,.tsx` → docs/toolchain.md
- `react-scripts build` 报 EEXIST：删 `node_modules/.cache` 重试，别动 `build/` → docs/toolchain.md
- useEffect 依赖的派生数组/对象必须用 `useMemo` 包住（CI 中 warning 即失败）→ docs/toolchain.md
- 模块顶层有 `localStorage` 读取（如 `hcm_group_by`），注意 SSR/测试环境 → docs/toolchain.md
- sharp 预编译包不含 HEVC 解码器，HEIC 需先经 sips 转码（已实现）→ docs/data-pipeline.md
- `.HEIC` 不可直接作 web 分发链接（遗留，未处理）→ docs/data-pipeline.md
- Lightbox 大图必须走 `displayLink`（1920px WebP 展示档），`webViewLink` 原图（数 MB）仅作下载入口 → docs/data-pipeline.md
- 照片缺 GPS：普通照片构建期 warn（前端回退封面坐标），封面缺 GPS 硬 error → docs/data-pipeline.md

## 工作约定

- 修改代码后先跑 `./node_modules/.bin/eslint src --ext .js,.jsx,.ts,.tsx --max-warnings=0`
  再交付
- `.vscode/` 与 `.gitignore`、`AGENTS.md`、`docs/` 应提交；`.workbuddy/` 已被 gitignore，勿提交
- 领域知识（AMap API 链接等）由用户手动维护在 `DEVELOP.md`，Agent 不要改写它；
  Agent 积累的工具链/流程知识写入 `docs/` 对应域文件（现有 `toolchain.md`、
  `data-pipeline.md`），本文件只留一行摘要 + 指针
- **知识回写纪律**：新坑/新知识 → 写入 `docs/` 对应域文件（无对应文件时按知识域
  新建），AGENTS.md 同步加一行指针；不预建空文件；单文件超 200 行时按域蒸馏拆分
