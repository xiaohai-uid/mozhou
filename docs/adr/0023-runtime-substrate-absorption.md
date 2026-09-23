---
status: accepted
date: 2026-08-24
tags:
  - mozhou
---

# 0023. 执行基底单一化：内核线吸收应用线可恢复任务语义

- **状态**：Accepted
- **日期**：2026-08-24
- **来源**：[工单 #31](https://github.com/xiaohai-uid/mozhou/issues/31) grilling 十二问（Q0-Q11），作者逐问拍板
- **配套规格**：[[runtime-capability-spec]] · 取证依据：[[t30-runtime-substrate-evidence]] · 合流增量：[[t30-d-upstream-convergence]]

## Context

master 已「无关历史合流」两条线：内核线（local-first 三包 kernel/data-plane/context-compiler + Execution Seam 四方法规格 + EventLedger 账本）与应用线（已上线生产 V1.2：lib/tasks 门面 + generation_jobs 四表状态机 + SSE Last-Event-ID 补发 + usage_ledger + SkillRuntime 五内置技能，契约 FROZEN）。两套运行时并存导致：两本账、两个「候选」、两套失败三分法——每道后续议题都要双宿主作答，飞轮/评测/回放跨线不可复用（D 路合流增量取证，docs/research/t30-d-upstream-convergence.md）。

关键事实：内核线缺的恰是应用线已验收的部分；应用线 events 表按 seq 追加与内核线账本同构；local-first 是内核规格明文红线。

## Decision

**吸收（甲方案）**：内核线为主干收编应用线可恢复任务语义。

1. Execution Seam 四方法为唯一公开面；应用线 lib/tasks 门面语义并入 `execute(taskType, payload)`
2. 任务生命周期翻译为 Ledger 任务事件流；jobs/steps/attempts 当前态 = SQLite 状态投影（seq 对齐、CAS=投影上乐观并发、可随时重建）；SSE 补发按 seq 读账本
3. 结局词表收编应用线四态：succeeded / failed_recoverable / failed_terminal / state_degraded（只入词表，Phase 2 结算启用）；attempt 重试仅对未产生结果开放；取消走投影合并丢弃 late_arrival
4. EventLedger 写入权 = publishEvent 单口，词表与成对约束由 runtime 类型库强制（DSH hook-protocol 先例）
5. usage_ledger 收编为 usage 投影表；lease/claim seam 保留为独立 runner 预留位

应用线 SkillRuntime 的 Capability↔Skill 概念映射与改名裁决归 [#33](https://github.com/xiaohai-uid/mozhou/issues/33)。

## Consequences

- 单一基底单一账本：replay 即回归全保留；#32 崩溃恢复矩阵直接继承应用线已验收答案（step 级重试边界、防迟到完成）
- 应用线下个版本重构 lib/tasks 时交一次性迁移税；Postgres 条件更新改写为 SQLite 投影乐观并发
- 双工作法（UVSD 契约冻结 × wayfinder 冻结规格）在 ADR 层面合一：后续能力契约变更走受控增补
- 新 ADR 编号从本篇起延续内核线序列；应用线 ADR 0001-0007 重编号待议（不阻塞实现）

## Alternatives considered

- **乙·并存**：被否——每题×2 决策成本 + 规格互相污染，Phase 3 收口目标实质落空
- **丙1·应用线基底上位**：被否——放弃 event-sourcing/replay，撞 local-first 红线
- **丙2·内核线替换生产 V1.2**：被否——大迁移零行码新 runtime，用生产稳定性换架构洁癖
