/**
 * fix-gps 合并逻辑纯函数单测
 *
 * 只测两个纯函数：mergeAnchors()（同位置锚点合并 / 并查集聚类）与
 * haversineMeters()（球面距离）。二者不碰文件系统、不读 EXIF、不渲染 HTML，
 * 因此这里**全部用内存里的合成锚点**——距离直接用纬度偏移构造，不需要任何照片。
 *
 * 运行：npm run test:cli（node 内置 runner；与 CRA 的 jest 分离，见 AGENTS.md 流程 #1）
 * 计划：docs/plans/2026-10-04-fix-gps-merge-unit-test.md
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  mergeAnchors,
  haversineMeters,
  ANCHOR_MERGE_METERS,
} = require('../fix-gps');

const EARTH_RADIUS_M = 6371000;
const BASE_LAT = 32;
const BASE_LNG = 118.8;

/**
 * 米 → 纬度度数。纯南北方向的球面距离是 2R·asin(sin(Δφ/2))，取 Δφ = m/R 时
 * 结果就是 m（偏差 ~1e-20，远低于浮点噪声），因此构造出的两锚点间距即所需米数。
 */
const metersToLat = (m) => ((m / EARTH_RADIUS_M) * 180) / Math.PI;

/** 合成锚点：只填 mergeAnchors 实际读取的字段（lat / lng / ts / file） */
function anchor(file, offsetMeters, ts) {
  return { file, lat: BASE_LAT + metersToLat(offsetMeters), lng: BASE_LNG, ts };
}

test('单锚点 → 1 组，members 只含自己', () => {
  const groups = mergeAnchors([anchor('a.jpg', 0, '2026-10-04T14:29:00')]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].members, ['a.jpg']);
});

test('相距 4 m 的两锚点 → 合并为 1 组', () => {
  const groups = mergeAnchors([
    anchor('a.jpg', 0, '2026-10-04T14:29:00'),
    anchor('b.jpg', 4, '2026-10-04T14:34:00'),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].members, ['a.jpg', 'b.jpg']);
});

test('相距 6 m 的两锚点 → 保持 2 组', () => {
  const groups = mergeAnchors([
    anchor('a.jpg', 0, '2026-10-04T14:29:00'),
    anchor('b.jpg', 6, '2026-10-04T14:34:00'),
  ]);
  assert.equal(groups.length, 2);
});

test('判据是严格小于 5 m：4.9 m 合、5.1 m 不合', () => {
  // 已知盲区（变异测试实测，M4：把 mergeAnchors 里的 `<` 改成 `<=` 抓不到）：
  // 恰好 5.000 m 这个点没有自动断言。原因是构造 Δφ = 5/R 后要经 sin→asin 往返，
  // 结果在 5.000000… 上带浮点噪声，钉不死"小于 vs 小于等于"。实测无实际后果
  // （真实 GPS 漂移下恰好 5.000000 m 的巧合不存在），故不为此扭曲构造。
  // 恰好 5.00 m 不合并的语义由前置 plan 的人工实测记录（见其「实现后修订」第 1 条）。
  const merged = mergeAnchors([
    anchor('a.jpg', 0, '2026-10-04T14:29:00'),
    anchor('b.jpg', 4.9, '2026-10-04T14:34:00'),
  ]);
  assert.equal(merged.length, 1, '4.9 m 应合并');

  const split = mergeAnchors([
    anchor('a.jpg', 0, '2026-10-04T14:29:00'),
    anchor('b.jpg', 5.1, '2026-10-04T14:34:00'),
  ]);
  assert.equal(split.length, 2, '5.1 m 不应合并');
});

test('链式邻近会连锁合并：A-B 4 m、B-C 4 m（A-C 8 m）→ 三张同组', () => {
  const groups = mergeAnchors([
    anchor('a.jpg', 0, '2026-10-04T14:29:00'),
    anchor('b.jpg', 4, '2026-10-04T14:30:00'),
    anchor('c.jpg', 8, '2026-10-04T14:31:00'),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].members, ['a.jpg', 'b.jpg', 'c.jpg']);
});

test('组代表 = 组内拍摄最早者，且坐标取它自己的（不取平均）', () => {
  const early = anchor('early.jpg', 0, '2026-10-04T14:29:00');
  const late = anchor('late.jpg', 4, '2026-10-04T14:34:00');
  // 故意把较早者放在数组后面，验证选取依据是 ts 而非输入顺序
  const [group] = mergeAnchors([late, early]);

  assert.equal(group.file, 'early.jpg');
  assert.equal(group.lat, early.lat, '坐标必须是代表的原始值');
  assert.notEqual(group.lat, (early.lat + late.lat) / 2, '不得取平均');
});

test('缺失拍摄时间（ts = "9999"）的锚点不抢代表位', () => {
  const unknown = anchor('unknown.jpg', 0, '9999');
  const known = anchor('known.jpg', 4, '2026-10-04T14:34:00');
  const [group] = mergeAnchors([unknown, known]);

  assert.equal(group.file, 'known.jpg');
  assert.equal(group.lat, known.lat);
});

test('空数组 → 空结果', () => {
  assert.deepEqual(mergeAnchors([]), []);
});

test('haversineMeters：同点为 0，1° 纬度 ≈ 111195 m', () => {
  const p = { lat: BASE_LAT, lng: BASE_LNG };
  assert.equal(haversineMeters(p, { ...p }), 0);

  // 球面（R = 6371000）上 1° 纬度 = R·π/180 ≈ 111194.93 m，与构造方式无关的独立基准
  const oneDegree = haversineMeters(p, { lat: BASE_LAT + 1, lng: BASE_LNG });
  assert.ok(
    Math.abs(oneDegree - 111194.93) < 1,
    `1° 纬度应约 111195 m，实际 ${oneDegree}`,
  );
});

test('跨文件契约：process-photos.js 的 ANCHOR_MERGE_METERS 必须同值', () => {
  // 该常量在两个独立 CLI 里各存一份（刻意不抽共享模块）；口径不一致会让
  // photos 预检的"落在几处"与审阅页的分组互相矛盾，故用测试锁住这条契约。
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'process-photos.js'),
    'utf8',
  );
  const matched = src.match(/const\s+ANCHOR_MERGE_METERS\s*=\s*([\d.]+)/);
  assert.ok(matched, 'process-photos.js 里应能定位到 ANCHOR_MERGE_METERS 声明');
  assert.equal(
    Number(matched[1]),
    ANCHOR_MERGE_METERS,
    'process-photos.js 与 fix-gps.js 的合并阈值必须一致',
  );
});
