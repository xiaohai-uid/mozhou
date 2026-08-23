---
date: 2026-08-23
description: '工单 #9 产出：Context Receipt 物理格式与 EventLedger 关系定案——独立 canon 流+指针事件、可复算=决定性+漂移检测、两文件崩溃一致序，伪代码级'
tags:
  - project-note
  - mozhou
---

# Context Receipt 物理格式与 EventLedger 关系规格

> 相关笔记：[[token-budget-assembly-spec]] · [[kernel-schema-draft]] · [[ADR-0007 Novel Runtime Event Architecture]] · [[ADR-0006 Local Data Plane]] · [[MoZhou Wayfinder 地图]]

> 工单 [#9](https://github.com/xiaohai-uid/mozhou/issues/9) · 决策记录见 ADR-0021 · 前置：[Token 预算装配算法规格](./token-budget-assembly-spec.md)（#8）
> 边界：本票只裁 **物理存储形态、ledger 关系、可复算/diff 精确语义**；receipt 条目 schema 与装配算法归 #8（已冻结），UI 回放归 Phase 6。

## 0. 一句话

Receipt 是**独立的一等 canon 流**（每书一 JSONL、append-only），EventLedger 只持**指针摘要**；
**可复算 = 决定性 + 漂移检测**（不归档原始输入快照）；diff = 按 `identifier` 对齐的条目级比较。

## 1. 存储位置与文件形态

```
{书名}/
├── 追踪/
│   ├── 事实.jsonl … 时间线.jsonl      # 五族既有追踪流
│   └── context-receipts.jsonl         # ★ 本票新增：receipt 权威流
└── .mozhou/
    ├── events.jsonl                   # 事件主干（ADR-0007），只存指针摘要
    └── runtime.sqlite                 # 可丢弃投影，含 receipts 查询索引
```

- **一行一张 receipt**，UTF-8，append-only，永不改写历史行。装配 bug 修复后差异体现在后续新 receipt，不做追溯改写。
- 行内容 = **canonical JSON**：键字典序排序、紧凑分隔符 `,`/`:`、无行尾空白、`\n` 收尾——这是 `recomputationHash` 跨行稳定的前提。
- `entries[]` 排列恒为确定性序：结构层 → 预订序（reserve 阶段淘汰者**原位保留**，included=false）→ converge 收缩/淘汰者按收敛迭代序 → story_text。
- 归属理由：ContextReceipt 是冻结 schema 的 kernel entity（不可变、version≡0），与五族追踪流同平面同待遇；作者可在 Obsidian/Git 里直接审「AI 那章看到了什么」。

## 2. 与 EventLedger 的关系：独立流 + 指针

`ContextCompiled` 事件 payload **不内联 receipt 体**，只携带指针摘要：

```jsonc
{
  "type": "ContextCompiled",
  "receiptId": "rcpt_01J…",
  "taskType": "chapter_writing",
  "chapterIndex": 45,
  "recomputationHash": "sha256:…",
  "totalTokens": 8192,
  "storyTextQuota": { "reservedTokens": 3200, "actualTokens": 3105 }
}
```

- 拒绝同流混排：record type 不同（不可变产物 vs 过程事件），内联迫使每个事件消费者（Session Replay、Flywheel 统计）拖运大对象，回放过滤与 diff 双双变脏。
- **崩溃一致序**：

  ```
  append(receipts.jsonl, receiptLine)   # 先
  append(events.jsonl, pointerEvent)    # 后
  ```

  中间崩溃只产生**孤儿 receipt**（合法，等后续引用或留档）；反向的**悬空指针非法**——校验器扫到 events 引用了流中不存在的 receiptId 即报错。
- SQLite 投影索引（可丢弃，重建=全量扫描 jsonl）：

  ```sql
  receipts(receipt_id PK, chapter_index, task_type,
           created_at, total_tokens, recomputation_hash, line_offset)
  ```

## 3. 「可复算 / diff」的确切含义

### 3.1 可复算 = 决定性 + 漂移检测

**不**归档原始输入快照（候选全文/正文切片），体积随生成次数线性膨胀且与正文重复存储；
**也**不停留在无验证机制的口头确定性。receipt 固化 `inputsDigest`
（sha256，覆盖 configVersion / tokenizerVersion / modelProfileId / 结构层 digest /
候选集 digest 含 relevanceScore / storyText digest），配合 DependencyManifest 的依赖内容哈希：

```
verify(receipt):
    fresh = recomputeInputsDigest(manifest 引用的实体当前版本)
    if fresh ≠ receipt.inputsDigest:
        raise InputDrift(变更依赖清单 ← manifest 逐项哈希比对定位)   # 显式报漂移
    packet2 = assemble(重建输入)                                      # 输入未漂移 ⇒ 必然逐字节复现
    assert packet2.receipt.recomputationHash == receipt.recomputationHash
```

语义一句话：**给定未漂移输入必得同 hash；发生漂移时可定位到具体依赖**。

### 3.2 diff = 条目级对齐比较

两张 receipt（典型：同章两次生成、或相邻章回归排查）按 `identifier` 对齐：

| 迁移 | 判读 |
|---|---|
| included→excluded | 该条目被挤出（看 exclusionReason 变化定位预算/配额原因） |
| excluded→included | 召回扩圈或预算松绑 |
| tokens Δ 大 | 条目内容或截断位变化 |
| trimType 变化 | 原子位调整或截断阈值触发 |

物理格式为此只需 §1 的 canonical JSON + 确定性条目序（#8 INV-2 保证），无需额外索引结构。

## 4. Schema 增补（纯增量，随本票入 `kernel-schema.draft.ts`）

```ts
// ReceiptEntry 增补：
/** 激活证据（工单 #9）：经召回通道进入候选的凭据压缩串，
 *  词法 key:<命中词> | khop:<源实体>·<n>hop | emb:<邻居id> | pin */
readonly recallEvidence?: string | undefined;

// ContextReceipt 增补：
/** 输入固化摘要（工单 #9）：漂移检测锚点，语义见 context-receipt-physical-format-spec §3.1 */
readonly inputsDigest: string;
```

- `recallEvidence` 对标 NAI Context Viewer 的 Key 列（误召/漏召诊断的实际抓手），
  补齐 Receipt「Why AI saw this」的最后一环；可选字段，structural 层可缺省。
- `inputsDigest` 为必填——实现未启动，无存量数据，不留兼容灰区（原则 1）。

## 5. 保留策略

v1 **全保留**：被 ChapterCommit 引用者天然永久；候选被拒、review/fact_extraction 的
receipt 同等持久——后者正是「为什么这次审查没发现」的事后取证材料。
清理策略划出票外（地图已将性能调优压至 Gate B 之后）；prune 作为维护趟扩展点预留
（判据：`ChapterCommit.receiptId` 引用图 + 创建时间）。

## 6. 不变量

| 编号 | 不变量 |
|---|---|
| INV-R1 | 先 receipts.jsonl 后 events.jsonl；悬空指针非法，孤儿 receipt 合法 |
| INV-R2 | append-only，不改写历史行；修正=追加新 receipt（新 ULID） |
| INV-R3 | 全仓 canonical JSON 单一规范（键字典序/紧凑分隔符），哈希稳定的前提 |
| INV-R4 | SQLite receipts 索引为投影，删除后扫描 jsonl 可 100% 重建 |
| INV-R5 | receipt 不含正文段落——只有 id / 计数 / 哈希 / 枚举 / 证据串（P0 正文不出域，receipt 本身亦保持轻量可 diff） |
