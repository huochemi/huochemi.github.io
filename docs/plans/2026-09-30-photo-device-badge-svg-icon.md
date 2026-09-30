# Plan: 缩略图角标的设备图标由 emoji 改为内联 SVG

- 日期：2026-09-30
- 状态：**已实现（2026-09-30，用户批准后实施）**
  - 3 项待确认点用户未另行指定，按本 plan 默认值落地：图标 11px、手机图标保留底部
    横线、保留 `role="img" + aria-label`
  - 代码改动：`MapChildren.jsx`（删 `deviceEmoji()`、新增 `DeviceBadgeIcon`、
    `thumbnailBadgeLabel` → `thumbnailBadgeText`、角标渲染改文本段 + 图标段）、
    `MapChildren.module.css`（新增 `.photoBadgeIcon`），前端仅此 2 个文件
  - 校验：`eslint src --ext .js,.jsx,.ts,.tsx --max-warnings=0` exit 0
  - 知识回写：`docs/data-pipeline.md`（用途句 + 前端配合段）；本 plan 取代关系的
    记录已追加进 `docs/plans/2026-09-30-photo-device-badge.md` 末尾
  - 未完成（依赖用户侧）：`npm start` 目视验收、CI build（`build/` 存在的门禁，
    交用户终端执行）
- 前置：`docs/plans/2026-09-30-photo-device-badge.md`（已实现）——本次只替换该 plan
  落地的「第三段图标」的**呈现实现**，不改角标的三段结构、语义与数据字段
- 知识回写：`docs/data-pipeline.md`「拍摄设备类型 device」小节的前端配合段（见 3.2）
- 影响面：前端 2 个文件（`MapChildren.jsx` + `MapChildren.module.css`）；管线、
  `output.json`、数据仓库均不动

## 问题（根因）

用户 2026-09-30 截图反馈：角标里的设备 emoji「确实有点看不清」。

根因不是尺寸或透明度不足，而是 **emoji 颜色不受 CSS 控制**：

- `deviceEmoji()` 返回的 `📷` / `📱` 走系统彩色 emoji 字体（Apple Color Emoji）渲染，
  字形是**固定配色的位图字体**，CSS 的 `color: #ffffff` 对它完全无效
- `📷` 机身本身是深灰色，叠在 `.photoTimeBadge` 的 `rgba(0, 0, 0, 0.55)` 半透明黑底
  （再叠在深色照片上）后，明度差接近 0，等于隐形
- 该问题在 `docs/plans/2026-09-30-photo-device-badge.md` 的决策记录第 3 条被显式接受
  （「接受 emoji 彩色字形与角标白色文字混排」），当时未做深色照片下的目视验证，
  本条决策**由本 plan 取代**（见「与既有决策的关系」）
- 附带缺陷：emoji 字形跨平台差异大（Windows / Android 的 `📷` 为更暗的扁平色块），
  同一份数据在不同系统上可见度不一致

## 需求

角标第三段（设备类型）在任何底图色、任何平台上都要**清晰可辨**，且与角标的白色
文字风格统一。

## 方案选型

- **采纳 B（内联单色 SVG 图标）**：图标用 `stroke="currentColor"` 线性绘制，颜色
  跟随角标的 `color: #ffffff`，与底图彻底解耦；渲染逐字节一致，跨平台无差异；
  零网络请求、零新增资源文件，bundle 仅增数百字节
  - 与本 repo 既有图标惯例一致：`MapChildren.jsx` 里 Lightbox 的「ⓘ」按钮与
    底部时间胶囊已是同款内联 SVG（`viewBox="0 0 24 24"` / `fill="none"` /
    `stroke="currentColor"` / `strokeWidth="2"` / `strokeLinecap="round"`），
    本次不引入新范式
- **否决 A（CSS `filter: brightness()` 提亮 emoji）**：能改善但治不彻底——emoji
  位图提亮后发灰发脏，且提亮倍数在浅色底图（如雪景、天空）上会过曝；仍未解决
  跨平台字形差异
- **否决 C（emoji 垫浅色圆底）**：对比度可保证，但给 11px 角标加一个 15px 白圆片，
  视觉重量压过文字，且仍在用位图 emoji
- **否决 D（只加深角标底色）**：深色 emoji 与更黑的底同向变暗，收益接近 0
- **附带否决：删掉设备图标**：设备类型是真实信息（用户本轮截图两处角标都靠它区分
  机型），且会推翻已实现的 plan，不取

## 改动内容

### 1. `src/Application/Map/AMap/MapChildren.jsx`

1.1 **删除** `deviceEmoji()`（L72-75），**新增** `DeviceBadgeIcon` 组件，返回内联
SVG；未识别（`device` 为 undefined / 其他值，即角标无图标）时返回 `null`：

```jsx
// 拍摄设备类型 → 角标内联 SVG 图标（stroke 继承角标白色，跨平台一致）。
// 不用 emoji：彩色字形配色固定不受 CSS 控制，叠深色底图即隐形
// （见 docs/plans/2026-09-30-photo-device-badge-svg-icon.md）
const DeviceBadgeIcon = ({ device }) => {
  const d =
    device === 'phone'
      ? { label: '手机拍摄', body: <rect x="7.5" y="2.5" width="9" height="19" rx="2.5" /> , bar: 'M11 18.6h2' }
      : device === 'camera'
        ? { label: '相机拍摄', body: <rect x="3" y="7" width="18" height="13" rx="2.5" />, bar: null }
        : null;
  if (!d) return null;
  return (
    <svg
      className={styles.photoBadgeIcon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      role="img"
      aria-label={d.label}
    >
      {d.body}
      ...
    </svg>
  );
};
```

（上面是形态示意：相机 = 机身圆角矩形 + 镜头圆；手机 = 竖长圆角矩形 + 底部横线。
落地时按此收敛为两个分支各一段 JSX，不写成数据表——两枚图标差异是结构性的，
用数据表反而更难读。`role="img" + aria-label` 刻意区别于既有装饰性图标的
`aria-hidden`：设备类型是唯一承载该信息的位置，emoji 时代屏幕阅读器会念出
「camera」，换成 SVG 后不能丢这个语义）

1.2 **角标拼接改为「文本 + 图标」两段渲染**。emoji 时代 `thumbnailBadgeLabel()`
返回单一字符串、整体 `join(' · ')`；SVG 是元素，无法再进 `join`，故拆为：

```jsx
// 角标文本段（时间 · 格式）；emoji 段迁出为 DeviceBadgeIcon，故不再返回单一字符串
const thumbnailBadgeText = (photo) =>
  [formatTakenAtShort(photo.takenAt), formatFileExt(photo.fileName)]
    .filter(Boolean)
    .join(' · ');
```

渲染处（现 L319-324）：

```jsx
{(p.takenAt || p.fileName || p.device) && (
  <span className={styles.photoTimeBadge}>
    {thumbnailBadgeText(p)}
    {thumbnailBadgeText(p) && p.device && ' · '}
    <DeviceBadgeIcon device={p.device} />
  </span>
)}
```

- 「缺项自动省略」语义完整保留：无 `takenAt`/`fileName` 时文本段为空串 →
  不渲染前导 ` · `，角标只剩图标；无 `device` 时 `DeviceBadgeIcon` 返回 null，
  角标与改动前逐像素相同
- **不用 `inline-flex + gap` 重构**：flex 容器会把分隔符两侧的文本空格吞掉，改为
  flex 需把 `·` 也做成元素，是无收益的布局模式变更，故保持 inline 布局

1.3 **不动的部分**（有意保持）：`thumbnailBadgeLabel` → `thumbnailBadgeText` 仅
重命名与缩减职责；`flattenPhotos` 的 `device` 透传（L32 / L41）不改——上一 plan
的「按照片分组模式丢图标」坑已修好，本次不碰。

### 2. `src/Application/Map/AMap/MapChildren.module.css`

新增一个类，`.photoTimeBadge` 本体样式**不动**（底、字、padding、圆角全部保留）：

```css
/* 角标内的设备图标：尺寸与角标 11px 文字对齐，随 color 继承为白色 */
.photoBadgeIcon {
  width: 11px;
  height: 11px;
  vertical-align: -1px;
}
```

- 落地后目视校准两点（不改结构）：
  - 若 11px 下 1px 有效描边发虚，把该图标的 `strokeWidth` 提到 `2.4`（只动图标，
    不放大尺寸、不动角标 padding）
  - `vertical-align: -1px` 会让角标行盒高 17px → 18px；若目视觉得角标变高，改用
    `-0.5px` 或 `middle`，**不通过改 padding 抵消**

### 3. 文档（知识回写）

3.1 `docs/plans/2026-09-30-photo-device-badge.md`：**不删不改历史**（P1）。在该文件
末尾「决策记录」后追加一段「后续修订（2026-09-30）」：注明第 3 条（接受 emoji 彩色
字形、不做内联 SVG）已被本 plan 取代，并给出取代原因（emoji 配色不受 CSS 控制，
深色底图下不可辨）与本 plan 路径

3.2 `docs/data-pipeline.md`：改「拍摄设备类型 device」小节的**表述**（字段定义与
分类规则不变）：
- L141 用途句：`📱`（手机）/ `📷`（相机）→ 「内联 SVG 图标（手机 / 相机）」
- L148 字段定义句「存的是语义枚举，不是 emoji——emoji 属展示层」保留不动，
  仍是有效结论（本次改动发生在前端，数据层无变化）
- L178 前端配合段：`deviceEmoji()` 做枚举 → emoji 映射 → 改为
  `DeviceBadgeIcon` 组件做枚举 → 内联 SVG 映射，并补一句「不用 emoji 的原因：
  彩色字形配色固定不受 CSS 控制，深色底图下不可辨」

3.3 `AGENTS.md` **不动**：未新建域文件，按流程 3 不改路由

### 4. 不涉及

`process-photos.js`、`output.json`、`data` 仓库、`MapIcon.jsx`（该文件是独立 demo，
marker 内容为 HTML 字符串、无角标）全部不动。

## 不做的事（出界清单）

- 不改角标的三段结构与顺序（`时间 · 格式 · 图标` 维持上一 plan 的决定）
- 不改 `.photoTimeBadge` 的底色 / 字号 / padding / 圆角
- 不引入图标库（react-icons 等）或 SVG 资源文件，只内联两个 path
- 不给图标加快捷键之外的任何交互（保持 `pointer-events: none`）
- 不在 Lightbox 信息面板加「拍摄设备」行
- 不动 `flattenPhotos` 的 `device` 透传
- 不处理角标在窄缩略图下溢出的历史遗留问题（上一 plan 已声明另起 plan）
- 不改数据层（`device` 仍为语义枚举，不加 `icon` 之类展示字段）

## 验收标准

1. `./node_modules/.bin/eslint src --ext .js,.jsx,.ts,.tsx --max-warnings=0` 零 warning
   （`--max-warnings=0`，不遗留任何 warning）
2. `CI=true ./node_modules/.bin/react-scripts build` 通过（在用户终端执行）
3. 用户 `npm start` 目视验收：
   - 深色照片（如「石景山南站附近1」「郑州市-解放路跨铁路桥」）上角标第三段图标
     **清晰可辨**，与前面的白色文字明度一致
   - 相机组（房山长阳-碧桂园温泉小区C区，NEX-5N）显示方形相机轮廓；手机组
     （石景山南站 iPhone X）显示竖长手机轮廓，两者一眼可分
   - 乌兰察布市集宁区-北官房铁路小区3号楼附近（混机）两种图标各归其位
   - 角标整体高度、与左边缘/下边缘间距与改动前无明显跳变
4. 切到「按照片分组」模式，图标同样出现（回归确认 `flattenPhotos` 未受影响）
5. 无 `device` 的照片角标不出现多余 ` · `、不留空位（与改动前一致）
6. 屏幕阅读器/可访问性树中，图标仍以「手机拍摄 / 相机拍摄」被朗读

## 与既有决策的关系（ADR）

本 plan **取代** `docs/plans/2026-09-30-photo-device-badge.md` 决策记录第 3 条，
其余 3 条（分类表内容、图标位置为第三段、未识别汇总）继续有效。

取代依据：该条决策的前提是「emoji 与白字混排观感可接受」，此前提在深色底图场景下
被用户实测推翻（2026-09-30 截图，`📷` 机身与黑底明度差≈0）。属**前提失效导致的
决策修订**，不是返工——数据结构、字段语义、角标段数均未变，仅呈现实现层替换。

## 待用户确认的点

1. 图标尺寸取 11px（与角标字号对齐）是否认可，或希望 12px（与 Lightbox 胶囊图标
   同尺寸、略大更清晰）
2. 手机图标是否需要保留「底部横线」细节（11px 下可能糊成一团，去掉只剩竖长圆角
   矩形，与相机矩形的区分度依然足够）
3. `role="img" + aria-label` 保留可访问性语义，还是按既有装饰性图标惯例
   `aria-hidden="true"` 简化

## 决策记录（2026-09-30 用户批准）

1. **选型**：用户拍板方案 B（内联单色 SVG），否决 A（CSS 提亮）/ C（浅色圆底）/
   D（只加深底色）与「直接删图标」
2. **3 项待确认点**：用户以「开始」批准实施、未另行指定，按 plan 默认值落地——
   图标 11px（与角标字号对齐）、手机图标**保留**底部横线、**保留**
   `role="img" + aria-label`（不降级为 `aria-hidden`）
3. **实施结果**：改动与 plan 一致，未越界（管线、`output.json`、数据仓库、`AGENTS.md`
   均未动）；eslint exit 0
4. **待用户目视后可能触发的微调**（plan「落地后目视校准」两点的实测结论待补）：
   11px 下描边是否发虚（备选：`strokeWidth` 2 → 2.4，仅动图标）、角标行盒高
   17px → 18px 是否碍眼（备选：`vertical-align` -1px → -0.5px / middle，不动 padding）
5. **有意留下的边界**：分隔符用 `p.device` 真值性判定，未对「`device` 是枚举之外
   的未知字符串」做防御——`device` 由管线按枚举写入，出现第三值属数据异常，
   「多一个 ` · `」与「不显示图标」同属异常表现，不为此加一层枚举校验
   （避免同一枚举在两处各判一遍）
