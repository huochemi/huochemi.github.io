# Marker 悬停提示按分组模式显示语义化文案（方案 D）

状态：已实现（2026-09-30；eslint --max-warnings=0 通过；文案以
`output.json` 真实数据离线模拟校验；CI build 按 docs/toolchain.md 门禁
交由用户终端执行；待用户 npm start 验收）
日期：2026-09-30

## 背景（自包含，零上下文可读）

- 站点是照片地图（React 18 + @uiw/react-amap）。`MapChildren.jsx`
  渲染 AMap Marker，鼠标悬停时浏览器展示原生 tooltip。
- 现状：第 193 行 `title={`Marker ${index}`}`，`index` 是 `photos`
  数组下标。用户实测悬停显示「Marker 102」——纯序号，对用户零信息
  量，且语义随分组模式漂移（`hcm_group_by`）：
  - 文件夹模式：`photos` = `output.json` 顶层数组，10 项，序号 0-9；
  - 照片模式：`photos` = `flattenPhotos` 展开后的 175 张，序号 0-174。
    用户看到的 "Marker 102" 只可能来自此模式，对应
    `保定-保定站附近永瑞园 / IMG_4559.HEIC / 2026-07-25 13:54`。
- 用户已对比 6 个方案后选定 **D：按当前分组模式给不同文案**——
  文件夹模式显示「文件夹名（共 N 张）」，照片模式显示
  「文件名 · 拍摄时间」，信息与当前视图语义对齐。

## 数据边界（决定实现可行性，均已实测）

- 分组模式（folder）item：`dirName / description / takenAt /
  fileName / photos[]`，且 10 项**全部**有非空 `photos` 数组。
- 照片模式（photo）item：由 `flattenPhotos`（第 15-42 行）产出，
  字段为 `dirName / fileName / takenAt / lat / lng / 三个 link`，
  **无 `photos` 字段**。故 `photo.photos` 真值性是可靠判别式。
- `description` 字段只有分组模式顶层对象有、`flattenPhotos` 未下发，
  故本方案不用它（避免"字段在某些模式下不存在"的隐性坑）。
- `setPhotos`（第 83-88 行）是 `{...allPhotos[index], lnglat}` 的
  spread，原有字段全部保留，坐标转换不影响上述判别式。
- `takenAt` 是 ISO 8601 无时区字符串（拍摄地当地时间），同文件
  已有 `formatTakenAtFull`（第 50 行）做切片展示，直接复用，不引入
  `Date` 对象以免时区换算。

## 方案

### 修改 `src/Application/Map/AMap/MapChildren.jsx`（唯一改动文件）

1. 在 `formatTakenAtFull` / `formatTakenAtShort` 附近新增模块级
   辅助函数，把两种模式的文案组装收在一处（避免 JSX 里嵌套三元）：

   ```jsx
   // Marker 悬停 tooltip 文案（AMap 原生 title）：按分组模式给语义。
   // 分组模式 item 带 photos[] 数组，照片模式 item 由 flattenPhotos
   // 产出、无该字段。
   const markerTooltip = (photo, photoCount) => {
     if (photo.photos) {
       return photo.dirName
         ? `${photo.dirName}（共 ${photoCount} 张）`
         : `共 ${photoCount} 张`;
     }
     return [photo.fileName, formatTakenAtFull(photo.takenAt)]
       .filter(Boolean)
       .join(' · ');
   };
   ```

   `filter(Boolean)` + `join` 处理字段缺失：宁缺毋假，不渲染
   "undefined ·" 之类假内容（沿用 repo 既有约定）。

2. 第 193 行 `title={`Marker ${index}`}` 改为
   `title={markerTooltip(photo, photoCount)}`。
   `photoCount` 已在第 185-188 行算好（分组模式取
   `photo.photos.length`，照片模式为 1），无需新增计算。

3. `key={index}` 保持不变——序号仍是 React 复用标记，只是不再
   暴露给用户。

### 技术前提（已核对依赖源码，非推测）

- `title` 在 Marker 构造时经 `{...other}` 传给 `new AMap.Marker()`
  （`@uiw/react-amap-marker/src/useMarker.tsx:8,18`）。
- 同一 hook 的 `useSettingProperties` 注册了 `'Title'`（第 48 行），
  而该工具函数会把 `'Title'` 映射为 prop 名 `title`
  （`@uiw/react-amap-utils/src/index.tsx:139`），所以 `title` 变化会
  调用 `marker.setTitle()` 动态更新，无需重建 marker。本方案为静态
  值，不依赖此路径，但确认了无副作用。

## 实现记录（2026-09-30）

- `./node_modules/.bin/eslint src --ext .js,.jsx,.ts,.tsx
  --max-warnings=0` 退出码 0（stderr 仅有 CRA 的
  `babel-preset-react-app` 未声明依赖告警，为既有噪声，与本次改动无关）。
- 以 `output.json` 真实数据离线模拟 `markerTooltip`，确认文案：
  - 文件夹模式最长的两条：「乌兰察布市集宁区-北官房铁路小区3号楼附近
    （共 44 张）」33 字、「乌兰察布市集宁区-通州街跨京包线公路桥
    （共 12 张）」27 字；余下 8 条均在 20 字内；
  - 照片模式（175 张）：「DSC04376.JPG · 2026-08-15 10:01」形态；
    用户实测的 index 102 → 「IMG_4559.HEIC · 2026-07-25 13:54」。
- 验收第 4 条（原生 tooltip 折行观感）需用户 `npm start` 实测，
  属浏览器/系统行为，agent 环境无法替代验证。

## 验收标准

1. 照片分组模式（`hcm_group_by === 'photo'`）悬停任一 marker，
   显示「文件名 · 拍摄时间」，如 `IMG_4559.HEIC · 2026-07-25 13:54`；
2. 文件夹分组模式悬停任一 marker，显示「文件夹名（共 N 张）」，
   N 与该组实际张数一致（如 `保定-保定站附近永瑞园（共 60 张）`）；
3. 序号字样（`Marker N`）不再出现在 tooltip 中；点击 marker 打开
   抽屉、平移居中的行为不变；
4. 悬停最长的文件夹名（`乌兰察布市集宁区-北官房铁路小区3号楼附近
   （共 44 张）`），确认 tooltip 未超宽到不可读——原生 tooltip 折行
   行为由浏览器/系统控制，若实测难看完，本轮降级为只显示 `dirName`；
5. `./node_modules/.bin/eslint src --ext .js,.jsx,.ts,.tsx
   --max-warnings=0` 通过；
6. CI 门禁 `CI=true ./node_modules/.bin/react-scripts build`——按
   `docs/toolchain.md`，repo 根已有 `build/` 时 agent 在本环境跑必
   失败，此步交由用户终端执行。

## 出界清单（本轮不做）

- 方案 A（只改序号从 1 开始）、B（只显示文件名+时间，不分模式）、
  C（加上文件夹名，tooltip 过长）、E（删掉 tooltip）、F（自定义悬停
  浮层 / AMap InfoWindow）——均不实现；
- 不用 `localStorage.getItem('hcm_group_by')` 作判别式：那会把"数据
  来源选择"（第 56-57 行 `allPhotos`）与"文案分支"变成两处各自读
  localStorage 的双源；`photo.photos` 是数据自描述，更内聚。已知代价：
  `flattenPhotos` 第 16-28 行兜底分支（`group.photos` 为空时）产出的
  item 无 `photos` 字段，会被判为照片模式——该分支在当前数据下不可达
  （10 个分组 `photos` 均非空），如将来触达则回落到「文件名 · 时间」，
  属可接受降级；
- 不顺带统一 `photoList` useMemo（第 107 行）里第三处
  `localStorage.getItem('hcm_group_by')` 读取——属独立重构，另开；
- 不改 `.hcm-photo-pin` 样式定义位置（现位于
  `src/Application/MapIcon/index.css`，靠 CRA 全局打包对地图页生效，
  属历史遗留怪位置）；
- 不动 `output.json` 数据结构、不动 `process-photos.js`；
- 不动 `MapIcon/index.css`、`MapChildren.module.css` 等样式文件
  （本方案纯文案，无样式改动）；
- 不动 `src/Application/MapIcon/MapIcon.jsx:38` 的 `title="Marker"`
  （独立组件，非地图页）。
