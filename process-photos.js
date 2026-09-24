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
 * @param {string} inputPath 原始图片绝对路径
 * @param {string} outputPath 缩略图保存绝对路径
 */
async function generateThumbnail(inputPath, outputPath) {
  await sharp(inputPath)
    .rotate() // 根据 EXIF 自动纠正图片方向（解决手机拍照倒置问题）
    .resize(THUMB_SIZE, THUMB_SIZE, {
      fit: 'cover',
      // entropy: 基于图像信息量/对比度自动智能抓取视觉焦点
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
      `找到 ${subDirs.length} 个子文件夹，开始按文件夹及 index.json 校验生成数据...`,
    );

    // 2. 遍历各个子文件夹
    const tasks = subDirs.map(async (dir) => {
      const dirName = dir.name;
      const dirPath = path.join(IMGS_DIR, dirName);
      const indexPath = path.join(dirPath, 'index.json');

      // --- 强校验：检查 index.json 是否存在并解析 ---
      let indexConfig;
      try {
        const indexContent = await fs.readFile(indexPath, 'utf-8');
        indexConfig = JSON.parse(indexContent);
      } catch (err) {
        throw new Error(
          `文件夹 [${dirName}] 缺少 index.json 或文件 JSON 格式不正确: ${err.message}`,
        );
      }

      const coverFileName = indexConfig.index_photo;
      if (!coverFileName) {
        throw new Error(
          `文件夹 [${dirName}] 的 index.json 中未指定 "index_photo"！`,
        );
      }

      // 读取当前子文件夹中的所有文件
      const files = await fs.readdir(dirPath);

      // 过滤出图片文件（剔除带有 _thumb 的已生成缩略图）
      const imageFiles = files.filter(
        (file) =>
          ALLOWED_EXTS.has(path.extname(file).toLowerCase()) &&
          !file.includes('_thumb'),
      );

      if (imageFiles.length === 0) {
        throw new Error(`文件夹 [${dirName}] 下没有符合格式的图片文件！`);
      }

      // 并行处理当前文件夹内的所有图片
      const photoResults = await Promise.all(
        imageFiles.map(async (file) => {
          const filePath = path.join(dirPath, file);
          const parsed = path.parse(file);

          const thumbFileName = `${parsed.name}_thumb.webp`;
          const thumbPath = path.join(dirPath, thumbFileName);

          const webViewLink = `${BASE_URL}/${dirName}/${file}`;
          const thumbnailLink = `${BASE_URL}/${dirName}/${thumbFileName}`;

          let lat, lng, takenAt;

          // 提取 GPS 信息
          try {
            const gps = await exifr.gps(filePath);
            if (
              gps &&
              gps.latitude !== undefined &&
              gps.longitude !== undefined
            ) {
              lat = gps.latitude;
              lng = gps.longitude;
            }
          } catch (err) {
            console.warn(
              `[警告] 解析 ${dirName}/${file} GPS 失败: ${err.message}`,
            );
          }

          // 提取原始拍摄时间（reviveValues: false 返回 EXIF 原始字符串，
          // 避免 exifr 转 Date 后 JSON 序列化时被错误地偏移为 UTC 时间）
          try {
            const exif = await exifr.parse(filePath, {
              pick: ['DateTimeOriginal'],
              reviveValues: false,
            });
            takenAt = normalizeExifDateTime(exif?.DateTimeOriginal);
            if (!takenAt) {
              console.warn(
                `[警告] ${dirName}/${file} 缺失或无法解析 DateTimeOriginal，已跳过 takenAt 字段`,
              );
            }
          } catch (err) {
            console.warn(
              `[警告] 解析 ${dirName}/${file} 拍摄时间失败: ${err.message}`,
            );
          }

          // 生成 WebP 缩略图
          try {
            await generateThumbnail(filePath, thumbPath);
          } catch (thumbErr) {
            console.warn(
              `[警告] 生成 ${dirName}/${file} 缩略图失败: ${thumbErr.message}`,
            );
          }

          return {
            fileName: file,
            lat,
            lng,
            takenAt,
            thumbnailLink,
            webViewLink,
          };
        }),
      );

      const validPhotos = photoResults.filter(Boolean);

      // 寻找 index.json 指定的封面图
      const primaryPhoto = validPhotos.find(
        (p) => p.fileName === coverFileName,
      );

      if (!primaryPhoto) {
        throw new Error(
          `文件夹 [${dirName}] 的 index.json 指定的封面图片 "${coverFileName}" 在文件夹中未找到！`,
        );
      }

      if (primaryPhoto.lat === undefined || primaryPhoto.lng === undefined) {
        throw new Error(
          `文件夹 [${dirName}] 的封面图片 "${coverFileName}" 缺失 GPS 坐标！`,
        );
      }

      // 构造 photos 数组，每个图片带上各自的 lat / lng / takenAt
      const photos = validPhotos.map((p) => {
        const item = {
          thumbnailLink: p.thumbnailLink,
          webViewLink: p.webViewLink,
        };
        if (p.lat !== undefined && p.lng !== undefined) {
          item.lat = p.lat;
          item.lng = p.lng;
        }
        if (p.takenAt) {
          item.takenAt = p.takenAt;
        }
        return item;
      });

      // 返回当前文件夹聚合后的数据结构
      return {
        lat: primaryPhoto.lat,
        lng: primaryPhoto.lng,
        thumbnailLink: primaryPhoto.thumbnailLink,
        webViewLink: primaryPhoto.webViewLink,
        dirName: dirName,
        ...(indexConfig.description
          ? { description: indexConfig.description }
          : {}),
        ...(primaryPhoto.takenAt ? { takenAt: primaryPhoto.takenAt } : {}),
        photos: photos,
      };
    });

    // 3. 等待所有子文件夹处理完毕
    const results = await Promise.all(tasks);

    // 确保输出目录存在
    await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });

    // 4. 将数组写入 JSON 文件
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8');

    console.log(`\n处理完成！共生成 ${results.length} 条文件夹数据。`);
    console.log(`结果已保存至: ${OUTPUT_FILE}`);
  } catch (error) {
    console.error(`\n[严重错误] ${error.message}`);
    console.error('任务处理失败，脚本已终止执行。');
    process.exit(1); // 遇到缺失 index.json 或其他错误时直接报错退出
  }
}

processAllPhotos();
