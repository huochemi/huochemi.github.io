/**
 * 轨迹审阅页的行为测试（不打开浏览器，用 jsdom 真跑页面内联脚本）
 *
 * 为什么必须测：这张页面的全部价值在**交互层**——"排除某几张"这件事只体现为
 * "不把它列进 plan.assignments"，而写入侧（runTrackPlan）读的就是这个列表。
 * 页面错一处（比如排除后 plan 没跟着变、或全不选仍写出全量），后果是**静默写错范围**
 * 的照片，终端照样一路 ✅。手点浏览器只能证明"这一次看起来对"，跑不了回归。
 *
 * 做法（同 ~/.workbuddy/skills/verify-browser-app-in-node 的第一层）：
 * 把注入数据的模板当真实页面加载（runScripts: 'dangerously'），然后断言 DOM 与 plan。
 * 数据是**内存构造**的合成轨迹/落点，不读原图仓、不需要高德 key（底图脚本不加载，
 * amap 保持 null，页面里所有地图分支都会早返回）。
 *
 * 运行：npm run test:cli（node 内置 runner；与 CRA 的 jest 分离，见 AGENTS.md 流程 #1）
 * 计划：docs/plans/2026-10-07-gpx-coordinate-channel.md
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// jsdom 由 react-scripts 的 jest-environment-jsdom 传递带入（package.json 未显式声明）。
// 缺了就**明确失败**并给出补法，不 skip —— skip 会把"环境没配好"伪装成"测试通过"（同
// test/gps-review-page-three-state.test.js 与 test/gps-sign.test.js 的口径）。
let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch {
  throw new Error(
    '未找到 jsdom：本测试用它在不打开浏览器的前提下真跑轨迹审阅页的内联脚本。\n' +
      '它通常由 react-scripts 的 jest-environment-jsdom 传递带入；若已被移除，' +
      '请显式声明后重跑：npm i -D jsdom',
  );
}

const TEMPLATE = path.join(__dirname, '..', 'fix-gps-track-review-template.html');
const TRACK = 'Walking 2026-10-06T112533Z.gpx';

function planEntry(seq, file, time) {
  return {
    seq,
    file,
    time,
    lat: 38.01 + seq / 1000,
    lng: 114.48 + seq / 1000,
    gcjLat: 38.011 + seq / 1000,
    gcjLng: 114.481 + seq / 1000,
    ele: 72.3,
    offsetFromStart: `${seq} 分 27 秒`,
    thumb: null,
  };
}

function makeData() {
  return {
    dir: '石家庄站',
    generatedAt: '2026-10-07 18:00:00',
    amapKey: 'TEST_KEY_FOR_UNIT_TEST',
    track: {
      file: TRACK,
      segCount: 1,
      pointCount: 3,
      distance: 210,
      reordered: false,
      startWall: '18:17:45',
      endWall: '19:12:17',
      span: '54 分 32 秒',
    },
    tz: {
      hours: 8,
      label: 'UTC+8',
      source: 'auto',
      calibratorCount: 2,
      inside: 2,
      avgResidual: 31,
    },
    trackLine: [
      [114.48, 38.01],
      [114.481, 38.011],
      [114.482, 38.012],
    ],
    plans: [
      planEntry(1, 'DSC05083.JPG', '2026-10-06T18:20:12'),
      planEntry(2, 'DSC05090.JPG', '2026-10-06T18:25:40'),
      planEntry(3, 'DSC05093.JPG', '2026-10-06T18:31:05'),
    ],
    missed: [
      {
        file: 'DSC05060.JPG',
        time: '2026-10-06T18:12:31',
        thumb: null,
        reason: '早于轨迹起点 5 分 14 秒',
      },
    ],
    anchors: [
      {
        file: 'IMG_5858.HEIC',
        time: '2026-10-06T18:18:10',
        lat: 38.0106,
        lng: 114.4847,
        gcjLat: 38.0116,
        gcjLng: 114.4857,
        thumb: null,
      },
    ],
    doneCount: 0,
  };
}

/** 用给定数据把模板当真实页面加载（返回 window） */
function build(data) {
  const tpl = fs.readFileSync(TEMPLATE, 'utf-8');
  const html = tpl.replace('var DATA = /*__DATA__*/ null;', `var DATA = ${JSON.stringify(data)};`);
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  return dom.window;
}

function plan(window) {
  return JSON.parse(window.document.getElementById('planJson').textContent);
}

/** 只触发 change（不派发 click，避免冒泡到卡片触发地图定位） */
function toggle(window, cb) {
  cb.checked = !cb.checked;
  cb.dispatchEvent(new window.Event('change', { bubbles: true }));
}

describe('轨迹审阅页：渲染', () => {
  test('落点与时间窗外分别成条，数量与数据一致', () => {
    const w = build(makeData());
    assert.equal(w.document.querySelectorAll('#grid .card').length, 3);
    assert.equal(w.document.querySelectorAll('#missedGrid .card').length, 1);
  });

  test('头部展示轨迹与"时区自动判定依据"（不是只给一个 UTC+8）', () => {
    const w = build(makeData());
    const txt = w.document.getElementById('trackLine').textContent;
    assert.ok(txt.includes(TRACK));
    assert.ok(txt.includes('UTC+8'));
    assert.ok(txt.includes('2/2 张落入窗内'));
  });

  test('落点卡片带序号与"距起点"，且 checkbox 默认全勾', () => {
    const w = build(makeData());
    const cards = w.document.querySelectorAll('#grid .card');
    assert.ok(cards[0].textContent.includes('#1'));
    const boxes = w.document.querySelectorAll('#grid input[type=checkbox]');
    assert.equal(boxes.length, 3);
    boxes.forEach((b) => assert.equal(b.checked, true));
  });

  test('时间窗外的卡片没有 checkbox（它们本就不写，没有可排除的东西）', () => {
    const w = build(makeData());
    assert.equal(w.document.querySelectorAll('#missedGrid input[type=checkbox]').length, 0);
    assert.ok(
      w.document.querySelector('#missedGrid .card').textContent.includes('早于轨迹起点'),
    );
  });
});

describe('轨迹审阅页：排除 → 计划', () => {
  test('默认计划是全集：mode=gpx + track + tz + 全部落点', () => {
    const w = build(makeData());
    const p = plan(w);
    assert.equal(p.dir, '石家庄站');
    assert.equal(p.mode, 'gpx');
    assert.equal(p.track, TRACK);
    assert.equal(p.tz, 8);
    assert.deepEqual(
      p.assignments.map((a) => a.file),
      ['DSC05083.JPG', 'DSC05090.JPG', 'DSC05093.JPG'],
    );
    assert.equal(typeof p.assignments[0].lat, 'number');
  });

  test('取消一张 = 从 assignments 里消失（其余不受影响）', () => {
    const w = build(makeData());
    const cb = w.document.querySelectorAll('#grid input[type=checkbox]')[1];
    toggle(w, cb);
    const p = plan(w);
    assert.deepEqual(
      p.assignments.map((a) => a.file),
      ['DSC05083.JPG', 'DSC05093.JPG'],
    );
    assert.ok(w.document.querySelectorAll('#grid .card')[1].className.includes('excl'));
  });

  test('全不选 → assignments 为空（页面不偷偷保留任何一张）', () => {
    const w = build(makeData());
    w.document.getElementById('noneBtn').click();
    assert.deepEqual(plan(w).assignments, []);
    const boxes = w.document.querySelectorAll('#grid input[type=checkbox]');
    boxes.forEach((b) => assert.equal(b.checked, false));
  });

  test('全不选后再全选 → 回到全集（两个按钮都不会漏掉被排除的）', () => {
    const w = build(makeData());
    w.document.getElementById('noneBtn').click();
    w.document.getElementById('allBtn').click();
    assert.equal(plan(w).assignments.length, 3);
  });

  test('统计 pill 随排除实时变化', () => {
    const w = build(makeData());
    assert.ok(w.document.getElementById('selPill').textContent.includes('将写入 3 / 3'));
    toggle(w, w.document.querySelectorAll('#grid input[type=checkbox]')[0]);
    assert.ok(w.document.getElementById('selPill').textContent.includes('将写入 2 / 3'));
  });

  test('写入命令是统一入口 --plan-stdin（两条通道共用，不带 --track）', () => {
    const w = build(makeData());
    const cmd = w.document.getElementById('planCmd').textContent;
    assert.ok(cmd.includes('--plan-stdin'));
    assert.ok(cmd.includes('npm run fix-gps -- '));
    assert.ok(!cmd.includes('--track'));
  });
});
