# W3 实施报告：操作幂等与保存路径 journal（关闭 ADR-0035 挂账）

- **日期**：2026-10-05（报告补写；实施于 2026-10-03 前后，见 ADR-0035 与 evidence/w3-operations/）
- **目的**：消除 [ADR-0035](adr/0035-operation-idempotency-and-reconcilable-write-results.md)「挂账与未验证」第 3 条——**「保存路径是否引入 journal：本 ADR 的记录按『提交路径』落地；草稿保存的原子性范围以 W3 实施报告为准**」。本报告即该报告：记录保存路径 journal 的当时决策、理由与验证证据。
- **性质**：实施报告（记录已发生的事实与决策依据），不引入新决策、不改既有 ADR 决策。
- **术语**：按 [`GLOSSARY.md`](../GLOSSARY.md)；「守卫/检查」表述遵循 Part 2 §2.2（禁用「门禁/闸门」）。

## 1. 结论先行

**草稿保存（saveProseDraft）在携带操作身份（operationId）时已引入轻量 journal（journalVersion 2）**，与提交路径共用同一恢复机制 `recoverPendingCommit`；不携带 operationId 的旧客户端保存行为完全不变（无 journal）。线性化点是**正文文件的原子替换**（相位保持 draft，无「翻转」），前滚/回滚两向恢复语义与提交路径一致。由此 ADR-0035 §6.4.4（规划）第 4 条「草稿保存也需要可恢复的意图/结果记录」已落地，该挂账**关闭**。

## 2. 保存链路事实（file:line 均为 packages/data-plane/src/chapter.ts）

保存路径带 operationId 时的步骤（`saveProseDraft`，chapter.ts:1214-1326）：

1. **幂等前置检查**先于新建/相位/revision 守卫：同 ID 同摘要回放原结果（chapter.ts:1219-1239）——「同一操作的成功结果不因章节此后被再编辑或被提交而否认」。
2. 新建语义走 `createChapterDraft`（章已存在抛 `ChapterExistsError`，chapter.ts:1243-1246）；更新路径依次过相位守卫（chapter.ts:1250-1252）与 revision 比对（chapter.ts:1253-1255，失配抛 `ProseRevisionConflictError`，零盘上变更）。
3. 写前哈希守卫 + `confirmExternalOverwrite` 逃生位（chapter.ts:1256-1262）。
4. 正文按 `normalizeProseBody` 规范化后渲染（chapter.ts:1264-1271）。该函数是**写入器与请求摘要共用的单一规范化点**（chapter.ts:282-287）——ADR-0035 D6 硬约束：若摘要对补换行前的正文计算，「少一个末尾换行」的重试会被误判为不同意图。
5. **写轻量 journal（v2）**（chapter.ts:1273-1294）：
   - `journalVersion: 2`，`commitId: ''`（保存无提交，空串占位，字段形状不变，chapter.ts:268-269）；
   - `originalProseSha256` = 写前盘上正文摘要（回滚向判别锚）；`stagedProseSha256` = 渲染后正文摘要（前滚向判别锚）；
   - `appends` 只含**一个空载荷**（`payloadBase64: ''`）的 events 目标（`kind: null`、`baseSeq: -1`、`relPath: .mozhou/events.jsonl`，chapter.ts:1277-1283）——既满足 journal 的集合不变量「恰好一个 kind=null 目标」（chapter.ts:447-456），又不产生任何字节变化；
   - `operation` 字段携带完整操作身份（chapter.ts:1292）。
6. **线性化点：正文原子替换**（chapter.ts:1296，`atomicWriteFileSync` tmp→fsync→rename）；随后刷新 manifest 基线（chapter.ts:1297-1298）。
7. **结果记录写在删 journal 之前**（chapter.ts:1300-1313）：`writeOperationRecordIfAbsent` 后 `unlinkSync` journal——与提交路径同一恢复单元顺序（chapter.ts:1095-1111 同构）。

### 恢复语义

恢复入口 `recoverPendingCommit`（chapter.ts:547-582）对保存 journal 与提交 journal 一视同仁：

- **回滚向**（盘上正文 sha == `originalProseSha256`，即中断发生在正文替换前）：`recoverBackward` 截回基线、清临时文件、删 journal、**不写**结果记录（chapter.ts:703-722）——事务从未提交，符合 ADR-0035 D2「回滚恢复不写」。
- **前滚向**（盘上正文 sha == `stagedProseSha256`，即中断发生在正文替换后、结果记录落盘前）：`recoverForward` 补齐追加目标（空载荷为无操作）、投影重放、刷新 manifest 并回读核对，然后**幂等补写结果记录**（chapter.ts:759-763 第 4.5 步）再删 journal。补写记录由 `buildOperationRecord` 从**盘上正文**读取 revision/body（chapter.ts:774-792），与正常路径同源；`commitId === ''` 时结果记录不含 commitId 字段（chapter.ts:788）。
- 正文 sha 与两个锚都不匹配 → 抛可定位冲突、journal 与原件保留（chapter.ts:578-581）——外部编辑撞进崩溃窗口时宁败不脏。

## 3. 当时的决策与理由

| # | 决策 | 理由 |
|---|---|---|
| D-1 | 保存路径**引入** journal（而非只靠结果记录） | 规划 §6.4.4 第 4 条要求「操作结果纳入同一恢复事务：草稿保存也需要可恢复的意图/结果记录」。若无 journal，进程死在「正文已替换、结果记录未写」窗口时，重试会把已成功的保存再执行一遍（revision 重复 +1），ADR-0035 §6.4.4 的两条不变量（不存在「记录说成功、正文没提交」，也不存在「正文提交了、请求身份丢了」）在保存路径上不成立。 |
| D-2 | journal 形状**复用 v2 全量结构**：单空载荷 events 目标，而非发明第三种「保存 journal」形状 | 复用让 `assertJournalShape`（chapter.ts:339-472）与 `recoverPendingCommit` 的既有校验/恢复逻辑零分叉即可覆盖保存 journal，避免维护两套恢复算法；空载荷满足集合不变量又零字节副作用。 |
| D-3 | 线性化点 = 正文原子替换；相位保持 draft，无「翻转」 | 保存不改相位，提交路径的「相位翻转」退化为覆盖写；rename 是单文件原子可见点（chapter.ts:234-237），盘上正文只可能处于「旧内容」或「新内容」两态，恰与两个 sha 锚一一对应。 |
| D-4 | 结果记录从**盘上正文**同源读取（恢复路径），正常路径从请求值计算 | 恢复时正文已在线性化点落盘，读盘即与真实状态一致，避免恢复路径维护第二份真相。 |
| D-5 | 不带 operationId 的保存**不写 journal**（chapter.ts:1276 条件） | ADR-0035 Consequences：旧客户端行为完全不变，且明确不承诺跨重启去重——无身份则无「同一意图」可言，journal 只会增加写放大。 |

## 4. 验证证据

### 4.1 本报告撰写时实跑（2026-10-05，命令与结果）

- 命令：`pnpm vitest run packages/data-plane/src/operation-idempotency.test.ts packages/data-plane/src/recovery-reentry.test.ts`（仓库根执行）。
- 结果：**2 个文件、52 用例全部通过**（operation-idempotency 9 + recovery-reentry 43，Duration 4.01s，退出码 0）。

### 4.2 覆盖映射（测试名 → 本文论断）

- 保存幂等与回放、摘要规范化、同 ID 不同摘要拒绝、他人相同正文不回放、并发同 ID 单次生效：`operation-idempotency.test.ts:41-175`（「W3 操作幂等 · 草稿保存」5 用例）。
- 四元组作用域（他人同 ID → `OperationScopeMismatchError`、零盘上变更）：`operation-idempotency.test.ts:177-226`。
- 提交路径崩溃前滚恢复补写结果记录 + 跨重启回放：`operation-idempotency.test.ts:254-304`。
- journal v1/v2 读端兼容与 v2 形状校验（含 journalVersion=3 拒绝）：`recovery-reentry.test.ts:445-504`、chapter.ts:344-365。
- 恢复重入收敛、损坏/冲突保留证据、集合不变量、临时文件清扫：`recovery-reentry.test.ts` REC-01～REC-04 与原子写套件（43 用例）。

### 4.3 明确未验证（不得当作已保障）

1. **保存路径 journal 的崩溃注入恢复没有专门用例**：`saveProseDraft` 没有 `onStage` 故障注入钩子（提交路径有，chapter.ts:799-806）；`recovery-reentry.test.ts` 的 REC-01～04 全部构造自提交路径 journal，「保存 journal 触发 recoverPendingCommit 前滚/回滚」这条具体路径**未被任何测试直接执行过**。其正确性目前依据是：恢复机制与 journal 形状校验与提交路径完全共用（同一函数、同一校验器，且均已被 52 用例覆盖）——这是**结构等价论证，不是实测证据**。补测建议：手工放置保存形状 v2 journal（含/不含结果记录两种盘面）后调 `recoverPendingCommit`，断言记录补写与 journal 移除；或给 `saveProseDraft` 增加 onStage 钩子。
2. **掉电级（进程崩溃之外的介质层）语义未实测**：由 `atomicWriteFileSync`（tmp→fsync→rename，chapter.ts:18-19、atomic-write.ts:42-52）原语承担，与全仓一致，无掉电复现实验。
3. **旧二进制遇 v2 journal 拒写**仍为源码阅读证据（chapter.ts:344-349 版本守卫），未搭回退实验——ADR-0035 挂账第 1 条原样保留，本报告不关闭它。
4. hosted 跨主体作用域拒绝未端到端（ADR-0035 挂账第 2 条，原样保留）。

## 5. 挂账处置结论

- ADR-0035「挂账与未验证」第 3 条（保存路径是否引入 journal）：**已由本报告关闭**——答案为「已引入轻量 v2 journal，恢复机制共用，§4.3 列明未验证残余」。ADR 文件「挂账」节已追加指向本报告的注记（追加式更正，不改动原决策文字）。
- 其余挂账条目（旧程序拒写回退实验、hosted 端到端、开销实测口径、清理策略）**不在本报告范围**，维持原状。
