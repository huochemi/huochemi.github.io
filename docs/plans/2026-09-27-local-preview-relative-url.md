# 本地预览解耦 data repo 提交（相对路径 + setupProxy）

状态：已批准（2026-09-27 用户确认"开始实现吧"；agent 侧步骤 1~3 已完成，待用户执行步骤 4~5 验证）
日期：2026-09-27

## 背景（自包含，零上下文可读）

- 前端照片数据 `src/Application/output.json` 由 `npm run photos`（根目录
  `process-photos.js`）从 `../data/photos` 生成，链接字段存生产绝对 URL
  `https://huochemi.github.io/data/photos/...`。
- 本地 `npm start`（localhost:3000）的 dev server 只能服务本仓库文件，无法
  服务上述绝对 URL 指向的生产路径 → 新照片必须先提交 data repo（等于先
  上线）才能在本地预览；增删照片需反复提交 data repo。
- 关键事实：站点（用户站 `huochemi.github.io`）与 data（项目站
  `huochemi.github.io/data/`）同域，站内相对路径 `/data/photos/...` 在生产
  的解析结果与绝对 URL 一字不差。

## 方案

1. **agent**：`process-photos.js` 第 17 行 `BASE_URL` 从
   `https://huochemi.github.io/data/photos` 改为 `/data/photos`，附注释说明。
2. **agent**：新建 `src/setupProxy.js`：

   ```js
   const path = require('path');
   const express = require('express');

   // 仅 dev server（npm start）生效；react-scripts 原生加载本文件，build 不受影响。
   // 把 /data 挂载到本地 data 仓库（../../data），本地增删照片无需先提交 data repo。
   module.exports = function (app) {
     app.use('/data', express.static(path.join(__dirname, '..', '..', 'data')));
   };
   ```

   依据（已查证）：react-scripts 5.0.1 原生加载 `src/setupProxy.js`
   （`node_modules/react-scripts/config/webpackDevServer.config.js` 的
   `onBeforeSetupMiddleware`：`fs.existsSync(paths.proxySetup)` →
   `require(paths.proxySetup)(devServer.app)`）；express 是其传递依赖，
   可直接 require。仅 dev server 生效，`build` 不受影响。
3. **agent**：跑门禁
   `./node_modules/.bin/eslint src --ext .js,.jsx,.ts,.tsx --max-warnings=0`。
4. **用户**：跑 `npm run photos` 完成 output.json 迁移。pipeline 对原图
   **只读**（`exifr.gps()`/`exifr.parse()` 只读 EXIF；回写原图是 `fix-gps.js`
   的事）；副作用仅为全量重生成 `_thumb`/`_display.webp`（内容等价，Git 可能
   显示全量 modified，属正常）。
5. **用户**：跑 `npm start`，用一个未提交的新文件夹验证 localhost:3000。

## 验收标准

- localhost:3000 能看到 data repo 中未提交的新文件夹照片；
- 生产推送后图片链接行为与现在一致（相对路径同域解析）；
- `eslint --max-warnings=0` 通过；`CI=true ./node_modules/.bin/react-scripts build` 通过。

## 出界清单（不做）

- `src/Application/MapIcon/MapIcon.jsx`（demo 硬编码，用户明确保留）；
- 不写一次性替换脚本（output.json 迁移靠重跑 pipeline，用户决策）；
- 不动 git，不改本清单之外的任何文件；
- `docs/data-pipeline.md` 知识回写：实现验证通过后单独提请用户批准
  （按宪法流程 3：知识进既有域文件，AGENTS.md 不动）。

## 备选方案（留痕，含被否决原因）

- **环境变量覆盖 base + 第二静态服务器**：不修根因（output.json 仍存绝对
  路径），本地需跑两个进程，否决。
- **自建 dev server（craco/rewired）**：改动大收益相同，过度工程，否决。
- **public/ 软链**：本地 build 会把照片拷进 `build/`，且污染 public/，被
  setupProxy 方案取代。
- **一次性脚本替换 output.json 前缀**：用户否决——费 token、易出 bug，
  重跑 pipeline 更简单且对原图只读、安全。
