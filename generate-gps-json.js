const fs = require('fs/promises');
const path = require('path');
const exifr = require('exifr');

// 1. 配置图片目录和输出 JSON 的路径
const IMGS_DIR = path.join(__dirname, '../data/photos'); // link to another repo: ../data/photos
const OUTPUT_FILE = path.join(__dirname, 'src', 'Application', 'output.json');

// 支持的图片扩展名
const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.heic', '.tiff']);

async function processAllPhotos() {
  try {
    console.log(`正在读取目录: ${IMGS_DIR}...`);

    // 读取文件夹中的所有文件
    const files = await fs.readdir(IMGS_DIR);

    // 过滤出图片文件
    const imageFiles = files.filter((file) =>
      ALLOWED_EXTS.has(path.extname(file).toLowerCase()),
    );

    console.log(`找到 ${imageFiles.length} 张图片，开始解析 EXIF...`);

    // 使用 Promise.all 并行处理，提高大量图片时的解析速度
    const results = (
      await Promise.all(
        imageFiles.map(async (file) => {
          const filePath = path.join(IMGS_DIR, file);

          try {
            // 提取 GPS 信息
            const gps = await exifr.gps(filePath);

            if (
              gps &&
              gps.latitude !== undefined &&
              gps.longitude !== undefined
            ) {
              // 拼接 Web 访问路径（如：https://huochemi.github.io/data/photos/IMG_5019.jpeg）
              const webPath = `https://huochemi.github.io/data/photos/${file}`;

              return {
                lat: gps.latitude,
                lng: gps.longitude,
                thumbnailLink: webPath,
                webViewLink: webPath,
              };
            }
          } catch (err) {
            console.warn(`[警告] 解析 ${file} 失败: ${err.message}`);
          }
          return null; // 没有 GPS 或解析失败时返回 null
        }),
      )
    ).filter(Boolean); // 过滤掉 null 的数据

    // 2. 将数组写入 JSON 文件
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8');

    console.log(`\n 处理完成！共生成 ${results.length} 条数据。`);
    console.log(`结果已保存至: ${OUTPUT_FILE}`);
  } catch (error) {
    console.error('处理失败:', error);
  }
}

processAllPhotos();
