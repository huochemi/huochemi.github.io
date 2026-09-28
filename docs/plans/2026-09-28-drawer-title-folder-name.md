# 底部抽屉标题显示文件夹名（方案 A）

状态：已实现（2026-09-28；eslint --max-warnings=0 与 CI=true build
均通过；待用户 npm start 验收）
日期：2026-09-28

## 背景（自包含，零上下文可读）

- 站点是照片地图（React 18 + @uiw/react-amap），点击 Marker 打开底部
  抽屉（Bottom Sheet），抽屉 Header 标题目前写死为「照片列表」，右侧
  有张数徽标。
- 文件夹名 `dirName` 目前只在 Lightbox 的「ⓘ」信息面板中展示且默认
  收起，用户选组/浏览照片列表阶段看不到自己点开的是哪个文件夹。
- 数据边界：`output.json` 中文件夹分组对象与 flatten 后的照片对象
  均带 `dirName`（`MapChildren.jsx` 的 `flattenPhotos` 已把它下发到
  每张照片），两种分组模式（folder / photo）下 `selectedGroup.dirName`
  均有值，无需改数据层。
- 用户已对比 A（抽屉 Header）/ B（Marker tooltip）/ C（Lightbox
  顶栏）/ D（地图 HUD）四方案，选定 **A：抽屉 Header 显示文件夹名**
  ——改动最小、出现时机语义最贴切（用户选中一组照片的瞬间）。

## 方案

### 1. 修改 `src/Application/Map/AMap/MapChildren.jsx`

- 抽屉 Header 标题：`<span>照片列表</span>` 改为显示
  `selectedGroup.dirName`；`dirName` 为空时回退显示「照片列表」
  （宁缺毋假，不渲染空标题）。
- 张数徽标保持不变。

### 2. 修改 `src/Application/Map/AMap/MapChildren.module.css`

- `dirName` 可能很长（实测最长「乌兰察布（集宁）-通州街跨京包线
  公路桥」，移动端 50% 宽抽屉内可溢出）：标题文本 span 加
  截断样式（`flex: 1; min-width: 0; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis`），徽标不被挤压。

## 验收标准

1. 点击任一 Marker，抽屉标题显示该组 `dirName`，徽标张数正确；
2. folder / photo 两种分组模式（`hcm_group_by`）下均正常；
3. 移动端宽度下长文件夹名截断为省略号，不换行、不挤压徽标和
   关闭按钮；
4. `./node_modules/.bin/eslint src --ext .js,.jsx,.ts,.tsx
   --max-warnings=0` 通过；
5. `CI=true ./node_modules/.bin/react-scripts build` 通过。

## 出界清单（本轮不做）

- 方案 B / C / D（Marker tooltip、Lightbox 顶栏、地图 HUD）；
- `output.json` 数据结构变更（`dirName` 已有，无需动）；
- 抽屉其余 UI（Header 布局、徽标样式、关闭按钮）不动。
