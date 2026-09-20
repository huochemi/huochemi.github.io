const fs = require('fs/promises');
const path = require('path');
const exifr = require('exifr');
const sharp = require('sharp');

// 1. 配置图片目录和输出 JSON 的路径
const IMGS_DIR = path.join(__dirname, '../data/photos'); // 指向 ../data/photos
const OUTPUT_FILE = path.join(__dirname, 'src', 'Application', 'output.json');

// 支持的图片扩展名
const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.heic', '.tiff']);
const BASE_URL = 'https://huochemi.github.io/data/photos';

// 缩略图配置：300x300 px（适配 2x/3x 高分屏）
const THUMB_SIZE = 300;
const THUMB_QUALITY = 80;

/**
 * 使用 sharp 生成 1:1 正方形 WebP 缩略图
 * @param {string} inputPath 原始图片绝对路径
 * @param {string} outputPath 缩略图保存绝对路径
 */
async function generateThumbnail(inputPath, outputPath) {
  await sharp(inputPath)
    .rotate() // 根据 EXIF 自动纠正图片方向（解决手机拍照倒置问题）
    .resize(THUMB_SIZE, THUMB_SIZE, {
      fit: 'cover',
      // entropy: 基于图像信息量/对比度自动智能抓取视觉焦点（提升主体如车头保留概率）
      position: sharp.strategy.entropy,
    })
    .webp({ quality: THUMB_QUALITY })
    .toFile(outputPath);
}

async function processAllPhotos() {
  try {
    console.log(`正在读取根目录: ${IMGS_DIR}...`);

    // 1. 读取根目录下的所有子项（拿到子文件夹列表）
    const entries = await fs.readdir(IMGS_DIR, { withFileTypes: true });

    // 过滤出所有子文件夹
    const subDirs = entries.filter((entry) => entry.isDirectory());

    console.log(
      `找到 ${subDirs.length} 个子文件夹，开始并行遍历图片及生成缩略图...`,
    );

    // 2. 遍历各个子文件夹
    const tasks = subDirs.map(async (dir) => {
      const dirName = dir.name;
      const dirPath = path.join(IMGS_DIR, dirName);

      // 读取当前子文件夹中的所有文件
      const files = await fs.readdir(dirPath);

      // 过滤出图片文件（剔除带有 _thumb 的已生成缩略图）
      const imageFiles = files.filter(
        (file) =>
          ALLOWED_EXTS.has(path.extname(file).toLowerCase()) &&
          !file.includes('_thumb'),
      );

      // 并行解析当前文件夹内的图片 EXIF 并生成缩略图
      return Promise.all(
        imageFiles.map(async (file) => {
          const filePath = path.join(dirPath, file);
          const parsed = path.parse(file);

          // 采用后缀命名：例如 DSC02780.JPG -> DSC02780_thumb.webp
          const thumbFileName = `${parsed.name}_thumb.webp`;
          const thumbPath = path.join(dirPath, thumbFileName);

          try {
            // 提取 GPS 信息
            const gps = await exifr.gps(filePath);

            if (
              gps &&
              gps.latitude !== undefined &&
              gps.longitude !== undefined
            ) {
              // 生成 WebP 缩略图
              try {
                await generateThumbnail(filePath, thumbPath);
              } catch (thumbErr) {
                console.warn(
                  `[警告] 生成 ${dirName}/${file} 缩略图失败: ${thumbErr.message}`,
                );
              }

              // 拼接 Web 访问路径
              const webViewLink = `${BASE_URL}/${dirName}/${file}`;
              const thumbnailLink = `${BASE_URL}/${dirName}/${thumbFileName}`;

              return {
                lat: gps.latitude,
                lng: gps.longitude,
                thumbnailLink: thumbnailLink, // 指向 300x300 的后缀 WebP 缩略图
                webViewLink: webViewLink, // 指向原始图片
                dirName: dirName,
              };
            }
          } catch (err) {
            console.warn(`[警告] 解析 ${dirName}/${file} 失败: ${err.message}`);
          }
          return null; // 没有 GPS 或解析失败时返回 null
        }),
      );
    });

    // 3. 等待所有子文件夹处理完毕，展平二维数组并剔除 null 项
    const nestedResults = await Promise.all(tasks);
    const results = nestedResults.flat().filter(Boolean);

    // 确保输出目录存在
    await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });

    // 4. 将数组写入 JSON 文件
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8');

    console.log(`\n 处理完成！共生成 ${results.length} 条数据。`);
    console.log(`结果已保存至: ${OUTPUT_FILE}`);
  } catch (error) {
    console.error('处理失败:', error);
  }
}

processAllPhotos();
