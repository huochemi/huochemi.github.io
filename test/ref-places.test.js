/**
 * 参考点位（"想去、还没去过"的点位）单测
 *
 * 为什么必须测：参考点位走了**三条既有的硬判定**（管线预检的顺序、"只在 data 仓
 * 存在"的整轮报错、new-place 的"绝不覆盖人工内容"），本功能对每一条都开了显式
 * 例外。例外最容易在后续改动里被写宽——写宽了不会报错，只会静默放行（防漏拷的
 * 闸门失效、人工内容被覆盖）。所以边界必须由测试锁住。
 *
 * 参考图并回主管线后（2026-10-07，见 docs/plans/2026-10-07-ref-image-pipeline.md）：
 * 源图在**原图仓** refs/、派生图由管线写进 **data 仓** refs/ ⇒ preflightRefPlace 收
 * **两个**目录参数（data 仓 / 原图仓）、buildRefGroup 是 async 且**真的会压图**，
 * 故本文件需要一张**真实**的小图（PNG，字节最短且 sharp 原生可读）。
 *
 * 全部用临时目录 + 纯函数：不读真原图仓、不需要 exiftool / 高德 key（AGENTS.md S1）。
 * 运行：npm run test:cli（node 内置 runner，与 CRA 的 jest 分离，见 AGENTS.md 流程 #1）
 * 计划：docs/plans/2026-10-07-ref-places.md、2026-10-07-ref-image-pipeline.md
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
  DERIVED_SUFFIXES,
  PIN_KIND_PHOTO,
  PIN_KIND_REF,
} = require('../process-photos');
const {
  parseArgs,
  parseCoord,
  assertPlainName,
  tryUpgradeRefPlace,
} = require('../new-place');

// 派生后缀（本文件用到的两个）——与 process-photos 的同值断言见「跨文件契约」
const THUMB_SUFFIX = '_thumb.webp';
const DISPLAY_SUFFIX = '_display.avif';

// 1x1 透明 PNG：最短的真实图片，供 buildRefGroup 真的跑一遍 sharp
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** 建一个临时目录（内容留空，供分别扮演 data 仓 / 原图仓） */
function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hcm-ref-place-'));
}

/** 往目录里写文件：files 是 { 相对路径: 内容 }（内容可为 string 或 Buffer） */
function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
}

/** 建一个目录并写入内容（一步到位） */
function makeDir(files) {
  return writeFiles(makeTempDir(), files);
}

/** 清理临时目录（不抛错） */
function rm(...dirs) {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * 造一对"合法参考态"的目录：
 *   - data 仓：index.json（description）+ refs/point.json（坐标，可带 cover）
 *   - 原图仓：refs/<源图>（内容用假字节即可，预检不读图内容）
 */
function makeValidRefPair({ point, images = ['01.jpg', '02.jpg'] } = {}) {
  const dataDir = makeDir({
    'index.json': JSON.stringify({ description: '衡阳市-湘江公铁大桥道口' }),
    [`${REFS_SUBDIR}/${REF_POINT_FILE}`]: JSON.stringify(
      point ?? { lng: 112.6, lat: 26.8 },
    ),
  });
  const originDir = makeDir(
    Object.fromEntries(
      images.map((file) => [`${REFS_SUBDIR}/${file}`, 'fake-jpeg-bytes']),
    ),
  );
  return { dataDir, originDir };
}

/** isRefPlace 视角的合法 data 仓目录内容 */
const VALID_REF_FILES = {
  'index.json': JSON.stringify({ description: '衡阳市-湘江公铁大桥道口' }),
  [`${REFS_SUBDIR}/${REF_POINT_FILE}`]: JSON.stringify({
    lng: 112.6,
    lat: 26.8,
  }),
  [`${REFS_SUBDIR}/01.jpg`]: 'fake-jpeg-bytes',
};

describe('isRefPlace：放行判据必须显式（防"无条件放行"退化）', () => {
  test('合法参考态：无 index_photo + refs/point.json 坐标是数字 ⇒ 放行', async () => {
    const dir = makeDir(VALID_REF_FILES);
    assert.equal(await isRefPlace(dir), true);
    rm(dir);
  });

  test('有 index_photo ⇒ 实拍态，必须回到原报错（防搬家漏拷的闸门）', async () => {
    const dir = makeDir({
      ...VALID_REF_FILES,
      'index.json': JSON.stringify({
        index_photo: 'IMG_0001.JPG',
        description: '某点位',
      }),
    });
    assert.equal(await isRefPlace(dir), false);
    rm(dir);
  });

  test('缺 refs/point.json ⇒ 不放行', async () => {
    const dir = makeDir({
      'index.json': JSON.stringify({ description: '某点位' }),
      [`${REFS_SUBDIR}/01.jpg`]: 'x',
    });
    assert.equal(await isRefPlace(dir), false);
    rm(dir);
  });

  test('坐标写成字符串 ⇒ 不放行（不做隐式转换）', async () => {
    const dir = makeDir({
      ...VALID_REF_FILES,
      [`${REFS_SUBDIR}/${REF_POINT_FILE}`]: JSON.stringify({
        lng: '112.6',
        lat: '26.8',
      }),
    });
    assert.equal(await isRefPlace(dir), false);
    rm(dir);
  });

  test('目录/文件不存在（含 index.json 是坏 JSON）⇒ 一律不放行', async () => {
    assert.equal(await isRefPlace('/nonexistent/path/xxx'), false);
    const broken = makeDir({ 'index.json': '{ 不是合法 JSON' });
    assert.equal(await isRefPlace(broken), false);
    rm(broken);
  });

  test('有参考图但坐标合法、且 index_photo 缺席 ⇒ 仍放行（图的有无由预检判定）', async () => {
    const dir = makeDir({
      'index.json': JSON.stringify({ description: '某点位' }),
      [`${REFS_SUBDIR}/${REF_POINT_FILE}`]: JSON.stringify({
        lng: 112.6,
        lat: 26.8,
      }),
    });
    assert.equal(await isRefPlace(dir), true);
    rm(dir);
  });
});

describe('preflightRefPlace：失败必须自足（报错 + 下一步命令）', () => {
  test('合法参考态：refImages 取原图仓清单（字典序），images 为空数组', async () => {
    const { dataDir, originDir } = makeValidRefPair();
    const result = await preflightRefPlace('衡阳-测试', dataDir, originDir, {
      description: '衡阳市-湘江公铁大桥道口',
    });
    assert.equal(result.reason, undefined);
    assert.deepEqual(result.refImages, ['01.jpg', '02.jpg']);
    assert.deepEqual(result.images, []);
    assert.deepEqual(result.point, { lng: 112.6, lat: 26.8 });
    // 透传两个目录，供 buildRefGroup 读写
    assert.equal(result.dirPath, dataDir);
    assert.equal(result.originDirPath, originDir);
    rm(dataDir, originDir);
  });

  test('缺 description ⇒ 与实拍态同一条报错文案', async () => {
    const { dataDir, originDir } = makeValidRefPair();
    const result = await preflightRefPlace('x', dataDir, originDir, {});
    assert.match(result.reason, /缺少 "description"/);
    assert.match(result.hint, /npm run photos/);
    rm(dataDir, originDir);
  });

  test('缺 refs/point.json ⇒ 报错并给出坐标文件位置与 GCJ02 口径', async () => {
    const dataDir = makeDir({
      'index.json': JSON.stringify({ description: '某点位' }),
    });
    const originDir = makeDir({ [`${REFS_SUBDIR}/01.jpg`]: 'x' });
    const result = await preflightRefPlace('x', dataDir, originDir, {
      description: '某点位',
    });
    assert.match(result.reason, /point\.json/);
    assert.match(result.hint, /GCJ02/);
    assert.match(result.hint, /new-place/);
    rm(dataDir, originDir);
  });

  test('坐标不是数字 ⇒ 明说"必须是数字"且不猜', async () => {
    const { dataDir, originDir } = makeValidRefPair({
      point: { lng: '112.6', lat: 26.8 },
    });
    const result = await preflightRefPlace('x', dataDir, originDir, {
      description: '某点位',
    });
    assert.match(result.reason, /必须是数字/);
    assert.match(result.hint, /不要写成字符串/);
    rm(dataDir, originDir);
  });

  test('原图仓 refs/ 没有图（0 张）⇒ 报错指向"放原图仓"，且不再提 sips/编号', async () => {
    // data 仓只有 point.json（无图）⇒ 不是"放错仓"，而是"还没放图"
    const dataDir = makeDir({
      'index.json': JSON.stringify({ description: '某点位' }),
      [`${REFS_SUBDIR}/${REF_POINT_FILE}`]: JSON.stringify({
        lng: 112.6,
        lat: 26.8,
      }),
    });
    const originDir = makeDir({}); // 原图仓还没有 refs/
    const result = await preflightRefPlace('x', dataDir, originDir, {
      description: '某点位',
    });
    assert.match(result.reason, /没有图片文件/);
    assert.match(result.hint, /原图仓/);
    assert.match(result.hint, /npm run photos/);
    // 旧的"自己压 + 编号"提示必须消失
    assert.doesNotMatch(result.hint, /sips -Z/);
    assert.doesNotMatch(result.hint, /01\.jpg、02\.jpg/);
    rm(dataDir, originDir);
  });

  test('错仓提示：源图误放 data 仓 refs/ ⇒ 明确指出应放原图仓并给 mv 命令', async () => {
    const dataDir = makeDir({
      'index.json': JSON.stringify({ description: '某点位' }),
      [`${REFS_SUBDIR}/${REF_POINT_FILE}`]: JSON.stringify({
        lng: 112.6,
        lat: 26.8,
      }),
      [`${REFS_SUBDIR}/2021022708_pdf-page1-image9.jpg`]: 'src-bytes',
    });
    const originDir = makeDir({}); // 原图仓 refs/ 空着
    const result = await preflightRefPlace('x', dataDir, originDir, {
      description: '某点位',
    });
    assert.match(result.reason, /放错仓/);
    assert.match(result.reason, /原图仓/);
    assert.match(result.hint, /mv /);
    assert.match(result.hint, /2021022708_pdf-page1-image9\.jpg/);
    assert.match(result.hint, /npm run photos/);
    rm(dataDir, originDir);
  });

  test('非图片文件（.txt / 派生后缀）不计入参考图', async () => {
    const { dataDir, originDir } = makeValidRefPair();
    writeFiles(originDir, {
      [`${REFS_SUBDIR}/notes.txt`]: 'x',
      [`${REFS_SUBDIR}/01_thumb.webp`]: 'x',
      [`${REFS_SUBDIR}/01_display.avif`]: 'x',
    });
    const result = await preflightRefPlace('x', dataDir, originDir, {
      description: '某点位',
    });
    assert.deepEqual(result.refImages, ['01.jpg', '02.jpg']);
    rm(dataDir, originDir);
  });

  test('cover 指定可用的文件名 ⇒ 通过（封面不再靠字典序）', async () => {
    const { dataDir, originDir } = makeValidRefPair({
      point: { lng: 112.6, lat: 26.8, cover: '02.jpg' },
    });
    const result = await preflightRefPlace('x', dataDir, originDir, {
      description: '某点位',
    });
    assert.equal(result.reason, undefined);
    assert.equal(result.point.cover, '02.jpg');
    rm(dataDir, originDir);
  });

  test('cover 不在清单里 ⇒ 报错并列出候选（不静默忽略）', async () => {
    const { dataDir, originDir } = makeValidRefPair({
      point: { lng: 112.6, lat: 26.8, cover: 'nope.jpg' },
    });
    const result = await preflightRefPlace('x', dataDir, originDir, {
      description: '某点位',
    });
    assert.match(result.reason, /cover/);
    assert.match(result.hint, /01\.jpg/);
    assert.match(result.hint, /02\.jpg/);
    rm(dataDir, originDir);
  });

  test('cover 不是字符串 ⇒ 与"不在清单"同一条报错（不替人猜）', async () => {
    const { dataDir, originDir } = makeValidRefPair({
      point: { lng: 112.6, lat: 26.8, cover: 2 },
    });
    const result = await preflightRefPlace('x', dataDir, originDir, {
      description: '某点位',
    });
    assert.match(result.reason, /cover/);
    rm(dataDir, originDir);
  });
});

describe('buildRefGroup：与实拍点位同构 + 派生图落到 data 仓 refs/', () => {
  /** 造一对能真跑 sharp 的目录（真实 PNG），返回 group 与两个目录 */
  async function buildReal({ point, images = ['a.png', 'b.png'] } = {}) {
    const dataDir = makeTempDir();
    const originDir = makeDir(
      Object.fromEntries(images.map((file) => [`${REFS_SUBDIR}/${file}`, PNG_1x1])),
    );
    const group = await buildRefGroup({
      dirName: '测试点位',
      dirPath: dataDir,
      originDirPath: originDir,
      indexConfig: {
        description: '测试点位',
        references: [{ kind: 'video', label: '参考视频', url: 'https://e.com/v' }],
      },
      point: point ?? { lng: 112.6, lat: 26.8 },
      refImages: images,
    });
    return { group, dataDir, originDir };
  }

  test('字段与实拍态同名同形，外加 pinKind = ref', async () => {
    const { group, dataDir, originDir } = await buildReal();
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
    rm(dataDir, originDir);
  });

  test('组级坐标 = 人工标注的点位坐标（GCJ02 原样透传，不换算）', async () => {
    const { group, dataDir, originDir } = await buildReal();
    assert.equal(group.lat, 26.8);
    assert.equal(group.lng, 112.6);
    rm(dataDir, originDir);
  });

  test('fileName 是裸原名（不带 refs/ 前缀），链接指向派生图（对齐实拍态）', async () => {
    const { group, dataDir, originDir } = await buildReal();
    assert.equal(group.photos.length, 2);
    for (const photo of group.photos) {
      assert.equal(photo.lat, 26.8);
      assert.equal(photo.lng, 112.6);
      assert.doesNotMatch(photo.fileName, /refs\//);
      assert.match(photo.thumbnailLink, /\/refs\/.*_thumb\.webp$/);
      assert.match(photo.displayLink, /\/refs\/.*_display\.avif$/);
    }
    // 派生名 = **去掉扩展名的原名** + 后缀（与实拍态同一条既有规则：
    // IMG_5763.HEIC → IMG_5763_display.avif），fileName 则保留完整原名
    assert.equal(group.photos[0].fileName, 'a.png');
    assert.equal(
      group.photos[0].thumbnailLink,
      '/data/photos/测试点位/refs/a_thumb.webp',
    );
    assert.equal(
      group.photos[0].displayLink,
      '/data/photos/测试点位/refs/a_display.avif',
    );
    rm(dataDir, originDir);
  });

  test('派生图真的落在 data 仓 refs/，而源图不在 data 仓', async () => {
    const { dataDir, originDir } = await buildReal();
    const refsOut = path.join(dataDir, REFS_SUBDIR);
    assert.ok(fs.existsSync(path.join(refsOut, `a${THUMB_SUFFIX}`)));
    assert.ok(fs.existsSync(path.join(refsOut, `a${DISPLAY_SUFFIX}`)));
    assert.ok(fs.existsSync(path.join(refsOut, `b${THUMB_SUFFIX}`)));
    // 源图仍只在原图仓
    assert.ok(!fs.existsSync(path.join(refsOut, 'a.png')));
    assert.ok(fs.existsSync(path.join(originDir, REFS_SUBDIR, 'a.png')));
    rm(dataDir, originDir);
  });

  test('封面缺省 = 字典序第一张；组级链接取封面', async () => {
    const { group, dataDir, originDir } = await buildReal();
    assert.equal(group.fileName, 'a.png');
    assert.equal(group.thumbnailLink, group.photos[0].thumbnailLink);
    assert.equal(group.displayLink, group.photos[0].displayLink);
    rm(dataDir, originDir);
  });

  test('封面显式指定 cover ⇒ 指定那张成为组级链接（不用改名）', async () => {
    const { group, dataDir, originDir } = await buildReal({
      point: { lng: 112.6, lat: 26.8, cover: 'b.png' },
    });
    assert.equal(group.fileName, 'b.png');
    assert.equal(group.thumbnailLink, group.photos[1].thumbnailLink);
    assert.equal(group.displayLink, group.photos[1].displayLink);
    rm(dataDir, originDir);
  });

  test('参考图不写 takenAt / device / geoSource（没有的字段不编）', async () => {
    const { group, dataDir, originDir } = await buildReal();
    for (const photo of group.photos) {
      assert.equal(photo.takenAt, undefined);
      assert.equal(photo.device, undefined);
      assert.equal(photo.geoSource, undefined);
    }
    assert.equal(group.takenAt, undefined);
    rm(dataDir, originDir);
  });

  test('references 缺省时整个字段不出现（与实拍态同一口径）', async () => {
    const dataDir = makeTempDir();
    const originDir = makeDir({ [`${REFS_SUBDIR}/a.png`]: PNG_1x1 });
    const bare = await buildRefGroup({
      dirName: 'x',
      dirPath: dataDir,
      originDirPath: originDir,
      indexConfig: { description: 'x' },
      point: { lng: 1, lat: 2 },
      refImages: ['a.png'],
    });
    assert.equal('references' in bare, false);
    rm(dataDir, originDir);
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
    assert.doesNotThrow(() =>
      assertPlainName('衡阳市-湘江公铁大桥道口', '点位名'),
    );
  });

  test('切档：参考态目录 ⇒ 只新增 index_photo，其余键原样保留', async () => {
    const dir = makeDir({
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
    rm(dir);
  });

  test('切档：已是实拍态（有 index_photo）⇒ 返回 false 且不写任何文件', async () => {
    const dir = makeDir({
      'index.json': JSON.stringify({
        index_photo: 'OLD.JPG',
        description: '某点位',
      }),
    });
    const before = fs.readFileSync(path.join(dir, 'index.json'), 'utf-8');
    const ok = await tryUpgradeRefPlace('x', dir, 'NEW.JPG');
    assert.equal(ok, false);
    assert.equal(fs.readFileSync(path.join(dir, 'index.json'), 'utf-8'), before);
    rm(dir);
  });

  test('切档：缺 refs/point.json ⇒ 返回 false（防"例外被写宽"）', async () => {
    const dir = makeDir({
      'index.json': JSON.stringify({ description: '某点位' }),
    });
    const before = fs.readFileSync(path.join(dir, 'index.json'), 'utf-8');
    const ok = await tryUpgradeRefPlace('x', dir, 'NEW.JPG');
    assert.equal(ok, false);
    assert.equal(fs.readFileSync(path.join(dir, 'index.json'), 'utf-8'), before);
    rm(dir);
  });

  test('切档：坐标是字符串 ⇒ 返回 false（判定口径与管线一致）', async () => {
    const dir = makeDir({
      'index.json': JSON.stringify({ description: '某点位' }),
      [`${REFS_SUBDIR}/${REF_POINT_FILE}`]: JSON.stringify({
        lng: '112.6',
        lat: '26.8',
      }),
    });
    assert.equal(await tryUpgradeRefPlace('x', dir, 'NEW.JPG'), false);
    rm(dir);
  });
});

describe('跨文件契约：参考态的目录名、文件名与派生后缀两边必须同值', () => {
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

  test('本文件用的两个派生后缀与管线 DERIVED_SUFFIXES 同值', () => {
    assert.ok(DERIVED_SUFFIXES.includes(THUMB_SUFFIX));
    assert.ok(DERIVED_SUFFIXES.includes(DISPLAY_SUFFIX));
  });

  test('链接拼法：BASE_URL/<dirName>/refs/<原名>_thumb|_display（源图不进 data 仓）', async () => {
    const dirName = 'd';
    const dataDir = makeTempDir();
    const originDir = makeDir({ [`${REFS_SUBDIR}/x.png`]: PNG_1x1 });
    const group = await buildRefGroup({
      dirName,
      dirPath: dataDir,
      originDirPath: originDir,
      indexConfig: { description: dirName },
      point: { lng: 1, lat: 2 },
      refImages: ['x.png'],
    });
    assert.equal(
      group.thumbnailLink,
      `/data/photos/${dirName}/refs/x${THUMB_SUFFIX}`,
    );
    assert.equal(
      group.displayLink,
      `/data/photos/${dirName}/refs/x${DISPLAY_SUFFIX}`,
    );
    rm(dataDir, originDir);
  });
});
