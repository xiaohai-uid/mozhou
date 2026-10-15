# Phase 1 Data Model: 作者数据完整性与出站边界加固

**Feature**: `005-author-data-boundary-hardening` | **Date**: 2026-10-12

> 本轮**不新增**实体，只对既有持久结构做两处扩展与一处新契约（标 **新增/变更**）。路径均相对书根 `<bookRoot>`。

## E1 采纳意图记录 (Accept Intent) — **变更：格式 v1 → v2**

**落点**: `.mozhou/accept-intents/<candidateId>.json`（一候选一文件，原子写）

| 字段 | 类型 | 说明 |
|---|---|---|
| `schemaVersion` | `1 \| 2` | **变更**：写入恒为 `2`；读取接受 `1` 与 `2` |
| `candidateId` | string | 候选身份（与文件名同源） |
| `idempotencyKey` | string | 幂等键；同键换候选即拒 |
| `bookId` / `chapterIndex` | string / number | 书与章身份 |
| `before` / `after` | `{ revision, sha256 }` | 写入前/后正文指纹；`after` 是崩溃恢复的比对基准 |
| `state` | `'intent' \| 'done'` | `intent` = 已声明意图、正文可能未落；`done` = 正文已落 |
| `confirmPartial?` | boolean | 半稿采纳的显式确认标记 |
| `operation?` | `{ operationId, principalId, requestDigest, taskId? }` | **新增（v2）**：原始操作身份快照。恢复/回放补写结果时**只**用这里的身份 |

**状态转移**: `（无记录） → intent → done`。恢复窗口判定：盘面指纹等于 `after` ⇒ 正文已落、补 `done`；等于 `before` ⇒ 未落、可安全继续；两者都不是 ⇒ 拒绝覆盖（冲突）。

**校验规则**: `schemaVersion ∉ {1,2}` 或 `state ∉ {intent,done}` 或 JSON 损坏 ⇒ 抛 `AcceptConflictError`（宁败不脏）。

**旧记录处理（关键）**: 记录缺 `operation` 块（v1，或由未携带操作标识的请求所写）时——
- 请求**不带**操作标识 ⇒ 按兼容路径继续（历史记录合法回放）；
- 请求**带**操作标识 ⇒ 拒绝绑定（不得把新操作认到旧记录上）。

## E2 操作结果记录 (Operation Record) — 未改格式，补齐写入时机

**落点**: `.mozhou/operations/<sha256(operationId)>.json`（一操作一文件）

| 字段 | 类型 | 说明 |
|---|---|---|
| `recordVersion` | `1` | 未变 |
| `operationId` / `operationType` | string | `operationType` 本轮相关取值 `'draft.accept'` |
| `principalId` / `bookId` / `requestDigest` | string | 作用域四元组 + 请求摘要 |
| `chapterIndex` | number | 作用章 |
| `state` | `'succeeded'` | 只有成功态 |
| `result` | `{ appliedRevision, appliedBodyHash, commitId? }` | 结果 |
| `recordedAt` | string | 仅可观测，不参与相等判定 |

**幂等写入**: 同 `operationId` + 同 `requestDigest` ⇒ 跳过；不同摘要 ⇒ 抛冲突（绝不覆盖）。

**本轮变更（时机）**: 正常完成、幂等回放、崩溃恢复三条出口**共用**同一补全逻辑——先写结果记录、再补任务关联，两者齐备后才返回采纳成功。

## E3 任务记录 (Task Record) — 未改

**落点**: `.mozhou/tasks/<taskId>.json`；`operationIds: string[]` 为操作关联集合，`linkTaskOperation` 幂等去重。本轮修复了「结果记录已写、关联未写」窗口的补写。

## E4 候选草稿 (Candidate Draft) — 未改

**落点**: `.mozhou/candidates/<id>.json`；关键字段 `text`、`contentState`、`taskState`、`canonState`、`acceptedRevision`、`generationEpoch`、`lastSequence`、`base`、`mode`、`selection?`。

**并发契约**: 该文件的读-改-写必须由调用方在同一书稿锁内完成。本轮把生成路径的读改写接入锁（**模型等待不入锁**），并在锁内复查取消。

## E5 草稿运行态 (Draft State) — **变更：候选私有状态与章指针分离**

**落点**: `.mozhou/drafts/candidates/<candidateId>.json` 保存每个候选的派生运行态；`.mozhou/drafts/<章号>.json` 保持既有格式，表示该章最近认领者的状态。两者都保持 `stateVersion: 1`，字段为 `status ∈ streaming|partial|complete`、`chars`、`appendedChars`、`reason?`、`candidateId?`。

**归属与写序**: 生产入口在同一书稿锁内初次认领章指针；之后先写本候选私有状态，只有章指针仍属于该候选才更新章文件。初次等锁期间已取消的任务不认领；备用 attempt 不再次认领。旧任务仍能记录自己的半稿，但不能覆盖新任务的章指针。模型等待在锁外。

**真实来源与消费**: 正文仍只由采纳落盘；运行态不是正文或事件的真源。`runDraftStep` 的生产调用传入本次 `candidateId`，只读取该候选状态；只有旧章文件身份相符才作为兼容回退。旧离线调用可省略该字段并继续读取章状态。

**兼容与恢复边界**: 候选标识复用既有 UUID 路径校验；不迁移、不删除旧文件。私有文件与章文件分别原子替换，二者不是一个事务；私有状态先落、指针未更新时不得借用另一候选的结果。本轮覆盖同进程所有权竞态与旧格式回读，未证明两次文件写之间的真实进程中断恢复。

## E6 事件账本 (Event Ledger) — **新增：物理完整性契约**

**落点**: `.mozhou/events.jsonl`（只追加）。**两种行格式**（既有，非本轮引入）：
- 任务事件行：`{ seq, schemaVersion, taskId, attemptId?, generationEpoch, sequence, event }`
- 平铺领域行：`{ seq, event }`（或领域自定义形状，如卷压缩事件）

**新增契约（恢复入口专用）**: 恢复前要求**每个非空行都是完整 JSON**且**末行以换行结束**；违反或读取失败 ⇒ 抛 `LedgerIntegrityError`，保持「停止发布」并保留原件。审计读（`readLedger`）仍保留「跳过撕裂行不阻断回读」的容忍口径——两者目标相反，不可互相套用。

**发布方状态机（本轮加固）**: `正常 → (追加失败) → 停止发布 → (账本核对+重建成功) → 正常`。追加失败时内存配对状态**不变**。

## E7 出站目标 (Outbound Target) — 非持久化

| 概念 | 说明 |
|---|---|
| 原域名 | URL 的 host；决定 Host 头、TLS SNI 与证书校验对象 |
| 已验证地址集合 | 一次解析的全部结果，逐条通过私有/环回/保留判定；连接固定到这一份 |
| 允许私有网络 | 仅部署者显式授权（本机模型端点）时成立；该分支不做公网校验，也不参与爬虫/检索 |

## 关系图

```text
Candidate Draft ──(采纳)──> Accept Intent ──(落正文)──> Prose Chapter (revision/sha256)
                                  │
                                  └──> Operation Record ──(link)──> Task Record
Event Ledger  ←──(任务事件)── 发布方        ←──(领域事件)── 领域提交协议（不经发布方）
Outbound Target ──(连接绑定)──> 上游（模型 / 爬虫 / 检索）
```
