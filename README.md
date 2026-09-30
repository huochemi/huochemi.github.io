# huochemi

照片地图站：照片按文件夹组织，带 EXIF GPS 的照片钉在 AMap 地图上，部署于 GitHub Pages。

## 照片导入流程

1. 新照片放入 `../data/photos/<文件夹名>/`（仓库外目录），并在该文件夹写 `index.json`（必须含 `index_photo` 封面字段）
2. `npm run fix-gps -- <文件夹名>`：如有相机照片缺 GPS，按提示逐张看图，从同文件夹带 GPS 的照片（如 iPhone 拍摄）复制坐标
3. `npm run photos`：生成地图数据 `src/Application/output.json`；输出无 GPS 警告即为成功
4. 提交部署

细节见 `docs/data-pipeline.md`（管线知识）与 `DEVELOP.md`（AMap 领域知识）。

## 照片删除

在网页 Lightbox 右侧 `ⓘ` 面板里点「复制删除命令」，到站点仓库根目录的终端粘贴执行：

```
npm run del-photo -- "<文件夹名>" "<文件名>"
```

它会删除原图与派生图（`_thumb.webp` / `_display.webp`），然后提示你自己执行一次
`npm run photos` 重新生成 `output.json`（脚本**不**自动重跑：连删多张只需跑一次，
不必为每张等一次全量重跑）。

- **封面不可删除**：`index.json` 的 `index_photo` 指向的照片会被拒绝，需先改封面再删；
  UI 面板对该照片也会标注「封面照片 · 不可删除」并不给复制按钮
- 原图**直接删除、不进回收站**，执行该命令即为确认
- 删除后 `output.json` 仍是旧状态（网页上照片还在、缩略图破图），跑一次
  `npm run photos` 才生效
- 两个仓库（`../data` 与本站点）都要提交推送，线上才会一致

细节见 `docs/data-pipeline.md`。
