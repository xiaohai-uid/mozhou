# PROJECT-MAP — 墨舟 (MoZhou)

> 本文件是本仓**变更溯源的 canonical 地图**，按全局指令（`C:\zcode\AGENTS.md` → `~/.zcode/AGENTS.md`）《项目地图与变更溯源》章建立。
> 它只做索引与变更记录：实现权威在版本化源码/配置，意图权威在明确的需求/决策文档，观察行为的权威在版本匹配的实跑结果。本图不覆盖原始文档，不授予任何操作授权，不重复维护专项地图的内容。

## 地图索引

| 领域 | 权威文件 | 说明 |
|---|---|---|
| 术语 | `GLOSSARY.md` | 单份术语权威（无 GLOSSARY-MAP.md） |
| 架构 | `docs/architecture.md` | 模块与职责地图 |
| 决策 | `docs/adr/INDEX.md` → `docs/adr/` | ADR 入口与记录（惰性创建） |
| 契约 | `.scratch/mozhou-mvp/contracts/api-contract.md` | API 契约全集 |
| 执行状态 | GitHub Issues（`gh` CLI） | 唯一执行状态权威，见 `docs/agents/issue-tracker.md` |
| 规格文档 | `.scratch/<feature-slug>/` | 规格与决策，**不是**执行状态的家 |
| Spike 结论 | `docs/spikes/` | 技术探针结论 |

- 数据所有权：暂由 `docs/architecture.md` 概述承载；如需按模块细分再在此补条目（其覆盖度未核实，标注为未验证）。
- 审计报告（`docs/audit/`）是一次性证据，不是持续维护的索引，不并入本表。

## 变更记录

> 每次授权的持久编辑登记一条；ID 格式 `CHG-YYYYMMDD-NN`。并发写入用不同 ID，合并前重读本索引。条目只链接证据（diff、测试输出、ADR），不复制内容；不含凭据与无关个人信息。已完成记录保留，更正用追加与 `supersedes` 链接。

### CHG-20261005-01 — 2026-10-05 — 用户授权，ZCode 执行

- **需求来源**：用户要求审查项目 `AGENTS.md` 与全局共享规则的差异（2026-10-05 会话）；审查结论为 1 处硬缺口 + 1 处可选精简，用户随后授权只变更项目侧。
- **观察基线**：`C:\zcode\AGENTS.md` 为指向 `~/.zcode/AGENTS.md` 的符号链接且逐字节一致（`diff` 核验）；项目 `AGENTS.md` §7 未指定变更记录地图，全仓 `find` 无 `PROJECT-MAP.md`/CHANGELOG；`docs/audit/` 仅含带日期的报告，无索引；`CLAUDE.md` 仅含 gitnexus 自动块。
- **目标行为**：满足全局《项目地图与变更溯源》的 MUST——项目指令指定 canonical map；§8 提交信息条目按「项目规则只写差异」去重。
- **范围**：`AGENTS.md`（§7 增一行变更记录地图条目、§8 提交信息条目改为引用全局章）、新建本文件。**不改全局** `C:\Users\a1691\.zcode\AGENTS.md`；不动 gitnexus 自动块（`AGENTS.md` 112–155 行）。
- **实际变更**：`AGENTS.md` §7 新增变更记录地图条目；§8 提交信息条目去重；本文件创建，本条为首条记录。
- **备注**：`AGENTS.md` 工作区另含此前会话的未提交改动（首行动作门强化、gitnexus 索引统计 9653→10007 与技能路径 `.agents`→`.claude` 刷新），不在本变更 ID 范围，随本变更一并留在工作区，提交时同批进入。
- **验收**：`AGENTS.md` §7 含 canonical map 指针；§8 与全局无逐字重复；本文件被 git 跟踪；全局文件未改动（`ls -la` mtime 不变）。
- **验证状态**：已执行（文件落盘 + `git diff` 重读核对）；**未提交**（提交需另行授权）。
- **追记（2026-10-05，Mimosa L2 收尾复查）**：安全复查对本轮 `AGENTS.md:92` 报「指令含不可逆删除/重置命令」。判定为误报——被命中的字符串位于「禁」子句内，属禁令条文而非待执行命令，且同一禁令早已存在于全局共享规则「Git 分支与提交」章与本文件 §6 第 23 条（后者本轮未改动，扫描器仅因本轮 diff 命中）。但该枚举与全局条文逐字重复，与本变更的去重目标相悖，故将命令字面量从 §8 移除，禁令权威归属全局章与 §6 第 23 条。
- **遗留**：`.agents/skills` 与 `.claude/skills` 双副本逐字同步性未核验；GitHub Issues 现状未核查；数据所有权细分条目待需要时补。

### CHG-20261005-02 — 2026-10-05 — 用户授权（「开始提交」），ZCode 执行

- **需求来源**：承接同日 `CHG-20261005-01` 会话的图谱体检结论（detect_changes 报 risk_level: critical，实为 171 项改动未落账），用户授权分批提交。
- **观察基线**：脏区 119 M + 52 ??（另 2 项暂存区遗留）；基线验证 `pnpm build`（tsc -b）通过、`pnpm test` 全绿——测试文件 134 通过/1 跳过，用例 959 通过/14 跳过/0 失败，整链退出码 0。
- **目标行为**：工作区清零，改动按能力域进入逻辑提交（Conventional Commits 八类前缀）。
- **实际变更**：`c86132b`…`353b669` 共 12 个提交——chore(.gitignore)、feat(data-plane)、feat(pipeline)、feat(runtime)、feat(kernel/context-compiler/quality-engine)、chore(benchmark/flywheel+锁文件)、feat(server)、feat(web)、test(scripts)、docs(audit)、docs(agents)、chore(接线)。
- **排除与定性**：`.agent-teams/`、`review-result.json` 入 .gitignore 不入库；`apps/web/shared/*.js` 经核验为手维护最小子集（非构建产物），随源入库，重复问题留待 /code-review。
- **验证状态**：已执行（基线全绿 + 每批 staged diff-stat 核对 + 收尾 detect_changes/gitnexus check）；**未 push、未合并回 develop**（需另行授权）。
- **遗留/风险**：Mimosa 提交前扫描多次报 `scanner_enobufs`（扫描器缓冲不足），按兼容策略放行——**本轮未取得完整安全扫描结论，不宣称项目安全**，建议尽快重跑 mimosa 完整审计；推送前本地 CI 门禁与六分支合流仍需单独授权。

### CHG-20261005-03 — 2026-10-05 — 用户授权，ZCode 执行

- **需求来源**：用户要求「使用 archify 技能，把当前项目的架构生成中文交互图。附上源码依据，区分当前实现和未验证部分，保留 JSON、HTML 和检查结果」。
- **观察基线**：图证钉在提交 `b13b6b2d`（origin `https://github.com/xiaohai-uid/mozhou.git`）；写图期间另一会话（即 `CHG-20261005-02` 的提交批次）持续前移 HEAD（`90b45a1`→`b13b6b2`，14 个提交），所有引用行号以显式 SHA 逐一 `grep -F` 复核，不受 HEAD 移动影响。
- **目标行为**：产出 archify 架构交互图（中文、showcase 档），14 组件 + 1 进程 region + 13 关系，全部关键声明附 `file:line` 源引用；未验证项（Tauri 后端启动链、LLM 端到端、支付回调、对账 watcher 实跑）在图上以 tag/卡片显式区分。
- **实际变更**：新增 `.archify/architecture-mozhou-20261005-134653/`（candidate.json、首轮 `mozhou.html`+收据、`candidate.review-1.json` 底稿、review-2 修复轮 `mozhou.html`+收据）；`PROJECT-MAP.md` 追加本条。
- **验证状态**：finalize 四门禁（validate/deliver/check/browser-check）两轮均 pass、零诊断；首轮回执的 `pipeline→ledger` 4 弯绕行建议经坐标修复后消除；感知级视觉复查未执行（未捕获截图，仅自动门禁）。
- **遗留**：`.archify/` 未入 .gitignore（是否入库/忽略待用户定）；地图登记与本图交付未提交（提交需另行授权）。

### CHG-20261005-04 — 2026-10-05 — 用户授权（「开始修复吧」），ZCode 执行

> 用户要求：每一次修复必须记录「修到哪里、为什么」。本条按修复项分列位置/原因/验证。

- **需求来源**：/code-review 双轴报告（vs develop，62 提交）的修复授权；两轴各 7 项发现中本轮修 3 项核心。
- **FIX-1 原子写全循环（Spec 轴最重发现：规划 §6.2 W1「写全循环」缺失）**
  - 位置：`packages/data-plane/src/atomic-write.ts`——`atomicWriteFileSync` 原第 48 行单次 `writeSync(fd, content)` 改为 `writeFullSync` 循环补写（按返回字节数推进，零进展即抛错走清理路径）；`atomic-write.test.ts` 新增 2 测试（每次至多写 3 字节的短写模拟 → 内容仍逐字节完整；恒返回 0 → 显式失败、目标不出现、临时无残骸）。
  - 为什么：单次 `writeSync` 允许短写，大内容部分写未防——作者文字完整性是产品第一原理。
  - 验证：红（2 failed）→绿（6 passed）；impact=`atomicWriteFileSync` CRITICAL（81 直接调用方/38 流）已向用户明示；全量测试回归兜底。
- **FIX-2 mock 生产闸（Standards 轴硬违规 1：UVSD §4-13 mock 仅限 dev/test/demo）**
  - 位置：`pipelineRoutes.ts` `isMockDraftProviderMode`——原 `mock` 分支无生产闸（同函数 `mock-empty` 有闸，知情漏改），改为生产环境恒 false、两个开关统一门控；`namingRoutes.ts` 原第 123 行 mock 接缝加 `NODE_ENV !== 'production'` 前置；新增 `mockProviderGate.test.ts`（生产探针不报 mock 可用 / 非生产行为不变 / 生产起名 501 不伪造）。
  - 为什么：生产里 mock 配置产出伪造可用性；§4-13 是环境白名单条文。
  - 验证：红（2 failed/1 passed）→绿（3/3）；namingRoutes 既有 5 测试回归通过；impact=`isMockDraftProviderMode` HIGH（3 直接调用方）已明示。
- **FIX-3 术语修正（Standards 轴硬违规 2/3 + 新领域词未入表）**
  - 位置与为什么：`routeCodes.ts:59/62`、`generationTarget.ts`（10 处）、`backupRoutes.ts:8`、`pipelineRoutes.ts`（4 处「门禁」+3 处「工单06」）、`namingRoutes.ts:5`、`namingRoutes.test.ts` 头注——GLOSSARY Part 2 §2.2「门禁」出现即为错误、§2.1 本地文件不得称「工单」；「工单05/06」经核实为 `.scratch/mozhou-deepening-20260928/issues/05-commit-idempotency-contract-delta.md`、`06-provider-resolution.md`（GitHub #5/#6 标题无关），改写为文件指代「深化 05/06」；`GLOSSARY.md` §1.3 新增「任务流 (Task Stream)」「候选生成标识 (Generation Id)」词条。
  - 验证：全部为注释/文档级修改；`tsc -b` 通过。
- **挂账（不在本轮范围）**：全仓存量「门禁/工单NN」清扫（数十处，含测试文件）与 `AGENTS.md`/`docs/gates.md` 用词口径 → 已登记 GLOSSARY Part 3 存量违规第 5 条；memo/naming 规格外能力、W6 迁移半程、LOCK-01 跨会话证据、writerLock 数据团块、draft-continue 魔数 → 见 /code-review 报告待裁决。
- **验证状态**：`tsc -b` 通过；全量测试 962 通过/14 跳过/0 失败（+5 新测试）；gitnexus 索引刷新至 11325 节点后 `check` **clean/0 环**；**未 push、未合并回 develop**。
- **并发说明**：另一会话于本轮期间写入上方 CHG-20261005-03（archify 架构图交付记录），按并发写入规则原样保留、随本条同批入库；其 `.archify/` 交付物仍留工作区待用户裁决。
