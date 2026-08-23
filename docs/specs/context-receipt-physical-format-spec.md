---
date: 2026-08-23
description: '工单 #9 产出（收敛定案版）：Context Receipt 物理格式与 EventLedger 关系——.mozhou/receipts/ 一证一文件+指针事件、可复算=归档最小重放输入面、崩溃一致序，伪代码级'
tags:
  - project-note
  - mozhou
---

# Context Receipt 物理格式与 EventLedger 关系规格

> 相关笔记：[[token-budget-assembly-spec]] · [[kernel-schema-draft]] · [[ADR-0007 Novel Runtime Event Architecture]] · [[ADR-0006 Local Data Plane]] · [[MoZhou Wayfinder 地图]]

> 工单 [#9](https://github.com/xiaohai-uid/mozhou/issues/9) · 决策记录见 ADR-0021 · 前置：[Token 预算装配算法规格](./token-budget-assembly-spec.md)（#8）
> 边界：本票裁 **物理存储形态、ledger 关系、可复算/diff 精确语义**；条目 schema 冻结在 #4（本票仅受控增补 Q15/Q16），UI 回放归 Phase 6。

## 0. 一句话

Receipt 是**一等审计凭证**，权威家在 `.mozhou/receipts/`（一证一文件，守目录树 v2 冻结）；
EventLedger 只持**指针摘要**；**可复算 = receipt 归档最小重放输入面**（任意时刻可逐字节重放预算装配阶段）；diff = 按 `identifier` 对齐的条目级比较。

## 1. 存储位置与文件形态

```
{书名}/
├── 追踪/                              # 五族既有追踪流（正典平面，行级对账语义）
│   └── …
└── .mozhou/                           # 运行时区：非正典、不参与对账（冻结）
    ├── runtime.sqlite                 # 可丢弃投影，含 receipts 查询索引
    ├── events.jsonl                   # 事件主干（ADR-0007），只存指针摘要
    └── receipts/
        ├── rcpt_01HX….json            # ★ 一证一文件，权威存储
        └── rcpt_01JY….json
```

- **归属理由**：目录树 v2（#6 冻结）已把 `.mozhou/receipts/` 划为「ContextReceipt 存档（审计产物）」。receipt 不上 `追踪/` 正典平面——追踪流挂行级 EXTERNAL_MODIFIED 对账语义（外部新增行会被验收为新正典实体），对不可变凭证是荒谬的；留在 `.mozhou/` 则天然豁免对账，手改 receipt 只会破坏 hash 封印而绝不触发合并提案。目录树零修订。
- **一证一文件**：访问模式是「按 id 点查 + 成对 diff」，不是顺序扫描；单证加载、两证对比都是单文件读；ULID 文件名字典序 = 时间序。
- **文件内容 = 稳定键序 + 缩进美化的 JSON**（UTF-8）：人可直接打开读（NAI Context Viewer 的产品定位）。哈希稳定性不靠文件字节——`recomputationHash` 按公式只对选中载荷做 canonicalJson（键字典序、紧凑分隔符），美化排版不影响。
- **entries[] 确定性序**（INV-2 白得的可读性）：结构层 → 预订序（reserve 阶段淘汰者原位保留，included=false）→ converge 收缩/淘汰者按收敛迭代序 → story_text → recall_filter 透传块殿后。
- **不可变（I5）**：永不改写已落盘 receipt；修正 = 新 ULID 新证。

## 2. 与 EventLedger 的关系：独立产物 + 指针事件

record type 不同（不可变一等产物 vs 过程事件），事件 payload **不内联 receipt 体**：

```jsonc
{
  "type": "ContextCompiled",
  "receiptId": "rcpt_01J…",
  "taskType": "chapter_writing",
  "chapterIndex": 45,
  "recomputationHash": "sha256:…",
  "totalTokens": 8192,
  "storyTextQuota": { "reservedTokens": 3200, "actualTokens": 3105 },
  "entryCount": { "included": 23, "excluded": 41 }
}
```

- 计数对 + 配额让 tail 扫 events.jsonl 即可做健康检查与飞轮统计，无需开文件。
- `GenerationStarted` 增加 `receiptId` 字段——compile→generation 链路闭合（否则回放只能靠时间窗猜）。两处均为 ADR-0007 的受控修订（"carrying" 表述同步改为引用语义）。
- **崩溃一致序（INV-R1）**：

  ```
  write(receipts/rcpt_<id>.json)        # 先
  append(events.jsonl, pointerEvent)    # 后
  ```

  中间崩溃只产生**孤儿 receipt**（合法，等后续引用或留档）；反向的**悬空指针非法**——校验器扫到 events 引用了流中不存在的 receiptId 即报错。
- SQLite 投影索引（可丢弃，重建 = 全量扫描 receipts/ 目录）：

  ```sql
  receipts(receipt_id PK, chapter_index, task_type,
           created_at, total_tokens, recomputation_hash)
  ```

## 3. 「可复算 / diff」的确切含义

### 3.1 可复算 = 归档最小重放输入面

复算契约覆盖**预算装配四阶段**（`structural/reserve/converge/story_text`）；`recall_filter`
条目是 #7 召回的透传记录，召回本身（图遍历 + embedding 索引）不承诺逐字节重放，不在契约内。

关键裁决：relevanceScore 是**召回时点产物而非实体属性**——只存摘要锚点而不归档分数，
embedding 索引一旦漂移，desirability 终序永久不可恢复，复算沦为空话。所以 receipt 内嵌
`replayInputs`（Q16，schema 见 §4）：版本组 + 竞争池候选终序清单（id/tier/channel/score/pinned/
atomicOverride/contentDigest）+ 结构层各 section digest + storyText 切片 digest。
内容本体一律不内嵌（真源唯一，P0 正文不出域）。代价 KB 级，与 receipt 本体同量级。

```
verify(receipt):
    for c in receipt.replayInputs.candidates:          # 漂移定位到具体依赖
        if sha256(currentContent(c.id)) ≠ c.contentDigest:
            raise InputDrift(c.id)                      # 内容变异/退役 ⇒ 显式失败
    packet2 = assemble(from replayInputs)               # 输入未漂移 ⇒ 必然逐字节复现
    assert packet2.receipt.recomputationHash == receipt.recomputationHash
```

语义一句话：**任意时刻拿 replayInputs 重跑装配必得同 hash；输入被改写则 fail loudly 且定位到条目。**

### 3.2 diff = 条目级对齐比较

两张 receipt（典型：同章两次生成、相邻章回归排查）按 `identifier` 对齐：

| 迁移 | 判读 |
|---|---|
| included→excluded | 该条目被挤出（看 exclusionReason 变化定位预算/配额原因） |
| excluded→included | 召回扩圈或预算松绑 |
| tokens Δ 大 | 条目内容或截断位变化 |
| trimType 变化 | 原子位调整或截断阈值触发 |

前缀完备性（INV-2）保证差异可定位到单一序位。物理格式只需 §1 的确定性条目序 +
稳定键序序列化；diff 工具本体（CLI/UI）出界归 Phase 6。

## 4. Schema 增补最终形状（纯增量，随本票入 `kernel-schema.draft.ts`）

```ts
/** ReceiptEntry 增补（Q15）——typed activation，对标 NAI Viewer Key 列 */
export type ActivationEvidence =
  | { readonly kind: 'keyword'; readonly keys: readonly string[] }
  | { readonly kind: 'graph_khop'; readonly sourceEntity: string; readonly hops: number; readonly score: number }
  | { readonly kind: 'embedding'; readonly score: number }
  | { readonly kind: 'manual_pin' };
// structural 条目恒 undefined；双通道合并分时记胜出通道证据，合并分看 relevanceScore

/** ContextReceipt 增补（Q16） */
readonly replayInputs: ReplayInputs;   // 必填：实现未启动无存量数据，不留兼容灰区
readonly inputsDigest: string;         // 必填：恒 = sha256(canonicalJson(replayInputs))
```

拒绝词法压缩串方案（`"khop:<源>·<n>hop"` 一类）：全 schema 是品牌类型 + 判别联合风格，
结构化证据才可机器查询；grep 友好性由 canonicalJson 文本自然保留。

## 5. 失败装配的留痕边界

`CompileConfigError / ConvergenceError / TokenizerUnavailable` 抛异常时**不产 receipt**
（异常点多发生在候选集成形之前，「失败凭证」只会是一堆空壳）；失败走 events.jsonl 错误
事件（带 task 上下文与原因码）。`parseFailures` 语义不变：仅表达成功装配内部的解析失败。

## 6. 保留策略

v1 **全保留**：被 ChapterCommit 引用者天然永久；候选被拒、review/fact_extraction 的
receipt 同等持久——后者正是「为什么这次审查没发现」的事后取证材料。清理策略压至 Gate B
之后实测再定；prune 作为维护趟扩展点预留（判据：`ChapterCommit.receiptId` 引用图 + 创建时间）。

## 7. 不变量

| 编号 | 不变量 |
|---|---|
| INV-R1 | 先写 receipt 文件后追加指针事件；悬空指针非法，孤儿 receipt 合法 |
| INV-R2 | receipt 落盘后不可变；修正 = 新 ULID 新证 |
| INV-R3 | 哈希一律走 canonicalJson（键字典序/紧凑分隔符）；磁盘文件为稳定键序美化排版，两者互不影响 |
| INV-R4 | SQLite receipts 索引为投影，删除后扫描 receipts/ 目录可 100% 重建 |
| INV-R5 | receipt 不含正文段落与条目内容本体——只有 id / 标量 / 计数 / 枚举 / 摘要（P0 正文不出域，receipt 保持轻量可 diff） |
| INV-R6 | inputsDigest ≡ sha256(canonicalJson(replayInputs))；漂移检测以此为锚 |
