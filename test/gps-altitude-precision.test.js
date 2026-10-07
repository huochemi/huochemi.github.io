/**
 * 海拔保真：两条补坐标通道写 GPSAltitude 时都必须带 `-n`
 *
 * 为什么必须测：exiftool 的 `-tagsfromfile` 复制 rational 标签时，不加 `-n` 会走
 * **打印格式**——`GPSAltitude` 被截成一位小数（实测 `69.84174921` → `69.8`），而
 * `GPSLatitude` / `GPSLongitude` 走另一条保真通路、完全不受影响。于是损失只落在
 * 海拔上，**不报错、不警告**，肉眼查坐标也看不出来。
 *
 * 2026-10-07 实测的完整证据：
 *   | 写法                            | GPSLatitude        | GPSAltitude   |
 *   | 源（iPhone 参照）                | 38.0084111111111   | 69.84174921   |
 *   | `-tagsfromfile` 无 `-n`         | 38.0084111111111 ✅ | 69.8        ⚠️ |
 *   | `-tagsfromfile` 加 `-n`         | 38.0084111111111 ✅ | 69.84174909 ✅ |
 * 轨迹通道（writeGpsFromTrack）是 `-n` + 直接赋值，一开始就是保真的；而轨迹源数据
 * （GPX 的 `<ele>`）也是高精度（如 `75.72615260351449`）。所以两条通道曾经**差 7 个
 * 数量级**——同一个 `GPSAltitude` 字段，一条给 1 位小数、一条给 14 位。
 *
 * 原片 EXIF 写入**不可回溯**：截断后再想恢复是不可能的，而保真后想显示一位小数，
 * 消费者 `toFixed(1)` 即可。故口径定为：**写入端保真，舍入留给展示层**。
 *
 * 运行：npm run test:cli（node 内置 runner；与 CRA 的 jest 分离，见 AGENTS.md 流程 #1）
 * 计划：docs/plans/2026-10-07-gpx-coordinate-channel.md
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
const fss = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sharp = require('sharp');

/** 参照的原始海拔：8 位小数（iPhone 实测值），足以分辨"被截成一位"与"保真" */
const ALT = 69.84174921;
/** 北纬 + 东经：本组只关心海拔与"`-n` 不能伤到经纬度"，符号方向另设南纬用例覆盖 */
const LAT_N = 38.0084111111111;
const LNG_E = 114.478408333333;

/**
 * 判据阈值：exiftool 各版本对 rational 的量化末位不同（实测 `...921` → `...909`，
 * 差 1.2e-7），要求逐位相等会对工具版本过敏；而"截成一位小数"的损失是 0.04 m 量级。
 * 取 1e-5 m 卡在两者之间——差 4 个数量级，判据安全。
 */
const TOLERANCE_M = 1e-5;
/** 判定"被截断"的下界：> 0.01 m 即说明小数位真的丢了（69.84 → 69.8 是 0.04 m） */
const TRUNCATED_M = 0.01;

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

/** 用 exiftool 读一个 GPS 数值标签（`-n` 原始数值、`-s3` 只出值） */
function readTag(file, tag) {
  const out = execFileSync('exiftool', ['-n', '-s3', tag, file], {
    encoding: 'utf8',
  }).trim();
  return out === '' ? null : Number(out);
}

const COPIED_TAGS = [
  '-GPSLatitude',
  '-GPSLatitudeRef',
  '-GPSLongitude',
  '-GPSLongitudeRef',
  '-GPSAltitude',
  '-GPSAltitudeRef',
];

async function makeJpeg(file) {
  await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .jpeg()
    .toFile(file);
}

/** 造 fixture：1 张高精度参照 + 3 张待写的干净目标（无 GPS） */
async function makeFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hcm-gps-alt-'));
  const ref = path.join(dir, 'ref.jpg');
  const plain = path.join(dir, 'plain.jpg');
  const numeric = path.join(dir, 'numeric.jpg');
  const south = path.join(dir, 'south.jpg');
  for (const f of [ref, plain, numeric, south]) await makeJpeg(f);

  exiftool([
    '-overwrite_original',
    '-n',
    `-GPSLatitude=${LAT_N}`,
    '-GPSLatitudeRef=N',
    `-GPSLongitude=${LNG_E}`,
    '-GPSLongitudeRef=E',
    `-GPSAltitude=${ALT}`,
    '-GPSAltitudeRef=0',
    ref,
  ]);

  return { dir, ref, plain, numeric, south };
}

// 依赖 fixture 的断言单独成组：环境缺 exiftool 时只让它们变红，而下面那条不依赖
// fixture 的结构锁仍会照常运行并通过——于是"环境没配好"与"代码回归"一眼可辨。
describe('海拔保真：-tagsfromfile 必须配 -n（fixture 由 sharp + exiftool 现造）', () => {
  let fx;

  before(async () => {
    fx = await makeFixture();
  });

  after(async () => {
    if (fx) await fs.rm(fx.dir, { recursive: true, force: true });
  });

  test('断言 A · 反面证据：不加 -n 会把海拔截成一位小数（这是 -n 存在的理由）', () => {
    exiftool(['-overwrite_original', '-tagsfromfile', fx.ref, ...COPIED_TAGS, fx.plain]);
    const got = readTag(fx.plain, '-GPSAltitude');
    assert.ok(
      Math.abs(got - ALT) > TRUNCATED_M,
      `不加 -n 本应把海拔截成一位小数，实际读到 ${got}（若与此断言不符，说明 ` +
        'exiftool 行为变了——请复核 fix-gps.js 是否仍必须带 -n，并更新本测试与注释）',
    );
    assert.ok(
      Math.abs(readTag(fx.plain, '-GPSLatitude') - LAT_N) < 1e-9,
      '同一条件下经纬度**不应**受影响：这正是"半边损失、不易察觉"的成因',
    );
  });

  test('断言 B · 正面证据：加 -n 后海拔保真（与参照差 < 1e-5 m）', () => {
    exiftool([
      '-overwrite_original',
      '-n',
      '-tagsfromfile',
      fx.ref,
      ...COPIED_TAGS,
      fx.numeric,
    ]);
    const got = readTag(fx.numeric, '-GPSAltitude');
    assert.ok(
      Math.abs(got - ALT) < TOLERANCE_M,
      `加 -n 后海拔应与参照同精度（期望 ≈ ${ALT}），实际 ${got}`,
    );
  });

  test('断言 C · 加 -n 不得伤到方位标记：南纬/西经仍要写成负值', () => {
    // 加 -n 是往"写数值"的方向走，而符号依赖 Ref 标签——雅加达那个坑
    // （Ref 未参与派生 → 南纬读成北纬）必须确认不被带回来。
    exiftool([
      '-overwrite_original',
      '-n',
      `-GPSLatitude=${LAT_N}`,
      '-GPSLatitudeRef=S',
      `-GPSLongitude=${LNG_E}`,
      '-GPSLongitudeRef=W',
      fx.south,
    ]);
    const lat = readTag(fx.south, '-GPSLatitude');
    assert.equal(lat, -LAT_N, '南纬应以负值写出（符号由 Ref 决定）');
    assert.equal(
      execFileSync('exiftool', ['-n', '-s3', '-GPSLatitudeRef', fx.south], {
        encoding: 'utf8',
      }).trim(),
      'S',
      '方位标记的**原始值**必须是 S（不带 -n 读出来的是打印值 "South"，同一件事的两种呈现）',
    );
  });
});

// ---------------------------------------------------------------------------
// 结构锁：不依赖 fixture / exiftool，环境缺依赖时也照常给出"代码有没有带 -n"的答案
// ---------------------------------------------------------------------------

const FIX_GPS_SRC = fss.readFileSync(path.join(__dirname, '..', 'fix-gps.js'), 'utf8');

/** 抓某个 async 函数的源码体（函数名到行首闭合 `}`）；函数改名后此处会失败并提示 */
function fnBody(name) {
  const m = FIX_GPS_SRC.match(
    new RegExp(`async function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`),
  );
  assert.ok(m, `未能在 fix-gps.js 中定位 ${name}() 的函数体（改名后请同步更新本测试）`);
  return m[0];
}

test('断言 D · 结构锁：两条通道的 exiftool 参数都必须含 -n', () => {
  // 口径漂移只有两种归宿：修掉，或写明白。这条锁住"修掉"——将来谁把 -n 删了，
  // 断言 B 与本条会同时变红，且报错文案已写明后果（不可回溯 + 半边损失）。
  for (const [name, why] of [
    ['writeGps', '锚点路用 -tagsfromfile 复制参照的 GPSAltitude'],
    ['writeGpsFromTrack', '轨迹路直接赋值 GPX 的 <ele>（14 位小数）'],
  ]) {
    assert.ok(
      /['"]-n['"]/.test(fnBody(name)),
      `${name}() 的 exiftool 参数必须含 '-n'（${why}）：不加会让海拔走打印格式、` +
        '被截成一位小数，而原片 EXIF 一旦写入不可回溯。',
    );
  }
});
