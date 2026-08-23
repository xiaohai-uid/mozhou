---
date: 2026-08-23
description: '工单 #8 产出：Context Compiler Token 预算两阶段 Reserved 装配算法规格——三层预扣、序贯预订前缀语义、原子条目、正文保底配额，伪代码级'
tags:
  - project-note
  - mozhou
---

# Token 预算装配算法规格（两阶段 Reserved 装配）

> 相关笔记：[[kernel-schema-draft]] · [[kernel-schema-decisions]] · [[ADR-0019 Research-Driven Amendments]] · [[MoZhou Wayfinder 地图]]

> 工单 [#8](https://github.com/xiaohai-uid/mozhou/issues/8) · 决策记录见 ADR-0020 · 消费冻结 schema
> `kernel-schema.draft.ts §8`（`ReceiptEntry` / `ExclusionReason` / `storyTextQuota`）
> 边界：召回与打分归 #7（Context 查询 API）；Receipt 物理存储与 EventLedger 关系归 #9。

## 0. 算法一句话

**三层预扣 → 终态化 → 序贯预订（前缀语义）→ 放置收敛**。移植 NAI 两阶段 Reserved 分配，
增量：原子条目只免截断不免淘汰、淘汰序即预订序之逆、正文保底配额以「竞争池硬顶」实现。

## 1. 输入输出契约

```
assemble(task, modelProfile, recallResult, structural, storyText)
  → { packet: ContextPacket, receipt: ContextReceipt }
```

| 输入 | 说明 | 归属 |
|---|---|---|
| `task` | `CompileTaskType` + chapterIndex | — |
| `modelProfile` | `contextWindow`、tokenizer 标识与版本 | 模型注册表 |
| `recallResult.candidates` | 已激活候选：`{id(ULID), tier, channel, relevanceScore∈[0,1], pinned?, atomicOverride?, content}`；POV/区间/去重滤除已在查询层完成，被滤除者连同 `exclusionReason` 经 `recallResult.excluded` 原样透传进 Receipt（stage=`recall_filter`） | #7 产出 |
| `structural.sections` | Author Intent / 任务框架 / Scenario Style Profile，`assemblySource='structural'` | 上游固定注入 |
| `storyText` | 有序近期正文切片（章节续写语境） | 章节状态 |

## 2. 配置默认表（可覆盖，版本号参与 recomputationHash）

```yaml
budget:
  marginTokens: 64                      # M_margin，tokenizer 垫片
  outputReserve: { minTokens: 1024, ratio: 0.15 }   # R_out = max(min, ⌈ratio×W⌉)
  structuralCapTokens: 4096             # 结构层自身上限，超出=配置错误
  poolMinTokens: 512                    # B_pool 低于此值=结构层挤爆池，配置错误
  maxConvergeIter: 8
  quotaRatioByTask:                     # S_floor = ⌈ratio × B_total⌉
    chapter_writing: 0.40
    scene_beat: 0.30
    review: 0.15
    fact_extraction: 0.10
tiers:                                  # rank 小者优先；defaultTrim 层默认，atomicOverride 可逐条覆盖
  active_fact:       { rank: 1, defaultTrim: atomic }
  promise_due:       { rank: 1, defaultTrim: atomic }   # 仅 status∈{due} 的 Promise；未到期归 distant_recall 档
  world_rule:        { rank: 2, defaultTrim: truncated, truncateCap: 512 }
  rolling_recap:     { rank: 3, defaultTrim: truncated, truncateCap: 256 }
  distant_recall:    { rank: 4, defaultTrim: truncated, truncateCap: 128 }
```

## 3. 决定性契约

- 装配是 `(inputs, modelProfile, configVersion, tokenizerVersion)` 上的**纯函数**：无时钟、无随机、无哈希遍历序依赖。同输入必产出逐字节相同的 packet 与 receipt（`recomputationHash` 相等）。
- **Desirability 全序**（预订沿此序前进，淘汰即其逆）：

  ```
  order = sort(candidates, by: pinned DESC, tierRank ASC, relevanceScore DESC, id ASC)
  ```

  平局以 ULID 字典序收口——ULID 时间单调前缀使平局退化为「先创建者优先」，零额外状态。
- **Token 计量权威源**：服务端精确 tokenizer（模型 profile 绑定），条目终态化时计数并缓存；
  tokenizer 版本变更全量失效。估算器只许用于召回排序打分，**严禁进入预算核算路径**
  （NovelForge `budget_stats` 恒空桩的反面教材）。分隔符/模板开销计入所在条目，不设隐性全局开销。

## 4. Phase 0：三层预扣

```
W        = modelProfile.contextWindow
R_out    = max(cfg.outMin, ceil(cfg.outRatio × W))
B_total  = W − R_out − cfg.margin
B_struct = Σ tok.count(s.render())  ∀s ∈ structural.sections
S_floor  = ceil(cfg.quotaRatio[task.type] × B_total)
B_pool   = B_total − B_struct − S_floor        # 竞争池硬顶：设定永不越过此线

guard: B_struct > cfg.structuralCap 或 B_pool < cfg.poolMin
   → raise CompileConfigError（fail loudly，绝不静默挤压）
```

三层预扣（输出预留、结构层、保底配额）均不参与竞争。NAI 反面教训的根治点：
lorebook 可 "cancel out story text"，因为设定与正文抢同一个无保底的池子。

## 5. Phase 1：序贯预订（前缀语义）

预订前先**终态化**——每个候选在预订时刻就计算最终形态与最终 token 数，放置期不再有意外：

```
for e in candidates:
    e.finalText = render(e)                          # 含前后分隔符
    e.trimType  = e.atomicOverride ?? cfg.tier[e.tier].defaultTrim
    if e.trimType == 'truncated':
        cut = head(e.finalText, cfg.tier[e.tier].truncateCap)   # 截断留头
        e.trimType = (cut.len < e.finalText.len) ? 'truncated' : 'none'
        e.finalText = cut
    e.tokens = tok.count(e.finalText)

reserved = []; remPool = B_pool; remNoQuota = B_total − B_struct
for e in order:                                      # desirability 高→低
    if e.tokens ≤ remPool:
        reserved.push(e); e.reservedTokens = e.tokens
        remPool −= e.tokens; remNoQuota −= e.tokens
    else:
        reason = (e.tokens ≤ remNoQuota)              # Q4c 双原因码判定
               ? 'story_text_quota_protected' : 'budget_exhausted'
        emitExclusion(e, reason, stage='reserve')
        break                                         # ★ 序贯即止
# 循环走完未 break = 全员入选，无淘汰
```

- **前缀完备性（INV-2）**：入选 ⟺ 位于 reservationOrder 中「装得下的最长前缀」。
  任一条目入选蕴含所有更优条目已入选——Receipt 可据此做单调推理，diff 一目了然。
- **拒绝 skip-ahead**（大条目失败后继续试更小者）：破坏前缀不变量，入选集对尺寸分布敏感，
  receipt 难解释。浪费的池空间由 Phase 2 正文自然吸收（见 §6 不对称回收）。
- **pin ≠ 豁免**：pinned 仅把条目提到队首（多个 pin 之间仍按 tier/score/id 排）；
  单条 pin 超 `B_pool` 时照常出局并记原因码。
- **原子语义（Q3 定案）**：`atomic` 只免截断、不免淘汰——超预算时原子照样按序出局面
  （trimType 记 `'none'`、included=false），只是永不出现在 packet 里半截。
  否则原子总量超池时预算无解。

## 6. Phase 2：放置 + 收敛

分区布局固定（v1 不做 NAI key-relative 插入；条目预留可选 `anchorRef` 字段，v1 忽略，
作为后续增强接口——研究 D.3 迁移清单中「相对定位」由此承接）：

```
packet = [ structural… ] + [ reserved 按 tier 分组组内按 order ] + [ storySection ] + ⟨生成点⟩

availForStory = B_total − B_struct − Σ(reserved.tokens)
storyFinal = render(storyText)
if tok.count(storyFinal) > availForStory:
    storyFinal = tail(storyFinal, availForStory)     # 正文保尾：丢最旧留最新
    markTrim(storySection, 'truncated')

iter = 0
loop:
    used = tok.count(packet.render())
    if used ≤ B_total: break
    iter += 1; guard iter > cfg.maxConvergeIter → raise ConvergenceError（INV-5）
    victim = packet 中按 desirability 升序第一个可收缩者
    if victim 可再截（truncated 且未到下限）: shrinkHarder(victim); markTrim('truncated')
    else: evict(victim); emitExclusion(victim, 'budget_exhausted', stage='converge')
```

- 收敛触发源只有缓存漂移（实体改文后 token 缓存过期）与模板开销误差；预订用终态数后，
  正常路径零迭代收敛。
- **保底的不对称回收（Q4b 的机制化替代）**：竞争池有硬顶 `B_pool`（保底由此成立），
  正文无硬顶、可吸收池余量直至 `B_total`——短章省下的空间自动让给正文而非设定，
  无需补偿轮即消除主要浪费场景。被淘汰设定不回补（v1 定案，等压测数据再议）。

## 7. 保底核算与原因码

```
receipt.storyTextQuota = { reservedTokens: S_floor, actualTokens: tok.count(storyFinal) }
```

双原因码判定（§5 内联）：某条目装不进 `remPool` 但本可装入 `B_total − B_struct` 时，
它纯因保底配额被挤出 → `'story_text_quota_protected'`；连配额免除预算都装不下 →
`'budget_exhausted'`。两者互斥，判定点唯一（预订循环内）。

## 8. Receipt 发射

`ReceiptEntry.stage` 词表（编译器侧冻结，物理格式归 #9）：

| stage | 记录内容 |
|---|---|
| `recall_filter` | #7 透传的被滤除候选（pov_filtered / interval_not_active / duplicate / relevance_below_threshold） |
| `structural` | 结构层各 section（恒 included） |
| `reserve` | 预订成功者（reservedTokens=tokens）+ 序贯止步的首个落选者及原因码 |
| `converge` | 放置期被收缩/淘汰者及原因码 |
| `story_text` | 正文段（含截断标记） |

`recomputationHash = sha256(canonicalJson({configVersion, tokenizerVersion,
modelProfileId, inputsDigest, entries[], storyTextQuota, totalTokens}))`——同输入重算必相等。

## 9. 不变量与错误模式

| 编号 | 不变量 |
|---|---|
| INV-1 | 同输入 ⇒ 同 packet 同 receipt（决定性纯函数） |
| INV-2 | 入选 ⟹ 所有更优条目已入选（前缀完备性） |
| INV-3 | 设定总量 ≤ B_pool；正文恒有 ≥ S_floor 空间（结构层合法时） |
| INV-4 | packet 中不存在半截原子条目 |
| INV-5 | 收敛迭代有上界；超限 fail loudly，绝不静默截正文 |

错误模式（均为显式异常，禁止降级静默）：`CompileConfigError`（结构层爆池）、
`ConvergenceError`（迭代超限）、`TokenizerUnavailable`（模型无精确计量器则拒绝装配该模型）。

## 附录：已裁决的替代方案

| 备选 | 裁决 | 理由 |
|---|---|---|
| 单一手工 Insertion Order（NAI 原样） | 否 | 百万字规模不可维护（研究 §D.2③） |
| skip-ahead 填池 | 否 | 破坏前缀完备性，receipt 不可单调推理 |
| 短章补偿轮（回补被淘汰设定） | v1 否 | 保底靠预扣已完整成立；补偿是优化非正确性需求 |
| 估算器进预算核算 | 否 | 计量必须可复算；估算器仅限排序打分 |
| 原子条目免疫淘汰 | 否 | 原子总量超池时预算无解 |
