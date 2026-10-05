/**
 * fix-gps 坐标转换单测（WGS84 → GCJ02）
 *
 * 为什么必须测：审阅页第 5 区把锚点画到高德卫星底图上，底图是 GCJ02、EXIF 存的是
 * WGS84。转换写错**不会报任何错**——只是点位静默偏几百米，而且只有一两处位置、
 * 周边没有参照物时肉眼几乎发现不了。这是本功能唯一"算错也不响"的环节，必须有
 * 控制点兜着。
 *
 * 期望值来源：**高德官方 AMap.convertFrom 实测**（2026-10-05 用同一个 key 在
 * file:// 页面跑通后取回），不是从网上抄的常数——测试要锁的是"与高德底图一致"
 * 这个真实需求，不是"与某篇博客一致"。东京点则是官方对境外坐标原样返回，
 * 印证 wgs84ToGcj02 的境外直通不是自造的兜底。
 *
 * 运行：npm run test:cli（node 内置 runner，与 CRA 的 jest 分离，见 AGENTS.md 流程 #1）
 * 计划：docs/plans/2026-10-05-fix-gps-review-amap-embed.md
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { wgs84ToGcj02 } = require('../fix-gps');

/** 官方 convertFrom 对照值：wgs/gcj 均为 [经度, 纬度]，与页面调用顺序一致 */
const OFFICIAL_POINTS = [
  { name: '南京南站', wgs: [118.796, 31.9694], gcj: [118.801177, 31.967346] },
  { name: '北京大兴机场', wgs: [116.4105, 39.5098], gcj: [116.416691, 39.511141] },
];

// 容差 1e-5 度 ≈ 1.1 m：官方值是 6 位小数（量化过）的，要求更严没有意义；
// 而"忘了转换"的偏差是数百米（≈5e-3 度），两者相差三个数量级，判据很安全
const TOLERANCE_DEG = 1e-5;

test('境内控制点：与高德官方 convertFrom 一致（≤1 m）', () => {
  for (const p of OFFICIAL_POINTS) {
    const got = wgs84ToGcj02(p.wgs[1], p.wgs[0]);
    assert.ok(
      Math.abs(got.lng - p.gcj[0]) < TOLERANCE_DEG,
      `${p.name} 经度偏差过大：算出 ${got.lng}，官方 ${p.gcj[0]}`,
    );
    assert.ok(
      Math.abs(got.lat - p.gcj[1]) < TOLERANCE_DEG,
      `${p.name} 纬度偏差过大：算出 ${got.lat}，官方 ${p.gcj[1]}`,
    );
  }
});

test('境外坐标：原样直通（与官方一致，且不得凭空加偏移）', () => {
  const tokyo = wgs84ToGcj02(35.6812, 139.7671);
  assert.equal(tokyo.lat, 35.6812);
  assert.equal(tokyo.lng, 139.7671);
});

test('境内偏移量级：数百米（捕获"忘了转换"这类灾难性错误）', () => {
  const wgsLat = 31.9694;
  const wgsLng = 118.796;
  const gcj = wgs84ToGcj02(wgsLat, wgsLng);
  const dy = (gcj.lat - wgsLat) * 111320;
  const dx = (gcj.lng - wgsLng) * 111320 * Math.cos((wgsLat * Math.PI) / 180);
  const meters = Math.hypot(dx, dy);
  assert.ok(
    meters > 400 && meters < 700,
    `南京一带 GCJ02 偏移应在 400~700 m，实测 ${meters.toFixed(1)} m` +
      '（接近 0 说明根本没转换）',
  );
});
