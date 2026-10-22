---
date: 2026-10-21
description: '长篇验收中 compactionVerified / genrePresetVerified 两个标志的语义、写入方、失败门与用户可见行为规格；含需作者拍板的决策点'
tags:
  - project-note
  - mozhou
  - acceptance
---

# 长篇验收 Verified 标志规格（compactionVerified / genrePresetVerified）

> 状态：**决策就绪，未实现**。本文件只定义契约与判定语义，不改任何代码、不改变量、不改门脚本。
> 关联：`docs/gates.md`（BLOCKED ≠ PASSED 与门清单）、`docs/audit/longform-evidence-invalidation-20261017.md`（两份假 PASS 作废）、`docs/changes/CHG-20261012-02-verification-honesty-and-ci-order.md`（判定改为派生）、`docs/changes/CHG-20261018-01-core-defects-d1-d5.md`（D3 证据卫生扫描）。

## 0. 先纠正一个前提（事实基线）

任务描述称「当前 HEAD 全仓搜不到这两个标志」。**这一条与 HEAD `85e3620` 的实际内容不符**，必须先纠正，否则规格会建立在错误前提上。

实测（`git grep -n "compactionVerified\|genrePresetVerified" HEAD -- scripts docs`）：

| 位置 | 现状 |
|---|---|
| `scripts/verify-longform-e2e.mjs:1038-1043` | `compactionVerified = Boolean(compactionEvidence)`；`genrePresetVerified = genrePresetEvidence.idempotentPass`；两者都进入 `verdictFailures`，`verdictStatus` 由失败项数量派生，FAIL 时 `process.exitCode = 1` |
| `scripts/verify-longform-e2e.mjs:1093,1096` | 两个标志写入 `summary.json` |
| `scripts/check-evidence-hygiene.mjs:113` | 扫描 `evidence/longform-journey/*/summary.json`，`status === 'PASS'` 而三字段任一非 `true` 即 exit 1 |
| `packages/data-plane/src/compaction.ts`、`genre-kits.ts` | **不含**这两个标志，也不返回任何验证结论 |
| 两个能力的单测 | **不消费**这两个标志 |
| `.github/workflows/longform-nightly.yml` | 先跑 e2e，再以 `if: always()` 跑证据卫生；任一失败即 job 红 |

所以真正的缺口不是「标志不存在」，而是四件事没有定义：

1. **语义**：`compactionVerified = Boolean(compactionEvidence)` 只证明「压缩调用返回了」，不证明「压缩真的完成且结果正确」；`genrePresetVerified` 只证明「二度应用 0 写入 + 有跳过」，不证明首度注入真的写对了。
2. **写入方**：两个能力模块不产出验证结论，只有 e2e 脚本在内存里算；没有单一 owner，也没有契约字段。
3. **失败门**：目前只有「长程 e2e 判定」与「证据卫生扫描」两个消费者，都在夜间/凭据门；PR 级（CI 的包层测试）没有任何用例能证明「注入 false 会让验收失败」。
4. **用户可见行为**：失败只体现为退出码、终端日志、台账一行和 Actions 红；作者侧完全没有可见面。

### 0.1 现有语义下的两个假阳性路径（实读代码确认）

- **压缩**：`packages/kernel/src/compaction.ts:270-278` 在候选为空时返回空摘要与空 `factsCompacted`，不调 LLM；`packages/data-plane/src/compaction.ts:252-298` 随后仍会写大纲、追加 `VOLUME_COMPACTED` 事件。因此「候选为空、摘要为空字符串」也会让 `compactionEvidence` 非空 → `compactionVerified = true`。
- **压缩回放**：`packages/data-plane/src/compaction.ts:233-243` 的幂等回放分支返回 `compactedFactIds: []`，但同样会产出 `compactionEvidence` → `compactionVerified = true`。本轮实际没有折叠任何事实。
- **题材预设**：`scripts/verify-longform-e2e.mjs:1027` 的 `idempotentPass` 只检查 `appliedCount === 0 && skippedCount > 0`。若目标书在首度应用前已存在全部 5 个文件（作者手写、或同书第二次跑验收），首度与二度都是 0 写入 + 5 跳过 → `genrePresetVerified = true`，但**本轮没有注入任何内容**。`createBook` 只预置 `大纲/第一卷.md`，不预置流派包的 5 个目标文件，所以新建书路径当前不会触发；但这不是契约保证。

这两条不是「实现 bug」，而是**标志语义没有定义**的必然结果：布尔值无法区分「验证通过」「验证失败」「本轮没跑」「被环境阻塞」。

### 0.2 第二轮返工修正索引（对应复核意见）

| 复核意见 | 修正位置 | 修正要点 |
|---|---|---|
| 新增 outcome 枚举没有任何门消费，投影不变量无人校验 | D1 / D5；负例 7–13 | 门改为消费 outcome；新增「outcome ↔ boolean 投影一致」检查；定义 v1/v2 兼容规则；负例直接覆盖 `outcome=failed + verified=true + status=PASS` |
| PR 级测试只测纯函数，不证明 e2e 真的调用它 | D2 / D5；负例 17 | 新增可单测的 wiring 检查器（对 e2e 源码断言导入与调用、禁止 `Boolean(compactionEvidence)` 一类判定），并用「变异源码」夹具证明检查器会红；证据卫生脚本同步扩展静态规则 |
| `blocked` outcome 没有生产者，且与整体 BLOCKED 冲突 | D6 | 定义错误分类（环境不可达 → blocked，领域失败 → failed）、失败后中止而非继续、以及整体状态优先级与退出码 |
| D3/D4 验证清单超出纯函数声明输入，新增证据字段未定义 | D2.1 / D3 / D4 | 定义两份阶段证据文件的完整字段与派生函数入参形状；清单中的每一项都映射到可落盘字段 |
| D3「任一不满足：failed」与 A2/A3 的 not_run 自相矛盾 | D3 / D4 | 写死分类顺序：先判未执行 / 阻塞 / 无实际工作，再跑清单 |
| D3 item 5 接受「本轮之前已记录的 verified 证据」 | D3 | 删除该条；明确无跨轮继承，历史证据不得替代本轮判定 |
| 证据卫生测试无法构造临时证据目录 | D7 | 扫描逻辑抽成注入 root 的纯函数；测试用临时目录，不写真实 `evidence/` |
| CI 接线说法与仓库实际不符，测试放置未决定 | Q3 / D5 / D7 | CI 入口写实为 `test:coverage:packages`（`.github/workflows/ci.yml:43`）与 `test:coverage:web`（`.github/workflows/ci.yml:52`）；派生函数与测试放 `packages/benchmark/src/` |
| `verdictFailures` 改形状会破坏日志与历史证据 | D1 | `verdictFailures` 保持 `string[]`；新增并列的 `failureCodes: string[]` |

---

## Problem Statement

维护者在夜间长程验收里看到 `status: PASS`，无法判断卷压缩与题材预设这两件事到底是「真的验证过且正确」，还是「调用返回了但结果为空/回放/未注入」。历史上已经出现过两份 `status: "PASS"` 配 `compactionVerified: false` 的假通过（见作废记录），说明「字段存在」不等于「门在判定」。

同时，任何人想验证「把 `compactionVerified` 置为 false，验收会不会红」，今天只能改 e2e 脚本源码或等一次真实的 31 章夜间运行——没有可在 PR 级运行的注入点。于是「这两个标志与验收门的关系」既没有被测试固定，也没有文档定义。

作者侧则完全看不到这两项：长程验收是维护者/CI 的事，作者既不知道它跑没跑，也不知道它红了意味着什么。

## Solution

把两个布尔字段升级为**有明确语义的验收结论**，并给出唯一写入方、唯一派生函数、明确的失败门清单和明确的用户可见面：

1. 保留 `compactionVerified` / `genrePresetVerified` 作为证据字段名（历史证据与证据卫生门已依赖），但把它们的含义从「证据对象非空」改为「本项验证清单全部通过」。
2. 新增并列的 `compactionOutcome` / `genrePresetOutcome`，取值为 `verified | failed | not_run | blocked`，布尔字段是它的投影（`verified` 才为 `true`）。这样 `docs/gates.md` 的「BLOCKED 不是 PASSED」在证据里可被机器区分。
3. 用一个纯函数统一派生 `status` 与失败项，e2e 脚本只做 I/O；该纯函数是唯一的注入点，PR 级单测直接喂 `false` / `not_run` / `blocked` 断言验收失败。**纯函数之外还必须证明 e2e 真的调用它**：用 wiring 检查器对 e2e 源码做确定性断言，防止「纯函数与绿测试都在，脚本仍走旧语义」。
4. 明确失败门：长程 e2e 判定、证据卫生扫描、夜间 job 必须红；PR 级新增派生纯函数单测与 wiring 测试必须红。其余门（构建、lint、性能冒烟、发布资产）明确不消费。
5. 明确用户可见面：维护者看到退出码、终端、台账与 Actions；作者侧**默认无可见面**（本规格建议），并在文档里写清这是验收期标志而非运行时状态。

## 四个必须回答的问题

### Q1 · 这两个标志今天该叫什么

**建议（待作者确认）**：字段名不变，语义重定义；另加 outcome 枚举与证据 schema 版本。

| 字段 | 类型 | 含义 |
|---|---|---|
| `evidenceSchemaVersion` | `2` | 新语义证据的版本标记；缺失即视为 v1 旧语义 |
| `compactionVerified` | boolean | `compactionOutcome === 'verified'` 的投影，仅为兼容历史证据与证据卫生门保留 |
| `compactionOutcome` | `'verified' \| 'failed' \| 'not_run' \| 'blocked'` | 卷压缩验收结论的唯一真源 |
| `genrePresetVerified` | boolean | `genrePresetOutcome === 'verified'` 的投影 |
| `genrePresetOutcome` | 同上 | 题材预设验收结论的唯一真源 |
| `failureCodes` | `string[]` | 稳定机器码；与 `verdictFailures` 一一对应 |
| `verdictFailures` | `string[]` | **形状不变**的人类可读消息，供日志 `join('；')` 与旧消费者使用 |

命名理由：

- 保留旧名是**兼容性要求**，不是偏好：`scripts/check-evidence-hygiene.mjs:113` 按旧名扫描，历史证据目录也按旧名记录；直接改名会让旧证据的扫描语义静默失效。
- 新增 outcome 是**语义要求**：布尔值无法表达「没跑」与「被阻塞」，而这正是 `docs/gates.md` 的核心铁律。
- 不采用 `compactionCheck` / `genrePresetCheck` 之类新名：会同时破坏旧证据与卫生门，收益为零。
- `verdictFailures` 不改形状：`scripts/verify-longform-e2e.mjs:1107` 用 `verdictFailures.join('；')` 打日志，改成对象数组会输出 `[object Object]`；历史 summary 的 `string[]` 也需要继续可读。机器码另开 `failureCodes`，两者由同一组 `{ code, message }` 派生。

**备选**：若作者认为「Verified 一词已被 auth 的 `VerifiedPrincipal` 占用、容易混淆」，可改为 `compactionAccepted` / `genrePresetAccepted`；但必须同步改证据卫生门与历史证据说明，属于破坏性变更，需要单独决策。

### Q2 · 由谁写入

**建议（待作者确认）**：三层职责，能力模块不写验收标志。

| 层 | 职责 | 是否本轮改动 |
|---|---|---|
| 能力层（`executeVolumeCompaction` / `applyGenreKitToBook`） | 只返回**事实**：是否发生折叠、折叠了哪些事实、写了哪些文件、跳过了哪些文件、是否幂等回放。**不判断「验证是否通过」** | 否（保持现有返回契约） |
| 验收派生层（新增纯函数，落在 `packages/benchmark/src/`，由包入口导出） | 消费能力层事实 + e2e 落盘的阶段证据，产出 `outcome` / `verified` / `failureCodes` / `verdictFailures` / `status` | 是（实现阶段） |
| 证据落盘层（e2e 脚本） | 采集事实、读回落盘状态、调用派生函数、写 `summary.json` 与阶段证据、设置退出码 | 是（实现阶段） |

理由：

- 能力层若返回「verified」，等于让被验对象自己给自己发合格证；而且 `compaction.ts` / `genre-kits.ts` 是数据面公共契约，加字段属于 Contract Delta（UVSD 第 10 条：契约默认冻结）。
- 派生层做成纯函数后，注入 `compactionVerified=false` 不再需要改能力代码，也不需要真实模型凭据，PR 级可测。
- 派生层放 `packages/benchmark`：它是基准/验收套件，当前零入向消费者（仓库 `AGENTS.md` 的包依赖说明），不会把验收语义塞进生产链路；该包已在根 `tsconfig.json:10` 的 `tsc -b` 引用内，e2e 可像现有动态导入那样从 `packages/benchmark/dist/index.js` 取函数。
- 作者数据（`book.json`、Manifest、frontmatter）**不写入**这两个标志；它们是验收产物，不是正典状态。

### Q3 · 哪些验收必须因它失败

**必须失败（硬门）**：

| 验收 | 触发条件 | 失败表现 | 现状与入口 |
|---|---|---|---|
| 长篇 e2e 判定 | 任一 outcome 不是 `verified`，或整体派生为 FAIL/BLOCKED | `status = FAIL`（退出码 1）或 `status = BLOCKED`（退出码 2）；`failureCodes` 含稳定机器码 | 已存在（布尔版），需补 outcome 语义与错误分类 |
| 证据卫生扫描 | v2 记录：`status=PASS` 而任一 outcome ≠ `verified`、或投影不一致、或 `failureCodes` 与 status 矛盾；v1 记录：`status=PASS` 而任一 `*Verified !== true` | `check-evidence-hygiene` exit 1 | 已存在（只读布尔），需扩展为消费 outcome + 投影检查 |
| 夜间长程 job | 上述任一失败 | GitHub Actions job 红，证据仍上传 | 已存在（`.github/workflows/longform-nightly.yml`） |
| **新增：PR 级派生单测** | 注入 `failed` / `not_run` / `blocked` | `pnpm run test:coverage:packages` 失败，`ci.yml` 红 | **缺失，本规格要求补** |
| **新增：PR 级 wiring 测试** | e2e 未导入派生函数，或仍保留 `Boolean(compactionEvidence)` 一类判定 | 同上 | **缺失，本规格要求补** |
| **新增：证据卫生扫描器单测** | 扫描器对「PASS + outcome failed」「投影不一致」「v1 兼容」判定错误 | 同上 | **缺失，本规格要求补** |

**明确不失败（非目标）**：

| 验收 | 理由 |
|---|---|
| `pnpm build` / `lint` / typecheck | 这两个标志不是编译期契约 |
| `pnpm perf:smoke` | 与长程验收无关 |
| 发布资产构建 | 与长程验收无关 |
| 发布真实模型门（`real-model-gate`） | 该门验的是单章真实模型旅程，不验 31 章长程；是否要求「近期长程 PASS」是作者决策（见 A8） |

**CI 入口写实**（避免「随 `pnpm test` 进 CI」这类错误说法）：

- `.github/workflows/ci.yml:40-43` 明确注释「根 `pnpm test` … CI 不再调用它」，实际执行 `pnpm run test:coverage:packages`（`.github/workflows/ci.yml:43`）与 `pnpm run test:coverage:web`（`.github/workflows/ci.yml:52`）。
- 根 `vitest.config.ts:6` 的 `include` 只有 `packages/*/src/**/*.test.ts`。因此**派生纯函数、wiring 检查器及其测试必须放在 `packages/*/src/` 下**（本规格选 `packages/benchmark/src/`），否则本地 `pnpm test` 与 CI 都不会跑。
- 证据卫生脚本的测试放在 `scripts/lib/` 时，必须同步扩展 `vitest.config.ts` 的 `include`（见 D7）；这是本规格唯一允许修改 vitest 配置的理由。
- `check-evidence-hygiene.mjs` 本身不在 `ci.yml` 中，只由 `longform-nightly.yml` 与本地 `node scripts/ci-gate.mjs evidence-hygiene` 调用（`docs/gates.md:52`）。所以「PR 级一定红」必须由 vitest 用例保证，不能只靠卫生脚本。

失败项必须带稳定机器码，而不是只有中文句子：

- `COMPACTION_NOT_VERIFIED`（outcome = failed）
- `COMPACTION_NOT_RUN`（outcome = not_run）
- `COMPACTION_BLOCKED`（outcome = blocked）
- `GENRE_PRESET_NOT_VERIFIED`
- `GENRE_PRESET_NOT_RUN`
- `GENRE_PRESET_BLOCKED`
- `RESTART_INCONSISTENT`（`restartConsistent=false`；该标志的派生逻辑不变，只补机器码）
- `HARNESS_FATAL`（脚本在写出证据前发生未分类异常；见 D6）

`not_run` 与 `blocked` 是否算「验收失败」需要作者拍板（见 A6）：本规格建议**两者都不得让门变绿**——`not_run` 记 FAIL（退出码 1），`blocked` 记整体 BLOCKED（退出码 2）。两者都不是 PASS，但保留区分，便于事后判断是「没跑到」「被环境阻塞」还是「跑了但错」。

### Q4 · 失败时的用户可见行为

| 角色 | 今天可见 | 建议可见 |
|---|---|---|
| 维护者（本地跑 e2e） | 终端 `判定：FAIL！未通过项：…`、退出码 1、`journey-ledger.md` 一行「未取得压缩证据 / 二度应用未表现为严格幂等」 | 保持，并把台账行改为按 outcome 输出三种措辞（failed / not_run / blocked），机器码同时进 `summary.json` |
| CI 观察者 | Actions job 红、证据 artifact 上传 | 保持；job summary 里点名失败项机器码 |
| 作者（应用内） | **无任何可见面** | **建议保持无可见面**：这两个标志是验收期结论，不是作者运行时状态；把它们做成 UI 徽标会暗示「作品当前不可用」，与实际语义不符 |
| 作者（API 直接调用） | `/api/genre-kit.apply` 失败时返回 500 + 错误消息 | 保持；不新增「verified」字段到路由响应（避免 UI 误用） |

**明确不做的用户可见行为**：

- 不因这两个标志失败而阻止作者保存、提交、生成章节。
- 不在作品列表/任务中心显示「验收失败」徽标（除非作者另拍板 A9）。
- 不把标志写进 `book.json` 或正典文件。

---

## User Stories

1. 作为维护者，我希望 `summary.json` 里能一眼区分「卷压缩验证通过」「跑了但失败」「本轮没跑」「被环境阻塞」，这样我不会再把回放或空摘要读成通过。
2. 作为维护者，我希望 `compactionOutcome` 不是 `verified` 时长篇验收一定非零退出，这样夜间 job 不会绿着掩盖问题。
3. 作为维护者，我希望 `genrePresetOutcome` 不是 `verified` 时同样非零退出，这样「二度应用不幂等」不会被当成小问题。
4. 作为维护者，我希望在 PR 上就能跑一个不花钱、不调模型的用例，把 `failed` / `not_run` / `blocked` 注入派生函数并断言验收失败，这样我不必等夜间跑完 31 章才发现门没接上。
5. 作为维护者，我希望注入 `genrePresetOutcome=failed` 时有同样的 PR 级用例，这样两个标志的门都有回归保护。
6. 作为维护者，我希望有一条 PR 级 wiring 用例证明 e2e 真的导入了派生函数、且不再用 `Boolean(compactionEvidence)` 判定，这样「纯函数与绿测试都在、脚本仍走旧语义」不会复发。
7. 作为维护者，我希望失败项有稳定机器码（如 `COMPACTION_NOT_VERIFIED`），这样日志措辞变化不会让自动化失效。
8. 作为维护者，我希望证据卫生门在 `status=PASS` 且任一 outcome 非 `verified`、或 outcome 与布尔投影不一致时一定失败，这样历史假 PASS 的失效模式被永久堵住。
9. 作为维护者，我希望证据卫生门只对 `status=PASS` 的「成功声明」做矛盾检查，这样 `status=FAIL` 且标志为 false 的诚实失败不会被二次判红。
10. 作为维护者，我希望 `compactionVerified` 的含义是「大纲有非空摘要与 `compactedAt`、候选事实都回写了折叠标记且 revision 递增、事件账本恰好一条对应事件、召回不再返回被折叠事实」，而不只是「函数返回了」。
11. 作为维护者，我希望幂等回放（`idempotentReplay=true` 且本轮零折叠）被记作 `not_run` 而不是 `verified`，这样重复运行不会制造假绿。
12. 作为维护者，我希望候选为空、摘要为空字符串的运行被记作 `not_run` 而不是 `verified`，这样空压缩不会被读成「压缩成功」。
13. 作为维护者，我希望 `genrePresetVerified` 的含义是「首度应用写入了预期的 5 个文件、内容非空且含该流派特征、全部登记进基线、二度应用全量跳过」，而不只是「二度应用 0 写入」。
14. 作为维护者，我希望目标书在首度应用前已存在全部 5 个文件时，结论是 `not_run` 而不是 `verified`，这样「本轮没注入」不会被读成「注入成功」。
15. 作为维护者，我希望首度应用「部分写入、部分跳过」时，只有缺失文件补齐且每个已存在/新写文件都通过内容与基线检查才记 `verified`，否则记 `failed`，这样作者手改不会让门永远红，也不会让半成品混过。
16. 作为作者，我希望这两个验收标志不出现在我的作品数据里，这样它们不会污染正典、快照或对账。
17. 作为作者，我希望长程验收失败时应用内的写作、提交、生成都不被阻塞，因为这两个标志衡量的是验收流程，不是我的作品是否可用。
18. 作为作者，我希望如果将来要在应用内看到验收状态，它是只读的诊断信息，而不是会阻断操作的错误。
19. 作为发布负责人，我希望明确知道发布门是否要求「近期一次长程 PASS」，这样我不会在没跑长程的情况下声称发布已验收。
20. 作为新加入的维护者，我希望规格里有一张表写清每个标志的写入方、消费者、失败表现，这样我不必读三个脚本才能拼出全貌。
21. 作为新加入的维护者，我希望历史证据（已作废的两份与旧语义 PASS）与新语义的关系被写清，这样我不会拿旧 `PASS` 当基线。
22. 作为审查者，我希望规格明确「能力层不给自己发合格证」，这样后续不会有人把 `verified` 直接塞进数据面返回值而绕过派生层。
23. 作为审查者，我希望 `not_run` 记 FAIL、`blocked` 记整体 BLOCKED，两者都不是 PASS 但可区分，这样既不假绿也不丢失诊断信息。
24. 作为审查者，我希望改动这两个标志的语义时必须同步改证据卫生门、wiring 检查器与历史证据说明，这样兼容性不会被悄悄破坏。

## Implementation Decisions

> 以下为**决策内容**，不是实现指令；具体代码在实现阶段确定。字段形状是契约，不是代码片段。

### D1 · 证据字段与兼容

`summary.json`（v2）：

- 保留 `compactionVerified` / `genrePresetVerified` 两个布尔字段，语义改为 outcome 的投影。
- 新增 `compactionOutcome` / `genrePresetOutcome`，四值枚举。
- 新增 `evidenceSchemaVersion: 2`。
- 新增 `failureCodes: string[]`；**`verdictFailures` 保持 `string[]` 不变**，两者由同一组 `{ code, message }` 生成：`failureCodes = entries.map(e => e.code)`，`verdictFailures = entries.map(e => e.message)`。日志继续用 `verdictFailures.join('；')`。
- 不新增顶层 `status` 取值；`status` 仍为 `PASS | FAIL | BLOCKED`。
- `restartConsistent` 保持布尔与现有派生逻辑，只补 `RESTART_INCONSISTENT` 机器码；本规格不为它新增 outcome。

**兼容规则（证据卫生门必须实现）**：

| 记录形态 | 门的行为 |
|---|---|
| v2（`evidenceSchemaVersion === 2`） | `status=PASS` / `status=FAIL` 时必须同时有 outcome 与布尔；投影必须一致；`status=PASS` 要求两个 outcome 均为 `verified` 且两个布尔均为 `true` 且 `failureCodes` 为空**且 `restartConsistent === true`**（现行门 `check-evidence-hygiene.mjs` 与 `evidence/longform-journey/README.md` 都把 restart 一致性作为 PASS 的必要条件，v2 不得放宽）；`status=FAIL` 要求 `failureCodes` 非空；`status=BLOCKED` 允许 outcome 缺失（preflight 探针失败，此时 `failureCodes` 可为空），但若存在 outcome 则至少有一个 `*_BLOCKED` 机器码，且两项 outcome 不得都为 `verified` |
| v1（无版本、无 outcome） | 保持现行规则：`status=PASS` 要求三个布尔均为 `true`；输出 `LEGACY_SEMANTICS` 警告并计入 legacy 计数；**不得作为新语义的通过基线** |
| 半新半旧（有版本缺 outcome、有 outcome 无版本、outcome 非法值） | 违规，exit 1 |
| 投影不一致（任意 status） | 违规，exit 1 |

这条表直接堵住复核指出的路径：`compactionOutcome:'failed'` + `compactionVerified:true` + `status:'PASS'` 会同时触发「投影不一致」与「PASS 要求 outcome=verified」两条违规。

v1 豁免只针对本规格生效前已存在的历史记录；新运行由 D2 的 wiring 测试保证必写 `evidenceSchemaVersion` / outcome / `failureCodes`，不能靠省略字段伪装成 v1。若实现选择给门加时间或 runId 截止线，必须在 `docs/gates.md` 记录该边界。

### D2 · 派生层与 e2e 接线

- 新增一个**纯函数**作为唯一判定入口，落在 `packages/benchmark/src/` 并由包入口导出；输入为阶段证据对象（见 D2.1）+ `restart` 事实，输出：

  ```
  {
    status: 'PASS' | 'FAIL' | 'BLOCKED',
    failureCodes: string[],
    verdictFailures: string[],
    compactionOutcome: Outcome,
    compactionVerified: boolean,
    genrePresetOutcome: Outcome,
    genrePresetVerified: boolean
  }
  ```

- 该纯函数必须无 I/O、无时间依赖、无随机性；e2e 负责读文件、调能力层、采集证据，再把证据传进来。
- e2e 脚本只负责采集事实、调用纯函数、落盘、设置退出码；脚本内不再出现「`Boolean(evidence)` 即通过」的判断。
- **接线必须被证明**（这是复核第 2 条的核心）：
  1. 新增一个同样放在 `packages/benchmark/src/` 的 **wiring 检查器纯函数**，输入是 e2e 源码字符串，输出违规列表。规则（匹配前先剥离注释）：
     - 必须存在从 `packages/benchmark/dist/index.js` 导入派生函数的语句；
     - 必须存在对派生函数的调用；
     - 必须写出 `compactionOutcome`、`genrePresetOutcome`、`failureCodes`；
     - 禁止 `/Boolean\s*\(\s*compactionEvidence\s*\)/`；
     - 禁止 `/compactionVerified\s*=\s*Boolean/`；
     - 禁止 `/genrePresetVerified\s*=\s*[^\n]*\.idempotentPass/`。
  2. wiring 测试用**真实 e2e 源码**断言零违规，并用**变异夹具**（把 `const compactionVerified = Boolean(compactionEvidence)` 塞回去）断言检查器报违规。这样检查器本身也被测试，不是「写死通过」。
  3. 同步把同样的禁止规则扩展到 `scripts/check-evidence-hygiene.mjs`（扫描 `scripts/**.mjs`，跳过注释、`*.test.mjs`，以及规则实现文件 `scripts/lib/evidence-hygiene.mjs` 自身——它必然包含这些正则字面量，照抄现有 `STAMP_IMPL` 的豁免写法），作为夜间与本地 `ci-gate` 的第二层；但**PR 级的保证以 vitest wiring 测试为准**，因为卫生脚本不在 `ci.yml`。

### D2.1 · 阶段证据字段（派生函数入参契约）

派生函数不读文件，所以清单需要的每一项都必须先由 e2e 落盘。两份阶段证据文件扩展如下（字段名即契约）：

**`compaction-evidence.json`（v2）**

| 字段 | 类型 | 用途 / 采集方式 |
|---|---|---|
| `schemaVersion` | `2` | 版本标记 |
| `attempted` | boolean | 压缩块是否被调用 |
| `blockedReason` | `'MODEL_UNREACHABLE' \| null` | 环境阻塞原因（见 D6） |
| `volumeNodeId` / `volumeEndChapter` | string / number | 定位 |
| `result` | `{ summary, compactedFactIds, idempotentReplay } \| null` | `executeVolumeCompaction` 返回值 |
| `candidateFactIds` | `string[]` | 压缩前用 `readNarrativeSnapshot` + `planVolumeCompaction`（kernel 已导出）算出的候选集；用于区分「空候选」与「有候选但没折叠」 |
| `outline` | `{ volumeSummary, compactedAt, revision } \| null` | 压缩后用 `findVolumeOutline`（`packages/data-plane/src/compaction.ts:101`）读回 |
| `factRowChecks` | `{ factId, beforeRevision, afterRevision, compactedIntoVolumeId }[]` | 压缩前后各取一次 `readNarrativeSnapshot`，逐候选比对 |
| `eventLedgerDelta` | `{ volumeCompactedCount, factIds }` | 压缩前后读事件账本，取新增的 `VOLUME_COMPACTED` 条数与 `factIds` |
| `recallCheck` | `{ chapter, foldedFactIdsReturned: string[] }` | 压缩后用 `queryActiveFacts`（`packages/data-plane/src/narrative-state.ts:129`）查询 `chapter = volumeEndChapter`、`pov = 'protagonist'`（与既有单测同口径）；`foldedFactIdsReturned` 必须为空 |

**`genre-preset-verification.json`（v2）**

| 字段 | 类型 | 用途 / 采集方式 |
|---|---|---|
| `schemaVersion` | `2` | 版本标记 |
| `attempted` | boolean | 是否调用了 `/api/genre-kit.apply` |
| `blockedReason` | `'SERVER_UNREACHABLE' \| null` | 环境阻塞原因 |
| `kitId` / `expectedFiles` | string / `string[]` | 流派包 id 与 5 个目标文件。**`expectedFiles` 必须来自 `@mozhou/data-plane` 新导出的常量**（把 `genre-kits.ts:155-179` 里写死的 5 个路径提成 `GENRE_KIT_TARGET_PATHS` 并导出），e2e 直接引用；**不得**用首度应用响应的 `appliedFiles ∪ skippedFiles` 反推——那会让「覆盖全部 5 项」变成同义反复，也**不得**在 e2e 里再硬编码一份（两个真源必然漂移） |
| `preexistingFiles` | `string[]` | 首度应用前已存在的目标文件 |
| `firstApply` | `{ ok, appliedFiles, skippedFiles }` | 首度应用响应 |
| `secondApply` | `{ ok, appliedCount, skippedCount, appliedFiles, skippedFiles }` | 二度应用响应 |
| `fileChecks` | `{ path, exists, nonEmpty, hasKitMarker }[]` | 逐文件读盘校验；`hasKitMarker` = 含流派名 / `goldenFinger` / `coreRule` 之一 |
| `manifestCheck` | `{ registeredPaths, missingFromBaseline, preexistingAbsorbedIntoBaseline }` | 应用前后读 Manifest；`preexistingAbsorbedIntoBaseline` 必须为空 |

这些字段全部可由 e2e 现有能力采集，**不需要改 `executeVolumeCompaction` / `applyGenreKitToBook` 的返回契约**（A7 = 不进能力层契约）。

### D3 · 卷压缩：先分类，再跑清单

**分类顺序（写死，避免 D3 与 A2/A3 互相矛盾）**：

1. `attempted === false`（章节流程没走到压缩里程碑）→ `not_run`。
2. `blockedReason !== null` → `blocked`。
3. `result === null`（压缩已调用但抛了领域错误，例如 `VolumeSummaryValidationError`，`packages/kernel/src/compaction.ts:293`）→ `failed`，`failureCodes: ['COMPACTION_RESULT_MISSING']`。**必须在这一步短路**：后续步骤直接解引用 `result.*`，null 会在进入清单前抛 TypeError，派生函数就产不出 `failed`。
4. `result.idempotentReplay === true` 且 `result.compactedFactIds.length === 0` → `not_run`（幂等回放，本轮零折叠；A2）。
5. `candidateFactIds.length === 0`（空候选，摘要为空）→ `not_run`（A3）。
6. 否则跑清单；任一不满足 → `failed`；全部满足 → `verified`。

**`verified` 的必要条件**（全部满足）：

1. `outline.volumeSummary` 非空，`outline.compactedAt` 非空。
2. `candidateFactIds` 中每个事实的 `factRowChecks` 条目满足：`compactedIntoVolumeId === volumeNodeId`，且 `afterRevision > beforeRevision`。
3. `eventLedgerDelta.volumeCompactedCount === 1`，且 `eventLedgerDelta.factIds` 与 `result.compactedFactIds` 集合相等。
4. `recallCheck.foldedFactIdsReturned` 为空。
5. 不存在「本轮之前已记录的 verified 证据」这一豁免：**无跨轮继承**。历史证据不得替代本轮判定，也不存在 `verified_by_prior` 取值。

删除第一轮 D3 的旧 item 5（凭 prior verified 证据放行幂等回放）：它与 A2、与「不重新判定历史证据」都冲突，且会把旧语义的 `PASS` 重新当成通过依据。

### D4 · 题材预设：先分类，再跑清单

**分类顺序**：

1. `attempted === false` → `not_run`。
2. `blockedReason !== null` → `blocked`。
3. `firstApply.appliedFiles.length === 0` 且 `preexistingFiles` 覆盖全部 `expectedFiles` → `not_run`（本轮没有注入；A4）。
4. 否则跑清单；任一不满足 → `failed`；全部满足 → `verified`（A5：部分写入可以 `verified`，但必须逐文件通过内容与基线检查）。

**`verified` 的必要条件**：

1. `firstApply.ok === true`。
2. `firstApply.appliedFiles ∪ preexistingFiles` 覆盖 `expectedFiles` 全部 5 项。
3. 每个 `expectedFiles` 项在 `fileChecks` 中 `exists === true`、`nonEmpty === true`、`hasKitMarker === true`。
4. 每个**本轮写入**的文件出现在 `manifestCheck.registeredPaths` 中；`missingFromBaseline` 为空。
5. `secondApply.appliedCount === 0`，且 `secondApply.skippedFiles` 覆盖 `expectedFiles` 全部 5 项。
6. `manifestCheck.preexistingAbsorbedIntoBaseline` 为空（作者既有文件未被吸进基线）。

### D5 · 失败门接线

- 长篇 e2e：调用派生函数后，按返回的 `status` 设置退出码（PASS 0 / FAIL 1 / BLOCKED 2），并把 `failureCodes`、`verdictFailures`、两个 outcome、两个布尔、`evidenceSchemaVersion` 写入 `summary.json`。
- 证据卫生：按 D1 的兼容表消费 outcome 与投影；`status=PASS` 才做「成功声明」矛盾检查，投影一致性检查对任意 status 生效。
- 夜间 job：保持「e2e 失败即 job 红 + 证据仍上传」。
- PR 级：
  - 派生纯函数单测（`packages/benchmark/src/**/*.test.ts`）→ `pnpm run test:coverage:packages` → `.github/workflows/ci.yml:43`。
  - wiring 检查器测试（同目录）→ 同上。
  - 证据卫生扫描器测试（`scripts/lib/**/*.test.mjs`，需扩展 `vitest.config.ts:6` 的 include）→ 根 vitest → 同上。
- 实现顺序：先改 `docs/gates.md` 的「31 章长程验收」「证据脚本卫生」两行（项目规则要求先改门表再改脚本），再改脚本与测试。本规格只写决策，不代替该步骤。

### D6 · `blocked` 的生产者、失败后行为与整体优先级

**错误分类**（e2e 的模型适配器必须显式区分，当前 `res.ok` 未检查，见 `scripts/verify-longform-e2e.mjs:866-892`）：

| 错误 | 分类 | 阶段 outcome |
|---|---|---|
| `fetch` 网络错误、超时、HTTP 401/403/429/5xx | 环境不可达 | `blocked`，`blockedReason='MODEL_UNREACHABLE'` |
| 摘要为空 / 超字数 / 缺 subject（`VolumeSummaryValidationError`，`packages/kernel/src/compaction.ts:293`） | 领域失败 | `failed` |
| `/api/genre-kit.apply` 连接失败 / 5xx | 环境不可达 | `blocked`，`blockedReason='SERVER_UNREACHABLE'` |
| 流派应用返回业务错误（`ok:false`） | 领域失败 | `failed` |

**失败后是否继续**：**不继续**。压缩发生在第 15 章，后续章节仍需同一模型端点；环境不可达时继续只会制造更多噪声。e2e 在阶段处捕获、写阶段证据与 `summary.json`、然后中止：

- `failed` → `status=FAIL`，退出码 1；
- `blocked` → `status=BLOCKED`，退出码 2；
- 未到达的阶段记 `attempted:false` → 派生为 `not_run`。

**整体状态优先级**（派生函数写死）：`failed` > `blocked` > `not_run` > `verified`。

- 任一 `failed` → `FAIL`（退出码 1）；
- 否则任一 `blocked` → `BLOCKED`（退出码 2）；
- 否则任一 `not_run` → `FAIL`（退出码 1）；
- 否则 `PASS`（退出码 0）。

**`restart` 必须是三态，不能只是一个布尔**：压缩在第 15 章的章节循环内（`scripts/verify-longform-e2e.mjs:897`），重启一致性检查在循环之后（`:991`）。压缩 `blocked` 时 e2e 中止，restart 从未执行——此时传 `false` 会派生 `FAIL`（退出码 1），与上面「blocked → BLOCKED，退出码 2」冲突；传 `true` 则是虚假声明。

因此派生函数的输入定为 `restart: { attempted: boolean; consistent: boolean }`：

| `restart.attempted` | 处理 |
|---|---|
| `false`（未执行） | **不参与失败优先级**：既不升到 `failed`，也不作为 `PASS` 的必要条件；`status` 由其它阶段决定，`summary.json` 仍写 `restartConsistent: false` 并在 `failureCodes` 里附 `RESTART_NOT_RUN` |
| `true` 且 `consistent === false` | 参与优先级：`status=FAIL`，`failureCodes` 含 `RESTART_INCONSISTENT` |
| `true` 且 `consistent === true` | `status=PASS` 的必要条件之一（与 D1 的 v2 规则一致） |

`summary.json` 的 `restartConsistent` 字段保持布尔（既有契约不变），三态只存在于派生函数的入参与 `RESTART_NOT_RUN` 机器码里。

这样 `blocked` 有真实生产者、与整体 `BLOCKED` 不再冲突，且四值枚举没有不可达值。**preflight 探针失败**（`scripts/verify-longform-e2e.mjs:570-580`）保持现状并补版本字段：写 `evidenceSchemaVersion:2`、`status=BLOCKED`、不写 outcome、`failureCodes:[]`、exit 2；门允许 BLOCKED 记录缺少 outcome（它没有任何单项声明）。

**未分类异常**：`main().catch`（`scripts/verify-longform-e2e.mjs:1124-1127`）当前只 `exit 1`、不写 `summary.json`，会让证据卫生门看不到这次失败。规格要求：证据目录已创建时，顶层 catch 必须写一条**完整的 v2 记录**再退出：

| 字段 | 值 |
|---|---|
| `evidenceSchemaVersion` | `2` |
| `status` | `FAIL` |
| `compactionOutcome` / `genrePresetOutcome` | 均为 `not_run` |
| `compactionVerified` / `genrePresetVerified` | 均为 `false`（由 `not_run` 投影而来，满足投影一致性） |
| `restartConsistent` | `false` |
| `failureCodes` | `['HARNESS_FATAL']`（可分类时再附具体码） |
| `verdictFailures` | 与 `failureCodes` 同源生成 |

这样既不违反 D1「v2 的 status=FAIL 必须同时有 outcome」，也不会制造一条缺字段、只能靠省略伪装成 v1 的记录。门的处理：`status=FAIL` 只要求 `failureCodes` 非空，`HARNESS_FATAL` 天然满足；投影一致性照常检查。证据目录未创建时至少打印机器码并非零退出。

### D7 · 证据卫生门的可测性（root 注入）

当前 `check-evidence-hygiene.mjs` 把 `root` 固定为脚本上级目录（`:30`）、`evidenceRoot` 固定为 `evidence/longform-journey`（`:100`），全文无 `process.argv` / `process.env`（grep 无命中）。测试无法构造临时证据目录，只能污染真实 `evidence/`，会被门自己扫到。

决策：

- 把两条扫描（脚本卫生 + 证据记录卫生）抽成**接受 `root` 参数的纯函数**，放在 `scripts/lib/evidence-hygiene.mjs`；CLI 仍以仓库根调用，默认行为不变。
- 测试 `scripts/lib/evidence-hygiene.test.mjs` 用 `mkdtempSync(join(tmpdir(), ...))` 构造临时证据树，直接断言违规列表；**不得写真实 `evidence/` 目录**。
- 扩展 `vitest.config.ts:6` 的 `include` 为 `['packages/*/src/**/*.test.ts', 'scripts/lib/**/*.test.mjs']`；coverage 的 `include` 仍只含 `packages/*/src/**/*.ts`（门脚本不是产品源码，不计入覆盖率分母）。
- 静态禁止规则（D2 的 forbidden patterns）也放进这个 lib，CLI 与测试共用同一实现，避免「测试测一份、门跑另一份」。

### D8 · 不写入作者数据

- 不写 `book.json`、Manifest、frontmatter、SQLite 投影。
- 不新增路由响应字段；`/api/genre-kit.apply` 的响应形状保持不变。
- 不新增 UI 状态。

## Testing Decisions

### 什么算好测试

- 只断言**外部可观察结果**：`status`、退出码、`summary.json` 字段、失败机器码、wiring 违规列表。
- 不断言中文日志文案、不断言内部变量名。
- 注入点必须是纯函数入参，而不是改源码常量或 mock 文件系统；wiring 检查器的输入是源码字符串，同样是纯函数入参。
- 变异测试：wiring 检查器必须用「故意写回旧语义的源码」证明会红；证据卫生扫描器必须用「临时目录里的坏证据」证明会红。

### 测试分层与接缝

**接缝 1（判定）**：派生纯函数。被 e2e 与单测共同引用。
**接缝 2（接线）**：wiring 检查器纯函数。输入 e2e 源码，输出违规；测试用真实源码与变异源码各跑一次。
**接缝 3（证据门）**：证据卫生扫描纯函数。输入注入的 root。

| 层 | 用例 | 运行位置 | 是否需要凭据 |
|---|---|---|---|
| 派生纯函数单测 | 注入 `failed` / `not_run` / `blocked` / 全 `verified` / 空候选 / 幂等回放 / 首度 0 写入，断言 `status`、退出码语义与机器码 | `pnpm run test:coverage:packages`（`.github/workflows/ci.yml:43`） | 否 |
| wiring 测试 | 真实 e2e 源码零违规；变异源码（含 `Boolean(compactionEvidence)`、缺少导入、缺少 outcome 写入）逐条报违规 | 同上 | 否 |
| 证据卫生扫描器测试 | 临时目录构造 v2 PASS + outcome failed + verified true（投影矛盾）、v2 PASS + outcome failed、v2 FAIL + 诚实 false、v1 legacy PASS、v1 legacy PASS + false、半新半旧，断言违规列表 | 根 vitest（`.github/workflows/ci.yml:43`，需扩展 include） | 否 |
| 能力层单测（既有） | 压缩 5 个门、流派包 4 个门、召回过滤（`packages/data-plane/src/compaction.test.ts:297-320`） | `pnpm run test:coverage:packages`（本地 `pnpm test` 同样覆盖） | 否 |
| 长程 e2e | 真实 31 章，产出真实 outcome | 夜间 / 手动 | 是 |

### 先例（prior art）

- `packages/data-plane/src/compaction.test.ts`：门 1–5 已覆盖未完结拒绝、卷不存在、失败零副作用、原子落盘、幂等、召回过滤。派生层单测应复用同一套「构造事实 → 断言外部结果」的写法。
- `packages/data-plane/src/genre-kits.test.ts`：已覆盖首度 5 文件写入 + 基线登记、重复应用不覆盖作者内容、作者内容不吸基线、未知流派包抛错。派生层单测可直接复用这些事实形状。
- `scripts/check-evidence-hygiene.mjs` 的 `status=PASS` 矛盾扫描：是「证据自相矛盾」类门的现成先例。
- `scripts/verify-real-model-journey.mjs` 的 `BLOCKED` 三态：是「阻塞不等于失败也不等于通过」的现成先例。

### 必须覆盖的负例（故障注入实验的正式化）

1. `compactionOutcome=failed` + 其余 `verified` → `status=FAIL`，含 `COMPACTION_NOT_VERIFIED`。
2. `genrePresetOutcome=failed` + 其余 `verified` → `status=FAIL`，含 `GENRE_PRESET_NOT_VERIFIED`。
3. 两者 `failed` → `status=FAIL`，两个机器码都在。
4. `compactionOutcome=not_run` → `status=FAIL`，含 `COMPACTION_NOT_RUN`。
5. `compactionOutcome=blocked` + `genrePresetOutcome=not_run` → `status=BLOCKED`（退出码 2），含 `COMPACTION_BLOCKED`；**不得** PASS。
6. 全 `verified` 且 restart 一致 → `status=PASS`，`failureCodes` 为空。
7. v2 证据：`status=PASS` + `compactionOutcome=failed` + `compactionVerified=true` → 卫生门违规（投影不一致 + PASS 要求 outcome=verified）。
8. v2 证据：`status=PASS` + `compactionOutcome=failed` + `compactionVerified=false` → 卫生门违规（PASS 要求 outcome=verified）。
9. v2 证据：`status=FAIL` + `compactionOutcome=failed` + `compactionVerified=false` + `failureCodes` 非空 → 卫生门干净（不误报诚实失败）。
10. v1 证据：`status=PASS` + 三布尔 true + 无 outcome → 卫生门干净，但输出 legacy 警告。
11. v1 证据：`status=PASS` + `compactionVerified=false` → 卫生门违规（现行规则）。
12. v2 证据缺 `compactionOutcome`，或 outcome 为非法值 → 卫生门违规。
13. v2 证据：`status=BLOCKED` + 两项 outcome 都为 `verified` → 卫生门违规（状态与字段矛盾）。
14. 空候选压缩（摘要为空）→ `not_run`，**不得** `verified`。
15. 幂等回放且本轮零折叠 → `not_run`，**不得** `verified`（不存在 `verified_by_prior`）。
16. 首度流派应用 0 写入（全部已存在）→ `not_run`，**不得** `verified`。
17. wiring：真实 e2e 源码通过；变异源码分别注入 `Boolean(compactionEvidence)`、删除派生函数导入、删除 `failureCodes` 写入，检查器各报一条违规。

## 待作者拍板

> 以下每一条都会改变实现与验收结果；未拍板前不实现。

| 编号 | 决策点 | 选项 | 规格建议 |
|---|---|---|---|
| **A1** | 字段命名 | (a) 保留 `compactionVerified` / `genrePresetVerified` + 新增 outcome 枚举 + schema 版本；(b) 改名为 `compactionAccepted` / `genrePresetAccepted`；(c) 只保留布尔，不加枚举 | (a) |
| **A2** | 幂等回放（`idempotentReplay=true` 且本轮零折叠）算什么 | (a) `verified`（视为「历史已验证」）；(b) 新值 `verified_by_prior`；(c) `not_run`；(d) `failed` | (c) `not_run`；与 D3 分类顺序第 3 步一致，且不引入跨轮继承 |
| **A3** | 空候选压缩（摘要为空）算什么 | (a) `not_run`；(b) `failed` | (a) `not_run`；与 D3 分类顺序第 4 步一致 |
| **A4** | 流派包首度应用 0 写入（5 个文件全部已存在）算什么 | (a) `not_run`；(b) `verified`（「已存在即合格」）；(c) `failed` | (a) `not_run` |
| **A5** | 流派包首度应用「部分写入、部分跳过」算什么 | (a) 缺失文件补齐且逐文件校验通过即 `verified`；(b) 一律 `failed` | (a)，但必须逐文件校验内容与基线（D4 清单） |
| **A6** | `not_run` / `blocked` 在长程验收里如何影响整体状态 | (a) `not_run` → FAIL（退出码 1），`blocked` → 整体 BLOCKED（退出码 2）；(b) 两者都 FAIL；(c) 两者都 BLOCKED | (a)；与 D6 优先级一致，两者都不是 PASS |
| **A7** | 验证结论是否进入能力层契约（`executeVolumeCompaction` / `applyGenreKitToBook` 返回值） | (a) 不进，保持数据面契约冻结；(b) 进，作为 Contract Delta | (a) |
| **A8** | 发布门是否要求「近期一次长程 PASS」 | (a) 不要求；(b) 要求 7 天内；(c) 要求 30 天内 | (a)，并在发布清单里显式写明「未跑长程」 |
| **A9** | 作者侧是否需要可见面 | (a) 无；(b) 只读诊断入口；(c) 阻断式提示 | (a) |
| **A10** | 两个标志是否对所有长篇运行都是必需项 | (a) 是（当前第 15 章压缩与流派应用都无条件执行）；(b) 仅当对应里程碑被触发时才必需 | (a)，与现状一致 |

## Out of Scope

- 实现上述任何代码、脚本或测试；本文件只产出规格。
- 修改 `packages/data-plane/src/compaction.ts` 或 `genre-kits.ts` 的算法与返回契约。
- 修改 `/api/genre-kit.apply` 路由响应或 UI。
- 重写或重新判定历史证据（两份假 PASS 已由作废记录处理；旧语义 PASS 也不重新裁决）。
- 真实 31 章长程复跑（需要模型凭据与费用）。
- 压缩/流派包本身的正确性算法（候选筛选规则、摘要机检阈值、流派包内容）。
- 动态扫描给出的 CSP / Permissions-Policy / 404 Content-Type / ZAP 稳定性与版本问题：与本次规格无关，不在本文件处理范围。

## Further Notes

### 与 `docs/gates.md` 的关系

`docs/gates.md` 的铁律是「BLOCKED 不是 PASSED」，并要求消费门时优先读 `status` 字段而不是退出码。本规格把这条铁律下沉到单项证据：布尔字段只能表达「通过/未通过」，无法表达「没跑成」；新增 outcome 枚举是为了让证据本身可被机器区分，而不是靠读日志。实现阶段必须先更新 `docs/gates.md` 的「31 章长程验收」「证据脚本卫生」两行，再改脚本。

### 与证据卫生门的关系

`check-evidence-hygiene` 当前只对 `status === 'PASS'` 的记录做矛盾检查（`:113` 附近）。这是正确方向：`status=FAIL` + 标志 false 是诚实失败，不应二次判红。本规格保持这个边界，但把 PASS 检查从「三个布尔」扩展为「outcome + 投影 + failureCodes 自洽」，并增加 v1/v2 兼容规则（D1）。门本身必须可注入 root 才能被测试（D7），否则测试只能写真实证据目录。

### 与历史证据、作废记录的关系

- `docs/audit/longform-evidence-invalidation-20261017.md` 已把两份 `PASS` + `compactionVerified:false` 的证据改名为 `summary.invalidated.json`。
- `evidence/longform-journey/2026-10-06T13-48-19-681Z/summary.json` 仍是 `status=PASS`、`compactionVerified=true`、`genrePresetVerified=true`，但它是旧语义（`Boolean(evidence)` + `idempotentPass`）的产物，且没有 outcome 与清单字段。本规格把它归为 **v1 历史证据**：门可以继续按旧规则扫描，但**不得**把它当成新语义的通过基线，也不为它补写 outcome。历史证据不重新判定，也不跨轮继承（D3 已删除旧 item 5）。

### 已知但未在本规格解决的缺口

- 夜间 job 的 e2e 步骤失败后，证据卫生步骤仍以 `if: always()` 运行；这是有意的（保留诊断），但意味着「job 红」可能来自 e2e 而非卫生门。规格要求 job summary 点名失败步骤，实现阶段确认。
- 长篇 e2e 的 `restartConsistent` 已有独立派生，不在本规格范围；D5 的失败门清单保持三项并列，避免只接两个而漏掉第三个。
- 本规格不主张把这两个标志接入 PR 的完整长程运行；PR 级只跑派生函数、wiring 与扫描器单测，真实长程仍在夜间。
- `journey-ledger.md` 当前有一行「长程召回剪枝成功」是**未派生的固定文案**（`scripts/verify-longform-e2e.mjs:1066`）。D3 要求 `recallCheck` 落盘后，台账行必须由 `recallCheck.foldedFactIdsReturned.length === 0` 派生；这是实现阶段必须一并修正的「声明与证据不一致」点。

### 证据锚点（本次实读）

| 结论 | 锚点 |
|---|---|
| 两个标志在 HEAD 存在并进入通过条件 | `scripts/verify-longform-e2e.mjs:1038-1043` |
| 两个标志写入 `summary.json` | `scripts/verify-longform-e2e.mjs:1093,1096` |
| `verdictFailures` 是 `string[]` 并被 `join('；')` 打日志 | `scripts/verify-longform-e2e.mjs:1097,1107` |
| 证据卫生门只读三个布尔 | `scripts/check-evidence-hygiene.mjs:113` |
| 证据卫生门 root 固定、无 argv/env | `scripts/check-evidence-hygiene.mjs:30,100`（全文 grep 无 `process.argv`/`process.env`） |
| 压缩证据落盘字段 | `scripts/verify-longform-e2e.mjs:904-912`、`:1077-1079` |
| 流派证据落盘字段 | `scripts/verify-longform-e2e.mjs:1024-1029` |
| 幂等回放返回零折叠 | `packages/data-plane/src/compaction.ts:233-243` |
| 空候选返回空摘要 | `packages/kernel/src/compaction.ts:270-278` |
| 空候选仍写大纲与事件 | `packages/data-plane/src/compaction.ts:252-298` |
| 摘要校验失败抛错 | `packages/kernel/src/compaction.ts:293` |
| preflight 失败直接 BLOCKED + exit 2 | `scripts/verify-longform-e2e.mjs:570-580` |
| 顶层 catch 只 exit 1、不写 summary | `scripts/verify-longform-e2e.mjs:1124-1127` |
| 流派幂等判定只看二度应用计数 | `scripts/verify-longform-e2e.mjs:1027` |
| 流派返回形状无验证字段 | `packages/data-plane/src/genre-kits.ts:112-119` |
| 可读回卷大纲 | `packages/data-plane/src/compaction.ts:101`（`findVolumeOutline`） |
| 可做召回探针 | `packages/data-plane/src/narrative-state.ts:129`（`queryActiveFacts`） |
| 可算候选集 | `packages/kernel/src/compaction.ts:87`（`planVolumeCompaction`，经 `packages/kernel/src/index.ts:8` 导出） |
| CI 不跑根 `pnpm test`，跑 `test:coverage:packages` / `test:coverage:web` | `.github/workflows/ci.yml:40-43,51-52` |
| vitest include 只覆盖 `packages/*/src/**/*.test.ts` | `vitest.config.ts:6` |
| 夜间 job 先 e2e 后卫生 | `.github/workflows/longform-nightly.yml` |
| 作废记录与边界 | `docs/audit/longform-evidence-invalidation-20261017.md` |
| 旧语义 PASS 证据 | `evidence/longform-journey/2026-10-06T13-48-19-681Z/summary.json` |
| BLOCKED ≠ PASSED 铁律 | `docs/gates.md` 开篇 |
