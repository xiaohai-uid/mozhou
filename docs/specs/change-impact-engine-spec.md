---
date: 2026-08-27
description: 'Phase 5（Change Impact Engine）折叠规格——确定性遍历+语义旁路双图层；来源：t60-t63 四研究 + t65/t66 两份 grilling 终裁（D01-D28 全拍板，零 DEFER）'
tags:
  - project-note
  - mozhou
---

# 变更影响引擎折叠规格（Phase 5）

> Wayfinder 地图 [#59](https://github.com/xiaohai-uid/mozhou/issues/59) · 研究：docs/research/t60-a / t61-b / t62-c / t63-d · 裁决：docs/research/t65-grill-traversal-trigger（#64）/ t66-grill-semantic-reuse（#65）
> 折叠纪律：只折叠不发明；冲突以 grilling 终裁为准；ADR-0003 双图层为主干

## 0. 一句话

**canon 改动落定（对账终态/CanonCommitted 双信号）→ 数据面公共出口回调 → 确定性遍历（窗内缓存+幂等短路）圈定受影响下游（StaleMarker 章大纲停靠 + impact 派生投影）→ 语义旁路只读评估（SemanticAnalysisReport，零写口）→ 全部机械、可重建、指纹可比。**

## 1. 全局裁定（t65/t66 继承）

- 边界母版：ADR-0024:26（Gate 纯机械+LLM 旁路）+ ADR-0003（Step1 确定性/Step2 语义/Step3 作者动作）
- 词表纪律：domain-events.ts:4-6 唯一真源、死词条禁回填（:9-10）、新词条带发射方义务禁先加词后实现
- 确定性面**零新事件**（D19：不增 ReconciliationSettled）；TraversalStarted/Finished（E1/E2）仅作遍历生命周期观测（词表 15→17）
- 语义层 V1 无默认写口，三通道：报告文件→指针事件（SemanticAnalyzed，不成对，词表 15→16）→派生投影
- 重建幂等指纹 = 排序后内容集合哈希，剥离时间戳与 ULID 随机分量

## 2. 确定性遍历层定案（t65）

| 项 | 裁决 |
|---|---|
| D01 索引 | 混合窗内缓存（pins 常驻+按 seq 增量读）；保留 findReaders 单缝；不建倒排 |
| D02 触发 | 双入口信号（对账终态/CanonCommitted）→ 单一传播函数；后台/手动仅降级 |
| D03 幂等 | 标记等价短路：读回既有 StaleMarker 逐字段全等即跳过写（revision 不动） |
| D04 预算 | 账本 ≤20k 行 / pin ≤2k / 单次传播 ≤100ms；超限降级后台队列+打点 |
| D05 停靠 | 章大纲节点 StaleMarker 三字段（唯一停靠）+ impact 派生投影（可选叠加、可弃可重建）；不标正文（I1）/commit 粒度 |
| D06 组装源 | pipeline/compile-step 产 dependencyManifest（消费同侧）；compile() 缝不动 |
| D07 措辞 | 字段按 revision（≥0 整数）为准，改 SHA 破坏后到者胜；修订票面+ADR 措辞随 T25 |
| D21 扫描预算 | ReconciliationOptions 增 N=100 章/批 + 超限分批【定案值】 |

## 3. 变更入口与触发定案（t65 D18-D22）

- **D18 落定信号**：A = 对账终态（applied/partially_applied/dismissed ∧ resolvedAt≠null）→ reloadManifest；B = CanonCommitted 事件行 ∧ 相位翻转；C（ADR-0014）P0 补读不阻塞 V1
- **D19/D20 接线**：数据面公共落定出口单点，顺序 = 落定→reloadManifest→propagateStaleMarkers（T6）→嗅探（Phase5）；**回调注入形态**（record-step afterRecord 先例），零新事件词条
- **D22 切片**：判据 1-7 全量（检出→落定→幂等→机械圈定→语义判定→T6 并行→预算），不退化为仅机械段

## 4. 语义层定案（t66）

| 项 | 裁决 |
|---|---|
| D08 身份 | advisory-only 只读旁路（S1 适配/S2 提示/S3 软标定）；MUST-NOT-1..6 进验收（含永不代作者调 Port 三动词） |
| D09 载荷 | 新载荷 SemanticAnalysisReport（本体不复用 Receipt）；同构槽：entries 有 / replayInputs 无 / structural V2 缓 |
| D10 输入锚 | receiptId+recomputationHash+changeSummaryDigest；T5 摘要带引用不内嵌（reconciliationRef） |
| D11 token | 输入 ≤min(装配包 totalTokens×1.0, 16384)，输出 ≤512；服务端 tokenizer 计量 |
| D12 节流 | 排序 pin→对账命中→stale→主线；同 taskType 相邻 3-5 章批量传输、逐章单报；deferred 标 |
| D13 降级 | L0 跳过(refusal 事件)/L1 不做（确定性层投影禁入报告）/L2 重试 3 次退避 1s/2s/4s；永不静默 mock |
| D14 入账 | 报告文件先→SemanticAnalyzed 指针事件后→SQLite 投影 semantic_analysis |
| D15 Port | V1 零集成点；critical→style 桥接 V2 缓；只记 suggestion |
| D16 保留 | V1 全保留 |
| D17/R2 | 语义输入面 = 受影响章 diffs + 修改实体定义（ADR-0003:21）+ receipt 锚点伴随态；diffs 以引用摘要进 payload（不内嵌全文） |

## 5. 复用面定案（t66 D23-D28）

- D23 Receipt 三槽：形态同构（自声明同构 DTO）、剥离生命周期
- **D24 不扩 ProposalPortRef 第 4 后端**（四条硬证据：ref 单提案形态/PortAction 无只读/pending-finalized 污染/决策时钟噪声）→ impact 走派生面
- D25 Traversal 成对（Started/Finished，词表 15→17）；SemanticAnalyzed 不成对（15→16）——成对性按事件语义分派非一刀切；18 词条是补全非膨胀
- D26 触发复用 CanonCommitted+对账终态，不新增触发事件
- D27/D28 黄金对拍台架：dep-graph-10ch 固定夹具（直线/跨跳/菱形/孤立）+ case 表（单实体单字段）+ 三层断言（受影响集=黄金排序集合 / 传播深度=行为级 / 数字=只读哨兵）+ CASE 守卫 + 资格门；断言面剥离 consumedAt/decidedAt 时钟字段

## 6. 受控增补清单（t64 §3 经终裁收紧）

| # | 增补项 | 形态 | 终裁备注 |
|---|---|---|---|
| E1/E2 | TraversalStarted/Finished | 成对入词表（15→17）+ EVENT_PAIRS（3→4 对） | t66 R4 批；带发射方义务 |
| E3 | SemanticAnalyzed | 不成对（15→16）；payload 指针摘要 | t66 D14 批 |
| E4 | impact 投影 | 派生面（entity→affected set）；版本号字段+tmp+rename 原子写；指纹禁时间戳 | t65 D05 + t66 D25 |
| E5 | semantic_analysis 投影 | SQLite 表（report_id PK...） | t66 D14 批 |
| E6 | SemanticAnalysisReport schema | 一报一文件 report_<ULID>.json | t66 D09/D10 批 |
| E7 | .mozhou/semantic-analysis/ 目录 | 运行时区非 canon | t66 D14 批 |
| — | ReconciliationSettled | **明确不增**（确定性面零新事件） | t65 D19 否决 |

## 7. 实现票切分（t64 §4 经终裁确认）

- **T25** 落定信号与唯一接线（D07 措辞修订 + D18/D19/D20 + P0 补读 ADR-0014）
- **T26** 传播面收口（D01-c 窗内缓存 + D03 幂等短路 + D04 预算）
- **T27** 遍历触发 + impact 投影（D02/D05/D21/D22 机械段 + E1/E2/E4）
- **T28** 语义层骨架（D08/D09/D10/D11 + D17 输入契约 + 三级降级 + 授权边界）
- **T29** 语义层节流与入账（D12/D14/D16 + E3/E5/E6/E7）
- **T30** 黄金对拍台架（D27/D28；可与 T27 并行）

依赖链：T25 → T26 → T27；T28/T29 依赖 T27 的 affected 输出（D17 已定契约）；T30 独立并行。

## 8. 待澄清

- 无实现阻塞级未决；C 路径（ADR-0014）T25 P0 补读后回填。
