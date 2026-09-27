# 城市跳转胶囊条（CityChips）

状态：已批准（2026-09-27 用户确认"开始吧"；agent 侧步骤 1~3 已完成，待用户执行步骤 4 验证并填入真实坐标）
日期：2026-09-27

## 背景（自包含，零上下文可读）

- 站点是照片地图（React 18 + @uiw/react-amap），marker 按拍摄地点散布。
- 当前从甲城市照片切换到乙城市（如北京 → 郑州），用户需手动
  zoom out → drag → zoom in，多步连续空间操作才能完成一次
  "离散目标的跳转"，体验差。
- 根因：地图是连续自由导航空间，而跳转需求本质是离散目标直达；
  缺少针对地点的导航入口。
- 用户决策：城市数据**不从 output.json 派生**，由用户手动维护
  一份独立城市清单，与照片管线零耦合。

## 方案

### 1. 新建 `src/Application/cities.js`（用户手动维护的数据源）

```js
// 城市跳转书签。坐标必须是 GCJ02（火星坐标系，高德原生坐标系）：
// 用高德官方坐标拾取器获取 https://lbs.amap.com/tools/picker
// 搜索地点名 → 点击地图目标点 → 复制坐标。直接填 GPS/WGS84 会偏移几百米。
export const CITIES = [
  { name: '乌兰察布（集宁）', lng: 0, lat: 0, zoom: 13 }, // 占位：待用户用坐标拾取器填入并按需调 zoom
];
```

- 字段：`name`（chip 显示文字）、`lng/lat`（GCJ02 落点）、`zoom`（该城市
  落地视野级别，逐城市单独调）。
- 增删城市 = 编辑本数组，其余自动。种子数据仅放一条占位示例，
  坐标由用户用坐标拾取器填入（agent 不臆造坐标）。

### 2. 新建 `src/Application/Map/AMap/CityChips.jsx` + `CityChips.module.css`

- 渲染于 MapChildren 返回的 fragment 内（该组件已持有
  `mapInstance`，无需新增数据通道），绝对定位悬浮在地图顶部，
  横向滚动胶囊条，毛玻璃半透明底。
- 数据：`import { CITIES } from '../../../cities'`，每项渲染一颗
  chip（纯文字胶囊，不含缩略图/张数）。
- 点击行为：
  - 未选中 chip → `mapInstance.setZoomAndCenter([lng, lat], zoom)`
    （带动画），该 chip 高亮；
  - 再次点击已选中 chip（toggle，用户已确认要）→
    `mapInstance.setFitView()` 回全局视野，取消高亮。
- 高亮清除：`mapInstance.on('dragstart' | 'zoomstart', ...)` 用户手动
  拖动/缩放时取消高亮；组件卸载时 `off` 解绑（useEffect cleanup）。
- 注意：城市坐标是 GCJ02，**不参与** MapChildren 现有的
  `AMap.convertFrom`（gps → gcj02）转换，转换仅针对照片点。

### 3. 样式与布局

- 顶部胶囊条避开现有 `Menu` 按钮（`.menu-btn-wrapper` 位于
  `.map-wrapper` 内），从其右侧起排；多城市场景横向滚动，
  两端渐隐提示（CSS mask 即可，不做翻页按钮）。
- 交互三态样式：默认 / hover / 选中高亮。

## 步骤

1. agent：新建 `src/Application/cities.js`（含坐标系注释与占位种子数据）。
2. agent：新建 `CityChips.jsx` + `CityChips.module.css`，接入 MapChildren。
3. agent：跑门禁
   `./node_modules/.bin/eslint src --ext .js,.jsx,.ts,.tsx --max-warnings=0`，
   `CI=true ./node_modules/.bin/react-scripts build`。
4. 用户：`npm start` 验证交互（见验收标准），并用坐标拾取器把
   `cities.js` 占位坐标换成真实 GCJ02 坐标、按需调各城市 zoom。

## 验收标准

- 顶部胶囊条展示 `cities.js` 全部城市，无遮挡 Menu 按钮；
- 点击 chip 地图带动画飞至对应城市；再次点击同一 chip 回全局视野；
- 手动拖动/缩放地图后高亮自动取消；
- `eslint --max-warnings=0` 与 `CI=true` build 通过；
- 移动端（触屏）可横向滑动胶囊条。

## 出界清单（不做）

- 不做搜索框、不做 Marker 聚合（独立的方案 2/3，本轮未选）；
- 不读/不改 `output.json`，不动照片管线（`process-photos.js` 等）；
- 不改 `DEVELOP.md`（GCJ02 坐标拾取 runbook 由用户自行粘贴，
  宪法规定该文件 agent 不改写）；
- 不动 `AGENTS.md`（无新建 docs 域文件）；
- 不删不改本清单之外的任何文件。

## 备选方案（留痕，含被否决原因）

- **从 output.json 动态派生城市列表**（dirName/封面/张数）：实现后被
  用户否决——用户要手动维护城市数据，与照片数据解耦，改为本方案。
- **1A 抽屉地点列表**：复用 MenuDrawer 但入口需先开抽屉，入口可见性差，
  用户未选。
- **1C zoom 感知城市卡片 Marker**：体验最好但实现量最大（zoom 监听 +
  两套 marker 切换），过度工程，用户未选。
- **方案 2 MarkerClusterer 聚合**：仍需一次缩小操作且引入插件，用户未选。
- **方案 3 搜索框**：受文件夹命名质量制约/需额外 API 配置，用户未选。
- **方案 4 时间线上一处/下一处**：只解决顺序浏览不解决定向跳转，用户未选。
- **setBounds 按照片包围盒自动取景**：依赖照片数据派生视野，与
  "城市数据手动维护"的决策冲突，改为逐城市手动指定 zoom。
