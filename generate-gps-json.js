const fs = require('fs/promises');
const path = require('path');
const exifr = require('exifr');

// 1. 配置图片目录和输出 JSON 的路径
const IMGS_DIR = path.join(__dirname, '../data/photos'); // 指向 ../data/photos
const OUTPUT_FILE = path.join(__dirname, 'src', 'Application', 'output.json');

// 支持的图片扩展名
const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.heic', '.tiff']);
const BASE_URL = 'https://huochemi.github.io/data/photos';

async function processAllPhotos() {
  try {
    console.log(`正在读取根目录: ${IMGS_DIR}...`);

    // 1. 读取根目录下的所有子项（拿到子文件夹列表）
    const entries = await fs.readdir(IMGS_DIR, { withFileTypes: true });

    // 过滤出所有子文件夹
    const subDirs = entries.filter((entry) => entry.isDirectory());

    console.log(`找到 ${subDirs.length} 个子文件夹，开始并行遍历图片...`);

    // 2. 遍历各个子文件夹
    const tasks = subDirs.map(async (dir) => {
      const dirName = dir.name;
      const dirPath = path.join(IMGS_DIR, dirName);

      // 读取当前子文件夹中的所有文件
      const files = await fs.readdir(dirPath);

      // 过滤出图片文件
      const imageFiles = files.filter((file) =>
        ALLOWED_EXTS.has(path.extname(file).toLowerCase()),
      );

      // 并行解析当前文件夹内的图片 EXIF
      return Promise.all(
        imageFiles.map(async (file) => {
          const filePath = path.join(dirPath, file);

          try {
            // 提取 GPS 信息
            const gps = await exifr.gps(filePath);

            if (
              gps &&
              gps.latitude !== undefined &&
              gps.longitude !== undefined
            ) {
              // 拼接包含子目录的 Web 访问路径
              const webPath = `${BASE_URL}/${dirName}/${file}`;

              return {
                lat: gps.latitude,
                lng: gps.longitude,
                thumbnailLink: webPath,
                webViewLink: webPath,
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
