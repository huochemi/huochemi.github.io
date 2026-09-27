# Lightbox 信息面板（方案 B）

状态：草稿（待用户批准）
日期：2026-09-27

## 背景（自包含，零上下文可读）

- 站点是照片地图（React 18 + @uiw/react-amap），点击 Marker 打开底部
  抽屉，再点缩略图进入全屏 Lightbox 大图模式。
- 当前 Lightbox 仅显示：左上 `n / n` 计数、右上"查看原始文件"链接、
  底部拍摄时间胶囊。上下文信息不足。
- 用户已对比 A（增强胶囊）/ B（右侧信息面板）/ C（浮层）/ D（顶栏
  信息化）四方案，选定 **B：Google Photos 式右侧信息面板**——容量
  大、默认收起不破坏沉浸感、后续可扩展。
- 数据边界：`output.json` 照片级字段仅 `lat / lng / takenAt /
  thumbnailLink / displayLink / webViewLink`；文件夹级另有
  `dirName / description`。无 EXIF 拍摄参数（本轮不做，见出界清单）。

## 方案

### 1. 新建 `src/Application/Map/AMap/LightboxInfoPanel.jsx` + `LightboxInfoPanel.module.css`

- Props：`photo`（当前照片对象）、`groupName`、`groupDescription`、
  `open`。
- 面板内容（自上而下）：
  - **拍摄时间**：完整格式 `2026-08-15 08:06`（复用现有
    `formatTakenAtFull` 的切片逻辑，时区语义与现状一致）；
  - **GPS 坐标**：`lat, lng` 各保留 6 位小数（WGS84，如实标注），
    附"复制"按钮（`navigator.clipboard`，成功后按钮短暂显示
    "已复制"）；
  - **高德地图链接**："在高德地图中查看 ↗"，新标签页打开
    `https://uri.amap.com/marker?position=<lng>,<lat>&name=拍摄位置`。
    动机：站点地图是卫星图，看不出街道名，用户需跳高德确认照片
    实际拍摄街道（2026-09-27 用户追加）。
    坐标系处理（关键）：高德 URI API 要求 GCJ02 坐标，照片存的是
    WGS84，直接拼链接会偏移数百米、跨街道，达不到看街道名的目的。
    实现：MapChildren 把 `AMap` 对象作为 prop 传入面板，面板用
    `useEffect` 对当前照片坐标调 `AMap.convertFrom(..., 'gps', ...)`
    转为 GCJ02 后再拼链接；转换未完成/失败时不渲染链接（宁缺毋
    假——偏移的链接比没有更有害）。转换结果按坐标缓存，避免每次
    切图重复请求；
  - **所属文件夹**：`dirName`；有 `description` 时一并展示
    （仅文件夹分组模式有值，见步骤 2）；
  - 面板不重复"查看原始文件"链接（顶栏已有）。
- 布局：
  - 桌面端：固定于右侧、顶栏之下的竖向面板，毛玻璃半透明底，
    带过渡动画滑入/滑出；
  - 移动端（media query）：改为自底部滑出的 bottom sheet，不遮
    整张大图。

### 2. 修改 `MapChildren.jsx`（接线）

- 顶栏 `lightboxActions` 内、关闭按钮左侧加 "ⓘ" 切换按钮，
  控制面板 `open` 状态（`useState`，默认收起）。
- 面板挂载于 Lightbox 内，`photoList[lightboxIndex]` 变化时面板
  若处于展开态则内容随之更新；关闭 Lightbox（Esc / ✕ / 点遮罩）
  时面板状态一并重置。
- 把已有的 `AMap` 对象传给面板（供 WGS84→GCJ02 坐标转换用）。
- `flattenPhotos` 的映射对象补一个 `dirName: group.dirName` 字段，
  使 `group_by=photo` 模式下也能显示文件夹名（现缺失）。
- 不动现有渐进式加载、预加载、键盘导航逻辑。

### 3. 样式与交互细节

- 按钮/面板配色沿用现有 Lightbox 深色半透明体系（与
  `MapChildren.module.css` 中 lightbox 系列类一致的风格）。
- 点击面板内部不冒泡关闭 Lightbox（`stopPropagation`）。

## 步骤

1. agent：新建 `LightboxInfoPanel.jsx` + `LightboxInfoPanel.module.css`。
2. agent：修改 `MapChildren.jsx`（加按钮、面板接线、`flattenPhotos`
   补 `dirName`）。
3. agent：跑门禁
   `./node_modules/.bin/eslint src --ext .js,.jsx,.ts,.tsx --max-warnings=0`、
   `CI=true ./node_modules/.bin/react-scripts build`。
4. 用户：`npm start` 验证（见验收标准）。

## 验收标准

- Lightbox 顶栏出现 "ⓘ" 按钮，点击右侧滑出信息面板，再点收起；
- 面板正确显示拍摄时间、GPS 坐标（6 位小数）、文件夹名与描述
  （photo 模式下也有文件夹名）；复制按钮可用且反馈"已复制"；
- 高德链接打开后，标记落点在照片实际拍摄位置的街道上（GCJ02
  转换正确，无数百米偏移）；切图后再次点开链接指向新位置；
- 左右切图时若面板展开，内容同步切换；关闭 Lightbox 后面板状态重置；
- 移动端视口下面板变为底部弹出样式；
- 点面板内部不误关 Lightbox；
- `eslint --max-warnings=0` 与 `CI=true` build 通过。

## 出界清单（不做）

- 不做 EXIF 拍摄参数（相机/光圈/焦距）——需先改 `process-photos.js`
  管线写 `output.json`，属独立前置方案，本轮未选；
- 不做手写 WGS84→GCJ02 近似公式——统一走官方 `AMap.convertFrom`
  （MapChildren 已在用），不引入第二套转换逻辑；
- 不改照片管线（`process-photos.js` / `fix-gps.js`）、不改
  `output.json` 数据结构（仅在 `flattenPhotos` 内存映射 `dirName`）；
- 不改 `DEVELOP.md`、`AGENTS.md`（无新建 docs 域文件）；
- 不删不改本清单之外的任何文件。

## 备选方案（留痕，含被否决原因）

- **方案 A 增强时间胶囊**：改动最小但容量有限、无扩展空间，用户
  未选（2026-09-27 会话对比后选定 B）。
- **方案 C hover/点击浮层**：移动端无 hover、浮层遮挡大图，未选。
- **方案 D 顶栏信息化**：顶栏放描述破坏对称、无扩展空间，未选。
