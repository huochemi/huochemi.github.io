/**
 * GPX 轨迹通道的纯函数单测：解析 / 插值 / 时区判定 / 疑似时区差
 *
 * 为什么必须测：这条通道"算错不报错"——插值偏一小时能把坐标写到 1.5 km 之外，
 * 而工具照样打印 ✅ 已写入并验证（验证只兜"根本没写进去"，不做精度判定）。
 * 它又是唯一引入**时区换算**的地方：EXIF 是"当地墙上时间"、GPX 是 UTC 瞬时，
 * 换算错一次整批坐标全废。首版实现就栽在这（轨点被多加 8 小时 ⇒ 全部照片看起来
 * 落在窗外），故这里用逐例断言把换算与边界钉死。
 *
 * 全部用**内存里构造的 GPX 文本**：不读原图仓（AGENTS.md S1：原片不可再生）、
 * 不依赖 exiftool/key 等外部命令，任何环境都能跑。
 *
 * 运行：npm run test:cli（node 内置 runner；与 CRA 的 jest 分离，见 AGENTS.md 流程 #1）
 * 计划：docs/plans/2026-10-07-gpx-coordinate-channel.md
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseGpxTrack,
  interpolateTrack,
  calibrateTimezone,
  wallTimeToEpoch,
  suggestTzOffset,
} = require('../fix-gps');

/** 构造一条 trkpt：时间用"UTC 基准 + 秒偏移"给出，避免手写时间串出错 */
const trkpt = (lat, lon, secOffset, ele) =>
  `<trkpt lat="${lat}" lon="${lon}">` +
  (ele === undefined ? '' : `<ele>${ele}</ele>`) +
  `<time>${new Date(Date.UTC(2026, 9, 6, 10, 0, 0) + secOffset * 1000).toISOString().replace('.000', '')}</time>` +
  '</trkpt>';

/** 把若干段包成一份 GPX 文本 */
const gpxText = (segments) =>
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<gpx version="1.1" creator="test">\n<trk><name>t</name>\n' +
  segments.map((pts) => `<trkseg>\n${pts.join('\n')}\n</trkseg>`).join('\n') +
  '\n</trk></gpx>';

const UTC0 = Date.UTC(2026, 9, 6, 10, 0, 0);

describe('parseGpxTrack：结构解析', () => {
  test('单段轨迹：点数、坐标、高程、时间戳解析正确', () => {
    const track = parseGpxTrack(
      gpxText([[trkpt(38.008411, 114.478408, 0, 78.5), trkpt(38.0085, 114.4786, 1, 79.1)]]),
    );
    assert.equal(track.segCount, 1);
    assert.equal(track.reordered, false);
    assert.equal(track.points.length, 2);
    assert.equal(track.points[0].t, UTC0);
    assert.equal(track.points[0].lat, 38.008411);
    assert.equal(track.points[0].lng, 114.478408);
    assert.equal(track.points[0].ele, 78.5);
    assert.equal(track.points[1].t, UTC0 + 1000);
  });

  test('缺 <ele> 的点：ele 为 null（不编造高程）', () => {
    const track = parseGpxTrack(gpxText([[trkpt(38.0, 114.0, 0), trkpt(38.0001, 114.0001, 1)]]));
    assert.equal(track.points[0].ele, null);
  });

  test('多 trkseg：按时间序拼接为一条（文档顺序非时间序时重排并标出）', () => {
    // 第二段的时间早于第一段：手表把一段步行切成了两段且顺序倒了
    const track = parseGpxTrack(
      gpxText([
        [trkpt(38.01, 114.01, 10), trkpt(38.02, 114.02, 11)],
        [trkpt(38.0, 114.0, 0), trkpt(38.005, 114.005, 1)],
      ]),
    );
    assert.equal(track.segCount, 2);
    assert.equal(track.reordered, true, '文档顺序非时间序应被标出');
    assert.equal(track.points.length, 4);
    assert.deepEqual(
      track.points.map((p) => p.t),
      [UTC0, UTC0 + 1000, UTC0 + 10000, UTC0 + 11000],
      '拼接后必须是时间升序',
    );
  });

  test('单引号属性也认（Apple/其它导出器写法差异）', () => {
    const text =
      "<gpx><trk><trkseg><trkpt lat='38.1' lon='114.1'><time>2026-10-06T10:00:00Z</time></trkpt>" +
      "<trkpt lat='38.2' lon='114.2'><time>2026-10-06T10:00:01Z</time></trkpt></trkseg></trk></gpx>";
    const track = parseGpxTrack(text);
    assert.equal(track.points.length, 2);
    assert.equal(track.points[1].lat, 38.2);
  });

  test('缺 lat / lon / time 即抛错（不静默跳过坏点）', () => {
    const bad = '<gpx><trk><trkseg><trkpt lat="1" lon="2"></trkpt></trkseg></trk></gpx>';
    assert.throws(() => parseGpxTrack(bad), /缺 lat \/ lon \/ time/);
  });

  test('点数不足 2 即抛错', () => {
    assert.throws(
      () => parseGpxTrack(gpxText([[trkpt(38.0, 114.0, 0)]])),
      /轨迹点不足/,
    );
  });
});

describe('wallTimeToEpoch：EXIF 墙上时间 ↔ 轨迹 UTC 瞬时', () => {
  test('UTC+8：墙上 18:00 对应 UTC 10:00（不是 18:00 —— 首版就栽在这里）', () => {
    assert.equal(
      wallTimeToEpoch('2026-10-06T18:00:00', 8),
      Date.parse('2026-10-06T10:00:00Z'),
    );
    assert.equal(
      wallTimeToEpoch('2026-10-06T18:00:00', 0),
      Date.parse('2026-10-06T18:00:00Z'),
      'UTC 偏移为 0 时墙上时间就是 UTC 时间',
    );
  });

  test('半小时时区（+5:30）与负偏移都正确', () => {
    assert.equal(
      wallTimeToEpoch('2026-10-06T18:00:00', 5.5),
      Date.parse('2026-10-06T12:30:00Z'),
    );
    assert.equal(
      wallTimeToEpoch('2026-10-06T18:00:00', -3),
      Date.parse('2026-10-06T21:00:00Z'),
    );
  });

  test('时间串不可解析 → null', () => {
    assert.equal(wallTimeToEpoch('不是时间', 8), null);
  });
});

describe('interpolateTrack：按时刻插值', () => {
  const track = parseGpxTrack(
    gpxText([
      [trkpt(38.0, 114.0, 0, 10), trkpt(38.002, 114.004, 4, 14)],
      [trkpt(38.004, 114.008, 8, 18)],
    ]),
  ).points;

  test('区间中点：线性插值（坐标与高程都取中值）', () => {
    const mid = interpolateTrack(track, UTC0 + 2000);
    assert.ok(Math.abs(mid.lat - 38.001) < 1e-9);
    assert.ok(Math.abs(mid.lng - 114.002) < 1e-9);
    assert.ok(Math.abs(mid.ele - 12) < 1e-9);
  });

  test('跨段插值：段边界处连续（两段被当作一条轨迹）', () => {
    const mid = interpolateTrack(track, UTC0 + 6000);
    assert.ok(Math.abs(mid.lat - 38.003) < 1e-9);
  });

  test('边界：恰好等于首点/末点时刻都能取到（含端点是"覆盖"的定义）', () => {
    assert.equal(interpolateTrack(track, UTC0).lat, 38.0);
    assert.equal(interpolateTrack(track, UTC0 + 8000).lat, 38.004);
  });

  test('窗口之外 → null（早 1 ms、晚 1 ms 都算外）', () => {
    assert.equal(interpolateTrack(track, UTC0 - 1), null);
    assert.equal(interpolateTrack(track, UTC0 + 8001), null);
  });

  test('同秒重复点不产生 NaN（间隔 0 时取前一点）', () => {
    const dup = parseGpxTrack(
      gpxText([[trkpt(38.0, 114.0, 5), trkpt(38.9, 114.9, 5)]]),
    ).points;
    const got = interpolateTrack(dup, UTC0 + 5000);
    assert.equal(got.lat, 38.0);
    assert.equal(got.lng, 114.0);
  });

  test('一端缺高程：高程为 null，但坐标照常插值', () => {
    const mixed = parseGpxTrack(
      gpxText([[trkpt(38.0, 114.0, 0, 10), trkpt(38.002, 114.002, 2)]]),
    ).points;
    const got = interpolateTrack(mixed, UTC0 + 1000);
    assert.equal(got.ele, null);
    assert.ok(Math.abs(got.lat - 38.001) < 1e-9);
  });
});

describe('calibrateTimezone：整数小时枚举', () => {
  // 轨迹覆盖 UTC 10:00:00 → 10:00:10（即当地时间 UTC+8 的 18:00:00 → 18:00:10）
  const track = parseGpxTrack(
    gpxText([[trkpt(38.0, 114.0, 0), trkpt(38.001, 114.001, 6), trkpt(38.002, 114.002, 10)]]),
  ).points;

  test('真实时区 +8：墙上 18:00:03 的照片能落进窗内并被选中', () => {
    const calibrators = [{ time: '2026-10-06T18:00:03', lat: 38.0005, lng: 114.0005 }];
    const best = calibrateTimezone(calibrators, track);
    assert.equal(best.offsetHours, 8);
    assert.equal(best.inside, 1);
    assert.ok(best.avgResidual < 1, `残差应接近 0，实际 ${best.avgResidual}`);
  });

  test('墙上时间即 UTC（偏移 0）的照片 → 判定为 0', () => {
    const calibrators = [{ time: '2026-10-06T10:00:03', lat: 38.0005, lng: 114.0005 }];
    assert.equal(calibrateTimezone(calibrators, track).offsetHours, 0);
  });

  test('窗口只有 10 秒 ⇒ 判据极强：错一小时会让全部照片落到窗外', () => {
    // 18:00:03 在 +8 下落入；若按 +7 解释则是 11:00:03，落窗外
    const calibrators = [{ time: '2026-10-06T18:00:03', lat: 38.0005, lng: 114.0005 }];
    const withSeven = calibrateTimezone(calibrators, track);
    assert.equal(withSeven.offsetHours, 8, '应选中唯一能落进窗内的 +8');

    // 反证：把时间挪成 +9 才覆盖不上的时刻，判定就必须变
    const shifted = [{ time: '2026-10-06T19:00:03', lat: 38.0005, lng: 114.0005 }];
    assert.equal(calibrateTimezone(shifted, track).offsetHours, 9);
  });

  test('没有任何偏移能落入 → inside = 0（调用方据此报错退出）', () => {
    // 时间取 :30:03 —— 无论如何平移整数小时都落在 :30:03，永远进不了这条 10 秒的窗口
    // （若用 :00:03 就会被某个整数小时偏移"恰好"救回，测不出 inside = 0 这条分支）
    const calibrators = [{ time: '2026-10-06T03:30:03', lat: 38.0, lng: 114.0 }];
    const best = calibrateTimezone(calibrators, track);
    assert.equal(best.inside, 0);
    assert.equal(best.avgResidual, Number.POSITIVE_INFINITY);
  });

  test('多张并列时取残差最小者（同 inside 数下再比残差）', () => {
    // 两张都落窗内（不同偏移各能覆盖一张时，比赛残差）
    const calibrators = [
      { time: '2026-10-06T18:00:02', lat: 38.0003, lng: 114.0003 },
      { time: '2026-10-06T18:00:08', lat: 38.0016, lng: 114.0016 },
    ];
    const best = calibrateTimezone(calibrators, track);
    assert.equal(best.offsetHours, 8);
    assert.equal(best.inside, 2);
  });
});

describe('suggestTzOffset：把"缺覆盖"改判成"时区大概错了"', () => {
  const track = parseGpxTrack(
    gpxText([[trkpt(38.0, 114.0, 0), trkpt(38.002, 114.002, 60)]]),
  ).points;

  test('用错的偏移算出的落空照片 → 能指出正确的整数小时偏移', () => {
    // 照片真实墙上时间 18:00:30（= UTC+8），却被按 offset 0 处理 ⇒ 全部落窗外
    const missed = [{ photo: { time: '2026-10-06T18:00:30' } }];
    assert.equal(suggestTzOffset(missed, track, 0), 8);
  });

  test('落空照片缺拍摄时间 → 无法据此推断（返回 null，不猜）', () => {
    const missed = [{ photo: { time: null } }];
    assert.equal(suggestTzOffset(missed, track, 8), null);
  });

  test('没有任何整数小时能救回 → null', () => {
    // 同理取 :30:30：整数小时平移改变不了分钟位，任何 h 都进不了这条 60 秒的窗口
    const missed = [{ photo: { time: '2026-10-06T03:30:30' } }];
    assert.equal(suggestTzOffset(missed, track, 8), null);
  });
});
