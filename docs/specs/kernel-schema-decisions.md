---
date: 2026-08-23
description: '工单 #4 产出：墨舟九实体 + Scene 冻结 Schema 草案（kernel-schema.draft.ts）的逐字段决策记录，两轮 grilling Q1-Q14 全录'
tags:
  - project-note
  - mozhou
---

# Kernel Schema 逐字段决策记录（工单 #4 产出）

> 相关笔记：[[kernel-schema-draft]] · [[ADR-0019 Research-Driven Amendments]] · [[MoZhou Wayfinder 地图]]

- **状态**: 冻结草案 v1（随 wayfinder 工单 [#4](https://github.com/xiaohai-uid/mozhou/issues/4) 收口）
- **产物**: [`kernel-schema.draft.ts`](./kernel-schema.draft.ts)
- **规范性输入**: 领域规格 §2（九柱字段）、ADR-0002/0004/0010/0011 + 修订案 ADR-0019、Gate A 冻结条目 M1-M20/N1-N12、两卷参考研究
- **决策过程**: 两轮 grilling 共 14 问（Q1-Q14），全部由作者拍板

## 根部决策（Q1-Q7）

| # | 决策 | 选择 | 依据 |
|---|------|------|------|
| Q1 | 草案落点 | `docs/specs/kernel-schema.draft.ts` 单文件、零 import、strict 可编译；实现工单原样搬入 `@mozhou/kernel` | wayfinder plan-not-do；不建半拉子包 |
| Q2 | 字段命名 | camelCase | 与规格自身 `ChapterCommitPacket` TS 块一致；JSONL 键名跟类型走，无第二套映射 |
| Q3 | Scene 挂接 | 独立一等实体；OutlineGraph 层级收到 Chapter | 卷二 §A Novelcrafter 证据：Scene 是 Plan/Write/Chat/Review 贯穿同步单元，与大纲规划语义不同构 |
| Q4 | ID 形态 | 品牌化模板字面量 + 前缀 + ULID（`fact_01J9X…`） | 本地优先：Markdown/JSONL 内可 grep；品牌类型防串用；ULID 字典序=时间序 |
| Q5 | 保护/stale 机制 | 双轨：`AuthorProvenance{origin, protectedUserContent}` + `StaleMarker{reason, upstreamRefs, markedAt}` | ANWA #80/#90：来源不明导致保护失效；裸布尔答不了"为什么 stale" |
| Q6 | 冻结范围 | 九柱 + Scene + 卫星结构（五 delta 家族、DependencyManifest、StaleMarker、AuthorProvenance）一并冻结；Receipt 冻条目 schema + 枚举 | `ChapterCommitPacket` 引用全部 delta/manifest，不冻即把临场设计推给实现工单（违反地图 Destination 判据） |
| Q7 | 秘密建模 | 秘密即 TemporalFact（`secret.*` 谓词命名空间 + 高风险级）；KnowledgeState 引用保持单型 `FactId` | 秘密天然需要揭露时刻（=valid 区间终点）与知情矩阵，另建集合是重复建模 |

## 实体字段级决策（Q8-Q14 + 规格落定）

### TemporalFact

| 字段 | 类型 | 来源 | 备注 |
|------|------|------|------|
| `subject` | `EntityRef`（`char:`/`item:`/`location:`/`faction:`/`concept:` 命名空间字符串） | 规格 §2.3 + 卷二 §E.1 Codex 实体形态 | 角色等 Codex 实体不在九柱内，以稳定字符串引用 |
| `predicate` | `string`（秘密用 `SecretPredicate` = `` `secret.${string}` ``） | Q7 | |
| `value` | `string \| number \| boolean` | 本票定案 | 标量联合使 M2 数值断言硬门禁免解析、确定性比较 |
| `validFrom` / `validUntil` | `number` / `number \| null` | 规格 §2.3 / M4 | 区间含端点 |
| `importance` | `'trivial' \| 'notable' \| 'critical'` | 规格 §2.3 | |
| `riskClass` | `'low' \| 'medium' \| 'high'` | **本票新增** | 规格"Risk-Graded Commit Thresholds"的数据落点；N1 精神：门禁输入必须是数据不是现场判断 |
| `source` | 判别联合 `{kind:'chapter',chapterIndex} \| {kind:'outlineNode',outlineNodeId}` | 规格 §2.3（原文为含糊 string） | |
| `status` | `'planned' \| 'candidate' \| 'confirmed' \| 'rejected'` | ADR-0002 四态生命周期 | |
| `compactedIntoVolumeId` | `VolumeNodeId \| null` | **Q9** | 行保留纪律：压缩不删行（I6），active/compacted 是查询视图派生概念 |
| `provenance` | `AuthorProvenance` | **Q8** | 作者直接断言的正典事实 `origin='author'` + 保护位 true ⇒ 免疫自动改写 |

### KnowledgeState（一等存储实体，非 prompt 片段/派生视图 —— ADR-0019 §1）

| 字段 | 类型 | 来源 | 备注 |
|------|------|------|------|
| `factId` | `FactId`（单型，Q7） | 规格 §2.4 | |
| `holder` | `'reader' \| 'protagonist' \| \`char:${string}\`` | 规格 §2.4（原 entity_id） | 改名 holder 更准确（知情者） |
| `knownSinceChapter` | `number`（必填） | Q10 | |
| `knownSinceSceneId?` | `SceneId`（可选） | **Q10** | 多视角章节钉到场景，喂 ADR-0011 POV 切片 |
| `distortion?` | `string`（可选） | 规格 §2.4 | 畸变信念；I3：无自有状态机，引用事实 rejected 即级联失效 |

### Scene（新一等实体，Q3）

| 字段 | 类型 | 来源 | 备注 |
|------|------|------|------|
| `chapterOutlineNodeId` | `ChapterNodeId` | Q3 | |
| `orderIndex` | `number` | 章内序 | |
| `povEntity` | `'protagonist' \| \`char:${string}\`` | ADR-0011 / US7 | POV 声明是知识切片锚点 |
| `summary` / `beats[]` | `string` / `SceneBeat{description, intentionNote?}[]` | 卷二 §A/§E.1 | beats 不设 id（数组序即序；段落级稳定标识等真实需求） |
| `status` | `'planned' \| 'drafted' \| 'written'` | 本票定案 | |
| `provenance.protectedUserContent` | `boolean` | **Q8 工件级粒度** | true = 整场景人写；段落级块结构被否（外部编辑碎块身份，复杂度前置违反原则） |
| 正文 | **不在 Scene 上** | Q8 讨论 | 正文归 ChapterCommit.finalProse（双平面真源 = 章 Markdown 文件）；commit 不可变性即正文最强保护 |

### OutlineNode（层级 Book→Volume→Arc→Chapter，Q3）

| 字段 | 类型 | 来源 | 备注 |
|------|------|------|------|
| `nodeType` / `parentId` / `orderIndex` | 四层判别 + 树位 | 规格 §2.2 | |
| `goal/conflict/climax/outcome` | 可选 string | 规格 §2.2 | |
| `dependencyNodeIds` | `OutlineNodeId[]` | 规格 §2.2 / M1 | 影响分析=写入时建边 |
| `status` | `'drafted' \| 'active' \| 'completed' \| 'stale'` | 规格 §2.2 | `'stale'` 原规格已有，与 I2 同轨 |
| `stale` | `StaleMarker \| null` | **Q5** | |
| `provenance` | `AuthorProvenance` | Q8 | 作者规划的大纲受保护；AI 代拟 origin='ai' |

### NarrativePromise / RelationshipState / TimelineEvent / StyleProfile

- **NarrativePromise**：规格 §2.5 字段原样冻结（八型六态）；`payoffNotes` paid_off 时必填（运行时校验）；`targetChapter: number | null` 支持∞期承诺。
- **RelationshipState**：规格 §2.6 原样；`relationshipType` 开放词表不做封闭枚举（卷二 §E.3"禁封闭六类型枚举"同精神）；`affinityScore` [-100,+100] 运行时校验。
- **TimelineEvent**：`worldTimeLabel: string` + `worldTimeOrder: number`（**Q12**）——历法不可解析，M2 单调性硬门禁落在序数上；`impactFactIds` 承接事件→事实因果。
- **StyleProfile**：`scenarioType: 'action' \| 'dialogue' \| 'romance_emotion' \| 'exposition_worldbuilding'`（**Q13 补判别键**，US23 EMA 按场景隔离的前提）；句长分布按字符计桶（中文网文）；规格 `version` 字段由 `revision` 承担（改名）。

### ChapterCommit 与卫星结构

| 结构 | 决策 | 来源 |
|------|------|------|
| `CommitDelta<T,IdT>` | 统一 `{created, updated, retiredIds}`，created/updated 内嵌完整记录 | 事件溯源自足性：commit 即 Ledger 回放的最小事件（M3/卷二 §J.1 四表投影） |
| 五 delta 家族 | fact/relationship/knowledge/promise/timeline 全部 `CommitDelta` 形状 | 规格 §Implementation Decisions 的 `ChapterCommitPacket` |
| `DependencyManifestEntry` | `{kind, id, revision}` | **Q14** 整数 revision 钉版本（M4"精确版本读取"）；完整性哈希由数据平面落盘时另算 |
| `revision` | 全实体统一 `KernelEntityHead.revision`；不可变实体恒 0（I5） | 单一 ref 形状，免联合类型 |
| `receiptId` | commit ↔ receipt 双向追溯 | ADR-0019 §2 Receipt 一等产物 |
| `contentHash` | SHA-256 | ADR-0010 外部对账基准 |

### ContextReceipt（预留冻结，Q6）

| 字段 | 类型 | 来源 |
|------|------|------|
| `entries[].assemblySource` | `'structural' \| 'keyword' \| 'graph_khop' \| 'embedding' \| 'manual_pin'` | **预留①装配来源**：M5 双轨 + k-hop 触发源必入候选集（卷二 §D.3） |
| `entries[].exclusionReason` | 六值枚举（budget/relevance/pov/interval/quota/duplicate） | **预留②淘汰原因**：NAI Inclusion/Reason 产品化先例；`story_text_quota_protected` 对应 ADR-0019 正文保底配额 |
| `parseFailures[]` | `{source, detail}` | **预留③解析失败**：NovelForge `budget_stats` 恒 `{}` 桩的反面教材 |
| `storyTextQuota` | `{reservedTokens, actualTokens}` | ADR-0019 §2 正文保底配额 |
| `assembledBy` | 恒 `'server'`（字面量类型） | N10：类型层面使客户端装配成为非法状态（I4） |
| `recomputationHash` | `string` | 可复算可 diff（ADR-0019 §2） |
| 编译器内部机制 | **不在本票冻结** | Phase 2 Context Compiler 工单的领地 |

### ContextReceipt 受控增补（Q15/Q16，工单 #9 收敛定案）

| 字段 | 类型 | 决策与出处 |
|------|------|------|
| `entries[].activation?` | 判别联合 `ActivationEvidence`（keyword.keys / graph_khop{sourceEntity,hops,score} / embedding.score / manual_pin） | **Q15**：NAI Context Viewer Key 列的类型化对应物——「为何成为候选」是可解释性契约的另一半；拒绝词法压缩串（house style 是品牌类型+判别联合）；structural 恒 undefined，双通道合并记胜出通道证据 |
| `replayInputs` | `ReplayInputs`（版本组 + 竞争池候选终序清单含 score/contentDigest + 结构层/storyText digest） | **Q16**：可复算 = 归档最小重放输入面——relevanceScore 是召回时点产物非实体属性，只存摘要则索引漂移后终序永久不可恢复；内容本体不内嵌（真源唯一）；复算边界 = 预算装配四阶段，recall_filter 透传不在契约内 |
| `inputsDigest` | `string`（必填） | 恒 = `sha256(canonicalJson(replayInputs))`（INV-R6）；实现未启动无存量数据，不留兼容灰区 |
| 物理存储 | `.mozhou/receipts/rcpt_<ULID>.json` 一证一文件 + events 指针事件 | ADR-0021：守目录树 v2 冻结（追踪流行级对账语义不适用于凭证）；崩溃一致序先证后指针；详见 [context-receipt-physical-format-spec](./context-receipt-physical-format-spec.md) |

## 相对规格的显式变更清单

1. **新增字段**（规格 §2 未有）：`TemporalFact.riskClass`、`TemporalFact.compactedIntoVolumeId`、`TemporalFact.provenance`、`KnowledgeState.knownSinceSceneId`、`Scene`（整实体）、`OutlineNode.stale/provenance`、`ChapterCommit.receiptId`、Receipt 三预留字段组。
2. **改名**：`entity_id`→`holder`；StyleProfile `version`→`revision`；`source: string`→判别联合 `FactSource`。
3. **层级修正**：OutlineGraph 五层（…→Scene/Beat）→ 四层（…→Chapter）+ Scene 独立实体（卷二 §A 修正信号）。
4. **秘密建模**：CONTEXT.md "fact 或 secret" 双型引用 → 秘密即事实（`secret.*` 谓词 + 高风险级）。

## 验收对照（地图 Destination 判据）

- [x] KnowledgeState 一等 Schema：独立 id/主键/投影行，非派生视图（ADR-0019 §1）
- [x] Scene 一等实体：beats/summary/POV 全落位（卷二 §A）
- [x] protectedUserContent + stale 传播位：双轨制落类型（ADR-0019 §4 / ANWA 教训）
- [x] Receipt 预留：装配来源/淘汰原因/解析失败三组字段 + 配额 + 服务端装配不变量（ADR-0019 §2）
- [x] 实现工单领取后零临场设计决策：九柱全部字段有类型、有出处、有不变量
