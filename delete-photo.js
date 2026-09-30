/**
 * delete-photo.js — 删除一张照片（原图 + 派生图），不重跑管线
 *
 * 计划文档：docs/plans/2026-09-30-photo-deletion-workflow.md
 * （决策依据见该文件；「不重跑管线」为 2026-09-30 修订 v4，理由见该文件）
 *
 * 用法（在站点仓库根目录执行）：
 *   npm run del-photo -- "<文件夹名>" "<文件名>"
 *   例：npm run del-photo -- "保定-保定站附近永瑞园" "DSC03539.JPG"
 *
 * 行为：
 *   1. 校验参数 / 路径 / 扩展名，拒绝路径穿越
 *   2. 目标是所属文件夹 index.json 的封面 → 报错退出（封面不可删除：它提供该分组
 *      的坐标与缩略图来源，需人工改 index_photo 指定新封面后再删）
 *   3. 删除后该文件夹不再有原图 → 报错退出（管线要求每组至少 1 张）
 *   4. 删除原图与 <名>_thumb.webp / <名>_display.webp（直接删除，不进回收站）
 *   5. 打印一行提示：output.json **尚未更新**，需自行执行 npm run photos
 *      （刻意不自动重跑：连删多张时不必为每张付一次全量重跑的等待，v4）
 *
 * 依赖：仅 Node 内置模块 fs / path（无外部命令，无子进程，无启动预检）
 */

const fs = require('fs/promises');
const path = require('path');

const IMGS_DIR = path.join(__dirname, '../data/photos');

// 与 process-photos.js 保持一致的图片判定（改一处必须改两处）
const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.heic', '.tiff']);
const THUMB_SUFFIX = '_thumb.webp';
const DISPLAY_SUFFIX = '_display.webp';

const color = {
  red: (s) => `\x1b[31m${s}\x1b[39m`,
  green: (s) => `\x1b[32m${s}\x1b[39m`,
  yellow: (s) => `\x1b[33m${s}\x1b[39m`,
  cyan: (s) => `\x1b[36m${s}\x1b[39m`,
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
  const dirPath = path.join(IMGS_DIR, dirName);
  const dirStat = await fs.stat(dirPath).catch(() => null);
  if (!dirStat || !dirStat.isDirectory()) {
    throw new Error(`文件夹不存在：${dirPath}`);
  }

  const filePath = path.join(dirPath, fileName);
  const fileStat = await fs.stat(filePath).catch(() => null);
  if (!fileStat || !fileStat.isFile()) {
    throw new Error(`照片不存在：${dirName}/${fileName}`);
  }

  // 封面校验：封面不可删除，必须由人先改 index.json
  const indexPath = path.join(dirPath, 'index.json');
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
        `"${fileName}" 是文件夹 [${dirName}] 的封面照片，封面不可删除。`,
        '原因：封面提供该分组的坐标与缩略图来源，管线要求封面必须存在且有 GPS。',
        '做法：先修改 index.json 的 "index_photo" 指定新封面（新封面必须有 GPS），',
        '      再重跑本命令删除这张。',
        `路径：${indexPath}`,
      ].join('\n'),
    );
  }

  // 删后为空校验：与 process-photos.js 的图片过滤保持一致
  const files = await fs.readdir(dirPath);
  const images = files.filter(
    (file) =>
      ALLOWED_EXTS.has(path.extname(file).toLowerCase()) &&
      !file.includes('_thumb'),
  );
  const remaining = images.filter((file) => file !== fileName);
  if (remaining.length === 0) {
    throw new Error(
      [
        `文件夹 [${dirName}] 删除这张后不再有原图，管线要求每组至少 1 张。`,
        '如需整组下线：手动删除该文件夹（含 index.json）后再执行 npm run photos。',
      ].join('\n'),
    );
  }

  // 待删清单：原图 + 两张派生图（派生图缺失则跳过，不报错）
  const { name: stem } = path.parse(fileName);
  const candidates = [
    { fileName, kind: '原图' },
    { fileName: `${stem}${THUMB_SUFFIX}`, kind: '缩略图' },
    { fileName: `${stem}${DISPLAY_SUFFIX}`, kind: '展示图' },
  ];
  const targets = [];
  for (const candidate of candidates) {
    const targetPath = path.join(dirPath, candidate.fileName);
    if (await exists(targetPath)) {
      targets.push({ ...candidate, targetPath });
    }
  }

  console.log(color.cyan('\n=== 删除照片 ==='));
  console.log(`文件夹：${dirName}`);
  console.log(`文件：${fileName}`);
  console.log(`该文件夹剩余原图：${remaining.length} 张（删除后）`);
  console.log('将删除以下文件（直接删除，不进回收站）：');
  for (const target of targets) {
    console.log(`  - ${target.kind}：${dirName}/${target.fileName}`);
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
  console.log(color.green(`✓ 已删除 ${targets.length} 个文件`));
}

/**
 * 收尾提示：刻意不自动重跑管线（v4）
 * 连删多张时不必为每张付一次全量重跑的等待，由用户攒够了一次性跑。
 */
function printReminder() {
  console.log(
    color.yellow(
      '\n⚠ output.json 尚未更新 —— 请执行 npm run photos，再提交 ../data 与本站点两个仓库',
    ),
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    console.error(color.red(`✖ 参数数量不对：需要 2 个（文件夹名、文件名），实际 ${args.length} 个\n`));
    printUsage();
    process.exit(1);
  }

  const [dirName, fileName] = args;
  assertPlainName(dirName, '文件夹名');
  assertPlainName(fileName, '文件名');

  if (!ALLOWED_EXTS.has(path.extname(fileName).toLowerCase())) {
    throw new Error(
      `不支持的图片格式："${fileName}"——仅支持 ${[...ALLOWED_EXTS].join(' / ')}（派生图由原图自动清理，不能作为删除目标）`,
    );
  }

  await deletePhoto(dirName, fileName);
  printReminder();
}

main().catch((err) => {
  console.error(color.red(`\n✖ ${err.message}`));
  process.exit(1);
});
