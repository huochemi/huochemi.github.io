/**
 * 增量跳过判据（derivedIsUpToDate）单测
 *
 * 计划：docs/plans/2026-10-05-photos-incremental-skip.md
 * 运行：npm run test:cli（node 内置 runner；与 CRA 的 jest 分离，见 AGENTS.md 流程 #1）
 *
 * 这个判据是**全部派生图**（缩略图 / 展示图 / 视频转码版 / 视频封面帧）共用的唯一
 * 增量判定点，所以边界必须锁死：`>=` 而非 `>`、派生文件缺失即重建。用真实文件 +
 * `fs.utimes` 构造各态，全程在 `os.tmpdir()` 的临时目录里、跑完即删——
 * 不碰仓库里的任何照片（S1：验证与生产数据隔离）。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { derivedIsUpToDate } = require('../process-photos');

/** 建临时目录跑用例，结束即删（断言失败也删） */
async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hcm-incremental-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** 造一个 mtime 为指定整秒的文件（整秒可避开各文件系统的时间戳精度差异） */
async function touch(filePath, epochSeconds) {
  await fs.writeFile(filePath, 'x');
  await fs.utimes(filePath, epochSeconds, epochSeconds);
}

test('derivedIsUpToDate：派生文件比原片新 → 跳过（true）', () =>
  withTempDir(async (dir) => {
    const src = path.join(dir, 'IMG_4657.HEIC');
    const der = path.join(dir, 'IMG_4657_display.avif');
    await touch(src, 1_700_000_000);
    await touch(der, 1_700_000_100);
    assert.equal(await derivedIsUpToDate(src, der), true);
  }));

test('derivedIsUpToDate：mtime 相等 → 跳过（锁 `>=` 而非 `>`）', () =>
  withTempDir(async (dir) => {
    const src = path.join(dir, 'IMG_4657.HEIC');
    const der = path.join(dir, 'IMG_4657_thumb.webp');
    await touch(src, 1_700_000_000);
    await touch(der, 1_700_000_000);
    assert.equal(await derivedIsUpToDate(src, der), true);
  }));

test('derivedIsUpToDate：派生文件比原片旧 → 重建（false；fix-gps 补坐标即此情形）', () =>
  withTempDir(async (dir) => {
    const src = path.join(dir, 'IMG_4657.HEIC');
    const der = path.join(dir, 'IMG_4657_display.avif');
    await touch(der, 1_700_000_000);
    await touch(src, 1_700_000_100);
    assert.equal(await derivedIsUpToDate(src, der), false);
  }));

test('derivedIsUpToDate：派生文件不存在 → 重建（false；新导入照片即此情形）', () =>
  withTempDir(async (dir) => {
    const src = path.join(dir, 'IMG_4666.HEIC');
    await touch(src, 1_700_000_000);
    assert.equal(
      await derivedIsUpToDate(src, path.join(dir, 'IMG_4666_display.avif')),
      false,
    );
  }));
