// 城市跳转书签（CityChips 数据源，手动维护，与照片管线/output.json 零耦合）。
// 坐标必须是 GCJ02（火星坐标系，高德原生坐标系）：
// 用高德官方坐标拾取器获取 https://lbs.amap.com/tools/picker
// 搜索地点名 → 点击地图目标点 → 复制坐标。
// 直接填 GPS/WGS84 坐标会偏移几百米。
// 字段：name（胶囊显示文字）/ lng、lat（GCJ02 落点）/ zoom（落地视野级别，逐城市调）
export const CITIES = [
  // 用坐标拾取器填入真实 GCJ02 坐标
  { name: '北京', lng: 116.407387, lat: 39.904179, zoom: 11 },
  { name: '郑州', lng: 113.658097, lat: 34.745795, zoom: 13 },
  { name: '乌兰察布（集宁）', lng: 113.132227, lat: 40.994526, zoom: 12 },
  { name: '保定市', lng: 115.464523, lat: 38.874476, zoom: 13 },
  { name: '南京市', lng: 118.796624, lat: 32.059344, zoom: 12 },
];

// 回全局视野落点（GCJ02，坐标纪律同上）：再点已选中 chip 时三段式飞往此处。
// 替代 setFitView()——其视野随全部 marker 包围盒漂移且无时长控制。
// 种子值为占位示意，待用户用坐标拾取器确认/调整（zoom 支持小数）。
export const GLOBAL_VIEW = { lng: 108, lat: 36, zoom: 4.5 };
