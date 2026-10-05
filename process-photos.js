const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const exifr = require('exifr');
const sharp = require('sharp');

const execFileAsync = promisify(execFile);

// 1. 配置图片目录和输出 JSON 的路径
//
// 双根（形态 B，2026-10-05 起）：**原图**（真相源、不可再生）在原图仓
// `../photos-originals`，**派生图**（可再生）在 data 仓。管线从 ORIGIN_DIR 读原图、
// 向 IMGS_DIR 写派生图；`index.json` 与全部前端链接仍留在 IMGS_DIR，因此
// BASE_URL 与 output.json 的结构零改动。详见
// docs/plans/2026-10-04-data-repo-longevity.md 与 docs/data-pipeline.md。
// 三个 CLI 各存一份同值副本（刻意不抽共享模块），有跨文件测试锁定一致。
const ORIGIN_DIR = path.join(__dirname, '../photos-originals/photos');
const IMGS_DIR = path.join(__dirname, '../data/photos'); // 派生图输出根（沿用 /data 项目站）
const OUTPUT_FILE = path.join(__dirname, 'src', 'Application', 'output.json');

// 支持的媒体扩展名：图片 + 视频（mp4）。视频与照片同口径参与 GPS 硬拦
// （组内任一张缺坐标即整组跳过）、坐标同样写在原片（真相源）
// 见 docs/plans/2026-10-04-video-mp4-support.md
const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.heic', '.tiff', '.mp4']);
// 视频判定：按扩展名。读取通道（exifr / exiftool）与生成流程按它分叉
const VIDEO_EXTS = new Set(['.mp4']);
const isVideoFile = (file) => VIDEO_EXTS.has(path.extname(file).toLowerCase());
// 站内相对路径：生产环境站点与 data 项目站同域（huochemi.github.io），
// 相对路径解析结果与原绝对 URL 一致；本地开发由 src/setupProxy.js 将
// /data 挂载到本地 data 仓库，无需先提交 data repo 即可预览
const BASE_URL = '/data/photos';

// 终端着色：只给"需要你处理 / 注意"的级别行上色——红 = ⛔❌（错误，须处理）、
// 黄 = ⚠️❗⏭️（有问题或本轮未产出，须注意）；其余级别与全部上下文行保持素文本，
// 否则每行都有装饰时，报错反而不显眼。
// 非 TTY（管道 / 重定向到文件）或 NO_COLOR 时不输出 ANSI 转义码，避免污染日志。
const COLOR_ENABLED =
  Boolean(process.stdout.isTTY) && !('NO_COLOR' in process.env);
const color = {
  red: (s) => (COLOR_ENABLED ? `\x1b[31m${s}\x1b[39m` : s),
  yellow: (s) => (COLOR_ENABLED ? `\x1b[33m${s}\x1b[39m` : s),
};

// 缩略图配置：300x300 px（适配 2x/3x 高分屏）
const THUMB_SIZE = 300;
const THUMB_QUALITY = 80;
// 派生图文件名后缀（delete-photo.js / fix-gps.js 各有一套同值副本，改这里需同步）
const THUMB_SUFFIX = '_thumb.webp';
const DISPLAY_SUFFIX = '_display.avif';
// 视频转码版文件名后缀（浏览器实际播放的文件；原片不入 data 仓库 git）
const WEB_VIDEO_SUFFIX = '_web.mp4';
// 任何媒体扫描都必须排除的派生文件后缀——不排除的话，重跑管线会把
// 派生文件当原图再处理一遍。三个 CLI 各存一份同值副本（刻意不抽共享模块），
// 有跨文件测试锁定一致（test/video-support.test.js）
const DERIVED_SUFFIXES = [THUMB_SUFFIX, DISPLAY_SUFFIX, WEB_VIDEO_SUFFIX];
const isDerivedFile = (file) => DERIVED_SUFFIXES.some((s) => file.endsWith(s));

// 视频转码档位（2026-10-04 用户拍板）：libx264 CRF30、高度压到 ≤720p、
// 保留源帧率、AAC 128k。实测 65.5 MB 原片（1080p60）→ 8.6 MB，
// 档位取舍依据见 docs/plans/2026-10-04-video-mp4-support.md 决策 1
const VIDEO_CRF = '30';
const VIDEO_MAX_HEIGHT = 720;
const VIDEO_AUDIO_BITRATE = '128k';

// 展示图配置：1920px 宽（网页 Lightbox 全屏展示足够），
// 原图动辄数 MB，展示图体积约为原图 1/10，是首屏大图加载的根因优化。
// 2026-10-05 起编码格式由 WebP 换为 AVIF：同视觉质量下体积约再降一半
// （本机实测 1920px 合成图 WebP q75 = 800 KB vs AVIF q60 = 441 KB，真实照片
// 通常更好）。坑：`sharp.format.avif` 是 undefined 属**正常**——AVIF 归在
// `sharp.format.heif` 下（alias: ["avif"]），`.avif()` 方法照常可用，别被误导。
const DISPLAY_SIZE = 1920;
const DISPLAY_QUALITY = 60;

// 拍摄设备分类：把 EXIF 的 Make / Model 归一为「手机 / 相机」两类枚举。
// 只存语义、不存品牌名也不存 emoji——前端角标空间有限（只放图标），
// 且 emoji 属展示层，数据层不该耦合呈现形式。
// 品牌表是启发式清单而非权威数据源；未命中任何一条时不写 device 字段
// （宁缺毋假），改由收尾的识别汇总列出未识别组合，避免新设备静默不显示图标。
const PHONE_MAKES = new Set([
  'apple',
  'samsung',
  'huawei',
  'honor',
  'xiaomi',
  'redmi',
  'poco',
  'oppo',
  'vivo',
  'oneplus',
  'google',
  'realme',
  'motorola',
  'meizu',
  'zte',
  'nubia',
  'nothing',
  'asus',
  'lenovo',
  'tcl',
  'tecno',
  'infinix',
]);

const CAMERA_MAKES = new Set([
  'sony',
  'canon',
  'nikon',
  'fujifilm',
  'panasonic',
  'olympus',
  'om digital solutions',
  'ricoh',
  'pentax',
  'leica',
  'hasselblad',
  'sigma',
  'dji',
  'gopro',
  'kodak',
  'casio',
]);

/**
 * 将 EXIF 的 Make / Model 归一为设备类型
 * @param {string|undefined} make EXIF Make（厂商）
 * @param {string|undefined} model EXIF Model（型号）
 * @returns {'phone'|'camera'|null} 无法判定时返回 null（调用方不写该字段）
 */
function classifyDevice(make, model) {
  if (typeof make !== 'string' || make.trim() === '') return null;
  const brand = make.trim().toLowerCase();
  // SONY 既产相机又产手机（Xperia），品牌表本身无法区分，故用 Model 级特例优先判定
  if (typeof model === 'string' && /xperia/i.test(model)) return 'phone';
  if (CAMERA_MAKES.has(brand)) return 'camera';
  if (PHONE_MAKES.has(brand)) return 'phone';
  return null;
}

/**
 * 将毫秒时长格式化为人类可读字符串（不足 1 分钟显示秒，保留 1 位小数）
 * @param {number} ms 经过的毫秒数
 * @returns {string} 如 "2分34秒" 或 "5.2秒"
 */
function formatDuration(ms) {
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const restSeconds = Math.round(seconds % 60);
  return `${minutes}分${restSeconds}秒`;
}

/**
 * 将 EXIF 原始时间字符串规范化为 ISO 8601（无时区后缀）
 * EXIF 原始格式为 "2024:05:01 14:32:00"（拍摄地当地时间，不含时区）
 * 输出格式为 "2024-05-01T14:32:00"，语义：拍摄那一刻的当地墙上时间
 * @param {string} raw EXIF 原始时间字符串
 * @returns {string|null} 规范化后的时间字符串，解析失败返回 null
 */
function normalizeExifDateTime(raw) {
  if (typeof raw !== 'string') return null;
  // 匹配 "YYYY:MM:DD HH:mm:ss"（EXIF 标准格式，日期部分用冒号分隔）
  const match = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, y, m, d, h, min, s] = match;
  // 校验各段数字合法，避免脏数据流入 JSON
  if (
    +m < 1 || +m > 12 ||
    +d < 1 || +d > 31 ||
    +h > 23 || +min > 59 || +s > 59
  ) {
    return null;
  }
  return `${y}-${m}-${d}T${h}:${min}:${s}`;
}

/**
 * 使用 sharp 生成 1:1 正方形 WebP 缩略图
 *
 * HEIC 特殊处理：sharp 的预编译二进制出于 HEVC 专利授权原因，
 * 内置的 libheif 不含 HEVC 解码插件，无法解码 iPhone 拍摄的 HEIC
 * （报错表现为 "bad seek to ..." / "heif: Decoder plugin generated
 * an error: Unspecified (7.0)"）。升级 sharp 无法解决（任何版本都一样），
 * 因此 HEIC 先经 macOS 原生 sips 转码为 JPEG，再交给 sharp 缩放。
 * 注意：GPS / DateTimeOriginal 仍由 exifr 直接读取 HEIC 内嵌 EXIF，
 * 不依赖本函数，元数据提取不受影响。
 *
 * @param {string} inputPath 原始图片绝对路径
 * @param {string} outputPath 缩略图保存绝对路径
 */
async function generateThumbnail(inputPath, outputPath) {
  let sharpInput = inputPath;
  let tmpJpegPath = null;

  if (path.extname(inputPath).toLowerCase() === '.heic') {
    // 唯一临时文件名，避免并行处理同名文件时互相覆盖
    const unique = `${path.basename(inputPath, '.heic')}_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    tmpJpegPath = path.join(os.tmpdir(), `${unique}.jpg`);
    await execFileAsync('sips', ['-s', 'format', 'jpeg', inputPath, '--out', tmpJpegPath]);
    sharpInput = tmpJpegPath;
  }

  try {
    await sharp(sharpInput)
      .rotate() // 根据 EXIF 自动纠正图片方向（解决手机拍照倒置问题）
      .resize(THUMB_SIZE, THUMB_SIZE, {
        fit: 'cover',
        // entropy: 基于图像信息量/对比度自动智能抓取视觉焦点
        position: sharp.strategy.entropy,
      })
      .webp({ quality: THUMB_QUALITY })
      .toFile(outputPath);
  } finally {
    if (tmpJpegPath) {
      // 转码产生的临时 JPEG 用完即删，失败也不影响主流程
      await fs.unlink(tmpJpegPath).catch(() => {});
    }
  }
}

/**
 * 使用 sharp 生成 1920px 宽的 AVIF 展示图（保持宽高比，仅限制长边）
 * 供 Lightbox 大图展示使用；原图不再有 webViewLink 入口（2026-10-05 取消），
 * 展示图即最高画质档。
 * HEIC 处理策略与 generateThumbnail 相同：先经 sips 转码为 JPEG。
 *
 * @param {string} inputPath 原始图片绝对路径
 * @param {string} outputPath 展示图保存绝对路径
 */
async function generateDisplayImage(inputPath, outputPath) {
  let sharpInput = inputPath;
  let tmpJpegPath = null;

  if (path.extname(inputPath).toLowerCase() === '.heic') {
    // 唯一临时文件名，避免并行处理同名文件时互相覆盖
    const unique = `${path.basename(inputPath, '.heic')}_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    tmpJpegPath = path.join(os.tmpdir(), `${unique}.jpg`);
    await execFileAsync('sips', ['-s', 'format', 'jpeg', inputPath, '--out', tmpJpegPath]);
    sharpInput = tmpJpegPath;
  }

  try {
    await sharp(sharpInput)
      .rotate() // 根据 EXIF 自动纠正图片方向
      .resize({ width: DISPLAY_SIZE, withoutEnlargement: true }) // 长边限制，不放大
      .avif({ quality: DISPLAY_QUALITY })
      .toFile(outputPath);
  } finally {
    if (tmpJpegPath) {
      await fs.unlink(tmpJpegPath).catch(() => {});
    }
  }
}

/**
 * 判断派生文件是否已比源头新（视频转码的增量跳过判据）。
 * 视频转码单次要 6~19 s，重跑管线不应反复重转；但 fix-gps 补坐标会更新原片
 * mtime——此时必须重转（新坐标要带进转码版），所以判据是
 * "派生文件存在且 mtime ≥ 原片 mtime 才跳过"。
 * @param {string} sourcePath 源文件绝对路径
 * @param {string} derivedPath 派生文件绝对路径
 * @returns {Promise<boolean>}
 */
async function derivedIsUpToDate(sourcePath, derivedPath) {
  const [sourceStat, derivedStat] = await Promise.all([
    fs.stat(sourcePath),
    fs.stat(derivedPath).catch(() => null),
  ]);
  return derivedStat !== null && derivedStat.mtimeMs >= sourceStat.mtimeMs;
}

/**
 * 生成视频转码版（<名>_web.mp4）：libx264 CRF30 + 高度 ≤720p + faststart。
 * 原片不入 data 仓库 git（.gitignore 排除），转码版才是浏览器实际播放的文件。
 *
 * 分两步：① ffmpeg 转码——实测 ffmpeg 会丢光全部元数据（GPS / CreationDate /
 * Make / Model 全空，-map_metadata 0 也救不回）；② exiftool -tagsfromfile 从
 * 原片（真相源）把元数据捞回。因此 fix-gps 补坐标写在原片上，每次转码自动带上，
 * 改档位重转不会丢坐标——与"原图是真相源、派生图可重建"的既有哲学一致。
 *
 * scale 高度表达式 min(720,ih)：分辨率低于 720p 的视频不被放大；
 * '…' 是 ffmpeg filtergraph 自己的引号语法（保护 min() 里的逗号不被当作
 * 过滤器分隔符），经 execFile 无 shell 直接传参，实测可用。
 *
 * @param {string} sourcePath 原片绝对路径
 * @param {string} outputPath 转码版输出绝对路径
 */
async function generateWebVideo(sourcePath, outputPath) {
  if (await derivedIsUpToDate(sourcePath, outputPath)) return;
  await execFileAsync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    sourcePath,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    VIDEO_CRF,
    '-pix_fmt',
    'yuv420p',
    '-vf',
    `scale=-2:'min(${VIDEO_MAX_HEIGHT},ih)'`,
    '-c:a',
    'aac',
    '-b:a',
    VIDEO_AUDIO_BITRATE,
    '-movflags',
    '+faststart',
    outputPath,
  ]);
  await execFileAsync('exiftool', [
    '-overwrite_original',
    '-tagsfromfile',
    sourcePath,
    '-Keys:GPSCoordinates',
    '-Keys:CreationDate',
    '-Make',
    '-Model',
    '-XMP:all',
    outputPath,
  ]);
}

/**
 * 生成视频封面帧缩略图：ffmpeg 抽一帧到临时 PNG → 复用照片缩略图的 sharp 链
 * （300×300 cover + entropy → webp，与 generateThumbnail 完全同一参数）。
 * 抽帧时间取 min(5, duration/2) 秒：避开片头可能的黑帧，也不越过后半段。
 *
 * @param {string} sourcePath 原片绝对路径
 * @param {string} outputPath 缩略图输出绝对路径（<名>_thumb.webp）
 * @param {number|undefined} durationSeconds 视频时长（预检已读出，秒）
 */
async function generateVideoThumbnail(sourcePath, outputPath, durationSeconds) {
  const seekTo = Math.max(0, Math.min(5, (durationSeconds || 0) / 2));
  // 唯一临时文件名，避免并行处理同名文件时互相覆盖（与 HEIC 的 sips 兜底同款写法）
  const unique = `${path.parse(sourcePath).name}_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tmpPngPath = path.join(os.tmpdir(), `${unique}.png`);
  try {
    await execFileAsync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      String(seekTo),
      '-i',
      sourcePath,
      '-frames:v',
      '1',
      tmpPngPath,
    ]);
    await sharp(tmpPngPath)
      .resize(THUMB_SIZE, THUMB_SIZE, {
        fit: 'cover',
        position: sharp.strategy.entropy,
      })
      .webp({ quality: THUMB_QUALITY })
      .toFile(outputPath);
  } finally {
    if (tmpPngPath) {
      await fs.unlink(tmpPngPath).catch(() => {});
    }
  }
}

/**
 * 数据一致性检查（只报告：不修改任何文件、不改变退出码、不调用外部命令）
 *
 * 检查项：孤儿派生文件——`_thumb.webp` / `_display.avif` / `_web.mp4` 找不到同名原媒体。
 * 它们会随 data 仓库一起部署，既占体积也说明原图已被删除（管线不清理它们）。
 * 报告用 ❗ 前缀而非 ⏭️，与"未通过预检的文件夹"这一层判定区分开
 * （后者会改退出码，孤儿文件只报告、不改退出码）。
 *
 * 双根说明：派生文件在 IMGS_DIR、原媒体（配对基准）在 ORIGIN_DIR——基名必须
 * 从原图仓取，否则形态 B 之后全部派生文件都会被误报成孤儿。
 *
 * @param {string[]} dirNames 照片文件夹名列表
 */
async function reportInconsistencies(dirNames) {
  const orphans = [];
  const suffixes = DERIVED_SUFFIXES;

  for (const dirName of dirNames) {
    const dirPath = path.join(IMGS_DIR, dirName);
    let files;
    try {
      files = await fs.readdir(dirPath);
    } catch {
      continue; // 该文件夹已在主流程报错，此处不重复报
    }

    // 原媒体基名集合（不带扩展名），用于与派生文件配对。
    // 视频原片（X.mp4）也在基名集合里——它的转码版 X_web.mp4 因此不算孤儿
    const stems = new Set();
    let originFiles = [];
    try {
      originFiles = await fs.readdir(path.join(ORIGIN_DIR, dirName));
    } catch {
      // 原图仓缺该点位目录：基名为空，下面会如实报孤儿——那是真问题，不该静默
    }
    for (const file of originFiles) {
      if (
        ALLOWED_EXTS.has(path.extname(file).toLowerCase()) &&
        !isDerivedFile(file)
      ) {
        stems.add(path.parse(file).name);
      }
    }

    for (const file of files) {
      const suffix = suffixes.find((s) => file.endsWith(s));
      if (!suffix) continue;
      const stem = file.slice(0, -suffix.length);
      if (!stems.has(stem)) {
        orphans.push({ dirName, file, fullPath: path.join(dirPath, file) });
      }
    }
  }

  console.log('\n数据一致性检查：');
  if (orphans.length === 0) {
    console.log('  ✅ 未发现孤儿派生文件。');
    return;
  }

  console.log(
    color.yellow(
      `  ❗ 发现 ${orphans.length} 个孤儿派生文件（无对应原图，会随 data 仓库一起部署）：`,
    ),
  );
  for (const orphan of orphans) {
    console.log(`    ${orphan.dirName}/${orphan.file}`);
  }
  console.log('  💡 确认后自行清理（本脚本不删除任何文件）：');
  console.log(`    rm ${orphans.map((o) => `"${o.fullPath}"`).join(' ')}`);
}

// 设备识别汇总用：未识别的 "Make / Model" 组合（去重收集，逐张不刷屏）
const unidentifiedDevices = new Set();

/**
 * 设备类型识别汇总（只报告：不修改任何文件、不改变退出码）
 *
 * 逐张照片静默降级（未识别不写 device 字段、角标不显示图标），只在收尾汇总
 * 一次并列出来识别组合——否则新增设备品牌只会无声无息地不显示图标。
 * 前缀用 ℹ️ 而非 ⏭️，与"未通过预检的文件夹"这一层判定区分开
 * （后者会改退出码，未识别设备只报告、不改退出码）。
 *
 * @param {object[]} photos 全部文件夹下的照片对象（已展平）
 */
function reportDeviceTypes(photos) {
  let phone = 0;
  let camera = 0;
  for (const p of photos) {
    if (p.device === 'phone') phone += 1;
    else if (p.device === 'camera') camera += 1;
  }

  console.log('\n设备类型识别：');
  console.log(`  📱 手机 ${phone} 张 / 📷 相机 ${camera} 张`);
  if (unidentifiedDevices.size === 0) {
    console.log('  ✅ 全部照片均已识别。');
    return;
  }
  console.log(
    `  ℹ️ 未识别 ${photos.length - phone - camera} 张（未写 device 字段，角标不显示图标），` +
      '分类表可能需补充：',
  );
  for (const combo of unidentifiedDevices) {
    console.log(`    ${combo}`);
  }
}

// ---------------------------------------------------------------------------
// EXIF 预检（零写操作）
// ---------------------------------------------------------------------------

// 坐标溯源标记前缀：fix-gps 复制坐标时写进 GPSProcessingMethod，用于把"复制来的
// 坐标"与原生坐标区分开。前缀必须存在——相机会自己写该标签（如 "GPS" / "Apple"），
// 没有前缀就无法区分。
const GEO_SOURCE_PREFIX = 'hcm-geosource';

// 同位置锚点合并的距离判据（米）：相距小于此值的锚点视为"同一处"。
// **与 fix-gps.js 的同名常量必须保持一致**——那边据此把锚点合并成"处"并在审阅页
// 分组，这里的 describeAnchorSpread 据此数"落在几处"，口径不一致会让 photos 的
// 提示与审阅页的分组互相矛盾（两个脚本各自独立，不为一个常量引入共享模块）
const ANCHOR_MERGE_METERS = 5;

// 预检的 EXIF 解析配置：一次 parse 取回坐标、拍摄时间、设备、溯源的全部字段
// （沿用既有原则：同一张照片不重复读 EXIF）。分块 pick 是必需的——顶层 pick 会把
// XMP 块一并滤掉，而设备/时间在 IFD0+EXIF 块、坐标在 GPS 块。
// reviveValues: false 返回 EXIF 原始字符串，避免 exifr 转 Date 后 JSON 序列化时
// 被错误地偏移为 UTC 时间。
const PREFLIGHT_EXIF_OPTS = {
  ifd0: { pick: ['Make', 'Model'] },
  exif: { pick: ['DateTimeOriginal'] },
  gps: { pick: ['GPSLatitude', 'GPSLongitude', 'GPSProcessingMethod'] },
  reviveValues: false,
};

/**
 * 解析 EXIF UNDEFINED 类型标签（如 GPSProcessingMethod）的文本值
 *
 * 该类型前 8 字节是字符集标识（"ASCII\0\0\0" / "UNICODE\0"），其后才是正文；
 * exifr 不做这层解码、原样返回字节。非 ASCII 值时 exiftool 写 UNICODE（UTF-16），
 * 字节序随文件 TIFF 头（实拍文件均为小端），故按小端还原。
 *
 * @param {Uint8Array|number[]|string|undefined} raw exifr 读到的原始值
 * @returns {string|null} 解码后的正文，无法解码返回 null
 */
function decodeUndefinedText(raw) {
  if (typeof raw === 'string') return raw;
  if (!raw || typeof raw.length !== 'number' || raw.length <= 8) return null;
  const bytes = Uint8Array.from(raw);
  const charset = String.fromCharCode(...bytes.slice(0, 8)).replace(/\0+$/, '');
  const body = bytes.slice(8);
  if (/^UNICODE$/i.test(charset)) {
    let text = '';
    for (let i = 0; i + 1 < body.length; i += 2) {
      text += String.fromCharCode(body[i] | (body[i + 1] << 8));
    }
    return text.replace(/\0+$/, '');
  }
  return new TextDecoder('utf-8').decode(body).replace(/\0+$/, '');
}

/**
 * 从 GPSProcessingMethod 提取坐标溯源的参照文件名
 *
 * fix-gps 写入的格式为 `hcm-geosource ref=<参照文件名> date=<YYYY-MM-DD>`。
 * 无标记（或标记不是本工具写的）→ undefined，表示原生坐标；
 * 有标记但参照名不可解析 → 'unknown'（仍是复制坐标，不能被误判为原生）。
 *
 * @param {Uint8Array|number[]|string|undefined} raw GPSProcessingMethod 原始值
 * @returns {string|undefined} 参照文件名
 */
function parseGeoSource(raw) {
  const text = decodeUndefinedText(raw)?.trim();
  if (!text || !text.startsWith(GEO_SOURCE_PREFIX)) return undefined;
  const match = /\bref=(.+?)(?:\s+date=\d{4}-\d{2}-\d{2})?$/.exec(text);
  return match ? match[1] : 'unknown';
}

/**
 * 描述预检发现的锚点照片在空间上的分散程度（预检失败 hint 用）。
 * 锚点落在多处时逐张指定参照不现实，用户应走 --review 审阅页，这条摘要
 * 帮用户在跑命令前就对"要分几组"有数。
 * 判据与 fix-gps.js 的 ANCHOR_MERGE_METERS 一致（相距 < 5 m 视为同一处）——
 * 那边据此把锚点合并成"处"并在审阅页分组，口径不同会让提示与页面互相矛盾。
 * @param {{meta: {lat: number, lng: number}}[]} refs 带坐标的照片列表
 * @returns {string} 如 "落在 2 处、最远相距 114 m"；单处时为 "（同一处）"
 */
function describeAnchorSpread(refs) {
  const pts = refs.map((r) => ({ lat: r.meta.lat, lng: r.meta.lng }));
  // 并查集聚类（支持链式邻近：A-B、B-C 相邻则 A/B/C 同处）
  const parent = pts.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (haversineMeters(pts[i], pts[j]) < ANCHOR_MERGE_METERS) {
        parent[find(j)] = find(i);
      }
    }
  }
  const reps = new Map(); // 每处以簇内第一张为代表
  pts.forEach((p, i) => {
    if (!reps.has(find(i))) reps.set(find(i), p);
  });
  const spots = [...reps.values()];
  if (spots.length <= 1) return '（同一处）';
  let max = 0;
  for (let i = 0; i < spots.length; i++) {
    for (let j = i + 1; j < spots.length; j++) {
      max = Math.max(max, haversineMeters(spots[i], spots[j]));
    }
  }
  return `落在 ${spots.length} 处、最远相距 ${Math.round(max)} m`;
}

/** 球面距离（米）。与 fix-gps.js 的同名函数保持一致（两脚本各自独立，未模块化） */function haversineMeters(a, b) {
  const R = 6371000;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * 切掉 exiftool 时间值尾部的时区后缀（如 "+08:00"）。
 * mp4 的拍摄时间在 Keys:CreationDate，带时区后缀；而现有口径是
 * "拍摄地当地墙上时间、无时区"——显式切除后走同一个 normalizeExifDateTime，
 * 把口径写成代码而非依赖其正则"只前缀匹配"的巧合。
 * @param {string|undefined} raw exiftool 读到的时间原始值
 * @returns {string|undefined} 去掉时区后缀的值
 */
function stripTimezoneSuffix(raw) {
  return typeof raw === 'string' ? raw.replace(/[+-]\d{2}:\d{2}$/, '') : raw;
}

/**
 * 读取单个视频的预检元数据（静默：不打印、不写盘）。
 * exifr 读不了 mp4（其解析器面向 EXIF 容器），视频改走 exiftool：一次
 * `-j -n` 调用取回坐标、拍摄时间、设备、溯源、时长全部字段（实测键名：
 * CreationDate 含 "+08:00" 后缀 / GPSLatitude、GPSLongitude 为十进制数 /
 * Make、Model / Duration 为秒）。
 * ⚠️ 拍摄时间必须取 Keys:CreationDate——QuickTime:CreateDate 是
 * "导出时间"（iPhone 从相册导出的时刻），不是拍摄时间，两者可差一整天。
 *
 * @param {string} filePath 视频绝对路径
 * @returns {Promise<{lat, lng, takenAt, make, model, geoSource, duration}>}
 */
async function readVideoMeta(filePath) {
  try {
    const { stdout } = await execFileAsync('exiftool', [
      '-j',
      '-n',
      '-Keys:CreationDate',
      '-GPSLatitude',
      '-GPSLongitude',
      '-GPSProcessingMethod',
      '-Make',
      '-Model',
      '-Duration',
      filePath,
    ]);
    const tags = JSON.parse(stdout)[0] || {};
    return {
      lat: typeof tags.GPSLatitude === 'number' ? tags.GPSLatitude : undefined,
      lng:
        typeof tags.GPSLongitude === 'number' ? tags.GPSLongitude : undefined,
      takenAt: normalizeExifDateTime(stripTimezoneSuffix(tags.CreationDate)),
      make: tags.Make,
      model: tags.Model,
      geoSource: parseGeoSource(tags.GPSProcessingMethod),
      duration:
        typeof tags.Duration === 'number' ? tags.Duration : undefined,
    };
  } catch {
    // 与照片读取同口径：解析失败视同全部缺失，由缺坐标硬拦统一兜住
    return {};
  }
}

/**
 * 读取单张照片 / 单个视频的预检元数据（静默：不打印、不写盘）
 * @param {string} filePath 媒体文件绝对路径
 * @returns {Promise<{lat, lng, takenAt, make, model, geoSource, duration?}>}
 */
async function readPhotoMeta(filePath) {
  // 视频分叉：exifr 读不了 mp4，走 exiftool（duration 仅视频有）
  if (isVideoFile(filePath)) {
    return readVideoMeta(filePath);
  }
  const exif = await exifr.parse(filePath, PREFLIGHT_EXIF_OPTS).catch(() => null);
  return {
    lat: exif?.latitude,
    lng: exif?.longitude,
    takenAt: normalizeExifDateTime(exif?.DateTimeOriginal),
    make: exif?.Make,
    model: exif?.Model,
    geoSource: parseGeoSource(exif?.GPSProcessingMethod),
  };
}

/**
 * 文件夹级预检（只读：读 index.json 与 EXIF，绝不写任何文件）
 *
 * 这是"能不能产出"的唯一判定点，排在生成阶段之前——任何失败都在写第一张
 * 派生图之前暴露，不留半成品（见 docs/plans/2026-10-03-gps-gate-hardening.md）。
 * 失败不抛错，返回带 reason 的对象，由调用方跳过该文件夹而不影响其它文件夹。
 *
 * 双根：`index.json`（站点元数据）与派生图输出在 IMGS_DIR；**原媒体在 ORIGIN_DIR**
 * ——媒体清单与 EXIF 一律从原图仓读，这样"原图是否完整"就是判定输入，硬拦口径不变。
 *
 * @param {string} dirName 文件夹名
 * @returns {Promise<object>} 通过时含 images 等字段；失败时含 reason / hint
 */
async function preflightDir(dirName) {
  const dirPath = path.join(IMGS_DIR, dirName); // 派生图输出目录 / index.json 所在
  const originDirPath = path.join(ORIGIN_DIR, dirName); // 原媒体所在
  try {
    // --- 强校验：检查 index.json 是否存在并解析 ---
    let indexConfig;
    try {
      const indexContent = await fs.readFile(
        path.join(dirPath, 'index.json'),
        'utf-8',
      );
      indexConfig = JSON.parse(indexContent);
    } catch (err) {
      return {
        dirName,
        reason: `缺少 index.json 或文件 JSON 格式不正确: ${err.message}`,
        hint: '修正 index.json 后重跑：npm run photos',
      };
    }

    const coverFileName = indexConfig.index_photo;
    if (!coverFileName) {
      return {
        dirName,
        reason: 'index.json 中未指定 "index_photo"',
        hint: '修正 index.json 后重跑：npm run photos',
      };
    }

    // 过滤出媒体文件（图片 + 视频原片；剔除全部派生文件）——取自原图仓
    let files;
    try {
      files = await fs.readdir(originDirPath);
    } catch (err) {
      return {
        dirName,
        reason: `原图仓中读不到点位目录: ${err.message}`,
        hint: `确认 ${ORIGIN_DIR}/${dirName} 存在且可读后重跑：npm run photos`,
      };
    }
    const mediaFiles = files.filter(
      (file) =>
        ALLOWED_EXTS.has(path.extname(file).toLowerCase()) &&
        !isDerivedFile(file),
    );

    if (mediaFiles.length === 0) {
      return {
        dirName,
        reason: '没有符合格式的媒体文件（jpg / heic / tiff / mp4）',
        hint: '放入照片或视频后重跑：npm run photos',
      };
    }

    // 视频可以当封面（数据层与照片等价，用户 2026-10-04 拍板）：
    // index.json 的 index_photo 就是"任意一张带坐标的原媒体文件名"
    if (!mediaFiles.includes(coverFileName)) {
      return {
        dirName,
        reason: `index.json 指定的封面 "${coverFileName}" 在文件夹中不存在`,
        hint: '修正 index.json 的 index_photo 后重跑：npm run photos',
      };
    }

    // 并行读取全部媒体的元数据（照片走 exifr，视频走 exiftool；路径取自原图仓）
    const images = await Promise.all(
      mediaFiles.map(async (file) => ({
        file,
        filePath: path.join(originDirPath, file),
        meta: await readPhotoMeta(path.join(originDirPath, file)),
      })),
    );

    // 组内任一张缺坐标即判失败（含封面，不再有单独的封面分支）：
    // 相机机身无 GPS 时"相机照缺坐标"是流程的中间态，说明 fix-gps 还没跑，
    // 此时必须零副作用地停下，而不是带着缺坐标的数据继续产出。
    // 视频与照片同口径参与本判定（视频缺坐标同样整组跳过，用户 2026-10-04 拍板）
    const missing = images.filter(
      (image) => image.meta.lat === undefined || image.meta.lng === undefined,
    );
    if (missing.length > 0) {
      // 批量提示按锚点数量分档：0 张无法批量；1 张时参照无歧义，直接给出含参照
      // 文件名的 --all 批量命令；≥2 张时选哪张作参照是分组决策（可能落在多处），
      // 不替用户拍板，改为给出 --review 审阅页命令（页面调整分组后一次写入）。
      // 排除全部派生文件（与 fix-gps 的扫描口径对齐）
      const refs = images.filter(
        (image) =>
          image.meta.lat !== undefined &&
          image.meta.lng !== undefined &&
          !isDerivedFile(image.file),
      );
      let hint = `补坐标后重跑：npm run fix-gps -- "${dirName}"`;
      if (refs.length === 1) {
        hint +=
          `\n或批量复制坐标（将 ${refs[0].file} 的坐标写入其余 ${missing.length} 张）：` +
          `\n    npm run fix-gps -- "${dirName}" --ref ${refs[0].file} --all`;
      } else if (refs.length >= 2) {
        hint +=
          `\n或生成分组审阅页（${refs.length} 张锚点${describeAnchorSpread(refs)}，` +
          '页面定好分组后一次写入）：' +
          `\n    npm run fix-gps -- "${dirName}" --review`;
      }
      return {
        dirName,
        reason: `${missing.length}/${images.length} 张缺坐标`,
        hint,
      };
    }

    return { dirName, dirPath, originDirPath, indexConfig, coverFileName, images };
  } catch (err) {
    return {
      dirName,
      reason: `预检失败: ${err.message}`,
      hint: '排查后重跑：npm run photos',
    };
  }
}

/**
 * 生成阶段：为通过预检的文件夹生成派生图并聚合数据
 * 元数据全部取自预检结果，不再重复读 EXIF。
 * 双根：**读原图**走 ORIGIN_DIR（由预检给出的 filePath），**写派生图**走 IMGS_DIR
 * （dirPath）——派生图是 Pages 要发布的文件，必须落在 data 仓。
 * @param {object} preflight preflightDir 的返回值
 * @returns {Promise<object>} output.json 中的一条文件夹数据
 */
async function buildGroup({ dirName, dirPath, indexConfig, coverFileName, images }) {
  const photos = await Promise.all(
    images.map(async ({ file, filePath, meta }) => {
      const parsed = path.parse(file);
      const thumbFileName = `${parsed.name}${THUMB_SUFFIX}`;
      const displayFileName = `${parsed.name}${DISPLAY_SUFFIX}`;
      const video = isVideoFile(file);

      if (video) {
        // 视频：转码版（浏览器实际播放）+ 封面帧缩略图。
        // 没有"展示图"档（Lightbox 直接播 videoLink）；原片只存原图仓，
        // 且全站已取消"查看原始文件"入口（2026-10-05），故本分支与照片分支
        // 都不再产出 webViewLink
        const webFileName = `${parsed.name}${WEB_VIDEO_SUFFIX}`;
        try {
          await generateWebVideo(filePath, path.join(dirPath, webFileName));
        } catch (videoErr) {
          console.warn(
            color.yellow(
              `⚠️ 生成 ${dirName}/${file} 转码视频失败: ${videoErr.message}`,
            ),
          );
        }
        try {
          await generateVideoThumbnail(
            filePath,
            path.join(dirPath, thumbFileName),
            meta.duration,
          );
        } catch (thumbErr) {
          console.warn(
            color.yellow(
              `⚠️ 生成 ${dirName}/${file} 封面帧缩略图失败: ${thumbErr.message}`,
            ),
          );
        }
      } else {
        // 照片：生成 WebP 缩略图
        try {
          await generateThumbnail(filePath, path.join(dirPath, thumbFileName));
        } catch (thumbErr) {
          console.warn(
            color.yellow(
              `⚠️ 生成 ${dirName}/${file} 缩略图失败: ${thumbErr.message}`,
            ),
          );
        }

        // 生成 WebP 展示图（Lightbox 大图用）
        try {
          await generateDisplayImage(filePath, path.join(dirPath, displayFileName));
        } catch (displayErr) {
          console.warn(
            color.yellow(
              `⚠️ 生成 ${dirName}/${file} 展示图失败: ${displayErr.message}`,
            ),
          );
        }
      }

      if (!meta.takenAt) {
        console.warn(
          color.yellow(
            `⚠️ ${dirName}/${file} 缺失或无法解析拍摄时间，已跳过 takenAt 字段`,
          ),
        );
      }

      const device = classifyDevice(meta.make, meta.model);
      if (!device) {
        // 逐张静默降级，组合收集到收尾汇总里统一报告
        unidentifiedDevices.add(
          `${meta.make ?? '(缺 Make)'} / ${meta.model ?? '(缺 Model)'}`,
        );
      }

      // 数据项：视频与照片的公共部分（坐标/时间/设备/溯源）完全同构，
      // 差异只在链接二元组——视频是 type + videoLink，没有 displayLink；
      // type 缺省即照片（output.json 老数据向后兼容）
      const item = video
        ? {
            fileName: file,
            type: 'video',
            thumbnailLink: `${BASE_URL}/${dirName}/${thumbFileName}`,
            videoLink: `${BASE_URL}/${dirName}/${parsed.name}${WEB_VIDEO_SUFFIX}`,
          }
        : {
            fileName: file,
            thumbnailLink: `${BASE_URL}/${dirName}/${thumbFileName}`,
            displayLink: `${BASE_URL}/${dirName}/${displayFileName}`,
          };
      if (video && meta.duration !== undefined) {
        item.duration = meta.duration;
      }
      if (meta.lat !== undefined && meta.lng !== undefined) {
        item.lat = meta.lat;
        item.lng = meta.lng;
      }
      if (meta.takenAt) {
        item.takenAt = meta.takenAt;
      }
      if (device) {
        item.device = device;
      }
      if (meta.geoSource) {
        // 坐标是 fix-gps 从参照复制来的（预检保证坐标存在，故与 lat/lng 同进退）
        item.geoSource = meta.geoSource;
      }
      return item;
    }),
  );

  // 封面（预检已确认存在且带坐标），组级坐标取封面坐标。
  // 封面可以是视频（用户 2026-10-04 拍板）：视频封面没有展示图档（原片只存
  // 原图仓），组级链接换成 videoLink，并带 type 供前端识别
  const cover = images.find((image) => image.file === coverFileName).meta;
  const coverStem = path.parse(coverFileName).name;
  const coverIsVideo = isVideoFile(coverFileName);

  return {
    lat: cover.lat,
    lng: cover.lng,
    thumbnailLink: `${BASE_URL}/${dirName}/${coverStem}${THUMB_SUFFIX}`,
    ...(coverIsVideo
      ? {
          type: 'video',
          videoLink: `${BASE_URL}/${dirName}/${coverStem}${WEB_VIDEO_SUFFIX}`,
        }
      : {
          displayLink: `${BASE_URL}/${dirName}/${coverStem}${DISPLAY_SUFFIX}`,
        }),
    fileName: coverFileName,
    dirName: dirName,
    ...(indexConfig.description ? { description: indexConfig.description } : {}),
    ...(cover.takenAt ? { takenAt: cover.takenAt } : {}),
    photos: photos,
  };
}

/**
 * 视频工具链预检（AGENTS.md S3：假设命令已存在，缺失即报错退出，不做多路兜底）。
 * 只在本轮扫描到视频时由 processAllPhotos 调用（见其内注释的必要性偏离说明）。
 * 视频的元数据读取走 exiftool、生成走 ffmpeg，两者都是视频分支的硬依赖。
 */
async function ensureVideoToolchain() {
  // 注意参数差异：exiftool 的版本参数是 -ver（-version 会被它当成
  // "读取 version 标签"→ "No file specified" 报错）；ffmpeg 才是 -version
  const required = [
    ['exiftool', ['-ver'], 'brew install exiftool'],
    ['ffmpeg', ['-version'], 'brew install ffmpeg'],
  ];
  for (const [command, versionArgs, install] of required) {
    try {
      await execFileAsync(command, versionArgs);
    } catch {
      throw new Error(`未找到 ${command}，请先安装：${install}`);
    }
  }
}

/**
 * 双根启动预检（AGENTS.md S3：假设环境已就绪，只预检一次，缺失即报错退出，
 * 不做多路兜底）。返回本次要处理的点位目录名列表（两侧取并集）。
 *
 * 规则：
 * - 两个根目录都必须存在，否则报错退出并附建立提示
 * - 只在 **data 侧** 存在的点位 → 报错退出：原图是管线唯一的输入源，
 *   原图仓缺该点位就无从读原图（且极可能是上次搬家漏拷）
 * - 只在 **原图仓** 存在的点位 → 在 data 侧自动建空目录（无害）：缺 index.json
 *   会在文件夹级预检里被正常跳过，而不是让整轮硬失败
 *
 * @returns {Promise<string[]>} 点位目录名（升序、去重）
 */
async function resolvePointDirs() {
  const roots = [
    { label: '原图仓', dir: ORIGIN_DIR },
    { label: 'data 仓', dir: IMGS_DIR },
  ];
  for (const { label, dir } of roots) {
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      throw new Error(
        `${label}的 photos 根目录不存在：${dir}\n` +
          (label === '原图仓'
            ? '请先建立原图仓并放入原图（见 docs/plans/2026-10-04-data-repo-longevity.md 阶段 1）'
            : '请检查 ../data 仓库是否完整'),
      );
    }
  }

  const listDirs = async (root) =>
    (await fs.readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

  const [originDirs, dataDirs] = await Promise.all([
    listDirs(ORIGIN_DIR),
    listDirs(IMGS_DIR),
  ]);
  const originSet = new Set(originDirs);
  const dataSet = new Set(dataDirs);

  const onlyInData = dataDirs.filter((name) => !originSet.has(name));
  if (onlyInData.length > 0) {
    throw new Error(
      `${onlyInData.length} 个点位在 data 仓有目录、原图仓却没有：` +
        `${onlyInData.join('、')}\n` +
        `原图是管线唯一的输入源，请把这些点位的原图放进 ${ORIGIN_DIR}/ 下的同名目录后重跑。`,
    );
  }

  const onlyInOrigin = originDirs.filter((name) => !dataSet.has(name));
  if (onlyInOrigin.length > 0) {
    // 无害：先建空目录，缺 index.json 会在文件夹级预检里被跳过并给出提示
    await Promise.all(
      onlyInOrigin.map((name) =>
        fs.mkdir(path.join(IMGS_DIR, name), { recursive: true }),
      ),
    );
    console.log(
      color.yellow(
        `⚠️ ${onlyInOrigin.length} 个点位只在原图仓存在，已在 data 仓建空目录` +
          `（缺 index.json 会被预检跳过）：${onlyInOrigin.join('、')}`,
      ),
    );
  }

  return [...new Set([...dataDirs, ...originDirs])].sort();
}

/** 打印未通过预检的文件夹清单（一行一个，附下一步命令） */
function reportSkippedDirs(failed) {  console.log(
    color.yellow(`\n⏭️ ${failed.length} 个文件夹未通过预检，本轮不产出数据：`),
  );
  for (const { dirName, reason, hint } of failed) {
    console.log(`  ${dirName}：${reason}`);
    if (hint) console.log(`    ${hint}`);
  }
}

async function processAllPhotos() {
  const startTime = Date.now();
  const startTimeStr = new Date(startTime).toLocaleString('zh-CN', {
    hour12: false,
  });
  console.log(`开始时间: ${startTimeStr}`);
  try {
    console.log(`原图根目录: ${ORIGIN_DIR}（读）`);
    console.log(`派生图根目录: ${IMGS_DIR}（写）`);

    // 1. 双根预检 + 取点位目录列表（两侧并集）
    const subDirs = (await resolvePointDirs()).map((name) => ({ name }));

    console.log(
      `找到 ${subDirs.length} 个子文件夹，开始按文件夹及 index.json 校验生成数据...`,
    );

    // 1.5 视频工具链预检（AGENTS.md S3：假设已装、缺失即报错退出附安装命令）。
    //     仅当存在视频文件时才检查——ffmpeg / exiftool 只服务视频（转码、抽帧、
    //     元数据读取），纯照片文件夹缺 ffmpeg 不该被拦住（plan 已确认的必要偏离）。
    //     视频读取走 exiftool，故 exiftool 一并在此时预检。原片在原图仓，扫 ORIGIN_DIR
    const dirFileLists = await Promise.all(
      subDirs.map((dir) =>
        fs.readdir(path.join(ORIGIN_DIR, dir.name)).catch(() => []),
      ),
    );
    const hasVideo = dirFileLists.some((files) =>
      files.some((file) => isVideoFile(file) && !isDerivedFile(file)),
    );
    if (hasVideo) {
      await ensureVideoToolchain();
    }

    // 2. 预检阶段：全部文件夹先跑完（并发），此阶段零写操作——
    //    一次运行即可看到全部有问题的文件夹，且它们一张派生图都不会留下
    const preflight = await Promise.all(
      subDirs.map((dir) => preflightDir(dir.name)),
    );
    const ready = preflight.filter((result) => result.images);
    const failed = preflight.filter((result) => result.reason);

    if (failed.length > 0) {
      reportSkippedDirs(failed);
      process.exitCode = 1;
    }

    // 3. 生成阶段：通过的文件夹照常生成派生图与数据（元数据复用预检结果）
    const results = await Promise.all(ready.map((result) => buildGroup(result)));

    if (results.length === 0) {
      // 全军覆没时不覆盖 output.json：否则会把线上已发布的照片数据清空，
      // 而这次失败本身只需要一份报错，不需要破坏已有产出
      console.error(
        color.red('\n⛔ 没有任何文件夹通过预检，保留原有 output.json 不予覆盖。'),
      );
      process.exitCode = 1;
    } else {
      // 确保输出目录存在
      await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });

      // 4. 将数组写入 JSON 文件
      await fs.writeFile(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8');
    }

    // 5. 数据一致性检查（只报告，不影响退出码）
    await reportInconsistencies(subDirs.map((dir) => dir.name));

    // 6. 设备类型识别汇总（只报告，不影响退出码）
    if (results.length > 0) {
      reportDeviceTypes(results.flatMap((group) => group.photos));
    }

    console.log(
      results.length === 0
        ? color.yellow('\n⚠️ 本轮没有任何文件夹产出数据（见上）。')
        : `\n处理完成！共生成 ${results.length} 条文件夹数据` +
            (failed.length > 0 ? `，跳过 ${failed.length} 个（见上）。` : '。'),
    );
    if (results.length > 0) {
      console.log(`结果已保存至: ${OUTPUT_FILE}`);
    }
    console.log(
      `耗时: ${formatDuration(Date.now() - startTime)}（结束时间 ${new Date().toLocaleString('zh-CN', { hour12: false })}）`,
    );
  } catch (error) {
    console.error(color.red(`\n⛔ ${error.message}`));
    console.error('任务处理失败，脚本已终止执行。');
    console.error(`已耗时: ${formatDuration(Date.now() - startTime)}`);
    process.exit(1); // 根目录不可读等致命错误才走这里，文件夹级问题已在预检中跳过
  }
}

// 只在作为 CLI 直接运行时才执行；被 require 时（如 test/ 下的单测）保持静默，
// 这样纯函数可以脱离文件系统与外部命令单独测试。
if (require.main === module) {
  processAllPhotos();
}

// 最小公共面：只暴露无副作用的纯函数与常量，供单测导入（node --test）。
// DERIVED_SUFFIXES 一并导出，供跨文件测试断言三个 CLI 的派生后缀口径一致。
module.exports = {
  normalizeExifDateTime,
  stripTimezoneSuffix,
  isVideoFile,
  isDerivedFile,
  ALLOWED_EXTS,
  DERIVED_SUFFIXES,
};
