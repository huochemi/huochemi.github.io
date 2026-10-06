/**
 * fix-gps.js — 交互式补 GPS 坐标工具
 *
 * 为缺失 EXIF GPS 的照片/视频从同地点参照复制坐标，写入原文件。除坐标外还会写一个
 * 溯源标记（GPSProcessingMethod：`hcm-geosource ref=<参照> date=<日期>`），让管线
 * 能在 output.json 里区分"原生坐标"与"复制坐标"；同时刻意不复制参照的
 * GPSHPositioningError（避免相机照声称拥有手机的定位精度）。
 * 视频支持（2026-10-04）：mp4 与照片同清单、同写入命令（tagsfromfile 对 mp4
 * 原样可用）；元数据读取分叉 exiftool（exifr 读不了 mp4），详见
 * docs/plans/2026-10-04-video-mp4-support.md 与 docs/photo-metadata.md 视频小节。
 * 计划文档：docs/plans/2026-09-26-fix-gps.md、docs/plans/2026-10-03-gps-gate-hardening.md
 *
 * 用法：
 *   npm run fix-gps                                       全量扫描所有文件夹
 *   npm run fix-gps -- 郑州                               只处理指定文件夹
 *   npm run fix-gps -- 郑州 --target a.JPG --ref b.HEIC   手动指定目标与参照（同文件夹）
 *   npm run fix-gps -- 郑州 --target a.JPG [--yes]        指定目标，参照自动推荐；--yes 免确认
 *   npm run fix-gps -- 郑州 --ref b.HEIC --all            批量：将参照坐标写入该文件夹
 *                                                         全部缺 GPS 的照片（非交互，命令即确认）
 *   npm run fix-gps -- 郑州 --review                      生成只读分组审阅页（多锚点文件夹，
 *                                                         页面调整分组后复制一行写入命令）
 *                                                         第 5 区为高德卫星底图，key 取自
 *                                                         .env 的 REACT_APP_AMAP_API_KEY，
 *                                                         缺失即报错退出（附解决步骤）
 *   echo '<分组计划 JSON>' | npm run fix-gps -- 郑州 --plan-stdin        读入审阅页导出的分组计划，打印分组
 *                                                         摘要，一次确认写入全部（--yes 免确认） *
 * 交互键：y 确认 / n 换参照 / s 跳过 / q 退出（单键，无需回车）
 * 中断后重跑可续作：已写入 GPS 的照片不会再出现在清单里。
 * 注：npm run photos 预检失败提示在"恰有 1 张带坐标照片"时会给出 --all 批量命令，
 * "≥2 张锚点"时会给出 --review 审阅页命令。
 * 双根（形态 B，2026-10-05 起）：原片在原图仓 `../photos-originals/photos`，
 * 派生图（含审阅页用的 `_thumb.webp`）在 data 仓 `../data/photos`。本工具读原片、
 * 写原片 EXIF，仅从 data 仓读缩略图；启动时两个根都会预检一次。
 * 计划文档：docs/plans/2026-09-26-fix-gps.md、docs/plans/2026-10-03-gps-gate-hardening.md、
 * docs/plans/2026-10-03-fix-gps-review-page.md、docs/plans/2026-10-04-fix-gps-merge-unit-test.md、
 * docs/plans/2026-10-04-data-repo-longevity.md、
 * docs/plans/2026-10-05-fix-gps-review-amap-embed.md
 * 测试：npm run test:cli（node 内置 runner，只测合并/距离两个纯函数，不碰照片）
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
 * 读取视频的坐标 / 拍摄时间 / 溯源标记（exifr 读不了 mp4，走 exiftool）。
 * 字段口径与 process-photos.js 的 readVideoMeta 一致（两个脚本各自独立，此处复制）；
 * 拍摄时间取 Keys:CreationDate（QuickTime:CreateDate 是导出时间，不是拍摄时间）。
 * @returns {Promise<{lat?, lng?, takenAt?, geoSource?}>} 读取失败返回空对象
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
      filePath,
    ]);
    const tags = JSON.parse(stdout)[0] || {};
    return {
      lat: typeof tags.GPSLatitude === 'number' ? tags.GPSLatitude : undefined,
      lng:
        typeof tags.GPSLongitude === 'number' ? tags.GPSLongitude : undefined,
      takenAt: normalizeExifDateTime(stripTimezoneSuffix(tags.CreationDate)),
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

/** 读取照片/视频拍摄时间（返回 null 表示缺失/解析失败） */
async function readTakenAt(filePath) {
  if (isVideoFile(filePath)) {
    return (await readVideoMeta(filePath)).takenAt ?? null;
  }
  try {
    const exif = await exifr.parse(filePath, {
      pick: ['DateTimeOriginal'],
      reviveValues: false,
    });
    return normalizeExifDateTime(exif?.DateTimeOriginal);
  } catch {
    return null;
  }
}

/** 读取 GPS；返回 { lat, lng } 或 null */
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

/** 扫描原图仓，返回待修复清单与按文件夹分组的参照池（原片只读，坐标才写回） */
async function scan() {
  const entries = await fs.readdir(ORIGIN_DIR, { withFileTypes: true });
  const subDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const missing = [];
  const refsByDir = new Map();

  for (const dirName of subDirs) {
    const dirPath = path.join(ORIGIN_DIR, dirName);
    const files = (await fs.readdir(dirPath)).filter(
      (file) =>
        ALLOWED_EXTS.has(path.extname(file).toLowerCase()) &&
        !isDerivedFile(file),
    );

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const gps = await readGps(filePath);
      const takenAt = await readTakenAt(filePath);
      if (gps) {
        if (!refsByDir.has(dirName)) refsByDir.set(dirName, []);
        refsByDir.get(dirName).push({ fileName: file, filePath, takenAt, ...gps });
      } else {
        missing.push({ dirName, fileName: file, filePath, takenAt });
      }
    }
  }

  return { subDirs, missing, refsByDir };
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
// "坐标是怎么来的"）。格式 `hcm-geosource ref=<参照文件名> date=<写入日期>`，
// 与 process-photos.js 的 parseGeoSource() 是一对契约，改格式要两边一起改。
// 前缀不能省——相机会自己写这个标签（如 "GPS" / "Apple"），没有前缀无法区分
// 原生坐标与复制坐标。
// 选它是实测结果：exifr 能从 JPEG 与 HEIC 的 GPS 块直接读到它（同一张照片一次
// 解析即可），而 XMP 侧的字段 exifr 读不到 HEIC 的 XMP，自定义 XMP 命名空间又
// 需要用户级 exiftool 配置。
const GEO_SOURCE_PREFIX = 'hcm-geosource';

/** 生成溯源标记值：`hcm-geosource ref=<参照文件名> date=<YYYY-MM-DD>` */
function buildGeoSourceValue(refFileName) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${GEO_SOURCE_PREFIX} ref=${refFileName} date=${date}`;
}

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
    // 溯源标记：记录参照文件名与写入日期
    `-GPSProcessingMethod=${buildGeoSourceValue(ref.fileName)}`,
    target.filePath,
  ];
  await execFileAsync('exiftool', args);

  // 写入后验证：重读坐标必须与参照一致，否则视为失败并停止全部后续写入
  const gps = await readGps(target.filePath);
  if (
    !gps ||
    Math.abs(gps.lat - ref.lat) > COORD_EPSILON ||
    Math.abs(gps.lng - ref.lng) > COORD_EPSILON
  ) {
    throw new Error(
      `写入后验证失败：${target.dirName}/${target.fileName} 的坐标与参照不一致` +
        (gps ? `（读到 ${gps.lat}, ${gps.lng}）` : '（读不到 GPS）'),
    );
  }
}

// ---------------------------------------------------------------------------
// 计划模式（--plan / --plan-stdin）与分组审阅页（--review）
// ---------------------------------------------------------------------------

/**
 * 解析 EXIF UNDEFINED 类型标签（如 GPSProcessingMethod）的文本值。
 * 与 process-photos.js 的同名函数保持一致（该文件未模块化，此处复制；
 * parseGeoSource 的返回值与 output.json 的 geoSource 字段是一对持久化契约）。
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
 * 从 GPSProcessingMethod 提取坐标溯源的参照文件名（`hcm-geosource ref=<参照> date=<日期>`）。
 * 无标记 → undefined（原生坐标）；有标记但解析不出参照名 → 'unknown'。
 */
function parseGeoSource(raw) {
  const text = decodeUndefinedText(raw)?.trim();
  if (!text || !text.startsWith(GEO_SOURCE_PREFIX)) return undefined;
  const match = /\bref=(.+?)(?:\s+date=\d{4}-\d{2}-\d{2})?$/.exec(text);
  return match ? match[1] : 'unknown';
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

/** 扫描单个文件夹，返回审阅页需要的媒体元数据（只读）。照片走 exifr，视频走 exiftool */
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
    let lat;
    let lng;
    let time;
    let geoSourceRaw;
    if (isVideoFile(file)) {
      const meta = await readVideoMeta(filePath);
      lat = meta.lat;
      lng = meta.lng;
      time = meta.takenAt;
      geoSourceRaw = meta.geoSource;
    } else {
      const exif = await exifr
        .parse(filePath, REVIEW_EXIF_OPTS)
        .catch(() => null);
      lat = exif?.latitude;
      lng = exif?.longitude;
      time = normalizeExifDateTime(exif?.DateTimeOriginal);
      geoSourceRaw = exif?.GPSProcessingMethod;
    }
    photos.push({
      file,
      time,
      ts: time || '9999',
      kind: lat !== undefined && lng !== undefined ? 'anchor' : 'camera',
      lat: lat ?? null,
      lng: lng ?? null,
      geoSource: parseGeoSource(geoSourceRaw) ?? null,
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

  if (anchorPhotos.length === 0) {
    console.error(
      color.red(
        `❌ 文件夹 "${filterDir}" 内没有带 GPS 的照片（没有锚点可提供坐标），` +
          '无法生成审阅页。可从手机导出一张当时在附近拍的照片放入该文件夹后重跑。',
      ),
    );
    process.exit(1);
  }
  const cameras = photos.filter((p) => p.kind === 'camera');
  if (cameras.length === 0) {
    console.log('✅ 没有缺 GPS 的照片，无需处理。');
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
 * 计划模式：校验计划 → 打印分组摘要 → 一次确认 → 批量写入。
 * 校验链任一失败即报错退出 1、零写入；目标已带坐标的自动跳过（幂等续作）。
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
      `  npm run fix-gps -- "${target.dirName}" --target ${target.fileName} --ref <参照文件名>`,
    ),
  );
  if (refs.length > 0 && refs.length <= 5) {
    console.log(
      color.dim(`  本文件夹可用参照：${refs.map((r) => r.fileName).join('、')}`),
    );
  } else if (refs.length > 5) {
    console.log(
      color.dim(`  本文件夹共 ${refs.length} 张照片带 GPS，可按 n 逐张查看`),
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

/** 解析命令行参数：位置参数为文件夹名，支持 --target / --ref / --yes / --all / --review / --plan-stdin */
function parseArgs(argv) {
  const args = {
    dir: undefined,
    target: undefined,
    ref: undefined,
    yes: false,
    all: false,
    review: false,
    planStdin: false,
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
  if (args.yes && !args.target && !args.planStdin) {
    throw new Error('--yes 只能在 --target 或 --plan-stdin 模式下使用');
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
    if (args.target || args.ref || args.all || args.planStdin) {
      throw new Error(
        '--review 不能与 --target / --ref / --all / --plan-stdin 同时使用',
      );
    }
  }
  if (args.planStdin) {
    if (!args.dir) {
      throw new Error('--plan-stdin 需要同时以位置参数指定文件夹');
    }
    if (args.target || args.ref || args.all || args.review) {
      throw new Error(
        '--plan-stdin 不能与 --target / --ref / --all / --review 同时使用',
      );
    }
  }
  return args;
}

function printUsage() {
  console.log('用法：');
  console.log('  npm run fix-gps                                       全量扫描所有文件夹');
  console.log('  npm run fix-gps -- 文件夹                             只处理指定文件夹');
  console.log('  npm run fix-gps -- 文件夹 --target a.JPG --ref b.HEIC 手动指定目标与参照（同文件夹）');
  console.log('  npm run fix-gps -- 文件夹 --target a.JPG [--yes]      指定目标，参照自动推荐；--yes 免确认');
  console.log('  npm run fix-gps -- 文件夹 --ref b.HEIC --all          批量：将参照坐标写入该文件夹全部缺 GPS 的照片');
  console.log('  npm run fix-gps -- 文件夹 --review                    生成只读分组审阅页（多锚点文件夹；');
  console.log('                                                        第 5 区为高德卫星底图，需 .env 配 REACT_APP_AMAP_API_KEY）');
  console.log("  echo '<分组计划 JSON>' | npm run fix-gps -- 文件夹 --plan-stdin");
  console.log('                                                        读入审阅页导出的分组计划（页面「复制写入命令」给出完整一行），一次确认写入全部');
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

  // 审阅页 / 计划模式：只面向单个文件夹，直接做目录预检，跳过全量扫描
  // （--review / --plan-stdin 自带校验链，不需要 missing / refs 池）
  if (args.review || args.planStdin) {
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
      // 高德 key 预检（AGENTS.md S3：假设配置在位、预检一次、缺失即报错退出，
      // 不做兜底）：审阅页第 5 区要嵌卫星底图，key 对 --review 是硬依赖。
      // 作用域**刻意只限 --review**——交互模式 / --all / --plan-stdin 都不读 key，
      // 尤其 --plan-stdin 是写入关键路径，绝不能被"看图的附加区块"拖死。
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
              `   4) 重跑：npm run fix-gps -- "${filterDir}" --review`,
              '',
              '   注：平台必须是 JS API —— 静态地图/Web 服务类型的 key 不适用',
              '       （实测返回 USERKEY_PLAT_NOMATCH）。',
            ].join('\n'),
          ),
        );
        process.exit(1);
      }
      return runReview(filterDir, amapKey);
    }
    if (args.planStdin && process.stdin.isTTY) {
      console.error(
        color.red(
          '❌ --plan-stdin 需要从管道读入计划。审阅页点「复制写入命令」，' +
            '回终端直接粘贴、回车即可（那行命令自带 JSON）；例如：\n' +
            `  echo '<分组计划 JSON>' | npm run fix-gps -- "${filterDir}" --plan-stdin`,
        ),
      );
      process.exit(1);
    }
    const rawPlan = await readPlanJson();
    return runPlan(rawPlan, filterDir, args.yes);
  }

  // 扫描（全量扫一次，之后按需在内存中过滤）
  const { subDirs, missing, refsByDir } = await scan();

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

  // 手动指定模式：--target 必填且必须缺 GPS；--ref 可选（缺省则该张走自动推荐）
  if (args.target) {
    const dirRefs = filteredRefs.get(filterDir) || [];
    const target = filteredMissing.find((p) => p.fileName === args.target);

    if (!target) {
      if (dirRefs.some((r) => r.fileName === args.target)) {
        console.error(
          color.red(
            `❌ "${args.target}" 已有 GPS 坐标，本工具不做覆盖（仅处理缺 GPS 的照片）。`,
          ),
        );
      } else {
        console.error(
          color.red(
            `❌ 文件夹 "${filterDir}" 中未找到 "${args.target}"（或不是可处理的媒体文件）。`,
          ),
        );
      }
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
      if (filteredMissing.some((p) => p.fileName === args.ref)) {
        console.error(
          color.red(`❌ "${args.ref}" 没有 GPS 坐标，不能作为参照。`),
        );
      } else {
        console.error(
          color.red(
            `❌ 文件夹 "${filterDir}" 中未找到 "${args.ref}"（或不是可处理的媒体文件）。`,
          ),
        );
      }
      process.exit(1);
    }

    return runSpecified(target, ref, args.yes);
  }

  // 批量模式：--all（parseArgs 已保证此时必有 dir 与 ref）
  if (args.all) {
    const dirRefs = filteredRefs.get(filterDir) || [];
    const ref = dirRefs.find((r) => r.fileName === args.ref);
    if (!ref) {
      if (filteredMissing.some((p) => p.fileName === args.ref)) {
        console.error(
          color.red(`❌ "${args.ref}" 没有 GPS 坐标，不能作为参照。`),
        );
      } else {
        console.error(
          color.red(
            `❌ 文件夹 "${filterDir}" 中未找到 "${args.ref}"（或不是可处理的媒体文件）。`,
          ),
        );
      }
      process.exit(1);
    }
    return runBatch(filteredMissing, ref, filterDir);
  }

  return run(filteredMissing, filteredRefs, filterDir, { specified: false });
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
module.exports = {
  mergeAnchors,
  haversineMeters,
  ANCHOR_MERGE_METERS,
  wgs84ToGcj02,
  REVIEW_EXIF_OPTS,
};
