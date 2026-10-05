/**
 * delete-photo.js — 删除一张照片或视频（原媒体 + 派生文件），不重跑管线
 *
 * 计划文档：docs/plans/2026-09-30-photo-deletion-workflow.md
 * （决策依据见该文件；「不重跑管线」为 2026-09-30 修订 v4，理由见该文件）
 * 视频支持：docs/plans/2026-10-04-video-mp4-support.md
 *
 * 用法（在站点仓库根目录执行）：
 *   npm run del-photo -- "<文件夹名>" "<文件名>"
 *   例：npm run del-photo -- "保定-保定站附近永瑞园" "DSC03539.JPG"
 *
 * 行为：
 *   1. 校验参数 / 路径 / 扩展名，拒绝路径穿越
 *   2. 目标是所属文件夹 index.json 的封面 → 报错退出（封面不可删除：它提供该分组
 *      的坐标与缩略图来源，需人工改 index_photo 指定新封面后再删）
 *   3. 删除后该文件夹不再有原媒体 → 报错退出（管线要求每组至少 1 张）
 *   4. 删除原媒体与派生文件（照片：<名>_thumb.webp / <名>_display.avif；
 *      视频：<名>_thumb.webp / <名>_web.mp4。缺失的直接跳过）
 *   5. 打印一行提示：output.json **尚未更新**，需自行执行 npm run photos
 *      （刻意不自动重跑：连删多张时不必为每张付一次全量重跑的等待，v4）
 *
 * 双根（形态 B，2026-10-05 起）：原片在原图仓 `../photos-originals/photos`、
 * 派生图与 index.json 在 data 仓 `../data/photos`。删除时按文件归属分别定位：
 * 原片删原图仓、派生文件删 data 仓（两边都缺失则跳过），因此两个根都要有该
 * 点位目录——缺一即报错退出（不静默删一半）。
 *
 * 依赖：仅 Node 内置模块 fs / path（无外部命令，无子进程，无启动预检）
 */

const fs = require('fs/promises');
const path = require('path');

const ORIGIN_DIR = path.join(__dirname, '../photos-originals/photos');
const IMGS_DIR = path.join(__dirname, '../data/photos');

// 与 process-photos.js 保持一致的媒体判定（改一处必须改两处）：
// 图片 + 视频（mp4）。删视频时待删清单是 原片 + 缩略图 + 转码版
const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.heic', '.tiff', '.mp4']);
const THUMB_SUFFIX = '_thumb.webp';
const DISPLAY_SUFFIX = '_display.avif';
const WEB_VIDEO_SUFFIX = '_web.mp4';
// 派生文件后缀（与 process-photos.js 的口径同值副本，改需同步；
// 跨文件测试锁定一致——"删后为空"判定必须排除它们）
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
      '  npm run del-photo -- "<文件夹名>" "<文件名>"',
      '例：',
      '  npm run del-photo -- "保定-保定站附近永瑞园" "DSC03539.JPG"',
      '',
      '提示：在网页 Lightbox 右侧的 ⓘ 面板里可直接复制这条命令。',
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

async function deletePhoto(dirName, fileName) {
  const dataDirPath = path.join(IMGS_DIR, dirName); // index.json + 派生图
  const originDirPath = path.join(ORIGIN_DIR, dirName); // 原媒体

  // 双根目录校验：删除会同时落在两个仓库，任一侧缺目录都可能是搬家漏拷，
  // 一律报错退出而不是"删一半"
  for (const [label, target] of [
    ['原图仓', originDirPath],
    ['data 仓', dataDirPath],
  ]) {
    const stat = await fs.stat(target).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      throw new Error(`${label}中不存在文件夹：${target}`);
    }
  }

  const filePath = path.join(originDirPath, fileName);
  const fileStat = await fs.stat(filePath).catch(() => null);
  if (!fileStat || !fileStat.isFile()) {
    throw new Error(`原图仓中不存在文件：${dirName}/${fileName}`);
  }

  // 封面校验：封面不可删除，必须由人先改 index.json
  const indexPath = path.join(dataDirPath, 'index.json');
  let indexConfig;
  try {
    indexConfig = JSON.parse(await fs.readFile(indexPath, 'utf-8'));
  } catch (err) {
    throw new Error(
      `文件夹 [${dirName}] 的 index.json 缺失或无法解析：${err.message}`,
    );
  }
  if (indexConfig.index_photo === fileName) {
    throw new Error(
      [
        `"${fileName}" 是文件夹 [${dirName}] 的封面（照片或视频），封面不可删除。`,
        '原因：封面提供该分组的坐标与缩略图来源，管线要求封面必须存在且有 GPS。',
        '做法：先修改 index.json 的 "index_photo" 指定新封面（新封面必须有 GPS），',
        '      再重跑本命令删除这张。',
        `路径：${indexPath}`,
      ].join('\n'),
    );
  }

  // 删后为空校验：与 process-photos.js 的媒体过滤保持一致（排除全部派生文件）。
  // 原媒体已全部在原图仓，故清单取自 originDirPath
  const files = await fs.readdir(originDirPath);
  const mediaFiles = files.filter(
    (file) =>
      ALLOWED_EXTS.has(path.extname(file).toLowerCase()) &&
      !isDerivedFile(file),
  );
  const remaining = mediaFiles.filter((file) => file !== fileName);
  if (remaining.length === 0) {
    throw new Error(
      [
        `文件夹 [${dirName}] 删除这张后不再有原图，管线要求每组至少 1 张。`,
        '如需整组下线：手动删除该文件夹（含 index.json）后再执行 npm run photos。',
      ].join('\n'),
    );
  }

  // 待删清单：原媒体（原图仓）+ 派生文件（data 仓）。派生文件缺失则跳过，不报错。
  // 照片派生 = 缩略图 + 展示图；视频派生 = 缩略图 + 转码版（_web.mp4）
  const { name: stem } = path.parse(fileName);
  const isVideo = path.extname(fileName).toLowerCase() === '.mp4';
  const candidates = [
    {
      fileName,
      kind: isVideo ? '视频原片' : '原图',
      root: originDirPath,
      rootLabel: '原图仓',
    },
    {
      fileName: `${stem}${THUMB_SUFFIX}`,
      kind: '缩略图',
      root: dataDirPath,
      rootLabel: 'data 仓',
    },
    isVideo
      ? {
          fileName: `${stem}${WEB_VIDEO_SUFFIX}`,
          kind: '转码视频',
          root: dataDirPath,
          rootLabel: 'data 仓',
        }
      : {
          fileName: `${stem}${DISPLAY_SUFFIX}`,
          kind: '展示图',
          root: dataDirPath,
          rootLabel: 'data 仓',
        },
  ];
  const targets = [];
  for (const candidate of candidates) {
    const targetPath = path.join(candidate.root, candidate.fileName);
    if (await exists(targetPath)) {
      targets.push({ ...candidate, targetPath });
    }
  }

  console.log(color.cyan('\n=== 删除媒体文件 ==='));
  console.log(`文件夹：${dirName}`);
  console.log(`文件：${fileName}`);
  console.log(`该文件夹剩余媒体文件：${remaining.length} 个（删除后）`);
  console.log('将删除以下文件（直接删除，不进回收站）：');
  for (const target of targets) {
    console.log(
      `  - ${target.kind}（${target.rootLabel}）：${dirName}/${target.fileName}`,
    );
  }

  for (const target of targets) {
    try {
      await fs.unlink(target.targetPath);
    } catch (err) {
      throw new Error(
        `删除失败：${dirName}/${target.fileName}——${err.message}`,
      );
    }
  }
  console.log(color.green(`✅ 已删除 ${targets.length} 个文件`));
}

/**
 * 收尾提示：刻意不自动重跑管线（v4）
 * 连删多张时不必为每张付一次全量重跑的等待，由用户攒够了一次性跑。
 */
function printReminder() {
  console.log(
    color.yellow(
      '\n⚠️ output.json 尚未更新 —— 请执行 npm run photos，再提交三个仓库：' +
        '../photos-originals（原图仓）、../data（派生图）、本站点（output.json）',
    ),
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    console.error(
      color.red(
        `❌ 参数数量不对：需要 2 个（文件夹名、文件名），实际 ${args.length} 个\n`,
      ),
    );
    printUsage();
    process.exit(1);
  }

  const [dirName, fileName] = args;
  assertPlainName(dirName, '文件夹名');
  assertPlainName(fileName, '文件名');

  if (!ALLOWED_EXTS.has(path.extname(fileName).toLowerCase())) {
    throw new Error(
      `不支持的媒体格式："${fileName}"——仅支持 ${[...ALLOWED_EXTS].join(' / ')}（派生图/转码视频由原文件自动清理，不能作为删除目标）`,
    );
  }

  await deletePhoto(dirName, fileName);
  printReminder();
}

main().catch((err) => {
  console.error(color.red(`\n❌ ${err.message}`));
  process.exit(1);
});
