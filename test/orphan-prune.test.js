/**
 * 孤儿派生图扫描与清理决策单测（`scanOrphans` / `decideCleanup`）
 *
 * 计划：docs/plans/2026-10-09-photos-orphan-prune.md
 * 运行：npm run test:cli（node 内置 runner；与 CRA 的 jest 分离，见 AGENTS.md 流程 #1）
 *
 * 这两个函数是 `npm run photos` 收尾"自动清理孤儿派生图"的**唯一判定点**，所以边界必须
 * 锁死：只认三种派生后缀、原图目录读不到时**不删任何文件**（闸门一）、会被清空的点位
 * **不删任何文件**（闸门二）、闸门优先级读失败 > 会删空。
 *
 * 全程在 `os.tmpdir()` 的临时目录里、跑完即删——不碰仓库里的任何照片
 * （S1：验证与生产数据隔离）。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { scanOrphans, decideCleanup, ALLOWED_EXTS, REF_IMAGE_EXTS } =
  require('../process-photos');

/** 建临时目录跑用例，结束即删（断言失败也删） */
async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hcm-orphan-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** 在目录里批量造空文件（目录自动建） */
async function touchAll(dir, names) {
  await fs.mkdir(dir, { recursive: true });
  await Promise.all(names.map((name) => fs.writeFile(path.join(dir, name), 'x')));
}

/** 派生图的 basename 列表（断言用；与 fullPath 顺序一致） */
const orphanNames = (scan) => scan.orphans.map((o) => o.file).sort();

test('scanOrphans：只把「无对应原片」的派生图判为孤儿', () =>
  withTempDir(async (dir) => {
    const origin = path.join(dir, 'origin');
    const derived = path.join(dir, 'derived');
    await touchAll(origin, ['IMG_1.HEIC', 'IMG_2.HEIC']);
    await touchAll(derived, [
      'IMG_1_thumb.webp',
      'IMG_1_display.avif',
      'IMG_2_thumb.webp',
      'IMG_9_thumb.webp',
      'IMG_9_display.avif',
    ]);

    const scan = await scanOrphans(origin, derived, ALLOWED_EXTS, {
      failLoud: true,
      label: 'P',
    });

    assert.equal(scan.readError, null);
    assert.equal(scan.total, 5);
    assert.deepEqual(orphanNames(scan), ['IMG_9_display.avif', 'IMG_9_thumb.webp']);
    assert.ok(scan.orphans[0].fullPath.startsWith(derived));
  }));

test('scanOrphans：视频原片配 _web.mp4 不算孤儿', () =>
  withTempDir(async (dir) => {
    const origin = path.join(dir, 'origin');
    const derived = path.join(dir, 'derived');
    await touchAll(origin, ['IMG_1.mp4']);
    await touchAll(derived, ['IMG_1_thumb.webp', 'IMG_1_web.mp4']);

    const scan = await scanOrphans(origin, derived, ALLOWED_EXTS, {
      failLoud: true,
      label: 'P',
    });

    assert.equal(scan.total, 2);
    assert.deepEqual(scan.orphans, []);
  }));

test('scanOrphans：非派生后缀的文件不计入 total（后缀白名单是唯一口径）', () =>
  withTempDir(async (dir) => {
    const origin = path.join(dir, 'origin');
    const derived = path.join(dir, 'derived');
    await touchAll(origin, ['IMG_1.HEIC']);
    await touchAll(derived, [
      'IMG_1_thumb.webp', // 派生
      'index.json', // 点位元数据，永不删
      'IMG_2_thumb.png', // 结尾不是 _thumb.webp ⇒ 不是派生
      'IMG_2.webp', // 裸 webp ⇒ 不是派生
      'IMG_2_web.mp4.bak', // 不是派生
    ]);

    const scan = await scanOrphans(origin, derived, ALLOWED_EXTS, {
      failLoud: true,
      label: 'P',
    });

    assert.equal(scan.total, 1);
    assert.deepEqual(scan.orphans, []);
  }));

test('scanOrphans：原图目录读不到 + failLoud ⇒ 报 readError，且不产出任何孤儿', () =>
  withTempDir(async (dir) => {
    const derived = path.join(dir, 'derived');
    await touchAll(derived, ['IMG_1_thumb.webp', 'IMG_1_display.avif']);

    const scan = await scanOrphans(
      path.join(dir, '不存在'), // 读不到的基准（模拟权限 / 目录缺失）
      derived,
      ALLOWED_EXTS,
      { failLoud: true, label: 'P' },
    );

    assert.ok(scan.readError instanceof Error);
    assert.equal(scan.total, 0);
    assert.deepEqual(scan.orphans, []);
  }));

test('scanOrphans：原图目录不存在 + 不 failLoud（refs/ 层）⇒ 按空清单如实报孤儿', () =>
  withTempDir(async (dir) => {
    const derived = path.join(dir, 'derived');
    await touchAll(derived, ['ref_a_thumb.webp', 'ref_a_display.avif']);

    const scan = await scanOrphans(path.join(dir, '无 refs'), derived, REF_IMAGE_EXTS, {
      failLoud: false,
      label: 'P/refs',
    });

    assert.equal(scan.readError, null);
    assert.equal(scan.total, 2);
    assert.deepEqual(orphanNames(scan), ['ref_a_display.avif', 'ref_a_thumb.webp']);
  }));

test('scanOrphans：data 侧目录不存在 ⇒ 空结果、无 readError（点位只在原图仓）', () =>
  withTempDir(async (dir) => {
    const origin = path.join(dir, 'origin');
    await touchAll(origin, ['IMG_1.HEIC']);

    const scan = await scanOrphans(origin, path.join(dir, '无 data 目录'), ALLOWED_EXTS, {
      failLoud: true,
      label: 'P',
    });

    assert.equal(scan.readError, null);
    assert.equal(scan.total, 0);
    assert.deepEqual(scan.orphans, []);
  }));

test('decideCleanup：无异常 ⇒ 删孤儿（带 label）', () => {
  const scans = [
    {
      label: 'A',
      readError: null,
      total: 5,
      orphans: [
        { file: 'IMG_9_thumb.webp', fullPath: '/data/A/IMG_9_thumb.webp' },
        { file: 'IMG_9_display.avif', fullPath: '/data/A/IMG_9_display.avif' },
      ],
    },
    { label: 'B', readError: null, total: 4, orphans: [] },
  ];

  const { halt, deletions } = decideCleanup(scans);

  assert.equal(halt, null);
  assert.deepEqual(deletions.map((d) => d.label), ['A', 'A']);
  assert.deepEqual(deletions.map((d) => d.file), [
    'IMG_9_thumb.webp',
    'IMG_9_display.avif',
  ]);
});

test('decideCleanup：闸门一（读失败）⇒ halt=read、零删除', () => {
  const err = new Error('EACCES: permission denied');
  const scans = [
    { label: 'A', readError: err, total: 0, orphans: [] },
    {
      label: 'B',
      readError: null,
      total: 3,
      orphans: [{ file: 'x_thumb.webp', fullPath: '/data/B/x_thumb.webp' }],
    },
  ];

  const { halt, deletions } = decideCleanup(scans);

  assert.equal(halt.kind, 'read');
  assert.deepEqual(halt.points.map((p) => p.label), ['A']);
  assert.deepEqual(deletions, []);
});

test('decideCleanup：闸门二（会删空）⇒ halt=empty、零删除', () => {
  const scans = [
    {
      label: 'A',
      readError: null,
      total: 4,
      orphans: [
        { file: 'x_thumb.webp', fullPath: '/data/A/x_thumb.webp' },
        { file: 'x_display.avif', fullPath: '/data/A/x_display.avif' },
        { file: 'y_thumb.webp', fullPath: '/data/A/y_thumb.webp' },
        { file: 'y_display.avif', fullPath: '/data/A/y_display.avif' },
      ],
    },
  ];

  const { halt, deletions } = decideCleanup(scans);

  assert.equal(halt.kind, 'empty');
  assert.deepEqual(halt.points.map((p) => p.label), ['A']);
  assert.deepEqual(deletions, []);
});

test('decideCleanup：闸门优先级 —— 读失败 > 会删空', () => {
  const scans = [
    { label: '读不到', readError: new Error('EACCES'), total: 0, orphans: [] },
    {
      label: '会删空',
      readError: null,
      total: 2,
      orphans: [
        { file: 'x_thumb.webp', fullPath: '/data/会删空/x_thumb.webp' },
        { file: 'x_display.avif', fullPath: '/data/会删空/x_display.avif' },
      ],
    },
  ];

  const { halt } = decideCleanup(scans);

  assert.equal(halt.kind, 'read');
  assert.deepEqual(halt.points.map((p) => p.label), ['读不到']);
});

test('decideCleanup：没有孤儿 ⇒ 不删、不触发任何闸门', () => {
  const scans = [
    { label: 'A', readError: null, total: 4, orphans: [] },
    { label: 'B', readError: null, total: 0, orphans: [] },
  ];

  const { halt, deletions } = decideCleanup(scans);

  assert.equal(halt, null);
  assert.deepEqual(deletions, []);
});
