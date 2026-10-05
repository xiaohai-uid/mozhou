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
