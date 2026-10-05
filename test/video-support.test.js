/**
 * 视频支持（mp4）纯函数单测 + 跨文件契约锁定
 *
 * 计划：docs/plans/2026-10-04-video-mp4-support.md
 * 运行：npm run test:cli（node 内置 runner；与 CRA 的 jest 分离，见 AGENTS.md 流程 #1）
 *
 * 只测无副作用的纯函数（时间规范化 / 媒体与派生文件判别）与三个 CLI 之间的
 * 口径契约——不碰文件系统里的照片、不调用外部命令。三个 CLI 刻意不抽共享模块
 * （各自是独立可执行文件），派生后缀口径的一致性因此只能靠测试锁住。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeExifDateTime,
  stripTimezoneSuffix,
  isVideoFile,
  isDerivedFile,
  ALLOWED_EXTS,
  DERIVED_SUFFIXES,
} = require('../process-photos');

const REPO_ROOT = path.join(__dirname, '..');
const CLI_FILES = [
  'process-photos.js',
  'fix-gps.js',
  'delete-photo.js',
  'new-place.js',
];

const readSource = (file) =>
  fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');

// ---------------------------------------------------------------------------
// stripTimezoneSuffix：mp4 的 Keys:CreationDate 带时区后缀，照片 EXIF 没有
// ---------------------------------------------------------------------------

test('stripTimezoneSuffix：切掉 +08:00 时区后缀', () => {
  assert.equal(
    stripTimezoneSuffix('2026:10:03 11:18:54+08:00'),
    '2026:10:03 11:18:54',
  );
});

test('stripTimezoneSuffix：切掉负时区后缀（-05:00）', () => {
  assert.equal(
    stripTimezoneSuffix('2026:10:03 11:18:54-05:00'),
    '2026:10:03 11:18:54',
  );
});

test('stripTimezoneSuffix：无时区后缀的值原样通过', () => {
  assert.equal(
    stripTimezoneSuffix('2026:10:03 11:18:54'),
    '2026:10:03 11:18:54',
  );
});

test('stripTimezoneSuffix：非字符串原样返回（exiftool 键缺失时为 undefined）', () => {
  assert.equal(stripTimezoneSuffix(undefined), undefined);
  assert.equal(stripTimezoneSuffix(null), null);
});

// ---------------------------------------------------------------------------
// 视频拍摄时间的完整链路：strip 后走照片同款 normalizeExifDateTime
// ---------------------------------------------------------------------------

test('视频 takenAt 链路：CreationDate(+08:00) → 拍摄地当地墙上时间 ISO 字符串', () => {
  // 实测：IMG_5810.mp4 的 Keys:CreationDate = "2026:10:03 11:18:54+08:00"
  const takenAt = normalizeExifDateTime(
    stripTimezoneSuffix('2026:10:03 11:18:54+08:00'),
  );
  assert.equal(takenAt, '2026-10-03T11:18:54');
});

test('normalizeExifDateTime：解析不了的时间返回 null（不产生脏数据）', () => {
  assert.equal(normalizeExifDateTime('not-a-date'), null);
  assert.equal(normalizeExifDateTime('2026:13:03 11:18:54'), null); // 13 月
});

// ---------------------------------------------------------------------------
// 媒体 / 派生文件判别
// ---------------------------------------------------------------------------

test('isVideoFile：按扩展名识别 mp4（大小写不敏感），图片不算', () => {
  assert.equal(isVideoFile('IMG_5810.mp4'), true);
  assert.equal(isVideoFile('IMG_5810.MP4'), true);
  assert.equal(isVideoFile('IMG_5806.HEIC'), false);
  assert.equal(isVideoFile('DSC04908.JPG'), false);
});

test('isDerivedFile：三种派生后缀都识别，原媒体不误伤', () => {
  assert.equal(isDerivedFile('IMG_5810_thumb.webp'), true);
  assert.equal(isDerivedFile('IMG_5810_display.avif'), true);
  assert.equal(isDerivedFile('IMG_5810_web.mp4'), true);
  assert.equal(isDerivedFile('IMG_5810.mp4'), false);
  assert.equal(isDerivedFile('IMG_5810.HEIC'), false);
});

test('ALLOWED_EXTS：图片四格式 + mp4', () => {
  for (const ext of ['.jpg', '.jpeg', '.heic', '.tiff', '.mp4']) {
    assert.ok(ALLOWED_EXTS.has(ext), `应包含 ${ext}`);
  }
});

// ---------------------------------------------------------------------------
// 跨文件契约：四个 CLI 的派生后缀 / 媒体格式口径必须一致
//
// 四个脚本各自独立（不抽共享模块），口径漂移的后果：fix-gps 会把转码版
// 当原片扫进去（坐标写进 _web.mp4）、delete-photo 的"删后为空"会把派生
// 文件算进剩余媒体数、new-place 会把派生文件当成候选封面。用测试锁死，
// 改任何一处不同步都会在这里爆。
// ---------------------------------------------------------------------------

/**
 * 从单个 CLI 源码解析 DERIVED_SUFFIXES 的实际值：数组元素既可能是字符串字面量，
 * 也可能是本文件常量名（THUMB_SUFFIX 等）——逐个解引用成字符串再比较，
 * 避免测试对"声明风格"过敏。
 */
function resolveSuffixesFromSource(source, label) {
  const stringConst = (name) => {
    const match = source.match(
      new RegExp(`const\\s+${name}\\s*=\\s*'([^']+)'`),
    );
    assert.ok(match, `${label} 应能定位到常量 ${name}`);
    return match[1];
  };
  const declaration = source.match(/const\s+DERIVED_SUFFIXES\s*=\s*\[([^\]]+)\]/);
  assert.ok(declaration, `${label} 应能定位到 DERIVED_SUFFIXES 声明`);
  return declaration[1]
    .split(',')
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
    .map((entry) => (entry.startsWith('_') ? entry : stringConst(entry)));
}

test('契约：四个 CLI 的 DERIVED_SUFFIXES 完全一致', () => {
  for (const file of CLI_FILES) {
    const suffixes = resolveSuffixesFromSource(readSource(file), file);
    assert.deepEqual(
      suffixes,
      ['_thumb.webp', '_display.avif', '_web.mp4'],
      `${file} 的派生后缀与契约不一致`,
    );
  }
  // process-photos.js 的运行时导出值（require 拿到的）也要与源码字面量一致，
  // 防止"常量拼装与字面量脱节"这种单文件内漂移
  assert.deepEqual(DERIVED_SUFFIXES, ['_thumb.webp', '_display.avif', '_web.mp4']);
});

test('契约：四个 CLI 的 ALLOWED_EXTS 都已包含 .mp4', () => {
  for (const file of CLI_FILES) {
    const match = readSource(file).match(
      /const\s+ALLOWED_EXTS\s*=\s*new Set\(\[([^\]]+)\]\)/,
    );
    assert.ok(match, `${file} 应能定位到 ALLOWED_EXTS 声明`);
    const exts = match[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    assert.ok(
      exts.includes('.mp4'),
      `${file} 的 ALLOWED_EXTS 缺 .mp4（三处必须同步扩展）`,
    );
  }
});
