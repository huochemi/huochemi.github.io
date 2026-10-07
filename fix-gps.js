/**
 * fix-gps.js — 交互式补 GPS 坐标工具
 *
 * 为缺失 EXIF GPS 的照片/视频补坐标，写入原文件。两条**互斥的补坐标通道**：
 *   ① 锚点路（--anchor，默认）：从同地点**手机**照片（原生 GPS）复制坐标。手机照是
 *      坐标提供方、相机照是接收方；判据是**设备维度**（classifyDevice），不是
 *      "有没有坐标"——后者会把任何已补过坐标的相机照当成锚点，让两条通道互相污染
 *      且结果与执行顺序相关。
 *   ② 轨迹路（--track）：按拍摄时刻在轨迹文件（.gpx，Apple Watch「户外步行」导出）上插值。
 * 两路都写同一个溯源标记（GPSProcessingMethod：`hcm-geosource mode=<anchor|gpx>
 * ref=<参照> date=<日期>`），让管线能在 output.json 里区分"原生坐标"与"复制坐标"、
 * 以及复制自哪条通道；同时刻意不复制参照的 GPSHPositioningError（避免相机照声称
 * 拥有手机的定位精度）。
 * ⚠️ EXIF 里的 `mode=` 取值仍是 `anchor|gpx`（**持久化契约，不随 CLI 改名**）：
 *   CLI 的 `--track` 与数据里的 `mode=gpx` 是同一件事的两种称呼（一个面向人、一个面向数据）。
 * 两条通道各有对应的 npm 脚本名（`fix-gps:anchor` / `fix-gps:track`），它们只是把
 * `--anchor` / `--track` 预设进命令的快捷方式——**通道的判定点只有一个**：出现 `--track`
 * 即轨迹路，否则锚点路（`--anchor` 是它的显式写法）。
 * 计划：docs/plans/2026-10-07-gpx-coordinate-channel.md（两条通道的设计与决策）
 * 视频支持（2026-10-04）：mp4 与照片同清单、同写入命令（tagsfromfile 对 mp4
 * 原样可用）；元数据读取分叉 exiftool（exifr 读不了 mp4），详见
 * docs/plans/2026-10-04-video-mp4-support.md 与 docs/photo-metadata.md 视频小节。
 * 计划文档：docs/plans/2026-09-26-fix-gps.md、docs/plans/2026-10-03-gps-gate-hardening.md
 *
 * 用法（两条通道各有 npm 脚本名；等价的裸 flag 是 --anchor / --track）：
 *   npm run fix-gps                                       全量扫描所有文件夹
 *   npm run fix-gps:anchor -- 郑州                        锚点路：只处理指定文件夹
 *   npm run fix-gps:anchor -- 郑州 --target a.JPG --ref b.HEIC   手动指定目标与参照（同文件夹）
 *   npm run fix-gps:anchor -- 郑州 --target a.JPG [--yes]  指定目标，参照自动推荐；--yes 免确认
 *   npm run fix-gps:anchor -- 郑州 --ref b.HEIC --all      批量：将参照坐标写入该文件夹
 *                                                         全部缺 GPS 的照片（非交互，命令即确认）
 *   npm run fix-gps:anchor -- 郑州 --review                分组审阅页（多锚点文件夹）：
 *                                                         调整分组后复制一行写入命令。第 5 区为高德
 *                                                         卫星底图，key 取自 .env 的
 *                                                         REACT_APP_AMAP_API_KEY，缺失即报错退出
 *   echo '<计划 JSON>' | npm run fix-gps -- 郑州 --plan-stdin
 *                                                         读入审阅页导出的计划（类型由 JSON 的
 *                                                         mode 字段判定），打印摘要、一次确认写入全部
 *   npm run fix-gps:track -- 石家庄站                      轨迹路：按拍摄时刻在目录内的 .gpx 轨迹上
 *                                                         插值补坐标。时区自动判定（用目录内原生手机照
 *                                                         交叉验证）；--tz +8 / UTC+8 / +5:30 可覆盖。
 *                                                         轨迹只覆盖录制时段：窗内的写、窗外的跳过并
 *                                                         逐张打印（交给锚点路）
 *   npm run fix-gps:track -- 石家庄站 --review             轨迹审阅页：高德底图 + 轨迹折线 + 落点
 *                                                         （带序号）+ 手机锚点照；可排除某几张后复制
 *                                                         写入命令
 * 交互键：y 确认 / n 换参照 / s 跳过 / q 退出（单键，无需回车）
 * 中断后重跑可续作：已写入 GPS 的照片不会再出现在清单里（照片级幂等，两条通道各自如此）。
 * 注：npm run photos 预检失败提示在"恰有 1 张带坐标照片"时会给出 --all 批量命令，
 * "≥2 张锚点"时会给出 --review 审阅页命令。
 * 双根（形态 B，2026-10-05 起）：原片在原图仓 `../photos-originals/photos`，
 * 派生图（含审阅页用的 `_thumb.webp`）在 data 仓 `../data/photos`。本工具读原片、
 * 写原片 EXIF，仅从 data 仓读缩略图；启动时两个根都会预检一次。
 * 计划文档：docs/plans/2026-09-26-fix-gps.md、docs/plans/2026-10-03-gps-gate-hardening.md、
 * docs/plans/2026-10-03-fix-gps-review-page.md、docs/plans/2026-10-04-fix-gps-merge-unit-test.md、
 * docs/plans/2026-10-04-data-repo-longevity.md、
 * docs/plans/2026-10-05-fix-gps-review-amap-embed.md、
 * docs/plans/2026-10-07-gpx-coordinate-channel.md
 * 测试：npm run test:cli（node 内置 runner；测合并/距离/轨迹插值等纯函数与跨文件契约，
 * 不碰照片、不读原图仓）
 */

const fs = require('fs/promises');
const fsNode = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const readline = require('readline');
const { pathToFileURL } = require('url');
const exifr = require('exifr');

const execFileAsync = promisify(execFile);

// 双根（形态 B，2026-10-05 起）：**原图**（真相源）在原图仓，**派生图**（可再生）
// 在 data 仓。本工具只对原片做读写（EXIF 回写写在原片），审阅页缩略图优先取
// data 仓的 `_thumb.webp`。三个 CLI 各存一份同值副本（刻意不抽共享模块），
// 有跨文件测试锁定一致。详见 docs/plans/2026-10-04-data-repo-longevity.md
const ORIGIN_DIR = path.join(__dirname, '../photos-originals/photos');
const IMGS_DIR = path.join(__dirname, '../data/photos');
// 可处理媒体：图片 + 视频（mp4）。视频与照片同口径——缺坐标的视频同样进
// 待修复清单，fix-gps 的 tagsfromfile 写入命令对 mp4 原样可用（实测）
const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.heic', '.tiff', '.mp4']);
// 轨迹文件扩展名（Apple Watch「户外步行」导出、经手机 gpx export 落到点位目录）。
// **刻意不进 ALLOWED_EXTS**：轨迹不是媒体——进了白名单就会污染扫描语义（进待修复
// 清单、进审阅页、进 output.json 的 photos 数组）。它只被 --track 通道单独识别。
// 与 process-photos.js 的同名常量是同值副本（刻意不抽共享模块），由跨文件测试锁一致。
const TRACK_EXTS = new Set(['.gpx']);
const isTrackFile = (file) => TRACK_EXTS.has(path.extname(file).toLowerCase());
// 派生文件名后缀（与 process-photos.js 的口径同值副本，改需同步；
// 跨文件测试锁定一致——坐标只写原片，派生文件永不进扫描）
const DERIVED_SUFFIXES = ['_thumb.webp', '_display.avif', '_web.mp4'];
const isDerivedFile = (file) => DERIVED_SUFFIXES.some((s) => file.endsWith(s));
// 视频判定：exifr 读不了 mp4，坐标/时间的读取通道按它分叉到 exiftool
const isVideoFile = (file) => path.extname(file).toLowerCase() === '.mp4';
const PREVIEW_FILE = path.join(os.tmpdir(), 'fix-gps-preview.html');
// 写入后验证：目标坐标与参照坐标允许的最大偏差（度）
const COORD_EPSILON = 0.001;
// --plan 校验：参照照片实际 EXIF 坐标与计划 JSON 内坐标允许的最大偏差（度）。
// 比写入验证（COORD_EPSILON）严 10 倍：这一步防的是"页面开着太久、参照被改后
// 写入过期计划"，坐标必须精确吻合才算同一份计划
const PLAN_COORD_EPSILON = 0.0001;
// 审阅页：模板与输出位置（输出进临时目录，页面只读，绝不写照片目录）
const REVIEW_TEMPLATE = path.join(__dirname, 'fix-gps-review-template.html');
// 轨迹审阅页模板（--track --review）：与锚点分组页是**两个页面**——那边主体是分组决策、
// 地图只是第 5 区；这边主体就是地图（轨迹折线 + 落点 + 手机锚点照），只做核对与排除。
// 刻意不复用同一模板：结构差异大，硬塞会两边都别扭（与"三个 CLI 各存同值常量"同源思路）
const TRACK_REVIEW_TEMPLATE = path.join(__dirname, 'fix-gps-track-review-template.html');
const REVIEW_OUT_DIR = path.join(os.tmpdir(), 'hcm-fix-gps-review');
// 同位置锚点合并的距离判据（米）：相距小于此值的锚点视为"同一处"，合并为一组。
// 用 5 m 而非"坐标完全相同"，因为同地点隔几分钟连拍时手机 GPS 会有数米漂移；
// 5 m 远小于决策粒度（不同地点通常相隔数十米以上）、也远小于 GPS 自身误差。
// **与 process-photos.js 的同名常量必须保持一致**——那边据此数"锚点落在几处"，
// 口径不一致会让 photos 的提示与审阅页的分组合互相矛盾（两个脚本各自独立，
// 不为一个常量引入共享模块）
const ANCHOR_MERGE_METERS = 5;

// 非 TTY（管道 / 重定向到文件）或 NO_COLOR 时不着色，避免日志混入 ANSI 转义码
const COLOR_ENABLED =
  Boolean(process.stdout.isTTY) && !('NO_COLOR' in process.env);
const paint = (code, s) => (COLOR_ENABLED ? `\x1b[${code}m${s}\x1b[39m` : s);
const color = {
  red: (s) => paint(31, s),
  green: (s) => paint(32, s),
  yellow: (s) => paint(33, s),
  cyan: (s) => paint(36, s),
  // \x1b[22m（normal intensity）才关闭 faint；\x1b[39m 只重置颜色，
  // 会导致暗化泄漏到后续所有输出
  dim: (s) => (COLOR_ENABLED ? `\x1b[2m${s}\x1b[22m` : s),
};

/**
 * 将 EXIF 原始时间字符串规范化为 ISO 8601（无时区后缀）。
 * 与 process-photos.js 的同名函数保持一致（该文件未模块化，此处复制）。
 */
function normalizeExifDateTime(raw) {
  if (typeof raw !== 'string') return null;
  const match = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, y, m, d, h, min, s] = match;
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
 * 切掉 exiftool 时间值尾部的时区后缀（如 "+08:00"）。
 * 与 process-photos.js 的 stripTimezoneSuffix 同口径（该文件未模块化，此处复制）：
 * mp4 的拍摄时间在 Keys:CreationDate、带时区后缀，显式切除后走同一规范化。
 */
function stripTimezoneSuffix(raw) {
  return typeof raw === 'string' ? raw.replace(/[+-]\d{2}:\d{2}$/, '') : raw;
}

/**
 * 读取视频的坐标 / 拍摄时间 / 设备 / 溯源标记（exifr 读不了 mp4，走 exiftool）。
 * 字段口径与 process-photos.js 的 readVideoMeta 一致（两个脚本各自独立，此处复制）；
 * 拍摄时间取 Keys:CreationDate（QuickTime:CreateDate 是导出时间，不是拍摄时间）。
 * Make / Model 一并取回：锚点池判据换成设备维度后，视频也需要判"手机 / 相机"。
 * @returns {Promise<{lat?, lng?, takenAt?, make?, model?, geoSource?}>} 读取失败返回空对象
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
      geoSource: tags.GPSProcessingMethod,
    };
  } catch {
    return {};
  }
}

/** ffmpeg 可用性预检（懒执行，只检一次）：视频抽帧预览才需要（S3：缺失即报错） */
let ffmpegAvailable = false;
async function ensureFfmpeg() {
  if (ffmpegAvailable) return;
  try {
    await execFileAsync('ffmpeg', ['-version']);
  } catch {
    throw new Error('未找到 ffmpeg，请先安装：brew install ffmpeg');
  }
  ffmpegAvailable = true;
}

/** 读取 GPS；返回 { lat, lng } 或 null。写入后验证专用：独立于 readMediaMeta
 *  （验证要换一条读取路径，避免"写错也读错"的自我印证） */
async function readGps(filePath) {
  if (isVideoFile(filePath)) {
    const meta = await readVideoMeta(filePath);
    return meta.lat !== undefined && meta.lng !== undefined
      ? { lat: meta.lat, lng: meta.lng }
      : null;
  }
  try {
    const gps = await exifr.gps(filePath);
    if (gps && gps.latitude !== undefined && gps.longitude !== undefined) {
      return { lat: gps.latitude, lng: gps.longitude };
    }
  } catch {
    // 解析失败视同缺失
  }
  return null;
}

// ---------------------------------------------------------------------------
// 设备分类（锚点池的判据）
// ---------------------------------------------------------------------------

// 拍摄设备分类：把 EXIF 的 Make / Model 归一为「手机 / 相机」两类枚举。
// **这是锚点池的唯一判据**（2026-10-07 用户拍板，见 docs/plans/2026-10-07-gpx-coordinate-channel.md）：
// 手机照是坐标提供方、相机照是接收方。此前用的是"有没有坐标"——任何被补过坐标的相机照
// 都会充数当锚点，两条补坐标通道（锚点 / GPX）互相污染、结果还取决于执行顺序；
// 存量 151 张"有坐标、无溯源标记"的相机照正是这样在充数。
// 品牌表是启发式清单而非权威数据源；未命中任何一条时返回 null，调用方**立即报错退出**
// （决策 ③ fail-early：宁可停下让人补映射，也不猜、不留 fallback）。
// 与 process-photos.js 的同名实现是同值副本（刻意不抽共享模块），由
// test/geo-provenance.test.js 锁两处同值 —— 改一处不同步会在那里爆。
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
 * @returns {'phone'|'camera'|null} 无法判定时返回 null（调用方必须硬错退出，不得降级）
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
 * 未知设备硬错（决策 ③，用户原话："遵从 fail first/fail early 的原则，直接报错，
 * 这样我能很早的发现问题…也就不会让代码中出现 fallback 的逻辑"）。
 * 异常终止而非降级：未知设备无法判定能不能当锚点，任何猜测都会静默污染分组结果。
 * @returns {'phone'|'camera'} 已识别时直接返回，未知则抛错
 */
function assertDeviceKnown(dirName, fileName, make, model) {
  const device = classifyDevice(make, model);
  if (device) return device;
  throw new Error(
    `未知设备：${dirName}/${fileName}\n` +
      `  EXIF: Make="${make ?? '(缺 Make)'}" / Model="${model ?? '(缺 Model)'}"\n` +
      '  锚点池按「设备维度」判定（只有手机照片能提供坐标），未知设备无法判定，' +
      '故立即退出而不是猜测。\n' +
      '  处置：\n' +
      '    1) 在 process-photos.js 的 PHONE_MAKES / CAMERA_MAKES 里加上该品牌；' +
      '若同一品牌既有手机又有相机（如 SONY Xperia），改为按型号加特例。\n' +
      '    2) fix-gps.js 里有一份同值副本（刻意不抽共享模块），必须同步改；' +
      'test/geo-provenance.test.js 会断言两处一致。\n' +
      '    3) 重跑本命令。',
  );
}

/**
 * 读取一张媒体的全部判定字段（照片走 exifr 一次 parse；视频走 exiftool 一次调用）。
 * 与 process-photos.js 的 readPhotoMeta 同口径：**同一张媒体只读一次 EXIF**。
 * @returns {Promise<{lat, lng, takenAt, make, model, geoTag}>}
 *   geoTag = parseGeoTag 的结果（undefined = 原生坐标）
 */
async function readMediaMeta(filePath) {
  if (isVideoFile(filePath)) {
    const meta = await readVideoMeta(filePath);
    return {
      lat: meta.lat,
      lng: meta.lng,
      takenAt: meta.takenAt ?? null,
      make: meta.make,
      model: meta.model,
      geoTag: parseGeoTag(meta.geoSource),
    };
  }
  const exif = await exifr.parse(filePath, REVIEW_EXIF_OPTS).catch(() => null);
  return {
    lat: exif?.latitude,
    lng: exif?.longitude,
    takenAt: normalizeExifDateTime(exif?.DateTimeOriginal),
    make: exif?.Make,
    model: exif?.Model,
    geoTag: parseGeoTag(exif?.GPSProcessingMethod),
  };
}

/**
 * 扫描原图仓，返回三态分类结果（原片只读，坐标才写回）：
 *   refsByDir  = **锚点池**：设备是手机且有坐标的照片（唯一可作参照的来源）
 *   missing    = 待补坐标（无坐标，不论设备）
 *   doneByDir  = 已带坐标的非手机设备（既不进锚点池、也无需处理）
 * @param {string|undefined} filterDir 指定要处理的文件夹时传入：未知设备硬错**只在本命令
 *   实际处理的文件夹上触发**（否则改 A 点位会被 B 点位的陌生机型拦住）。不传 = 全量扫描，
 *   任何文件夹的未知设备都硬错。
 */
async function scan(filterDir) {
  const entries = await fs.readdir(ORIGIN_DIR, { withFileTypes: true });
  const subDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const missing = [];
  const refsByDir = new Map();
  const doneByDir = new Map();

  for (const dirName of subDirs) {
    const dirPath = path.join(ORIGIN_DIR, dirName);
    const files = (await fs.readdir(dirPath)).filter(
      (file) =>
        ALLOWED_EXTS.has(path.extname(file).toLowerCase()) &&
        !isDerivedFile(file),
    );
    const inScope = filterDir === undefined || dirName === filterDir;

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const meta = await readMediaMeta(filePath);
      if (!inScope && classifyDevice(meta.make, meta.model) === null) {
        // 本命令不处理这个文件夹 ⇒ 未知设备连硬错都不该在它身上触发：跳过，
        // 不参与任何清单（该文件夹被单独处理时才会在此报错并要求补映射）
        continue;
      }
      const device = assertDeviceKnown(dirName, file, meta.make, meta.model);
      const entry = { dirName, fileName: file, filePath, takenAt: meta.takenAt };
      if (meta.lat === undefined || meta.lng === undefined) {
        missing.push(entry);
      } else if (device === 'phone') {
        if (!refsByDir.has(dirName)) refsByDir.set(dirName, []);
        refsByDir.get(dirName).push({ ...entry, lat: meta.lat, lng: meta.lng });
      } else {
        if (!doneByDir.has(dirName)) doneByDir.set(dirName, []);
        doneByDir.get(dirName).push(entry);
      }
    }
  }

  return { subDirs, missing, refsByDir, doneByDir };
}

/** 两张照片拍摄时间差的展示文案 */
function formatTimeDiff(target, ref) {
  if (!target.takenAt || !ref.takenAt) return '时间未知';
  const diffSec = Math.round(
    Math.abs(Date.parse(target.takenAt) - Date.parse(ref.takenAt)) / 1000,
  );
  return diffSec >= 60
    ? `${Math.floor(diffSec / 60)} 分 ${diffSec % 60} 秒`
    : `${diffSec} 秒`;
}

// ---------------------------------------------------------------------------
// 预览页生成
// ---------------------------------------------------------------------------

class Preview {
  constructor() {
    // HEIC 无法在 Chrome/Firefox 渲染，预览前 sips 转出的临时 JPEG 路径集合
    this.tmpJpegs = new Set();
    this.browserOpened = false;
  }

  /** 生成可用于 <img src> 的 file:// URL（HEIC 先转临时 JPEG；mp4 抽一帧临时 JPEG） */
  async toImgSrc(filePath) {
    if (isVideoFile(filePath)) {
      // mp4 不能进 <img>：抽第 2 秒一帧作为预览图（封面帧足够判断"是否同一地点"）
      await ensureFfmpeg();
      const parsed = path.parse(filePath);
      const tmpJpeg = path.join(
        os.tmpdir(),
        `fix-gps-preview_${parsed.name}_${process.pid}.jpg`,
      );
      await execFileAsync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-ss',
        '2',
        '-i',
        filePath,
        '-frames:v',
        '1',
        '-q:v',
        '3',
        tmpJpeg,
      ]);
      this.tmpJpegs.add(tmpJpeg);
      return pathToFileURL(tmpJpeg).href;
    }
    if (path.extname(filePath).toLowerCase() !== '.heic') {
      return pathToFileURL(filePath).href;
    }
    const parsed = path.parse(filePath);
    const tmpJpeg = path.join(
      os.tmpdir(),
      `fix-gps-preview_${parsed.name}_${process.pid}.jpg`,
    );
    await execFileAsync('sips', ['-s', 'format', 'jpeg', filePath, '--out', tmpJpeg]);
    this.tmpJpegs.add(tmpJpeg);
    return pathToFileURL(tmpJpeg).href;
  }

  escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async show(target, ref) {
    const [targetSrc, refSrc] = await Promise.all([
      this.toImgSrc(target.filePath),
      this.toImgSrc(ref.filePath),
    ]);

    const card = (tagCls, tagText, src, name, takenAt, extra) => `
      <div class="card">
        <span class="tag ${tagCls}">${tagText}</span>
        <img src="${src}" alt="${tagText}">
        <div class="meta">
          <strong>${this.escapeHtml(name)}</strong><br>
          拍摄时间：${takenAt || '未知'}<br>
          ${extra}
        </div>
      </div>`;

    const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>fix-gps 预览</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #1e1e1e; color: #ddd; margin: 0; padding: 24px; }
  h1 { font-size: 18px; }
  .pair { display: flex; gap: 16px; align-items: flex-start; }
  .card { flex: 1; background: #2a2a2a; border-radius: 8px; padding: 12px; }
  .card img { width: 100%; height: auto; border-radius: 4px; display: block; }
  .tag { display: inline-block; padding: 2px 10px; border-radius: 4px; font-size: 13px; font-weight: 600; margin-bottom: 8px; }
  .target { background: #5a1d1d; color: #ff9c9c; }
  .ref { background: #1d3a5a; color: #9cccff; }
  .meta { font-size: 13px; color: #aaa; margin-top: 8px; line-height: 1.6; }
  code { color: #ffd580; }
</style>
</head>
<body>
  <h1>左边是缺 GPS 的目标照片，右边是有 GPS 的参照照片 —— 判断是否同一地点</h1>
  <div class="pair">
    ${card('target', '目标（待补坐标）', targetSrc, target.fileName, target.takenAt, 'GPS：无')}
    ${card(
      'ref',
      '参照（提供坐标）',
      refSrc,
      ref.fileName,
      ref.takenAt,
      `GPS：<code>${ref.lat.toFixed(6)}, ${ref.lng.toFixed(6)}</code>`,
    )}
  </div>
</body>
</html>`;

    await fs.writeFile(PREVIEW_FILE, html, 'utf-8');

    if (!this.browserOpened) {
      // 整个会话只打开一次浏览器，避免反复抢焦点
      await execFileAsync('open', [
        `${pathToFileURL(PREVIEW_FILE).href}?t=${Date.now()}`,
      ]);
      this.browserOpened = true;
      console.log(
        color.dim('已在浏览器打开预览页；之后的照片请切换到浏览器按 Cmd+R 刷新。'),
      );
    } else {
      console.log(
        color.dim('预览已更新：切换到浏览器窗口，按 Cmd+R 刷新后回来继续。'),
      );
    }
  }

  async cleanup() {
    for (const tmp of [PREVIEW_FILE, ...this.tmpJpegs]) {
      await fs.unlink(tmp).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// 单键交互（raw mode，无需回车）
// ---------------------------------------------------------------------------

const VALID_KEYS = new Set(['y', 'n', 's', 'q']);

// 常驻 keypress 监听 + 按键队列：
// 一次 data 事件可能携带多个字符（readline 逐字符发出多个 keypress），
// 而 waitKey 每次只消费一个——必须把多出的键缓存到队列，否则会丢键导致挂死
const keyQueue = [];
let keyWaiter = null;

function onGlobalKeypress(str, key) {
  if (key && key.ctrl && key.name === 'c') str = 'q';
  if (!VALID_KEYS.has(str)) {
    // 忽略杂散按键（含方向键/控制字符等），避免误退出或误确认
    return;
  }
  process.stdout.write('\n');
  if (keyWaiter) {
    const resolve = keyWaiter;
    keyWaiter = null;
    resolve(str);
  } else {
    keyQueue.push(str);
  }
}

function enableKeyInput() {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on('keypress', onGlobalKeypress);
}

function disableKeyInput() {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.removeListener('keypress', onGlobalKeypress);
  // TTY 的 stdin 不会像管道那样收到 EOF，不停读并解除事件循环占用的话，
  // 进程会在汇总打印后挂住等输入
  process.stdin.pause();
  process.stdin.unref();
}

function waitKey() {
  if (keyQueue.length > 0) {
    return Promise.resolve(keyQueue.shift());
  }
  return new Promise((resolve) => {
    keyWaiter = resolve;
  });
}

// ---------------------------------------------------------------------------
// 写入与验证
// ---------------------------------------------------------------------------

// 坐标溯源标记：写进标准 EXIF 标签 GPSProcessingMethod（该标签的语义就是
// "坐标是怎么来的"）。格式：
//   `hcm-geosource mode=<anchor|gpx> ref=<参照> date=<写入日期>`
// 与 process-photos.js 的 parseGeoTag() 是一对持久化契约，改格式要两边一起改。
// mode 记录坐标来自哪条补坐标通道（2026-10-07 加）：两条通道分步执行时，"这张是哪条
// 路给的"必须事后可判别——否则混合点位无法验收、也无法按时区等口径批量回滚。
// 取值刻意最小化：将来要细分再加，加维是向后兼容的增量（缺 mode 的老数据一律视为
// anchor，理由见 parseGeoTag）。
// 前缀不能省——相机会自己写这个标签（如 "GPS" / "Apple"），没有前缀无法区分
// 原生坐标与复制坐标。
// 选它是实测结果：exifr 能从 JPEG 与 HEIC 的 GPS 块直接读到它（同一张照片一次
// 解析即可），而 XMP 侧的字段 exifr 读不到 HEIC 的 XMP，自定义 XMP 命名空间又
// 需要用户级 exiftool 配置。
const GEO_SOURCE_PREFIX = 'hcm-geosource';
// 可写入的通道取值白名单：写错会永久留在原片的 EXIF 里（且要逐张重写才能改），
// 故在写入端拦住拼错，不给"写进去再发愁"的机会。
const GEO_MODES = new Set(['anchor', 'gpx']);

/** 生成溯源标记值：`hcm-geosource mode=<通道> ref=<参照文件名> date=<YYYY-MM-DD>` */
function buildGeoSourceValue(refFileName, mode) {
  if (!GEO_MODES.has(mode)) {
    throw new Error(
      `内部错误：溯源通道取值非法 "${mode}"（只允许 ${[...GEO_MODES].join(' / ')}）`,
    );
  }
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${GEO_SOURCE_PREFIX} mode=${mode} ref=${refFileName} date=${date}`;
}

/**
 * 写入后验证（两条通道共用）：重读坐标必须与期望值一致，否则视为失败。
 * 走 readGps（exifr.gps）这条**独立于扫描**的读取路径，避免"写错也读错"的自我印证。
 * 容差 COORD_EPSILON（0.001°≈111 m）只用来兜"写入根本没生效"，不做精度判定。
 */
async function verifyGps(target, expected) {
  const gps = await readGps(target.filePath);
  if (
    !gps ||
    Math.abs(gps.lat - expected.lat) > COORD_EPSILON ||
    Math.abs(gps.lng - expected.lng) > COORD_EPSILON
  ) {
    throw new Error(
      `写入后验证失败：${target.dirName}/${target.fileName} 的坐标与参照不一致` +
        (gps ? `（读到 ${gps.lat}, ${gps.lng}）` : '（读不到 GPS）'),
    );
  }
}

/** 锚点通道：从参照（手机照片）**复制**坐标与高程，溯源标记 mode=anchor */
async function writeGps(target, ref) {
  const args = [
    '-overwrite_original',
    '-tagsfromfile',
    ref.filePath,
    '-GPSLatitude',
    '-GPSLatitudeRef',
    '-GPSLongitude',
    '-GPSLongitudeRef',
    '-GPSAltitude',
    '-GPSAltitudeRef',
    // 刻意不复制 GPSHPositioningError：它是参照照片那次定位的误差值，照搬过去等于
    // 让相机照声称拥有手机的定位精度，而真相是"同址推断"——宁缺毋假，该字段留空
    // 溯源标记：记录通道、参照文件名与写入日期
    `-GPSProcessingMethod=${buildGeoSourceValue(ref.fileName, 'anchor')}`,
    target.filePath,
  ];
  await execFileAsync('exiftool', args);
  await verifyGps(target, ref);
}

/**
 * GPX 通道：把**插值算出的坐标**直接写进目标（没有可复制标签的参照文件）。
 * 用 `-n` 写十进制数（否则 exiftool 要求 `38 deg 0' 30.28"` 那种度分秒写法），
 * 方位标记按符号显式给出（与 EXIF 的存储契约一致：WGS84 + Ref 表符号）。
 * 高程只在轨迹确实带 <ele>、且插值两端都有值时写（缺就不写该字段，不编造）。
 */
async function writeGpsFromTrack(target, point, trackFileName) {
  const args = [
    '-overwrite_original',
    '-n',
    `-GPSLatitude=${point.lat}`,
    `-GPSLatitudeRef=${point.lat >= 0 ? 'N' : 'S'}`,
    `-GPSLongitude=${point.lng}`,
    `-GPSLongitudeRef=${point.lng >= 0 ? 'E' : 'W'}`,
  ];
  if (point.ele !== null) {
    args.push(`-GPSAltitude=${point.ele}`, '-GPSAltitudeRef=0');
  }
  args.push(
    `-GPSProcessingMethod=${buildGeoSourceValue(trackFileName, 'gpx')}`,
    target.filePath,
  );
  await execFileAsync('exiftool', args);
  await verifyGps(target, point);
}

// ---------------------------------------------------------------------------
// 计划模式（--plan / --plan-stdin）与分组审阅页（--review）
// ---------------------------------------------------------------------------

/**
 * 解析 EXIF UNDEFINED 类型标签（如 GPSProcessingMethod）的文本值。
 * 与 process-photos.js 的同名函数保持一致（该文件未模块化，此处复制）；
 * parseGeoTag / parseGeoSource 的返回值与 output.json 的 geoSource 字段是一对
 * 持久化契约。
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
 * 解析坐标溯源标记，得到通道与参照文件名：
 *   `hcm-geosource mode=<anchor|gpx> ref=<参照> date=<YYYY-MM-DD>`
 *
 * @returns {{mode: string, ref: string}|undefined}
 *   无标记（或标记不是本工具写的）→ undefined，即**原生坐标**；
 *   有标记但 ref 解析不出 → ref = 'unknown'（仍是复制坐标，不能被误判为原生）。
 *
 * **缺 `mode=` ⇒ mode = 'anchor'**。这不是 fallback，而是**准确的历史陈述**：
 * 溯源标记 2026-10-03（提交 236d984）引入，`mode=` 2026-10-07 才加 —— 中间写入的
 * 全部坐标只可能来自锚点这一条通道（GPX 通道当时还不存在），且那些照片无法回填
 * （要逐张重写原片 EXIF）。存量 63 张正是这种形态，故读侧必须承认这个历史事实。
 *
 * 与 process-photos.js 的同名函数是一对持久化契约，改格式要两边一起改。
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
 * 从 GPSProcessingMethod 提取坐标溯源的参照文件名（旧接口，语义保持不变：
 * 字符串或 undefined）。它与 output.json 的 `geoSource` 字段是一对持久化契约，
 * 故不随 `mode=` 的引入改变返回形态。
 */
function parseGeoSource(raw) {
  return parseGeoTag(raw)?.ref;
}

/**
 * 审阅页扫描的 EXIF 配置：一次 parse 取回坐标、时间、溯源全部字段（分块 pick 必需）
 *
 * ⚠️ GPS 块**不做 pick**：exifr 的派生值 latitude/longitude 由 GPSLatitude 的度分秒
 * 数组 + 方位标记 GPSLatitudeRef/GPSLongitudeRef（N/S、E/W）算得。一旦 pick，就必须
 * 把两个 Ref 一并列上——**漏一个会静默丢符号**（南纬/西经读成正值）。这里丢了符号的
 * 后果比 process-photos 更隐蔽：本文件用 `readGps`（exifr.gps()，带符号）与它交叉校验
 * （见 applyFix 的"计划可能已过期"判定），符号不一致会让南纬点位被误判为计划过期、
 * 整个工具在该点位不可用。口径与 process-photos.js 的 PREFLIGHT_EXIF_OPTS 一致，
 * 由 test/gps-sign.test.js 的跨文件断言锁住（2026-10-06）。
 */
const REVIEW_EXIF_OPTS = {
  ifd0: { pick: ['Make', 'Model'] },
  exif: { pick: ['DateTimeOriginal'] },
  gps: {}, // 不 pick（别加回来）：见上，pick 就必须带上两个 Ref
  reviveValues: false,
};

/** 球面距离（米），用于审阅页头部的锚点间距摘要 */
function haversineMeters(a, b) {
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
 * 同位置锚点合并：相距 < ANCHOR_MERGE_METERS 的锚点视为"同一处"，归为一组
 * （并查集，支持链式邻近：A-B、B-C 相邻则 A/B/C 同组）。
 * 每组用**组内最早拍摄**的锚点作代表，坐标取它自己的——不取平均，避免引入
 * 一个不来自任何照片的"新坐标"，写入结果可与参照照片逐字节对照。
 * @returns 分组数组，元素 = 代表锚点对象 + members（组内全部文件名）
 */
function mergeAnchors(anchors) {
  const parent = anchors.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      if (haversineMeters(anchors[i], anchors[j]) < ANCHOR_MERGE_METERS) {
        parent[find(j)] = find(i);
      }
    }
  }
  const groups = new Map();
  anchors.forEach((anchor, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(anchor);
  });
  return [...groups.values()].map((members) => {
    members.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    return { ...members[0], members: members.map((m) => m.file) };
  });
}

// ---------------------------------------------------------------------------
// 审阅页第 5 区：高德底图需要的两样东西（坐标系转换 + JS API key）
// ---------------------------------------------------------------------------

// 坐标系纪律（与主站 src/Application/cities.js、Map/AMap/LightboxInfoPanel.jsx
// 同源的既有认知）：EXIF 存的是 WGS84，高德底图是 GCJ02，拿 WGS84 直接落点会
// 偏移数百米。**存储层永远是 WGS84**——写回 EXIF、plan JSON 的坐标都不许动；
// 这里算出的 gcj* 只是审阅页第 5 区的显示用派生值。
const GCJ_A = 6378245.0; // 克拉索夫斯基椭球长半轴（GCJ02 标准参数）
const GCJ_EE = 0.00669342162296594323; // 第一偏心率平方

// GCJ02 只对中国境内的坐标做非线性偏移，境外原样直通——这是算法的定义域，
// 不是兜底：境外（如主站的东京/巴黎点位）本就该用 WGS84 落点。
function outOfChina(lat, lng) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function gcjDeltaLat(x, y) {
  let ret =
    -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  ret +=
    ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) /
    3;
  return ret;
}

function gcjDeltaLng(x, y) {
  let ret =
    300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  ret +=
    ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) /
    3;
  return ret;
}

/** WGS84 → GCJ02（业界标准实现，与高德 AMap.convertFrom 偏差约 1 m 级） */
function wgs84ToGcj02(lat, lng) {
  if (outOfChina(lat, lng)) return { lat, lng };
  const dLat = gcjDeltaLat(lng - 105, lat - 35);
  const dLng = gcjDeltaLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  const outLat =
    lat + (dLat * 180) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI);
  const outLng = lng + (dLng * 180) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lat: outLat, lng: outLng };
}

/**
 * 读仓库根 .env 里的一个变量。只做最朴素的 KEY=VALUE 解析，够用即可：
 * 不引 dotenv（那是 react-scripts 的传递依赖，CLI 不该依附它），也**不做**
 * "读不到就找别的来源"的兜底——缺 key 由调用方按 AGENTS.md S3 报错退出。
 * @returns 变量值；.env 不存在、或文件里没有该变量，都返回 null
 */
function readDotenvValue(name) {
  let text = null;
  try {
    text = fsNode.readFileSync(path.join(__dirname, '.env'), 'utf-8');
  } catch {
    return null;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && m[1] === name) {
      return m[2].replace(/^(['"])(.*)\1$/, '$2') || null;
    }
  }
  return null;
}

/**
 * 解析审阅页 <img> 用的缩略图 URL：优先既有派生图 _thumb.webp（npm run photos
 * 的产物，形态 B 后在 data 仓）；没有则非 HEIC / 非 mp4 直接用原图（原图仓）；
 * HEIC 浏览器渲染不了且无派生图 → sips 转临时 JPEG；mp4 不能进 <img> →
 * ffmpeg 抽第 2 秒一帧出临时 JPEG（与交互预览 Preview 同款做法；转出的文件
 * 留在 REVIEW_OUT_DIR 供页面持续引用，不随脚本退出清理）。
 */
async function resolveThumbSrc(originDirPath, dataDirPath, fileName) {
  const stem = path.parse(fileName).name;
  const thumbPath = path.join(dataDirPath, `${stem}_thumb.webp`);
  try {
    await fs.access(thumbPath);
    return pathToFileURL(thumbPath).href;
  } catch {
    // 无派生缩略图（派生图尚未生成，或该点位还没跑过 npm run photos）
  }
  const src = path.join(originDirPath, fileName);
  if (isVideoFile(fileName)) {
    await ensureFfmpeg();
    const tmpJpeg = path.join(REVIEW_OUT_DIR, `${stem}_review.jpg`);
    await execFileAsync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      '2',
      '-i',
      src,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      tmpJpeg,
    ]);
    return pathToFileURL(tmpJpeg).href;
  }
  if (path.extname(fileName).toLowerCase() !== '.heic') {
    return pathToFileURL(src).href;
  }
  const tmpJpeg = path.join(REVIEW_OUT_DIR, `${stem}_review.jpg`);
  await execFileAsync('sips', ['-s', 'format', 'jpeg', src, '--out', tmpJpeg]);
  return pathToFileURL(tmpJpeg).href;
}

/**
 * 扫描单个文件夹，返回审阅页/GPS 路需要的媒体元数据（只读）。
 * 三态分类（判据 1，2026-10-07）：
 *   anchor = 设备是手机**且**有坐标 —— 可作参照的坐标提供方
 *   target = 无坐标（不论设备）—— 待补坐标
 *   done   = 有坐标**且**设备不是手机 —— 已补过的相机照：既不进锚点池（会污染，
 *            让另一条通道的产物反充参照），也不进待办（已修好）；页面上只读可见
 * 未知设备在任何一条通道上都是硬错（决策 ③）。
 */
async function scanDirForReview(dirName) {
  const originDirPath = path.join(ORIGIN_DIR, dirName); // 媒体与 EXIF 来源
  const dataDirPath = path.join(IMGS_DIR, dirName); // 派生缩略图来源
  const files = (await fs.readdir(originDirPath)).filter(
    (file) =>
      ALLOWED_EXTS.has(path.extname(file).toLowerCase()) &&
      !isDerivedFile(file),
  );

  const photos = [];
  for (const file of files) {
    const filePath = path.join(originDirPath, file);
    const meta = await readMediaMeta(filePath);
    const device = assertDeviceKnown(dirName, file, meta.make, meta.model);
    const hasGeo = meta.lat !== undefined && meta.lng !== undefined;
    photos.push({
      file,
      time: meta.takenAt,
      ts: meta.takenAt || '9999',
      kind: !hasGeo ? 'target' : device === 'phone' ? 'anchor' : 'done',
      lat: meta.lat ?? null,
      lng: meta.lng ?? null,
      geoSource: meta.geoTag?.ref ?? null,
      thumb: await resolveThumbSrc(originDirPath, dataDirPath, file),
    });
  }

  photos.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return { photos, anchors: photos.filter((p) => p.kind === 'anchor') };
}

/**
 * 分组审阅页（--review）：扫描文件夹 → 合并同位置锚点 → 注入模板 → 写临时目录 →
 * 打开浏览器。页面纯只读；用户在页面调整分组、复制一行写入命令后，经 --plan-stdin
 * 回到终端写入。
 * @param amapKey 高德 JS API key（main 的 --review 预检已确保非空），注入页面供
 *   第 5 区加载卫星底图
 */
async function runReview(filterDir, amapKey) {
  // 先建输出目录（HEIC 无派生缩略图时扫描阶段就要往里写临时 JPEG）
  await fs.mkdir(REVIEW_OUT_DIR, { recursive: true });
  const { photos, anchors: anchorPhotos } = await scanDirForReview(filterDir);
  const done = photos.filter((p) => p.kind === 'done');

  if (anchorPhotos.length === 0) {
    console.error(
      color.red(
        `❌ 文件夹 "${filterDir}" 内没有**手机**照片作锚点（锚点池只收设备为手机、` +
          '且有原生 GPS 的照片），无法生成审阅页。\n' +
          (done.length > 0
            ? `   该文件夹已有 ${done.length} 张相机照带坐标（属"已补过"，不作参照、不参与分组）。\n`
            : '') +
          '   若该点位确实还没补过坐标，可从手机导出一张当时在附近拍的照片放入该文件夹后重跑；' +
          '若该点位有轨迹文件，改用轨迹路：npm run fix-gps:track -- "' +
          filterDir +
          '"',
      ),
    );
    process.exit(1);
  }
  const targets = photos.filter((p) => p.kind === 'target');
  if (targets.length === 0) {
    console.log(
      '✅ 没有缺 GPS 的照片，无需处理。' +
        (done.length > 0 ? `（另有 ${done.length} 张相机照已带坐标）` : ''),
    );
    return;
  }

  // 同位置锚点合并：anchors 从此是"处"（每组带 members），不是逐张锚点。
  // 页面按组合并显示，plan 的 ref 用组代表（组内最早拍摄者）。
  const anchors = mergeAnchors(anchorPhotos);

  // 各处代表之间的最大距离（页面示意图与摘要用）
  let anchorDistance = null;
  if (anchors.length >= 2) {
    anchorDistance = Math.round(
      Math.max(
        ...anchors.flatMap((a, i) =>
          anchors.slice(i + 1).map((b) => haversineMeters(a, b)),
        ),
      ),
    );
  }

  const data = {
    dir: filterDir,
    generatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    anchorDistance,
    amapKey,
    // 第 5 区的 GCJ02 落点：**只加 gcjLat / gcjLng 两个新字段**，lat / lng 保持
    // WGS84 原值（写入链路与 plan JSON 都读它们，一旦被覆盖就是坐标污染）
    anchors: anchors.map((a) => {
      const gcj = wgs84ToGcj02(a.lat, a.lng);
      return { ...a, gcjLat: gcj.lat, gcjLng: gcj.lng };
    }),
    photos,
  };

  const template = await fs.readFile(REVIEW_TEMPLATE, 'utf-8');
  const html = template.replace('/*__DATA__*/ null', JSON.stringify(data));
  const outPath = path.join(REVIEW_OUT_DIR, `${filterDir}.html`);
  await fs.writeFile(outPath, html, 'utf-8');

  await execFileAsync('open', [`${pathToFileURL(outPath).href}?t=${Date.now()}`]);
  console.log(color.green(`✅ 审阅页已生成并打开：${outPath}`));
  console.log(
    color.dim(
      [
        `  ${anchorPhotos.length} 张锚点合并为 ${anchors.length} 处位置` +
          (anchors.some((a) => a.members.length > 1)
            ? `（同处：${anchors
                .filter((a) => a.members.length > 1)
                .map((a) => `${a.file} 等 ${a.members.length} 张`)
                .join('、')}）`
            : ''),
        '  页面只读、不写任何照片。在页面上调整好分组后点「复制写入命令」，',
        '  回到终端直接粘贴、回车，再按一次 y 写入全部。',
        ...(done.length > 0
          ? [
              `  ℹ️ 另有 ${done.length} 张相机照已带坐标：页面里是灰色只读条——` +
                '既不作参照也不进待办（避免另一条通道的产物反充锚点），不可点开、不可改投。',
            ]
          : []),
      ].join('\n'),
    ),
  );
}

/** 读取计划 JSON：从 stdin 管道读（页面「复制写入命令」给出的一行命令自带 JSON） */
async function readPlanJson() {
  const raw = await new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('计划内容不是合法 JSON');
  }
}

/**
 * 批量确认：--plan-stdin 时 stdin 是管道，确认键改从 /dev/tty 读（行输入，需回车）。
 * 返回 true=写入；false=放弃；null=无法交互（提示用户加 --yes）。
 */
async function confirmBatch(prompt, yes) {
  if (yes) return true;
  if (process.stdin.isTTY) {
    enableKeyInput();
    try {
      process.stdout.write(color.cyan(prompt));
      const key = await waitKey();
      return key === 'y';
    } finally {
      disableKeyInput();
    }
  }
  // 刻意用同步阻塞读，而不是 fs.createReadStream('/dev/tty') + readline：
  // 流会在 /dev/tty 上留一个挂着的读请求（阻塞在 threadpool 里等输入），
  // rl.close() 只暂停接口、stream.destroy() 也要等该请求完成——两者都取消不掉，
  // 于是事件循环永不 drain，汇总打印完进程就停住不退出（2026-10-04 实测，
  // 插桩可见收尾时 getActiveRequests() 仍挂着 fs 请求）。
  // 同步读在 canonical 模式下由回车提交，读完即关 fd，无任何残留句柄。
  let ttyFd;
  try {
    ttyFd = fsNode.openSync('/dev/tty', 'r');
    process.stdout.write(color.cyan(prompt));
    const buf = Buffer.alloc(256);
    const bytes = fsNode.readSync(ttyFd, buf, 0, buf.length, null);
    return buf.slice(0, bytes).toString('utf-8').trim().toLowerCase() === 'y';
  } catch {
    console.error(
      color.red(
        '❌ 无法读取确认输入（stdin 非 TTY 且 /dev/tty 不可用）。确认无误可加 --yes 跳过确认。',
      ),
    );
    return null;
  } finally {
    if (ttyFd !== undefined) {
      try {
        fsNode.closeSync(ttyFd);
      } catch {
        // fd 已关闭，忽略
      }
    }
  }
}

/**
 * 计划模式（`--plan-stdin`）：校验计划 → 打印摘要 → 一次确认 → 批量写入。
 * 校验链任一失败即报错退出 1、零写入；目标已带坐标的自动跳过（幂等续作）。
 *
 * 两条通道共用这一个入口，**类型由计划自带的 `mode` 字段判定**（判定点唯一，不在
 * 命令行再指定 --anchor / --track，避免两处口径）：
 *   `mode: 'gpx'` ⇒ 转 `runTrackPlan`（轨迹计划，坐标由工具按时刻插值算出）
 *   缺 `mode`     ⇒ 锚点计划（历史陈述：2026-10-07 之前只有锚点这一条通道）
 */
async function runPlan(rawPlan, filterDir, yes) {
  if (!rawPlan || typeof rawPlan !== 'object' || Array.isArray(rawPlan)) {
    throw new Error('计划顶层必须是对象（含 dir 与 groups）');
  }
  if (rawPlan.dir !== filterDir) {
    throw new Error(
      `计划中的文件夹 "${rawPlan.dir}" 与命令行指定的 "${filterDir}" 不一致`,
    );
  }
  if (rawPlan.mode === 'gpx') {
    return runTrackPlan(rawPlan, filterDir, yes);
  }
  if (rawPlan.mode !== undefined) {
    throw new Error(
      `计划里的 mode "${rawPlan.mode}" 无法识别（应为 'gpx'；不写 mode 表示锚点计划）`,
    );
  }
  const groups = rawPlan.groups;
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error('计划 groups 为空（至少需要一组参照 → 目标）');
  }

  const dirPath = path.join(ORIGIN_DIR, filterDir);
  const seenTargets = new Map();
  const resolved = [];

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const tag = `组 ${gi + 1}`;
    if (!g || typeof g !== 'object') throw new Error(`${tag} 不是对象`);
    if (typeof g.ref !== 'string' || !g.ref) {
      throw new Error(`${tag} 缺少参照文件名 ref`);
    }
    if (typeof g.lat !== 'number' || typeof g.lng !== 'number') {
      throw new Error(`${tag} 的参照 ${g.ref} 缺少 lat / lng 坐标`);
    }
    if (!Array.isArray(g.targets) || g.targets.length === 0) {
      throw new Error(`${tag} 的 targets 为空`);
    }
    if (!ALLOWED_EXTS.has(path.extname(g.ref).toLowerCase())) {
      throw new Error(`${tag} 的参照 ${g.ref} 不是可处理的媒体文件`);
    }

    const refPath = path.join(dirPath, g.ref);
    try {
      await fs.access(refPath);
    } catch {
      throw new Error(`${tag} 的参照 "${g.ref}" 不存在于文件夹 "${filterDir}"`);
    }
    const actual = await readGps(refPath);
    if (!actual) {
      throw new Error(`${tag} 的参照 ${g.ref} 当前没有 GPS 坐标，计划已过期`);
    }
    if (
      Math.abs(actual.lat - g.lat) > PLAN_COORD_EPSILON ||
      Math.abs(actual.lng - g.lng) > PLAN_COORD_EPSILON
    ) {
      throw new Error(
        `${tag} 的参照 ${g.ref} 实际坐标 (${actual.lat.toFixed(6)}, ` +
          `${actual.lng.toFixed(6)}) 与计划中的 (${g.lat}, ${g.lng}) 不一致，` +
          '计划可能已过期（页面打开后参照被改动过）。请重新生成审阅页。',
      );
    }

    const targets = [];
    for (const t of g.targets) {
      if (typeof t !== 'string' || !t) {
        throw new Error(`${tag} 的 targets 含非文件名项`);
      }
      if (t === g.ref) {
        throw new Error(`目标 ${t} 同时是该组参照，不能写入自身`);
      }
      if (seenTargets.has(t)) {
        throw new Error(
          `目标 ${t} 在计划中重复出现（锚点 ${seenTargets.get(t)} 与 ${g.ref}）`,
        );
      }
      seenTargets.set(t, g.ref);
      if (!ALLOWED_EXTS.has(path.extname(t).toLowerCase())) {
        throw new Error(`目标 ${t} 不是可处理的媒体文件`);
      }
      const targetPath = path.join(dirPath, t);
      try {
        await fs.access(targetPath);
      } catch {
        throw new Error(`目标 "${t}" 不存在于文件夹 "${filterDir}"`);
      }
      targets.push({ dirName: filterDir, fileName: t, filePath: targetPath });
    }

    resolved.push({
      ref: {
        dirName: filterDir,
        fileName: g.ref,
        filePath: refPath,
        lat: actual.lat,
        lng: actual.lng,
      },
      targets,
    });
  }

  // 目标当前必须缺 GPS：已有坐标的跳过（计划生成后又跑过别的写入 → 幂等续作）
  let alreadyHasGps = 0;
  for (const group of resolved) {
    const pending = [];
    for (const target of group.targets) {
      if (await readGps(target.filePath)) {
        alreadyHasGps++;
      } else {
        pending.push(target);
      }
    }
    group.targets = pending;
  }
  const total = resolved.reduce((sum, g) => sum + g.targets.length, 0);
  if (total === 0) {
    console.log(
      `✅ 计划中的 ${alreadyHasGps} 张目标照片现在都已带坐标，无需处理。`,
    );
    return;
  }

  console.log('分组计划（来自审阅页的复制写入命令）：');
  for (let i = 0; i < resolved.length; i++) {
    const { ref, targets } = resolved[i];
    if (targets.length === 0) continue;
    console.log(
      `  组 ${i + 1} · 参照 ${ref.fileName}（${ref.lat.toFixed(6)}, ${ref.lng.toFixed(6)}）` +
        ` → ${targets.length} 张`,
    );
  }
  if (alreadyHasGps > 0) {
    console.log(color.yellow(`⏭️ 已带坐标、自动跳过：${alreadyHasGps} 张`));
  }

  const confirmed = await confirmBatch(
    color.cyan(`\n将以上 ${total} 张照片的坐标写入 "${filterDir}"：[y] 确认  [q/q 其他键] 放弃 > `),
    yes,
  );
  if (confirmed !== true) {
    console.log('⏹️ 已放弃，未写入。');
    if (confirmed === null) process.exit(1);
    return;
  }

  // 写入复用 writeGps()（溯源标记、不复制 GPSHPositioningError、写入后验证全部继承）；
  // 任一张验证失败即停止全部后续写入
  const writtenList = [];
  for (const { ref, targets } of resolved) {
    for (const target of targets) {
      try {
        await writeGps(target, ref);
        console.log(color.green(`✅ 已写入并验证：${target.fileName}`));
        writtenList.push(`${target.dirName}/${target.fileName}`);
      } catch (err) {
        console.error(color.red(`\n⛔ ${err.message}`));
        console.error(color.red('已停止全部后续写入。'));
        await printSummary(writtenList.length, alreadyHasGps, writtenList);
        process.exit(1);
      }
    }
  }
  await printSummary(writtenList.length, alreadyHasGps, writtenList);
}

/**
 * 轨迹计划写入（计划 `mode: 'gpx'`）：校验链 → 确认 → 逐张写入。
 * 校验链任一失败即报错退出 1、零写入；目标已带坐标的自动跳过（幂等续作）。
 *
 * ⚠️ 与锚点计划的关键差别：坐标**不是从参照复制来的，是工具按拍摄时刻插值算出来的**。
 * 故"防过期"校验在这里是**重算并比对**——页面开着太久、或轨迹文件被换/被改之后写入
 * 会得到过期坐标，重算能立刻发现（锚点路对应的是"参照的实际 EXIF 坐标与计划内一致"）。
 *
 * 计划形态（轨迹审阅页「复制写入命令」给出）：
 *   { dir, mode: 'gpx', track: '<轨迹文件名>', tz: <小时>,
 *     assignments: [{ file, lat, lng }, ...] }
 * `assignments` **没列出的照片一律不写**——页面上的"排除"就是不把它列进来。
 */
async function runTrackPlan(rawPlan, filterDir, yes) {
  const dirPath = path.join(ORIGIN_DIR, filterDir);
  if (typeof rawPlan.track !== 'string' || !rawPlan.track) {
    throw new Error('轨迹计划缺少 track（轨迹文件名）');
  }
  if (typeof rawPlan.tz !== 'number' || !Number.isFinite(rawPlan.tz)) {
    throw new Error('轨迹计划缺少 tz（UTC 偏移小时数，可含小数）');
  }
  if (!Array.isArray(rawPlan.assignments) || rawPlan.assignments.length === 0) {
    throw new Error('轨迹计划的 assignments 为空（至少需要一张要写的照片）');
  }

  const trackPath = path.join(dirPath, rawPlan.track);
  try {
    await fs.access(trackPath);
  } catch {
    throw new Error(
      `轨迹计划的轨迹文件 "${rawPlan.track}" 不存在于文件夹 "${filterDir}"（已被移走或改名？）`,
    );
  }
  const { points } = parseGpxTrack(await fs.readFile(trackPath, 'utf-8'));

  const seen = new Set();
  const resolved = [];
  for (const a of rawPlan.assignments) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) {
      throw new Error('轨迹计划的 assignments 含非对象项');
    }
    if (typeof a.file !== 'string' || !a.file) {
      throw new Error('轨迹计划的 assignments 含空文件名');
    }
    if (seen.has(a.file)) {
      throw new Error(`目标 ${a.file} 在计划中重复出现`);
    }
    seen.add(a.file);
    if (typeof a.lat !== 'number' || typeof a.lng !== 'number') {
      throw new Error(`轨迹计划项 ${a.file} 缺少 lat / lng 坐标`);
    }
    if (!ALLOWED_EXTS.has(path.extname(a.file).toLowerCase())) {
      throw new Error(`目标 ${a.file} 不是可处理的媒体文件`);
    }
    const targetPath = path.join(dirPath, a.file);
    try {
      await fs.access(targetPath);
    } catch {
      throw new Error(`目标 "${a.file}" 不存在于文件夹 "${filterDir}"`);
    }
    // 防过期：按当前轨迹 + 计划时区重算，必须与计划里的坐标一致
    const meta = await readMediaMeta(targetPath);
    if (!meta.takenAt) {
      throw new Error(`目标 ${a.file} 缺拍摄时间，无法按轨迹插值`);
    }
    const t = wallTimeToEpoch(meta.takenAt, rawPlan.tz);
    const pos = interpolateTrack(points, t);
    if (!pos) {
      throw new Error(
        `目标 ${a.file} 的拍摄时刻 ${meta.takenAt} 落在轨迹时间窗之外（轨迹或时区已变？）。` +
          '请重新生成审阅页。',
      );
    }
    if (
      Math.abs(pos.lat - a.lat) > PLAN_COORD_EPSILON ||
      Math.abs(pos.lng - a.lng) > PLAN_COORD_EPSILON
    ) {
      throw new Error(
        `${a.file} 的重算坐标 (${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}) 与计划中的 ` +
          `(${a.lat}, ${a.lng}) 不一致，计划可能已过期（轨迹文件被改动过？）。` +
          '请重新生成审阅页。',
      );
    }
    resolved.push({
      target: { dirName: filterDir, fileName: a.file, filePath: targetPath },
      time: meta.takenAt,
      pos,
    });
  }

  // 目标当前必须缺 GPS：已有坐标的跳过（计划生成后又跑过别的写入 → 幂等续作）
  let alreadyHasGps = 0;
  const pending = [];
  for (const r of resolved) {
    if (await readGps(r.target.filePath)) {
      alreadyHasGps++;
    } else {
      pending.push(r);
    }
  }
  if (pending.length === 0) {
    console.log(`✅ 计划中的 ${alreadyHasGps} 张目标照片现在都已带坐标，无需处理。`);
    return;
  }

  console.log('轨迹计划（来自轨迹审阅页的复制写入命令）：');
  console.log(
    `  轨迹 ${rawPlan.track} · ${formatUtcOffset(rawPlan.tz)} · 待写 ${pending.length} 张` +
      (alreadyHasGps > 0 ? `（另有 ${alreadyHasGps} 张已带坐标，跳过）` : ''),
  );
  for (const { target, time, pos } of pending) {
    console.log(
      `   ${target.fileName}  ${time.slice(11, 19)}  →  ` +
        `${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}`,
    );
  }

  const confirmed = await confirmBatch(
    color.cyan(
      `\n将以上 ${pending.length} 张照片的坐标按轨迹写入 "${filterDir}"：` +
        '[y] 确认  [其他键] 放弃 > ',
    ),
    yes,
  );
  if (confirmed !== true) {
    console.log('⏹️ 已放弃，未写入。');
    if (confirmed === null) process.exit(1);
    return;
  }

  const writtenList = [];
  for (const { target, pos } of pending) {
    try {
      await writeGpsFromTrack(target, pos, rawPlan.track);
      console.log(color.green(`✅ 已写入并验证：${target.fileName}`));
      writtenList.push(`${target.dirName}/${target.fileName}`);
    } catch (err) {
      console.error(color.red(`\n⛔ ${err.message}`));
      console.error(color.red('已停止全部后续写入。'));
      await printSummary(writtenList.length, alreadyHasGps, writtenList);
      process.exit(1);
    }
  }
  await printSummary(writtenList.length, alreadyHasGps, writtenList);
}

// ---------------------------------------------------------------------------
// 轨迹路（--track）：按拍摄时刻在轨迹上插值取坐标
// ---------------------------------------------------------------------------

/**
 * 解析 GPX 文本 → 轨迹点序列（按时间升序）。
 *
 * 只认 `<trkpt lat="…" lon="…"><ele>…</ele><time>…</time></trkpt>` 这种标准结构
 * （Apple Watch「户外步行」经手机 gpx export 导出的即为此），不为它引入 XML 解析依赖。
 * 多 `<trkseg>` 的语义定为**按时间序拼接为一条**：同一段步行被手表切成多段时物理上仍是
 * 一条连续轨迹，分段独立会让跨段的照片无处可查。文档顺序本就非时间序时才重排，
 * 并在返回值里标出（由调用方打印）——不静默改变语义。
 *
 * 时间戳是 UTC 瞬时（如 `2026-10-06T11:25:33Z`）；照片的拍摄时间是"当地墙上时间"，
 * 换算见 wallTimeToEpoch（需要时区偏移）。
 *
 * @param {string} text GPX 文件内容
 * @returns {{points: {t:number,lat:number,lng:number,ele:number|null}[], segCount:number, reordered:boolean}}
 *   结构不合规或点数不足即抛错（fail-early：轨迹坏了要立刻知道，不能当空轨迹默默跑完）
 */
function parseGpxTrack(text) {
  const segCount = (text.match(/<trkseg[\s>]/g) || []).length;
  const points = [];
  const trkptRe = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g;
  let m;
  while ((m = trkptRe.exec(text)) !== null) {
    const lat = gpxAttr(m[1], 'lat');
    const lng = gpxAttr(m[1], 'lon');
    const timeMatch = /<time>\s*([^<]+?)\s*<\/time>/.exec(m[2]);
    const t = timeMatch ? Date.parse(timeMatch[1]) : NaN;
    if (lat === null || lng === null || Number.isNaN(t)) {
      throw new Error(
        '轨迹文件里有一个 <trkpt> 缺 lat / lon / time（或格式不可解析）：' +
          `${m[0].slice(0, 120)}…`,
      );
    }
    const eleMatch = /<ele>\s*([-\d.eE+]+)\s*<\/ele>/.exec(m[2]);
    const ele = eleMatch ? Number(eleMatch[1]) : NaN;
    points.push({ t, lat, lng, ele: Number.isFinite(ele) ? ele : null });
  }
  if (points.length < 2) {
    throw new Error(
      `轨迹点不足（解析到 ${points.length} 个），无法插值——请确认该文件是 GPX 轨迹。`,
    );
  }
  let reordered = false;
  for (let i = 1; i < points.length; i++) {
    if (points[i].t < points[i - 1].t) {
      reordered = true;
      break;
    }
  }
  if (reordered) points.sort((a, b) => a.t - b.t);
  return { points, segCount, reordered };
}

/** 取 trkpt 属性里的数值（单双引号都认）；缺属性或非数字返回 null */
function gpxAttr(attrs, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`).exec(attrs);
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * EXIF 的"当地墙上时间" → epoch 毫秒（与轨迹的 UTC 瞬时可比）。
 *
 * EXIF 不含时区，而 `Date.parse` 对无偏移的 ISO 串按**运行机器的本地时区**解释——
 * 结果会随机器环境漂移。故显式补 `Z`、把墙上时间读成 UTC 得到"伪 epoch"，再减去时区
 * 偏移：墙上时间 = UTC + offset ⇒ UTC = 墙上时间 − offset。
 * （首次实现这个通道时正是栽在这里：轨点被多加 8 小时，全部照片看起来落窗外。）
 *
 * @param {string} wallIso 如 "2026-10-06T18:12:31"
 * @param {number} offsetHours 拍摄地 UTC 偏移（小时，可含小数，如 +5.5）
 * @returns {number|null} 解析失败返回 null
 */
function wallTimeToEpoch(wallIso, offsetHours) {
  const wall = Date.parse(`${wallIso}Z`);
  if (Number.isNaN(wall)) return null;
  return wall - offsetHours * 3600000;
}

/**
 * 在轨迹上按时刻插值取坐标（二分 + 线性）。
 * 轨迹 1 秒采样，线性在步行尺度上足够——样条不会优于 GPS 自身 30–50 m 的噪声。
 * 时间戳重复（同秒两点）时取前者，结果确定、不随机。
 *
 * @param {{t:number,lat:number,lng:number,ele:number|null}[]} points 升序轨迹点
 * @param {number} epochMs 目标时刻
 * @returns {{lat:number,lng:number,ele:number|null}|null} 落在轨迹时间窗之外 → null
 */
function interpolateTrack(points, epochMs) {
  const first = points[0];
  const last = points[points.length - 1];
  if (epochMs < first.t || epochMs > last.t) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= epochMs) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const span = b.t - a.t;
  const r = span > 0 ? (epochMs - a.t) / span : 0;
  return {
    lat: a.lat + (b.lat - a.lat) * r,
    lng: a.lng + (b.lng - a.lng) * r,
    ele: a.ele !== null && b.ele !== null ? a.ele + (b.ele - a.ele) * r : null,
  };
}

/**
 * 某点位于轨迹的哪一侧（相对行进方向）：+1 左 / −1 右 / 0 无法判定。
 * 用插值点所在区间的轨迹方向做叉积，按米制换算（经度尺度随纬度收缩，直接用度数会
 * 让符号在近似平行时漂移）。
 */
function trackSide(points, epochMs, lat, lng) {
  const pos = interpolateTrack(points, epochMs);
  if (!pos || points.length < 2) return 0;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= epochMs) lo = mid;
    else hi = mid;
  }
  const mPerDegLat = 111320;
  const cosLat = Math.cos((pos.lat * Math.PI) / 180);
  const a = points[lo];
  const b = points[hi];
  const dE = (b.lng - a.lng) * mPerDegLat * cosLat;
  const dN = (b.lat - a.lat) * mPerDegLat;
  const vE = (lng - pos.lng) * mPerDegLat * cosLat;
  const vN = (lat - pos.lat) * mPerDegLat;
  const cross = dE * vN - dN * vE;
  if (cross > 0) return 1;
  if (cross < 0) return -1;
  return 0;
}

/**
 * 时区自动判定：枚举整数小时偏移，取"能放进轨迹时间窗的照片最多"者；数量并列时取
 * 平均残差（原生坐标 vs 轨迹插值点）最小者。
 *
 * 信噪比依据（2026-10-07 实测）：走动 0.44 m/s ⇒ 差 1 小时 ≈ 1584 m，比 GPS 噪声
 * （30–50 m）高一个半数量级；轨迹只有 55 分钟时，错一小时会让**全部**照片落到窗外。
 * 反过来说相机时钟偏移（秒级 ⇒ ~40 m）与噪声同量级，**不可自动标定**（决策 ④），
 * 本函数只管时区。
 * 刻意**不**按经度推时区（`round(lon/15)`）：中国全境统一 UTC+8，乌鲁木齐 lon 87.6°
 * 会被推成 UTC+6 ⇒ 必然出错。
 *
 * @param {{time: string, lat: number, lng: number}[]} calibrators 有**原生**坐标的手机照
 * @param {{t:number,lat:number,lng:number}[]} points 升序轨迹点
 * @returns {{offsetHours:number, inside:number, avgResidual:number}}
 *   inside = 落入时间窗的校准照片数；0 表示本次判定无依据（调用方必须报错退出）
 */
function calibrateTimezone(calibrators, points) {
  let best = null;
  for (let h = -12; h <= 14; h++) {
    let inside = 0;
    let sum = 0;
    for (const c of calibrators) {
      const t = wallTimeToEpoch(c.time, h);
      const pos = t === null ? null : interpolateTrack(points, t);
      if (!pos) continue;
      inside++;
      sum += haversineMeters({ lat: c.lat, lng: c.lng }, pos);
    }
    const avgResidual = inside > 0 ? sum / inside : Number.POSITIVE_INFINITY;
    if (
      best === null ||
      inside > best.inside ||
      (inside === best.inside && avgResidual < best.avgResidual)
    ) {
      best = { offsetHours: h, inside, avgResidual };
    }
  }
  return best;
}

/**
 * 疑似时区差提示：若存在某个整数小时偏移能把**全部**落空照片拉回轨迹时间窗内，返回
 * 该偏移，否则 null。把"这些照片缺坐标"改判成"时区大概错了"——时区判错 8 小时时
 * 所有照片都会落窗外，这是最可能的根因。
 */
function suggestTzOffset(missed, points, currentOffset) {
  for (let h = -12; h <= 14; h++) {
    if (h === currentOffset) continue;
    let allInside = true;
    for (const m of missed) {
      const t = m.photo.time ? wallTimeToEpoch(m.photo.time, h) : null;
      if (t === null || !interpolateTrack(points, t)) {
        allInside = false;
        break;
      }
    }
    if (allInside) return h;
  }
  return null;
}

/** 时长（毫秒）→ "8 分 13 秒" / "42 秒" */
function formatSpan(ms) {
  const sec = Math.max(0, Math.round(ms / 1000));
  return sec >= 60 ? `${Math.floor(sec / 60)} 分 ${sec % 60} 秒` : `${sec} 秒`;
}

/** UTC 偏移（小时，可含小数）→ "UTC+8" / "UTC+5:30" */
function formatUtcOffset(hours) {
  const abs = Math.abs(hours);
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
  return `UTC${hours < 0 ? '-' : '+'}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/** epoch → 当地墙上时间（"HH:MM:SS"，按给定 UTC 偏移）。与 EXIF 的时间口径一致 */
function formatWallClock(epochMs, offsetHours) {
  return new Date(epochMs + offsetHours * 3600000).toISOString().slice(11, 19);
}

/**
 * 相机时钟的**可见性**报告（判据 3；决策 ④ 不做自动标定）。
 * 打印原生手机照的原生坐标与轨迹插值点的残差与侧别分布：全部偏在同一侧说明轨迹或
 * 手机定位存在系统性偏差，此时相机照的绝对误差无法从本报告里分离出来。
 * ⚠️ 它能暴露**系统性偏差**，但**不能**直接测出相机时钟偏移——侧别只用到了手机照，
 * 与相机时钟无关（相机时钟偏了只会让相机照沿轨迹整体平移，得靠真值才能发现）。
 */
function printClockVisibility(calibrators, points, offsetHours) {
  const sides = [];
  let sum = 0;
  let max = 0;
  let n = 0;
  for (const c of calibrators) {
    const t = c.time ? wallTimeToEpoch(c.time, offsetHours) : null;
    if (t === null) continue;
    const pos = interpolateTrack(points, t);
    if (!pos) continue;
    const d = haversineMeters({ lat: c.lat, lng: c.lng }, pos);
    sum += d;
    max = Math.max(max, d);
    n++;
    sides.push(trackSide(points, t, c.lat, c.lng));
  }
  if (n === 0) return;
  const left = sides.filter((s) => s > 0).length;
  const right = sides.filter((s) => s < 0).length;
  console.log(
    color.dim(
      `\nℹ️ 时钟可见性：${n} 张原生手机照的原生坐标与轨迹插值点平均相距 ` +
        `${Math.round(sum / n)} m（最大 ${Math.round(max)} m）；侧别 ${left} 左 / ${right} 右`,
    ),
  );
  if (n >= 2 && (left === 0 || right === 0)) {
    console.log(
      color.dim(
        '   ⚠️ 全部偏向轨迹同一侧 ⇒ 轨迹或手机定位存在系统性偏差，' +
          '相机照的绝对误差无法从本报告分离出来',
      ),
    );
  }
  console.log(
    color.dim(
      '   相机时钟偏移无法自动标定（本工具不做）：相机时间不准会让相机照的坐标' +
        '整体沿轨迹平移。出门前把相机时间对准手机（分钟级）即可把残余误差压到噪声量级。',
    ),
  );
}

/**
 * 轨迹路（`--track`）：扫目录 → 找轨迹 → 校时区 → 逐张插值 → 两条分支：
 *   ① 终端报告（`--track`，无 amapKey）→ 确认 → 写入；
 *   ② 轨迹审阅页（`--track --review`，有 amapKey）→ 渲染页面、**不写任何文件**，
 *      用户在页面上核对（并排除某几张）后复制写入命令，经 --plan-stdin 回来写入。
 *
 * **能补就补**（2026-10-07 修订）：窗内的写、窗外的逐张打印后跳过，**不整体失败**——
 * 轨迹只覆盖"按下记录"之后的时段，窗口外是日常现象（手表晚按几分钟就开始拍），不是错误。
 * 这与锚点路"部分目标已带坐标就跳过那些、写其余"（runPlan）保持一致；也正因如此，
 * "窗内走轨迹、窗外走锚点"能在同一目录上先后跑完，无需手工挪文件。
 *
 * 与锚点路的边界（判据 4）：排他粒度是**照片级**——已带坐标的照片（含锚点路刚写完的）
 * 直接跳过并显式打印张数，同一张照片不会被两条通道各写一次。同一点位内两路并用是
 * **合法状态**（轨迹只覆盖录制时段，窗口外只能借锚点），两条通道靠 EXIF 的 `mode=` 区分。
 *
 * ⚠️ 安全性依据：本函数**没有**"整批闸门"，时区判错完全由**时区判据自己**拦——
 *   ① calibrators（原生手机照）为空 → 报错要求显式 --tz；
 *   ② 枚举整小时偏移里没有任何一个能放进哪怕一张手机照 → 报错；
 *   ③ 全落窗外且存在某偏移能把它们全拉回窗内 → 打印"疑似时区差 N 小时"。
 *   这三条的判据是"手机照能否落窗内"，才是时区正确性的证据；而"有些 target 落窗外"
 *   **不是**（手表晚按、拍完才结束记录都会造成窗外 target），故不再拿它当第二道闸门。
 *
 * @param {string} dirName 目标文件夹
 * @param {{tz?: number, yes?: boolean, amapKey?: string}} options
 *   tz = `--tz` 覆盖值（小时）；yes = 免确认；amapKey 非空 ⇒ 出审阅页（**不写入**）
 */
async function runTrack(dirName, { tz, yes, amapKey }) {
  const dirPath = path.join(ORIGIN_DIR, dirName);
  const { photos } = await scanDirForReview(dirName);

  const targets = photos.filter((p) => p.kind === 'target');
  const done = photos.filter((p) => p.kind === 'done');
  // 校准只用**原生**坐标的手机照：已被补过坐标的手机照不是原生（拿它校准是自己证明自己）
  const calibrators = photos.filter((p) => p.kind === 'anchor' && !p.geoSource);

  const trackFiles = (await fs.readdir(dirPath)).filter(isTrackFile);
  if (trackFiles.length === 0) {
    throw new Error(
      `文件夹 "${dirName}" 内没有轨迹文件（${[...TRACK_EXTS].join(' / ')}）。\n` +
        '  轨迹来自 Apple Watch「户外步行」记录 → 手机 gpx export 导出 → 放进该点位目录。\n' +
        `  若该点位本来就没有轨迹，请改用锚点路：npm run fix-gps:anchor -- "${dirName}" --review`,
    );
  }
  if (trackFiles.length > 1) {
    throw new Error(
      `文件夹 "${dirName}" 内有 ${trackFiles.length} 个轨迹文件：${trackFiles.join('、')}。\n` +
        '  本工具不替你猜用哪一条（多轨迹合并是后续议题）。' +
        '请只保留本次拍摄那一条、其余移出目录后重跑。',
    );
  }

  const trackFileName = trackFiles[0];
  const { points, segCount, reordered } = parseGpxTrack(
    await fs.readFile(path.join(dirPath, trackFileName), 'utf-8'),
  );
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  let distance = 0;
  for (let i = 1; i < points.length; i++) {
    distance += haversineMeters(points[i - 1], points[i]);
  }

  console.log('\n=== fix-gps --track：按轨迹插值补坐标 ===');
  console.log(`文件夹: ${dirName}`);
  console.log(
    `轨迹: ${trackFileName}（${segCount} 段 / ${points.length} 点 / ` +
      `总里程 ${Math.round(distance)} m，平均间隔 ${formatSpan((lastPoint.t - firstPoint.t) / (points.length - 1))}）`,
  );
  if (reordered) {
    console.log(
      color.dim('ℹ️ 该轨迹的多段在文档顺序上不是时间序，已按时间升序拼接为一条'),
    );
  }

  // 时区：显式 --tz 优先；否则自动判定（判定无依据时报错要求显式指定，不静默推导）
  let offsetHours = tz;
  let offsetSource = 'tz'; // 'tz'（--tz 显式指定）| 'auto'（按原生手机照自动判定）
  let calibration = null; // 自动判定时 = calibrateTimezone 结果（审阅页要展示判定依据）
  if (offsetHours === undefined) {
    if (calibrators.length === 0) {
      throw new Error(
        `文件夹 "${dirName}" 内没有**原生坐标的手机照**，无法自动校准时区。\n` +
          '  时区差一小时 ≈ 1584 m（步行速度）——猜时区等于把整批坐标写偏，故不猜。\n' +
          `  处置：显式指定，如 npm run fix-gps:track -- "${dirName}" --tz +8`,
      );
    }
    const best = calibrateTimezone(calibrators, points);
    if (best.inside === 0) {
      throw new Error(
        `时区自动判定失败：UTC-12 ~ UTC+14 的整数小时偏移里，没有任何一个能把手机照` +
          '放进轨迹时间窗。\n' +
          '  可能原因：轨迹与照片不是同一天/同一时段；或是**半小时时区**（如 UTC+5:30）。\n' +
          `  处置：显式指定，如 npm run fix-gps:track -- "${dirName}" --tz +8（支持 --tz +5:30 写法）；` +
          '若确实不同时段，请改用锚点路。',
      );
    }
    offsetHours = best.offsetHours;
    offsetSource = 'auto';
    calibration = best;
    console.log(
      `时区: ${formatUtcOffset(offsetHours)}（按 ${calibrators.length} 张原生手机照交叉验证：` +
        `${best.inside}/${calibrators.length} 张落入轨迹时间窗，平均残差 ` +
        `${Math.round(best.avgResidual)} m）`,
    );
  } else {
    console.log(`时区: ${formatUtcOffset(offsetHours)}（--tz 显式指定，未做自动校验）`);
  }
  console.log(
    `  时间窗 ${formatWallClock(firstPoint.t, offsetHours)} → ` +
      `${formatWallClock(lastPoint.t, offsetHours)}（墙上时间，跨度 ` +
      `${formatSpan(lastPoint.t - firstPoint.t)}）`,
  );

  // 逐张插值（"能补就补"，2026-10-07 修订）：窗内的进 plans、窗外的进 missed。
  // 不再"任一张落空即整体失败"——窗外是日常现象（手表晚按几分钟才开始记录），
  // 且锚点路（runPlan）本来就是"部分目标不适用就跳过那些、写其余"，两条通道口径一致。
  const plans = [];
  const missed = [];
  for (const p of targets) {
    const t = p.time ? wallTimeToEpoch(p.time, offsetHours) : null;
    const pos = t === null ? null : interpolateTrack(points, t);
    if (!pos) {
      missed.push({ photo: p, t });
      continue;
    }
    plans.push({
      target: { dirName, fileName: p.file, filePath: path.join(dirPath, p.file) },
      time: p.time,
      t,
      pos,
    });
  }

  if (missed.length > 0) {
    console.log(
      color.yellow(
        `\n⏭️ ${missed.length}/${targets.length} 张照片落在这条轨迹的时间窗之外，` +
          '本轮跳过（能补的就补，其余交给锚点路）：',
      ),
    );
    for (const { photo, t } of missed) {
      const when = t === null
        ? `${photo.time || '时间未知'}（缺拍摄时间，无法插值）`
        : `${photo.time.slice(11, 19)}（${t < firstPoint.t
            ? `早于轨迹起点 ${formatSpan(firstPoint.t - t)}`
            : `晚于轨迹终点 ${formatSpan(t - lastPoint.t)}`}）`;
      console.log(`   ${photo.file}  ${when}`);
    }
    const hint = suggestTzOffset(missed, points, offsetHours);
    if (hint !== null) {
      console.log(
        color.yellow(
          `⚠️ 疑似时区差：把偏移改成 ${formatUtcOffset(hint)} 后，这些照片会落进轨迹时间窗` +
            '（时区判错 8 小时时正是这个现象）。若确实是时区问题，加 --tz 重跑。',
        ),
      );
    }
    console.log(
      color.dim(
        '   轨迹只覆盖"按下记录"之后的时段。窗口外的照片交给锚点路：' +
          `npm run fix-gps:anchor -- "${dirName}" --review（两条通道可按照片共用，` +
          '已写入的照片会被照片级幂等跳过）。',
      ),
    );
  }

  // ── 轨迹审阅页（--track --review）────────────────────────────────────────
  // 只渲染页面、**不写任何文件**：用户在页面上核对每张照片绑到了轨迹的哪个位置、
  // 排除不想要的后复制写入命令（经 --plan-stdin 回来写入）。
  if (amapKey !== undefined) {
    return renderTrackReviewPage({
      dirName,
      amapKey,
      trackFileName,
      points,
      segCount,
      reordered,
      distance,
      offsetHours,
      offsetSource,
      calibration,
      calibrators,
      firstPoint,
      lastPoint,
      targets,
      done,
      photos,
      plans,
      missed,
    });
  }

  if (plans.length === 0) {
    if (missed.length > 0) {
      // 全落窗外：不是"无事可做"，而是"这条轨迹覆盖不到这批照片"——报错退出，
      // 免得退出码 0 让人误以为已经补好了
      console.error(
        color.red(
          `\n⛔ 待补的 ${targets.length} 张照片全部落在轨迹时间窗之外，本轮一张未写。`,
        ),
      );
      console.error(
        color.dim('   请按上面的提示走锚点路，或先确认时区是否判错。'),
      );
      process.exit(1);
    }
    console.log(
      `✅ 没有需要补坐标的照片，无需处理。` +
        (done.length > 0 ? `（${done.length} 张已带坐标，本通道跳过）` : ''),
    );
    return;
  }

  console.log(
    `\n待写入 ${plans.length} 张` +
      (done.length > 0
        ? `（另有 ${done.length} 张已带坐标，按照片级幂等跳过）`
        : '') +
      '：',
  );
  for (const { target, time, t, pos } of plans) {
    console.log(
      `   ${target.fileName}  ${time ? time.slice(11, 19) : '时间未知'}  →  ` +
        `${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}` +
        `（距轨迹起点 ${formatSpan(t - firstPoint.t)}）` +
        (pos.ele !== null ? `  高程 ${pos.ele.toFixed(1)} m` : ''),
    );
  }
  printClockVisibility(calibrators, points, offsetHours);

  const confirmed = await confirmBatch(
    color.cyan(
      `\n将以上 ${plans.length} 张照片的坐标按轨迹写入 "${dirName}"：` +
        '[y] 确认  [其他键] 放弃 > ',
    ),
    yes,
  );
  if (confirmed !== true) {
    console.log('⏹️ 已放弃，未写入。');
    if (confirmed === null) process.exit(1);
    return;
  }

  const writtenList = [];
  for (const { target, pos } of plans) {
    try {
      await writeGpsFromTrack(target, pos, trackFileName);
      console.log(color.green(`✅ 已写入并验证：${target.fileName}`));
      writtenList.push(`${dirName}/${target.fileName}`);
    } catch (err) {
      console.error(color.red(`\n⛔ ${err.message}`));
      console.error(color.red('已停止全部后续写入。'));
      await printSummary(writtenList.length, done.length, writtenList);
      process.exit(1);
    }
  }
  await printSummary(writtenList.length, done.length, writtenList);
  if (missed.length > 0) {
    // 收尾重申一次（上面那批 ⏭️ 明细在"待写入"清单之前，容易被滚屏带走）：
    // "能补就补"的下一步就是把窗外这些交给锚点路，这里给出可直接复制的一行
    console.log(
      color.yellow(
        `⏭️ 另有 ${missed.length} 张落在轨迹时间窗之外，本通道未写。交给锚点路：`,
      ),
    );
    console.log(
      color.dim(`   npm run fix-gps:anchor -- "${dirName}" --review`),
    );
  }
}

/**
 * 渲染轨迹审阅页（`--track --review`）并打开浏览器。**纯只读**：不碰任何原片。
 *
 * 页面画三样东西：
 *   ① 轨迹折线（GPX）
 *   ② 相机照的插值落点——**按拍摄时间编号并连线**
 *   ③ 手机锚点照的原生坐标——唯一的外部真值
 *
 * ⚠️ 相机照的点**必然落在轨迹线上**（坐标就是按时刻插值算出来的），所以"点有没有
 * 在线里"看不出绑错。真正的校验信号是**顺序**（连线往回跳 = 相机时钟错乱/EXIF 时间
 * 被改）与**与手机锚点照的相对位置**（整批偏在一侧 = 轨迹或定位的系统性偏差）。
 * 故编号与连线是必要的，不是装饰。
 *
 * @param {object} ctx runTrack 传进来的一整套中间量（轨迹/时区/落点/锚点/跳过）
 */
async function renderTrackReviewPage(ctx) {
  const {
    dirName,
    amapKey,
    trackFileName,
    points,
    segCount,
    reordered,
    distance,
    offsetHours,
    offsetSource,
    calibration,
    calibrators,
    firstPoint,
    lastPoint,
    done,
    photos,
    plans,
    missed,
  } = ctx;

  const thumbByFile = new Map(photos.map((p) => [p.file, p.thumb]));
  const gcj = (lat, lng) => {
    const g = wgs84ToGcj02(lat, lng);
    return [Number(g.lng.toFixed(6)), Number(g.lat.toFixed(6))];
  };

  const data = {
    dir: dirName,
    generatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    amapKey,
    track: {
      file: trackFileName,
      segCount,
      pointCount: points.length,
      distance: Math.round(distance),
      reordered,
      startWall: formatWallClock(firstPoint.t, offsetHours),
      endWall: formatWallClock(lastPoint.t, offsetHours),
      span: formatSpan(lastPoint.t - firstPoint.t),
    },
    tz: {
      hours: offsetHours, // 写入计划用（页面把它原样写回 plan.tz）
      label: formatUtcOffset(offsetHours),
      source: offsetSource, // 'tz'（显式）| 'auto'（按原生手机照自动判定）
      calibratorCount: calibrators.length,
      inside: calibration ? calibration.inside : null,
      avgResidual: calibration ? Math.round(calibration.avgResidual) : null,
    },
    // 轨迹折线 [[lng, lat], ...]（GCJ02，高德底图用）
    trackLine: points.map((p) => gcj(p.lat, p.lng)),
    // 待写入的落点（页面上可逐张排除）
    plans: plans.map((pl, i) => {
      const [lng, lat] = gcj(pl.pos.lat, pl.pos.lng);
      return {
        seq: i + 1,
        file: pl.target.fileName,
        time: pl.time,
        lat: pl.pos.lat,
        lng: pl.pos.lng,
        gcjLat: lat,
        gcjLng: lng,
        ele: pl.pos.ele,
        offsetFromStart: formatSpan(pl.t - firstPoint.t),
        thumb: thumbByFile.get(pl.target.fileName) || null,
      };
    }),
    // 时间窗之外（本通道不写，交给锚点路）——页面上单列，只读
    missed: missed.map(({ photo, t }) => ({
      file: photo.file,
      time: photo.time,
      thumb: photo.thumb || null,
      reason:
        t === null
          ? '缺拍摄时间，无法插值'
          : t < firstPoint.t
            ? `早于轨迹起点 ${formatSpan(firstPoint.t - t)}`
            : `晚于轨迹终点 ${formatSpan(t - lastPoint.t)}`,
    })),
    // 手机锚点照（原生坐标，唯一的外部真值）
    anchors: calibrators.map((a) => {
      const [lng, lat] = gcj(a.lat, a.lng);
      return {
        file: a.file,
        time: a.time,
        lat: a.lat,
        lng: a.lng,
        gcjLat: lat,
        gcjLng: lng,
        thumb: a.thumb || null,
      };
    }),
    doneCount: done.length,
  };

  const template = await fs.readFile(TRACK_REVIEW_TEMPLATE, 'utf-8');
  const html = template.replace('/*__DATA__*/ null', JSON.stringify(data));

  await fs.mkdir(REVIEW_OUT_DIR, { recursive: true });
  const outPath = path.join(REVIEW_OUT_DIR, `${dirName}_track.html`);
  await fs.writeFile(outPath, html, 'utf-8');
  await execFileAsync('open', [`${pathToFileURL(outPath).href}?t=${Date.now()}`]);

  console.log(color.green(`✅ 轨迹审阅页已生成并打开：${outPath}`));
  console.log(
    color.dim(
      [
        `  待写 ${plans.length} 张（页面上可逐张排除）` +
          (missed.length > 0
            ? `；${missed.length} 张落在时间窗之外，本通道不写`
            : '') +
          (done.length > 0 ? `；${done.length} 张已带坐标，跳过` : ''),
        '  页面只读、不写任何照片。核对（排除）后点「复制写入命令」，回终端粘贴回车即可。',
        '  ℹ️ 相机照的落点必然在轨迹线上（坐标就是插值算出来的）——重点看**连线顺序**',
        '     与**手机锚点的相对位置**：顺序往回跳 = 相机时钟错乱；整体偏一侧 = 系统性偏差。',
      ].join('\n'),
    ),
  );
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

/**
 * 打印"手动指定参照"的引导：给出可直接复制修改的命令实例。
 * 参照 ≤ 5 张时列出可用参照文件名（帮用户发现该指定谁），> 5 张只报数量。
 */
function printRefHint(target, refs) {
  console.log(color.dim('💡 自动参照不合适？可按 q 退出后手动指定参照重跑：'));
  console.log(
    color.dim(
      `  npm run fix-gps:anchor -- "${target.dirName}" --target ${target.fileName} --ref <参照文件名>`,
    ),
  );
  if (refs.length > 0 && refs.length <= 5) {
    console.log(
      color.dim(`  本文件夹可用参照：${refs.map((r) => r.fileName).join('、')}`),
    );
  } else if (refs.length > 5) {
    console.log(
      color.dim(
        `  本文件夹共 ${refs.length} 张手机锚点照片（可作参照），可按 n 逐张查看`,
      ),
    );
  }
}

/**
 * 手动指定模式：目标与参照均明确，预览确认后写入（--yes 跳过预览与确认）。
 * 写入复用 writeGps()（含写入后验证），验证失败即退出。
 */
async function runSpecified(target, ref, yes) {
  console.log(
    `目标: ${target.dirName}/${target.fileName}  拍摄: ${target.takenAt || '未知'}`,
  );
  console.log(
    `参照: ${ref.fileName}  坐标: ${ref.lat.toFixed(6)}, ${ref.lng.toFixed(6)}`,
  );

  const preview = new Preview();
  enableKeyInput();

  try {
    if (!yes) {
      await preview.show(target, ref);
      process.stdout.write(
        color.cyan('确认将参照坐标写入目标照片：[y] 确认  [s] 放弃  [q] 退出 > '),
      );
      const key = await waitKey();
      if (key === 'q') {
        console.log('⏹️ 已退出，未写入。');
        return;
      }
      if (key !== 'y') {
        console.log('⏹️ 已放弃，未写入。');
        return;
      }
    }

    try {
      await writeGps(target, ref);
    } catch (err) {
      console.error(color.red(`\n⛔ ${err.message}`));
      process.exit(1);
    }
    console.log(color.green(`✅ 已写入并验证：${target.fileName}`));
    await printSummary(1, 0, [`${target.dirName}/${target.fileName}`]);
  } finally {
    await preview.cleanup();
    disableKeyInput();
  }
}

/**
 * 解析命令行参数：位置参数为文件夹名。
 * 通道（互斥）：`--anchor`（锚点路，默认）| `--track`（轨迹路）——**判定点唯一**：
 *   出现 `--track` 即轨迹路，否则锚点路（`--anchor` 是它的显式写法）。npm 脚本
 *   `fix-gps:anchor` / `fix-gps:track` 只是把对应 flag 预设进命令的快捷方式，
 *   不构成第二个判定点。
 * 锚点路形态：`--target` / `--ref` / `--all` / `--review`（分组页）
 * 轨迹路形态：`--review`（轨迹审阅页）/ `--tz`
 * 两路共用：`--plan-stdin`（通道由计划 JSON 的 mode 字段判定）、`--yes`
 */
function parseArgs(argv) {
  const args = {
    dir: undefined,
    target: undefined,
    ref: undefined,
    yes: false,
    all: false,
    review: false,
    planStdin: false,
    anchor: false,
    track: false,
    tz: undefined,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--yes') {
      args.yes = true;
    } else if (arg === '--all') {
      args.all = true;
    } else if (arg === '--review') {
      args.review = true;
    } else if (arg === '--plan-stdin') {
      args.planStdin = true;
    } else if (arg === '--anchor') {
      args.anchor = true;
    } else if (arg === '--track') {
      args.track = true;
    } else if (arg === '--gpx') {
      // 2026-10-07 改名：通道名从"数据格式"（gpx）改成"数据实体"（track）——将来若
      // 支持 .fit / .tcx 不必再改名。旧命令可能还在终端历史里，给明确指引而不是让它
      // 退化成"文件夹名不存在"（与 --plan 的处理同例）
      throw new Error(
        '--gpx 已改名为 --track（npm run fix-gps:track）。\n' +
          '  ⚠️ 只改了命令行参数名：EXIF 里的溯源标记 `mode=gpx` 是持久化契约，不变。\n' +
          '  新写法：npm run fix-gps:track -- "<文件夹>"',
      );
    } else if (arg === '--tz') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('参数 --tz 缺少时区值（示例：--tz +8 / --tz UTC+8 / --tz +5:30）');
      }
      args.tz = parseTzValue(value);
      i++;
    } else if (arg === '--plan') {
      // 2026-10-04 移除文件入口（用户明确不需要临时文件）；旧命令可能还在终端历史里，
      // 这里给明确指引而不是让它退化成"文件夹名不存在"
      throw new Error(
        '--plan（从文件读计划）已移除。请用审阅页「复制写入命令」给出的一行命令：\n' +
          "  echo '<分组计划 JSON>' | npm run fix-gps -- \"<文件夹>\" --plan-stdin",
      );
    } else if (arg === '--target' || arg === '--ref') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`参数 ${arg} 缺少文件名`);
      }
      if (arg === '--target') args.target = value;
      else args.ref = value;
      i++;
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 1) {
    throw new Error('位置参数最多一个（文件夹名）');
  }
  args.dir = positional[0];
  if ((args.target || args.ref) && !args.dir) {
    throw new Error('--target / --ref 需要同时以位置参数指定文件夹');
  }
  // 通道判定点唯一：出现 --track 即轨迹路，否则锚点路（--anchor 是它的显式写法）
  if (args.anchor && args.track) {
    throw new Error(
      '--anchor 与 --track 不能同时使用：两条补坐标通道必须分开跑' +
        '（各自的页面/报告不同），同一点位内可按照片共存',
    );
  }
  if (args.yes && !args.target && !args.planStdin && !args.track) {
    throw new Error('--yes 只能在 --target / --plan-stdin / --track 模式下使用');
  }
  if (args.all && (!args.dir || !args.ref)) {
    throw new Error('--all 需要同时指定文件夹（位置参数）与 --ref <参照文件名>');
  }
  if (args.all && args.target) {
    throw new Error('--all 与 --target 不能同时使用');
  }
  if (args.review) {
    if (!args.dir) {
      throw new Error('--review 需要同时以位置参数指定文件夹');
    }
    // --review 两条路都能用：无 --track = 锚点分组页；有 --track = 轨迹审阅页。
    // 但它不能与锚点路的"直接写入"形态参数并用（那是另一条流程）
    if (args.target || args.ref || args.all || args.planStdin) {
      throw new Error('--review 不能与 --target / --ref / --all / --plan-stdin 同时使用');
    }
  }
  if (args.planStdin) {
    if (!args.dir) {
      throw new Error('--plan-stdin 需要同时以位置参数指定文件夹');
    }
    if (args.target || args.ref || args.all || args.review) {
      throw new Error('--plan-stdin 不能与 --target / --ref / --all / --review 同时使用');
    }
    // 计划自带通道标识（mode 字段）：判定点唯一，不在命令行重复指定，避免两处口径
    if (args.anchor || args.track) {
      throw new Error(
        '--plan-stdin 不能与 --anchor / --track 同时使用：计划 JSON 的 mode 字段' +
          '已表明是哪条通道，不要在命令行重复指定',
      );
    }
  }
  if (args.track) {
    if (!args.dir) {
      throw new Error('--track 需要同时以位置参数指定文件夹');
    }
    if (args.target || args.ref || args.all) {
      throw new Error(
        '--track 不能与 --target / --ref / --all 同时使用：那些是锚点路的形态参数',
      );
    }
  }
  if (args.tz !== undefined && !args.track) {
    throw new Error('--tz 只在 --track 模式下有意义（锚点路不需要时区）');
  }
  return args;
}

/**
 * 解析 --tz 值（UTC 偏移）。接受 `+8` / `8` / `UTC+8` / `+5:30` / `UTC-3` 等写法。
 * 允许半小时（+5:30）：自动判定只枚举整数小时，半小时时区必须能显式指定。
 * @param {string} raw 命令行给的原始值
 * @returns {number} 偏移小时数（可为负、可含小数）
 */
function parseTzValue(raw) {
  const m = /^(?:utc)?([+-]?)(\d{1,2})(?::(\d{2}))?$/i.exec(raw.trim());
  if (!m) {
    throw new Error(
      `--tz 值无法解析："${raw}"（示例：--tz +8 / --tz UTC+8 / --tz +5:30）`,
    );
  }
  const sign = m[1] === '-' ? -1 : 1;
  const hours = Number(m[2]) + (m[3] ? Number(m[3]) / 60 : 0);
  if (hours > 14) {
    throw new Error(
      `--tz 值超出范围："${raw}"（UTC 偏移在 −12 ~ +14 小时之间）`,
    );
  }
  return sign * hours;
}

function printUsage() {
  console.log('用法（两条通道各有 npm 脚本名；等价的裸 flag 是 --anchor / --track）：');
  console.log('  npm run fix-gps                                       全量扫描所有文件夹');
  console.log('  npm run fix-gps:anchor -- 文件夹                      锚点路：只处理指定文件夹');
  console.log('  npm run fix-gps:anchor -- 文件夹 --target a.JPG --ref b.HEIC   手动指定目标与参照（同文件夹）');
  console.log('  npm run fix-gps:anchor -- 文件夹 --target a.JPG [--yes]        指定目标，参照自动推荐；--yes 免确认');
  console.log('  npm run fix-gps:anchor -- 文件夹 --ref b.HEIC --all   批量：将参照坐标写入该文件夹全部缺 GPS 的照片');
  console.log('  npm run fix-gps:anchor -- 文件夹 --review             分组审阅页（多锚点文件夹；');
  console.log('                                                        第 5 区为高德卫星底图，需 .env 配 REACT_APP_AMAP_API_KEY）');
  console.log("  echo '<计划 JSON>' | npm run fix-gps -- 文件夹 --plan-stdin");
  console.log('                                                        读入审阅页导出的计划（类型由 JSON 的 mode 字段判定，两条通道共用此入口）');
  console.log('  npm run fix-gps:track -- 文件夹                       轨迹路：按拍摄时刻在目录内的 .gpx 轨迹上插值补坐标');
  console.log('                                                        时区自动判定（用目录内原生手机照交叉验证）；');
  console.log('                                                        --tz +8 / UTC+8 / +5:30 可显式覆盖；');
  console.log('                                                        窗内的写、窗外的逐张打印后跳过（交给锚点路）');
  console.log('  npm run fix-gps:track -- 文件夹 --review              轨迹审阅页：高德底图 + 轨迹折线 + 落点（带序号）');
  console.log('                                                        + 手机锚点照；可排除某几张后复制写入命令');
}

/**
 * 批量模式（--all）：把参照坐标写入文件夹内全部缺 GPS 的照片。
 * 非交互——命令本身就是用户的确认（与 --yes 的定位一致）。
 * 写入复用 writeGps()（溯源标记、不复制 GPSHPositioningError、写入后验证全部继承）；
 * 任一张验证失败即停止全部后续写入（已写入的保持已写入，重跑 --all 会因
 * "已有 GPS 不进目标列表"而自动续作剩余部分）。
 */
async function runBatch(targets, ref, filterDir) {
  if (targets.length === 0) {
    console.log('✅ 没有缺 GPS 的照片，无需处理。');
    return;
  }

  console.log(
    `批量模式：将 ${ref.fileName} 的坐标（${ref.lat.toFixed(6)}, ${ref.lng.toFixed(6)}）` +
      `写入 "${filterDir}" 中 ${targets.length} 张缺 GPS 的照片。`,
  );

  const writtenList = [];
  for (const target of targets) {
    try {
      await writeGps(target, ref);
      console.log(color.green(`✅ 已写入并验证：${target.fileName}`));
      writtenList.push(`${target.dirName}/${target.fileName}`);
    } catch (err) {
      console.error(color.red(`\n⛔ ${err.message}`));
      console.error(color.red('已停止全部后续写入。'));
      await printSummary(writtenList.length, 0, writtenList);
      process.exit(1);
    }
  }

  await printSummary(writtenList.length, 0, writtenList);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(color.red(`❌ ${err.message}`));
    printUsage();
    process.exit(1);
  }
  const filterDir = args.dir;

  console.log(color.cyan('=== fix-gps：交互式补 GPS 坐标工具 ==='));
  console.log(`原图根目录（读 / 写 EXIF）: ${ORIGIN_DIR}`);
  console.log(`派生图根目录（只读缩略图）: ${IMGS_DIR}`);

  // 双根预检（AGENTS.md S3：只预检一次，缺失即报错退出，不做多路兜底）：
  // 坐标写回原片，故原图仓是硬依赖；派生图仓用于审阅页缩略图，同样必须在位
  for (const [label, dir] of [
    ['原图根目录', ORIGIN_DIR],
    ['派生图根目录', IMGS_DIR],
  ]) {
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      console.error(
        color.red(
          `❌ ${label}不存在：${dir}\n` +
            (label === '原图根目录'
              ? '请先建立原图仓并放入原图（见 docs/plans/2026-10-04-data-repo-longevity.md 阶段 1）'
              : '请检查 ../data 仓库是否完整'),
        ),
      );
      process.exit(1);
    }
  }

  // exiftool 预检：假设命令已安装，缺失直接报错退出
  try {
    await execFileAsync('exiftool', ['-ver']);
  } catch {
    console.error(
      color.red('❌ 未找到 exiftool，请先安装：brew install exiftool'),
    );
    process.exit(1);
  }

  // 审阅页 / 计划模式 / 轨迹终端报告：只面向单个文件夹，直接做目录预检，跳过全量扫描
  // （这些路径自带校验链，不需要 missing / refs 池）
  if (args.review || args.planStdin || args.track) {
    const subDirs = (await fs.readdir(ORIGIN_DIR, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    if (!subDirs.includes(filterDir)) {
      console.error(
        color.red(
          `❌ 文件夹 "${filterDir}" 不存在。可用文件夹：${subDirs.join('、')}`,
        ),
      );
      process.exit(1);
    }
    if (args.review) {
      // 高德 key 预检（AGENTS.md S3：假设配置在位、预检一次、缺失即报错退出，不做兜底）：
      // 两条路的审阅页都要嵌卫星底图，key 对 --review 是硬依赖。作用域**刻意只限
      // --review**——交互模式 / --all / --plan-stdin / 轨迹终端报告都不读 key，尤其
      // --plan-stdin 是写入关键路径，绝不能被"看图的附加区块"拖死。
      const amapKey = readDotenvValue('REACT_APP_AMAP_API_KEY');
      if (!amapKey) {
        console.error(
          color.red(
            [
              '❌ --review 需要高德 JS API key：读取 .env 失败',
              '   （文件不存在，或未配置 REACT_APP_AMAP_API_KEY）。',
              '',
              '   解决步骤：',
              '   1) 仓库根目录：cp .env.example .env',
              '   2) 高德开放平台控制台 → 应用管理 → 新建应用 → 添加 Key，',
              '      服务平台选「Web端(JS API)」：https://console.amap.com/dev/key/app',
              '   3) 填入 .env：REACT_APP_AMAP_API_KEY=<你的 key>',
              `   4) 重跑：npm run fix-gps:${args.track ? 'track' : 'anchor'} -- "${filterDir}" --review`,
              '',
              '   注：平台必须是 JS API —— 静态地图/Web 服务类型的 key 不适用',
              '       （实测返回 USERKEY_PLAT_NOMATCH）。',
            ].join('\n'),
          ),
        );
        process.exit(1);
      }
      // 两条路的审阅页：无 --track = 锚点分组页；有 --track = 轨迹审阅页
      // （amapKey 传给 runTrack 是"出图形页面、不写入"的开关）
      return args.track
        ? runTrack(filterDir, { tz: args.tz, amapKey })
        : runReview(filterDir, amapKey);
    }
    if (args.track) {
      // 轨迹终端报告**不读高德 key**：它没有图形页面（只有 --review 才要底图）
      return runTrack(filterDir, { tz: args.tz, yes: args.yes });
    }
    if (args.planStdin && process.stdin.isTTY) {
      console.error(
        color.red(
          '❌ --plan-stdin 需要从管道读入计划。审阅页点「复制写入命令」，' +
            '回终端直接粘贴、回车即可（那行命令自带 JSON）；例如：\n' +
            `  echo '<计划 JSON>' | npm run fix-gps -- "${filterDir}" --plan-stdin`,
        ),
      );
      process.exit(1);
    }
    const rawPlan = await readPlanJson();
    return runPlan(rawPlan, filterDir, args.yes);
  }

  // 扫描（全量扫一次，之后按需在内存中过滤）；filterDir 传入后，未知设备硬错只会在
  // 本命令实际处理的文件夹上触发
  const { subDirs, missing, refsByDir, doneByDir } = await scan(filterDir);

  if (filterDir !== undefined && !subDirs.includes(filterDir)) {
    console.error(
      color.red(
        `❌ 文件夹 "${filterDir}" 不存在。可用文件夹：${subDirs.join('、')}`,
      ),
    );
    process.exit(1);
  }

  const filteredMissing =
    filterDir === undefined ? missing : missing.filter((p) => p.dirName === filterDir);
  const filteredRefs = new Map(
    filterDir === undefined
      ? refsByDir
      : [...refsByDir].filter(([dir]) => dir === filterDir),
  );
  const filteredMissingNames = new Set(filteredMissing.map((p) => p.fileName));
  // 已带坐标的相机照（done）：不作参照也不需补。报错文案必须能把它们与"压根不存在"
  // 和"缺坐标"区分开，否则用户拿着文件名查不出原因
  const filteredDone = new Set(
    (filterDir === undefined
      ? [...doneByDir.values()].flat()
      : doneByDir.get(filterDir) || []
    ).map((p) => p.fileName),
  );

  // 手动指定模式：--target 必填且必须缺 GPS；--ref 可选（缺省则该张走自动推荐）
  if (args.target) {
    const dirRefs = filteredRefs.get(filterDir) || [];
    const target = filteredMissing.find((p) => p.fileName === args.target);

    if (!target) {
      console.error(
        color.red(
          `❌ ${describeUnusableFile({
            filterDir,
            fileName: args.target,
            dirRefs,
            missingNames: filteredMissingNames,
            doneNames: filteredDone,
          })}`,
        ),
      );
      process.exit(1);
    }

    if (!args.ref) {
      console.log(
        color.cyan(`手动指定目标（参照自动推荐）：${filterDir}/${args.target}`),
      );
      return run([target], filteredRefs, filterDir, { specified: true });
    }

    const ref = dirRefs.find((r) => r.fileName === args.ref);
    if (!ref) {
      console.error(
        color.red(
          `❌ ${describeUnusableFile({
            filterDir,
            fileName: args.ref,
            dirRefs,
            missingNames: filteredMissingNames,
            doneNames: filteredDone,
          })}`,
        ),
      );
      process.exit(1);
    }

    return runSpecified(target, ref, args.yes);
  }

  // 批量模式：--all（parseArgs 已保证此时必有 dir 与 ref）
  if (args.all) {
    const dirRefs = filteredRefs.get(filterDir) || [];
    const ref = dirRefs.find((r) => r.fileName === args.ref);
    if (!ref) {
      console.error(
        color.red(
          `❌ ${describeUnusableFile({
            filterDir,
            fileName: args.ref,
            dirRefs,
            missingNames: filteredMissingNames,
            doneNames: filteredDone,
          })}`,
        ),
      );
      process.exit(1);
    }
    return runBatch(filteredMissing, ref, filterDir);
  }

  return run(filteredMissing, filteredRefs, filterDir, { specified: false });
}

/**
 * 解释"这个文件名为什么用不了"（--target / --ref 查不到时的报错文案）。
 * 设备维度判据下有三类非存在性失败，必须各给一句能直接定位原因的话：
 *   ① 手机照有坐标 → 它是锚点，不是本命令的目标；
 *   ② 相机照有坐标 → 属"已补过"（done），既不覆盖也不作参照；
 *   ③ 缺坐标 → 不能当参照（只能当目标）。
 */
function describeUnusableFile({ filterDir, fileName, dirRefs, missingNames, doneNames }) {
  if (dirRefs.some((r) => r.fileName === fileName)) {
    return `"${fileName}" 已有 GPS 坐标，本工具不做覆盖（仅处理缺 GPS 的照片）。`;
  }
  if (doneNames.has(fileName)) {
    return (
      `"${fileName}" 已有 GPS 坐标，但设备不是手机 ⇒ 属"已补过"的照片，` +
      '既不覆盖、也不作参照（锚点池只收手机的原生 GPS 照片）。'
    );
  }
  if (missingNames.has(fileName)) {
    return `"${fileName}" 没有 GPS 坐标，不能作为参照。`;
  }
  return `文件夹 "${filterDir}" 中未找到 "${fileName}"（或不是可处理的媒体文件）。`;
}

async function run(missing, refsByDir, filterDir, { specified = false } = {}) {
  if (missing.length === 0) {
    console.log('✅ 没有缺 GPS 的照片，无需处理。');
    return;
  }

  console.log(
    `共 ${missing.length} 张照片缺 GPS 坐标` +
      (filterDir ? `（仅文件夹 "${filterDir}"）` : '') +
      '。' +
      color.dim('随时可按 q 退出，重跑会自动跳过已修复的照片。'),
  );

  const preview = new Preview();
  enableKeyInput();

  let written = 0;
  let skipped = 0;
  const writtenList = [];

  try {
    for (let i = 0; i < missing.length; i++) {
      const target = missing[i];
      const candidates = (refsByDir.get(target.dirName) || [])
        .map((ref) => ({
          ...ref,
          diff: formatTimeDiff(target, ref),
          sortKey:
            target.takenAt && ref.takenAt
              ? Math.abs(Date.parse(target.takenAt) - Date.parse(ref.takenAt))
              : Number.POSITIVE_INFINITY,
        }))
        .sort((a, b) => a.sortKey - b.sortKey);

      if (candidates.length === 0) {
        console.log(
          color.yellow(
            `⏭️ ${target.dirName}/${target.fileName}：文件夹内没有带 GPS 的参照照片。`,
          ),
        );
        console.log(
          color.dim(
            '  可从手机导出一张当时在附近拍的照片放入该文件夹后重跑，或手动指定参照。',
          ),
        );
        skipped++;
        continue;
      }

      console.log(
        `\n${color.cyan(`── [${i + 1}/${missing.length}]`)} ${target.dirName}/${target.fileName}` +
          `  拍摄: ${target.takenAt || '未知'}`,
      );

      let fixed = false;
      for (let c = 0; c < candidates.length && !fixed; c++) {
        const ref = candidates[c];
        console.log(
          `参照: ${ref.fileName}  坐标: ${ref.lat.toFixed(6)}, ${ref.lng.toFixed(6)}` +
            `  拍摄差: ${ref.diff}`,
        );

        await preview.show(target, ref);
        // 手动指定模式（--target）下用户已会用命令，不再重复引导
        if (!specified) {
          printRefHint(target, refsByDir.get(target.dirName) || []);
        }
        process.stdout.write(
          color.cyan(
            '看完两张照片后按键：[y] 确认复制坐标  [n] 换下一个参照  [s] 跳过这张  [q] 退出 > ',
          ),
        );
        const key = await waitKey();

        if (key === 'y') {
          try {
            await writeGps(target, ref);
            console.log(color.green(`✅ 已写入并验证：${target.fileName}`));
            written++;
            writtenList.push(`${target.dirName}/${target.fileName}`);
            fixed = true;
          } catch (err) {
            console.error(color.red(`\n⛔ ${err.message}`));
            console.error(color.red('已停止全部后续写入。'));
            await preview.cleanup();
            disableKeyInput();
            process.exit(1);
          }
        } else if (key === 'n') {
          if (c === candidates.length - 1) {
            console.log(color.yellow('⏭️ 没有更多候选参照了，视为跳过。'));
            skipped++;
            fixed = true; // 结束这张（外层用 fixed 表示"这张已有结论"）
          }
          // 否则继续 for 循环换下一个候选
        } else if (key === 's') {
          skipped++;
          fixed = true;
        } else {
          // q（含 Ctrl+C）
          await printSummary(written, skipped, writtenList);
          await preview.cleanup();
          disableKeyInput();
          process.exit(0);
        }
      }
    }

    await printSummary(written, skipped, writtenList);
  } finally {
    await preview.cleanup();
    disableKeyInput();
  }
}

async function printSummary(written, skipped, writtenList) {
  console.log(`\n${color.cyan('=== 汇总 ===')}`);
  console.log(
    `✅ 写入: ${written} 张${writtenList.length ? `（${writtenList.join('、')}）` : ''}`,
  );
  console.log(`⏭️ 跳过: ${skipped} 张`);
  if (written > 0) {
    console.log(
      '💡 下一步：运行 npm run photos 重新生成数据（若仍有照片缺坐标，该文件夹会被整体跳过并报错）。',
    );
  }
}

// 只在作为 CLI 直接运行时才执行；被 require 时（如 test/ 下的单测）保持静默，
// 这样纯函数 mergeAnchors / haversineMeters 可以脱离文件系统与 EXIF 单独测试。
if (require.main === module) {
  main().catch((err) => {
    console.error(color.red(`\n⛔ ${err.message}`));
    process.exit(1);
  });
}

// 最小公共面：只暴露审阅页分组逻辑、坐标转换与它的距离判据常量，供单测导入。
// ANCHOR_MERGE_METERS 一并导出，是为了让测试能断言它与 process-photos.js 的
// 同名常量同值（那边各存一份，只靠注释声明"必须一致"，无机制强制）。
// REVIEW_EXIF_OPTS 一并导出，供 test/gps-sign.test.js 锁住"读坐标的 gps 块不得 pick"
// 这一口径，并与 process-photos.js 的 PREFLIGHT_EXIF_OPTS 做跨文件一致性断言。
// wgs84ToGcj02 导出是因为坐标转换错了会静默偏数百米——这是审阅页唯一的
// "算错也不报错"的环节，必须有控制点单测兜着。
// outOfChina 导出是因为"哪些算境内"这个界值在 src/Application/Map/AMap/overseasTiles.js
// 里还有一份（那边决定境外瓦片换不换影像源），漂移会让境内边界瓦片静默违规——由
// test/overseas-tiles.test.js 的边界探针锁两处同口径，故必须导出以接受断言。
// 轨迹通道的纯函数（parseGpxTrack / interpolateTrack / calibrateTimezone /
// suggestTzOffset）导出，是因为它们"算错不报错"（插值错会把坐标写到几十米外、
// 还一路显示 ✅）：由 test/gpx-track.test.js 用内存构造的 GPX 文本钉住语义边界。
// 设备映射表与 classifyDevice 导出，供 test/geo-provenance.test.js 断言两脚本同值同结果。
// parseArgs / parseTzValue 导出，供测试钉住两条通道的 flag 判定与互斥矩阵（命名分路后
// 通道判定点唯一 = 有没有 --track，这条规则必须被测试锁住，否则改名时容易漂）。
module.exports = {
  mergeAnchors,
  haversineMeters,
  ANCHOR_MERGE_METERS,
  wgs84ToGcj02,
  outOfChina,
  REVIEW_EXIF_OPTS,
  parseGeoTag,
  parseGeoSource,
  classifyDevice,
  assertDeviceKnown,
  PHONE_MAKES,
  CAMERA_MAKES,
  TRACK_EXTS,
  parseGpxTrack,
  interpolateTrack,
  calibrateTimezone,
  wallTimeToEpoch,
  suggestTzOffset,
  parseArgs,
  parseTzValue,
};
