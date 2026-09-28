# 兜底首屏视野改全国级，消除刷新时"北京→全国"硬切（方案 1）

状态：已实现（2026-09-28；eslint --max-warnings=0 通过；CI build 门禁
待用户终端执行——agent 环境限制见 docs/toolchain.md；待用户 npm start
验收刷新视野）
日期：2026-09-28

## 背景（自包含，零上下文可读）

- 上一轮（docs/plans/2026-09-28-map-initial-fitview.md）修复了初始视野
  时序：photos 就绪后 `setFitView()` 自动包住全部 marker，功能正确。
- 副产物可感知：地图先用 hardcode 兜底视野（北京 zoom 16，街景级）首屏，
  数据到达后再 fitView 到全国级——每次刷新都可见"北京街景 → 全国"的
  硬切跳跃，约 1 秒。
- 用户选定方案 1：把兜底首屏视野调成全国级，数据到达后 fitView 只需
  微调，跳跃基本不可见。

## 方案

仅改 `src/Application/Map/index.jsx`：

1. `defaultZoom={16}` 改为 `4`（AMap zoom 4 ≈ 全国视野）。
2. `amapCenter` 坐标不动（zoom 4 下中心点在哪都能看到全国，fitView
   随后接管），补充注释说明其"兜底首屏"角色与跳转链路，防止后人
   误以为是常态默认位置。
3. 提取 `defaultZoom` 为具名常量并加注释（与 `amapCenter` 并列）。

## 验收标准

1. 刷新页面：首屏直接是全国级视野，数据到达后仅轻微微调、无
   "街景级→全国级"的硬切；
2. CityChips 点击城市/回全局视野行为不受影响；
3. `./node_modules/.bin/eslint src --ext .js,.jsx,.ts,.tsx
   --max-warnings=0` 通过；
4. `CI=true ./node_modules/.bin/react-scripts build` 由用户终端执行通过
   （agent 环境 broker 限制，见 docs/toolchain.md）。

## 出界清单（本轮不做）

- 方案 2（数据就绪前 loading 遮罩）；
- localStorage 记忆上次视野（原方案 C）；
- `amapCenter` 坐标数值本身不动。
