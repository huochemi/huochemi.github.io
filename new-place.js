/**
 * new-place.js — 新建点位的脚手架
 *
 * 计划文档：docs/plans/2026-10-05-new-place-scaffold.md（实拍态）、
 *          docs/plans/2026-10-07-ref-places.md（参考态与切档）
 *
 * 用法（在站点仓库根目录执行）：
 *   ① 实拍态（已到现场拍过照，原图仓已有该点位目录与媒体文件）：
 *      npm run new-place -- "<点位名>" --cover "<封面文件名>"
 *      例：npm run new-place -- "北京市-水南庄道口" --cover IMG_2315.HEIC
 *
 *   ② 参考态（还没去过，先在地图上立个点位，只有网络参考照）：
 *      npm run new-place -- "<点位名>" --wish --coord "<lng,lat>"
 *      例：npm run new-place -- "衡阳市-湘江公铁大桥道口" --wish --coord "112.60,26.80"
 *
 *   ③ 切档（去过之后，参考态 → 实拍态；放好照片再跑这条）：
 *      npm run new-place -- "<点位名>" --cover "<封面文件名>"
 *
 * 位置参数只有一个含义：点位名 = 原图仓/data 仓的目录名，同时也是 index.json 的
 * description（展示名）。想要更短的展示名，建好后直接编辑 index.json 再重跑 photos。
 *
 * 三种行为（一律"先校验、后写入"——全部前置条件通过后才做任何文件系统变更，
 * 任一失败即退出码 1 且零副作用，沿用 photo-ops.md「硬拦排在写操作之前」的纪律）：
 *
 * 【实拍态】`--cover`
 *   校验：1. 点位名合法（非空、非 . / ..、不含路径分隔符与 NUL）
 *         2. 原图仓有该点位目录，且含 ≥1 个媒体文件（图片 + mp4，剔除派生文件）
 *         3. --cover 指定的文件名在上述媒体清单中
 *         4. data 仓该点位尚无 index.json（已存在 ⇒ 见「切档」；不是参考态就硬拦）
 *   写入：5. 建 data 侧目录（已存在则跳过）
 *         6. 写 index.json（index_photo + description，两个 key 恒存在）
 *         7. 提示下一步：npm run photos
 *
 * 【参考态】`--wish --coord "<lng,lat>"`
 *   校验：1. 点位名合法
 *         2. --coord 能解析为合法经纬度（GCJ02，见下）
 *         3. data 仓该点位尚无 index.json（已存在即硬拦，绝不覆盖）
 *         4. 原图仓该点位**尚无媒体文件**（有 ⇒ 这是实拍态，报错并指向 --cover）
 *   写入：5. 建 data 侧目录与 refs/
 *         6. 写 index.json（只有 description——参考态不许有 index_photo）
 *         7. 写 refs/point.json（lng / lat）
 *         8. 提示放参考图的位置、压缩命令与命名规则
 *
 * 【切档】`--cover`，且目标已存在 index.json 但处于**参考态**
 *   ⚠️ 这是本工具对"绝不覆盖人工内容"这条契约的**唯一受控例外**（2026-10-07 用户
 *   拍板）：条件写死为"已存在 index.json" **且** "无 index_photo" **且**
 *   "refs/point.json 坐标合法"，动作写死为"**只新增 index_photo 这一个键**"——
 *   不允许改、不允许删任何既有键，也不碰 refs/。非参考态（含已有 index_photo 的
 *   实拍态）仍然硬拦。这样"去过之后"就收敛成你建新点位本来就要跑的那条命令，
 *   无需手改任何文件、也没有任何"要记得删的字段"。
 *
 * 封面必须由人指定：不传 --cover 即列出候选清单并报错退出，不做任何推导
 * （脚本不替人猜——AGENTS.md S3、photo-ops.md「不做自动挑替补救封面」）。
 *
 * 刻意不校验封面是否有 GPS——判定权唯独属于 npm run photos 的预检
 * （photo-metadata.md：预检是"能不能产出"的唯一判定点）。此处也判一次会造出第二个
 * 判定点，迟早与管线口径漂移。
 *
 * 坐标口径（参考态）：**GCJ02**，与 cities.js 同工具同口径（高德坐标拾取器
 * https://lbs.amap.com/tools/picker 直接粘贴）。不要填 WGS84/照片 EXIF 坐标——
 * 那条通道由前端做换算，参考态坐标直给高德、不换算，填错会偏移数百米。
 *
 * 双根（形态 B，2026-10-05 起）：原片在原图仓 `../photos-originals/photos`、
 * `index.json` 与派生图在 data 仓 `../data/photos`。本工具**只读原图仓**（列候选 /
 * 校验封面存在）、**只写 data 仓**，不创建原图仓目录、不碰任何媒体文件。
 * 参考图由**用户自己**下载并压缩后放进 data 仓的 refs/（本工具不代下、不代压）。
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

// 参考态（"想去、还没去过"的点位）的素材目录与坐标文件——与 process-photos.js 的
// 同名常量是同值副本（本项目刻意不抽共享模块），改一处必须改两处。
const REFS_SUBDIR = 'refs';
const REF_POINT_FILE = 'point.json';

// 参考图压缩档位（D6c 于真实照片实测：1024px / q70 ≈ 235 KB，与现有展示档
// _display.avif 的 207-229 KB 同量级）。写死在这里只是为了让提示里给出的命令
// 与文档口径一致；本工具**不代压**、不引入 sharp。
const REF_IMAGE_MAX_PX = 1024;
const REF_IMAGE_QUALITY = 70;

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
      '  # 实拍态：已到现场拍过照',
      '  npm run new-place -- "<点位名>" --cover "<封面文件名>"',
      '  例：npm run new-place -- "北京市-水南庄道口" --cover IMG_2315.HEIC',
      '',
      '  # 参考态：还没去过，先在地图上立个点位（坐标 GCJ02）',
      '  npm run new-place -- "<点位名>" --wish --coord "<lng,lat>"',
      '  例：npm run new-place -- "衡阳市-湘江公铁大桥道口" --wish --coord "112.60,26.80"',
      '',
      '  # 切档：去过之后（放好照片再跑上面第一条命令即可，无需手改文件）',
      '',
      '说明：建 data 仓点位目录并起草 index.json。点位名同时写入 description',
      '     （展示名），要换成更短的展示名直接编辑该文件即可。',
      '     实拍态：原图仓目录与媒体须已就位；不传 --cover 会列出媒体候选清单。',
      '     参考态：不需要原图仓目录；建完后把参考图压好放进 refs/，再跑 npm run photos。',
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
 * 解析命令行参数：1 个位置参数（点位名）+ 可选 --cover / --wish / --coord
 * 风格与 fix-gps.js 一致（取值后 i++ 跳过；取值不得以 -- 开头）。
 * 任何未定义的 `--xxx` 一律报错退出——不把未知参数当位置参数吞掉（模糊兼容会让
 * 打错参数的人拿到"参数数量不对"这种指不到问题本身的报错）。
 */
function parseArgs(argv) {
  const flags = { cover: undefined, wish: false, coord: undefined };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      if (arg === '--wish') {
        flags.wish = true;
        continue;
      }
      if (arg !== '--cover' && arg !== '--coord') {
        throw new Error(`未知参数：${arg}`);
      }
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`参数 ${arg} 缺少值`);
      }
      if (arg === '--cover') flags.cover = value;
      else flags.coord = value;
      i++;
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1) {
    throw new Error(
      `参数数量不对：需要 1 个点位名（可带 --cover 或 --wish --coord），` +
        `实际 ${positional.length} 个`,
    );
  }
  return { place: positional[0], ...flags };
}

/**
 * 解析 `--coord "<lng,lat>"`：只认"两个数字、逗号分隔"。
 * 不做法则推导、不接受字符串形式的数字（脚本不替人猜）。
 * 取值范围按经纬度合法性校验——**不**校验坐标系（GCJ02 与 WGS84 在数值上无法区分），
 * 口径由文档与提示交代：参考态填 GCJ02。
 */
function parseCoord(value) {
  const parts = String(value)
    .split(',')
    .map((s) => s.trim());
  if (parts.length !== 2 || parts.some((s) => s === '')) {
    throw new Error(
      `--coord 格式不对："${value}"——应为 "<经度>,<纬度>"，例："112.60,26.80"`,
    );
  }
  const [lng, lat] = parts.map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new Error(
      `--coord 必须是两个数字："${value}"（不接受空值或非数字）`,
    );
  }
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    throw new Error(
      `--coord 超出合法范围："${value}"——经度 -180~180、纬度 -90~90`,
    );
  }
  return { lng, lat };
}

/** 原图仓该点位的媒体清单（剔除派生文件；目录不存在即空数组） */
async function listOriginMedia(placeName) {
  const originDirPath = path.join(ORIGIN_DIR, placeName);
  const files = await fs.readdir(originDirPath).catch(() => []);
  return {
    originDirPath,
    files,
    mediaFiles: files.filter(
      (file) =>
        ALLOWED_EXTS.has(path.extname(file).toLowerCase()) &&
        !isDerivedFile(file),
    ),
  };
}

/**
 * 尝试把参考态点位切成实拍态（受控例外，条件与动作都写死，见文件头）
 *
 * @returns {Promise<boolean>} true = 已切档并写过 index.json；false = 不是合法参考态
 */
async function tryUpgradeRefPlace(
  placeName,
  dataDirPath,
  coverFileName,
) {
  const indexPath = path.join(dataDirPath, 'index.json');
  let existing;
  try {
    existing = JSON.parse(await fs.readFile(indexPath, 'utf-8'));
  } catch {
    return false;
  }
  // 条件 ①：无 index_photo（有 ⇒ 已是实拍态，硬拦）
  if (existing.index_photo) return false;

  // 条件 ②：refs/point.json 坐标合法
  const refsDirPath = path.join(dataDirPath, REFS_SUBDIR);
  const pointPath = path.join(refsDirPath, REF_POINT_FILE);
  let point;
  try {
    point = JSON.parse(await fs.readFile(pointPath, 'utf-8'));
  } catch {
    return false;
  }
  if (!Number.isFinite(point?.lng) || !Number.isFinite(point?.lat)) return false;

  // 动作写死：只**新增** index_photo 一个键，其余键（description / references …）
  // 原样保留，refs/ 一字不动
  const upgraded = { index_photo: coverFileName, ...existing };
  await fs.writeFile(indexPath, `${JSON.stringify(upgraded, null, 2)}\n`, 'utf-8');

  console.log(color.cyan('\n=== 参考态 → 实拍态（切档）==='));
  console.log(`点位：${placeName}`);
  console.log(`封面：${coverFileName}`);
  console.log(
    '说明：只新增了 index_photo 一个键；description 与 references 原样保留，refs/ 未改动',
  );
  console.log(color.green(`✅ 已更新 ${indexPath}`));
  console.log(
    color.yellow(
      '\n⚠️ 下一步：npm run photos —— 坐标改为按封面照片的 EXIF 读取' +
        '（点位从"参考态"变为"实拍态"，图钉变常规样式）',
    ),
  );
  console.log(
    '💡 参考图与 refs/point.json 的使命（去之前熟悉环境）已结束，确认后自行清理：',
  );
  console.log(`    rm -rf "${refsDirPath}"`);
  console.log('   （忘了也无害：实拍态不读 refs/，管线只会打一行可清理提示）');
  return true;
}

/** 实拍态：原行为 + 对"参考态切档"的受控例外 */
async function createPlace(placeName, coverFileName) {
  const dataDirPath = path.join(IMGS_DIR, placeName);

  // --- 校验阶段：零写操作 ---

  // 1. 原图仓必须已有该点位目录——原图是点位的唯一输入源，本工具不代建、不放照片
  const { originDirPath, mediaFiles } = await listOriginMedia(placeName);
  if (!(await exists(originDirPath))) {
    throw new Error(
      [
        `原图仓中不存在点位目录：${originDirPath}`,
        '原图仓是点位的唯一输入源，请先建目录并放入媒体文件（本命令不代你建）。',
        '若目录已存在，请检查点位名是否与目录名完全一致（含中英文符号）。',
        '若点位还没去过（没有自己拍的照片），改用参考态：',
        `    npm run new-place -- "${placeName}" --wish --coord "<lng,lat>"`,
      ].join('\n'),
    );
  }

  // 2. 媒体清单取自原图仓（派生文件不算）
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

  // 4. data 仓已有 index.json 时：参考态 ⇒ 切档；其余 ⇒ 硬拦（绝不覆盖人工内容）
  if (await exists(path.join(dataDirPath, 'index.json'))) {
    const upgraded = await tryUpgradeRefPlace(
      placeName,
      dataDirPath,
      coverFileName,
    );
    if (upgraded) return;
    throw new Error(
      [
        `点位 [${placeName}] 已有 index.json，本命令不覆盖：`,
        `    ${path.join(dataDirPath, 'index.json')}`,
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
    path.join(dataDirPath, 'index.json'),
    `${JSON.stringify(indexConfig, null, 2)}\n`,
    'utf-8',
  );

  console.log(color.cyan('\n=== 新建点位 ==='));
  console.log(`点位：${placeName}`);
  console.log(`封面：${coverFileName}`);
  console.log(
    `展示名：${indexConfig.description}（= 点位名；要换成更短的展示名，编辑 index.json）`,
  );
  console.log(
    color.green(
      `✅ 已创建 data 仓目录与 index.json：${path.join(dataDirPath, 'index.json')}`,
    ),
  );
  console.log(
    color.yellow(
      '\n⚠️ 下一步：npm run photos（生成派生图与 output.json），' +
        '再提交三个仓库：../photos-originals（原图仓）、../data（派生图）、本站点',
    ),
  );
}

/** 参考态：建 data 侧目录与 refs/，写 index.json 与 refs/point.json */
async function createWishPlace(placeName, coord) {
  const dataDirPath = path.join(IMGS_DIR, placeName);
  const refsDirPath = path.join(dataDirPath, REFS_SUBDIR);
  const indexPath = path.join(dataDirPath, 'index.json');
  const pointPath = path.join(refsDirPath, REF_POINT_FILE);

  // --- 校验阶段：零写操作 ---

  // 1. data 仓不得已有 index.json（与实拍态同一条硬拦：绝不覆盖人工内容）
  if (await exists(indexPath)) {
    throw new Error(
      [
        `点位 [${placeName}] 已有 index.json，本命令不覆盖：`,
        `    ${indexPath}`,
        '如需改展示名或来源链接，直接编辑该文件，然后重跑：npm run photos',
      ].join('\n'),
    );
  }

  // 2. 原图仓该点位不得已有媒体文件——有就说明已去过，该走实拍态那条命令
  const { originDirPath, mediaFiles } = await listOriginMedia(placeName);
  if (mediaFiles.length > 0) {
    throw new Error(
      [
        `原图仓点位 [${placeName}] 已有 ${mediaFiles.length} 个媒体文件，这是实拍态、不是参考态：`,
        ...mediaFiles.slice(0, 10).map((file) => `    ${file}`),
        '请改用（封面必须你自己指定）：',
        `    npm run new-place -- "${placeName}" --cover "<封面文件名>"`,
      ].join('\n'),
    );
  }

  // --- 写入阶段：全部校验已通过 ---

  await fs.mkdir(refsDirPath, { recursive: true });
  // 参考态的 index.json **只有 description**：不许出现 index_photo
  // （它此时指着一个不存在的文件，会被管线判成说谎的脏字段）。这一点是本次
  // 相较实拍态的唯一差别，见 docs/plans/2026-10-07-ref-places.md 的 D2。
  await fs.writeFile(
    indexPath,
    `${JSON.stringify({ description: placeName }, null, 2)}\n`,
    'utf-8',
  );
  await fs.writeFile(
    pointPath,
    `${JSON.stringify(coord, null, 2)}\n`,
    'utf-8',
  );

  console.log(color.cyan('\n=== 新建参考点位（还没去过）==='));
  console.log(`点位：${placeName}`);
  console.log(`坐标：${coord.lng}, ${coord.lat}（GCJ02，直给高德、不换算）`);
  console.log(color.green(`✅ 已创建 ${indexPath}`));
  console.log(color.green(`✅ 已创建 ${pointPath}`));
  console.log(
    color.yellow(
      [
        '',
        '⚠️ 下一步（两件，缺一不可）：',
        `  1. 把参考图压好放进 ${refsDirPath}/，命名为 01.jpg、02.jpg …（01.jpg 就是地图上显示的那张）`,
        '     参考图是你从网上找的环境照——先压到 ≈200-250 KB 再入库，',
        '     因为写进 git 历史的字节删了也回收不了：',
        `     sips -Z ${REF_IMAGE_MAX_PX} -s format jpeg -s formatOptions ${REF_IMAGE_QUALITY} "<下载的图>" --out "${path.join(refsDirPath, '01.jpg')}"`,
        '  2. npm run photos（产出 output.json），再提交：../data（点位元数据 + 参考图）、本站点',
        '',
        '💡 去过之后：把照片放进原图仓同名目录，再跑同一条 --cover 命令即可自动切档。',
      ].join('\n'),
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

  if (args.wish) {
    if (args.cover !== undefined) {
      console.error(
        color.red('\n❌ --wish（参考态）不能与 --cover（实拍态）同时使用'),
      );
      printUsage();
      process.exit(1);
    }
    if (args.coord === undefined) {
      console.error(
        color.red('\n❌ --wish 需要 --coord "<lng,lat>"（点位坐标，GCJ02）'),
      );
      printUsage();
      process.exit(1);
    }
    let coord;
    try {
      coord = parseCoord(args.coord);
    } catch (err) {
      console.error(color.red(`\n❌ ${err.message}`));
      printUsage();
      process.exit(1);
    }
    await createWishPlace(args.place, coord);
    return;
  }

  if (args.coord !== undefined) {
    console.error(
      color.red(
        '\n❌ --coord 只能与 --wish 一起使用（实拍态的坐标取自封面照片的 EXIF）',
      ),
    );
    printUsage();
    process.exit(1);
  }

  if (args.cover !== undefined) assertPlainName(args.cover, '封面文件名');
  await createPlace(args.place, args.cover);
}

// 只在作为 CLI 直接运行时才执行；被 require 时（如 test/ 下的单测）保持静默，
// 这样参数解析等纯函数可以脱离文件系统单独测试（与 process-photos.js 同惯例）。
if (require.main === module) {
  main().catch((err) => {
    console.error(color.red(`\n❌ ${err.message}`));
    process.exit(1);
  });
}

// 最小公共面：暴露无副作用的纯函数与常量，供单测导入（node --test）。
// tryUpgradeRefPlace 只收路径参数（可传临时目录），用于锁住"受控例外"的边界：
// 它只允许给参考态补 index_photo，非参考态必须原样返回 false、不写任何文件。
module.exports = {
  parseArgs,
  parseCoord,
  assertPlainName,
  tryUpgradeRefPlace,
  REFS_SUBDIR,
  REF_POINT_FILE,
};
