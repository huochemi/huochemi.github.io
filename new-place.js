/**
 * new-place.js — 新建点位的脚手架：建 data 侧目录 + 起草 index.json
 *
 * 计划文档：docs/plans/2026-10-05-new-place-scaffold.md
 *
 * 用法（在站点仓库根目录执行）：
 *   npm run new-place -- "<点位名>" --cover "<封面文件名>"
 *   例：npm run new-place -- "北京市-水南庄道口" --cover IMG_2315.HEIC
 *
 * 位置参数只有一个含义：点位名 = 原图仓/data 仓的目录名，同时也是 index.json 的
 * description（展示名）。想要更短的展示名，建好后直接编辑 index.json 再重跑 photos。
 *
 * 行为（先校验、后写入——全部前置条件通过后才做任何文件系统变更，
 * 任一失败即退出码 1 且零副作用，沿用 photo-ops.md「硬拦排在写操作之前」的纪律）：
 *   校验：
 *     1. 点位名合法（纯名字：非空、非 . / ..、不含路径分隔符与 NUL）
 *     2. 原图仓有该点位目录，且含 ≥1 个媒体文件（图片 + mp4，剔除派生文件）
 *     3. 传了 --cover 时：该文件名在上述媒体清单中
 *     4. data 仓该点位尚无 index.json（已存在即硬拦，绝不覆盖人工内容）
 *   写入：
 *     5. 建 data 侧目录（已存在则跳过）
 *     6. 写 index.json —— 两个 key 恒存在，description 取点位名
 *     7. 提示下一步：npm run photos
 *
 * 封面必须由人指定：不传 --cover 即列出候选清单并报错退出，不做任何推导
 * （脚本不替人猜——AGENTS.md S3、photo-ops.md「不做自动挑替补救封面」）。
 *
 * 刻意不校验封面是否有 GPS——判定权唯独属于 npm run photos 的预检
 * （photo-metadata.md：预检是"能不能产出"的唯一判定点）。此处也判一次会造出第二个
 * 判定点，迟早与管线口径漂移。
 *
 * 双根（形态 B，2026-10-05 起）：原片在原图仓 `../photos-originals/photos`、
 * `index.json` 与派生图在 data 仓 `../data/photos`。本工具**只读原图仓**（列候选 /
 * 校验封面存在）、**只写 data 仓**，不创建原图仓目录、不碰任何媒体文件。
 *
 * 依赖：仅 Node 内置模块 fs / path（无外部命令，无子进程，无启动预检）
 */

const fs = require('fs/promises');
const path = require('path');

const ORIGIN_DIR = path.join(__dirname, '../photos-originals/photos');
const IMGS_DIR = path.join(__dirname, '../data/photos');

// 与 process-photos.js 保持一致的媒体判定（改一处必须改两处）：
// 图片 + 视频（mp4）
const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.heic', '.tiff', '.mp4']);
const THUMB_SUFFIX = '_thumb.webp';
const DISPLAY_SUFFIX = '_display.avif';
const WEB_VIDEO_SUFFIX = '_web.mp4';
// 派生文件后缀（与 process-photos.js 的口径同值副本，改需同步；
// 跨文件测试锁定一致——原图仓若混入派生文件，不能被当成候选封面）
const DERIVED_SUFFIXES = [THUMB_SUFFIX, DISPLAY_SUFFIX, WEB_VIDEO_SUFFIX];
const isDerivedFile = (file) => DERIVED_SUFFIXES.some((s) => file.endsWith(s));

// 非 TTY（管道 / 重定向到文件）或 NO_COLOR 时不着色，避免日志混入 ANSI 转义码
const COLOR_ENABLED =
  Boolean(process.stdout.isTTY) && !('NO_COLOR' in process.env);
const paint = (code, s) => (COLOR_ENABLED ? `\x1b[${code}m${s}\x1b[39m` : s);
const color = {
  red: (s) => paint(31, s),
  green: (s) => paint(32, s),
  yellow: (s) => paint(33, s),
  cyan: (s) => paint(36, s),
};

function printUsage() {
  console.log(
    [
      '用法（需在站点仓库根目录执行）：',
      '  npm run new-place -- "<点位名>" --cover "<封面文件名>"',
      '例：',
      '  npm run new-place -- "北京市-水南庄道口" --cover IMG_2315.HEIC',
      '',
      '说明：建 data 仓点位目录并起草 index.json；原图仓目录与媒体须已就位。',
      '     点位名同时写入 index.json 的 description（展示名），要换成更短的展示名',
      '     直接编辑该文件即可。不传 --cover 会列出该点位可选的媒体文件名。',
    ].join('\n'),
  );
}

/**
 * 校验用户输入的名字是"纯名字"（防路径穿越）
 * 拒绝空值、"." / ".."、任何路径分隔符（含 Windows 反斜杠）与 NUL
 */
function assertPlainName(name, label) {
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0')
  ) {
    throw new Error(
      `${label}不合法："${name}"——不能为空，且不能包含路径分隔符或 ".."`,
    );
  }
}

/** 判断路径是否存在 */
async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 解析命令行参数：1 个位置参数（点位名）+ 可选 --cover
 * 风格与 fix-gps.js 一致（取值后 i++ 跳过；取值不得以 -- 开头）。
 * 任何未定义的 `--xxx` 一律报错退出——不把未知参数当位置参数吞掉（模糊兼容会让
 * 打错参数的人拿到"参数数量不对"这种指不到问题本身的报错）。
 */
function parseArgs(argv) {
  const flags = { cover: undefined };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      if (arg !== '--cover') {
        throw new Error(`未知参数：${arg}`);
      }
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`参数 ${arg} 缺少值`);
      }
      flags.cover = value;
      i++;
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1) {
    throw new Error(
      `参数数量不对：需要 1 个点位名（可带 --cover），实际 ${positional.length} 个`,
    );
  }
  return { place: positional[0], ...flags };
}

async function createPlace(placeName, coverFileName) {
  const originDirPath = path.join(ORIGIN_DIR, placeName);
  const dataDirPath = path.join(IMGS_DIR, placeName);

  // --- 校验阶段：零写操作 ---

  // 1. 原图仓必须已有该点位目录——原图是点位的唯一输入源，本工具不代建、不放照片
  const originStat = await fs.stat(originDirPath).catch(() => null);
  if (!originStat || !originStat.isDirectory()) {
    throw new Error(
      [
        `原图仓中不存在点位目录：${originDirPath}`,
        '原图仓是点位的唯一输入源，请先建目录并放入媒体文件（本命令不代你建）。',
        '若目录已存在，请检查点位名是否与目录名完全一致（含中英文符号）。',
      ].join('\n'),
    );
  }

  // 2. 媒体清单取自原图仓（派生文件不算）
  const files = await fs.readdir(originDirPath);
  const mediaFiles = files.filter(
    (file) =>
      ALLOWED_EXTS.has(path.extname(file).toLowerCase()) && !isDerivedFile(file),
  );
  if (mediaFiles.length === 0) {
    throw new Error(
      [
        `原图仓点位 [${placeName}] 中没有媒体文件（${[...ALLOWED_EXTS].join(' / ')}）：`,
        `    ${originDirPath}`,
      ].join('\n'),
    );
  }

  // 3. 封面必须由人指定——不给默认值、不做推导
  if (!coverFileName) {
    throw new Error(
      [
        `未指定封面：请加 --cover "<文件名>"（本命令不替你挑封面）`,
        `该点位原图仓中的媒体文件（${mediaFiles.length} 个）：`,
        ...mediaFiles.map((file) => `    ${file}`),
        '用法：',
        `    npm run new-place -- "${placeName}" --cover "<从上面选一个>"`,
      ].join('\n'),
    );
  }
  if (!mediaFiles.includes(coverFileName)) {
    throw new Error(
      [
        `指定的封面 "${coverFileName}" 不在该点位的原图仓媒体清单中`,
        `该点位原图仓中的媒体文件（${mediaFiles.length} 个）：`,
        ...mediaFiles.map((file) => `    ${file}`),
      ].join('\n'),
    );
  }

  // 4. data 仓不得已有 index.json——绝不覆盖人工内容，也不提供 --force
  const indexPath = path.join(dataDirPath, 'index.json');
  if (await exists(indexPath)) {
    throw new Error(
      [
        `点位 [${placeName}] 已有 index.json，本命令不覆盖：`,
        `    ${indexPath}`,
        '如需换封面或改展示名，直接编辑该文件，然后重跑：npm run photos',
      ].join('\n'),
    );
  }

  // --- 写入阶段：全部校验已通过 ---

  await fs.mkdir(dataDirPath, { recursive: true });
  // 两个 key 恒存在（契约）：description 取点位名——位置参数只有一个含义，
  // 不设第二个参数去装展示名（要更短的名字就建好后直接编辑 index.json，
  // 本工具对已存在的 index.json 恒硬拦、不覆盖）。
  const indexConfig = {
    index_photo: coverFileName,
    description: placeName,
  };
  await fs.writeFile(
    indexPath,
    `${JSON.stringify(indexConfig, null, 2)}\n`,
    'utf-8',
  );

  console.log(color.cyan('\n=== 新建点位 ==='));
  console.log(`点位：${placeName}`);
  console.log(`封面：${coverFileName}`);
  console.log(
    `展示名：${indexConfig.description}（= 点位名；要换成更短的展示名，编辑 index.json）`,
  );
  console.log(color.green(`✅ 已创建 data 仓目录与 index.json：${indexPath}`));
  console.log(
    color.yellow(
      '\n⚠️ 下一步：npm run photos（生成派生图与 output.json），' +
        '再提交三个仓库：../photos-originals（原图仓）、../data（派生图）、本站点',
    ),
  );
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(color.red(`\n❌ ${err.message}`));
    printUsage();
    process.exit(1);
  }

  assertPlainName(args.place, '点位名');
  if (args.cover !== undefined) assertPlainName(args.cover, '封面文件名');

  await createPlace(args.place, args.cover);
}

main().catch((err) => {
  console.error(color.red(`\n❌ ${err.message}`));
  process.exit(1);
});
