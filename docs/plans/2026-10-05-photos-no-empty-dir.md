# 去掉 `photos` 在 data 仓自动建空目录的行为

状态：已实现（2026-10-05）
日期：2026-10-05
实现说明：`process-photos.js` 删掉 `resolvePointDirs` 的 `onlyInOrigin` 整块（含 `mkdir`
与 `⚠️` 提示）及随之未使用的 `dataSet`、更新函数头注释；`preflightDir` 缺 `index.json`
的 hint 补一行指向 `npm run new-place -- "<点位>"`（代入 `dirName`）。两处 docs 同步。
eslint（src / test / new-place.js，`--max-warnings=0`）**exit 0 零 warning**；
`npm run test:cli` **23/23 全绿**。
验收 1–7、9 在 `/tmp/np2`、`/tmp/np3` 隔离副本逐条跑过（S1：复制真实照片；环境已清理）。
关键结果：纯 origin-only 场景下**目录快照 md5 跑前跑后完全一致**（零写入）；退出码仍为 `1`、
跳过仍被报出、hint 含真实点位名可照做；`onlyInData` 整轮硬拦**回归通过**（未动）；正常路径
产出的 `output.json` 与改动前**逐字节一致**（md5 `cdba70ab…`）。
**额外实证**：同一 origin-only 场景下，旧脚本与新脚本产出的 `output.json` 也**逐字节一致**
——直接证明了那个 `mkdir` 对产出零功能影响；两者唯一差别就是目录与那行重复提示。
真实 data 仓与原图仓 `git status` 全干净、空目录数 `0`、点位数仍 `14`。
来源会话：用户回到最初的问题——"我跑 `npm run photos` 时，你创建了一个空文件夹在 data 仓里，
你觉得这样对吗？是否需要改进？"本计划是改进方案的落地设计。
相关：`docs/plans/2026-10-05-new-place-scaffold.md`（新增 `new-place` 脚手架，本计划是它的收尾）、
`docs/data-pipeline.md`（双根预检规则）、`docs/photo-metadata.md`（预检是"能不能产出"的唯一判定点）、
`docs/plans/2026-10-04-data-repo-longevity.md`（双根拆分的决策来源）

## 背景（自包含，零上下文可读）

站点是照片地图。真相源（原图，不可再生）在 `../photos-originals/photos/<点位>/`；派生图
（可再生）与 `index.json` 在 `../data/photos/<点位>/`。

`process-photos.js` 启动时先做双根扫描（`resolvePointDirs`，约 1009–1065 行），规则有两条：

- 点位**只在 data 侧**存在 → `throw`，整轮报错退出（"极可能是搬家漏拷"）
- 点位**只在原图仓**存在 → **在 data 侧自动 `mkdir` 一个空目录**（约 1048–1062 行），
  再打印一条 `⚠️` 提示

第二条就是本次要处理的。它的原始注释理由是"缺 `index.json` 会在文件夹级预检里被跳过，
而不是让整轮硬失败"。

## 结论：这个 `mkdir` 应当删除

三条理由，按硬度递进。

### ① 它没有任何功能作用（实测证据）

`preflightDir`（约 690 行）的取值侧是明确分离的：**`index.json` 从 data 侧读（`dirPath`
= `IMGS_DIR/dirName`）、原媒体与 EXIF 从原图仓读（`originDirPath`）**；而 `resolvePointDirs`
最后返回的是两侧**并集**（`[...new Set([...dataDirs, ...originDirs])]`）。

所以"origin-only 点位会被文件夹级预检跳过"这件事，**靠的是并集，不是那个目录**。证据是
用户第一轮的真实输出：

```
北京市-水南庄道口：缺少 index.json 或文件 JSON 格式不正确: ENOENT: no such file or directory,
open '/Users/chenyang/source/huochemi/data/photos/北京市-水南庄道口/index.json'
```

这条 ENOENT 是读**路径**读出来的——目录存在与否都得到同一个结果。原注释把功劳记错了账。

### ② 它是"半状态"，且 git 完全看不见

空目录不进 git：`git status` 不显示、无法提交、在别人的 clone 里不存在。等于提供了一个
**只在当前机器生效**的便利，代价是静默的本地状态漂移（同一份数据在不同机器行为不一致）。

### ③ 硬伤：它会变成地雷

`onlyInData` 那一支是整轮 `throw` 退出。于是这条路径成立：

1. run 1：点位只在原图仓 → 自动建出空目录
2. 之后用户决定不发这个点位、把原图仓那份删掉（空目录不留痕，git 也不提醒）
3. run 2：data 有、原图仓没有 → **整轮报错退出，一个点位都不产出**，且提示"搬家漏拷"

**没有搬家。这个误诊是它自己上一轮写下的。** 即：一次"无害写入"把一个 run 的副作用，
变成了未来某个 run 的假故障。

补充：`delete-photo.js` 全程只用 `fs.unlink`、从不删目录（约 214 行），所以空目录一旦产生
就永久残留，没有任何清理入口。

### ④ 今天多了一条：`new-place` 已经取代它

空目录原本想省的"给我一个地方放 `index.json`"，现已由 `npm run new-place`（2026-10-05
已实现并提交）一条命令做完整（建目录 + 写 `index.json`，且先校验后写入）。`photos` 再偷偷
建一个光秃秃的目录，反而制造了第二个"谁能创建这个目录"的入口。

## 方案 A（本计划）

**删除该 `mkdir`，并把"该怎么办"的提示统一到文件夹级预检的失败报告里（单一报告点）。**

具体三件事：

1. **`resolvePointDirs` 删除 `onlyInOrigin` 整块**（约 1048–1062 行）：不写盘、也不打印。
   该点位仍留在并集里、仍按文件夹级跳过、退出码仍为 `1`——**跳过语义一点不变**。
2. **同步删掉因此变为未使用的 `const dataSet`**（约 1037 行）。它只服务于 `onlyInOrigin`，
   留着会被 eslint 的 `no-unused-vars` 拦下（CI 把 warning 当 error）。**这是必须一并处理的
   细节，漏了 `npm run test:cli` / eslint 会直接失败。**
3. **`preflightDir` 的"缺 index.json"hint 补一行**（约 702–708 行），指向真正的解法：

   ```
   修正后重跑：npm run photos
       新建点位可用脚手架一次建好；不传 --cover 会列出该点位可选的文件名：
       npm run new-place -- "北京市-水南庄道口"
   ```

   `dirName` 在 `preflightDir` 作用域内，直接代入，用户照抄即可。

**为什么只改这一处 hint、不动另一处**：`description` 缺失的 hint（约 723–732 行）**不能**
建议 `new-place`——那种情况 `index.json` 是存在的，而 `new-place` 对已存在的 `index.json`
会硬拦拒绝执行。给出一个会撞墙的补救命令，比不给更糟。

**更新 `resolvePointDirs` 的函数头注释**（约 1000–1005 行）：把"在 data 侧自动建空目录（无害）"
改为"不做任何写入，照常进入文件夹级预检并被跳过"。

## 被否决的方案（P1：保留决策过程）

| 方案 | 做法 | 否决理由 |
|---|---|---|
| **现状（不改）** | 保留 mkdir + 提示 | 空目录无功能作用、git 不可见、且会演变成整轮硬失败（理由 ①─③） |
| **B 降级硬拦** | 保留 mkdir，同时把 `onlyInData` 的整轮 `throw` 降级为跳过 | 拿掉真正有价值的防护（防"搬家漏拷"）去迁就一个本就多余的写入，方向反了 |
| **A2 保留纯提示** | 删 mkdir，但保留 `resolvePointDirs` 里那行 `⚠️`（改为指向 `new-place`） | 该提示与文件夹级预检报告**报的是同一件事**，会同一轮出现两次；信号价值来自稀缺（emoji 契约），重复输出稀释它 |
| **剔除 origin-only** | 把 origin-only 点位从并集里去掉，从根上不进入预检 | 用户将失去"这个点位没配好"的失败记录；跳过语义从"文件夹级失败"退化为"静默不处理" |
| **新增清理命令** | 加 `npm run clean-empty` 删残留空目录 | 治标：不阻止新空目录产生；且引入第二套目录生命周期管理 |

## 出界清单（本计划明确不做）

- **不改** `onlyInData` 的整轮硬拦（那是防"搬家漏拷"的真防护）
- **不改** `preflightDir` 的任何判定判据（本次只动 hint 文案）
- **不新增**任何"清理空目录"命令，**不删除**任何既有目录（P2：破坏性操作需当次确认）
- **不动** `docs/plans/` 里的历史决策记录（P1：`2026-10-04-data-repo-longevity.md:490`
  与 `2026-10-05-new-place-scaffold.md` 中"自动创建空目录"的表述是当时的事实，保留原样）
- **不动** `AGENTS.md` 路由表（知识进既有域文件，按流程 #3）
- **不动** `new-place.js`：它的校验与写入行为本次无任何问题
- **不做**存量清理：实测 data 仓与原图仓**现存空目录数均为 0**（那个由本次触发的空目录已被
  后续 photos 填满），故无需迁移动作

## 验收标准

1. **零写入**：隔离副本里构造"只在原图仓存在"的点位 → 跑 `photos` → 跑前后对这 data 仓做
   目录快照（`find | sort | md5`）**完全一致**（`mkdir` 已消失的直接证据）
2. **失败仍被报出**：同一轮的输出含该点位的预检失败记录（`⏭️ N 个文件夹未通过预检`），
   退出码 `1`
3. **hint 可照做**：该 hint 含 `npm run new-place` **与**本点位名（不含占位符 `<点位>`）；
   把这条命令原样粘贴能真的把点位建好
4. **提示不重复**：同一轮输出里该点位**只出现一次**（文件夹级预检那条），不再有
   `resolvePointDirs` 的 `⚠️` 行
5. **回归 — 硬拦未动**：隔离副本里构造"只在 data 侧存在"的点位 → 仍**整轮报错退出**、
   文案与改动前一致
6. **正常路径无变化**：隔离副本里让既有合规点位正常产出，`output.json` 内容与改动前逐字节
   一致（用改动前的脚本副本跑一次做对照）
7. **修好即跑通**：给 origin-only 点位补上合规 `index.json` 后重跑 → 产出成功、退出码 `0`
8. **门禁**：eslint（`src` / `test` / `new-place.js`，`--max-warnings=0`）零 warning；
   `npm run test:cli` 全绿（**无新增用例**——`test/` 现无任何断言覆盖此行为，已 grep 确认
   `空目录` / `mkdir` / `onlyInOrigin` 零命中；`dataSet` 的删除也不会被契约测试感知）
9. **现网零影响**：真实 data 仓 14 个点位在真实原图仓下跑 `photos` 的**预检结果**与改动前
   一致；且真实两仓（`../data/photos`、`../photos-originals/photos`）**零改动**（快照证明）
10. **静态确认**：改动后 `fs.mkdir` 不再出现在 `resolvePointDirs` 内（源码级断言）

验收 1–7、9 按 S1 在 `/tmp` 隔离副本上跑（复制真实照片，不碰真实两仓）。

## 触及文件

| 文件 | 改动 |
|---|---|
| `process-photos.js` | `resolvePointDirs`：删 `onlyInOrigin` 整块（含 `mkdir` 与 `⚠️`）、删 `dataSet`、改函数头注释；`preflightDir`：缺 `index.json` 的 hint 补一行 |
| `docs/data-pipeline.md` | 第 30–31 行那句"只在原图仓有 → 在 `data` 侧自动建空目录"改为"本轮不做任何写入，该点位在文件夹级预检里因缺 `index.json` 被跳过" |
| `docs/photo-metadata.md` | （精度提升，1 句）"预检零写操作"可扩为"双根扫描与预检**全程**零写操作"——本次改动后该表述才无条件成立 |
| `test/` | **无改动** |
| `AGENTS.md` | **不动** |
| 本文件 | 新增 plan |

## 风险

- **唯一实质取舍**：用户失去一条"提前知道有个新点位没配好"的独立提示，改由文件夹级预检报告
  承载。若实际用起来觉得不够醒目，**回退路径是 A2**（保留一行纯提示，不写盘）——这是本计划
  唯一可逆的设计选择，其余都是单向收敛。
- 破坏性风险：**零**。本计划不删除任何文件或目录，唯一的行为变化是"少写一个空目录"。
