---
status: accepted
date: 2026-08-24
description: '章节生产管线事务化编排：一章=一个 ChapterProductionSession 十步步进序列，每步转换是 Ledger 任务事件，恢复=步边界检查点重跑，回环由作者显式驱动，Commit 唯一正典写入点，Gate 纯机械核检'
tags:
  - mozhou
---

# 0024. 章节生产管线事务化编排：单一 session 步进状态机

- **状态**：Accepted（授权终审制，作者全稿签署）
- **日期**：2026-08-24
- **来源**：[工单 #32](https://github.com/xiaohai-uid/mozhou/issues/32) · 配套规格：[[chapter-pipeline-spec]]
- **前置**：ADR-0023（执行基底吸收）· ADR-0007(novel)（事件架构）

## Context

十步管线（Prepare→Compile→Draft→Review→User Edit→Final Extract→Continuity Gate→Canon Proposal→Commit→Flywheel Record）的编排语义此前散落在各 ADR 与规格中：相位机与原子提交在 T3、对账协议在 #6、候选生命周期在 ADR-0002/0014，但「步与步如何衔接、崩溃后从哪续、回环怎么终止」无唯一答案。参考项目最大共性短板即事后补救而非事务化提交（卷二 §C）；ANWA 三大雷区（#60 断线丢章 / #90 完成态多源 / #116 停止策略失控）全部命中编排层。

## Decision

1. **一章 = 一个 ChapterProductionSession = 十步步进序列**：每步转换是一条 Ledger 任务事件；session 为内存态对象，会话当前步可随时从投影恢复（沿 ADR-0023 状态投影裁决）
2. **Commit 是唯一正典写入点**：其余各步产物要么是内存查询结果（Prepare）、要么驻留 draft 相位正文文件（Draft/Edit）、要么是运行期候选态（Extract/Proposal 未确认部分）
3. **回环由作者显式驱动**：Gate 冲突后的改文-重提取循环无自动迭代、无次数上限——有显式驱动即无失控（ANWA #116/#132 双向纪律）
4. **恢复=按步边界检查点重跑该步**：九边界逐一有唯一语义（规格 §3 矩阵）；watcher 对账只在步边界挂起
5. **Gate 纯机械**：连续性判定只含确定性核检，LLM 审查降为旁路建议；AutomatedReviewCompleted 死事件删除

## Consequences

- 每章落盘即持久 + 恢复入口天然成立（draft 即正文文件）；完成态判定单一事实源（CanonCommitted 存在性）
- 跨章并发 V1 全局单飞——牺牲并行度换取消灭并发缺陷类；V2 再评估放宽
- Benchmark 六指标 L1 判定器随本票交付，Phase 3 自证闭环
- 重提交 V1 全量重走：简单正确优先，增量优化留 V2
