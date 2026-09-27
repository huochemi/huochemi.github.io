/**
 * fix-gps.js — 交互式补 GPS 坐标工具
 *
 * 为缺失 EXIF GPS 的照片从同地点参照照片复制坐标，写入原图。
 * 计划文档：docs/plans/2026-09-26-fix-gps.md（决策依据见该文件）
 *
 * 用法：
 *   npm run fix-gps                                       全量扫描所有文件夹
 *   npm run fix-gps -- 郑州                               只处理指定文件夹
 *   npm run fix-gps -- 郑州 --target a.JPG --ref b.HEIC   手动指定目标与参照（同文件夹）
 *   npm run fix-gps -- 郑州 --target a.JPG [--yes]        指定目标，参照自动推荐；--yes 免确认
 *
 * 交互键：y 确认 / n 换参照 / s 跳过 / q 退出（单键，无需回车）
 * 中断后重跑可续作：已写入 GPS 的照片不会再出现在清单里。
 */

const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const readline = require('readline');
const { pathToFileURL } = require('url');
const exifr = require('exifr');

const execFileAsync = promisify(execFile);

const IMGS_DIR = path.join(__dirname, '../data/photos');
const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.heic', '.tiff']);
const PREVIEW_FILE = path.join(os.tmpdir(), 'fix-gps-preview.html');
// 写入后验证：目标坐标与参照坐标允许的最大偏差（度）
const COORD_EPSILON = 0.001;

const color = {
  red: (s) => `\x1b[31m${s}\x1b[39m`,
  green: (s) => `\x1b[32m${s}\x1b[39m`,
  yellow: (s) => `\x1b[33m${s}\x1b[39m`,
  cyan: (s) => `\x1b[36m${s}\x1b[39m`,
  // \x1b[22m（normal intensity）才关闭 faint；\x1b[39m 只重置颜色，
  // 会导致暗化泄漏到后续所有输出
  dim: (s) => `\x1b[2m${s}\x1b[22m`,
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

/** 读取照片拍摄时间（返回 null 表示缺失/解析失败） */
async function readTakenAt(filePath) {
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

/** 扫描照片目录，返回待修复清单与按文件夹分组的参照池 */
async function scan() {
  const entries = await fs.readdir(IMGS_DIR, { withFileTypes: true });
  const subDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const missing = [];
  const refsByDir = new Map();

  for (const dirName of subDirs) {
    const dirPath = path.join(IMGS_DIR, dirName);
    const files = (await fs.readdir(dirPath)).filter(
      (file) =>
        ALLOWED_EXTS.has(path.extname(file).toLowerCase()) &&
        !file.includes('_thumb') &&
        !file.includes('_display'),
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

  /** 生成可用于 <img src> 的 file:// URL（HEIC 先转临时 JPEG） */
  async toImgSrc(filePath) {
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
    '-GPSHPositioningError',
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
// 主流程
// ---------------------------------------------------------------------------

/**
 * 打印"手动指定参照"的引导：给出可直接复制修改的命令实例。
 * 参照 ≤ 5 张时列出可用参照文件名（帮用户发现该指定谁），> 5 张只报数量。
 */
function printRefHint(target, refs) {
  console.log(color.dim('自动参照不合适？可按 q 退出后手动指定参照重跑：'));
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
        console.log('已退出，未写入。');
        return;
      }
      if (key !== 'y') {
        console.log('已放弃，未写入。');
        return;
      }
    }

    try {
      await writeGps(target, ref);
    } catch (err) {
      console.error(color.red(`\n[严重错误] ${err.message}`));
      process.exit(1);
    }
    console.log(color.green(`✓ 已写入并验证：${target.fileName}`));
    await printSummary(1, 0, [`${target.dirName}/${target.fileName}`]);
  } finally {
    await preview.cleanup();
    disableKeyInput();
  }
}

/** 解析命令行参数：位置参数为文件夹名，支持 --target / --ref / --yes */
function parseArgs(argv) {
  const args = { dir: undefined, target: undefined, ref: undefined, yes: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--yes') {
      args.yes = true;
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
  if (args.yes && !args.target) {
    throw new Error('--yes 只能在 --target 指定模式下使用');
  }
  return args;
}

function printUsage() {
  console.log('用法：');
  console.log('  npm run fix-gps                                       全量扫描所有文件夹');
  console.log('  npm run fix-gps -- 文件夹                             只处理指定文件夹');
  console.log('  npm run fix-gps -- 文件夹 --target a.JPG --ref b.HEIC 手动指定目标与参照（同文件夹）');
  console.log('  npm run fix-gps -- 文件夹 --target a.JPG [--yes]      指定目标，参照自动推荐；--yes 免确认');
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(color.red(`[错误] ${err.message}`));
    printUsage();
    process.exit(1);
  }
  const filterDir = args.dir;

  console.log(color.cyan('=== fix-gps：交互式补 GPS 坐标工具 ==='));
  console.log(`照片根目录: ${IMGS_DIR}`);

  // exiftool 预检：假设命令已安装，缺失直接报错退出
  try {
    await execFileAsync('exiftool', ['-ver']);
  } catch {
    console.error(
      color.red('[错误] 未找到 exiftool，请先安装：brew install exiftool'),
    );
    process.exit(1);
  }

  // 扫描（全量扫一次，之后按需在内存中过滤）
  const { subDirs, missing, refsByDir } = await scan();

  if (filterDir !== undefined && !subDirs.includes(filterDir)) {
    console.error(
      color.red(
        `[错误] 文件夹 "${filterDir}" 不存在。可用文件夹：${subDirs.join('、')}`,
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
            `[错误] "${args.target}" 已有 GPS 坐标，本工具不做覆盖（仅处理缺 GPS 的照片）。`,
          ),
        );
      } else {
        console.error(
          color.red(
            `[错误] 文件夹 "${filterDir}" 中未找到 "${args.target}"（或不是可处理的图片文件）。`,
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
          color.red(`[错误] "${args.ref}" 没有 GPS 坐标，不能作为参照。`),
        );
      } else {
        console.error(
          color.red(
            `[错误] 文件夹 "${filterDir}" 中未找到 "${args.ref}"（或不是可处理的图片文件）。`,
          ),
        );
      }
      process.exit(1);
    }

    return runSpecified(target, ref, args.yes);
  }

  return run(filteredMissing, filteredRefs, filterDir, { specified: false });
}

async function run(missing, refsByDir, filterDir, { specified = false } = {}) {
  if (missing.length === 0) {
    console.log('没有缺 GPS 的照片，无需处理。');
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
            `[跳过] ${target.dirName}/${target.fileName}：文件夹内没有带 GPS 的参照照片。`,
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
            console.log(color.green(`✓ 已写入并验证：${target.fileName}`));
            written++;
            writtenList.push(`${target.dirName}/${target.fileName}`);
            fixed = true;
          } catch (err) {
            console.error(color.red(`\n[严重错误] ${err.message}`));
            console.error(color.red('已停止全部后续写入。'));
            await preview.cleanup();
            disableKeyInput();
            process.exit(1);
          }
        } else if (key === 'n') {
          if (c === candidates.length - 1) {
            console.log(color.yellow('没有更多候选参照了，视为跳过。'));
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
  console.log(`写入: ${written} 张${writtenList.length ? `（${writtenList.join('、')}）` : ''}`);
  console.log(`跳过: ${skipped} 张`);
  if (written > 0) {
    console.log('下一步：运行 npm run photos 重新生成数据，确认 GPS 警告消失。');
  }
}

main().catch((err) => {
  console.error(color.red(`\n[严重错误] ${err.message}`));
  process.exit(1);
});
