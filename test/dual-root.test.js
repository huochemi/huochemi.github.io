/**
 * 双根管线契约单测（形态 B：原图仓 / data 仓分离）
 *
 * 三个 CLI（process-photos.js / fix-gps.js / delete-photo.js）刻意不抽共享模块，
 * 各自在文件顶部声明一对同值常量：
 *   - ORIGIN_DIR：原图仓 `../photos-originals/photos`（真相源、不可再生）
 *   - IMGS_DIR  ：data 仓 `../data/photos`（派生图发布 + index.json）
 * 口径漂移的后果：某个 CLI 把原图根写错 → 扫描不到原图 / EXIF 回写落到派生仓 /
 * delete-photo 删错一侧。这里用源码正则解析（不 require，避免触发 CLI 顶层副作用）
 * 把三个文件的一致性锁住。
 *
 * 运行：npm run test:cli（node 内置 runner；与 CRA 的 jest 分离，见 AGENTS.md 流程 #1）
 * 计划：docs/plans/2026-10-04-data-repo-longevity.md
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const CLI_FILES = ['process-photos.js', 'fix-gps.js', 'delete-photo.js'];

/** 解析 `const <name> = path.join(__dirname, '<rel>')` 里的相对路径字面量 */
function resolveRootFromSource(source, name, label) {
  const match = source.match(
    new RegExp(`const\\s+${name}\\s*=\\s*path\\.join\\(__dirname,\\s*'([^']+)'\\)`),
  );
  assert.ok(match, `${label} 应能定位到 ${name} 声明`);
  return match[1];
}

test('契约：三个 CLI 的 ORIGIN_DIR / IMGS_DIR 相对路径完全一致', () => {
  const expected = { ORIGIN_DIR: null, IMGS_DIR: null };

  for (const file of CLI_FILES) {
    const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
    const origin = resolveRootFromSource(source, 'ORIGIN_DIR', file);
    const imgs = resolveRootFromSource(source, 'IMGS_DIR', file);

    if (expected.ORIGIN_DIR === null) {
      expected.ORIGIN_DIR = origin;
      expected.IMGS_DIR = imgs;
    }
    assert.equal(origin, expected.ORIGIN_DIR, `${file} 的 ORIGIN_DIR 与契约不一致`);
    assert.equal(imgs, expected.IMGS_DIR, `${file} 的 IMGS_DIR 与契约不一致`);
  }
});

test('契约：两个根指向约定目录（原图仓 / data 仓）', () => {
  const source = fs.readFileSync(
    path.join(REPO_ROOT, 'process-photos.js'),
    'utf8',
  );
  assert.equal(
    resolveRootFromSource(source, 'ORIGIN_DIR', 'process-photos.js'),
    '../photos-originals/photos',
  );
  assert.equal(
    resolveRootFromSource(source, 'IMGS_DIR', 'process-photos.js'),
    '../data/photos',
  );
});
