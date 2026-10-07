/**
 * 坐标溯源与"设备维度"判据的契约单测
 *
 * 两个独立 CLI（process-photos.js / fix-gps.js）**刻意各存一份**同名实现与常量
 * （不抽共享模块，见 docs/plans/2026-10-04-data-repo-longevity.md 的架构取舍）。
 * 没有机制强制它们一致，口径漂移只会以"数据看起来怪"的形式暴露，故这里逐条断言：
 *   ① 溯源解析（parseGeoTag / parseGeoSource）两处行为逐例相同；
 *   ② 设备映射表（PHONE_MAKES / CAMERA_MAKES）与分类结果两处相同 —— 锚点池判据
 *      漂移会让同一张照片在一个脚本里是锚点、在另一个里不是；
 *   ③ `.gpx` 只进 TRACK_EXTS、**不得进** ALLOWED_EXTS —— 否则轨迹会变成一条
 *      output.json 的 photo 条目并参与缺坐标硬拦。
 *
 * 全是纯函数与常量，不读原图仓、不碰 EXIF、不依赖外部命令。
 *
 * 运行：npm run test:cli（node 内置 runner；与 CRA 的 jest 分离，见 AGENTS.md 流程 #1）
 * 计划：docs/plans/2026-10-07-gpx-coordinate-channel.md
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const fixGps = require('../fix-gps');
const photos = require('../process-photos');

/** 有代表性的 GPSProcessingMethod 取值集合：新格式 / 旧格式 / 原生 / 坏标记 / 脏数据 */
const RAW_CASES = [
  // 本工具新写的两种通道
  'hcm-geosource mode=anchor ref=IMG_5858.HEIC date=2026-10-07',
  'hcm-geosource mode=gpx ref=Walking 2026-10-06T112533Z.gpx date=2026-10-07',
  // 2026-10-03 ~ 10-07 之间的历史格式（没有 mode）：必须解析为 anchor
  'hcm-geosource ref=IMG_4657.HEIC date=2026-10-05',
  // 相机会自己写的原生标记（无本工具前缀）→ 必须视为原生
  'GPS',
  'Apple',
  'CELLID',
  // 有前缀但结构损坏 → 仍是"复制坐标"，ref 只能是 unknown
  'hcm-geosource date=2026-10-07',
  'hcm-geosource mode=gpx date=2026-10-07',
  // 空/缺失
  '',
  undefined,
  null,
  // 前缀只是开头匹配的巧合（后面接别的内容）——仍按本工具标记处理，ref 取 unknown
  'hcm-geosource',
  // 多余空白
  '  hcm-geosource mode=anchor ref=x.JPG date=2026-10-07  ',
];

describe('parseGeoTag / parseGeoSource：语义与历史兼容', () => {
  test('新格式：mode 与 ref 都解析出来（ref 可含空格，如轨迹文件名）', () => {
    assert.deepEqual(
      fixGps.parseGeoTag('hcm-geosource mode=gpx ref=Walking 2026-10-06T112533Z.gpx date=2026-10-07'),
      { mode: 'gpx', ref: 'Walking 2026-10-06T112533Z.gpx' },
    );
  });

  test('缺 mode 的历史标记 ⇒ mode = anchor（准确的历史陈述，不是 fallback）', () => {
    assert.deepEqual(
      fixGps.parseGeoTag('hcm-geosource ref=IMG_4657.HEIC date=2026-10-05'),
      { mode: 'anchor', ref: 'IMG_4657.HEIC' },
    );
  });

  test('原生标记（无前缀）⇒ undefined；有前缀但损坏 ⇒ ref = unknown', () => {
    assert.equal(fixGps.parseGeoTag('GPS'), undefined);
    assert.equal(fixGps.parseGeoTag(undefined), undefined);
    assert.deepEqual(fixGps.parseGeoTag('hcm-geosource date=2026-10-07'), {
      mode: 'anchor',
      ref: 'unknown',
    });
  });

  test('parseGeoSource 保持旧语义：返回字符串或 undefined（output.json 契约）', () => {
    assert.equal(
      fixGps.parseGeoSource('hcm-geosource mode=anchor ref=IMG_5858.HEIC date=2026-10-07'),
      'IMG_5858.HEIC',
    );
    assert.equal(fixGps.parseGeoSource('hcm-geosource ref=IMG_4657.HEIC date=2026-10-05'), 'IMG_4657.HEIC');
    assert.equal(fixGps.parseGeoSource('hcm-geosource mode=gpx date=2026-10-07'), 'unknown');
    assert.equal(fixGps.parseGeoSource('Apple'), undefined);
  });

  test('跨文件一致性：两脚本对同一批原始值的解析结果逐例相同', () => {
    for (const raw of RAW_CASES) {
      assert.deepEqual(
        fixGps.parseGeoTag(raw),
        photos.parseGeoTag(raw),
        `parseGeoTag 对 ${JSON.stringify(raw)} 的结果应一致`,
      );
      assert.equal(
        fixGps.parseGeoSource(raw),
        photos.parseGeoSource(raw),
        `parseGeoSource 对 ${JSON.stringify(raw)} 的结果应一致`,
      );
    }
  });
});

describe('设备映射表：两脚本必须同值（锚点池判据的事实源）', () => {
  test('PHONE_MAKES 同值', () => {
    assert.deepEqual(
      [...fixGps.PHONE_MAKES].sort(),
      [...photos.PHONE_MAKES].sort(),
    );
  });

  test('CAMERA_MAKES 同值', () => {
    assert.deepEqual(
      [...fixGps.CAMERA_MAKES].sort(),
      [...photos.CAMERA_MAKES].sort(),
    );
  });

  test('sony 同时出现在两张表里是刻意的（靠 Model 级 Xperia 特例消歧）', () => {
    assert.ok(fixGps.CAMERA_MAKES.has('sony'));
    assert.ok(!fixGps.PHONE_MAKES.has('sony'), 'sony 不该进手机品牌表');
  });
});

describe('classifyDevice：设备维度的判定行为', () => {
  const cases = [
    [['Apple', 'iPhone 14 Pro Max'], 'phone'],
    [['apple', 'iPhone X'], 'phone'],
    [['HUAWEI', 'ELE-L29'], 'phone'],
    [['SONY', 'NEX-5N'], 'camera'],
    [['SONY', 'ILCE-7M3'], 'camera'],
    [['SONY', 'Xperia 1 III'], 'phone'], // 型号级特例优先于品牌表
    [['Canon', 'EOS R6'], 'camera'],
    [['UnknownBrand', 'X1'], null],
    [['', 'X1'], null],
    [[undefined, undefined], null],
  ];

  for (const [[make, model], expected] of cases) {
    test(`${make ?? '(缺 Make)'} / ${model ?? '(缺 Model)'} → ${expected}`, () => {
      assert.equal(fixGps.classifyDevice(make, model), expected);
      assert.equal(
        photos.classifyDevice(make, model),
        expected,
        '两脚本的分类结果必须一致（漂移会让同一张照片在一处是锚点、另一处不是）',
      );
    });
  }
});

describe('未知设备硬错（决策 ③：fail-early，不做 fallback）', () => {
  test('未知设备抛错，报错含文件名、原始 Make/Model、去哪加映射、两份副本要同改', () => {
    assert.throws(
      () => fixGps.assertDeviceKnown('石家庄站', 'DSC9999.JPG', 'Pentax?No', 'K-3'),
      (err) => {
        assert.match(err.message, /DSC9999\.JPG/, '必须含具体文件名');
        assert.match(err.message, /Pentax\?No/, '必须回显原始 Make，便于照抄进映射表');
        assert.match(err.message, /K-3/, '必须回显原始 Model');
        assert.match(err.message, /PHONE_MAKES|CAMERA_MAKES/, '必须指出去哪加映射');
        assert.match(err.message, /fix-gps\.js/, '必须提醒另一份副本要同步改');
        return true;
      },
    );
  });

  test('已识别设备不抛错，且直接返回分类结果', () => {
    assert.equal(fixGps.assertDeviceKnown('石家庄站', 'DSC05060.JPG', 'SONY', 'NEX-5N'), 'camera');
    assert.equal(fixGps.assertDeviceKnown('石家庄站', 'IMG_5858.HEIC', 'Apple', 'iPhone 14 Pro Max'), 'phone');
  });
});

describe('.gpx：只认轨迹通道，不得进媒体白名单', () => {
  test('TRACK_EXTS 两脚本同值且只含 .gpx', () => {
    assert.deepEqual([...fixGps.TRACK_EXTS].sort(), ['.gpx']);
    assert.deepEqual([...fixGps.TRACK_EXTS].sort(), [...photos.TRACK_EXTS].sort());
  });

  test('两个脚本的 ALLOWED_EXTS 都不含 .gpx（轨迹不是媒体）', () => {
    assert.ok(
      !photos.ALLOWED_EXTS.has('.gpx'),
      'process-photos 的媒体白名单不得含 .gpx —— 否则 output.json 会多出轨迹条目、' +
        '并参与缺坐标硬拦',
    );
    // fix-gps 的 ALLOWED_EXTS 未导出，用源码断言（同 test/video-support.test.js 的手法）
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', 'fix-gps.js'),
      'utf8',
    );
    const m = /const\s+ALLOWED_EXTS\s*=\s*new Set\(\[([^\]]*)\]\)/.exec(src);
    assert.ok(m, '应能定位 fix-gps.js 的 ALLOWED_EXTS 声明');
    assert.ok(!m[1].includes('gpx'), 'fix-gps.js 的媒体白名单不得含 .gpx');
  });
});
