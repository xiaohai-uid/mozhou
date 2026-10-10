# 门禁绑定方案表（墨舟经验 L01/L08/L11/L24）

> 本文件是**绑定侦察与可行性判定**，不是绑定实现。产出任务 t1，基线 HEAD `8fb9798ae4eb36ee07226bcb60f02be4e9a9cc0e`、分支 `feature/windows-local-release`。
>
> **权威顺序**：`lessons.md` 是参考材料，不是流程权威；本文件的任何结论都不得改写 `docs/gates.md`、`AGENTS.md` 或 `PROJECT-MAP.md` 的既有契约。经验库与契约冲突时以契约为准。
>
> **本轮不修改任何产品代码、门脚本或工作流。** 只产出判定与方案，落地由 t2 执行。
>
> **实跑边界**：本轮所有"实跑"均为只读类命令（`--print-stamp`、`check:gates`、引用审计脚本）。未重建安装器、未改任何脚本、未做任何 git 写操作。

---

## 0. 结论摘要

| 条目 | 能否机械化 | 绑定入口 | 阻断/提示 | 是否改产品行为 |
|---|---|---|---|---|
| **L01** 发布证据对应实际构建输入 | **可，但已有防护只是提示型，且覆盖不全** | `scripts/release/windows/build.mjs`（现提示型）＋ `scripts/verify-gates-contract.mjs`（新增登记校验） | 现为**提示型**；建议新增部分为**阻断型** | 否（只读 + 退出码，不改运行时） |
| **L08** 全绿不覆盖缺失的门 | **可，且已定位到一个可实证的现成缺口** | `scripts/verify-gates-contract.mjs:38-43` 扩展为「workflow 对账」 | **阻断型** | 否 |
| **L11** 状态绑定机器可判定的退出码 | **契约已在 `docs/gates.md`；缺口在两处，均可机械化** | `scripts/verify-gates-contract.mjs`（校验 `real-model-gate.mjs` 的 0/1/2）＋ 同文件新增 `file:line` 引用校验 | **阻断型** | 否 |
| **L24** 散文经验不改变下一次操作 | **不可机械化（作为通用机制）**；**L01/L08/L11 各自绑定即是 L24 的实例化** | 无独立入口，见 §4 | 不适用 | 不适用 |
| L02 / L18（附带判定） | **不可机械化** | 见 §5 | 不适用 | 不适用 |

**一句话**：L08 与 L11 可以在**同一个已有入口**（`check:gates`）上补两段检查，这正是 HC16 的失败机制所要求的"从实际 workflow 文件对账"；L01 的"记戳"已完成、**"拦住"未完成**，且真缺的是登记不是标记；L24 不可造门，强行造门就是它自己警告的那件事。

---

## 1. L01 · 发布证据必须对应实际构建输入

### 1.1 现状（已实跑确认）

| 事实 | 出处 | 证据 |
|---|---|---|
| 戳函数存在且是纯函数 | `scripts/release/lib/source-stamp.mjs:11-20`、`:23-26` | `git log` 显示由 `1957bd1`（2026-10-08）新增，是 HEAD 祖先 |
| 构建入口读戳并写入产物元数据 | `scripts/release/windows/build.mjs:15`、`:108`（`...stamp` 展开进 `windows-build-result.json`） | 读码判定 |
| 脏工作区只警告不阻断 | `scripts/release/windows/build.mjs:20-22` | 只调 `console.warn`，无 `process.exit` |
| 实跑输出与基线一致 | `node scripts/release/windows/build.mjs --print-stamp` | `8fb9798ae4eb36ee07226bcb60f02be4e9a9cc0e-dirty` / `dirtyFiles: 132` / exit 0 |

`computeSourceStamp` 的两个分支可在不跑 git 的情况下单测（纯函数），这使 L01 的"判定逻辑"可被机械单测覆盖。

### 1.2 现有入口判定

- **入口**：`scripts/release/windows/build.mjs:20-22`（脏则警告）。
- **类型**：**提示型**。
- **是否满足 L01 的经验要求**：**部分满足，但有一个实质缺口。**

分两点判定：

1. **"产物无法冒充干净提交"——已满足。** 戳带 `-dirty` 与 `dirtyFiles`，且写进 `windows-build-result.json`，符合 L01 §动作1。
2. **"不把脏产物拿去交付"——未满足。** L01 的验收条款 2 要求"验收看产物里的戳"，而不是禁止产生脏产物；条款 1（记录戳）已落地。但**没有任何机制阻止把脏产物当作交付物**。`console.warn` 会滚出日志，但退出码仍是 0，自动化与 CI 都读成"成功"。

### 1.3 真正的缺口（比 captain-findings §A 更具体的一处）

**`package:windows` 之外的发布路径没有戳。**

| 路径 | 是否带戳 | 出处 |
|---|---|---|
| `pnpm package:windows` → `scripts/release/windows/build.mjs` | ✅ 带 | `package.json` 的 `package:windows` |
| `release.yml` → `node scripts/build-release.mjs` | ❌ **不带** | `scripts/build-release.mjs` 全文**无** `source-stamp` 引用；`grep 'stamp\|sourceCommit\|git'` 命中 0 |

而 `release.yml:94-95` 的 "Build truthful release assets" 走的正是 `scripts/build-release.mjs`。它产出三个 tar 归档（`mozhou-v*‑local-runtime.tar.gz`、`‑web-dist.tar.gz`、`‑docker.tar.gz`，`:150-168`），**没有一个写明自己来自哪个提交、是否脏**。

这正是 HC01 的原始失败机制（产物↔提交不对应）在一个**未被 CHG-20261008-21 覆盖**的发布路径上重现。L01 的"绑定"如果只检查 `-dirty` 标记存在，就会漏掉它。

**这是本节最重要的一条：L01 的缺口不在"警告够不够硬"，而在"戳没覆盖全发布路径"。**

### 1.4 绑定方案

只使用已有入口，分两级：

**绑定 A（阻断型，建议本轮做）：在 `check:gates` 中登记发布路径与戳**

- **入口**：`scripts/verify-gates-contract.mjs`（已有，`check:gates`，已接 `ci.yml:59`）。
- **要加的检查内容**：
  1. `docs/gates.md` 必须登记**每一个产出交付物的构建入口**：`package:windows` → `scripts/release/windows/build.mjs`、`build:release`/`package` → `scripts/build-release.mjs`。
  2. 凡登记为"产出交付物"的构建入口，其文件中必须出现 `source-stamp` 引用（静态字符串判定，不执行）。
- **触发条件**：有人新增一条发布构建入口却没在 `docs/gates.md` 登记，或登记了但该入口未打戳 → `check:gates` exit 1，CI 合并被拦。
- **不适用场景**：纯文档门（`check:glossary` 等）不产交付物，不受此检；`--print-stamp` 这类只读探针不产交付物，不受此检。
- **是否改产品行为**：**否**。只读两个文件 + 一个字符串判定，不执行任何构建、不写任何产物。
- **实测现状**：该检查**会立刻失败**（`build-release.mjs` 未打戳且未登记）。这是正确的红灯——它暴露真实缺口。t2 需决定是补戳（改 `build-release.mjs`）还是先按"已知缺口"登记放行。

**绑定 B（阻断型，风险较高，本轮只出方案不落地）：`--require-clean` 开关**

- **入口**：`scripts/release/windows/build.mjs:20-22`。
- **形态**：默认行为**完全不变**；新增 `--require-clean` 时，脏则 exit 2。
- **触发条件**：CI 或发布作业显式带 `--require-clean`。
- **风险**：`CHG-20261008-21` §未做事项已记录"重跑完整安装器会把已登记的干净产物覆盖成 `-dirty` 产物"。若误加到默认路径，会直接破坏既有干净产物登记。**默认不开是硬约束。**

**判定：当前提示型不足以支撑"拦住交付"，但改造的收益/风险比要求"默认不变 + 显式开关"。真正该先做的是绑定 A，因为它不改任何运行路径就能堵住更大的"无戳发布路径"缺口。**

---

## 2. L08 · 构建/测试通过、CI 全绿，都不覆盖缺失的门

### 2.1 现状（已实跑确认）

L08 的核心动作是"**从实际 workflow 文件逐项对账本地编排，不要信任本地封装脚本自己声明的覆盖范围**"。

`scripts/verify-gates-contract.mjs` 全文 68 行已读，其 5 项检查为：

| # | 行 | 检查内容 |
|---|---|---|
| 1 | `:19-27` | `gates.md` 提到的 `pnpm run <name>` 在 `package.json` 中存在 |
| 2 | `:29-36` | `gates.md` 提到的脚本路径真实存在 |
| 3 | `:38-43` | `check:glossary`/`check:architecture`/`check:gates` 同时在 `gates.md` 与 `ci.yml` |
| 4 | `:45-47` | 铁律「BLOCKED 不是 PASSED」在场 |
| 5 | `:49-57` | `verify-real-model-journey.mjs` 的 `--strict` 实现与文档一致 |

**它只读 `.github/workflows/ci.yml` 一个文件**（`:17`），且只用 `ci.includes(name)` 做子串匹配。**它从不枚举 `release.yml`、`graph-gate.yml`、`security.yml`，也不读 `scripts/ci-gate.mjs`。**

### 2.2 实测发现的缺口（全部可复现）

**缺口 1：3 个 workflow 完全不在门的清单里。**

| workflow | 是否被 `check:gates` 感知 | 是否登记在 `docs/gates.md` |
|---|---|---|
| `ci.yml` | ✅ 读 | ✅ |
| `release.yml` | ❌ 不读 | ❌ |
| `graph-gate.yml` | ❌ 不读 | ❌ |
| `security.yml` | ❌ 不读 | ❌ |

即 `graph-gate.yml:43-44` 跑的 `node scripts/check-import-cycles.mjs`（该脚本有完整的 0/1/2 退出码语义，`scripts/check-import-cycles.mjs:151`、`:158`、`:102`）**既不在 `docs/gates.md`，也不在任何 package.json script 中**（实测 `package.json contains check-import-cycles → False`）。

**缺口 2：`docs/gates.md` 的实测基线已腐化 5 天，而 `check:gates` 仍 PASS。** 这是 captain-findings §B 已记录的，本轮复核确认：`node scripts/verify-gates-contract.mjs` → `PASS`，exit 0；而 `docs/gates.md:107` 仍写"103 个文件 / 910 个测试"，`PROJECT-MAP.md`（CHG-20261007-18 / ‑20）已记 "117 文件 1048 用例"。

**缺口 3（本轮新发现，可实证）：`docs/gates.md` 的 `file:line` 退出码出处有 4 条指错行。**

实测审计（对照 `git show HEAD:` 的提交态，因为 `gates.md` 写的是 2026-10-02 的状态）：

| `gates.md` 引用 | 该行在 HEAD 的实际内容 | 判定 |
|---|---|---|
| `scripts/verify-real-model-journey.mjs:76` | `kind: 'test',` | ❌ **指错**（真实 `status: 'BLOCKED'` 在 `:77`） |
| `scripts/verify-real-model-journey.mjs:318` | `log(\`chapter committed: ...\`)` | ❌ **指错**（真实 `status: 'VERIFIED'` 在 `:322`） |
| `scripts/verify-real-model-journey.mjs:347` | `const message = error?.message ?? String(error)` | ❌ **指错**（真实 `status: 'FAILED'` 在 `:351`） |
| `scripts/verify-real-novel-journey.mjs:31` | `console.error('用法: ...')` | ❌ **指错**（真实 `process.exit(2)` 在 `:32`） |
| `scripts/verify-r05-journey.mjs:1249` | `const summaryPath = join(...)` | ❌ **指错**（真实 `process.exit(0)` 在 `:1253`） |
| `scripts/measure-draft-context.mjs:229/:238/:242/:246` | `}` / 对象字段 / 空行 | ❌ **全部指错**（真实 `process.exit` 在 `:250/:259/:263/:267`） |
| `scripts/verify-glossary.mjs:89` | `if (problems.length === 0) { ... process.exit(0); }` | ✅ 正确（HEAD 态） |
| `scripts/gen-architecture.mjs:140` | `process.exit(1);` | ✅ 正确 |
| `scripts/audit-unreferenced.mjs:112` | `process.exit(2);` | ✅ 正确 |
| `scripts/run-real-model-tests.mjs:53` / `:78` | `process.exit(1)` | ✅ 正确 |

**这些指错不是本轮并行会话造成的。** 工作区未提交改动只改了这几个文件各 1 行术语（`门禁`→`门`，外加 `verify-glossary.mjs` 加了一段 BANNED 禁用词扫描共 +48 行）；而 2026-10-02 写下 `:76` 时，当时文件里那一行的内容已与今天的 `:77` 不同。**这正是 L08 描述的失效模式：门清单声称记录了现状，现状变了而门不报。**

注意 `verify-glossary.mjs` 是个例外：HEAD 态 `:89`/`:92` 是正确的，但**工作区**加了 48 行后 `:89`/`:92` 指向注释了。即"加了一行代码就使文档引用失效"，而 `check:gates` 对此毫无反应。

### 2.3 绑定方案

- **入口**：`scripts/verify-gates-contract.mjs`（已有，**不新建门**）。这正是 captain 指定的天然绑定点。
- **要加的检查内容**（三段，按成本递增）：

  **L08-a · workflow 枚举对账（核心，最小可行）**
  读 `.github/workflows/*.yml` 全部文件；对每个文件里出现的 `node scripts/<x>.mjs` 与 `pnpm run <x>`，要求其**出现在 `docs/gates.md` 中**。反之，`docs/gates.md` 中标记"✅ 在 CI"的门，必须能在某个 workflow 中找到。
  - 触发条件：新增/删除 workflow，或 workflow 里新增了未登记的门 → exit 1。
  - 不适用场景：workflow 中的纯环境准备（`npm install --global pnpm`、`actions/checkout` 等）不构成"门"，需白名单排除——排除清单要**显式写出**，不能靠正则漏。

  **L08-b · `file:line` 引用新鲜度**
  对 `docs/gates.md` 中每个 `path:line` 引用，读取该文件该行，要求该行**含退出码或退出码契约信号**（`process.exit` / `exitCode` / `退出码`）。
  - 触发条件：脚本增删行导致引用漂移 → exit 1。
  - 不适用场景：`docs/gates.md` 中不以行号定位的引用（如 `scripts/verify-package-readmes.mjs` 无行号）不在检；本检查只判"引用是否指对"，**不判文档语义是否正确**。
  - 已知代价：这条会让 `check:gates` **立刻转红**（4 类共 9 处引用需修）。这是预期结果，但 t2 需先修 `docs/gates.md` 再让门变绿，否则会与既有基线冲突。

  **L08-c · 本地编排 vs workflow 对账**
  `scripts/ci-gate.mjs:10-15` 声明"任务集对齐 `.github/workflows/ci.yml` 的 novel-os job"，但实测：`ci.yml` 有 `pnpm run test:packages` 与 `pnpm --filter @mozhou/web typecheck` 两个**独立**步骤（`:43`、`:45`），`ci-gate.mjs` 的 `test` 任务只有单条 `pnpm test`。而 `ci.yml:40-42` 明确注释根 `pnpm test` 会让 Web 层跑两遍。
  - 触发条件：`ci-gate.mjs` 的任务集与 workflow 步骤不一致时告警（建议**提示型**，不阻断，因二者编排本就可能有意不同）。
  - **本轮建议只登记为已知缺口，不实施**——判定"本地编排与 CI 编排不同"是否算缺陷本身需要人裁。

- **阻断/提示**：L08-a、L08-b 为**阻断型**（exit 1）；L08-c 为**提示型**。
- **是否改产品行为**：**否**。只读 workflow 文件、`docs/gates.md`、`package.json` 与脚本内容，不执行任何门。
- **与现有门的重复/冲突**：**无重复**。`check:gates` 现状 5 项与新增 3 项检查对象不重叠（现状查"文档↔package.json/ci.yml 子串"，新增查"workflow↔文档全集"与"文档↔源码行号"）。**无冲突**，且第 5 项（`:49-57`）与 L08-b 互补：前者查 `--strict` 的**存在**，后者查引用**指得准**。

---

## 3. L11 · 状态描述必须绑定机器可判定的退出码

### 3.1 现状（已实跑确认）

契约**已存在且相当完整**：`docs/gates.md:9-19`（铁律与三级消费优先级）、`:33`（`verify:real-model` 退出码表）、`:51-57`（status×退出码对照）、`:85-95`（承认退出码未统一）。

**已完整实现的两处**：

1. `scripts/verify-real-model-journey.mjs` —— `result.json`（`:81` `exitCode` 字段）＋ `--strict`（`:93` `process.exit(BLOCKED_EXIT_CODE)`）。已被 `check:gates:49-57` 校验。
2. `scripts/release/real-model-gate.mjs` —— **未被任何门校验**。退出码契约写在 `:21`（`0 VERIFIED · 1 FAILED · 2 BLOCKED`），BLOCKED 分支 `:114-139`（`:118` `const exitCode = 2`，`:121` `status: 'BLOCKED'`，`:139` `process.exit(exitCode)`），收尾 `:208`。该脚本**由 `release.yml:75-76` 调用**，是发布路径上唯一的真实模型门。

**缺口（captain-findings §C 已指出方向，本轮定位到具体条目）**：

| 缺口 | 性质 | 可机械化 |
|---|---|---|
| `real-model-gate.mjs` 的 0/1/2 契约无门校验 | 未被覆盖的已实现契约 | ✅ 可 |
| 其余门（`check:*` 系列）无 BLOCKED 状态 | 事实如此，本就不需要 | ❌ 不应造 |
| `gates.md` 的 `file:line` 引用指错行（见 §2.2） | 出处不可信 | ✅ 可（即 L08-b） |
| 退出码在全仓不统一 | `docs/gates.md:87-95` 已明示"不在本轮范围内" | ⚠️ **本轮不做** |

### 3.2 绑定方案

- **入口**：`scripts/verify-gates-contract.mjs`（已有，不新建门）。
- **要加的检查内容**（L11-a，紧接现有第 5 项之后）：
  `docs/gates.md` 必须登记 `scripts/release/real-model-gate.mjs` 的退出码契约，且该脚本中必须实际存在 `status: 'BLOCKED'` → 退出码 2 的对应关系。
- **触发条件**：有人改动 `real-model-gate.mjs` 的 BLOCKED 退出码而不更新文档，或文档登记了 BLOCKED 契约而脚本没实现 → `check:gates` exit 1。
- **不适用场景**：该门**只在 `release.yml` 中被消费，不在 `ci.yml`**。本检查只校验契约一致性，**不接入 `ci.yml`**（缺凭据时 CI 会永久红）。这是与 L11 经验最相关的一条纪律：**不要为了让门"能跑"而让它在没有凭据的 CI 里假装通过，也不要因为它跑不了就不登记它的契约。**
- **阻断/提示**：**阻断型**（exit 1）。它阻断的是"文档与脚本脱节"，不是"缺凭据"，因此不会在 CI 中造成假红。
- **是否改产品行为**：**否**。只读脚本与文档。
- **与现有门的重复/冲突**：**无重复**。现有第 5 项针对 `verify-real-model-journey.mjs`，本项针对 `real-model-gate.mjs`，两个不同文件、不同调用方、不同 CI 归属。
- **明确不做**：统一全仓退出码。`docs/gates.md:95` 已把这条划为独立变更，且需要逐个确认调用方。本队无授权，**不造这个门**。

---

## 4. L24 · 经验写成散文，不会改变下一次操作

### 4.1 判定：**不可机械化**（作为独立机制）

L24 的失败机制是："散文提醒留在文档里，没有绑定到任何机械入口"。要给它造一个门，会遇到一个自指困境：

- 若造一个"检查文档是否绑定了门"的门，它检查的对象仍然是文档，**回到 L24 自身**：散文里写"已绑定"同样能让它通过。
- 真正能机械判定"经验是否改变了下一次操作"的，只有一件事：**做一次真实任务，看它是否被引用/是否改变了行为**。这需要任务采样与人/代理判定，属 §4.3 的替代方式。
- `report.md:11` 已用 22 项回放量化过这一点：两组 21 vs 22，差异仅一项，且**合成文字回放、未执行任何产品操作**（`:156-159`）。这条证据本身就说明：文字回放无法作为机械化判据。

### 4.2 但 L24 在本队里的正确处理方式

L24 **不需要自己的门，它由 §1/§2/§3 的绑定来实例化**。HC01（散文四天后复发）的教训正是 L01 本身；把 L01 绑到机械入口，就是 L24 的第一次落地。

**可机械化的一小部分**：本方案表 §5.3 的"绑定登记"本身是 L24 的载体——每条经验在 `docs/gates.md` 或本文件中有一行指名它绑定到哪个 `file:line`。这是**登记**，不是**校验**。

### 4.3 替代处理方式（诚实标注为不可机械化）

| 做法 | 说明 | 为何不能机械化 |
|---|---|---|
| 本文件 + `docs/gates.md` 登记每条经验→入口 | 本轮已做 | 只能保证"登记存在"，不能保证"下次被读到" |
| 触发条件写入经验正文 | `lessons.md` 已有的"触发条件"结构即为检索索引（`:497-519` 调用索引表） | 依赖下一位执行者主动检索，无强制力 |
| 真实任务前瞻检验 | `report.md:185-191` 列为高成本候选，是唯一能验证预防效果的方式 | 需真实任务样本与多轮重复，非本队范围 |

**结论**：L24 记为**不可机械化**。本队对 L24 的交付物是"让 L01/L08/L11 各自落地"，而不是造一个关于散文的门。

---

## 5. 附带判定与其他核对

### 5.1 L02（下层实现存在 ≠ 路由可达）——**不可机械化**

- **理由**：需要从真实消费者入口（浏览器链接、真实 HTTP 客户端）走到 handler，逐段验证方法/参数通道/鉴权/白名单。这依赖运行时网络、鉴权态与 hosted 环境——`lessons.md:528` 明确把 hosted 环境列为**未覆盖范围**。
- **部分可机械化**：单条路由的方法闸白名单一致性属于静态可检的，但仓库**没有单一权威的路由-白名单映射文件**可供对账；造它需新建权威源，属越权。
- **替代**：登记为 `docs/gates.md` 的已知缺口，与 §85-95 的"退出码未统一"同类；真实验证留给 hosted 环境的任务。

### 5.2 L18（副本与无消费者的抽象）——**部分可机械化，本队不做**

- **可机械化部分**：`scripts/audit-unreferenced.mjs`（已存在，`audit:unreferenced`，exit 2）正是"无生产消费者"检测器。这覆盖了 L18 动作 2（新增工具模块前先确认至少一个真实消费者）。
- **不可机械化部分**：L18 动作 1（"是否为共享逻辑复制了整个文件"）需语义判断；1043 行副本与单文件的相似度阈值由人裁定。
- **判定**：`audit-unreferenced` 已在 `gates.md:34` 登记。本队**不新增检查**，只在 `docs/gates.md` 标注它承载 L18 即可。

### 5.3 冲突与重复核对（逐条）

| 绑定 | 与哪个门重叠 | 结论 |
|---|---|---|
| L01-A（发布入口登记） | `check:gates:38-43` 查"门在不在 ci.yml" | **不重叠**。前者查"产交付物的入口是否登记并打戳"，后者查"文档门是否被 CI 执行"。`package:windows`/`build-release.mjs` 都不是 `ci.yml` 里的文档门。 |
| L08-a（workflow 枚举） | `check:gates:38-43` | **不重叠但相邻**。第 3 项只认 3 个固定门名 + 子串匹配；L08-a 是全枚举 + 反向对账。需注意：L08-a 会让 `check-import-cycles` 这类"在 workflow 里但不在文档里"的项变红，这是**预期行为**，但 t2 落地时须与 §2.2 缺口 1 一并处理，否则会一次引入 3 处新失败。 |
| L08-b（行号新鲜度） | `check:gates:49-57` | **互补**。前者查契约字段存在，后者查引用指得准。 |
| L11-a（real-model-gate 契约） | `check:gates:49-57` | **不重叠**。不同文件、不同调用方（`release.yml` vs 无）。 |
| 全部 vs `check:glossary` / `check:term-map` / `check:readmes` / `check:architecture` | — | **完全不重叠**。这四个门管内容与新鲜度，本次绑定管"登记的完整性与出处准确性"。 |

**跨条重复风险**：L08-b 与 L11 共享"出处准确性"这一主题，但落点不同（gates.md 的行号引用 vs real-model-gate 的退出码契约）。**实现时应写在同一脚本的不同段，不共用抽象**，避免 L08 自身警告的"复制实现代替单一契约"。

### 5.4 与并行会话未提交改动的关系

工作区 16 个 `scripts/*.mjs` + `ci.yml` + `docs/gates.md` 的脏改动属 CHG-20261007-20 术语统一（`门禁`→`门`），**不得回退**。本方案全部为**新增段**，不改动这些文件已有的行。

**`verify-gates-contract.mjs` 本身也在脏文件列表中**（实测 `git diff` 显示 5 处 `门禁`→`门`，mtime `2026-10-07 22:38:18`）。这修正了本文件初稿的一处误判——初稿称它"不在脏文件列表中，故 t2 修改它是安全的"，**该结论错误**：t2 修改它时**必须精确暂存/只动新增行**，否则会连带提交并行会话未完成的一字改动（这正是 `CHG-20261008-21` §6 用精确暂存解决过的同一问题）。该改动纯为注释与字符串字面量，**不改变退出码语义**，故 §2/§3 对它的行号引用（`:19-27`、`:38-43`、`:49-57` 等）在脏态下仍成立。

注意 §2.2 的实测：`verify-glossary.mjs` 工作区 +48 行会使 `gates.md:25` 的 `:89`/`:92` 引用失效。这是 L08-b 价值的活证据，**但也意味着 t2 修 `gates.md` 行号时必须以最终工作区状态为准，且该文件仍在被并行会话编辑**——t2 落地前须复核是否又有新改动。

---

## 6. 给 t2 的落地建议（优先级与顺序）

1. **先修 `docs/gates.md` 的行号引用**（L08-b 的前置，否则 `check:gates` 一开检查就红）。以落地时的实际工作区行号为准。
2. **补 `docs/gates.md` 的登记缺口**：`release.yml`、`graph-gate.yml`、`security.yml`、`check-import-cycles.mjs`、`real-model-gate.mjs`、`package:windows`、`build-release.mjs`。
3. **再启用 L08-a + L08-b + L11-a 三段检查**，全部为 `check:gates` 内的追加，退出码语义不变（0/1）。
4. **L01-A 的红灯不要掩盖**：`build-release.mjs` 无戳是真实缺口，应登记为已知缺口或补戳，**不要为了让门绿而删掉这条检查**——那正是 L08 自身警告的失败方式。
5. **L01-B（`--require-clean`）与 L08-c 本轮不落地**，只保留本文件中的方案与风险说明。

**验收基准**（来自 `gate-baseline-before.json`）：改动后 `check:gates` / `check:glossary` / `check:readmes` 必须仍为 exit 0；`check:term-map` / `check:architecture` 的 STALE 属既有阻断，不得归功或归咎本轮。

---

## 7. 本文件的证据边界

- **实跑的**：引用审计（对照 `git show HEAD:` 逐行核验 10 处 `file:line`，得 6 类指错）、`node scripts/verify-gates-contract.mjs` → PASS/exit 0、`--print-stamp` 输出、workflow 与 package.json 的登记缺失、`ci-gate.mjs` 与 `ci.yml` 的步骤差异、`git log`/`git ls-files` 的追踪状态、`git status` 的脏文件清单。
- **读码判定的**：`build.mjs:108` 的 `...stamp` 展开写入、`real-model-gate.mjs` 的退出码分支、`check-import-cycles.mjs` 的退出码位置。
- **未跑的**：未重建安装器、未执行任何 workflow、未验证 hosted 环境、未做浏览器真实点击路径。**这些仍在 `lessons.md:523-535` 的未覆盖范围内。**
- **引用基准说明**：§2.2 的行号审计以 `git show HEAD:` 为准，因为 `docs/gates.md` 记录的是 2026-10-02 状态；工作区当前另有并行会话的未提交改动，两者需分别对待。