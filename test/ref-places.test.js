/**
 * 参考点位（"想去、还没去过"的点位）单测
 *
 * 为什么必须测：参考点位走了**三条既有的硬判定**（管线预检的顺序、"只在 data 仓
 * 存在"的整轮报错、new-place 的"绝不覆盖人工内容"），本功能对每一条都开了显式
 * 例外。例外最容易在后续改动里被写宽——写宽了不会报错，只会静默放行（防漏拷的
 * 闸门失效、人工内容被覆盖）。所以边界必须由测试锁住。
 *
 * 全部用临时目录 + 纯函数：不读原图仓、不需要 exiftool / 高德 key（AGENTS.md S1）。
 * 运行：npm run test:cli（node 内置 runner，与 CRA 的 jest 分离，见 AGENTS.md 流程 #1）
 * 计划：docs/plans/2026-10-07-ref-places.md
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  isRefPlace,
  preflightRefPlace,
  buildRefGroup,
  REFS_SUBDIR,
  REF_POINT_FILE,
  REF_IMAGE_EXTS,
  PIN_KIND_PHOTO,
  PIN_KIND_REF,
} = require('../process-photos');
const {
  parseArgs,
  parseCoord,
  assertPlainName,
  tryUpgradeRefPlace,
} = require('../new-place');

/** 建一个临时点位目录，返回其路径；内容由 files 指定（相对路径 → 内容字符串） */
function makePlaceDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hcm-ref-place-'));
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf-8');
  }
  return dir;
}

/** 合法参考态的目录内容（可覆盖任意文件） */
const VALID_REF_FILES = {
  'index.json': JSON.stringify({ description: '衡阳市-湘江公铁大桥道口' }),
  [`${REFS_SUBDIR}/${REF_POINT_FILE}`]: JSON.stringify({
    lng: 112.6,
    lat: 26.8,
  }),
  [`${REFS_SUBDIR}/01.jpg`]: 'fake-jpeg-bytes',
  [`${REFS_SUBDIR}/02.jpg`]: 'fake-jpeg-bytes',
};

describe('isRefPlace：放行判据必须显式（防"无条件放行"退化）', () => {
  test('合法参考态：无 index_photo + refs/point.json 坐标是数字 ⇒ 放行', async () => {
    const dir = makePlaceDir(VALID_REF_FILES);
    assert.equal(await isRefPlace(dir), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('有 index_photo ⇒ 实拍态，必须回到原报错（防搬家漏拷的闸门）', async () => {
    const dir = makePlaceDir({
      ...VALID_REF_FILES,
      'index.json': JSON.stringify({
        index_photo: 'IMG_0001.JPG',
        description: '某点位',
      }),
    });
    assert.equal(await isRefPlace(dir), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('缺 refs/point.json ⇒ 不放行', async () => {
    const dir = makePlaceDir({
      'index.json': JSON.stringify({ description: '某点位' }),
      [`${REFS_SUBDIR}/01.jpg`]: 'x',
    });
    assert.equal(await isRefPlace(dir), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('坐标写成字符串 ⇒ 不放行（不做隐式转换）', async () => {
    const dir = makePlaceDir({
      ...VALID_REF_FILES,
      [`${REFS_SUBDIR}/${REF_POINT_FILE}`]: JSON.stringify({
        lng: '112.6',
        lat: '26.8',
      }),
    });
    assert.equal(await isRefPlace(dir), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('目录/文件不存在（含 index.json 是坏 JSON）⇒ 一律不放行', async () => {
    assert.equal(await isRefPlace('/nonexistent/path/xxx'), false);
    const broken = makePlaceDir({ 'index.json': '{ 不是合法 JSON' });
    assert.equal(await isRefPlace(broken), false);
    fs.rmSync(broken, { recursive: true, force: true });
  });

  test('有参考图但坐标合法、且 index_photo 缺席 ⇒ 仍放行（图的有无由预检判定）', async () => {
    const dir = makePlaceDir({
      'index.json': JSON.stringify({ description: '某点位' }),
      [`${REFS_SUBDIR}/${REF_POINT_FILE}`]: JSON.stringify({
        lng: 112.6,
        lat: 26.8,
      }),
    });
    assert.equal(await isRefPlace(dir), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('preflightRefPlace：失败必须自足（报错 + 下一步命令）', () => {
  test('合法参考态：返回 refImages（字典序）且 images 为空数组', async () => {
    const dir = makePlaceDir(VALID_REF_FILES);
    const result = await preflightRefPlace('衡阳-测试', dir, {
      description: '衡阳市-湘江公铁大桥道口',
    });
    assert.equal(result.reason, undefined);
    assert.deepEqual(result.refImages, ['01.jpg', '02.jpg']);
    assert.deepEqual(result.images, []);
    assert.deepEqual(result.point, { lng: 112.6, lat: 26.8 });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('缺 description ⇒ 与实拍态同一条报错文案', async () => {
    const dir = makePlaceDir(VALID_REF_FILES);
    const result = await preflightRefPlace('x', dir, {});
    assert.match(result.reason, /缺少 "description"/);
    assert.match(result.hint, /npm run photos/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('缺 refs/point.json ⇒ 报错并给出坐标文件位置与 GCJ02 口径', async () => {
    const dir = makePlaceDir({
      'index.json': JSON.stringify({ description: '某点位' }),
      [`${REFS_SUBDIR}/01.jpg`]: 'x',
    });
    const result = await preflightRefPlace('x', dir, { description: '某点位' });
    assert.match(result.reason, /point\.json/);
    assert.match(result.hint, /GCJ02/);
    assert.match(result.hint, /new-place/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('坐标不是数字 ⇒ 明说"必须是数字"且不猜', async () => {
    const dir = makePlaceDir({
      ...VALID_REF_FILES,
      [`${REFS_SUBDIR}/${REF_POINT_FILE}`]: JSON.stringify({
        lng: '112.6',
        lat: 26.8,
      }),
    });
    const result = await preflightRefPlace('x', dir, { description: '某点位' });
    assert.match(result.reason, /必须是数字/);
    assert.match(result.hint, /不要写成字符串/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('refs/ 里只有 point.json （0 张图）⇒ 报错：point.json 不算图', async () => {
    const dir = makePlaceDir({
      'index.json': JSON.stringify({ description: '某点位' }),
      [`${REFS_SUBDIR}/${REF_POINT_FILE}`]: JSON.stringify({
        lng: 112.6,
        lat: 26.8,
      }),
    });
    const result = await preflightRefPlace('x', dir, { description: '某点位' });
    assert.match(result.reason, /没有图片文件/);
    assert.match(result.hint, /sips -Z/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('非图片文件（.txt / 派生后缀）不计入参考图', async () => {
    const dir = makePlaceDir({
      ...VALID_REF_FILES,
      [`${REFS_SUBDIR}/notes.txt`]: 'x',
      [`${REFS_SUBDIR}/01_thumb.webp`]: 'x',
    });
    const result = await preflightRefPlace('x', dir, { description: '某点位' });
    assert.deepEqual(result.refImages, ['01.jpg', '02.jpg']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('buildRefGroup：与实拍点位同构（前端全量复用的前提）', () => {
  const group = buildRefGroup({
    dirName: '衡阳市-湘江公铁大桥道口',
    indexConfig: {
      description: '衡阳市-湘江公铁大桥（道口）',
      references: [{ kind: 'video', label: '参考视频', url: 'https://e.com/v' }],
    },
    point: { lng: 112.6, lat: 26.8 },
    refImages: ['01.jpg', '02.jpg'],
  });

  test('字段与实拍态同名同形，外加 pinKind = ref', () => {
    for (const key of [
      'lat',
      'lng',
      'thumbnailLink',
      'displayLink',
      'fileName',
      'dirName',
      'description',
      'references',
      'photos',
    ]) {
      assert.ok(key in group, `缺少字段 ${key}`);
    }
    assert.equal(group.pinKind, PIN_KIND_REF);
    assert.notEqual(PIN_KIND_PHOTO, PIN_KIND_REF);
  });

  test('组级坐标 = 人工标注的点位坐标（GCJ02 原样透传，不换算）', () => {
    assert.equal(group.lat, 26.8);
    assert.equal(group.lng, 112.6);
  });

  test('每张参考图共享同一个点位坐标，且链接带 refs/ 前缀（与照片同一套拼法）', () => {
    assert.equal(group.photos.length, 2);
    for (const photo of group.photos) {
      assert.equal(photo.lat, 26.8);
      assert.equal(photo.lng, 112.6);
      assert.match(photo.fileName, /^refs\//);
      assert.equal(photo.thumbnailLink, photo.displayLink);
      assert.ok(photo.thumbnailLink.includes('/refs/'));
    }
    assert.equal(
      group.photos[0].thumbnailLink,
      '/data/photos/衡阳市-湘江公铁大桥道口/refs/01.jpg',
    );
  });

  test('封面 = 字典序第一张（01.jpg 就是地图上显示的那张）', () => {
    assert.equal(group.fileName, 'refs/01.jpg');
    assert.equal(group.thumbnailLink, group.photos[0].thumbnailLink);
  });

  test('参考图不写 takenAt / device / geoSource（没有的字段不编）', () => {
    for (const photo of group.photos) {
      assert.equal(photo.takenAt, undefined);
      assert.equal(photo.device, undefined);
      assert.equal(photo.geoSource, undefined);
    }
    assert.equal(group.takenAt, undefined);
  });

  test('references 缺省时整个字段不出现（与实拍态同一口径）', () => {
    const bare = buildRefGroup({
      dirName: 'x',
      indexConfig: { description: 'x' },
      point: { lng: 1, lat: 2 },
      refImages: ['01.jpg'],
    });
    assert.equal('references' in bare, false);
  });
});

describe('new-place：参考态参数与切档的受控例外', () => {
  test('--wish --coord 解析出参考态意图', () => {
    const args = parseArgs(['衡阳市-测试', '--wish', '--coord', '112.6,26.8']);
    assert.equal(args.place, '衡阳市-测试');
    assert.equal(args.wish, true);
    assert.equal(args.coord, '112.6,26.8');
    assert.equal(args.cover, undefined);
  });

  test('--cover 仍是实拍态形态（wish 默认 false）', () => {
    const args = parseArgs(['某点位', '--cover', 'IMG_1.JPG']);
    assert.equal(args.wish, false);
    assert.equal(args.cover, 'IMG_1.JPG');
  });

  test('未知参数即报错（不吞成位置参数）', () => {
    assert.throws(() => parseArgs(['x', '--wishh']), /未知参数/);
    assert.throws(() => parseArgs(['x', '--wish', '--coord']), /缺少值/);
  });

  test('--coord 只认"两个数字"', () => {
    assert.deepEqual(parseCoord('112.6,26.8'), { lng: 112.6, lat: 26.8 });
    assert.deepEqual(parseCoord(' 112.6 , 26.8 '), { lng: 112.6, lat: 26.8 });
    assert.throws(() => parseCoord('112.6'), /格式不对/);
    assert.throws(() => parseCoord('112.6,26.8,1'), /格式不对/);
    assert.throws(() => parseCoord('东经112,北纬26'), /必须是两个数字/);
    assert.throws(() => parseCoord('200,26'), /超出合法范围/);
    assert.throws(() => parseCoord(',26.8'), /格式不对/);
  });

  test('点位名防路径穿越（参考态同样适用）', () => {
    assert.throws(() => assertPlainName('../evil', '点位名'), /不合法/);
    assert.throws(() => assertPlainName('a/b', '点位名'), /不合法/);
    assert.doesNotThrow(() => assertPlainName('衡阳市-湘江公铁大桥道口', '点位名'));
  });

  test('切档：参考态目录 ⇒ 只新增 index_photo，其余键原样保留', async () => {
    const dir = makePlaceDir({
      'index.json': JSON.stringify({
        description: '衡阳市-湘江公铁大桥道口',
        references: [{ kind: 'video', label: '参考视频', url: 'https://e.com/v' }],
      }),
      [`${REFS_SUBDIR}/${REF_POINT_FILE}`]: JSON.stringify({
        lng: 112.6,
        lat: 26.8,
      }),
      [`${REFS_SUBDIR}/01.jpg`]: 'x',
    });
    const ok = await tryUpgradeRefPlace('衡阳-测试', dir, 'IMG_0001.HEIC');
    assert.equal(ok, true);

    const after = JSON.parse(
      fs.readFileSync(path.join(dir, 'index.json'), 'utf-8'),
    );
    assert.equal(after.index_photo, 'IMG_0001.HEIC');
    assert.equal(after.description, '衡阳市-湘江公铁大桥道口');
    assert.deepEqual(after.references, [
      { kind: 'video', label: '参考视频', url: 'https://e.com/v' },
    ]);
    assert.deepEqual(Object.keys(after).sort(), [
      'description',
      'index_photo',
      'references',
    ]);
    // refs/ 一字不动（收尾由用户自己做，脚本不删任何文件）
    assert.ok(fs.existsSync(path.join(dir, REFS_SUBDIR, '01.jpg')));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('切档：已是实拍态（有 index_photo）⇒ 返回 false 且不写任何文件', async () => {
    const dir = makePlaceDir({
      'index.json': JSON.stringify({
        index_photo: 'OLD.JPG',
        description: '某点位',
      }),
    });
    const before = fs.readFileSync(path.join(dir, 'index.json'), 'utf-8');
    const ok = await tryUpgradeRefPlace('x', dir, 'NEW.JPG');
    assert.equal(ok, false);
    assert.equal(fs.readFileSync(path.join(dir, 'index.json'), 'utf-8'), before);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('切档：缺 refs/point.json ⇒ 返回 false（防"例外被写宽"）', async () => {
    const dir = makePlaceDir({
      'index.json': JSON.stringify({ description: '某点位' }),
    });
    const before = fs.readFileSync(path.join(dir, 'index.json'), 'utf-8');
    const ok = await tryUpgradeRefPlace('x', dir, 'NEW.JPG');
    assert.equal(ok, false);
    assert.equal(fs.readFileSync(path.join(dir, 'index.json'), 'utf-8'), before);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('切档：坐标是字符串 ⇒ 返回 false（判定口径与管线一致）', async () => {
    const dir = makePlaceDir({
      'index.json': JSON.stringify({ description: '某点位' }),
      [`${REFS_SUBDIR}/${REF_POINT_FILE}`]: JSON.stringify({
        lng: '112.6',
        lat: '26.8',
      }),
    });
    assert.equal(await tryUpgradeRefPlace('x', dir, 'NEW.JPG'), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('跨文件契约：参考态的目录名与文件名两边必须同值', () => {
  const newPlace = require('../new-place');

  test('REFS_SUBDIR / REF_POINT_FILE 与管线同值（两边各存副本，刻意不抽共享模块）', () => {
    assert.equal(newPlace.REFS_SUBDIR, REFS_SUBDIR);
    assert.equal(newPlace.REF_POINT_FILE, REF_POINT_FILE);
  });

  test('参考图白名单含 jpg（格式纪律），且不含 json', () => {
    assert.ok(REF_IMAGE_EXTS.has('.jpg'));
    assert.ok(REF_IMAGE_EXTS.has('.jpeg'));
    assert.ok(!REF_IMAGE_EXTS.has('.json'));
  });

  test('参考图那两条 .gitignore 放行规则写在 data 仓（本仓无法断言，只锁路径形态）', () => {
    // data 仓不在本仓 git 里，此处只锁"链接拼法"：BASE_URL/<dirName>/refs/<file>
    const group = buildRefGroup({
      dirName: 'd',
      indexConfig: { description: 'd' },
      point: { lng: 1, lat: 2 },
      refImages: ['01.jpg'],
    });
    assert.match(group.thumbnailLink, /^\/data\/photos\/d\/refs\/01\.jpg$/);
  });
});
