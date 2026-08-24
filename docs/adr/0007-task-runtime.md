---
status: accepted
date: 2026-08-16
---

# ADR-0007：可恢复创作任务运行时进入真实产品

## 背景

章节生成、拆解、导入等长操作目前都在一次 HTTP/SSE 请求生命周期内完成，状态依赖进程内存：浏览器断开/刷新后看不到阶段时间线，服务重启后无任务恢复与到期重试，无法回答「给一个 generationId，现在到哪一步、失败在哪次尝试、能否继续、花了多少 token、产物是否可用」。技能运行时（GenerationPlan/SkillRun）是证据记录，不是可被 worker 接管的任务状态机。五源炼化（DeterminFlow 任务状态机/到期重试、ArcReel 队列工程与事件游标、inkos 结算降级、oh-story 原子提交、OpenWrite 生成反馈阶段化）结论一致：第一阶段应先补「可恢复创作任务运行时」，而不是继续堆技能。

## 决策

1. 新增四类持久化记录：generation_jobs / generation_steps / generation_attempts / generation_events，全部带 user/novel/chapter 归属；job 与 step 共用状态枚举（planned→queued→running→waiting_retry→succeeded/failed/cancelled），attempt 独立枚举。
2. 结局分类：succeeded / failed_recoverable / failed_terminal / state_degraded（state_degraded 本期只入词表，Phase 2 Canon 结算使用）。
3. 新建 lib/tasks 门面为唯一任务操作入口；候选生命周期、正文写入、技能运行时契约保持不变，任务运行时只能在其外登记与对齐（generationId 与 job_id 强制 1:1，SkillRun 挂 attempt）。
4. 事件持久化 + SSE 补发：generation_events 按 seq 追加、client_key 幂等；SSE 只做实时投递，Last-Event-ID 可从事件表续传；首版只写任务事件，业务事件 Phase 2。
5. 成本账本：新建 usage_ledger（attempt 级 + provider/model + cost_status：priced/unpriced/partially_priced），usage_events 保持为账户页聚合源不动；未归因用量保留不丢弃。
6. 人工重试为 step 级，首版仅对「未产生结果」的 step 开放（不重复扣费底线）；取消语义沿用 stopped 终态防迟到完成（0-rows-cancelled 原则）。
7. 部署形态选项 A：请求内执行 + 全持久化 + 事件补发 + 失败人工重试（Cloud Run 请求驱动现实）；lease/claim 语义本期实现并测试，为独立 runner（选项 B）预留 seam，生产不部署常驻 worker。

## 取舍

- 不引入外部队列依赖（无 bullmq/Redis）：Postgres 条件更新 + 定时扫描，符合「lean on existing deps」原则。
- 不假装供应商同步文本调用可中途恢复：只能「未产生结果」时按策略重试。
- 不扩展技能数量、不做自动日更、不做多 Agent（均为后续阶段）。
- AGPL 三项目（DeterminFlow/ArcReel/inkos）仅机制参考，不引入代码；oh-story storyrepo 与第三方脚本未核源前不进产品代码。

## 实现入口

- Spec：`.scratch/mozhou-task-runtime/spec.md`（approved-frozen）；验收考卷：`.scratch/mozhou-task-runtime/refinement-exam.md`；票：`.scratch/mozhou-task-runtime/issues/01-10`。
- 验收清单：spec §7（10 条上游验收用例 + 阶段 1 通过标准 5 条 + 状态词表通过标准）。

## 验收约束

一个机制只有同时具备持久化记录、状态守卫、事件补发、恢复语义、幂等测试与归属校验，才能标记为「已接入任务运行时」；现有候选/正文契约测试不得回归。
