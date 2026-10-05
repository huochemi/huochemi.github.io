# 应用结构与开发约定

本文件记录 `src/Application/` 的结构约定。领域知识另见 `docs/data-pipeline.md`
（照片管线）与 `docs/toolchain.md`（工具链）。

## `/data` 的发布方式（照片数据的来源）

地图页的照片**不在本仓库**：`output.json` 里的链接是**相对路径** `/data/photos/…`，
由 `huochemi/data` 仓库提供。线上与本地各接一头：

| 环境 | 谁提供 `/data/…` |
|---|---|
| 线上 | `huochemi/data` 作为 **GitHub Pages 项目站点**发布到 `https://huochemi.github.io/data/`（已实测 `…/IMG_5195_thumb.webp` 返回 `image/webp`） |
| 本地 dev | `src/setupProxy.js` 把 `/data` 静态挂到本地 `../../data`（**仅 dev server 生效**，`build` 不受影响，故本地增删照片无需先提交 data 仓） |

**相对路径是刻意的**：线上与本地共用同一套 URL，前端零环境分支。

> 2026-10-05 形态 B 起，**原图**移出 `data` 仓、进私有存档仓 `photos-originals`；
> 该仓**不开 Pages、不参与任何前端链接**——`/data/photos/…` 的结构与路径完全不变。
> 详见 `docs/data-pipeline.md`「双根管线」与
> `docs/plans/2026-10-04-data-repo-longevity.md`。

## 目录

```
src/Application/
  index.jsx            # 应用壳 + demo 分发：全站唯一读取 ?demo 的地方
  demos/
    registry.js        # demo 注册表：demo 名 → 组件
    parseDemoName.js   # 纯函数：从查询串解析 demo 名（带单测）
  Map/                 # 生产地图页
  MapIcon/             # 当前唯一的 demo（尚未整理，见文末）
```

## demo 分发机制

`src/Application/index.jsx` 读取查询参数 `?demo=<名>`，查注册表后渲染对应 demo；
无参数或名字未命中则渲染生产地图页 `<Map />`。

### 新增一个 demo

1. 写 demo 组件（建议放 `demos/<名>/`）；
2. 在 `src/Application/demos/registry.js` 的 `demoRegistry` 里加一行
   `<名>: 组件`；
3. 访问 `/?demo=<名>`。

**入口代码永远不用改**——这是这套机制存在的全部意义。

### 为什么用查询参数，而不是 `/demos/<名>/` 路径

- 本站是 GitHub Pages 纯静态托管，没有服务端 rewrite：路径形式的深链与刷新会返回
  404，要修就得加"postbuild 复制 `index.html → 404.html`"的构建期 hack，且 HTTP
  状态码仍是 404。
- 更关键的是，路径形式的缺陷**在本地不会暴露**：CRA dev server 的
  historyApiFallback 会让 `/demos/x/` 正常渲染，`CI=true` 构建也照样通过——问题只在
  真实托管环境出现，任何本地闸门都拦不住。
- 查询参数在静态站上零成本：任意 query 都返回同一个 `index.html`，刷新、分享、
  粘贴全部正常。

完整方案对比与被否决项见
`docs/plans/2026-09-30-demo-registry-query-param.md`。

### 参数纪律：单一读取点

`?demo` 只在 `index.jsx` 的模块级读取一次。**约定：demo 组件不自行读取
`window.location`**；今后若某个 demo 需要自己的参数，由入口解析后经 props 下发
（当前没有 demo 需要参数，故未实现 props 传递）。

理由是本 repo 已有反例：`localStorage.getItem('hcm_group_by')` 在
`MapChildren.jsx` 中被三处读取，每加一个分支都要重新确认一致性。

### 未命中与告警

非法 demo 名会打印**一条** `console.warn`（列出可用名字）并回落生产页。告警写在
模块级而非 `render` 里，避免随渲染重复打印。

## 待整理项（未做）

当前唯一的 demo 实体仍在 `src/Application/MapIcon/`，且它的 `index.css` 仍被生产
地图页借用（`.hcm-photo-pin` 系列 marker 样式定义在 demo 目录内，靠 CRA 全局打包
对生产页生效）。整理方案——把该样式迁回产品侧、demo 移入 `demos/`——见
`docs/plans/2026-09-30-demo-registry-query-param.md` 阶段二。
