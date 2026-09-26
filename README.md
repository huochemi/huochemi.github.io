# huochemi

照片地图站：照片按文件夹组织，带 EXIF GPS 的照片钉在 AMap 地图上，部署于 GitHub Pages。

## 照片导入流程

1. 新照片放入 `../data/photos/<文件夹名>/`（仓库外目录），并在该文件夹写 `index.json`（必须含 `index_photo` 封面字段）
2. `npm run fix-gps -- <文件夹名>`：如有相机照片缺 GPS，按提示逐张看图，从同文件夹带 GPS 的照片（如 iPhone 拍摄）复制坐标
3. `npm run photos`：生成地图数据 `src/Application/output.json`；输出无 GPS 警告即为成功
4. 提交部署

细节见 `docs/data-pipeline.md`（管线知识）与 `DEVELOP.md`（AMap 领域知识）。
