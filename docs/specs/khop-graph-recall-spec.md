---
date: 2026-08-23
description: '工单 #12 产出：k-hop 图召回算子规格——POV 可见子图上三类边恒开二跳扩展、双硬上限、触发卡必入、三通道 max 合并记胜出证据、duplicate≡identifier 撞车，伪代码级'
tags:
  - project-note
  - mozhou
---

# k-hop 图召回算子规格（Temporal Canon Graph 召回通道）

> 相关笔记：[[token-budget-assembly-spec]] · [[context-receipt-physical-format-spec]] · [[kernel-schema-draft]] · [[ADR-0002 Temporal Canon and Candidate-to-Canon Fact Lifecycle]] · [[MoZhou Wayfinder 地图]]

> 工单 [#12](https://github.com/xiaohai-uid/mozhou/issues/12) · 决策记录见 ADR-0022
> 前置：[kernel-schema.draft.ts](./kernel-schema.draft.ts)（#4）· [#7 三通道决议](https://github.com/xiaohai-uid/mozhou/issues/7) · [Token 预算装配算法规格](./token-budget-assembly-spec.md)（#8）· [Receipt 物理格式](./context-receipt-physical-format-spec.md)（#9，Q15/Q16）
> 边界：草稿提及检测与别名解析归 #13（本票只消费「触发实体集合」接口）；embedding 索引与查询构造归实现票（选型已由 T9 定案 fastembed + bge-small-zh-v1.5）；本票裁 **k-hop 算子本体与三通道合并打分去重**。

## 0. 算法一句话

**POV 可见子图上，从触发实体做恒开二跳扩展：三类边、双硬上限、触发卡必入；三通道 max 合并记胜出证据，`duplicate` ≡ identifier 撞车。**

## 1. 在召回管线中的位置

```
草稿/场景文本 ──keyword 通道──▶ 触发实体集合 T ─┐
                                               ├─▶ merge ─▶ recallResult ─▶ assemble（#8）
canon 图 ──────khopRecall（本票）──────────────┤              {candidates, excluded}
                                               │
canon 文本块 ──embedding 通道（T9）────────────┘
```

| 接口 | 契约 | 归属 |
|---|---|---|
| `triggers: EntityRef[]` | keyword 通道命中并经别名表解析出的 canonical 实体集 | #13 产出 |
| `recallResult.candidates[]` | `{id, tier, channel, relevanceScore∈[0,1], pinned?, atomicOverride?, content}` | 本票成形，#8 消费 |
| `recallResult.excluded[]` | `{identifier, reason, channel?}` → Receipt `stage='recall_filter'` 透传 | 本票成形，#9 记录 |
| `ActivationEvidence.graph_khop` | `{sourceEntity, hops, score}`（schema 已冻结） | 本票赋值语义 |

## 2. 配置默认表（全部入 configVersion，参与 recomputationHash）

```yaml
khop:
  maxHop: 2                 # 永久封顶，不做条件触发
  branchCap: 10             # 每实体每跳宽度（候选产出与出边扩展共用）
  khopCap: 40               # 图通道全局候选上限
  threshGraph: 0.30         # 非触发来源条目的分数门槛
  weights:
    edgeType:   { rel: 0.9, fact_ref: 0.7, event: 0.5 }
    importance: { critical: 1.0, notable: 0.7, trivial: 0.3 }
    hop:        { h1: 1.0, h2: 0.5 }        # 触发自身材料=1 跳；邻域材料=2 跳
    relStrengthFloor: 0.3     # REL 边强度 = max(floor, |affinityScore|/100)
keyword:
  primaryNameScore: 1.0     # 主名命中
  aliasScore: 0.85          # 别名命中
  mentionBoost: { step: 0.05, cap: 0.15 }   # 额外提及加分
embedding:
  thresh: 0.80              # T9 R3：bge 分布集中 [0.6,1]，起步值按自有语料标定
merge:
  priority: [manual_pin, keyword, graph_khop, embedding]   # 精确平局收口序
```

## 3. 图模型：节点与三类边

**节点 = EntityRef**（`char:` / `item:` / `location:` / `faction:` / `concept:` 五命名空间）。
事实不设节点——挂在 subject 实体下作为其材料；TimelineEvent 不设节点——只派生边。

| 边类型 | 推导 | 方向 | 时间资格 |
|---|---|---|---|
| `rel` | RelationshipState 两端 entityA↔entityB | 无向 | validFrom ≤ N ≤ (validUntil ?? ∞) |
| `fact_ref` | TemporalFact.subject 与 value 中识别出的每个 EntityRef 之间 | 有向（subject→value） | 随宿主事实区间 |
| `event` | 同一 TimelineEvent 的 participants 两两之间；participant↔locationRef | 无向 | **永久**（历史恒真，不加 recency 衰减——近期叙事由 rolling_recap 流承担） |

- **value 引用识别**：value 为 string 且**整体**匹配 `^(char|item|location|faction|concept):[a-z0-9][a-z0-9-]*$` 才算引用。多实体值不支持——FactValue 标量纪律，应拆多条原子事实。
- **建图状态资格：仅 `confirmed`**。planned 是计划非正典（大纲意图经 structural 任务框架/Scene beats 到达 AI，不走事实通道）；candidate 未验证防幻觉扩散；rejected 出局。
- **impactFactIds 不建桥**（v1 边界）：事件与其确立事实的关联不派生额外边。关键道具/人物通常已被 fact_ref 双向覆盖；此关联留作 v2 扩展点。
- TimelineEvent.impactFactIds 的事实照常经各自 subject 入图，无需特殊处理。

## 4. POV 可见子图（门禁先行）

**strict 门禁：遍历与候选共用同一门禁，在 POV 可见子图上进行。**

```
eligible(f, N, pov):
    f.status == 'confirmed'
    ∧ f.validFrom ≤ N ≤ (f.validUntil ?? ∞)
    ∧ povGate(f, pov, N)      # secret.* 要求当前 POV 的 KnowledgeState 授权行；
                              # 非秘密事实公开；distortion 只改渲染不改门禁（#7 中央门禁语义）
```

被门禁滤除的事实**同时失去候选资格与建边资格**——单一门禁点（入口一次过滤，遍历/打分不再碰知识状态），零软泄漏（不会因秘密桥把邻域实体聚光）。代价：部分公开事实因秘密桥不可达——漏召由 embedding 兜底，此即双轨存在的意义。REL/EVENT 边不经过事实，不受门禁（秘密关系以 `secret.*` 事实建模，走 fact_ref 且被门禁）。技术上即邻接查询 join knowledge_states 做 WHERE，不物化多份子图。

## 5. 遍历算法

```
khopRecall(canon, triggers T, chapterIndex N, pov, cfg) → {candidates, excluded}:

G0 子图过滤:
    facts'   = { f ∈ facts      : eligible(f, N, pov) }
    rels'    = { r ∈ rels       : intervalActive(r, N) }
    events'  = events                                  # event 边永久，不过滤

G1 触发层（∀ t ∈ T，T 按 keyword 分数降序、ref 升序预处理）:
    emit card(t)                                            # ★ 硬必入，唯一豁免容量者
    emit top-branchCap(facts'(subject=t), by score desc)    # 免阈值免去重，不免 branchCap
                                                            # hops=1，w_hop=h1
G2 邻域扩展（hops=2，恒开一次）:
    for t ∈ T:
        neighbors(t) = rel'端点 ∪ fact_ref目标( facts'(subject=t) ) ∪ event共现
        取边权降序前 branchCap 个邻居 nb                     # 超限按边权裁剪
        for nb ∈ neighbors:
            emit top-branchCap(facts'(subject=nb), by score desc)
                                                            # 过 threshGraph 者；hops=2，w_hop=h2
G3 全局收口:
    candidates 按 relevanceScore 降序、id 升序取前 khopCap   # 平局 ULID ASC 收口
    多路径到达同一事实：score 取最大路径积；证据 sourceEntity 取产生该最大分的触发根，
    仍平局取 G1 序靠前者
```

- **branchCap 一参两用**：每实体每跳至多贡献 branchCap 条候选条目、并至多沿 branchCap 条出边继续扩展——同一宽度参数的两个投影。
- **记录范围裁决**（Receipt 噪声控制）：仅触发层材料中被区间/POV 滤除者发射 `excluded` 记录（诊断价值高：「他现在的状态为什么没进来」）；二跳静默跳过、branchCap/khopCap 落选者不记录（从未成为候选）。阈值淘汰者在合并阶段统一发射 `relevance_below_threshold` 并带通道归属。

## 6. 打分函数（三通道）

| 通道 | 公式 | 说明 |
|---|---|---|
| `keyword` | 主名 1.0 / 别名 0.85，+ step×(提及数−1) 封顶 cap | 提及即证据，无阈值 |
| `graph_khop` | `w_type × w_impact × w_hop`，clamp [0,1] | REL 边 w_impact 用 `max(relStrengthFloor, \|affinity\|/100)` 替代（敌对 −80 同样是强叙事关联；RelationshipState 无 importance 字段）；FACT_REF/EVENT 取宿主事实 importance；EVENT 边不看 importance（TimelineEvent 无此字段，保持最简） |
| `embedding` | cosine 相似度原始值 | 相对排序优先于绝对值（T9 R3），阈值 thresh 仅作入选门 |

**不设跨通道校准层**：#8 desirability 全序中 tierRank 先于 relevanceScore，跨通道比分只发生在同 tier 内；raw 分足够，receipt 中 score 本就是排序启发量，不承诺跨语义精确可读。

## 7. 合并与去重

```
merge(channels… ) :
    identity = ReplayCandidate.id            # FactId（ULID）或 EntityRef（卡）或 PromiseId
    同 id 多通道命中 → 收敛为一个候选：
        relevanceScore = max(各通道分)
        pinned         = OR(各通道 pinned)    # pin 是作者显式意志，OR 合并
        channel/evidence = 分数最高者；精确平局按 merge.priority 序收口
                                          # manual_pin > keyword > graph_khop > embedding
    各通道阈值先于合并施加（触发豁免只作用于图通道一跳）
```

- **`duplicate` 判定线：`duplicate` ≡ identifier 撞车**——合并后仍出现同 id 第二行时的防御性记录，正常路径恒 0 次。**不是**「内容相似」：卡摘要与事实条目的内容冗余 v1 接受（卡短小；内容级去重无法确定性判定，违反 INV-K 复算纪律）。
- **触发豁免范围**：触发实体的实体卡（硬必入）+ 其自身事实（hops=1）免 `threshGraph` 与去重淘汰；**不豁免** branchCap、valid 区间、confirmed 资格、POV 门禁、预算竞争。「必入候选集 ≠ 必入上下文」——预算是硬顶（pin ≠ 豁免，#8 §5 先例）。manual_pin 不视为触发源（钉选=钉具体条目，作者未要求扩圈）。

## 8. tier 指派（统一规则，通道无关）

| 内容类别 | tier |
|---|---|
| 实体卡（触发必入；embedding 直达亦入）| `entity_card`（**#8 表受控增补档**，rank 1，atomic）|
| subject=`concept:*` 的活跃事实（世界规则）| `world_rule` |
| 其余区间活跃且 compactedIntoVolumeId=null 的事实 | `active_fact` |
| compactedIntoVolumeId≠null 的事实（折叠旧典）| `distant_recall` |
| 承诺 status ∈ {due, **overdue**} | `promise_due`（overdue = 错过 targetChapter 未兑现，比 due 更紧急的写作警报——受控增补）|
| 承诺其余活跃态（introduced/reinforced）| `distant_recall`（#8 注释既定）|

本算子**不产 `rolling_recap` 档**（回顾流归 State Compaction 产物通道）。承诺不经图（NarrativePromise schema 无实体引用），keyword/embedding 以 description 文本直达；TimelineEvent 不做独立候选条目（tier 表无事件档）——事件只做桥，叙事信息经 rolling_recap 流到达。

## 9. 确定性与索引

- 邻接索引 = runtime.sqlite 可丢弃投影（canon JSONL 全量扫描可重建，INV-R4 同构）；commit 时增量维护是实现细节不入规格。
- 同 canon 状态同输入 ⇒ 同候选集同分同序；一切平局 ULID ASC（或 merge.priority）收口。
- 图遍历**不在 replayInputs 复算契约内**（#9 §3.1：recall_filter 为透传记录）；但本通道候选照常进 replayInputs 终序清单（id/tier/channel/score/contentDigest）。
- `ActivationEvidence.graph_khop` 赋值语义：`sourceEntity`=触发根实体（非中介邻居——回答「被哪个提及拉进来」，对标 Viewer Key 列）；`hops`∈{1,2}（触发自身材料=1，邻域材料=2）；`score`=该路径最终分。

## 10. 不变量与错误模式

| 编号 | 不变量 |
|---|---|
| INV-K1 | 遍历与候选共用同一 POV 门禁：被滤事实零候选零建边（strict） |
| INV-K2 | 触发实体卡无条件进入候选集（唯一容量豁免）；其余一切豁免不触及预算硬顶 |
| INV-K3 | maxHop=2 恒开；branchCap/khopCap 下候选集有确定上界（枢纽不爆炸） |
| INV-K4 | 同 canon 状态同输入 ⇒ 同候选同分同序（决定性；平局 ULID/priority 收口） |
| INV-K5 | `duplicate` 仅在合并后 identifier 撞车时发射，正常路径恒 0 次 |
| INV-K6 | 建图与候选资格仅认 confirmed + 区间活跃（event 边除外） |

错误模式：无新增异常——触发集为空时本通道静默返回空（keyword 通道失灵由 embedding 独立兜底，三通道互不阻塞）。

## 附录：已裁决的替代方案

| 备选 | 裁决 | 理由 |
|---|---|---|
| 二跳条件触发（一跳产出不足才扩） | 否 | receipt 可解释性变差（答案变成全局态「一跳太薄」）；恒开+上限的解释是局部的「边排名进 cap」 |
| 跨通道分数校准层 | 否 | desirability 序 tier 先于 score，校准是无消费方的复杂度（原则 2） |
| 内容级去重（卡 vs 事实冗余检测） | 否 | 无法确定性判定；v1 接受短卡冗余 |
| impactFactIds 建桥 | v1 否 | fact_ref 已双向覆盖关键关联；留 v2 扩展点 |
| planned 事实入图 | 否 | 计划非正典，未来事实渲染成当前态危险；意图走 structural 层 |
| EVENT 边 recency 衰减 | 否 | 近期叙事归 rolling_recap，图管结构关联；少一个参数 |
| k ≥ 3 | 永久否 | Codex Relations 官方警告级联膨胀；百万字规模下三跳即噪声 |
