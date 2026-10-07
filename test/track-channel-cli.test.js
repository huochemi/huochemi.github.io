/**
 * 轨迹路命令行的契约测试：通道 flag 判定、互斥矩阵、脚本名与模板契约
 *
 * 为什么必须测：2026-10-07 把两条补坐标通道从"两个不同维度的参数"（--gpx 是来源、
 * --review 是形态）理成"来源维对称"（--anchor / --track），并规定**判定点唯一**——
 * 出现 `--track` 即轨迹路、否则锚点路。这类规则最容易在后续改名/加参数时悄悄漂掉
 * （当年 `--plan` 的移除就是这么被发现的：旧命令退化成"文件夹名不存在"）。
 * 同时锁住"npm 脚本名只是预设 flag 的快捷方式"这条契约，避免有人把脚本名实现成
 * 第二个判定点（那就是两处口径）。
 *
 * 全部纯内存断言：不读原图仓、不需要 exiftool / 高德 key（AGENTS.md S1）。
 * 运行：npm run test:cli（node 内置 runner；与 CRA 的 jest 分离，见 AGENTS.md 流程 #1）
 * 计划：docs/plans/2026-10-07-gpx-coordinate-channel.md
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseArgs } = require('../fix-gps');

describe('通道 flag：判定点唯一 = 有没有 --track', () => {
  test('--track 命中轨迹路；--anchor 与"什么都不写"都是锚点路', () => {
    const t = parseArgs(['石家庄站', '--track']);
    assert.equal(t.track, true);
    assert.equal(t.anchor, false);

    const a = parseArgs(['石家庄站', '--anchor']);
    assert.equal(a.track, false);
    assert.equal(a.anchor, true);

    const d = parseArgs(['石家庄站']);
    assert.equal(d.track, false);
    assert.equal(d.anchor, false);
  });

  test('--review 两条路都能用：无 --track = 分组页；有 --track = 轨迹审阅页', () => {
    const anchorPage = parseArgs(['x', '--review']);
    assert.equal(anchorPage.review, true);
    assert.equal(anchorPage.track, false);

    const trackPage = parseArgs(['x', '--track', '--review']);
    assert.equal(trackPage.review, true);
    assert.equal(trackPage.track, true);
  });

  test('--track --tz 合法；--tz 单独出现报错（只在轨迹路有意义）', () => {
    assert.equal(parseArgs(['x', '--track', '--tz', '+8']).tz, 8);
    assert.equal(parseArgs(['x', '--track', '--tz', '+5:30']).tz, 5.5);
    assert.throws(() => parseArgs(['x', '--tz', '+8']), /--tz 只在 --track/);
    assert.throws(() => parseArgs(['x', '--anchor', '--tz', '+8']), /--tz 只在 --track/);
  });

  test('--anchor 与 --track 互斥', () => {
    assert.throws(() => parseArgs(['x', '--anchor', '--track']), /不能同时使用/);
  });

  test('--track 不能与锚点路形态参数并用', () => {
    assert.throws(
      () => parseArgs(['x', '--track', '--all', '--ref', 'a.JPG']),
      /--track 不能与/,
    );
    assert.throws(
      () => parseArgs(['x', '--track', '--target', 'a.JPG']),
      /--track 不能与/,
    );
    assert.throws(() => parseArgs(['x', '--track', '--ref', 'a.JPG']), /--track 不能与/);
  });

  test('--plan-stdin 的通道由计划自带 mode 判定，不与 --anchor / --track 并用', () => {
    assert.equal(parseArgs(['x', '--plan-stdin']).planStdin, true);
    assert.throws(() => parseArgs(['x', '--plan-stdin', '--track']), /mode 字段/);
    assert.throws(() => parseArgs(['x', '--plan-stdin', '--anchor']), /mode 字段/);
  });

  test('--review 不能与 --plan-stdin 并用（两种流程不能混）', () => {
    assert.throws(
      () => parseArgs(['x', '--review', '--plan-stdin']),
      /--review 不能与/,
    );
  });

  test('--gpx 旧名给出迁移指引（含新名 --track 与"mode=gpx 不变"），不退化成"文件夹不存在"', () => {
    assert.throws(
      () => parseArgs(['x', '--gpx']),
      (err) =>
        err.message.includes('--track') &&
        err.message.includes('mode=gpx'),
    );
  });

  test('缺文件夹时 --track / --review / --plan-stdin 各自报错', () => {
    assert.throws(() => parseArgs(['--track']), /--track 需要/);
    assert.throws(() => parseArgs(['--review']), /--review 需要/);
    assert.throws(() => parseArgs(['--plan-stdin']), /--plan-stdin 需要/);
  });

  test('--yes 只在能走非交互写入的模式下成立（轨迹路算一种）', () => {
    assert.equal(parseArgs(['x', '--track', '--yes']).yes, true);
    assert.throws(() => parseArgs(['x', '--yes']), /--yes 只能在/);
  });
});

describe('契约：npm 脚本名 = 预设 flag 的快捷方式（不是第二处判定点）', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'),
  );

  test('fix-gps:anchor / fix-gps:track 各自预设对应 flag', () => {
    assert.match(pkg.scripts['fix-gps:anchor'], /^node fix-gps\.js --anchor$/);
    assert.match(pkg.scripts['fix-gps:track'], /^node fix-gps\.js --track$/);
  });

  test('fix-gps 通用入口保留（零迁移：旧命令照常跑）', () => {
    assert.equal(pkg.scripts['fix-gps'], 'node fix-gps.js');
  });
});

describe('契约：轨迹审阅页模板', () => {
  const tpl = fs.readFileSync(
    path.join(__dirname, '..', 'fix-gps-track-review-template.html'),
    'utf-8',
  );

  test('有数据注入点（与 fix-gps.js 的 replace 目标逐字一致）', () => {
    assert.ok(tpl.includes('var DATA = /*__DATA__*/ null;'));
  });

  test('画轨迹折线用 AMap.Polyline——只画点看不出绑错，线才是参照', () => {
    assert.ok(tpl.includes('AMap.Polyline'));
  });

  test('计划带 mode/track/tz/assignments 四件套（与 runTrackPlan 的读取口径一致）', () => {
    assert.ok(tpl.includes("mode: 'gpx'"));
    assert.ok(tpl.includes('track: DATA.track.file'));
    assert.ok(tpl.includes('tz: DATA.tz.hours'));
    assert.ok(tpl.includes('assignments:'));
  });

  test('写入命令走统一入口 --plan-stdin（与锚点页同一行命令形态）', () => {
    assert.ok(tpl.includes('--plan-stdin'));
    assert.ok(tpl.includes('npm run fix-gps -- '));
  });

  test('排除 = 不进 assignments（页面上不引入"排除名单"这第二套语义）', () => {
    assert.ok(tpl.includes('selected[p.file]'));
    assert.ok(!tpl.includes('excludeList'));
    assert.ok(!tpl.includes('excluded:'));
  });
});
