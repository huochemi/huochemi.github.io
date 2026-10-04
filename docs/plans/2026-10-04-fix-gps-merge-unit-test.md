# fix-gps 合并逻辑纯函数单测（5 m 边界下沉）

状态：已实现（2026-10-04）
实现说明：改动 4 处——`fix-gps.js` 加 `require.main` 守卫 + 导出、新增
`test/fix-gps.merge.test.js`（10 条用例）、`package.json` 加 `test:cli`、
AGENTS.md 流程 #1 的 lint 命令扩到 `test/`。验证全部通过，详见文末「实现后修订」。
日期：2026-10-04
来源会话：用户问"从工程上我需不需要加照片给你做 E2E？这样做是否符合最佳实践？"——
结论：**不加照片**。5 m 阈值是纯函数断言，应下沉到单元层；把一次性的人工核对
固化为可复跑的自动断言。用户回复"要"（批准本 plan 起草；实现待"开始"）。
前置：`docs/plans/2026-10-04-fix-gps-cleanup-and-anchor-merge.md`（5 m 判据 + 并查集
聚类的落地，含四张合成锚点的实测记录）

## 背景与动机

三个事实（均有代码位置为证）决定了本 plan 的形态：

1. **判据逻辑已经就绪且是纯函数**：`mergeAnchors(anchors)`（`fix-gps.js:443`）只读
   `.lat` / `.lng` / `.ts` / `.file`；配套 `haversineMeters()`（`fix-gps.js:425`）纯数学。
   无 fs、无 EXIF、无 DOM。
2. **边界当前只由人工核对确认**：4 m 合并、6 m 不合并、链式连锁、恰好 5.00 m 不合并
   （`<` 语义）这四条，证据是前置 plan"实现后修订"第 1、2 条在 `/tmp/hcm-verify`
   副本上的一次性肉眼核对。断言是肉眼、数据是临时的、不进任何门禁——下次改
   `mergeAnchors` 或改阈值时，没有任何东西会拦住回归。
3. **结构性障碍让"想测却测不了"**：`fix-gps.js` 顶层无条件执行 `main().catch(…)`
   （文件末尾），且无 `module.exports`。任何 `require('./fix-gps')` 都会把整个 CLI
   跑起来。这是"该不该加照片"这个问题的真实成因——不是缺夹具，是缺可导入的出口。

另有一条已存在的硬契约需要机制保障：`ANCHOR_MERGE_METERS = 5` 在
`fix-gps.js:59` 与 `process-photos.js:337` **各存一份**，且并查集聚类算法也是各一份
（`fix-gps.js:446-452` 与 `process-photos.js:405-414`）。两处注释都写着"必须保持一致"，
但没有任何代码机制强制——口径一旦不一致，`npm run photos` 的预检提示与审阅页的分组
会互相矛盾（P3）。

## 设计

### 1. 让纯函数可导入（本 plan 唯一的生产代码改动）

`fix-gps.js` 末尾：

```js
if (require.main === module) {
  main().catch((err) => {
    console.error(color.red(`\n⛔ ${err.message}`));
    process.exit(1);
  });
}
module.exports = { mergeAnchors, haversineMeters, ANCHOR_MERGE_METERS };
```

- 已核实：`fix-gps.js` 除末尾 `main()` 调用外**没有任何其他顶层副作用**（对顶层函数
  调用模式做了全文件检索，零命中），因此加守卫后 require 是安全且静默的。
- 不导出其他任何符号，保持最小公共面。
- 副作用面：`node fix-gps.js`（= `npm run fix-gps`）走 `require.main === module` 为真
  的分支，行为与改动前完全一致；CRA 只打包 `src/`，不涉及本文件。

### 2. 测试选址与运行方式

| 决策 | 选择 | 理由 |
|---|---|---|
| 文件位置 | 新建 `test/fix-gps.merge.test.js` | 给后续 CLI 测试留位置；与前端应用分层 |
| runner | Node 22 内置 `node --test`，零新依赖 | 环境已确认 v22.22.2；CLI 是纯 CommonJS，无需转译 |
| npm script | `"test:cli": "node --test test/"` | 与 `npm test`（CRA jest）并列，语义自解释 |
| 不选 CRA jest | `react-scripts test` 的 `roots` 固定为 `<rootDir>/src`，且 jest 环境下 `node:test` 语义不适用 | 强行混装会让 CLI 测试依赖 CRA 测试链 |

lint 覆盖：AGENTS.md 流程 #1 的 lint 命令目前只扫 `src`，新文件会落在 lint 之外。
本 plan 把该命令扩为 `eslint src test --ext .js,.jsx,.ts,.tsx --max-warnings=0`
（属 E1 修订，随本 plan 一并请批）。若 CRA 的 `react-app` eslint 配置在 `node:test`
文件上产生误报，则改用 `test/` 目录级的最小 eslint 配置——**以实测为准，不预设**。

### 3. 用例设计（合成锚点 = 内存对象，全程不使用任何照片）

距离用纬度偏移构造（1° 纬 ≈ 111320 m），保证与真实 haversine 走同一条代码路径。

| # | 用例 | 期望 |
|---|---|---|
| 1 | 单锚点 | 1 组，members 长度 1 |
| 2 | 相距 4 m 的两锚点 | 1 组，members 长度 2 |
| 3 | 相距 6 m 的两锚点 | 2 组 |
| 4 | 边界：4.9 m 合并 / 5.1 m 不合并 | 钉住 `<` 语义的上界（刻意避开恰好 5.00 m 的浮点取巧；恰好 5.00 m 的严格小于语义已由前置 plan 实测记录） |
| 5 | 链式：A-B 4 m、B-C 4 m（A-C 8 m） | 1 组，members 长度 3（并查集连锁） |
| 6 | 代表选取 | 代表 = 组内 `ts` 最早者；返回对象的 `lat`/`lng` **等于该代表自身的值**（断言不等于平均值，钉住"不引入新坐标"这条设计决定） |
| 7 | 空数组 | 返回 `[]`（防御性；`scanDirForReview` 理论上不会传空） |
| 8 | `haversineMeters` 直测 | 同点 = 0；真实锚点对（相距 114 m 的那两张）误差 ±1 m 内 |

### 4. 跨文件契约守卫（可选加固，建议做）

一条断言：读取 `process-photos.js` 源码文本，正则取出 `ANCHOR_MERGE_METERS = (\d+)`，
断言其值等于 `fix-gps.js` 导出的 `ANCHOR_MERGE_METERS`。

- 理由：该常量被注释声明为"必须一致"，但无任何机制强制；前置 plan 记录的口径不一致
  风险正是根因。约 5 行代码换一条可执行的硬契约。
- **明确不做**：不把两处算法重构为共享模块（前置 plan 已决定不引入，为 1 个常量做
  架构改动不划算）。守卫只锁常量值。

### 5. 知识回写

- `docs/toolchain.md` 加一小节：CLI 单测的运行方式（`npm run test:cli`，node 内置
  runner，与 CRA jest 分离）＋ `fix-gps.js` 因 `require.main` 守卫而可被 require。
- AGENTS.md 流程 #1：lint 命令扩展到 `test/`（E1 修订）。
- 本 plan 完成后状态行改"已实现"，保留不删（P1）。

## 验收标准

1. `npm run test:cli` 全绿；用例 4 / 5 / 6 各自的断言可独立致红（逐条把 `mergeAnchors`
   的比较符、排序比较符、`haversineMeters` 的常数临时改坏验证后还原）。
2. `npm run fix-gps` 在隔离副本上的行为与改动前一致（`--review` 分组数、plan 输出不变），
   确认 `require.main` 守卫未改变 CLI 行为。
3. `require('./fix-gps')` 静默：不打印任何 stdout、不触碰 `../data/photos`、不进入交互，
   进程即时退出（`node -e` 断言）。
4. eslint `src test` 全过、`--max-warnings=0`；`CI=true react-scripts build` 不受影响
   （`build/` 已存在时按流程交用户在终端执行）。
5. `react-scripts test` 仍只跑 `src` 下既有两个测试，不被 `test/` 干扰。
6. 跨文件守卫能真正失败：临时把 `process-photos.js` 的常量改成 6 跑测试 → 红 → 还原。
7. 不新增任何照片或二进制进 repo；`test/` 只含 1 个 `.js` 文件。

## 出界清单（本计划明确不做）

- **不加照片、不做浏览器 E2E**（本次提问的直接结论：5 m 阈值属纯计算，照片夹具留给
  真正读 EXIF 的路径，那条路径已有正确的隔离副本做法）。
- 不引入 Playwright / puppeteer 等真浏览器测试框架。
- 不为 CLI 引入 jest（不与 CRA 测试链混装）。
- 不重构为共享模块、不动 5 m 阈值本身、不做可调阈值 UI。
- 不给 `process-photos.js` 的 `describeAnchorSpread` 写完整单测（本轮只守常量一致性；
  其余文案逻辑若要覆盖另开 plan）。
- 不测审阅页 HTML 的交互（既有 jsdom 冒烟已覆盖，超出本 plan 范围）。

## 实现后修订（2026-10-04）

### 1. 偏离：`node --test test/` 不可用，必须给 glob

计划里写的 npm script 是 `node --test test/`，实测**失败**：Node 22 把位置参数当
**glob** 而不是目录，`test/` 匹配到目录本身后按模块加载 → `MODULE_NOT_FOUND`。
已改为 `node --test "test/**/*.test.js"`（加引号交给 Node 展开，不依赖 shell glob；
无匹配时 zsh 的 `nomatch` 会直接报错，所以不用裸 glob）。已写入 `docs/toolchain.md`。

### 2. 偏离：haversine 基准改用"1° 纬度"而非真实锚点对

计划里写"用真实锚点对（相距 114 m）误差 ±1 m 内"。实现时改为**同样合成**的
`1° 纬度 ≈ 111194.93 m`（球面上 R·π/180 的独立基准）。理由：真实锚点对必须从
`src/Application/output.json` 取坐标，而该文件由 `npm run photos` 生成、会被重新
生成，把单测耦合到生成物上不划算；而"1° 纬度"是与构造方式无关的独立球面事实，
同样能戳破 R 用错、公式写错。**变实测过**：把 haversine 的 R 从 6371000 改成
637100，该用例立刻变红。

### 3. 新增用例：缺失拍摄时间（`ts = "9999"`）不抢代表位

计划外的第 10 条。理由：`scanDirForReview` 对缺时间的照片写 `ts: time || '9999'`
哨兵值，哨兵与"代表取组内最早"交互时不该让无时间者夺位——这是真实代码路径，
值得钉住。变异实测（把排序反转成"最晚优先"）该用例会红。

### 4. 已知盲区（实测确认，有意保留）

**恰好 5.000 m 的 `<` vs `<=` 没有自动断言。** 构造该距离要经 `sin → asin` 往返，
结果在 5.000000… 上带浮点噪声，钉不死。用变异测试实测确认：把 `mergeAnchors` 的
`<` 改成 `<=`，10 条用例**全绿**（未抓到）。判断为可接受——真实 GPS 漂移下不会
恰好落在 5.000000 m，为此扭曲构造不值。恰好 5.00 m 不合并的语义仍由
`2026-10-04-fix-gps-cleanup-and-anchor-merge.md`「实现后修订」第 1 条的人工实测记录
承担。该盲区已同时写入测试文件注释与 `docs/toolchain.md`。

### 5. 验证证据（全部实测）

- **用例**：`npm run test:cli` → 10 条全绿、`# fail 0`、~50 ms
- **变异测试**（在 `/tmp/hcm-mut` 副本上做，repo 原件 shasum 复核未变）：
  | 变异 | 结果 |
  |---|---|
  | M1 阈值 5 → 6 | 抓住 ✓（3 条红，含跨文件守卫） |
  | M2 haversine R 6371000 → 637100 | 抓住 ✓（3 条红） |
  | M3 代表选取反转（最早 → 最晚） | 抓住 ✓（4 条红） |
  | M4 合并判据 `<` → `<=` | **未抓到**（见上，已知盲区） |
- **`require` 静默性**：`node -e "require('./fix-gps')"` 零 stdout、正常退出，
  导出恰为 `mergeAnchors, haversineMeters, ANCHOR_MERGE_METERS`；已确认 `fix-gps.js`
  除末尾 `main()` 外无其他顶层副作用（全文件检索零命中）
- **CLI 行为不变**：`node fix-gps.js --plan /tmp/x.json` 仍走 parseArgs 报错路径
  （"❌ --plan…已移除" + 用法 + exit 1），证明守卫下直接运行仍会执行 `main()`；
  探针是参数级错误，零文件系统写入（未在真实照片上跑任何写入路径，S1）
- **两条测试链互不干扰**：`CI=true react-scripts test --listTests` 只列出
  `src/` 下三个文件（`App.test.tsx`、`utils.test.js`、`parseDemoName.test.js`），
  不含 `test/`
- **lint**：`eslint src test --ext .js,.jsx,.ts,.tsx --max-warnings=0` 通过（零 warning）
- **`build/` 未跑**：按流程交用户终端（AGENTS.md 流程 #2）
- 未新增任何照片/二进制；`test/` 只含 1 个 `.js` 文件
