# 地图初始视野跟随照片数据（方案 A：修复 setFitView 时序）

状态：已实现（2026-09-28；eslint --max-warnings=0 通过；CI build 门禁
因 agent 环境 broker 限制无法执行——见 docs/toolchain.md
"EEXIST: mkdir build" 条目，待用户终端跑 CI=true build 验收）
日期：2026-09-28

## 背景（自包含，零上下文可读）

- 站点是照片地图（React 18 + @uiw/react-amap）。地图初始落点 hardcode 在
  `src/Application/Map/index.jsx`：`amapCenter = { latitude: 39.871446,
  longitude: 116.215768 }`，`defaultZoom={16}`。
- `src/Application/Map/AMap/MapChildren.jsx` 的加载 effect（约第 70-90 行）
  在 `AMap.convertFrom`（GPS→GCJ02 坐标批量转换）回调里 `setPhotos()`
  后**紧跟着调了一次 `mapInstance.setFitView()`**——但 `setPhotos` 是异步
  state 更新，此刻 React 尚未把 `<Marker>` overlay 渲染到地图上，
  `setFitView()` 找不到任何 overlay，静默空转。地图视野因此始终停在
  hardcode 的初始位置，这就是用户感知"默认位置是写死的"的根因。
- 目标：初始视野自动包住全部照片 marker（与 CityChips "回全局视野"
  的 `setFitView` 行为一致），照片数据变化后无需改任何代码。

## 方案

仅改 `src/Application/Map/AMap/MapChildren.jsx`，一行级修复：

1. 删除 `AMap.convertFrom` 回调内的 `mapInstance.setFitView()`
   （时序上必然空转的那次）。
2. 新增一个 effect，依赖 `photos`：当 `photos.length > 0` 时调
   `mapInstance.setFitView()`。effect 在 React commit（marker 已上地图）
   之后运行，时序正确；`photos` 从空数组变为有值只发生一次（初始加载），
   不会在用户交互后反复触发跳视野。
3. 保留 `Map/index.jsx` 的 hardcode 初始 center/zoom 不动：作为
   convertFrom 失败或 output.json 为空时的兜底首屏（避免首屏闪世界地图），
   不再是常态默认位置。

## 验收标准

1. 打开站点，地图初始视野自动包住全部照片 marker（而非停在北京
   39.871446/116.215768 zoom 16）；
2. CityChips 点击"已选中胶囊回全局视野"行为不受影响；
3. 清空/失败场景（无照片数据）不报错，停留在初始兜底位置；
4. `./node_modules/.bin/eslint src --ext .js,.jsx,.ts,.tsx
   --max-warnings=0` 通过；
5. `CI=true ./node_modules/.bin/react-scripts build` 通过。

## 出界清单（本轮不做）

- 方案 B（默认城市 = cities.js）、方案 C（localStorage 记忆位置）、
  方案 D（管线算质心写 output.json）；
- `Map/index.jsx` 的 hardcode 常量保留不删（仅作兜底）；
- cities.js、output.json、照片管线均不动。
