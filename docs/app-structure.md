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

`huochemi/data` **没有** `.github/workflows`——它是 Pages 的 legacy 分支发布（Settings →
Pages 直接指向 `main`），`git push` 即触发重建，不经过 Actions、也没有"部署 job 成功"这类
信号可看。**新文件有边缘传播延迟**：`push` 后立刻请求新路径可能 404，约 1 分钟内转为 200
（2026-10-07 实测：同批文件里 `index.json` 先就绪、`_thumb.webp` 后到）。⇒ 排查"图 404"
时先用**已上线的旧点位**做对照请求，别误判成路径写错或部署失败。

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

## 底图四档与影像源契约（2026-10-06）

组件 `src/Application/Map/AMap/BaseMapSwitch.jsx`。**唯一事实源是它的 `mode` state**
（localStorage 键 `hcm_base_map`，模块级单点读取）。

| mode | Satellite | RoadNet | 自定义影像层 | 观感 |
|---|---|---|---|---|
| `satellite` | 显示 | 隐藏 | 隐藏 | 卫星影像 |
| `satellite-road` | 显示 | 显示 | 隐藏 | 卫星影像 + 路网线 |
| `road` | 隐藏 | 隐藏 | 隐藏 | AMap 标准矢量底图（UI 文案「标准地图」） |
| `overseas` | **显示** | 隐藏 | **显示** | 影像：境外=Esri 高清，境内=露出高德卫星 |

`hcm_base_map` 的四个值是前端持久化契约；存量三个旧值仍合法，新值在旧代码上回落
默认档，**无需迁移**。

### 为什么需要第四档：高德卫星影像对海外只到 z7

2026-10-06 实测（curl 瓦片 + md5 比对）：雅加达/东京/新加坡在 **z8–z14 全部**返回同一张
4235 B 的「此区域无卫星图」占位瓦片（md5 `a85b8640…`），雅加达 z8/9/10 的 3×3 邻域
27 块**全是占位**（整片缺失，非零星断图）；北京/香港 z11 正常 → **该限制只针对海外**。
高德「标准地图」（style=7）海外同样是空瓦片，只有**路网**（style=8）有数据 —— 于是
海外点位放大后就是「灰底 + 橙色路网线」，切任何一档都救不了。

### 机制：逐瓦片判定，境内透明、境外换源

自定义层由 `src/Application/Map/AMap/overseasTiles.js`（**CommonJS 纯函数**）驱动，
AMap 每要一块瓦片就调一次 `overseasTileUrl(x, y, z)`：

```
瓦片编号 → 瓦片中心经纬度（Web Mercator 反算）→ 是否境外
  境外 → Esri World Imagery 瓦片 URL
  境内 → 1×1 透明 GIF 的 data URI（浏览器不发起对外请求，露出下层高德卫星）
```

选逐瓦片而非 `moveend` + 视野四角判定：**无状态、无事件监听、无档位互斥**，跨境内外的
视野天然逐块正确，判定点只有一个纯函数、可被 `test/overseas-tiles.test.js` 全覆盖。
取舍：边界瓦片按**瓦片中心**归属，误差 ≤ 半个瓦片宽（z11 约 0.088°，不随缩放累计）。

### 两条硬约束

1. **境内不得显示外部影像**。① 合规：境内地图须用有资质底图；② 技术：高德瓦片网格在
   境内是 GCJ02，外部 WGS84 影像叠加**必然偏移数百米**（境外 GCJ02 ≡ WGS84 才对得齐）。
2. **境内瓦片不得回落抓高德瓦片**。高德开放平台服务协议禁止抓取/缓存高德数据图片；
   且下层的 `AMap.TileLayer.Satellite` 本来就显示着，透明即可露出，无需再抓一份。
   测试里有一条全域扫描断言：任何返回值都不得含 `autonavi` / `amap.com`。

### 影像源：写死单域名，不做运行时降级

`ESRI_TILE_URL_TEMPLATE = https://server.arcgisonline.com/…/tile/{z}/{y}/{x}`
（2026-10-06 用户浏览器 + agent 两侧实测可达；条款为非创收应用 + <100 万瓦片/月，需署名，
由 `.attribution` 承担）。**已知备选**（Esri `services` 域、EOX Sentinel-2）只记录在
plan 里，**代码中不出现** —— 不做探测、不做主备切换（`AGENTS.md` S3）。

⚠️ 参数顺序是 `{z}/{y}/{x}`，与 OSM 的 `{z}/{x}/{y}` **相反**：写反不报错、只静默拿到
地球另一处的影像，故测试用「URL 尾部数字必须等于 (z, y, x)」锁死顺序。

`zooms: [8, 20]`（下限 8：z≤7 高德自带海外影像，本层不必请求）；z 超过源原生上限
（z19）时按 z19 取图并由浏览器拉伸 —— 与 Leaflet 的 `maxNativeZoom` 同义，宁可是
"放大后的影像"，也不要退回高德的灰色占位图。

决策全过程与验证取证见 `docs/plans/2026-10-06-overseas-imagery-manual-mode.md`。

## 待整理项（未做）

当前唯一的 demo 实体仍在 `src/Application/MapIcon/`，且它的 `index.css` 仍被生产
地图页借用（`.hcm-photo-pin` 系列 marker 样式定义在 demo 目录内，靠 CRA 全局打包
对生产页生效）。整理方案——把该样式迁回产品侧、demo 移入 `demos/`——见
`docs/plans/2026-09-30-demo-registry-query-param.md` 阶段二。
