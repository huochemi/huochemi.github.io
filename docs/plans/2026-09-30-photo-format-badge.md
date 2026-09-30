# Plan: 缩略图角标显示照片格式（HEIC / JPG）

- 日期：2026-09-30
- 状态：已实现
- 后续演进：本 plan 的角标结构被 `2026-09-30-photo-device-badge.md`
  （追加设备类型图标）沿用，细节以该文件为准
- 方案选型：A（前端从 `fileName` 扩展名推导格式），已与用户确认；
  B（pipeline 写显式 `format` 字段）被否决——扩展名本身是格式的事实源，
  加字段属冗余且需重跑 `npm run photos`。

## 需求

照片抽屉网格的缩略图上，在拍摄时间角标旁显示照片原始格式
（如 `17:02 · HEIC`、`17:03 · JPG`），用户在列表里一眼可辨格式。

## 改动内容

仅改 1 个文件：`src/Application/Map/AMap/MapChildren.jsx`

1. 新增小工具函数（放在现有 `formatTakenAtShort` 附近）：

   ```js
   // 从 fileName 扩展名推导原始格式（如 "IMG_5165.HEIC" → "HEIC"）
   const formatFileExt = (fileName) => {
     const i = fileName ? fileName.lastIndexOf('.') : -1;
     return i >= 0 ? fileName.slice(i + 1).toUpperCase() : '';
   };
   ```

2. 抽屉网格角标（现约 292-296 行）由

   ```jsx
   {p.takenAt && (
     <span className={styles.photoTimeBadge}>
       {formatTakenAtShort(p.takenAt)}
     </span>
   )}
   ```

   改为：时间与格式至少存在一个即渲染角标，二者以 ` · ` 分隔——
   这样缺 `takenAt` 但有格式的照片也不丢格式信息。

## 不做的事（出界清单）

- 不改 `process-photos.js` / `output.json`（不重跑管线）
- 不在 Lightbox 底部胶囊、`LightboxInfoPanel` 加格式（用户未选）
- 不改 `.photoTimeBadge` CSS（纯文本拼接，现有样式可容纳；
  若实际渲染发现过长再议）
- 不处理无扩展名的 `fileName`（当前数据均带扩展名；无扩展名时
  格式段为空串，角标只显示时间或整体不渲染）

## 验收标准

1. `./node_modules/.bin/eslint src --ext .js,.jsx,.ts,.tsx --max-warnings=0`
   零 warning
2. 本地（用户自查，`npm start`）：抽屉网格缩略图左下角显示
   `HH:mm · HEIC/JPG`；HEIC 与 JPG 混排的分组（如 房山长阳）两种格式均正确
3. 无 `takenAt` 的照片：角标只显示格式；两者皆无：不渲染角标
