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
// 轨迹文件扩展名（Apple Watch「户外步行」导出、经手机 gpx export 落到点位目录）。
// **刻意不进 ALLOWED_EXTS**：轨迹不是媒体——进了白名单就会变成 output.json 的一条
// photo 条目、进缺坐标硬拦、进派生图流程，全错。这里只用来判断"该点位是否有轨迹"，
// 从而把预检提示优先指向轨迹路（fix-gps:track）。
// 与 fix-gps.js 的同名常量是同值副本（刻意不抽共享模块），由跨文件测试锁一致。
const TRACK_EXTS = new Set(['.gpx']);
// 视频判定：按扩展名。读取通道（exifr / exiftool）与生成流程按它分叉
const VIDEO_EXTS = new Set(['.mp4']);
const isVideoFile = (file) => VIDEO_EXTS.has(path.extname(file).toLowerCase());
// 站内相对路径：生产环境站点与 data 项目站同域（huochemi.github.io），
// 相对路径解析结果与原绝对 URL 一致；本地开发由 src/setupProxy.js 将
// /data 挂载到本地 data 仓库，无需先提交 data repo 即可预览
const BASE_URL = '/data/photos';

// 参考点位（"想去、还没去过"的点位，见 docs/plans/2026-10-07-ref-places.md、
// 2026-10-07-ref-image-pipeline.md）：点位元数据住在 data 仓的一个目录，
// 参考图的**源图**放原图仓的 `refs/` 子目录（与实拍原片同一条读入口），
// 管线压出的**派生图**落在 data 仓的 `refs/` 子目录。
//
// **判定点唯一**：原图仓该点位目录**顶层有没有媒体文件**决定点位处于哪个阶段——
// 有 = 实拍态（现状路径，组级坐标取封面 EXIF）；没有 = 参考态（组级坐标取
// refs/point.json）。所以 index.json 里不需要任何"我是参考点位"的声明字段，
// 也就不可能出现"声明与实际不符"的矛盾态。
//
// 参考态的全部痕迹落在 refs/ 一个目录里（**refs/ 即"参考态开关"**）：
//   ../photos-originals/photos/<点位>/refs/<下载的原名>.jpg   ← 源图，原样放（不压、不改名）
//   ../data/photos/<点位>/refs/point.json   ← 点位级坐标，人填，GCJ02；可选 "cover"
//   ../data/photos/<点位>/refs/<原名>_thumb.webp / <原名>_display.avif  ← 管线压出的派生图
// point.json: {"lng": <数字>, "lat": <数字>, "cover"?: "<原图文件名>"}
//   cover 指定 marker 用哪张（语义同 index.json 的 index_photo）；不填 ⇒ 字典序第一张。
// 到现场拍完之后把照片放进原图仓同名目录并重跑本脚本，点位自动转为实拍态；
// 收尾把**两仓**的 `refs/` 一起 `rm -rf` 即可——忘了也无害：实拍态根本不读 refs/，
// 只打一行可清理提示。
const REFS_SUBDIR = 'refs';
const REF_POINT_FILE = 'point.json';
// 参考图的图片扩展名白名单（point.json 不是图，不在此列）。
// 这里只看"是不是参考图"，压缩与档位由管线统一负责（与实拍态同一条规则：
// generateThumbnail / generateDisplayImage）。多收几种只是为了让用户手放的
// png/webp 不被判成"0 张"（sharp 原生可读，不必再经 sips 转码）。
const REF_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
// 输出给前端的阶段标记：photo = 实拍态、ref = 参考态。前端**只读**它做视觉与文案
// 分支，判定权始终在本文件的预检（单一判定点，前端不参与判定）。
const PIN_KIND_PHOTO = 'photo';
const PIN_KIND_REF = 'ref';

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

// 增量跳过（2026-10-05）：派生图已是最新（mtime ≥ 原片）就跳过重编码。落地依据与
// 实测（单张 ~0.95 s 里展示图 AVIF 占 84%；全量 326 个派生文件里 324 个无需重算）
// 见 docs/plans/2026-10-05-photos-incremental-skip.md。
//
// `--force`：忽略全部 mtime 判据、强制重新生成。它是判据失灵场景的**统一显式出口**
// （改档位常量后旧派生图仍被判"最新" / 派生文件损坏或 0 字节 / 原地覆盖同名原片且
// 新文件 mtime 更早）——只影响"是否重算"，不改变任何判定与产出内容。
let forceRebuild = false;
// 本轮派生文件计数（复用 / 重新生成），供收尾汇总打印。
// 按**文件**计（一张照片 2 个）而非按媒体计——后者需要在调用点再判一次，
// 等于把同一判据复制成两处口径。
const derivedStats = { reused: 0, generated: 0 };

// 视频转码档位（2026-10-04 用户拍板）：libx264 CRF30、高度压到 ≤720p、
// 保留源帧率、AAC 128k。实测 65.5 MB 原片（1080p60）→ 8.6 MB，
// 档位取舍依据见 docs/plans/2026-10-04-video-mp4-support.md 决策 1
const VIDEO_CRF = '30';
const VIDEO_MAX_HEIGHT = 720;
const VIDEO_AUDIO_BITRATE = '128k';

// 展示图配置：1920px 宽（网页 Lightbox 全屏展示足够），
// 原图动辄数 MB，展示图体积约为原图 1/10，是首屏大图加载的根因优化。
// 2026-10-05 起编码格式由 WebP 换为 AVIF、档位 q50（用户拍板）：真实照片
// **全量**实测 WebP q75 44.6 MB → AVIF q60 38.9 MB（-12.8%）→ AVIF q50
// 26.7 MB（-40.1%）。注意 q60→q70 反而比 WebP q75 更大——两格式质量刻度
// 不同名同值，跨格式比体积必须实测（合成图数据不可外推）。
// 坑：`sharp.format.avif` 是 undefined 属**正常**——AVIF 归在
// `sharp.format.heif` 下（alias: ["avif"]），`.avif()` 方法照常可用，别被误导。
const DISPLAY_SIZE = 1920;
const DISPLAY_QUALITY = 50;

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
  // 增量：派生图已是最新则跳过（--force 时强制重来）
  if (!forceRebuild && (await derivedIsUpToDate(inputPath, outputPath))) {
    derivedStats.reused += 1;
    return;
  }
  derivedStats.generated += 1;

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
  // 增量：派生图已是最新则跳过（--force 时强制重来）
  if (!forceRebuild && (await derivedIsUpToDate(inputPath, outputPath))) {
    derivedStats.reused += 1;
    return;
  }
  derivedStats.generated += 1;

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
 * 判断派生文件是否已比源头新——**全部派生图（缩略图 / 展示图 / 视频转码版 / 视频封面帧）
 * 共用的唯一增量判据**（2026-10-05 起由视频扩展到照片）。
 *
 * 展示图 AVIF 编码单张 ~0.8 s，占单张总耗时约 84%，重跑管线不该反复重编没变动的那些；
 * 但 fix-gps 补坐标会更新原片 mtime——此时必须重建（派生图要带上新元数据 / 新像素），
 * 所以判据是"派生文件存在且 mtime ≥ 原片 mtime 才跳过"。
 *
 * 用 `>=` 而非 `>`：与视频的既有实现保持一致，**不引入第二套比较口径**。判据的失败
 * 方向是安全的——原片 mtime 变新即重建，宁可多算不会漏算；失灵场景（改档位常量、
 * 派生文件损坏、原地覆盖同名原片）由 `--force` 兜住，不做自动探测。
 *
 * @param {string} sourcePath 源文件绝对路径
 * @param {string} derivedPath 派生文件绝对路径
 * @returns {Promise<boolean>} true = 已是最新、可跳过
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
  // 增量：转码版已是最新则跳过（--force 时强制重来）
  if (!forceRebuild && (await derivedIsUpToDate(sourcePath, outputPath))) {
    derivedStats.reused += 1;
    return;
  }
  derivedStats.generated += 1;
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
  // 增量：封面帧已是最新则跳过（--force 时强制重来）。抽帧 + sharp 缩略图约几百 ms，
  // 与照片缩略图同口径——所有派生图走同一个判据，不留例外
  if (!forceRebuild && (await derivedIsUpToDate(sourcePath, outputPath))) {
    derivedStats.reused += 1;
    return;
  }
  derivedStats.generated += 1;

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
 * 扫描某层目录的孤儿派生文件（**纯读写、零删除**；抽成独立函数以便单测在临时目录里跑）。
 *
 * 判定：源媒体基名集合取自 `originDirPath`（原图仓），派生目录里"基名不在集合里"的
 * 派生文件即孤儿。双根说明——派生文件在 IMGS_DIR、配对基准（原媒体）在 ORIGIN_DIR，
 * 否则形态 B 之后全部派生文件都会被误报成孤儿。
 *
 * `failLoud` 决定"原图目录读不到"怎么办（这是本函数唯一的语义分叉）：
 * - `true`（点位目录**顶层**用）：返回 `readError`，调用方据此**停手不删任何文件**。
 *   顶层目录读不到几乎必是异常，"读不到"与"里面确实没有"不可混为一谈。
 * - `false`（`refs/` 一层用）：按空清单处理。`refs/` 目录不存在是**正常态**（实拍态
 *   根本不用参考图），故这一层维持"只报告"。
 *
 * @param {string} originDirPath 原图仓里该层目录（配对基准）
 * @param {string} derivedDirPath data 仓里该层目录（派生图所在）
 * @param {Set<string>} exts 源媒体扩展名白名单
 * @param {{failLoud: boolean, label: string}} opts label 供报告显示
 * @returns {Promise<{label: string, readError: Error|null, total: number,
 *   orphans: {file: string, fullPath: string}[]}>}
 */
async function scanOrphans(originDirPath, derivedDirPath, exts, { failLoud, label }) {
  const result = { label, readError: null, total: 0, orphans: [] };

  let originFiles;
  try {
    originFiles = await fs.readdir(originDirPath);
  } catch (err) {
    if (failLoud) {
      result.readError = err;
      return result;
    }
    originFiles = [];
  }

  // 源媒体基名集合：只认给定扩展名白名单、排除派生后缀
  const stems = new Set();
  for (const file of originFiles) {
    if (exts.has(path.extname(file).toLowerCase()) && !isDerivedFile(file)) {
      stems.add(path.parse(file).name);
    }
  }

  let derivedFiles;
  try {
    derivedFiles = await fs.readdir(derivedDirPath);
  } catch {
    return result; // data 侧无此目录（点位只在原图仓）⇒ 没有派生图可清
  }

  for (const file of derivedFiles) {
    const suffix = DERIVED_SUFFIXES.find((s) => file.endsWith(s));
    if (!suffix) continue;
    result.total += 1;
    const stem = file.slice(0, -suffix.length);
    if (!stems.has(stem)) {
      result.orphans.push({ file, fullPath: path.join(derivedDirPath, file) });
    }
  }
  return result;
}

/**
 * 孤儿清理的**决策纯函数**（无 IO）：给出各层扫描结果，判定本轮"删什么 / 停不停手"。
 *
 * 两道闸门（命中即**整轮零删除**，不做"跳过坏点位、其余照删"的部分分支——少一条规则、
 * 少一处判断；用户 2026-10-09 口径）：
 * - 一 · 读失败：任一层 `readError` 非空 ⇒ 停手。判定基准不可信时，绝不删任何文件。
 * - 二 · 会删空：某点位的派生文件**全部**是孤儿（该点位将被清空）⇒ 停手。整组下线是
 *   另一个量级的决定，沿用 del-photo 的「删后为空」纪律（docs/photo-ops.md）。
 *
 * @param {Awaited<ReturnType<typeof scanOrphans>>[]} scans
 * @returns {{halt: null | {kind: 'read'|'empty', points: object[]}, deletions: object[]}}
 */
function decideCleanup(scans) {
  const readFailures = scans.filter((s) => s.readError);
  if (readFailures.length > 0) {
    return { halt: { kind: 'read', points: readFailures }, deletions: [] };
  }

  const wouldEmpty = scans.filter(
    (s) => s.orphans.length > 0 && s.orphans.length === s.total,
  );
  if (wouldEmpty.length > 0) {
    return { halt: { kind: 'empty', points: wouldEmpty }, deletions: [] };
  }

  const deletions = scans.flatMap((s) =>
    s.orphans.map((o) => ({ label: s.label, file: o.file, fullPath: o.fullPath })),
  );
  return { halt: null, deletions };
}

/**
 * 数据一致性检查与清理（`npm run photos` 收尾的第 5 步）。
 *
 * - **顶层**（实拍态派生图，基准 = 原图仓顶层）：**自动清理**孤儿——原图已删、派生图
 *   残留的文件（只认 `_thumb.webp` / `_display.avif` / `_web.mp4` 三种后缀，绝不动
 *   `index.json`、`point.json` 或目录本身）。清理前先过两道闸门（见 `decideCleanup`），
 *   任一命中即本轮零删除、退出码置 1。
 * - **`refs/` 一层**（参考态派生图，基准 = 原图仓 `refs/`）：**维持只报告**，末附可复制
 *   的 `rm`。不并入自动清理的理由：`refs/` 目录不存在属正常态，要自动清理就得再区分
 *   ENOENT（正常，可清）与 EACCES（异常，停手），又是一套失败分类。
 *
 * 决策依据与实测（读取失败被吞成空清单 ⇒ 好图被判可删）见
 * docs/plans/2026-10-09-photos-orphan-prune.md。
 *
 * @param {string[]} dirNames 点位目录名列表
 */
async function reportAndCleanup(dirNames) {
  const topScans = await Promise.all(
    dirNames.map((dirName) =>
      scanOrphans(
        path.join(ORIGIN_DIR, dirName),
        path.join(IMGS_DIR, dirName),
        ALLOWED_EXTS,
        { failLoud: true, label: dirName },
      ),
    ),
  );

  console.log('\n数据一致性检查与清理：');

  const { halt, deletions } = decideCleanup(topScans);
  if (halt) {
    // 停手 ≠ 硬退：只置退出码，后面的报告（设备类型 / refs/ 残留 / 混合来源）照常打印
    process.exitCode = 1;
    if (halt.kind === 'read') {
      console.log(
        color.red(
          `  ⛔ 有 ${halt.points.length} 个点位的原图目录读不到，` +
            '本轮未清理任何文件（无法确认哪些派生图是多余的）：',
        ),
      );
      for (const s of halt.points) {
        console.log(`    ${s.label}：${s.readError.message}`);
      }
      console.log('    确认该目录存在且可读后重跑：npm run photos');
    } else {
      console.log(
        color.red(
          `  ⛔ 有 ${halt.points.length} 个点位的派生图将被全部清空（原图仓已无对应原片），` +
            '本轮未清理任何文件：',
        ),
      );
      for (const s of halt.points) {
        console.log(`    ${s.label}：${s.total} 个派生文件将被清空`);
      }
      console.log('     整组下线请手动执行（两处目录一起删）：');
      for (const s of halt.points) {
        console.log(
          `       rm -rf "${path.join(IMGS_DIR, s.label)}" "${path.join(ORIGIN_DIR, s.label)}"`,
        );
      }
      console.log('     若只是临时把原片挪走了，放回后重跑本命令即可。');
    }
  } else if (deletions.length === 0) {
    console.log('  ✅ 未发现孤儿派生文件。');
  } else {
    for (const d of deletions) {
      await fs.unlink(d.fullPath);
    }
    console.log(`  ✅ 已清理 ${deletions.length} 个孤儿派生文件（原图已删、派生图残留）：`);
    // 逐点位计数（102 个文件逐行打印是噪声；计数已足够核对 git status）
    const byLabel = new Map();
    for (const d of deletions) {
      byLabel.set(d.label, (byLabel.get(d.label) || 0) + 1);
    }
    for (const [label, count] of byLabel) {
      console.log(`    ${label}：${count} 个文件`);
    }
  }

  // refs/ 一层：维持只报告（不自动清理，理由见函数头注释）
  const refScans = await Promise.all(
    dirNames.map((dirName) =>
      scanOrphans(
        path.join(ORIGIN_DIR, dirName, REFS_SUBDIR),
        path.join(IMGS_DIR, dirName, REFS_SUBDIR),
        REF_IMAGE_EXTS,
        { failLoud: false, label: `${dirName}/${REFS_SUBDIR}` },
      ),
    ),
  );
  const refOrphans = refScans.flatMap((s) =>
    s.orphans.map((o) => ({ label: s.label, file: o.file, fullPath: o.fullPath })),
  );
  if (refOrphans.length > 0) {
    console.log(
      color.yellow(
        `  ❗ 发现 ${refOrphans.length} 个孤儿参考图派生文件（原图仓 refs/ 里已无对应源图）：`,
      ),
    );
    for (const o of refOrphans) {
      console.log(`    ${o.label}/${o.file}`);
    }
    console.log('  💡 refs/ 一层维持"只报告"（不自动清理），确认后自行清理：');
    console.log(`    rm ${refOrphans.map((o) => `"${o.fullPath}"`).join(' ')}`);
  }
}

// 设备识别汇总用：未识别的 "Make / Model" 组合（去重收集，逐张不刷屏）
const unidentifiedDevices = new Set();

// 实拍态却还留着 refs/ 的点位（参考态向实拍态切档后忘了收尾）。
// 逐点位收集、收尾统一提示——与"未识别设备"同为**只报告**类，不改退出码。
const staleRefsDirs = [];

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

/**
 * 混合来源点位提示（只报告：不修改任何文件、不改变退出码、不写进 output.json）
 *
 * "混合" = 同一点位内出现了 **≥2 种补坐标通道**（anchor 锚点复制 / gpx 轨迹插值）。
 * 这是**合法状态**，不是错误：轨迹只覆盖"按下记录"之后的时段，窗口外的照片只能借
 * 锚点，两条通道按照片共存是常态（2026-10-07 用户拍板：不靠"避免混合"来解决，而是
 * 让混合成为一等公民 + 每张照片的来源可判别）。
 * 之所以要打印：点位坐标取**封面照片**的坐标，混合点位里换个封面就会让 marker 移动
 * ——这条性质是已知的（见 docs/photo-metadata.md），但只有看得见才不会被当成 bug。
 *
 * 注意"原生坐标"不计入通道数：手机照自带坐标不属任何补坐标通道，每个点位都有它。
 *
 * @param {{dirName: string, images: {meta: {geoSource?, geoMode?}}[]}[]} ready 通过预检的点位
 */
function reportMixedSources(ready) {
  const lines = [];
  for (const { dirName, images } of ready) {
    const counts = new Map();
    for (const { meta } of images) {
      // geoSource 存在 ⇒ 该张的坐标是补来的；geoMode 与它同源（parseGeoTag 一次得出），
      // 无标记时恒为 'anchor'，故此处无需再兜默认值
      if (!meta.geoSource) continue;
      counts.set(meta.geoMode, (counts.get(meta.geoMode) || 0) + 1);
    }
    if (counts.size < 2) continue;
    lines.push(
      `${dirName}：` +
        [...counts.entries()].map(([mode, n]) => `${mode} ${n} 张`).join(' · '),
    );
  }
  if (lines.length === 0) return;
  console.log('\n混合来源点位（同一点位内两条补坐标通道并用，属合法状态）：');
  for (const line of lines) {
    console.log(`  ${line}`);
  }
  console.log(
    '  ℹ️ 点位坐标取封面照片的坐标；混合点位里换封面会让 marker 移动' +
      '（见 docs/photo-metadata.md）',
  );
}

/**
 * 派生图增量汇总（只报告：不修改任何文件、不改变退出码）
 *
 * 逐张跳过时静默（避免刷屏），只在收尾打印一次文件级计数——否则"为什么这么快"
 * 无从解释，也不易发现判据误判（本该重建的被跳过）。按**文件**计：一张照片 2 个
 * 派生文件（缩略图 + 展示图），一个视频 2 个（封面帧 + 转码版）。
 * 前缀用 ℹ️ 而非 ⏭️——后者是"有问题或本轮未产出、须注意"（黄色，现用于未通过预检的
 * 文件夹）；增量复用是正常行为，不该带警示色。
 */
function reportDerivedStats() {
  console.log('\n派生图增量：');
  console.log(
    `  ℹ️ 复用 ${derivedStats.reused} 个（原图未变动）、重新生成 ${derivedStats.generated} 个`,
  );
}

/**
 * 登记"实拍态却还留着 refs/"的点位（只读，不删任何文件）
 *
 * 切档（参考态 → 实拍态）后 refs/ 是**上一阶段的遗留**，不影响产出——实拍态根本
 * 不读它。两仓各有一处 refs/（原图仓放源图、data 仓放派生图），任何一处残留都要
 * 一起清，故**两处都登记**。这里既不报错也不改退出码（报错会把一个完全合法的
 * 实拍态卡住），只在收尾打一行"可清理"。与"实拍态出现 index_photo 之外的脏字段"
 * 不同：那是说谎的字段，这是过期的文件。
 */
async function collectStaleRefsDir(dirName, dirPath, originDirPath) {
  for (const refsDirPath of [
    path.join(originDirPath, REFS_SUBDIR),
    path.join(dirPath, REFS_SUBDIR),
  ]) {
    try {
      const files = await fs.readdir(refsDirPath);
      staleRefsDirs.push({
        dirName,
        refsDirPath,
        // 数"参考图"（源图 + 派生图），point.json 不是图、不计入
        count: files.filter((file) =>
          REF_IMAGE_EXTS.has(path.extname(file).toLowerCase()),
        ).length,
      });
    } catch {
      // 没有 refs/ ⇒ 正常（绝大多数点位）；读不到（权限等）也不必报——它不是产出判据
    }
  }
}

/** 实拍态残留 refs/ 的收尾提示（只报告：不修改任何文件、不改变退出码） */
function reportStaleRefsDirs() {
  if (staleRefsDirs.length === 0) return;
  console.log('\n实拍态残留的参考图目录：');
  for (const { dirName, refsDirPath, count } of staleRefsDirs) {
    const which = refsDirPath.startsWith(ORIGIN_DIR) ? '原图仓' : 'data 仓';
    console.log(`  ℹ️ ${dirName}（${which}）：已实拍，refs/ 仍存在（${count} 个文件）`);
  }
  console.log(
    '  💡 参考图的使命（去之前熟悉环境）已结束，确认后自行清理（本脚本不删除任何文件）：',
  );
  console.log(`    rm -rf ${staleRefsDirs.map((d) => `"${d.refsDirPath}"`).join(' ')}`);
}

/** 解析命令行参数（当前只支持 --force）。风格对齐 fix-gps.js / new-place.js：未知参数即报错 */
function parseArgs(argv) {
  const args = { force: false };
  for (const arg of argv) {
    if (arg === '--force') {
      args.force = true;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return args;
}

function printUsage() {
  console.log('用法：');
  console.log('  npm run photos             增量生成（派生图已是最新的跳过重编码）');
  console.log('  npm run photos -- --force  忽略增量判据，全部重新生成');
}

// ---------------------------------------------------------------------------
// EXIF 预检（零写操作）
// ---------------------------------------------------------------------------

// 坐标溯源标记前缀：fix-gps 补坐标时写进 GPSProcessingMethod，用于把"复制来的
// 坐标"与原生坐标区分开。前缀必须存在——相机会自己写该标签（如 "GPS" / "Apple"），
// 没有前缀就无法区分。完整格式：
//   `hcm-geosource mode=<anchor|gpx> ref=<参照> date=<日期>`
// mode 记录坐标来自哪条补坐标通道（锚点复制 / GPX 轨迹插值）——同一点位内两条通道
// 可以按照片共存，靠它就事后可判别（见 docs/photo-metadata.md）
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
//
// ⚠️ GPS 块**不做 pick**：exifr 的派生值 latitude/longitude 由 GPSLatitude 的度分秒
// 数组 + 方位标记 GPSLatitudeRef/GPSLongitudeRef（N/S、E/W）算得。一旦 pick，就必须把
// 两个 Ref 一并列上——**漏一个会静默丢符号**（南纬/西经读成正值，点位偏移可达上千公里
// 且没有任何报错；2026-10-06 雅加达即此坑，见
// docs/plans/2026-10-06-gps-sign-loss-and-jakarta.md）。不 pick 则由 exifr 自己按 Ref
// 派生，读坐标的正确性不再依赖"调用方记得带上 Ref"这条隐式契约。
const PREFLIGHT_EXIF_OPTS = {
  ifd0: { pick: ['Make', 'Model'] },
  exif: { pick: ['DateTimeOriginal'] },
  gps: {}, // 不 pick（别加回来）：见上，pick 就必须带上两个 Ref
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
 * 解析坐标溯源标记，得到补坐标通道与参照文件名：
 *   `hcm-geosource mode=<anchor|gpx> ref=<参照> date=<YYYY-MM-DD>`
 *
 * **缺 `mode=` ⇒ mode = 'anchor'**：不是 fallback，而是**准确的历史陈述** ——
 * 溯源标记 2026-10-03（提交 236d984）引入、`mode=` 2026-10-07 才加，中间写入的坐标
 * 只可能来自锚点这一条通道，且无法回填（要逐张重写原片 EXIF）。存量 63 张正是这种形态。
 *
 * 与 fix-gps.js 的同名函数是一对持久化契约（格式改了要两边一起改），行为由
 * test/geo-provenance.test.js 逐例断言两处结果一致。
 *
 * @param {Uint8Array|number[]|string|undefined} raw GPSProcessingMethod 原始值
 * @returns {{mode: string, ref: string}|undefined} undefined = 原生坐标（无本工具的标记）
 */
function parseGeoTag(raw) {
  const text = decodeUndefinedText(raw)?.trim();
  if (!text || !text.startsWith(GEO_SOURCE_PREFIX)) return undefined;
  const modeMatch = /\bmode=([A-Za-z_-]+)\b/.exec(text);
  const refMatch = /\bref=(.+?)(?:\s+date=\d{4}-\d{2}-\d{2})?$/.exec(text);
  return {
    mode: modeMatch ? modeMatch[1] : 'anchor',
    ref: refMatch ? refMatch[1] : 'unknown',
  };
}

/**
 * 从 GPSProcessingMethod 提取坐标溯源的参照文件名
 *
 * fix-gps 写入的格式为 `hcm-geosource mode=<通道> ref=<参照文件名> date=<YYYY-MM-DD>`。
 * 无标记（或标记不是本工具写的）→ undefined，表示原生坐标；
 * 有标记但参照名不可解析 → 'unknown'（仍是复制坐标，不能被误判为原生）。
 *
 * @param {Uint8Array|number[]|string|undefined} raw GPSProcessingMethod 原始值
 * @returns {string|undefined} 参照文件名
 */
function parseGeoSource(raw) {
  return parseGeoTag(raw)?.ref;
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
 * @returns {Promise<{lat, lng, takenAt, make, model, geoSource, geoMode, duration}>}
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
    const geoTag = parseGeoTag(tags.GPSProcessingMethod);
    return {
      lat: typeof tags.GPSLatitude === 'number' ? tags.GPSLatitude : undefined,
      lng:
        typeof tags.GPSLongitude === 'number' ? tags.GPSLongitude : undefined,
      takenAt: normalizeExifDateTime(stripTimezoneSuffix(tags.CreationDate)),
      make: tags.Make,
      model: tags.Model,
      geoSource: geoTag?.ref,
      // 补坐标通道（anchor / gpx）。**只用于收尾汇总的"混合来源点位"提示**，
      // 不进 output.json（前端不消费，写进去就是可推导的冗余字段）。
      geoMode: geoTag?.mode,
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
 * @returns {Promise<{lat, lng, takenAt, make, model, geoSource, geoMode, duration?}>}
 */
async function readPhotoMeta(filePath) {
  // 视频分叉：exifr 读不了 mp4，走 exiftool（duration 仅视频有）
  if (isVideoFile(filePath)) {
    return readVideoMeta(filePath);
  }
  const exif = await exifr.parse(filePath, PREFLIGHT_EXIF_OPTS).catch(() => null);
  const geoTag = parseGeoTag(exif?.GPSProcessingMethod);
  return {
    lat: exif?.latitude,
    lng: exif?.longitude,
    takenAt: normalizeExifDateTime(exif?.DateTimeOriginal),
    make: exif?.Make,
    model: exif?.Model,
    geoSource: geoTag?.ref,
    geoMode: geoTag?.mode,
  };
}

/**
 * 路径是否存在（只读）
 * 只用于把预检的 hint 说得更准（例如"该目录里还有 refs/"），**不参与任何判定**——
 * 判定点始终是"原图仓有没有媒体文件"这一个（见 preflightDir）。
 */
async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * "index.json 缺 description" 的失败结果（实拍态与参考态共用；文案与改造前逐字一致）
 *
 * description 是必填契约（用户 2026-10-05 拍板）：要求的是"key 恒存在"而非"必须有
 * 内容"，故空串合法。hint 必须自足：给出改哪个文件、加什么内容，照做即可跑通。
 * 见 docs/plans/2026-10-05-new-place-scaffold.md
 */
function missingDescriptionResult(dirName, dirPath) {
  return {
    dirName,
    reason: 'index.json 缺少 "description"（或它不是字符串）',
    hint:
      '修正后重跑：npm run photos\n' +
      `    做法：编辑 ${path.join(dirPath, 'index.json')}，` +
      '补上 "description"（可填空串 ""，也可填展示名）',
  };
}

/**
 * 列出被误放进 **data 仓** refs/ 的参考图源图（只读，不改任何文件）
 *
 * 只服务于"源图是不是放错仓了"的失败提示。撤掉 data 仓 .gitignore 的放行后，
 * 误放进 data 仓 refs/ 的源图会被 **静默挡住**（`git status` 看不见），若只回一句
 * "refs/ 下没有图片文件"会让人以为"我明明放了"。故预检失败时多看一眼。
 *
 * @param {string} dataRefsDirPath data 仓该点位 refs/ 目录
 * @returns {Promise<string[]>} 非派生后缀的图片文件名（升序）；目录不存在时为空
 */
async function listMisplacedRefSources(dataRefsDirPath) {
  try {
    const files = await fs.readdir(dataRefsDirPath);
    return files
      .filter(
        (file) =>
          REF_IMAGE_EXTS.has(path.extname(file).toLowerCase()) &&
          !isDerivedFile(file),
      )
      .sort();
  } catch {
    return [];
  }
}

/**
 * 参考点位（"想去、还没去过"）的文件夹级预检（只读：零写操作）
 *
 * 进入条件由调用方判定：**原图仓该点位目录没有媒体文件**、且 index.json 没有
 * index_photo。判定点唯一，不依赖任何"我是参考点位"的声明字段
 * （见 docs/plans/2026-10-07-ref-places.md 的 D1）。
 *
 * 源图位置（甲方案，2026-10-07 拍板）：**原图仓** refs/ 放源图，管线把压好的派生图
 * 写进 **data 仓** refs/ —— 与实拍照片完全同一条规则（见
 * docs/plans/2026-10-07-ref-image-pipeline.md）。源图不进 data 仓，也就永远不会被
 * 公开仓的 .gitignore 与 Pages 配额牵住。
 *
 * 参考态的三个必要条件，任一不满足即该点位失败（不替人猜、不做兜底）：
 *   1. data 仓 `<refs>/point.json` 存在，且 lng / lat 都是**数字**（GCJ02，人填）
 *   2. **原图仓** `<refs>/` 下至少有一张源图（字典序第一张默认当封面）
 *   3. 若 point.json 写了 cover，它必须恰是清单里的一个源图文件名
 *
 * 参考态**不允许**出现 index_photo：它此时指着一个不存在的文件，留下就是说谎的
 * 脏字段（与"宁缺毋假"同口径）⇒ 报错并提示删。**反向不报错**：实拍态还留着 refs/
 * 只是"上一阶段的遗留文件"，管线不读它，由调用方打一行可清理提示即可。
 *
 * @param {string} dirName 文件夹名
 * @param {string} dirPath data 仓该点位目录（index.json / refs/point.json 所在）
 * @param {string} originDirPath 原图仓该点位目录（refs/ 源图所在）
 * @param {object} indexConfig 已解析的 index.json
 * @returns {Promise<object>} 合法时含 refImages；否则含 reason / hint
 */
async function preflightRefPlace(dirName, dirPath, originDirPath, indexConfig) {
  if (typeof indexConfig.description !== 'string') {
    return missingDescriptionResult(dirName, dirPath);
  }

  const dataRefsDirPath = path.join(dirPath, REFS_SUBDIR);
  const originRefsDirPath = path.join(originDirPath, REFS_SUBDIR);

  // 1. 点位级坐标（人工标注，GCJ02）
  let point;
  try {
    point = JSON.parse(
      await fs.readFile(path.join(dataRefsDirPath, REF_POINT_FILE), 'utf-8'),
    );
  } catch (err) {
    return {
      dirName,
      reason: `参考点位缺少可解析的 ${REFS_SUBDIR}/${REF_POINT_FILE}: ${err.message}`,
      hint:
        `参考点位（原图仓还没有照片的点位）必须自带一个点位坐标：${path.join(dataRefsDirPath, REF_POINT_FILE)}\n` +
        '    内容形如 {"lng": 112.6, "lat": 26.8}，坐标口径 GCJ02\n' +
        '    （高德坐标拾取器 https://lbs.amap.com/tools/picker 直接粘贴，不要用 WGS84）\n' +
        `    或整条命令重建：npm run new-place -- "${dirName}" --wish --coord "<lng,lat>"`,
    };
  }
  if (!Number.isFinite(point?.lng) || !Number.isFinite(point?.lat)) {
    return {
      dirName,
      reason: `${REFS_SUBDIR}/${REF_POINT_FILE} 的 lng / lat 必须是数字`,
      hint:
        `修正后重跑：npm run photos\n` +
        `    做法：编辑 ${path.join(dataRefsDirPath, REF_POINT_FILE)}，` +
        '写成 {"lng": 112.6, "lat": 26.8}——**不要写成字符串**（不做隐式转换）',
    };
  }

  // 2. 源图清单（从**原图仓**读；point.json 不是图，不在此列）
  let refFiles = null;
  try {
    refFiles = await fs.readdir(originRefsDirPath);
  } catch {
    // 原图仓 refs/ 不存在（参考态刚建立、还没放图）⇒ 走下面的"没有图片文件"分支
  }
  const refImages = (refFiles || [])
    .filter(
      (file) =>
        REF_IMAGE_EXTS.has(path.extname(file).toLowerCase()) &&
        !isDerivedFile(file),
    )
    .sort();
  if (refImages.length === 0) {
    // 错仓检测：源图误放进 data 仓 refs/。撤掉 .gitignore 放行后这类图会被静默挡住，
    // 不主动看一眼就会给出误导性的"没放图"提示（见 D6）。
    const misplaced = await listMisplacedRefSources(dataRefsDirPath);
    if (misplaced.length > 0) {
      return {
        dirName,
        reason:
          `参考图放错仓了：源图应放**原图仓**，而 data 仓的 ${dataRefsDirPath} 里有 ` +
          `${misplaced.length} 个图片文件`,
        hint:
          '参考图的源图与实拍原片走同一条入口（放原图仓），压缩与派生由管线负责：\n' +
          `    mkdir -p "${originRefsDirPath}" && mv ` +
          misplaced.map((f) => `"${path.join(dataRefsDirPath, f)}"`).join(' ') +
          ` "${originRefsDirPath}/"\n` +
          '    然后重跑：npm run photos',
      };
    }
    return {
      dirName,
      reason: `${REFS_SUBDIR}/ 下没有图片文件`,
      hint:
        '参考点位至少要有一张参考图——它是地图上可点的"入口图"：\n' +
        `    做法：把下载的图**原样**放进原图仓 ${originRefsDirPath}/（不压、不改名）\n` +
        '    压缩与档位由 npm run photos 负责（与实拍照片同一条规则），跑完再提交\n' +
        `    可选：在 ${path.join(dataRefsDirPath, REF_POINT_FILE)} 里用 "cover" 指定 marker 用哪张`,
    };
  }

  // 3. 封面（可选）：point.json 的 cover 必须恰是清单里的一个源图文件名。
  //    与实拍态 index_photo 同语义；不填 ⇒ 字典序第一张（保持默认行为）。非字符串或
  //    不在清单里都算错误——不静默忽略、不猜（与 lng/lat 同口径）。
  if (point.cover !== undefined) {
    if (typeof point.cover !== 'string' || !refImages.includes(point.cover)) {
      return {
        dirName,
        reason: `${REFS_SUBDIR}/${REF_POINT_FILE} 的 "cover" 不是参考图清单里的文件名`,
        hint:
          '修正后重跑：npm run photos\n' +
          `    可选文件名：${refImages.join('、')}\n` +
          `    做法：编辑 ${path.join(dataRefsDirPath, REF_POINT_FILE)}，把 "cover" ` +
          '改成其中之一（也可删掉该键，默认取字典序第一张）',
      };
    }
  }

  return {
    dirName,
    dirPath,
    originDirPath,
    indexConfig,
    point,
    refImages,
    // images 显式给空数组：参考态没有"我拍的照片"参与混合来源 / 设备识别汇总，
    // 空数组让调用方的 `result.images` 真值判定与实拍态保持一致（不必额外分支）
    images: [],
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
        // 提示必须自足（用户 2026-10-05 要求）：给出改哪个文件、或用什么命令建好。
        // 新点位（原图仓已有、data 侧还没配）用脚手架一次建好；不传 --cover 会列出
        // 该点位可选的文件名（new-place 不替你挑封面）。见
        // docs/plans/2026-10-05-photos-no-empty-dir.md、2026-10-05-new-place-scaffold.md
        reason: `缺少 index.json 或文件 JSON 格式不正确: ${err.message}`,
        hint:
          '修正 index.json 后重跑：npm run photos\n' +
          '    新点位可用脚手架一次建好；不传 --cover 会列出该点位可选的文件名：\n' +
          `    npm run new-place -- "${dirName}"`,
      };
    }

    // 媒体清单取自原图仓，它同时是**阶段判据**：有媒体 = 实拍态、没有 = 参考态。
    // 读原图仓失败不再就地返回——参考态点位本来就只存在于 data 仓，原图仓没有它是
    // 正常状态；究竟是不是参考态由下面的分支判定（**带 index_photo 却读不到媒体，
    // 仍按原口径报错**，防"搬家漏拷"的作用一字不减）。
    let files = null;
    let originReadError = null;
    try {
      files = await fs.readdir(originDirPath);
    } catch (err) {
      originReadError = err;
    }
    const mediaFiles = (files || []).filter(
      (file) =>
        ALLOWED_EXTS.has(path.extname(file).toLowerCase()) &&
        !isDerivedFile(file),
    );

    if (mediaFiles.length === 0) {
      if (indexConfig.index_photo) {
        // 有 index_photo、原图仓却找不到媒体：两种情况，下一步不同，故 hint 要按情况给
        // （hint 必须自足是本项目纪律）。这里只**补充上下文**，不改变原判定与文案主体。
        const refsNote = (await pathExists(path.join(dirPath, REFS_SUBDIR)))
          ? `\n    注意：该点位目录里还有 ${REFS_SUBDIR}/——若它其实还没去过（参考态），` +
            'index.json 里不该有 index_photo，删掉该键即可恢复参考态'
          : '';
        return originReadError
          ? {
              dirName,
              reason: `原图仓中读不到点位目录: ${originReadError.message}`,
              hint:
                `确认 ${ORIGIN_DIR}/${dirName} 存在且可读后重跑：npm run photos` +
                refsNote,
            }
          : {
              dirName,
              reason: '没有符合格式的媒体文件（jpg / heic / tiff / mp4）',
              hint: '放入照片或视频后重跑：npm run photos' + refsNote,
            };
      }
      // 没有 index_photo ⇒ 参考态候选（还没去过、只有参考图的点位）
      return preflightRefPlace(dirName, dirPath, originDirPath, indexConfig);
    }

    // === 以下为实拍态：逻辑与文案与改造前逐字一致 ===
    // 唯一的顺序变化：媒体清单的读取提到了 index_photo 校验之前——它是阶段判据，
    // 必须先知道"有没有媒体"才能分叉。下面的失败文案本身一字未改。
    const coverFileName = indexConfig.index_photo;
    if (!coverFileName) {
      return {
        dirName,
        reason: 'index.json 中未指定 "index_photo"',
        hint: '修正 index.json 后重跑：npm run photos',
      };
    }

    // description 是必填契约（用户 2026-10-05 拍板）：不接受"字段可缺失"的兼容态，
    // 缺字段即该点位跳过。要求的是"key 恒存在"而非"必须有内容"，故空串合法。
    // 见 docs/plans/2026-10-05-new-place-scaffold.md
    if (typeof indexConfig.description !== 'string') {
      return missingDescriptionResult(dirName, dirPath);
    }

    // 目录里的轨迹文件（.gpx）：**不是媒体**，不进 mediaFiles、不进 output.json，
    // 只用于把"缺坐标"时的提示优先指向 GPX 通道
    const trackFiles = files.filter((file) =>
      TRACK_EXTS.has(path.extname(file).toLowerCase()),
    );

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
      // 锚点 = **设备是手机**且有坐标（判据与 fix-gps 的锚点池一致，2026-10-07）：
      // 光"有坐标"不够——被补过坐标的相机照不能当参照，否则两条补坐标通道互相污染、
      // 分组结果取决于先跑了哪条通道。未知设备（classifyDevice 返 null）也不作参照，
      // 由 reportDeviceTypes 的收尾汇总显式报出（本脚本口径：宁缺毋假 + 报出来）
      const refs = images.filter(
        (image) =>
          image.meta.lat !== undefined &&
          image.meta.lng !== undefined &&
          classifyDevice(image.meta.make, image.meta.model) === 'phone',
      );
      let hint = `补坐标后重跑：npm run fix-gps:anchor -- "${dirName}"`;
      if (refs.length === 1) {
        hint +=
          `\n或批量复制坐标（将 ${refs[0].file} 的坐标写入其余 ${missing.length} 张）：` +
          `\n    npm run fix-gps:anchor -- "${dirName}" --ref ${refs[0].file} --all`;
      } else if (refs.length >= 2) {
        hint +=
          `\n或生成分组审阅页（${refs.length} 张锚点${describeAnchorSpread(refs)}，` +
          '页面定好分组后一次写入）：' +
          `\n    npm run fix-gps:anchor -- "${dirName}" --review`;
      }
      // 有轨迹文件时把轨迹路顶到最前：轨迹只覆盖"按下记录"之后的时段，窗口外的
      // 照片仍需锚点路 —— 两条提示都给，谁适用由用户/执行结果决定，不互相取代
      if (trackFiles.length > 0) {
        hint =
          `该文件夹有轨迹文件（${trackFiles.join('、')}），优先用轨迹路补坐标：` +
          `\n    npm run fix-gps:track -- "${dirName}"` +
          '\n    （轨迹只覆盖录制时段，时间窗外的照片仍需下面的锚点路）\n' +
          hint;
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
 * 参考点位的构建（与 buildGroup 互斥，判定见 preflightDir）
 *
 * **与实拍态同一条压缩规则**（2026-10-07 起）：源图取自 **原图仓** refs/，用既有
 * generateThumbnail / generateDisplayImage 生成两个档位、写进 **data 仓** refs/。
 * 由此顺带得到三件事：① 用户不必自己压（管线负责）；② 文件名保留原名
 * （`<原名>_thumb.webp` / `<原名>_display.avif`，与实拍态同一条规则，不再编号 01/02）；
 * ③ marker 改用 23–26 KB 的缩略图而非整张图。见
 * docs/plans/2026-10-07-ref-image-pipeline.md。
 *
 * 输出结构与实拍态**同名同形**（lat/lng/dirName/description/references/
 * thumbnailLink/displayLink/fileName/photos），只多一个 pinKind —— 前端因此可以
 * 全量复用 marker/抽屉/Lightbox/信息面板，零新组件。
 *
 * ⚠️ 坐标系不同源：这里的 lat/lng 是**人工标注的 GCJ02**（原样透传，前端**不得**
 * 再送 convertFrom），而实拍态的 lat/lng 是照片 EXIF 的 WGS84（前端必须转换）。
 * 两者靠 pinKind 区分——这是本方案唯一要求前端参与的分支。
 *
 * photos[] 里每张参考图共享同一个点位坐标（点位级单一值，不是"每张图各自有定位"）。
 *
 * @param {object} params 由 preflightRefPlace 的返回值提供
 * @returns {Promise<object>} output.json 中的一条参考态文件夹数据
 */
async function buildRefGroup({
  dirName,
  dirPath,
  originDirPath,
  indexConfig,
  point,
  refImages,
}) {
  const originRefsDirPath = path.join(originDirPath, REFS_SUBDIR);
  const dataRefsDirPath = path.join(dirPath, REFS_SUBDIR);
  await fs.mkdir(dataRefsDirPath, { recursive: true });

  // 封面：point.cover 指定（预检已校验），缺省取字典序第一张（保持默认行为）
  const coverFile = point.cover ?? refImages[0];

  const photos = await Promise.all(
    refImages.map(async (file) => {
      const parsed = path.parse(file);
      const thumbFileName = `${parsed.name}${THUMB_SUFFIX}`;
      const displayFileName = `${parsed.name}${DISPLAY_SUFFIX}`;
      const srcPath = path.join(originRefsDirPath, file);

      try {
        await generateThumbnail(
          srcPath,
          path.join(dataRefsDirPath, thumbFileName),
        );
      } catch (thumbErr) {
        console.warn(
          color.yellow(
            `⚠️ 生成 ${dirName}/${REFS_SUBDIR}/${file} 缩略图失败: ${thumbErr.message}`,
          ),
        );
      }
      try {
        await generateDisplayImage(
          srcPath,
          path.join(dataRefsDirPath, displayFileName),
        );
      } catch (displayErr) {
        console.warn(
          color.yellow(
            `⚠️ 生成 ${dirName}/${REFS_SUBDIR}/${file} 展示图失败: ${displayErr.message}`,
          ),
        );
      }

      return {
        fileName: file,
        thumbnailLink: `${BASE_URL}/${dirName}/${REFS_SUBDIR}/${thumbFileName}`,
        displayLink: `${BASE_URL}/${dirName}/${REFS_SUBDIR}/${displayFileName}`,
        lat: point.lat,
        lng: point.lng,
      };
    }),
  );

  // 预检保证 coverFile 必在清单里（cover 合法、或缺省即 photos[0]），故 find 必命中
  const cover = photos.find((photo) => photo.fileName === coverFile);
  return {
    lat: point.lat,
    lng: point.lng,
    thumbnailLink: cover.thumbnailLink,
    displayLink: cover.displayLink,
    fileName: cover.fileName,
    dirName,
    description: indexConfig.description,
    // references 透传口径与实拍态完全一致（可选、不校验、不排序，见
    // docs/plans/2026-10-05-point-references.md）——参考点位的"来源链接"就走它
    ...(Array.isArray(indexConfig.references)
      ? { references: indexConfig.references }
      : {}),
    pinKind: PIN_KIND_REF,
    photos,
  };
}

/**
 * 生成阶段：为通过预检的文件夹生成派生图并聚合数据
 * 元数据全部取自预检结果，不再重复读 EXIF。
 * 双根：**读原图**走 ORIGIN_DIR（由预检给出的 filePath）、**写派生图**走 IMGS_DIR
 * （dirPath）——派生图是 Pages 要发布的文件，必须落在 data 仓。
 * 参考态（refImages 存在）走 buildRefGroup：同样从原图仓 refs/ 读源图、往 data 仓
 * refs/ 写派生图，只是不读 EXIF、点位坐标取 point.json。
 * @param {object} preflight preflightDir 的返回值
 * @returns {Promise<object>} output.json 中的一条文件夹数据
 */
async function buildGroup({
  dirName,
  dirPath,
  originDirPath,
  indexConfig,
  coverFileName,
  images,
  point,
  refImages,
}) {
  if (refImages) {
    return buildRefGroup({
      dirName,
      dirPath,
      originDirPath,
      indexConfig,
      point,
      refImages,
    });
  }

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

  // 切档后忘了收尾的 refs/ 只登记、不报错（两仓各一处，收尾统一提示，见 reportStaleRefsDirs）
  await collectStaleRefsDir(dirName, dirPath, originDirPath);

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
    // 预检已保证 description 是字符串（缺失即该点位跳过），故无条件写。
    // 不再保留"字段可缺失"的条件展开——那是一种隐性兼容分支（用户 2026-10-05
    // 拍板，见 docs/plans/2026-10-05-new-place-scaffold.md）。
    // 相邻的 takenAt 保留条件展开：那是 EXIF 真实可缺的字段，不属本契约。
    description: indexConfig.description,
    ...(cover.takenAt ? { takenAt: cover.takenAt } : {}),
    // references 是**纯展示**字段（用户 2026-10-05 拍板定为"可选"）：缺省即"该点位没有
    // 外部参考链接"，语义完整、无歧义。它不参与预检判定——"没写链接"绝不该让整组照片被
    // 跳过，故此处只做条件展开透传：不设默认值、不校验、不排序去重（坏数据在前端显式可见，
    // 不静默过滤）。与上面 description 的无条件写相对：那是判定项（缺即该点位跳过）。
    // 见 docs/plans/2026-10-05-point-references.md
    ...(Array.isArray(indexConfig.references)
      ? { references: indexConfig.references }
      : {}),
    // 阶段标记（显式写，不靠前端猜缺省值）：实拍态 = 照片 EXIF 的 WGS84 坐标
    pinKind: PIN_KIND_PHOTO,
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
 * 判断 data 仓的某个点位目录是否为**合法参考态**（只读，零写操作）
 *
 * 供 resolvePointDirs 区分两种"原图仓没有该点位"的情形：
 *   ① 参考态（还没去过，本来就只存在于 data 仓）⇒ 放行
 *   ② 实拍态的原图被删 / 上次搬家漏拷 ⇒ 仍整轮报错
 *
 * 判据写死为两条**同时**成立（显式条件，绝不退化成"无条件放行"）：
 *   1. index.json 里**没有** index_photo —— 有它就说明是实拍态，原图必须存在
 *   2. refs/point.json 能解析出数字 lng / lat
 * 刻意不在这里要求"refs/ 下有参考图"：那是 preflightRefPlace 的判定，
 * 在门口重复判一次只会让"坐标写了但忘了放图"报出"搬家漏拷"这种误导性提示。
 *
 * @param {string} dirPath data 仓该点位目录（收路径而非点位名，便于单测传临时目录）
 */
async function isRefPlace(dirPath) {
  try {
    const indexConfig = JSON.parse(
      await fs.readFile(path.join(dirPath, 'index.json'), 'utf-8'),
    );
    if (indexConfig.index_photo) return false;
    const point = JSON.parse(
      await fs.readFile(
        path.join(dirPath, REFS_SUBDIR, REF_POINT_FILE),
        'utf-8',
      ),
    );
    return Number.isFinite(point?.lng) && Number.isFinite(point?.lat);
  } catch {
    return false;
  }
}

/**
 * 双根启动预检（AGENTS.md S3：假设环境已就绪，只预检一次，缺失即报错退出，
 * 不做多路兜底）。返回本次要处理的点位目录名列表（两侧取并集）。
 *
 * 规则（本函数**全程只读**，不写任何文件/目录）：
 * - 两个根目录都必须存在，否则报错退出并附建立提示
 * - 只在 **data 侧** 存在、且**不是合法参考态**的点位 → 报错退出：原图是管线唯一的
 *   输入源，原图仓缺该点位就无从读原图（且极可能是上次搬家漏拷）。
 *   **参考态是例外**（2026-10-07 新增）："还没去过"的点位本来就只存在于 data 仓，
 *   它的判定条件是显式的（无 index_photo + refs/point.json 坐标合法，见 isRefPlace），
 *   不是无条件放行——防漏拷的作用因此不减。
 * - 只在 **原图仓** 存在的点位 → 不做任何写入，该点位照常进入文件夹级预检，
 *   并因缺 index.json 被跳过（跳过语义与其它失败点位一致）。原先会在此建空目录，
 *   已移除——理由见 docs/plans/2026-10-05-photos-no-empty-dir.md
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

  // 「只在 data 仓存在」的点位分两类（2026-10-07）：
  //   - 合法参考态（还没去过）⇒ 放行：它本来就只存在于 data 仓
  //   - 其余（实拍态的原图被删 / 上次搬家漏拷）⇒ 保留整轮报错，防漏拷作用不减
  const onlyInData = dataDirs.filter((name) => !originSet.has(name));
  const offenders = [];
  for (const name of onlyInData) {
    if (!(await isRefPlace(path.join(IMGS_DIR, name)))) offenders.push(name);
  }
  if (offenders.length > 0) {
    const lines = [
      `${offenders.length} 个点位在 data 仓有目录、原图仓却没有：${offenders.join('、')}`,
      `原图是管线唯一的输入源，请把这些点位的原图放进 ${ORIGIN_DIR}/ 下的同名目录后重跑。`,
      '（若其中有点位是"还没去过"的参考点位，它需要 index.json 无 index_photo ' +
        '且 refs/point.json 坐标合法才算合法参考态：见 docs/photo-ops.md）',
    ];
    // 带 refs/ 的目录是"参考态被改坏"的典型形态，逐点位给出可操作的判据
    for (const name of offenders) {
      if (await pathExists(path.join(IMGS_DIR, name, REFS_SUBDIR))) {
        lines.push(
          `    💡 ${name}：该目录里有 ${REFS_SUBDIR}/（参考态痕迹）——参考态的判据是` +
            ` refs/${REF_POINT_FILE} 里 lng/lat 是数字、且 index.json 里**没有** index_photo`,
        );
      }
    }
    throw new Error(lines.join('\n'));
  }

  // 「只在原图仓存在」的点位不在这里处理：它留在下面的并集里，由文件夹级预检
  // 因缺 index.json 判失败并跳过（提示见 preflightDir）。此处**不做任何写入**——
  // 建空目录曾导致 data 侧留下 git 不可见的半状态，并在原图仓该点位被删除后
  // 命中 onlyInData 而整轮误报失败。见 docs/plans/2026-10-05-photos-no-empty-dir.md

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
    if (forceRebuild) {
      console.log('ℹ️ --force：忽略增量判据，全部重新生成');
    }

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

    // 3.5 派生图增量汇总（只报告，不影响退出码；全军覆没时无内容可报，与设备汇总同条件）
    if (results.length > 0) {
      reportDerivedStats();
    }

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

    // 5. 数据一致性检查与清理：顶层自动清理孤儿派生图，但两道闸门（读失败 / 会删空）
    //    命中时本轮零删除并置退出码 1；refs/ 一层维持只报告
    await reportAndCleanup(subDirs.map((dir) => dir.name));

    // 6. 设备类型识别汇总（只报告，不影响退出码）
    if (results.length > 0) {
      // 参考态不参与：参考图不是我拍的、也没有 device 字段，计入只会把"未识别 N 张"
      // 变成噪声——它不是设备分类表该补的东西
      reportDeviceTypes(
        results
          .filter((group) => group.pinKind !== PIN_KIND_REF)
          .flatMap((group) => group.photos),
      );
    }

    // 6.4 实拍态残留 refs/ 提示（只报告，不影响退出码；无残留时不打印）
    reportStaleRefsDirs();

    // 6.5 混合来源点位提示（只报告，不影响退出码）
    if (ready.length > 0) {
      reportMixedSources(ready);
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
  try {
    forceRebuild = parseArgs(process.argv.slice(2)).force;
  } catch (err) {
    console.error(color.red(`❌ ${err.message}`));
    printUsage();
    process.exit(1);
  }
  processAllPhotos();
}

// 最小公共面：暴露无副作用的纯函数与常量，供单测导入（node --test）。
// DERIVED_SUFFIXES 一并导出，供跨文件测试断言三个 CLI 的派生后缀口径一致。
// PREFLIGHT_EXIF_OPTS 一并导出，供 test/gps-sign.test.js 锁住"读坐标的 gps 块不得 pick"
// 这一口径，并与 fix-gps.js 的 REVIEW_EXIF_OPTS 做跨文件一致性断言。
// derivedIsUpToDate 只读文件系统（不写不删），单测用临时目录 + fs.utimes 锁其语义边界。
// parseGeoTag / TRACK_EXTS / 设备映射表导出，供 test/geo-provenance.test.js 断言
// 它们与 fix-gps.js 的副本同值同行为（两边各存一份、刻意不抽共享模块）。
// 参考态一族（isRefPlace / preflightRefPlace / buildRefGroup）一并导出：它们都收
// 完整路径或纯数据参数，单测可在临时目录里跑，不必碰真仓库（test/ref-places.test.js）。
// scanOrphans（只读）与 decideCleanup（纯函数）导出，供 test/orphan-prune.test.js 在
// 临时目录里锁住两道闸门（读失败 / 会删空即零删除）与后缀白名单。
module.exports = {
  normalizeExifDateTime,
  stripTimezoneSuffix,
  isVideoFile,
  isDerivedFile,
  derivedIsUpToDate,
  ALLOWED_EXTS,
  DERIVED_SUFFIXES,
  PREFLIGHT_EXIF_OPTS,
  parseGeoTag,
  parseGeoSource,
  classifyDevice,
  PHONE_MAKES,
  CAMERA_MAKES,
  TRACK_EXTS,
  isRefPlace,
  preflightRefPlace,
  buildRefGroup,
  scanOrphans,
  decideCleanup,
  REFS_SUBDIR,
  REF_POINT_FILE,
  REF_IMAGE_EXTS,
  PIN_KIND_PHOTO,
  PIN_KIND_REF,
};
