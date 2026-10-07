/**
 * 审阅页"三态"渲染的行为测试（不打开浏览器，用 jsdom 真跑页面内联脚本）
 *
 * 为什么必须测：三态（anchor / target / done）的存在意义就是**done 照片既不作参照、
 * 也不进待办**——否则另一条补坐标通道（GPX）刚写完的照片会被当成锚点，分组结果取决于
 * 先跑了哪条通道（这正是 2026-10-07 决策要根治的污染）。这条约束完全落在页面的
 * 交互层（不发改投控件、点不开对照、不进 plan JSON），只有真跑一遍才能确认没有漏口。
 * 手点浏览器只能验证"这一次看起来对"，跑不了回归。
 *
 * 做法（同 ~/.workbuddy/skills/verify-browser-app-in-node 的第一层）：
 * 把注入数据的模板当真实页面加载（runScripts: 'dangerously'），然后断言 DOM 与交互。
 * 数据是**内存构造**的合成三态，不读原图仓、不需要高德 key（底图脚本不加载）。
 *
 * 运行：npm run test:cli（node 内置 runner；与 CRA 的 jest 分离，见 AGENTS.md 流程 #1）
 * 计划：docs/plans/2026-10-07-gpx-coordinate-channel.md
 */

const { describe, test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// jsdom 由 react-scripts 的 jest-environment-jsdom 传递带入（package.json 未显式声明）。
// 缺了就**明确失败**并给出补法，不 skip —— skip 会把"环境没配好"伪装成"测试通过"（同
// test/gps-sign.test.js 对 exiftool 的口径）。
let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch {
  throw new Error(
    '未找到 jsdom：本测试用它在不打开浏览器的前提下真跑审阅页的内联脚本。\n' +
      '它通常由 react-scripts 的 jest-environment-jsdom 传递带入；若已被移除，' +
      '请显式声明后重跑：npm i -D jsdom',
  );
}

const TEMPLATE = path.join(__dirname, '..', 'fix-gps-review-template.html');

/** 合成一张照片条目（字段与 fix-gps.js 注入 DATA.photos 的形状一致） */
function photo(file, time, kind, extra = {}) {
  const hasGeo = kind !== 'target';
  return {
    file,
    time,
    ts: time,
    kind,
    lat: hasGeo ? 38.008411 : null,
    lng: hasGeo ? 114.478408 : null,
    geoSource: null,
    thumb: null,
    ...extra,
  };
}

const ANCHOR = {
  ...photo('IMG_5858.HEIC', '2026-10-06T18:08:15', 'anchor'),
  members: ['IMG_5858.HEIC'],
  gcjLat: 38.0106,
  gcjLng: 114.4847,
};

const DATA = {
  dir: '石家庄站',
  generatedAt: '2026-10-07 15:30:00',
  anchorDistance: null,
  amapKey: 'TEST_KEY_FOR_UNIT_TEST',
  anchors: [ANCHOR],
  photos: [
    ANCHOR,
    photo('DSC05060.JPG', '2026-10-06T18:12:31', 'target'),
    // done 的两种形态：轨迹补的（有 mode=gpx 溯源）与 2026-10-03 之前补的（无标记）
    photo('DSC05083.JPG', '2026-10-06T18:25:31', 'done', {
      geoSource: 'Walking 2026-10-06T112533Z.gpx',
    }),
    photo('DSC04376.JPG', '2026-10-06T18:30:00', 'done'),
  ],
};

/** 注入数据 → 建 DOM（脚本自动执行，等价于 fix-gps 生成的那份 HTML） */
function renderPage() {
  const template = fs.readFileSync(TEMPLATE, 'utf-8');
  assert.ok(
    template.includes('/*__DATA__*/ null'),
    '模板里的数据注入占位符必须存在（fix-gps.js 用字符串替换注入）',
  );
  const html = template.replace('/*__DATA__*/ null', JSON.stringify(DATA));
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  return dom.window;
}

const click = (win, el) =>
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

describe('审阅页三态：done 只读、target 可改投、anchor 可作参照', () => {
  let win;

  before(() => {
    win = renderPage();
  });

  test('模板结构锁：done 的灰化样式与只读判据都在', () => {
    const src = fs.readFileSync(TEMPLATE, 'utf-8');
    assert.ok(src.includes('.tcard.done'), '缺少胶片条 done 的样式');
    assert.ok(src.includes('.card.done'), '缺少网格卡片 done 的样式');
    assert.ok(
      src.includes("if (p.kind === 'done') return;"),
      'openOverlay 必须对 done 提前返回（不能打开对照弹窗）',
    );
  });

  test('四张照片都渲染出来，其中两张带 done 灰条', () => {
    assert.equal(win.document.querySelectorAll('.tcard').length, 4);
    assert.equal(win.document.querySelectorAll('.tcard.done').length, 2);
    assert.equal(win.document.querySelectorAll('.card.done').length, 2);
  });

  test('done 卡片标出"已有坐标"，且标出坐标来源（无标记的说明是历史遗留）', () => {
    const cards = [...win.document.querySelectorAll('.card.done')];
    const byFile = new Map(cards.map((c) => [c.querySelector('.name').textContent, c.textContent]));
    assert.match(byFile.get('DSC05083.JPG'), /已有坐标/);
    assert.match(byFile.get('DSC05083.JPG'), /Walking 2026-10-06T112533Z\.gpx/);
    assert.match(byFile.get('DSC04376.JPG'), /无溯源标记/);
  });

  test('点 done 卡片不打开对照弹窗（无任何交互控件）', () => {
    const overlay = win.document.getElementById('overlay');
    assert.equal(overlay.hidden, true, '初始应为隐藏');
    const doneCard = [...win.document.querySelectorAll('.card.done')].find(
      (c) => c.querySelector('.name').textContent === 'DSC05083.JPG',
    );
    click(win, doneCard.querySelector('.thumb'));
    click(win, doneCard);
    assert.equal(overlay.hidden, true, 'done 卡片不应响应点击');
  });

  test('done 不参与分组：统计里单列一行，且不出现在 plan JSON 的 targets 里', () => {
    assert.match(win.document.getElementById('stats').textContent, /2 张已带坐标/);

    const plan = JSON.parse(win.document.getElementById('planJson').textContent);
    assert.equal(plan.dir, '石家庄站');
    assert.equal(plan.groups.length, 1);
    assert.equal(plan.groups[0].ref, 'IMG_5858.HEIC');
    assert.deepEqual(
      plan.groups[0].targets,
      ['DSC05060.JPG'],
      'plan 的 targets 只能有待补照片 —— done 与锚点都不能进去',
    );
  });

  test('对照弹窗的照片池排除 done（翻页时不会翻到只读历史条）', () => {
    const overlay = win.document.getElementById('overlay');
    const anchorCard = win.document.querySelector('.tcard.anchor');
    click(win, anchorCard);
    assert.equal(overlay.hidden, false);
    assert.equal(
      win.document.getElementById('counter').textContent,
      '1 / 2　IMG_5858.HEIC',
      '池 = 锚点 + 待补（2 张），done 两张不参与',
    );
    click(win, win.document.getElementById('close'));
  });

  test('target 仍可正常改投：点开弹窗后按归属键写进 plan', () => {
    const overlay = win.document.getElementById('overlay');
    const targetCard = [...win.document.querySelectorAll('.card')].find(
      (c) => c.querySelector('.name').textContent === 'DSC05060.JPG',
    );
    click(win, targetCard.querySelector('.thumb'));
    assert.equal(overlay.hidden, false);
    assert.match(
      win.document.getElementById('ovTargetMeta').textContent,
      /待补坐标/,
      '待补照片的弹窗应说明它将采用哪个位置的坐标',
    );
    click(win, win.document.getElementById('close'));

    const plan = JSON.parse(win.document.getElementById('planJson').textContent);
    assert.deepEqual(plan.groups[0].targets, ['DSC05060.JPG']);
  });

  test('密度条：done 用灰柱且更虚（fill-opacity 0.35）', () => {
    const bars = [...win.document.querySelectorAll('#density rect')];
    const grey = bars.filter((b) => b.getAttribute('fill') === '#6b6b6b');
    assert.equal(grey.length, 2, '两张 done 应是灰柱');
    for (const b of grey) {
      assert.equal(b.getAttribute('fill-opacity'), '0.35');
    }
    const colored = bars.filter((b) => b.getAttribute('fill') !== '#6b6b6b');
    assert.equal(colored.length, 2, '锚点与待补各一根组色柱');
  });
});
