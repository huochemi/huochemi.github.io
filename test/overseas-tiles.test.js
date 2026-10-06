/**
 * 海外影像瓦片（底图第四档）纯函数单测 + 跨文件契约锁定
 *
 * 计划：docs/plans/2026-10-06-overseas-imagery-manual-mode.md
 * 运行：npm run test:cli（node 内置 runner；与 CRA 的 jest 分离，见 AGENTS.md 流程 #1）
 *
 * 为什么必须测：overseasTileUrl 有两条"算错也不响"的失败模式——
 * ① 参数顺序写反（Esri 是 {z}/{y}/{x}，OSM 是 {z}/{x}/{y}）→ 不报错，只是拿到
 *    地球另一处的影像；
 * ② 境内判定阈值与 fix-gps.js 漂移 → 境内边界瓦片会静默去抓外部影像（合规红线）。
 * 两者都不会抛异常，只能靠断言兜住。
 *
 * 点位坐标（瓦片编号）由标准 Web Mercator 公式算出，未手写猜测值。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OUT_OF_CHINA_BOUNDS,
  ESRI_TILE_URL_TEMPLATE,
  ESRI_MAX_NATIVE_ZOOM,
  TRANSPARENT_TILE,
  tileToLngLat,
  isOutOfChina,
  overseasTileUrl,
} = require('../src/Application/Map/AMap/overseasTiles.js');
const { outOfChina } = require('../fix-gps');

/** Esri URL 的前缀（模板里第一个占位符之前的部分），用于判断影像源 */
const ESRI_URL_PREFIX = ESRI_TILE_URL_TEMPLATE.split('{')[0];

/** 雅加达 苏加诺-哈达机场（与 src/Application/cities.js 的雅加达点位同源，WGS84） */
const JAKARTA = { lat: -6.118417, lng: 106.664689 };

/** 瓦片编号用标准 XYZ 公式独立算出的固定值（非从被测代码反推） */
const OVERSEAS_CASES = [
  { point: JAKARTA, x: 1630, y: 1058, z: 11 },
  { point: JAKARTA, x: 6523, y: 4235, z: 13 },
  { point: JAKARTA, x: 104371, y: 67767, z: 17 },
];

const CHINA_CASES = [
  { name: '北京', x: 843, y: 388, z: 10 },
  { name: '广州', x: 834, y: 444, z: 10 },
  { name: '乌兰察布', x: 3335, y: 1535, z: 12 },
];

// ---------------------------------------------------------------------------
// 断言 A：境外瓦片 → Esri 影像 URL，且参数顺序必须是 {z}/{y}/{x}
// ---------------------------------------------------------------------------

test('断言 A：境外瓦片返回所选影像源的 URL，且 z/y/x 顺序正确', () => {
  for (const c of OVERSEAS_CASES) {
    const url = overseasTileUrl(c.x, c.y, c.z);
    assert.ok(
      url.startsWith(ESRI_URL_PREFIX),
      `境外瓦片应返回影像源 URL，实际 ${url}`,
    );
    // 尾部三元组锁顺序：写反成 {z}/{x}/{y} 时数字对不上（三个用例的 x≠y）
    assert.ok(
      url.endsWith(`/${c.z}/${c.y}/${c.x}`),
      `瓦片 URL 尾部应为 /z/y/x = /${c.z}/${c.y}/${c.x}，实际 ${url}`,
    );
  }
});

test('断言 A2：影像源域名锁定为 2026-10-06 定稿的 server 域', () => {
  // 定稿依据：用户浏览器与 agent 两侧均实测可达（见 plan「验证结果汇总」）。
  // 这条断言的作用是"改源必须是一次显式的、被看见的改动"。
  assert.equal(
    ESRI_URL_PREFIX,
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/',
  );
});

// ---------------------------------------------------------------------------
// 断言 B：境内瓦片 → 透明 data URI（零对外请求），且绝不指向任何地图厂商瓦片
// ---------------------------------------------------------------------------

test('断言 B：境内瓦片返回 1×1 透明 GIF，不含任何外链', () => {
  for (const c of CHINA_CASES) {
    assert.equal(
      overseasTileUrl(c.x, c.y, c.z),
      TRANSPARENT_TILE,
      `${c.name} z${c.z} 应透明露出下层高德卫星`,
    );
  }
  assert.ok(
    TRANSPARENT_TILE.startsWith('data:image/gif;base64,'),
    '透明瓦片必须是 data URI——外部占位图 URL 会产生境内对外请求',
  );
});

test('断言 B2：全域扫描——返回值只可能是透明瓦片或影像源 URL，绝无高德瓦片', () => {
  // 合规红线：高德开放平台服务协议禁止抓取/缓存高德数据图片，本层任何情况下
  // 都不许返回高德瓦片地址（下层 AMap Satellite 自带，无需我们再抓）。
  let overseas = 0;
  let domestic = 0;
  for (let z = 8; z <= 12; z += 1) {
    // 每级取 12×12 抽样，覆盖 x 从 0 到该级最大值附近
    const max = Math.pow(2, z) - 1;
    for (let i = 0; i < 12; i += 1) {
      for (let j = 0; j < 12; j += 1) {
        const x = Math.round((max * i) / 11);
        const y = Math.round((max * j) / 11);
        const url = overseasTileUrl(x, y, z);
        assert.ok(
          url === TRANSPARENT_TILE || url.startsWith(ESRI_URL_PREFIX),
          `z${z} (${x},${y}) 返回了非预期地址：${url}`,
        );
        assert.ok(
          !/autonavi|amap\.com/i.test(url),
          `z${z} (${x},${y}) 返回了高德瓦片地址（违反服务协议）：${url}`,
        );
        if (url === TRANSPARENT_TILE) domestic += 1;
        else overseas += 1;
      }
    }
  }
  // 抽样里必须两类都存在，否则说明判定函数退化成常量（断言形同虚设）
  assert.ok(domestic > 0, '抽样中应有境内瓦片');
  assert.ok(overseas > 0, '抽样中应有境外瓦片');
});

// ---------------------------------------------------------------------------
// 断言 C：与 fix-gps.js 的 outOfChina 边界逐项一致（值 + 不等号方向）
//
// 两处各存一份同值常量（fix-gps.js 是独立 CLI，不依赖 src/），漂移的后果是境内
// 边界瓦片静默换成外部影像——违规；或境外瓦片误判为境内——海外点位继续灰底。
// 探针以本模块的界值为基准取"界上"与"界外 1e-6"两档，同时锁住数值与方向。
// ---------------------------------------------------------------------------

const B = OUT_OF_CHINA_BOUNDS;
const BOUNDARY_PROBES = [
  { label: '西界（lngMin）上', lat: 30, lng: B.lngMin, expected: false },
  { label: '西界外', lat: 30, lng: B.lngMin - 1e-6, expected: true },
  { label: '东界（lngMax）上', lat: 30, lng: B.lngMax, expected: false },
  { label: '东界外', lat: 30, lng: B.lngMax + 1e-6, expected: true },
  { label: '南界（latMin）上', lat: B.latMin, lng: 100, expected: false },
  { label: '南界外', lat: B.latMin - 1e-6, lng: 100, expected: true },
  { label: '北界（latMax）上', lat: B.latMax, lng: 100, expected: false },
  { label: '北界外', lat: B.latMax + 1e-6, lng: 100, expected: true },
];

test('断言 C：本模块的境内判定与 fix-gps.js 的 outOfChina 逐项一致', () => {
  for (const p of BOUNDARY_PROBES) {
    assert.equal(
      isOutOfChina(p.lat, p.lng),
      p.expected,
      `overseasTiles 在${p.label}的判定不符（阈值或不等号方向漂了）`,
    );
    assert.equal(
      outOfChina(p.lat, p.lng),
      p.expected,
      `fix-gps 在${p.label}的判定不符——两处口径已漂移`,
    );
  }
});

// ---------------------------------------------------------------------------
// 断言 D：瓦片反算控制点——算错同样不响，只会整片错位
// ---------------------------------------------------------------------------

test('断言 D：tileToLngLat 反算的瓦片中心落在该点位半个瓦片宽内', () => {
  for (const c of OVERSEAS_CASES) {
    const { lat, lng } = tileToLngLat(c.x, c.y, c.z);
    const halfTile = 360 / Math.pow(2, c.z) / 2;
    assert.ok(
      Math.abs(lng - c.point.lng) <= halfTile,
      `z${c.z} 经度反算偏差过大：得到 ${lng}，期望近 ${c.point.lng}`,
    );
    assert.ok(
      Math.abs(lat - c.point.lat) <= halfTile,
      `z${c.z} 纬度反算偏差过大：得到 ${lat}，期望近 ${c.point.lat}`,
    );
    // 自洽性：反算出的中心点若回代，判定的境内/境外结果必须与瓦片本身的判定一致
    assert.notEqual(
      overseasTileUrl(c.x, c.y, c.z),
      TRANSPARENT_TILE,
      `z${c.z} (${c.x},${c.y}) 的中心点回代后应判为境外`,
    );
  }
});

// ---------------------------------------------------------------------------
// 断言 E：超过源原生级别时按最高原生级别取图（对齐，不退回灰色占位图）
// ---------------------------------------------------------------------------

test('断言 E：z 超过原生上限时按 z19 取图，且 x/y 等比对齐', () => {
  // 雅加达 z20 的瓦片编号（标准公式算出）
  const x = 834971;
  const y = 542143;
  const url = overseasTileUrl(x, y, 20);
  assert.ok(url.startsWith(ESRI_URL_PREFIX), `z20 仍应使用影像源，实际 ${url}`);
  const parts = url.slice(ESRI_URL_PREFIX.length).split('/');
  assert.deepEqual(
    parts.map(Number),
    [ESRI_MAX_NATIVE_ZOOM, Math.floor(y / 2), Math.floor(x / 2)],
    `z20 应折算为 z19 的 (x/2, y/2)，实际 ${url}`,
  );
  // 未超限时不得折算
  const normal = overseasTileUrl(6523, 4235, 13);
  assert.ok(
    normal.endsWith('/13/4235/6523'),
    `未超限时不应折算，实际 ${normal}`,
  );
});
