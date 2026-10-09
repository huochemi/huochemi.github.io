# data 仓历史重写：移除历史里的原片与废弃档位产物

状态：**已实现**（2026-10-06 10:05 推送完成并回归通过）——用户 2026-10-05 22:26 批准执行（P2 门①）
并拍板 `--prune-empty=auto`；23:32 起在**基线 `fcf5e35`** 上重做，**11 项验收全过**；2026-10-06
用户终端执行 `push --force`（`fcf5e35...75eeeb3`）+ 本地回收，站点回归通过。

⚠️ **残余风险已实测为「活的」**：旧提交与原片 blob 在 GitHub 触发 GC 之前**仍可按 SHA 取回**
（2026-10-06 10:0x 实测，见 §7.1）→ 若要求「保证不可访问」，需另行决定是否走 GitHub Support
或删同名仓重建。**本 plan 的执行部分已完结，但隐私目标尚未 100% 达成。**

上游：`docs/plans/2026-10-04-data-repo-longevity.md` 的**阶段 4**（该 plan 标「⏭️ 本期不做」）。
本 plan 把阶段 4 单独立项执行，判据与基数均来自 2026-10-05 22:20~23:35 的实测复核。

### 执行进展

**第一次执行（基线 `0299c1e`）→ 结果作废，未推送**

| 步骤 | 状态 | 说明 |
| --- | --- | --- |
| 前置门 | ⚠️ **无效通过** | 「12 分钟无新提交」不足以证明并行会话停手（见下「23:29 事件」） |
| 0 备份 | ✅ | `../.backups/data-pre-rewrite.git`（`--no-hardlinks` 独立复制） |
| 1 装工具 | ✅ | 用户终端 `brew install git-filter-repo`；**沙箱内须 `export PATH=/opt/homebrew/bin:$PATH`**（版本 `a40bce548d2c`） |
| 2 fresh clone | ✅ | `/tmp/data-rewrite`（`git clone --no-local`，因此免 `--force`），旧 tip `0299c1e` |
| 3 重写 | ✅ | filter-repo 87.7 s，21 提交全重写，新 tip `6fe4a71` |
| 4 验收 | ✅（1 项预测有误） | tip 树哈希 `14e5356…` **逐位相同**、原片 0、`_display.webp` 0、`.git` 660 M → 47 M；**提交 16 而非预测的 17** |
| 5 `push --force` | ⛔ exit 137 | SIGTERM（写 objects 8% 时被杀），**远端零改动**；随即发现远端已被推进 → 本结果作废 |

**第二次执行（基线 `fcf5e35`，当前有效）**

| 步骤 | 状态 | 说明 |
| --- | --- | --- |
| 0′ 刷新备份 | ✅ | mirror `fetch --prune` → 备份 = 22 提交 / 662 M / HEAD `fcf5e35` |
| 2′ fresh clone | ✅ | `/tmp/data-rewrite` 重建；旧 tip = **`fcf5e3530bfb03c8d9afefde4331508feba091c8`**；22 提交 / 445 文件 / 181 行原片 / 167 行 `_display.webp` |
| 3′ 重写 | ✅ | 同一条命令，12.8 s，22 提交全重写；**新 tip = `75eeeb3b28ae83d4c503c840dffdc57fd2513469`** |
| 4′ 验收 | ✅ **11 项全过** | 提交 **17**（= 22 − 5）；原片 **0**；`_display.webp` **0**；HEAD 文件 **445 = 445**；tip 树哈希 旧 `d39ea2f85cf2594f69847174f750d51ae29a8f70` **= 新**；文件清单 diff **0 行**；`fsck --full` 无 error；`.git` **673 M → 48 M**；tag 0；refs 仅 `main` |
| 5′ `push --force` | ✅ **2026-10-06 10:01 完成** | 用户终端执行；推前 `ls-remote` 复验 = `fcf5e35`（与基线一致）→ `+ fcf5e35...75eeeb3 main -> main (forced update)`，554 objects / 48.16 MiB / 103 KiB·s⁻¹ |
| 6′ 站点回归 | ✅ 通过 | 见下方「站点回归实测」 |
| 7′ 本地回收 | ✅ 完成 | `fetch + reset --hard` → HEAD `75eeeb3`；`reflog expire` + `gc --prune=now` → `.git` **673 M → 48 M**；工作区 0 变更 |
| 8 留痕 | ✅ 完成 | §8 映射表（22 行）已回填；longevity plan 已加状态注记；memory 已更新 |

**站点回归实测（2026-10-06 10:0x，推送后）**

| 检查 | 结果 |
| --- | --- |
| 远端 `main` | `75eeeb3b28ae83d4c503c840dffdc57fd2513469` ✅ |
| `https://huochemi.github.io/data/` | **200** |
| `output.json` 引用 ↔ data 仓 HEAD 树**全量比对** | 458 条引用 / 426 个去重路径 → **0 个缺失** |
| 线上抽样 43 个 URL（含全部 3 个视频、16 个地点的 `index.json`、24 个随机图） | **全部 200**，内容类型正确（`image/avif` / `image/webp` / `video/mp4`） |
| 最新地点「广州市-白云机场」逐个实测 | **200**（`image/avif` / `image/webp`，字节数正常） |
| data 仓 HEAD 里 `.JPG/.HEIC` | **0** |
| 本地回收后历史里原片 / `_display.webp` | **0 / 0** |

> ⚠️ GitHub API 报的 `size` **仍为 676494 KB（≈660 MB）**（`pushed_at` 已更新为本次推送时间）。
> **它不是"统计滞后、可忽略"这么简单**——该字段的口径是**全部对象（含历史）的打包后大小**
> （实测与「重写前 full clone 实拉 660.70 MiB」几乎逐位吻合，见 §9）。
>
> **关键因果（务必按此理解）**：GitHub 的 GC **只回收不可达对象**。那 612 MB 在重写前由旧提交
> 引用、是**可达**的 → 无论等多久**都不会**被回收。**本次重写正是把它变成不可达、从而"有资格
> 被回收"的前提**——不存在"不重写、等 GC 自己降下来"这条路。
>
> 体积核算的完整三层口径与余量见 **§9**。

**推送前基线冻结复核（2026-10-06 09:51）**：用户贴来 `git log` 顶部提交求证基线 → 实测
`git ls-remote git@github.com:huochemi/data.git main` = `fcf5e3530bfb03c8d9afefde4331508feba091c8`，
与用户所贴、与 `../.backups/data-pre-rewrite.git` 的 `refs/heads/main` **三者一致**。
距基线（2026-10-05 23:29）**已过 10.4 小时、远端零变动** → 并行会话确认停手，**冻结成立**。
同时复核 `/tmp/data-rewrite` 未被系统清理、成果完好，并重验决定性两项：
tip 树哈希 旧 = 新 = `d39ea2f85cf2594f69847174f750d51ae29a8f70`、HEAD 445 = 445、清单 diff 0 行、
新历史原片 0 / `_display.webp` 0。**结论：可推。**

> 顺带观察（非本 plan 范围）：站点仓 `HEAD 672c229` ahead 1、原图仓 `HEAD 44f24b9` ahead 2
> （均为白云机场的站点/原图对应提交，并行会话产物，尚未推）。与本次 force-push 无依赖：
> 前端只按 URL 取 data 仓 Pages 产物。


> ### 23:29 事件：远端被并行会话推进，本次重写作废（未推送、无任何损坏）
>
> 22:34 后执行 `git push --force origin main`（用户当次确认，授权"先试一次"）→ **exit 137 /
> SIGTERM**（写到 objects 8% 时被杀，即那条已知的间歇性失败，**未在远端落任何东西**）。
> 随后 `git ls-remote` 发现远端 `main` = **`fcf5e35`**，既不是旧 tip 也不是本次新 tip：
>
> - `fcf5e35` = "Add new photo and index file for 广州市-白云机场"，**是 `0299c1e` 的子提交**，
>   新增 `photos/广州市-白云机场/`（57 个文件，含 `index.json`）
> - 同刻旁证：站点仓有未推 `672c229 feat(cities): add Guangzhou city data…`、
>   原图仓 ahead 2（大兴机场 + 白云机场原片未推）、`date` 显示 **23:31**（提交记录 23:29）
> - ⇒ **另一路会话正在活跃地做「广州市-白云机场」导入**（本地 `../data` 工作区此刻干净，
>   HEAD 已到 `fcf5e35`）
>
> **结论**：本次重写基于 `0299c1e`，**不含 `fcf5e35`**；此刻若强推，会**删掉对方的白云机场提交**。
> 故立即停手。重写必须**在最新 tip 上重做**（成本约 3 分钟：刷新备份 → fresh clone → filter-repo
> 87 s → 验收），且**推送前一刻必须重新 `git ls-remote` 校验远端未再变动**。
>
> ⚠️ **方法论教训**：本次门槛检查（22:27「12 分钟无新提交」）不足以证明对方停手——**提交时间戳
> 不可信地出现了跳变**（提交记录 23:29 vs 当时会话时间 22:34，实为机器时钟跳变/会话时钟偏移）。
> 判据应改为**推送前即时 `ls-remote`**，而不是去推断"最近是否安静"。


> **预测修正（已反映到变空提交的判定规则）**：第一版预测「4 个只动过原片的提交」会变空，
> 实测是 **5 个**。多出的 `325bc50`（"Refactor code structure…"，57 个文件）**只动过原片 +
> `_display.webp`**，两条规则都命中，同样变空被剪。**变空预测必须同时套规则 A 与规则 B**——
> 第二次执行前我用修正后的规则重算，得出 5 个，与实测一致。
> 5 个被剪提交（`6cbb6bc` / `2702c1e` / `325bc50` / `4031f14` / `204c262`）无一含 `index.json`
> 或派生图的实质变更。

**演进完整性实测（第二次执行，旧备份 ↔ 新历史逐版本比对）**：

| 检查 | 结果 |
| --- | --- |
| 16 个 `index.json` 的版本 blob SHA 序列 | 旧 18 版 = 新 18 版，**逐位一致** |
| 213 个 `_thumb.webp` / 210 个 `_display.avif` | 版本序列**全部一致**（0 个不一致） |
| tip 树哈希 | 旧 `d39ea2f85cf2594f69847174f750d51ae29a8f70` = 新（逐位相同） |
| HEAD 文件清单 | 445 = 445，逐行 `diff` 空 |
| 重写确定性旁证 | 未改内容的提交两次重写得到**相同的新 SHA**（`9a7d1d0→e09bd73`、`dabcd99→7684a5c`、`0292afb→f78f9c9`、`0299c1e→6fe4a71`） |

### 交接（步骤 5′~7，已于 2026-10-06 10:01 由用户终端执行完毕）

重写成果在 `/tmp/data-rewrite`（新 tip `75eeeb3b28ae83d4c503c840dffdc57fd2513469`）。
**推送前一刻再查一次远端**（这一步不能省——第一次就是这么撞上的）：

```sh
cd /tmp/data-rewrite
git ls-remote origin main
# 必须仍是 fcf5e3530bfb03c8d9afefde4331508feba091c8；若已变动 → 停手，回本 plan 重做（约 3 分钟）
git push --force origin main
```

推送成功后（步骤 6 站点回归 + 步骤 7 本地回收 660 M，后者破坏性，P2 门②）：

```sh
curl -s -o /dev/null -w "%{http_code}\n" https://huochemi.github.io/data/
cd /Users/chenyang/source/huochemi/data
git fetch origin
git reset --hard origin/main          # 仅工作区为空时安全，执行前再确认一次
git reflog expire --expire=now --all
git gc --prune=now
du -sh .git                           # 期望 ~48 M
```

**实际执行记录（用户终端输出）**：推前 `ls-remote` = `fcf5e35`（与基线一致）→
`+ fcf5e35...75eeeb3 main -> main (forced update)`，554 objects / 48.16 MiB；
站点 `/data/` = **200**；`reset --hard` 后 HEAD = `75eeeb3`；`gc` 后 `.git` = **48 M**。




## 1. 为什么做

**主因是隐私，不是体积。** 实测（只读取证）：

| 项 | 值 | 取证方式 |
| --- | --- | --- |
| `huochemi/data` 可见性 | **public** + `has_pages: true` | `api.github.com/repos/huochemi/data` |
| GitHub 报体积 / 本地 `.git` | 657 MB / 660 MB | API `size` / `du -sh .git` |
| HEAD 内容 | 46.1 MB / 388 文件 | `git ls-tree -r HEAD` |
| 历史里**不在 HEAD** 的 blob | 370 行 / **684.3 MB** | `rev-list --objects --all` 减去 HEAD |
| 其中**原片** | **181 行 / 634.6 MB** | `*.JPG` 101 / `*.HEIC` 61 / `*.jpeg` 19 |
| 仓盘面 | forks 0 / stars 0 / PR 0 / tag 0 / 单分支 `main` | GitHub API + `git for-each-ref` |

阶段 3（`dabcd99`）只是 `git rm` 掉了原片——**`git rm` 不减历史**，blob 仍永久留在 pack 里，
且该提交已推送。结论：任何人 `git clone https://github.com/huochemi/data` 后 checkout 旧提交，
即可按原始分辨率导出全部原片 → **形态 B「原图私有」的目标在效果上未达成**。
（Pages 只发布分支 tip 的内容，站点本身不暴露原片；暴露面在 git 历史。）

> 原片本体安全：`../photos-originals` 本地 185 文件 / 772 MB，私有远端
> `origin/main = 9b11880` 已存在（未认证访问返 404 = 私有）。**本 plan 不会丢失任何原片。**

## 2. 决策：只摘两类文件（扩展名规则）

> ⚠️ **不能用「移除所有不在 HEAD 的 blob」当规则**——`index.json` 与 `_thumb.webp` 的
> 旧版本也不在 HEAD，而那正是「演进记录」本身；按那个规则删就退化成方案 C 了。

| 处置 | 规则 | 数量 / 体积 |
| --- | --- | --- |
| 🗑 移除 A | 路径匹配 `*.JPG` / `*.HEIC` / `*.jpeg` | 181 行 / 634.6 MB |
| 🗑 移除 B | 路径匹配 `*_display.webp`（HEAD 里已 0 个，属废弃档位产物） | 167 行 / 49.4 MB |
| ✅ 保留 | 其余全部（`_thumb.webp` 全版本、`index.json` 全版本、`_display.avif` 全版本、`.gitignore` 旧版本） | 22 行 / 0.3 MB |

判据完整性依据：历史中的原片**只**以这三个扩展名存在（无 `.png/.tif` 原片；视频原片
从未进过 data 仓，历史里 0 个非 `_web.mp4` 的视频）→ 扩展名即完整判据，无需枚举 181 个路径。

## 3. 目标 / 非目标

**目标**
1. 重写后 `git clone` 取不到任何原片
2. `.git` 从 660 MB 降到约 45~50 MB
3. 保留 17 个提交（见 §4 步骤 3 的 prune 说明），`index.json` 演进记录不丢

**非目标（出界清单）**
- ✗ 不改任何 CLI 代码、不改 `.gitignore`、不动站点仓、不动原图仓
- ✗ 不删 / 不改 `docs/plans/` 既有内容（P1）——只在 longevity plan 追加一句状态注记
- ✗ 不做 `data-2` 拆分（远期议题，见 `2026-10-04-data-repo-longevity.md`）
- ✗ 不处理 GitHub 侧不可达对象（见 §7 残余风险 1）
- ✗ 不用 `--force` 绕过 fresh-clone 检查（用 fresh clone 替代）

## 4. 执行步骤（全部在**用户终端**执行）

**前置门**（任一不满足即停，不要"试着跑一下"）：
- data / 站点 / 原图三仓 `git status --porcelain` 均为空
- **确认并行的另一个 agent 会话已停手**——2026-10-05 22:14 实测有第二路会话在写 data 仓
- `git ls-remote origin main` 与本地 `HEAD` 一致

**步骤 0 · 备份（本地、私有、永不推送）**

```sh
cd /Users/chenyang/source/huochemi
mkdir -p .backups
git clone --mirror --no-hardlinks data .backups/data-pre-rewrite.git
```

`.backups/` 不在任何仓内，且含原片历史 → **任何情况下不得推送**。
⚠️ **`--no-hardlinks` 不能省**：本地克隆默认对 pack 做硬链接，备份会与原仓共享 inode，
那样就不是独立备份了。（远端前进后刷新备份：`git -C .backups/data-pre-rewrite.git fetch --prune origin`）

**步骤 1 · 装工具**

```sh
brew install git-filter-repo
git filter-repo --version
```

**步骤 2 · 建 fresh clone（这样就不必用 `--force`）**

```sh
git clone --no-local /Users/chenyang/source/huochemi/data /tmp/data-rewrite
cd /tmp/data-rewrite
git remote set-url origin git@github.com:huochemi/data.git
git rev-parse HEAD    # ← 记下这个值，下面记作 <旧 tip>，步骤 4 要用
```

**步骤 3 · 重写**

```sh
git filter-repo --sensitive-data-removal \
  --invert-paths \
  --path-glob '*.JPG' --path-glob '*.HEIC' --path-glob '*.jpeg' --path-glob '*_display.webp' \
  --prune-empty=auto
```

- `*` 在 `--path-glob` 中**跨 `/`**（filter-repo 官方文档明确），故四个 glob 已覆盖
  `photos/<地点>/<文件名>`；引号必须保留，否则 shell 会自行展开
- `--prune-empty=auto`：只剪掉**因本次过滤而变空**的提交。判定变空必须**同时套规则 A 与
  规则 B**（第一版只套 A，把结果算成 4 个，实测是 5 个）。实测 5 个提交的全部变更文件都命中
  A 或 B → `6cbb6bc` / `2702c1e` / `325bc50` / `4031f14` / `204c262`，**22 → 17**。
  这 5 个不含任何 `index.json` 变更 → 演进记录 100% 保留。
  **二选一，不自动降级**：若要保留这 5 个提交，改 `--prune-empty=never`（22 个全留，
  其中 5 个 diff 为空，仅观感差异）
- `--sensitive-data-removal` 会额外 fetch 全部 refs，并在结束时打印「清理其他副本」的指引；
  它警告会丢弃 local-only 改动 → 步骤 2 的 fresh clone 已规避
- filter-repo 默认会在收尾时自行执行 `git reflog expire --expire=now --all` + `git gc --prune=now`

**步骤 4 · 验收（逐条对期望值，全部必须满足）**

```sh
git rev-list --count HEAD                                      # 期望 17（用 never 则 22）
git rev-list --objects --all | grep -cE '\.(JPG|HEIC|jpeg)$'   # 期望 0
git rev-list --objects --all | grep -c '_display\.webp$'       # 期望 0
git ls-tree -r HEAD | wc -l                                    # 期望 445（tip 未变）
git fsck --full                                                # 期望无 error
du -sh .git                                                    # 期望 ~45~50 MB（重写前 673 MB）
git tag -l | wc -l                                             # 期望 0
```

⚠️ **tip 不变性不能再用 `git diff --stat <旧 SHA> HEAD`**——filter-repo 收尾会 prune 掉旧对象，
旧 tip 的 SHA 在此 clone 里**已不存在**。改用与备份比对**树哈希**（更硬，且不依赖旧对象）：

```sh
OLD=/Users/chenyang/source/huochemi/.backups/data-pre-rewrite.git
git -C $OLD rev-parse 'refs/heads/main^{tree}'   # 旧 d39ea2f85cf2594f69847174f750d51ae29a8f70
git rev-parse 'HEAD^{tree}'                      # 新 必须完全相同
diff <(git -C $OLD ls-tree -r --name-only refs/heads/main | LC_ALL=C sort) \
     <(git ls-tree -r --name-only HEAD | LC_ALL=C sort)   # 必须空
```


**树哈希相等是本次最关键的验收项**：原片与 `_display.webp` 在 HEAD 里本来就是 0 个，
故重写后 tip 树必须与重写前**完全一致** → 站点产物零变化。

**步骤 5 · force-push（P2 门②：需当次确认）**

```sh
git ls-remote origin main     # ⚠️ 必须先查：必须仍是 fcf5e3530bfb03c8d9afefde4331508feba091c8
git push --force origin main
```

⚠️ **推送前一刻的 `ls-remote` 不可省**：第一次执行就是在这里撞上「远端已被另一路会话推进」，
若当时推送成功，会直接删掉对方的白云机场提交。

实测无 tag 需推送；若远端开了分支保护（本次未查证），按 GitHub 提示临时解除。

**步骤 6 · 站点侧回归**

```sh
curl -s -o /dev/null -w "%{http_code}\n" https://huochemi.github.io/data/
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" \
  'https://huochemi.github.io/data/photos/北京市-大兴机场/DSC03722_display.avif'
```

**站点仓不动**：前端只按 URL `/data/photos/…` 取 Pages 产物，与 data 仓历史无关；
Pages 部署源仍是 `main` 分支，tip 树未变 → 无内容风险。

**步骤 7 · 回收本地 660 MB（P2 门②：需当次确认）**

```sh
cd /Users/chenyang/source/huochemi/data
git fetch origin
git reset --hard origin/main      # 仅在工作区为空时安全，执行前再确认一次
git reflog expire --expire=now --all
git gc --prune=now
du -sh .git                       # 期望 ~48 MB
```

**步骤 8 · 留痕（P1）**
1. 把 `/tmp/data-rewrite/.git/filter-repo/commit-map` 的「旧 SHA → 新 SHA」映射表贴进本 plan §8
2. 在 `docs/plans/2026-10-04-data-repo-longevity.md` 状态行**追加**一句：
   「阶段 4 已于 2026-10-05 由 `2026-10-05-data-repo-history-rewrite.md` 执行；本文引用的
   `9a7d1d0` / `dabcd99` / `fe144ad` 等 SHA 已随重写失效，映射见该 plan」——**不改原内容**（P1）
3. 更新 `.workbuddy/memory/` 的当前状态（`.workbuddy/` 已 gitignore，勿提交）

## 5. 回滚

备份在 `../.backups/data-pre-rewrite.git`（**已刷新到 `fcf5e35` 基线**），回滚方式为
`git push --force` 推回。**但回滚会把原片重新推上公开 GitHub**，故只在「派生图 / `index.json`
内容被误删」时使用；本次规则不触碰任何 HEAD 文件（步骤 4 的**树哈希相等**即证明），
该场景预期不会发生。另：`/tmp/data-rewrite` 若被清掉不必抢救——重做只需约 3 分钟。

## 6. 实测基数

分组口径：`git rev-list --objects --all` 取全部可达对象 → `git cat-file --batch-check` 取
原始字节数 → 减去 HEAD 的 blob → 按 §2 规则分组。

| 基线 | 提交数 | HEAD 文件 | 不在 HEAD 的 blob | tip 树哈希 |
| --- | --- | --- | --- | --- |
| `0299c1e`（第一次执行，已作废） | 21 | 388 | 370 行 / 684.3 MB | `14e5356106c61bcff6dd6912aa8da13ff1e22721` |
| **`fcf5e35`（当前有效）** | **22** | **445** | **370 行 / 684.3 MB** | `d39ea2f85cf2594f69847174f750d51ae29a8f70` |

不在 HEAD 的构成两次**完全相同**：移除 A 原片 181 行 / 634.6 MB + 移除 B `_display.webp`
167 行 / 49.4 MB + 保留 22 行 / 0.3 MB（15 个 `_thumb.webp` 旧版本 0.26 MB + 4 个 `index.json`
旧版本 + 3 个 `.gitignore` 旧版本）——因为白云机场那 57 个文件全在 HEAD 里，不进移除集合。

> 注：移除 B 的 167 行 > 阶段 2.5 那次删除的 152 个——差额 15 个是更早提交中被替换掉的
> `_display.webp`，仍可达于历史。

## 7. 风险与残余风险（如实列，不粉饰）

1. **GitHub 侧旧对象 —— ⚠️ 已实测为「活的」，不是理论风险**（2026-10-06 10:0x，推送后实测）：
   在干净临时仓里 `git fetch --depth=1 origin <完整 SHA>`：
   - 对照组：新历史里的非 tip 提交 `a46ac73…`（root）→ **可取回** ⇒ 该远端**支持按完整 SHA
     取未被引用的对象**，本测试方法有效（排除了"方法本身不成立"的假阴性）
   - 旧 tip `fcf5e3530bfb03c8d9afefde4331508feba091c8` → **仍可取回**（`-> FETCH_HEAD`）
   - 原片 blob 直取：`GET https://api.github.com/repos/huochemi/data/git/blobs/2707600a…`
     （= `photos/石景山南站/IMG_5036.jpeg`，3.1 MB）→ **HTTP 200，下载 4 484 880 B（base64）**
   ⇒ **任何人只要知道旧 SHA，现在仍能从公开仓拿到原始分辨率照片。**

   **② 复查（2026-10-09 20:2x，定时任务，只读）—— 结论不变：GitHub 仍未 GC，旧对象仍可取回。**
   判定规则：对照成功 + 目标成功 → 仍未 GC。全部为实测值：

   | 检查 | 实测结果 |
   | --- | --- |
   | 对照 `git fetch --depth=1 origin a46ac7373d2dceadd95dbdb8a9d6ae8f1d073333`（新历史 root） | **成功**（→ `FETCH_HEAD`，`cat-file -t` = commit） |
   | 目标旧 tip `git fetch --depth=1 origin fcf5e3530bfb03c8d9afefde4331508feba091c8` | **成功**（→ `FETCH_HEAD`；信息 "Add new photo and index file for 广州市-白云机场"，树 445 文件 / 原片 0） |
   | 旧原片 blob `GET …/git/blobs/2707600a8c208520b7fae4dd6dc8e287574159e5` | **HTTP 200，4 484 880 B**（与 2026-10-06 逐字节相同） |
   | 负对照① `git fetch … 0000000000000000000000000000000000000001` | **失败** `upload-pack: not our ref`（exit 128） |
   | 负对照② `git fetch … deadbeef…` | **失败** `upload-pack: not our ref`（exit 128） |
   | 负对照③ `GET …/git/blobs/0000…0001` | **HTTP 404** |
   | 仓字段（仅参考，不可据此判断成败） | `size` = **52816**（≈51.6 MB）、`pushed_at` = `2026-10-07T15:40:35Z`、`has_pages` = true |

   三条负对照均正确失败 ⇒ 测试方法成立，目标的"成功"非假阳性。
   ⇒ **状态维持「已实现」，§7.1 残余风险不改为「已闭合」（GC 未发生）。**
   注：`size` 已从 660 MB 降至 ≈51.6 MB，但该字段按既定口径仅作参考；本次结论完全由
   fetch / blob 实测支撑，与 `size` 变化方向无关（如实记录）。
   （2026-10-09 起本 plan 的 §7.1 由一次性定时复查任务继续跟踪，逐次追加。）

   本仓 PR = 0（无 `refs/pull/*`）、forks = 0，故 GitHub GC 覆盖后即不可达；**但 GC 无 SLA、
   不保证何时发生**。要「保证不可访问」有两条路：
   - **Support 工单**：附 `First Changed Commit = 29292e0f0434c9b96027b17cdd00236d5da065d0`，
     请 GitHub 执行 *Fully removing the data*（不改仓、免费，处理需数日）
   - **删同名仓重建**：删 `huochemi/data` 后以**同名**重建并推入现有 17 提交（48 MB）。
     **仓库名不变 ⇒ `huochemi.github.io/data/` URL 不变**，前端零改动；对象库全新 ⇒ 旧对象
     立即消失。代价：需重新开 Pages（源设 `main`）。（先前把此路称作"方案 D / 要改 URL 前缀"
     只适用于**换仓名**的情形，同名重建不改 URL。）

   ⚠️ 旧 SHA 目前被站点仓 docs 明文记录（§4 步骤 8 第 2 条、§8 映射表）→ 这使「按 SHA 取回」
   具备现实可行性。P1 要求决策记录不删，故此处**如实并列**：若用户把该风险判为不可接受，
   需在 P1 与隐私之间另行拍板（例如由映射表改为"变更说明"而隐去具体 SHA）。
2. **已存在的他人克隆**：API 实测 forks = 0、stars = 0、watchers = 0 → 现实暴露面≈0，
   但无法证明历史前无人 clone 过
3. **docs 里旧 SHA 悬空**：属 P1 允许的历史记录，用映射表补注，不删除
4. **并行会话撞车（已实际发生一次）**：force-push 期间另一会话若也在推 data 仓会互相覆盖 →
   2026-10-05 23:29 就是这样撞上的（详见「23:29 事件」）。**推送前即时 `ls-remote`** 是唯一
   可靠门槛；「最近 N 分钟没新提交」不可用作判据（提交时间戳会跳变）
5. 原图仓本地 ahead 2（大兴机场 + 白云机场原片未推）与本次无关，不在本 plan 范围

## 8. 旧 SHA → 新 SHA 映射

来源：`/tmp/data-rewrite/.git/filter-repo/commit-map`（**22 行**，含未变化者）。**全零 = 该提交被剪除。**

- `First Changed Commit = 29292e0f0434c9b96027b17cdd00236d5da065d0`（= 最初被改写的提交，
  filter-repo 建议在向 GitHub 提工单时附上这个）
- 下表为**第二次执行（基线 `fcf5e35`）**的有效映射。第一次执行（基线 `0299c1e`）的映射表
  内容与之**逐行相同**（未改内容的提交重写后 SHA 必然相同，这是重写确定性的旁证），
  仅缺 `fcf5e35` 一行——第一版已作废，不另存


| 旧 SHA | 新 SHA | 提交信息 |
| --- | --- | --- |
| `0149099` | `5d00276` | Add index.json for 乌兰察布（集宁）-通州街跨京包线公路桥 with initial photo and description |
| `0292afb` | `f78f9c9` | Add new photo and index file for Beijing Daxing International Airport |
| `0299c1e` | `6fe4a71` | Add references to 北京市-大兴机场 index.json |
| `0ebc52c` | `8204166` | Add 北京市-水南庄道口（6 图 + 2 视频的派生图与 index.json） |
| `204c262` | **（已剪除）** | Update photos in 郑州 directory with new images |
| `2702c1e` | **（已剪除）** | Remove old photos and add new images from 石景山南站 and 房山长阳-碧桂园温泉小区C区 |
| `29292e0` | `a46ac73` | Initial commit |
| `2d6c661` | `ecc0b57` | add geo tags |
| `325bc50` | **（已剪除）** | Refactor code structure for improved readability and maintainability |
| `4031f14` | **（已剪除）** | new photos |
| `5350585` | `e6339e4` | Add index.json for 郑州市-铁道丽景苑 with photo and description |
| `6c49ba2` | `f997de1` | Add index.json for 郑州 with main photo and description |
| `6cbb6bc` | **（已剪除）** | test photos |
| `796aed5` | `cb9d6bc` | Refactor code structure and remove redundant sections for improved readability and maintainability |
| `8276aee` | `992e5a2` | Add index files for new photo locations: 房山长阳-碧桂园温泉小区C区, 石景山南站, and 石景山南站附近1 |
| `8f7e628` | `1edcaf6` | Add index.json for 北京-狼垡公园北京动车段 with photo reference and description |
| `9a7d1d0` | `e09bd73` | chore: 展示图换 AVIF，移除 152 个旧 _display.webp |
| `dabcd99` | `7684a5c` | chore: 原图迁出本仓（形态 B 阶段 3）——data 仓只留派生图 |
| `fb1e4be` | `86d03a1` | Add index.json for 乌兰察布（集宁） with initial photo and description |
| `fcf5e35` | `75eeeb3` | Add new photo and index file for 广州市-白云机场（**新 tip**） |
| `fe022ab` | `4b60052` | Add index.json for 乌兰察布市集宁区-集宁车辆段 with photo and description |
| `fe144ad` | `ff0d8de` | Add photos for 南京中和桥道口（含首个视频 IMG_5810）与 南京南站东南角 |

⚠️ `2026-10-04-data-repo-longevity.md` 正文引用的 `9a7d1d0` / `dabcd99` / `fe144ad` 按上表已失效，
按 §4 步骤 8 追加状态注记（**不改原内容**，P1）。

## 9. 体积核算（2026-10-06 10:52 实测）——「做了这么多，到底有没有省空间」

用户 2026-10-06 明确：**目标不是隐私，是体积**（"删掉没用的文件、保证 repo 体积不超 GitHub 限制"）。
故单列此节，把体积的三层口径与余量实测清楚。**本节全部为实测值，非推算。**

### 9.1 三层口径（同一件事，三个答案）

| 口径 | 重写前 | 重写后 | 变化 |
| --- | --- | --- | --- |
| GitHub 报的仓大小（API `size`） | 660.6 MB | **660.6 MB（未变）** | **0** |
| **clone 要拉的数据**（全部可达对象） | **660.70 MiB** | **47.91 MiB** | **−613 MB / −92.7%** ✅ |
| 已发布 Pages 站点（= HEAD 内容） | 47.9 MB | 47.9 MB | 0（**本就无关**） |

测法与证据：

| 对象 | 命令 | 实测结果 |
| --- | --- | --- |
| 重写前完整历史 | `git clone --no-local ../.backups/data-pre-rewrite.git` | **672 MB**，`size-pack 660.70 MiB` |
| 重写后远端 | `git clone --depth=1 --no-tags https://github.com/huochemi/data.git` | **48 MB**，`size-pack 47.91 MiB`，`HEAD 75eeeb3` ✓ |
| 重写后本地 | 已 `gc --prune=now` 的 `../data` | **48 MB**，`in-pack 554`，`48.18 MiB` |
| GitHub 侧 | `GET /repos/huochemi/data` | `size: 676494` KB = **660.6 MB** |

**机制印证（一个巧合）**：API `size` 660.6 MB 与「重写前 full clone 实拉 660.70 MiB」几乎逐位吻合
→ 该字段的口径 = **全部对象（含历史）打包后大小**，不是"可达对象大小"。

### 9.2 ⚠️ 因果修正：不存在「不重写、等 GC 自己降下来」这条路

**GitHub 的 GC 只回收不可达对象。** 那 612 MB 在重写前由旧提交引用、属**可达**对象 →
无论等多久**都不会**被回收。**本次重写正是把它变成不可达、使其"有资格被回收"的前提。**

（先前本 plan 与 memory 中"等 GitHub GC"的表述容易被读成替代方案，此处更正。）

### 9.3 各步贡献：让仓库变小的主要是**阶段 3**，不是本次重写

| 时间 | 动作 | HEAD 树 | clone 要拉 |
| --- | --- | --- | --- |
| 峰值 `fe144ad` | — | **589.4 MB** | ~660 MB |
| 2026-10-05 阶段 3 `dabcd99` | 原片迁出本仓 | **38.0 MB**（−551 MB） | ~660 MB |
| 2026-10-06 本次 | 重写历史 | 47.9 MB | **47.9 MB** |

- **阶段 3 才是让 Pages 达标的那一步**：HEAD 589.4 → 38.0 MB（**−93.6%**）
- **本次重写对 Pages 零影响**（HEAD 树逐位不变），只让 clone 从 660 → 48 MB
- 对照：`9a7d1d0`（换 AVIF 档位）只让 HEAD 从 589.4 → 571.4 MB（−18 MB）

### 9.4 GitHub 限制的官方口径（2026-10-06 查证 docs.github.com）

| 项 | 限制 |
| --- | --- |
| 单文件 | >50 MiB → git 警告（**仍可推**）；>100 MiB → **GitHub 拒收** |
| 仓库大小 | 建议 <1 GB；强烈建议 <5 GB |
| **Pages 源仓库** | 推荐 ≤1 GB |
| **已发布 Pages 站点** | ≤1 GB |
| Pages 部署 | 超时 10 分钟 |
| Pages 带宽 | 软限 100 GB/月 |

### 9.5 当前余量

- 已发布 Pages 站点 **47.9 MB = 1 GB 的 4.7%**（极安全）
- 按 API `size` 660.6 MB 计 = **64.5%**（GitHub GC 后应降至 4.7%）
- 最大单文件 **8.64 MB**，离 100 MiB 硬拦有 11 倍余量
- 增长：**16 个地点 / 47.9 MB ≈ 3.0 MB/地点**
  （构成：avif 210 个 30.26 MB + mp4 3 个 14.52 MB + webp 213 个 3.15 MB）
  → 撞 Pages 1 GB 需约 **340 个地点**（现 16 个）
- **Pages 站点体积与 git 历史无关** → 站点侧限制主要取决于**地点数**，不取决于本次重写

### 9.6 结论

1. 「省空间」**确实省了，但省在 clone 口径**：别人 / CI / 你本地拉取 660 → 48 MB（−92.7%）
2. **GitHub 服务器上那 660 MB 要等 GC**（无 SLA；2026-10-09 已挂一次性复查任务自动验证）
3. **要立即让 GitHub 侧数字降下来**：删同名仓重建（URL 不变、前端零改动）——待用户决定
4. **Pages 的 1 GB 限制早已达标**（阶段 3 就达标），本次重写对它无贡献

日期：2026-10-05 起草并首次执行（基线 `0299c1e` 作废）→ 2026-10-05 23:32 在基线 `fcf5e35`
重做 → **2026-10-06 10:01 用户终端推送完成 + 站点回归通过 → 状态「已实现」** →
**2026-10-06 10:52 追加 §9 体积核算（三层口径实测）**。
遗留：§7.1 的 GitHub 侧旧对象（已实测可继续按 SHA 取回），需用户决定是否走 Support 工单或
删同名仓重建。

