---
date: 2026-08-24
description: '#32 备票题库：十步事务管线编排协议的完整 grilling 问题集——12 范围逐条候选问 + 崩溃恢复矩阵骨架，标注 BLOCKED-BY-#31 依赖（主会话代备票员完成）'
tags:
  - mozhou
---

# T32 · 十步事务管线编排协议：grilling 题库（备票员产出）

> 对应票：[#32](https://github.com/xiaohai-uid/mozhou/issues/32) · 地图 #29。相关笔记：[[t30-runtime-substrate-evidence]] · [[2026-08-24-wayfinder-phase-3-map]] · [[2026-08-23-wayfinder-phase-12]]
> **生产说明**：原备票员子会话超时未落盘，主会话按预案接管起草。
> 依赖标注：`[B-#31:字段]` = 需 #31 执行基底收口的对应产出才能开问；`[READY]` = 现在就能问。#31 已裁：Q0 吸收 / Q1 tier 间接层 / Q2 书内层推迟 / Q3 单一账本+状态投影 / Q4 四态结局词表 / Q5 publishEvent 单一写入口。

## 1. ChapterProductionSession 一等实体 `[READY]`

- **Q1.1** 会话是内存态运行时对象还是持久化实体？候选：A) 内存态+每步事件落账本即可恢复（沿 Q3=投影可重建裁决） B) 独立 session 文件入 `.mozhou/`（守 #6 目录树冻结，需受控增补） C) 复用正文文件 frontmatter 扩展字段承载
  倾向：A——Q0/Q3 已裁单一账本+投影，会话态=投影的一种，无需第三处真源
- **Q1.2** 会话与 ChapterCommit 的关系：一个 session 恰好产出一个 commit，还是允许多轮 commit？
  倾向：一比一（I5 旧 commit 永不修改 ⇒ 重提交=新 session）
- **Q1.3** 完成态判定单一事实源（ANWA #90）：session 完成与否由谁说了算？倾向：Ledger 中 CanonCommitted 事件的存在性

## 2. Prepare 步产出物 `[READY]`

- **Q2.1** Prepare 产出物形态：A) 纯函数查询结果集（章大纲节点+scenes+stale 警告+活跃承诺清单），不落盘 B) 落为「章计划」工件可被作者改
  倾向：A——Prepare 就是 compile() 的前置查询组合，无新真源
- **Q2.2** stale 警告注入点：Prepare 发现目标章大纲节点带 StaleMarker 时，管线是硬停还是警告继续（对账软门禁先例：警告不硬阻塞）？倾向：警告继续+Receipt 留痕

## 3. Compile 步衔接 `[READY]`

- **Q3.1** 确认复用 compile() 缝签名不变（A 芯纪律），管线只是调用方；taskType 新增 CHAPTER_DRAFTING 档是否需要 token 预算表增补行？倾向：是，沿 #8 tier 表受控增补先例

## 4. Draft/Review/User Edit 服务级动作面 `[B-#31:五级动作位最小集]`

- **Q4.1** Phase 3 无 UI，M16 五级动作位中本票实现哪几级？候选：光标动作（续写/多候选）+选区动作（润色）两级起步；面板/向导归 Phase 6
- **Q4.2** UserEditRecorded 的 delta 捕获口径：字符级 diff 还是结构化编辑操作？与保护位 I1 的交互（人手编辑不受禁令，dual-plane Q10 先例）
- **Q4.3** 多候选择优（ADR-0013 段落级分支）的选择/拒绝是否必须落 Ledger 才算有效（喂飞轮 EMA）？

## 5. Continuity Gate 组成 `[READY]`

- **Q5.1** M15 推论正式拍板：连续性维度纯机械核检（M2 时间线单调/四族行校验/POV 秘密零泄漏已实现），LLM 审查层不进 Gate 只进可选旁路？倾向：是——Gate 必须确定性可回归测试
- **Q5.2** AutomatedReviewCompleted 事件的处置：载荷冻结 or 从 ADR-0007 词表删除？倾向：若 Q5.1 裁纯机械则删（不留死事件）
- **Q5.3** Gate 失败的输出契约：HARD_CONFLICT 清单（冲突事实 id+断言原文+建议修复方向）作为独立事件还是 Result 字段？

## 6. Canon Proposal 确认面 `[B-#31:Result/failurePolicy]`

- **Q6.1** riskClass 三档服务级契约：low 自动落、high 显式确认无争议；medium「commit review panel」的 headless 等价物是什么？候选：A) 提案队列 API（挂起等待程序化 confirm/reject） B) 默认自动落但标记 require_review 待 UI 回看
- **Q6.2** 与 T5 五态对账门是否统一 API？倾向：统一为同一 ProposalPort，两个生产者（对账提取器/管线提案器）共用确认协议

## 7. 回环与停止策略 `[READY]`

- **Q7.1** HARD_CONFLICT→作者选「承认错误」→改文后：A) 回炉 Final Extract（重提取保证 delta 与终文一致） B) 只增量补提取改动段落 倾向：A——提取幂等成本低于一致性风险
- **Q7.2** 循环出口上限：同一 session 内 Extract↔Gate↔Edit 循环次数上限？（ANWA 双向实测：既测该停不停也测确认后必推进）倾向：不设硬上限但每次循环必须由作者显式动作驱动（无自动循环）
- **Q7.3** LLM 结构化输出失败触发三级降级（M17）时，哪一级允许静默、哪一级必须上报？

## 8. 崩溃恢复矩阵 `[READY]`（骨架，待作者逐行裁决）

| 步边界 | 进程崩 | 断电 | watcher 触发对账 | 候选语义 |
|---|---|---|---|---|
| Prepare 后 | | | | 未产生正文：重跑 Prepare 即可（幂等查询） |
| Compile 后 | | | | Receipt 已落盘（INV-R1/R2）⇒ 按 receiptId 续 |
| Draft 中 | | | | 流式中断=丢弃半稿重生成 vs 保留半稿人工接续 |
| Review/Edit 中 | | | | 编辑缓冲落盘策略（每章落盘即持久，#60 教训） |
| Extract 后 | | | | 候选 delta 已驻留运行期（dual-plane 分层表：崩溃丢失可接受，重跑提取） |
| Gate 后 | | | | HARD_CONFLICT 清单重算即可（确定性核检幂等） |
| Proposal 后 | | | | 未确认提案：投影悬挂标记（Q5 配对纪律） |
| **Commit 后** | ✅ 已答 | ✅ 已答 | ✅ 已答 | T3 pending-commit 双向恢复（既有实现） |
| Record 后 | | | | Record 与 Commit 同事务边界 or 允许异步回灌（§J.4 artifact_delta）？ |

## 9. 重提交管线 `[READY]`

- **Q9.1** 相位移回 draft 后再走管线：全十步重走还是增量（diff 上版 commit 正文只重跑 Extract 之后）？倾向：V1 全量重走——简单且 I5 保证旧 commit 不变，增量优化留给 V2
- **Q9.2** 重提交期间旧 commit 的读取方（compile 查询/依赖追踪）如何定位真相？倾向：phase=committed 的最新 commitId 即真相（相位机已有语义）

## 10. watcher × S3 写前校验交互 `[READY]`

- **Q10.1** 管线运行期 watcher 检出目标章 EXTERNAL_MODIFIED：管线立即挂起转对账（S3 挂起本次写入）还是跑完当前步到安全点再挂？倾向：步边界检查点挂起（步内不打断，避免半步状态×对账叠加）
- **Q10.2** 对账软门禁（警告不硬阻塞）是否适用于「以受影响章为目标」的编译任务之外，也适用于整条管线？倾向：适用，同款软门禁

## 11. 跨章并发 `[READY]`

- **Q11.1** 第 N 章 session 未提交时第 N+1 章能否开工？候选：A) 全局单飞（一次只有一个活动 session，最简） B) 允许 N+1 Prepare/Compile 但 Draft 前置校验 N 已 committed
  倾向：A 起步（本地单用户，单飞消灭一类并发 bug），B 作为 V2 放宽

## 12. Flywheel Record 终版 `[B-#31:事件词表]`

- **Q12.1** ADR-0007 八事件 ↔ 十步对齐表的终版：哪些事件改名/合并/删除（如 Q5.2 若删 AutomatedReviewCompleted）
- **Q12.2** usage_ledger 收编形态：attempt 级成本记账进 Ledger 任务事件流还是独立投影表？倾向：投影表（沿 Q3 投影裁决）
- **Q12.3** artifact_delta 异步回灌边界：Record 步允许落后正文热路径多久/多少事件？

## 计数

[READY] 可直接问 19 问；[B-#31] 依赖项 8 问（其中 5 个依赖字段在批 1-2 裁决后已解锁大半）。崩溃恢复矩阵 9 行 × 3 列待裁决 24 格。
