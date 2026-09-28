# 城市跳转两段式飞行动画（仿 flyTo）

状态：草稿（待用户批准）
日期：2026-09-28

## 背景（自包含，零上下文可读）

- 站点是照片地图（React 18 + @uiw/react-amap，AMap JS API 2.0）。
  顶部城市胶囊条 `src/Application/Map/AMap/CityChips.jsx` 已上线：
  点击 chip → `map.setZoomAndCenter(city.zoom, [lng, lat])` 带高德默认
  动画跳转；再点已选中 chip → `map.setFitView()` 回全局视野。
- 现状体验问题：AMap 默认动画是"缩放 + 平移同时进行"，跨省跳转
  （如北京 → 郑州约 600km）时地图斜着飞过去，观感生硬；
  `setFitView()` 不支持指定时长，回全局的节奏不受控。
- 用户决策（2026-09-28）：采用**两段式飞行**（起飞缩小 → 巡航平移 →
  降落放大，仿 Google Maps flyTo）；同轮明确暂不处理其他候选方案
  （见备选方案留痕）。

## 待验证推测（非事实断言，不阻塞实现）

- 推测：AMap 程序化调用 `setZoomAndCenter` 可能同样触发 `zoomstart`
  事件（文档仅说"缩放开始时触发"，未区分来源），若是，则现有
  `zoomstart → 清除高亮` 监听会在点击 chip 后被程序自身触发而误清高亮。
  **此推测未经浏览器验证。**
- 处理：设计上使正确性**不依赖该推测真伪**——飞行编排期间置
  `isFlying` 标志，清除高亮的回调里 `isFlying` 为 true 时直接忽略。
  无论推测是否成立，该守卫均无害且行为正确。实施时顺手在浏览器
  console 验证一次，结果写入本文件状态行备注，不另开任务。

## 方案

仅改 `src/Application/Map/AMap/CityChips.jsx` 与
`src/Application/cities.js`（各一处），不动其他文件。

### 1. `cities.js` 增加全局视野常量

```js
// 回全局视野的落点（GCJ02，同坐标拾取器纪律），toggle 时三段式飞往此处
export const GLOBAL_VIEW = { lng: 108, lat: 36, zoom: 4.5 };
```

- 理由：现 toggle 用 `setFitView()`，视野随全部 marker 包围盒漂移、
  无时长控制；固定落点可控且可被用户用坐标拾取器微调。
- 种子值仅为占位示意，由用户确认/调整（agent 不臆造坐标）。

### 2. `CityChips.jsx` 编排三段式飞行

新增 `flyTo(zoom, lnglat)` 函数（组件内，不抽公共模块）：

- **近距退化**：用 `AMap.LngLat.distance()` 估算当前中心到目标距离，
  小于 200km 时退化为单段 `setZoomAndCenter(zoom, [lng, lat], false, 800)`，
  避免"为跳 50km 先起飞"的过度动画。
- **远距三段**（事件驱动，不用 setTimeout 链）：
  1. 起飞：`setZoom(min(当前zoom, 目标zoom) - 2, false, 400)`
     （下限 clamp 到 4，AMap PC 端 zoom 范围下限 3）；
  2. 监听一次性 `zoomend` → 巡航：`setCenter([lng, lat], false, 500)`；
  3. 监听一次性 `moveend` → 降落：`setZoom(目标zoom, false, 400)`；
  4. 结束后 `off` 解绑、清 `isFlying`。
- **中断安全**：
  - 组件持有 flightRef（当前编排的解绑函数）；新点击到来时先
    cancel 上一次飞行再起新编排，防止连点叠加抖动；
  - `dragstart`（只可能来自用户）触发时终止编排并清除高亮；
  - `zoomstart` 触发的清除高亮回调加 `isFlying` 守卫（见上节）。
- 时长常量（400/500/800ms）放组件顶部集中可调。

### 3. toggle 回全局

再点已选中 chip：取消高亮 + `flyTo(GLOBAL_VIEW.zoom, [GLOBAL_VIEW.lng, GLOBAL_VIEW.lat])`，
替换现有 `setFitView()`。

## 步骤

1. agent：浏览器验证推测（console 挂 `map.on('zoomstart', console.log)`
   后程序化调一次 `setZoomAndCenter`），结果记入本文件状态行。
2. agent：`cities.js` 加 `GLOBAL_VIEW`（占位值 + 注释说明待用户调整）。
3. agent：`CityChips.jsx` 实现 `flyTo` 编排与中断安全逻辑，toggle 改走 `flyTo`。
4. agent：跑门禁 `./node_modules/.bin/eslint src --ext .js,.jsx,.ts,.tsx
   --max-warnings=0`；`CI=true ./node_modules/.bin/react-scripts build`。
5. 用户：`npm start` 按验收标准逐条验证，并用坐标拾取器确认
   `GLOBAL_VIEW` 落点。

## 验收标准

1. 远距跳转（北京 ↔ 郑州）呈现 起飞缩小 → 巡航平移 → 降落放大 三段
   动画，节奏平滑不生硬；近距跳转为单段平滑过渡；
2. 再点已选中 chip，同样动画飞回全局视野，高亮取消；
3. 飞行中快速连点其他 chip：上一次动画立即取消，无叠加/抖动；
4. 飞行中用户拖动地图：编排终止，地图不再被程序接管；
5. 手动拖动/缩放地图后高亮自动取消（与现状一致）；
6. `eslint --max-warnings=0` 与 `CI=true` build 通过。

## 出界清单（本轮不做）

- 不加独立的"全局"chip 按钮（维持"再点 toggle"交互）；
- 不做方案 C 城市聚光灯 / marker 淡化；
- 不改 `MapChildren.jsx` 的 `panTo`（点 marker 居中逻辑保持现状）；
- 不动地图初始视野 `setFitView` 逻辑（另有 2026-09-28 初始视野 plan 管）；
- 不动 `output.json`、照片管线、`DEVELOP.md`、`AGENTS.md`（无新建
  docs 域文件，路由不加行）；
- 不删不改本清单之外的任何文件。

## 备选方案（留痕，含被否决原因）

- **方案 A 修补现状**（修疑似高亮 bug + 加"全局"chip + 手动指定
  `setZoomAndCenter` 第 4 参时长）：单段动画仍无法解决长距离斜飞观感，
  用户未选（2026-09-28 反馈"B 可行"）。
- **rAF 逐帧自绘插值**：每帧手动 `setZoomAndCenter(..., true)`，与 SDK
  内部动画状态机打架、实现复杂、易产生渲染撕裂，否决。
- **setTimeout 链编排**：对动画时长硬编码耦合，SDK 动画实际时长与
  定时器漂移会导致段落错位；选事件驱动（zoomend/moveend）替代。
- **toggle 仍用 setFitView**：视野随 marker 包围盒漂移不可控、无时长
  控制，改为固定 `GLOBAL_VIEW` 落点。
