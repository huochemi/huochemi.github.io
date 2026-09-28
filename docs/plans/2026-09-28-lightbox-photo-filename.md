# Lightbox 信息面板显示照片原文件名（方案 B：管线直出）

状态：草稿（待用户批准）
日期：2026-09-28

## 背景（自包含，零上下文可读）

- 站点任何位置都不显示照片原图文件名（如 `DSC04376.JPG`）。
- 根因：`process-photos.js` 内部每张照片对象有 `fileName` 字段
  （用于匹配封面），但第 311-325 行构造 `photos` 数组输出到
  `output.json` 时只保留 `thumbnailLink / displayLink / webViewLink /
  lat / lng / takenAt`，`fileName` 被剥掉；前端 `MapChildren.jsx` 的
  `flattenPhotos`（第 15-40 行）同样未下发文件名，
  `LightboxInfoPanel`（ⓘ 面板）因此无文件名可显示。
- 用户对比了 A（前端解析 webViewLink）/ B（管线直出 fileName）/
  显示位置（信息面板条目 / Lightbox 顶栏常显 / 复制按钮）后，选定
  **B + 信息面板条目**：数据显式、语义正确，面板默认收起不添乱。

## 方案

### 1. 修改 `process-photos.js`

- 第 311-325 行构造 `photos` 数组时，`item` 增加
  `fileName: p.fileName`（`fileName` 来自实际文件名，恒有值，
  无需条件判断）。
- 第 328 行起的文件夹分组对象同步增加
  `fileName: primaryPhoto.fileName`（封面文件名，保持两种分组
  模式下数据一致）。

### 2. 修改 `src/Application/Map/AMap/MapChildren.jsx`

- `flattenPhotos` 两个分支均补传 `fileName`：
  - `group.photos` 空的兜底分支：`fileName: group.fileName`；
  - `group.photos.map(...)` 分支：`fileName: photo.fileName`。

### 3. 修改 `src/Application/Map/AMap/LightboxInfoPanel.jsx`

- 「拍摄时间」区块后新增「文件名」区块：
  `{photo.fileName && (<div className={styles.section}>...)}`，
  样式复用现有 `styles.label` / `styles.value`，不加新 CSS。
- `fileName` 缺失时不渲染该区块（宁缺毋假，兼容旧 output.json）。

### 4. 重新生成数据

- 运行 `npm run photos` 重新生成 `src/Application/output.json`
  （顺带重新生成全部缩略图/展示图 webp，均为生成产物，耗时数分钟）。
- 安全性说明：`process-photos.js` 对原图只读（exifr 解析 EXIF），
  不回写原图；原图（`../data/photos`）不受影响。
- 注意：封面缺 GPS 的文件夹会硬报错——当前 output.json 已有完整
  数据，说明各封面 GPS 已补齐，正常可跑通。

## 验收标准

1. `npm run photos` 成功，`output.json` 中每张照片及分组对象均含
   `fileName` 字段；
2. Lightbox 打开任一照片，ⓘ 面板显示「文件名」及其原文件名
   （含扩展名，如 `DSC04376.JPG` / `IMG_5165.HEIC`）；
3. folder / photo 两种分组模式下均正常；旧数据（无 fileName）
   时不渲染该区块、不报错；
4. `./node_modules/.bin/eslint src --ext .js,.jsx,.ts,.tsx
   --max-warnings=0` 通过；
5. `CI=true ./node_modules/.bin/react-scripts build` 通过。

## 出界清单（本轮不做）

- Lightbox 顶栏常显文件名；
- 复制文件名按钮；
- 前端从 webViewLink 解析文件名的方案 A；
- 抽屉/Marker 等其他位置显示文件名。
