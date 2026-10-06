/**
 * 底图第四档「海外影像」的逐瓦片判定（纯函数，无副作用，无外部请求）
 *
 * 为什么需要它：高德卫星影像对**海外**只到 z7，z≥8 服务端一律返回同一张 4235 B
 * 的「此区域无卫星图」占位瓦片（2026-10-06 实测，md5 与邻域扫描见
 * docs/plans/2026-10-06-overseas-imagery-manual-mode.md），所以海外点位一放大就是
 * 灰底。本模块挂在自定义 TileLayer 上（见 BaseMapSwitch.jsx），AMap 每要一块瓦片
 * 就调一次 overseasTileUrl(x, y, z)：
 *
 *   境外 → 返回 Esri World Imagery 的瓦片 URL（盖住高德占位图）
 *   境内 → 返回 1×1 透明 GIF（data URI，**浏览器不发起任何对外请求**，露出下层
 *          的 AMap Satellite —— 那才是境内合规底图）
 *
 * 为什么逐瓦片判定、而不是监听 moveend 用视野四角判定：无状态、无事件监听、无档位
 * 互斥；跨境内外的视野天然逐块正确（境内块透明、境外块换源）；判定点只有一个纯
 * 函数，可被 test/overseas-tiles.test.js 完整覆盖。代价是边界瓦片按**瓦片中心**
 * 归属（误差 ≤ 半个瓦片宽，z11 约 0.088°，z17 约 0.0014°），可接受且不随缩放
 * 累计。
 *
 * 境内为什么返回透明、而不是自己再抓一份高德瓦片：① 合规——高德开放平台服务协议
 * 禁止抓取/缓存高德数据图片；② 技术上没必要——下层的 AMap Satellite 本来就在显示。
 *
 * ⚠️ 模块形态：**CommonJS**。这是唯一同时满足两边的形态——webpack 可 import
 * （CRA 的 ModuleScopePlugin 禁止 src 之外的相对 import）且 node --test 可 require
 * （test/ 下是 CJS，而 src 里的 ESM 文件 node 无法 require）。勿"顺手统一成 ESM"，
 * 与 test/video-support.test.js 锁三处 DERIVED_SUFFIXES 是同一约束下的同类选择。
 */

/**
 * 境内界值。与 fix-gps.js 的 outOfChina() **同值**（那边用于判断 EXIF 坐标要不要
 * 做 GCJ02 偏移）。两处阈值必须一致：漂移会让境内边界瓦片静默违规或与底图错位。
 * 一致性由 test/overseas-tiles.test.js 用边界探针锁死——不抽共享模块，因为
 * fix-gps.js 是可独立运行的 CLI，不依赖 src/。
 */
const OUT_OF_CHINA_BOUNDS = {
  lngMin: 72.004,
  lngMax: 137.8347,
  latMin: 0.8293,
  latMax: 55.8271,
};

/**
 * 影像源：Esri World Imagery。免 key；条款为非创收应用 + <100 万瓦片/月，需署名
 * （署名由 BaseMapSwitch 的 .attribution 承担）。
 *
 * ⚠️ 参数顺序是 `{z}/{y}/{x}`，与 OSM 的 `{z}/{x}/{y}` **相反**——写反不会报错，
 * 只会静默拿到别处的影像，所以测试用「URL 尾部数字必须等于 (z, y, x)」锁顺序。
 *
 * 2026-10-06 用户浏览器与 agent 两侧均实测可达；**写死单域名，不做运行时探测、
 * 不做主备切换**（S3：外部命令/外部服务假设可用，缺失即显式失败；用户明确拒绝
 * 兜底语义）。源失效时改这一个常量即可。
 */
const ESRI_TILE_URL_TEMPLATE =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

/**
 * 该源在雅加达的最高原生级别（z19 实测有影像）。更高的级别请求按 z19 取图、由
 * 浏览器拉伸——与 Leaflet 的 `maxNativeZoom` 同义：宁可是"放大后的影像"，也不要
 * 在高德已经无影像的级别上退回灰色占位图（那正是本功能要修的症状）。
 */
const ESRI_MAX_NATIVE_ZOOM = 19;

/**
 * 1×1 全透明 GIF。境内瓦片返回它：不产生对外请求，等效于"这一层不画"。
 * （用 data URI 而不是外部占位图 URL，就是为了确保境内零对外请求。）
 */
const TRANSPARENT_TILE =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * Web Mercator 瓦片编号 → 瓦片中心经纬度。
 *
 * 编号方案是标准 XYZ（与高德 getTileUrl 传入的 x/y 同一套：x 自西向东、y 自北向
 * 南，左上角为原点）。**不是** TMS（y 自南向北）—— 官方示例
 * jsapi-v2/example/thirdlayer/custom-grid-map 直接用 (x, y, z) 拼 XYZ 瓦片地址，
 * 可证不翻转。
 *
 * @param {number} x 瓦片横向编号
 * @param {number} y 瓦片纵向编号
 * @param {number} z 缩放级别
 * @returns {{lat: number, lng: number}} 瓦片中心点（度）
 */
function tileToLngLat(x, y, z) {
  const n = Math.pow(2, z);
  const lng = ((x + 0.5) / n) * 360 - 180;
  const lat =
    (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n)));
  return { lat, lng };
}

/**
 * 与 fix-gps.js 的 outOfChina() 同口径：落在边界上**不算**境外（严格大于/小于）。
 * @param {number} lat 纬度
 * @param {number} lng 经度
 */
function isOutOfChina(lat, lng) {
  return (
    lng < OUT_OF_CHINA_BOUNDS.lngMin ||
    lng > OUT_OF_CHINA_BOUNDS.lngMax ||
    lat < OUT_OF_CHINA_BOUNDS.latMin ||
    lat > OUT_OF_CHINA_BOUNDS.latMax
  );
}

/**
 * AMap.TileLayer 的 getTileUrl 实现（官方 2.0 支持 `Function(x, y, z)`，见
 * @amap/amap-jsapi-types 里 AMap.TileLayerOptions 的 JSDoc）。
 *
 * @param {number} x 瓦片横向编号
 * @param {number} y 瓦片纵向编号
 * @param {number} z 缩放级别
 * @returns {string} 瓦片图 URL（境外为 Esri 影像，境内为透明 GIF data URI）
 */
function overseasTileUrl(x, y, z) {
  const center = tileToLngLat(x, y, z);
  if (!isOutOfChina(center.lat, center.lng)) {
    return TRANSPARENT_TILE;
  }
  // 超过源的原生级别就取 z19 的对应瓦片：z19 的一块正好覆盖 z>19 时的 2^shift
  // 块，整除即可保对齐（浏览器把一块拉满该格，观感等同继续放大）。
  const zoom = Math.min(z, ESRI_MAX_NATIVE_ZOOM);
  const scale = Math.pow(2, z - zoom);
  const tileX = Math.floor(x / scale);
  const tileY = Math.floor(y / scale);
  return ESRI_TILE_URL_TEMPLATE.replace('{z}', zoom)
    .replace('{y}', tileY)
    .replace('{x}', tileX);
}

module.exports = {
  OUT_OF_CHINA_BOUNDS,
  ESRI_TILE_URL_TEMPLATE,
  ESRI_MAX_NATIVE_ZOOM,
  TRANSPARENT_TILE,
  tileToLngLat,
  isOutOfChina,
  overseasTileUrl,
};
