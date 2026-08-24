---
date: 2026-08-24
description: '工单 #32 产出：十步事务管线编排规格——ChapterProductionSession 单飞单 commit、Prepare 纯查询、Gate 纯机械、ProposalPort 统一确认面、九边界崩溃恢复矩阵、重提交全量重走，伪代码级（授权终审制成文）'
tags:
  - project-note
  - mozhou
---

# 十步事务管线编排规格（工单 #32 产出）

> 相关笔记：[[runtime-capability-spec]] · [[capability-recipe-schema-v1]] · [[dual-plane-sync-spec]] · [[t32-pipeline-question-kit]] · [[2026-08-24-wayfinder-phase-3-map]]
> 工单 [#32](https://github.com/xiaohai-uid/mozhou/issues/32) · 决策记录见 [ADR-0024](../adr/0024-chapter-pipeline-transactional-orchestration.md) · 前置：[#31](https://github.com/xiaohai-uid/mozhou/issues/31)（已关）
> 决策过程：**授权终审制**——题库（t32-pipeline-question-kit.md）全部按出题倾向成文，作者对全稿终审签署；任何单条否决走受控增补修订本文档

## 0. 一句话

**一章的生产 = 一个 ChapterProductionSession 的十步步进序列；每步转换是一条 Ledger 任务事件，当前步可从投影恢复；回环只由作者显式动作驱动；Commit 是唯一正典写入点。**

## 1. 十步总览

| # | 步 | 输入 | 输出 | 失败面 | 关键事件 |
|---|---|---|---|---|---|
| 1 | Prepare | chapterIndex | 章查询结果集（内存态） | 幂等查询，无失败面 | TaskStarted(step=prepare) |
| 2 | Compile | Prepare 结果集 | ContextPacket + Receipt | EmptyRecallError / ConvergenceError（穿透不降级） | ContextCompiled（已有） |
| 3 | Draft | Packet + recipe 实例 | 正文流 → `<书>/正文/**/第N章.md`（phase=draft） | provider 错误归一化；M17 三级降级 | GenerationStarted/Finished |
| 4 | Review | draft | 机械核检报告（旁路建议另列） | 无硬失败 | —— |
| 5 | User Edit | draft | 编辑 delta（结构化操作块） | 保护位校验 | UserEditRecorded |
| 6 | Final Extract | 终稿全文 | 五族候选 delta（运行期驻留） | 提取失败=failed_recoverable 重试 | CandidateDeltaExtracted |
| 7 | Continuity Gate | delta+终稿 | 通过 或 HARD_CONFLICT[] | 冲突清单进 Result 字段 | TaskStepTransitioned(gate) |
| 8 | Canon Proposal | 通过的 delta | riskClass 分流提案 | high 未确认=挂起 | CanonProposalCreated |
| 9 | Commit | 已确认提案集 | ChapterCommit 原子三件套 | pending-commit 双向恢复（T3 既有） | CanonCommitted |
| 10 | Flywheel Record | commit 事实 | 任务收尾事件+usage 投影 | 记账失败不阻断正文（state_degraded） | FlywheelRecorded |

## 2. 十二范围裁决正文

### S1 ChapterProductionSession

内存态运行时对象（会话态=投影的一种，无第三处真源）；**一 session ↔ 一 commit**；完成态单一事实源 = Ledger 中 `CanonCommitted` 事件的存在性（ANWA #90）。重提交 = 新 session。

### S2 Prepare

纯函数查询组合（章大纲节点+scenes+AuthorIntent+活跃承诺+stale 状态），不落盘。目标章大纲节点带 StaleMarker ⇒ **警告继续 + Receipt 留痕**（对账软门禁先例）。

### S3 Compile 衔接

复用 compile() 缝签名不变（A 芯纪律）；新增 taskType=`CHAPTER_DRAFTING` 在 #8 tier 表做受控增补行。

### S4 Draft / Review / User Edit 动作面

- M16 五级动作位 V1 实现**光标+选区两级**；面板/向导归 Phase 6
- UserEditRecorded 捕获**结构化编辑操作块**（非字符 diff）；人手外部编辑不受 I1 禁令（dual-plane Q10 先例）
- 多候选择优（ADR-0013）：accepted/rejected **必须落 Ledger** 方为有效飞轮信号

### S5 Continuity Gate 组成（M15 推论正式拍板）

**Gate = 纯机械核检**：M2 时间线单调 + 四族行校验 + POV 秘密零泄漏 + dependency 引用完整性（均已实现或为实现票机械项）。LLM 审查只许做**旁路建议**（独立可选调用，结论不入 Gate 判定）。`AutomatedReviewCompleted` 从 ADR-0007 词表删除（不留死事件）。Gate 失败输出 = Result 字段 `hardConflicts[] {factId, assertion, suggestion}`。

### S6 Canon Proposal 确认面

**ProposalPort 统一 API**：T5 对账门与管线提案共用同一确认协议（confirm/reject/editAccept，逐条粒度）。riskClass 分流：low 自动落 canon；**medium 进提案队列 API 挂起等待程序化确认**（headless 等价 panel）；high 必须显式确认方可进入 Commit。

### S7 回环与停止策略

- HARD_CONFLICT → 作者选「承认错误」改文 ⇒ **回炉 Final Extract 全量重提取**（一致性优先于增量成本）
- 循环**无自动迭代**：Extract↔Gate↔Edit 的每次循环都必须由作者显式动作驱动；无次数上限（有显式驱动即无失控）
- M17 三级降级可见性：一级协议档位选择静默（传输细节）；二级定向重生每次 attempt 记事件；三级人工模板兜底必须上报 failed_recoverable

### S8 崩溃恢复矩阵（九边界）

| 步边界 | 恢复语义 |
|---|---|
| Prepare 后 | 幂等重跑（纯查询） |
| Compile 后 | 按 receiptId 续（Receipt 已落盘，INV-R1/R2） |
| Draft 中 | **半稿持久保留**于正文文件（phase=draft 天然可写；#60 教训：每章落盘即持久），断流标 partial，作者选续写或重生成 |
| Review/Edit 中 | 编辑缓冲即时落正文文件 |
| Extract 后 | 候选 delta 运行期驻留，丢失可接受——重跑提取（dual-plane 分层表既有裁定） |
| Gate 后 | 确定性核检幂等重算 |
| Proposal 后 | 未确认提案投影悬挂标记，跨重启保持待决 |
| Commit 后 | T3 pending-commit 双向恢复（既有实现，不改） |
| Record 后 | 与 Commit 同事务序 append；仅 usage/cost 类派生记账允许异步回灌 |

### S9 重提交管线

相位移回 draft 后 **V1 全量重走十步**（简单且 I5 保证旧 commit 不变；增量优化留 V2）；重提交期间读取真相 = phase=committed 的最新 commitId。

### S10 watcher × S3 写前校验交互

管线在**步边界检查点**响应 EXTERNAL_MODIFIED（步内不打断，避免半步状态×对账叠加）；对账软门禁（警告不硬阻塞）适用于整条管线。

### S11 跨章并发

V1 **全局单飞**：同时最多一个活动 session（消灭一类并发 bug）；N+1 章放宽留 V2。

### S12 Flywheel Record 终版

事件链对齐：删 AutomatedReviewCompleted；其余沿 ADR-0007 七事件映射十步（§1 表右列）；usage/cost 记账允许异步回灌至 usage 投影表（§J.4 边界内）。Benchmark 六指标 L1 机械判定器**属本票交付**（否则 Phase 3 无法自证）；M14 Recipe↔Benchmark 版本矩阵钩子已就位（解析快照入 GenerationStarted）。

## 3. 裁决日志全录

| Q# | 议题 | 裁决 | 出处 |
|---|---|---|---|
| Q-A/Q1.1 | 会话形态 | A 内存态（会话态=投影） | 题库 §1 |
| Q1.2/Q1.3 | 一对一 commit/完成态事实源 | 一比一；CanonCommitted 存在性 | 题库 §1 |
| Q-B/Q2.1 | Prepare 形态 | A 纯函数结果集不落盘 | 题库 §2 |
| Q2.2 | stale 注入点 | 警告继续+Receipt 留痕 | 题库 §2 |
| Q-C/Q5.1 | Gate 纯机械 | A 是；死事件删除 | 题库 §5 |
| Q4.1-Q4.3 | 动作面/delta/多候选 | 两级起步；结构化操作块；择优选必落账 | 题库 §4 |
| Q6.1/Q6.2 | 三档契约/统一 API | medium 提案队列 API；ProposalPort 统一 | 题库 §6 |
| Q7.1-Q7.3 | 回环/上限/降级可见性 | 回炉全量提取；显式驱动无自动循环；一二三级=静默/记事件/必上报 | 题库 §7 |
| S8 矩阵 | 九边界恢复语义 | 见 §3 表 | 主会话按 #31 吸收语义成文 |
| Q9.1/Q9.2 | 重提交 | V1 全量重走；最新 committed 即真相 | 题库 §9 |
| Q10.1/Q10.2 | watcher×S3 | 步边界检查点挂起；软门禁适用全管线 | 题库 §10 |
| Q11.1 | 跨章并发 | A 全局单飞 V1 | 题库 §11 |
| Q12.1-Q12.3 | Record 终版 | 删死事件；usage 投影表；成本类可异步 | 题库 §12 |

## 4. 对既有规格的受控增补清单

1. ADR-0007 词表：删 AutomatedReviewCompleted；增任务族（TaskStarted/TaskStepTransitioned/CandidateDeltaExtracted）与配对约束
2. #8 tier 表：增 CHAPTER_DRAFTING 档行
3. kernel-schema：TaskResult/HARD_CONFLICT 类型入册（沿 #31 ResolutionSnapshot 同族）

## 5. 验收对照（Destination 判据）

- [x] 十步每步输入/输出/失败面/事件唯一答案（§1 表）
- [x] 回环出口与崩溃恢复矩阵可写成机械测试（§3+S8：沿 T10b 台架扩展全十步黑盒）
- [x] riskClass 契约冻结到 UI 可挂接程度（ProposalPort）
- [x] 双线吸收落地：应用线任务语义全部安放（§2/S8）
