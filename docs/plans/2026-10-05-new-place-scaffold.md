# 新点位脚手架：`npm run new-place`（起草 index.json，不做兜底）

状态：已实现（2026-10-05）
日期：2026-10-05
实现说明：新增 `new-place.js`（+ `package.json` 的 `new-place` script）；`process-photos.js`
两处收紧（预检新增 `description` 判据、生成段去掉条件展开）；两个契约测试的 `CLI_FILES`
纳入第四个 CLI；三处 docs 同步。eslint（src / test / new-place.js，`--max-warnings=0`）
零 warning；`npm run test:cli` **23/23 全绿**。验收标准 1–8 在 `/tmp/np-verify` 隔离副本
逐条跑过（S1：复制真实照片，不碰 `../data/photos` 与 `../photos-originals/photos`）：
四条失败路径**零副作用**，失败文案含 `index.json` 完整路径与补法（照做即可跑通）。
真实 data 仓 14 个点位实测**全部**满足新契约 → 无退化。
修订：2026-10-05 —— 按用户拍板把 `description` 定为**必填**。此项连带修改
`process-photos.js` 的预检判据与生成逻辑，**相对初稿扩大了范围**（初稿出界清单曾明确
"不改判定逻辑"）；范围变更与理由见「连带改动」一节，出界清单已同步修订。
修订：2026-10-05 —— 按用户拍板**去掉 `--desc`**：位置参数（点位名）直接写入
`description`，脚本里不再存在这个参数。理由：一次新建只该有一个名字输入；要更短的展示名，
建好后直接编辑 `index.json`（本工具对已存在的 `index.json` 恒硬拦不覆盖，所以那是唯一改法）。
连带一条：未定义的 `--xxx` 一律走通用"未知参数"报错——原先未知参数会掉进位置参数里、
报成"参数数量不对"，指不到问题本身。**该参数不做任何特判或迁移提示**（与 `--foobar`
同等对待）。下面「方案 D」的接口 / 行为规格 / 已拍板 / 验收标准已就地改写为该口径。
来源会话：用户跑 `npm run photos` 时，新点位 `北京市-水南庄道口` 在 data 仓被自动建了空目录、
因缺 `index.json` 被预检跳过（退出码 1）。用户提出"能否自动生成 `index.json` 模板，让这一步
直接跑完，减少手工"。本计划是该问题的落地设计；被否决的候选方案见「被否决的方案」一节。

相关：`docs/photo-workflow.md`（标准流程第 3 步「维护 index.json」）、`docs/data-pipeline.md`
（双根与「导入新照片」）、`docs/photo-metadata.md`（预检是"能不能产出"的唯一判定点）、
`docs/photo-ops.md`（`del-photo` 的「不自动重跑管线」决定）

## 背景（自包含，零上下文可读）

站点是照片地图。**真相源（原图，不可再生）在仓库外的
`../photos-originals/photos/<点位>/`；派生图（可再生）与 `index.json` 在
`../data/photos/<点位>/`**（双根改造见 `2026-10-04-data-repo-longevity.md`）。

新建一个点位，现在要手工做三件事：

1. 原图仓建目录、放进照片
2. data 仓建同名目录
3. 写 `index.json`：`{ "index_photo": "<封面文件名>", "description": "<展示名>" }`

`index_photo` 提供**组级坐标**与**缩略图来源**，是必填；`description` 是展示名。

漏掉第 3 步时，`npm run photos` 的行为是：原图仓有、data 仓没有的点位 → 自动建空目录 →
因缺 `index.json` 被预检跳过。失败粒度是"该点位跳过、其余照常产出"，但退出码 1，用户必须
补文件后**再跑一轮 photos**。

痛点即此：手写 `index.json` 又慢又易错（封面文件名写错 → 又一轮），而这一轮的等待本可避免。

## 核心结论：为什么不做"自动生成 + 本轮继续"

一个原理性矛盾必须先讲清：

**「跑一轮 photos 就产出」与「不做兜底」不可兼得。**

要让第一轮就产出，脚本必须在读到「`index.json` 不存在」之后自行决定封面并继续。这只有两种
实现，性质相同：

- 隐式推导一个封面值（运行时算，不落盘），或
- 先写一个自己刚判定为缺失的文件、再立刻读它。

两者都是**脚本替人猜**。后者还会把「缺 `index.json` 即失败」这条判据实质废掉——写了自己读，
该判据永不成立。

本项目已有明确纪律反对这种兜底：`AGENTS.md` S3（不做多重兜底）、`docs/photo-ops.md`
（「**不做**自动挑替补救封面」）、`docs/photo-metadata.md`（预检是"能不能产出"的唯一判定点）。

因此本方案**不碰 `process-photos.js` 的产出判定**（唯一例外是下文「连带改动」，那是把
`description` 收紧为必填，方向与兜底相反），改为把手工三件事收成一条显式命令。

## 被否决的方案（P1：保留决策过程）

| 方案 | 做法 | 否决理由 |
|---|---|---|
| A 自动起草 + 本轮继续 | photos 遇到新点位时写 `index.json` 并继续处理 | 即上述"实质兜底"；还会把「缺 index.json 即失败」判据废掉；静默替用户定封面 |
| A′ 自动起草 + 本轮仍跳过 | 同上，但本轮照旧跳过 | 不兜底，但**没省掉重跑 photos**，只省手写；且要为 `photos` 扩大写权限边界（撞「预检零写操作」纪律） |
| B 字段可选化 | 缺 `index.json` 时按确定性规则推导封面与展示名，不写盘 | **运行时推导 = 兜底**（用户明确反对）；决策不留痕，违反 P1 精神 |
| C 只加提示 | photos 预检失败时打印可直接粘贴的 `index.json` 内容 | 仍要粘贴一次、仍要自己核对文件名（易错点未消除）；且要改 `photos` 的输出分支 |
| D′ `description` 可省略 | 不传 `--desc` 则模板里不写该 key，管线靠条件展开兼容 | **用户 2026-10-05 否决**："不喜欢 fallback……都应该有 description，不应该保持兼容"。省略态 + 条件展开是一种隐性兼容分支，改为必填硬拦 |
| **D 独立脚手架命令** | 新增 `npm run new-place` | **采纳**：零兜底、不侵入 photos 的产出判定、真正减少手工 |

## 方案 D：`npm run new-place`

### 命令接口

```
npm run new-place -- "<点位名>" --cover "<文件名>"
例：npm run new-place -- "北京市-水南庄道口" --cover IMG_2315.HEIC
```

位置参数只有一个含义：**点位名 = 原图仓/data 仓的目录名 = `index.json` 的
`description`**（同一字符串）。想要与目录名不同的展示名，建好后编辑 `index.json`。

参数风格与 `del-photo` / `fix-gps` 一致（`--` 透传、引号包中文名）。未定义的 `--xxx`
一律报错退出（通用文案 `未知参数：<原样回显>`），不当位置参数吞掉。

### 行为规格

**先校验、后写入**——全部前置条件通过后才做任何文件系统变更（沿用 `photo-ops.md`
「硬拦排在写操作之前」的纪律）。

校验（任一失败即退出码 1，且**零文件系统变更**）：

1. 点位名合法（非空、非 `.` / `..`、不含路径分隔符与 NUL），与 `delete-photo.js`
   的 `assertPlainName` 同口径
2. 原图仓 `<ORIGIN_DIR>/<点位名>/` 存在，且含 ≥1 个媒体文件（`ALLOWED_EXTS`，
   剔除派生文件）
3. 若传了 `--cover`：该文件名在上述媒体清单中
4. data 仓 `<IMGS_DIR>/<点位名>/index.json` **不存在**（已存在即硬拦，绝不覆盖）

执行（全部校验通过后）：

5. 建 data 仓点位目录（已存在则跳过）
6. 写 `index.json`：**两个 key 恒存在**，`description` 取点位名（恒非空）
7. 打印下一步提示：`npm run photos`

### 输出（遵循 emoji 契约）

- 成功 → `✅ 已创建点位 [X]：data 仓目录 + index.json（封面 = Y，展示名 = X）`，
  随后 `ℹ️ 下一步：npm run photos`
- 未传 `--cover` → `❌ 未指定封面`，随后列出候选清单（每行一个媒体文件名）与用法示例
- 其余失败 → `❌ <原因>` + `💡 <下一步>`

### 明确不读 EXIF

`new-place` 只用 Node 内置 `fs` / `path`，与 `delete-photo.js` 同档（零外部命令、
零子进程、无启动预检）。

**它不校验封面是否有 GPS**——判定权唯独属于 `photos` 的预检（`photo-metadata.md`：
预检是"能不能产出"的唯一判定点）。若 `new-place` 也判一次，就成了双判定点，会出现
"两处口径不一致"的漂移风险。封面无 GPS 时 `photos` 会照旧硬拦并给出 `fix-gps` 命令。

**封面不给默认值**：不传 `--cover` 即退出。脚本从不猜。

## 已拍板（2026-10-05）

1. **`description` 必填、且不保留兼容态**：`new-place` 始终写入该 key，取值 = 点位名；
   `process-photos.js` 不再对缺失作条件展开，改为预检硬拦。理由：不搞
   "有时有该 key、有时没有"的隐性兼容分支，也不在运行时补默认值——**统一为"key 恒存在"**
2. **命令名**：`new-place`
3. **`--desc` 不存在**（2026-10-05 修订）：位置参数即 `description`；未定义参数一律报错，
   不做特判、不留迁移提示

## 连带改动：把 description 定为必填

这是本次唯一触碰 `process-photos.js` 的地方，方向是**收紧**（硬拦）而非放宽（兜底）。

1. **预检**（`preflightDir`，约 694–717 行一带）：在既有 `index_photo` 校验之后新增一条
   失败判据——`typeof indexConfig.description !== 'string'` → 失败。空串合法（用户明确
   接受 `""`）

   **reason / hint 必须自足**（用户 2026-10-05 要求：「只要有明显的报错，并且给出明确的
   步骤该怎么修就能让脚本跑通」）——要指出**改哪个文件、加什么内容**，不让用户自己找路径。
   路径由预检内已有的 `dirPath` 拼出：

   ```
   ❌ 文件夹未通过预检：北京市-水南庄道口
     原因：index.json 缺少 "description"（或不是字符串）
     做法：编辑 ../data/photos/北京市-水南庄道口/index.json，
           补上 "description"（可填空串 ""，也可填展示名）
     然后重跑：npm run photos
   ```
2. **生成**（约 950 行）：删去 `...(indexConfig.description ? { description: ... } : {})`
   条件展开，改为无条件 `description: indexConfig.description`
   （相邻的 `takenAt` 条件展开**不动**——那是 EXIF 真实可缺的字段，不属本契约）
3. `docs/photo-metadata.md`：预检失败判据清单补"`description` 缺失或非字符串"
4. `docs/photo-workflow.md`：`index.json` 字段说明改为"两个字段均为必填"

**影响评估**：现有 13 个点位的 `index.json` **全部**含非空 `description`（2026-10-05
实测），故本条不改变任何现有点位的产出；它只约束新建点位与将来手写的文件。

## 出界清单（本计划明确不做）

- 不改 `process-photos.js` 的产出判定（「缺 `index.json` 即跳过」「组内任一张缺坐标即跳过」
  均保留原样）。**唯一例外**是「连带改动」的两条——那是把 `description` 从可选收紧为必填
- 不自动推导 / 填充封面（无默认值）
- 不提供 `--desc`（位置参数即 `description`）；未知参数不吞、不做别名或迁移兼容
- 不在运行时为 `description` 补默认值（改为预检硬拦）
- 不覆盖已存在的 `index.json`（不提供 `--force`）
- 不自动创建原图仓目录（不代用户放照片）
- 不校验封面 / 任何媒体的 GPS
- 不自动重跑 `photos`（与 `del-photo` 的 v4 决定一致：命令即确认，重跑由用户攒够了一次性跑）
- 不删除 / 修改任何媒体文件
- 不改 `AGENTS.md` 路由表（知识进既有域文件时本文件不动，见流程 #3）

## 验收标准

1. 正常路径：原图仓有点位 + `--cover` 正确 → data 侧目录与 `index.json` 建成，
   **恰含 `index_photo` / `description` 两个 key**，且 `description` **逐字等于点位名**，退出码 0
2. 传未定义参数（如 `--foobar`）→ 退出码 1、**零副作用**，文案为通用的
   `未知参数：<原样回显>`（不对任何具体参数做特判或迁移提示）
3. 不传 `--cover` → 退出码 1，打印候选清单，**目录快照 md5 不变**
4. `index.json` 已存在 → 退出码 1，该文件内容 md5 不变
5. `--cover` 指向不存在的文件 → 退出码 1，零副作用，打印候选清单
6. 点位名含 `/`、`\` 或为 `..` → 退出码 1
7. 点位名合法但原图仓无该目录 / 无媒体 → 退出码 1，零副作用（**不在 data 侧建目录**）
8. **（连带改动）** 构造缺 `description` 的 `index.json` → 该点位被跳过、其余照常产出、
   退出码 1；正常点位的 `output.json` 项**恒含 `description` 字段**。失败文案须**含
   该 `index.json` 的路径与补法**（照做即可跑通，见「连带改动」的样例）
9. `npm run test:cli` 全绿
10. `./node_modules/.bin/eslint new-place.js test --ext .js --max-warnings=0` 零 warning

（1–8 在 `/tmp` 隔离副本上验证，S1：不碰 `../data/photos` 与 `../photos-originals/photos`。
第 8 条只能靠隔离副本跑真实 CLI 验证——`process-photos.js` 未模块化，测试只 `require`
得到常量，无法单测生成逻辑。）

## 触及文件

| 文件 | 改动 |
|---|---|
| `new-place.js` | 新增（预计 150–200 行，参照 `delete-photo.js` 风格） |
| `package.json` | scripts 增 `"new-place": "node new-place.js"` |
| `process-photos.js` | 预检加 1 条判据；生成去掉 1 处条件展开（见「连带改动」） |
| `test/dual-root.test.js` | `CLI_FILES` 加 `new-place.js`（锁 ORIGIN_DIR / IMGS_DIR 同值） |
| `test/video-support.test.js` | `CLI_FILES` 加 `new-place.js`（锁 ALLOWED_EXTS / DERIVED_SUFFIXES 同值） |
| `docs/photo-metadata.md` | 预检失败判据清单加一条 |
| `docs/photo-workflow.md` | 第 3 步补 `new-place` 用法；`index.json` 字段说明改为两字段必填 |
| `docs/data-pipeline.md` | 「导入新照片」节补一句：data 侧目录与 `index.json` 可由 `npm run new-place` 一键建 |

## 风险

- **本次会动 `process-photos.js` 的预检与生成段**——这是初稿刻意回避的区域。缓解：
  改动只有两处、方向是收紧；现网 13 个点位已满足新契约（实测），不会触发退化
- `CLI_FILES` 变更会同时触及两个测试文件
- 第四个 CLI 意味第四份 `ORIGIN_DIR` / `IMGS_DIR` 常量副本——这是既有架构选择（刻意不抽
  共享模块），由契约测试兜住，不新增机制
