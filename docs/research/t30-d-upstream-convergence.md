---
date: 2026-08-24
description: '#30 票 D 路增量（主会话直做）：master 无关历史合流后的应用线画像——新 ADR 0001-0007 编号冲突、任务/技能运行时已 accepted、与 Phase 3 三雾区的碰撞面清单'
tags:
  - mozhou
---

# D 路增量：上游合流的应用线画像与碰撞面（主会话取证）

> 归属：[研究票 #30](https://github.com/xiaohai-uid/mozhou/issues/30) 第四路。相关笔记：[[2026-08-23-wayfinder-phase-12]] · [[2026-08-24-wayfinder-phase-3-map]]
> A/B/C 三路取证期间，主会话发现 origin/master 领先本地 196 提交且含「无关历史合流」，此增量为合稿必读项。

## 0. 一句话

**「执行基底未裁」的前提变了：应用线已有两套 accepted 的运行时设计（任务运行时 + 技能运行时），#31 grilling 不再是 greenfield 出题，而是双线裁决题。**

## 1. 合流事实

- master = 内核线（本地图谱所据，ADR-0001..0022 + docs/specs + 三包）⊕ 应用线（来自 `C:\zcode\novel-ai` 独立仓库，合并提交 02beac0「会师 workbench UI 线与内核线——无关历史合流」）
- 应用线自称「墨舟已经上线」的生产 webapp（V1.2）：Postgres、SSE、user/novel/chapter 归属、usage_ledger、docker-compose、GitHub CI
- tracker 共用先例：#28 即 `[app]` 前缀票（main 线继承失败修复）
- **ADR 编号空间冲突**：应用线自带 0001-0007（2026-08-12~16），与内核线 0001-0022（2026-08-23）同名撞号；`docs/adr/` 下现并存两套
- 应用线的 spec/契约/工单不在本仓：ADR 引用的 `.scratch/mozhou-task-runtime/spec.md`、`.scratch/mozhou-workbench-a/contracts/` 在其来源仓（本仓 .scratch 只有 morning-report/diagnosis/mvp）
- 本仓 AGENTS.md 被应用线覆写为 UVSD Protocol v2.2.1（契约冻结/Contract Delta/ticket 边界/unattended 纪律），与内核线 wayfinder 工作法并存

## 2. 应用线七张 ADR 速览

| ADR | 内容 | 与内核线的关系 |
|---|---|---|
| 0001 写作上下文边界 | 统一两条写作对话链的模型输入分层（作品资料/正文参考/对话历史/本轮请求四语义层） | 对应内核线 Context Compiler 的「装配在服务端」纪律，但对象是对话链不是编译器 |
| 0002 写作上下文深化 | PreparedChatRequest 统一组装 + **候选生命周期**（generationKey/回放/discard/revision 并发保护）+ 压缩器传输收编 | 候选概念与内核线 candidate fact 四态**撞名不同物** |
| 0003 候选生命周期隔离 | 候选 schema/migration 另立 Contract Delta；transport 层 fail closed | 交付边界方法论可借鉴 |
| 0004 双 seam | 业务层 PreparedChatRequest seam + transport wire payload seam 双测试边界 | 测试接缝思路与内核线黑盒三接缝兼容 |
| 0005 扫榜/趋势/搜索 | ranking_snapshots 表、番茄全量榜 8-16 个、msToken 签名搜索、90 天保留 | **踩进内核线 Phase 7 Market Brain 领地**，数据架构两套（快照表 vs MarketBrief 文件） |
| 0006 Skill 运行时 + A 版双栏工作台 | SkillDefinition/SkillRun/GenerationPlan/ContextAssembler/ArtifactRef，五内置技能按阶段自动路由，契约 FROZEN | **直接对应内核线 CapabilityRegistry**（ADR-0009）：两套能力运行时设计并存 |
| 0007 可恢复创作任务运行时 | generation_jobs/steps/attempts/events 四表、planned→queued→running→waiting_retry→终态状态机、attempt 级重试（仅未产生结果）、SSE Last-Event-ID 补发、usage_ledger、无外部队列、lease/claim 预留 | **直接对应内核线 NovelRuntime**（ADR-0007 同号异物！）+ #32 雾区崩溃恢复矩阵的部分答案 |

## 3. 与 Phase 3 地图三雾区的碰撞面

1. **雾区一（执行基底）**：#31 的出题框架从「最小形态怎么定」变为「内核线 Execution Seam vs 应用线 lib/tasks + skills 运行时：吸收 / 并存 / 取代」。应用线 0007 明确不引入 bullmq/Redis（Postgres 条件更新）——与内核线 local-first SQLite 是两种持久化世界观，裁决必须先于 Recipe Schema 出题
2. **雾区二（编排协议）**：#32 问 8 崩溃恢复矩阵在应用线有部分现成答案（step 级人工重试边界、0-rows-cancelled、stopped 终态防迟到完成）；#32 问 12 Flywheel Record 的 usage/cost 归因可对照 usage_ledger 设计
3. **雾区三（门禁确认面）**：应用线候选生命周期（章节候选 generationKey 状态机）与内核线 Canon Proposal（fact 候选四态）是两个不同层的「候选」，术语必须对齐否则规格互相污染
4. **图外新增**：Market Brain 双实现并存（应用线已上线扫榜 vs 内核线 Phase 7 规格）；AGENTS.md 双工作法并存（UVSD vs wayfinder）

## 4. 给 #31/#32 的操作建议（供地图维护者拍板，本票不拍板）

1. #31/#32 开场必读输入追加：应用线 ADR-0002/0006/0007 全文
2. 新 ADR 编号从 **0023** 起（延续内核线），并在 ADR-README 或索引注明应用线 1xxx 重编号待议
3. 考虑加一张独立 grilling 票：「双线架构裁决」——local-first 内核线与应用线上线产品的关系（这是比执行基底更上游的题，建议地图 Notes/Fog 增补）
4. 报告合稿时 A/B/C 三路证据按「对两线各自适用性」标注

## 5. 取证局限

- 仅读 origin/master git 对象与本仓 issue 列表；未读 app/ 源码实现细节；应用线的 .scratch spec/contracts 在来源仓不可达
- 合并意图（为何合流/两线目标关系）无书面记录，以上第 3-4 节为碰撞面客观描述而非意图推断
