# Lightbox 禁选范围收窄（恢复信息面板文字可选）

状态：已实现（2026-09-28，用户在根因分析后明确说"改吧"批准）

## 背景

- `MapChildren.module.css` 的 `.lightboxOverlay` 上有 `user-select: none`，
  出自 Lightbox 首个提交 46ba6c9（2026-09-24），无决策记录。
- 09-27 新增的 ⓘ 信息面板挂载在遮罩内，继承了禁选，导致文件名、相机、
  坐标、描述等真实需要复制的文字无法选中。
- 地图画布（AMap 拖拽=平移）与城市胶囊条（`<button>`）的不可选是
  by design，本次不动。

## 改动（仅 `src/Application/Map/AMap/MapChildren.module.css`）

1. 删除 `.lightboxOverlay` 的 `user-select: none;`（第 194 行）。
   理由：当初防"看图时误选"针对的是图片/遮罩操作区，那里没有文字，
   且 `<img>` 拖拽走原生图片拖拽、不产生文本选区，禁选对它是无操作；
   外溢到信息面板属于实现遗留。
2. 新增 `.lightboxOverlay ::selection` 定制选区高亮（半透明蓝，
   取面板强调色 #60a5fa 同系），针对深色毛玻璃背景上默认选区可能
   不明显/绘制不出的情况，保证"选了看得见"。

## 出界清单

- 不改地图画布、城市胶囊条（by design）
- 不改 `.panel` DOM 结构与配色
- 不引入新依赖

## 验收标准

1. eslint --max-warnings=0 通过
2. 用户浏览器验收：ⓘ 面板内文件名/相机/坐标/描述可光标选中并复制；
   选区高亮在深色背景上清晰可见；看图（点箭头、拖动大图、点遮罩关闭）
   行为与之前一致
3. CI=true build 由用户终端执行（agent 环境 build/ 存在时必失败，
   见 docs/toolchain.md）
