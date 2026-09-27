# DEVELOP

## Runbook

添加一个新城市：

1. 获取城市 GCJ02 坐标，用高德官方坐标拾取器 https://lbs.amap.com/tools/picker
2. 搜索地点名（如"郑州"），点击地图上的目标点，复制生成的坐标即为 GCJ02
3. 输入 cities.js

## References

- AMAP React API
  - Marker
    - 参考手册 - https://lbs.amap.com/api/javascript-api-v2/documentation#marker
    - API doc - https://uiwjs.github.io/react-amap/#/marker
    - source code - https://github.com/uiwjs/react-amap/blob/268303de813050c7a02bb247930090ce5f162042/src/Marker/index.tsx
