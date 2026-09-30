import MapIcon from '../MapIcon/MapIcon';

// demo 注册表：新增 demo 只需在此加一行，入口（Application/index.jsx）无需改动。
//
// 键 = 查询参数 `?demo=<键>` 的值（入口会先做 trim + toLowerCase，故键用全小写）；
// 值 = demo 组件。
//
// demo 实体目前位于 src/Application/MapIcon/，待整理时迁入本目录
// （见 docs/plans/2026-09-30-demo-registry-query-param.md 阶段二）。
export const demoRegistry = {
  'map-icon': MapIcon,
};
