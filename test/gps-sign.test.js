/**
 * 坐标符号：EXIF 方位标记（GPSLatitudeRef / GPSLongitudeRef）是否参与派生
 *
 * 为什么必须测：exifr 的 latitude / longitude 是**派生值**，由 GPSLatitude / GPSLongitude
 * 的度分秒数组 + 方位标记算出。若读 EXIF 时用了分块 pick 却漏掉两个 Ref，派生值会
 * **静默丢符号**（南纬/西经读成正值）——不报错、不警告，只是点位整体偏到另一个半球。
 * 2026-10-06 雅加达（本站第一个南半球点位）就是这样被钉到北纬 6.118°（南海西南海面），
 * 与真实位置相差约 1362 km。这是坐标链路上唯一"算错也不响"的环节，必须有控制点兜着
 * （同 test/gcj02.test.js 开头的主张）。
 *
 * 运行：npm run test:cli（node 内置 runner；与 CRA 的 jest 分离，见 AGENTS.md 流程 #1）
 * 计划：docs/plans/2026-10-06-gps-sign-loss-and-jakarta.md
 *
 * fixture 是运行时用 sharp + exiftool 现造的 8×8 JPEG，落在 os.tmpdir()、跑完即删：
 * 不依赖不可再生的原图仓（S1），也不往仓库里塞二进制文件。
 * exiftool 是外部命令硬依赖（AGENTS.md S3：假设已存在、启动预检一次、缺失即报错并
 * 附安装命令）——缺了就让测试红，不 skip：skip 会把"环境没配好"伪装成"测试通过"。
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const exifr = require('exifr');
const sharp = require('sharp');

const { PREFLIGHT_EXIF_OPTS } = require('../process-photos');
const { REVIEW_EXIF_OPTS } = require('../fix-gps');

/** fixture 的坐标：南纬 + 西经——一张同时覆盖两个方位标记方向 */
const LAT_S = 6.1184166;
const LNG_W = 106.6646888;

/**
 * 容差 1e-4 度 ≈ 11 m：exiftool 各版本对有理数的量化末位可能不同，要求逐位相等会
 * 对工具版本过敏；而"丢了符号"的偏差是 12 度（≈1300 km），两者差 5 个数量级，判据安全。
 */
const TOLERANCE_DEG = 1e-4;

const INSTALL_HINT =
  '安装 exiftool：macOS → brew install exiftool ；Ubuntu/Debian → ' +
  'sudo apt-get install -y libimage-exiftool-perl' +
  '（若已安装却仍报找不到，检查 PATH——本仓库的 CLI 与测试都需要能访问它，' +
  '见 docs/toolchain.md）。';

/** 跑一次 exiftool；可执行文件缺失时给出安装提示后失败（不 skip、不降级） */
function exiftool(args) {
  try {
    execFileSync('exiftool', args, { stdio: 'pipe' });
  } catch (err) {
    if (err.code === 'ENOENT') {
      assert.fail(`未找到 exiftool（本项目的外部命令硬依赖）。${INSTALL_HINT}`);
    }
    throw err;
  }
}

/** 造一张带"南纬 + 西经"EXIF 的 JPEG，返回 { dir, file } */
async function makeFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hcm-gps-sign-'));
  const file = path.join(dir, 'south-west.jpg');
  await sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: 200, g: 200, b: 200 },
    },
  })
    .jpeg()
    .toFile(file);
  exiftool([
    '-overwrite_original',
    `-GPSLatitude=${LAT_S}`,
    '-GPSLatitudeRef=S',
    `-GPSLongitude=${LNG_W}`,
    '-GPSLongitudeRef=W',
    file,
  ]);
  return { dir, file };
}

// 依赖 fixture 的两条断言单独成组：环境缺 exiftool 时只让它们变红，而下面那条不依赖
// fixture 的结构断言仍会照常运行并通过——于是"环境没配好"与"代码回归"一眼可辨。
describe('坐标符号：南纬/西经必须读成负值（fixture 由 sharp + exiftool 现造）', () => {
  let fixture;

  before(async () => {
    fixture = await makeFixture();
  });

  after(async () => {
    if (fixture) await fs.rm(fixture.dir, { recursive: true, force: true });
  });

  test('断言 A · 绝对正确性：6.1184166°S / 106.6646888°W 必须带负号', async () => {
    const exif = await exifr.parse(fixture.file, PREFLIGHT_EXIF_OPTS);
    assert.ok(
      exif.latitude < 0,
      `南纬应读成负值，实际 ${exif.latitude}（丢符号 = 点位偏到北纬，可达上千公里）`,
    );
    assert.ok(exif.longitude < 0, `西经应读成负值，实际 ${exif.longitude}`);
    assert.ok(
      Math.abs(exif.latitude + LAT_S) < TOLERANCE_DEG,
      `纬度应在 −${LAT_S} 附近，实际 ${exif.latitude}`,
    );
    assert.ok(
      Math.abs(exif.longitude + LNG_W) < TOLERANCE_DEG,
      `经度应在 −${LNG_W} 附近，实际 ${exif.longitude}`,
    );
    assert.equal(exif.GPSLatitudeRef, 'S', '方位标记应可读（它是派生值的输入）');
  });

  test('断言 B · 跨文件一致性：process-photos 与 fix-gps 的读法必须逐位相同', async () => {
    // 两个 CLI 刻意各存一份 EXIF 常量、不抽共享模块（既有架构决策），口径漂移只能靠
    // 测试锁住——同 test/video-support.test.js 锁三处 DERIVED_SUFFIXES 的手法。
    // 同一个 exifr 读同一个文件，配置一致则结果必然全等，改一处不同步就会在这里爆。
    const photos = await exifr.parse(fixture.file, PREFLIGHT_EXIF_OPTS);
    const review = await exifr.parse(fixture.file, REVIEW_EXIF_OPTS);
    assert.equal(review.latitude, photos.latitude);
    assert.equal(review.longitude, photos.longitude);
  });
});

test('断言 C · 结构锁：两处读配置的 gps 块都不得 pick（不依赖 fixture）', () => {
  for (const [label, opts] of [
    ['process-photos.js 的 PREFLIGHT_EXIF_OPTS', PREFLIGHT_EXIF_OPTS],
    ['fix-gps.js 的 REVIEW_EXIF_OPTS', REVIEW_EXIF_OPTS],
  ]) {
    assert.ok(opts.gps, `${label} 应有 gps 块`);
    assert.ok(
      !('pick' in opts.gps),
      `${label} 的 gps 块不得使用 pick：派生值 latitude/longitude 的符号依赖 ` +
        'GPSLatitudeRef/GPSLongitudeRef，pick 列表只要漏掉 Ref 就会静默把南纬/西经读成正值。' +
        '如确需 pick，必须把两个 Ref 一并列上，并同步更新本测试。',
    );
  }
});
