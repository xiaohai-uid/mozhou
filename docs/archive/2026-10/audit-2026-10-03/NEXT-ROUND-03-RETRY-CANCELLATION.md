# 墨舟 (MoZhou / Novel OS) 技术规格说明书
# 阶段三：接口真幂等重试、冲突区分与全链路取消语义规范
# (NEXT-ROUND-03-RETRY-CANCELLATION.md)

- **文档类型**：系统接口行为语义、幂等重试与全链路取消技术规格说明书 (Technical Specification)
- **基线版本**：HEAD `90b45a1a1bf15a97b1cc690ad0b9872018aeebcb` / WORKTREE(42项未提交改动)
- **责任模块**：
  - 前端工作台交互：`apps/web/src/workbench/editor/ProseEditorPanel.tsx`, `apps/web/src/workbench/DialogueStream.tsx`, `apps/web/src/quality/QualityPanel.tsx`
  - 服务端 BFF 路由：`apps/web/server/routes/proseRoutes.ts`, `apps/web/server/routes/pipelineRoutes.ts`
  - 核心编排与数据平面：`packages/data-plane/src/chapter.ts`, `packages/pipeline/src/commit-orchestration.ts`, `packages/pipeline/src/draft-step.ts`, `packages/pipeline/src/draft-accept.ts`
- **关联缺陷**：`FINDINGS.md` F-05 (409 无法区分自身成功与并发冲突), F-06 (定稿提交缺少重试查询比对), F-07 (取消流式生成状态分裂与晚到隔离), F-08 (缺少分级重试退避策略)
- **编制依据**：`00-audit-charter.md`, `01-baseline-and-graph-gate.md`, `04-interface-contracts.md`, `06-verification-log.md` (probe-04, probe-05, probe-06), `07-crosscheck-review.md` 驳回项裁决

---

## 一、 问题背景与核心痛点剖析

在墨舟架构审计过程中，前续任务（t4 契约审查、t5 争议纠错、t6 故障探针、t7 对抗式复核）对全系统关键接口的行为语义进行了深度取证。审计确证：墨舟在核心写路径上全面引入了基于版本号比对（CAS）的防御性设计，有效杜绝了底层数据的静默破坏；然而，在**分布式系统与弱网环境下的客户端行为语义层面**，系统存在严重的「伪幂等（Pseudo-Idempotency）」与「取消状态分裂（State Divergence）」缺陷。

### 1.1 现状与矛盾：CAS 乐观锁与真正幂等的本质鸿沟
在当前实现中，服务端频繁将 `expectedRevision` 参数作为防止并发冲突的守卫（如 `saveProseDraft` 与 `commitChapter`）。然而：
> **「提供 expectedRevision 校验」$\neq$「具备幂等性保证」**。
> CAS 乐观锁只能回答「当前盘面版本是否等于调用方发起请求时的版本」，它无法回答**「如果版本变了，这个新版本是由本调用方上一次超时的请求写下的，还是由他人并发修改写下的」**。

当发生客户端超时、网络瞬断、移动端切后台或代理重连时，客户端以相同载荷发起重试，服务端直接抛出 HTTP 409 冲突，将正常的重发误判为并发争抢，导致作者遭遇不可理解的“冲突警告”，甚至被迫人工刷新并裁决并不存在的版本分叉。

### 1.2 场景一深度复盘：草稿保存超时重试误判冲突 (False Revision Conflict)
- **源码定位**：`packages/data-plane/src/chapter.ts:819-821` [`HEAD:90b45a1`], `apps/web/server/routes/proseRoutes.ts:303-314, 363-372` [`HEAD:90b45a1`]。
- **物理执行序列**：
  1. 客户端在章节当前处于 revision $r_0$ 时发起 `POST /api/chapter.prose.save`，传入 `{ root, chapterIndex: 1, body: "...", expectedRevision: 0 }`；
  2. 服务端正常处理，比对 `existing.revision (0) === expectedRevision (0)` 通过，原子写入磁盘，生成 revision $r_1$；
  3. 服务端向网络写回 HTTP 200 `{ ok: true, revision: 1, ... }`。然而在网络传输链路中发生 TCP 丢包、连接重置或客户端 5000ms 超时，客户端未能收到 200 响应包；
  4. 客户端按网络错误重试逻辑，使用原请求参数再次发起 `POST /api/chapter.prose.save`，依然携带 `expectedRevision: 0`；
  5. 服务端重新读取盘面，此时盘面为 revision $r_1$。比对 `existing.revision (1) !== expectedRevision (0)`；
  6. 服务端直接抛出 `ProseRevisionConflictError(expected: 0, actual: 1)`，BFF 路由向客户端返回 **HTTP 409 `PROSE_REVISION_CONFLICT`**；
  7. **前端灾难**：在 `apps/web/src/workbench/editor/ProseEditorPanel.tsx:173-177` [`HEAD:90b45a1`] 中：
     ```tsx
     if (error.name === 'PROSE_REVISION_CONFLICT' || ...) {
       setConflict(error.name)
       setSaveState({ kind: 'err', text: '保存被拒绝（冲突）：磁盘内容已有更新——外部修改或其他入口保存。磁盘原文与你的写作层文本都完整保留。' })
       return
     }
     ```
     界面弹红报错，提示作者“内容已被他人修改”。作者陷入极度恐慌，以为自己的工作被破坏，而实际上磁盘上的内容**恰恰就是作者本人刚刚写下的内容**！
- **缺陷根因**：`saveProseDraft` 既没有接收客户端幂等令牌（`clientRequestId`），也没有校验落盘正文的哈希一致性，导致无法区分“自身网络超时重发”与“外部并发写入”。

### 1.3 场景二深度复盘：定稿提交超时重试凭证丢失 (False Already-Committed Rejection)
- **源码定位**：`packages/pipeline/src/commit-orchestration.ts:204-206` [`HEAD:90b45a1`], `apps/web/server/routes/proseRoutes.ts:598-601` [`HEAD:90b45a1`]。
- **物理执行序列**：
  1. 客户端发起 `POST /api/chapter.commit`，传入 `{ root, chapterIndex: 1, expectedRevision: 2 }`；
  2. 编排层执行长耗时异步流水线（调用大模型提取实体与事实事实五族增量，耗时约 10~30 秒）；
  3. 最终通过 `commitChapter` 原子翻转正文 frontmatter 为 `phase: 'committed'`, 生成 `commitId: "cmit_a1b2c3..."`，追加事件，更新投影与 manifest；
  4. 此时若 HTTP 连接因反向代理超时（如 Nginx/Vite 默认 30s 代理超时）断开，客户端判定请求失败；
  5. 客户端或作者再次点击“定稿提交”发起重试；
  6. 服务端在前置守卫 `commit-orchestration.ts:204` 处读取盘面，发现 `proseFile.phase !== 'draft'`（当前已是 `committed`）；
  7. 服务端抛出 `ChapterPhaseError`，BFF 返回 **HTTP 409 `CHAPTER_ALREADY_COMMITTED`**；
  8. **前端灾难**：在 `apps/web/src/quality/QualityPanel.tsx:197-208` [`HEAD:90b45a1`] 中，直接将错误信息作为字符串抛给作者。作者不仅收不到定稿凭证 `commitId`，收不到叙事记忆增长摘要 `deltaExtraction`，而且该章状态卡死在“已提交”，客户端重试路径被彻底焊死！
- **缺陷根因**：缺少基于提交指纹或客户端请求标识的已提交状态查询对账机制，客户端拿不到上一次成功的确认凭据。

### 1.4 场景三深度复盘：前端 Abort 与服务端流式生成的取消语义分裂 (Split Cancellation State)
- **源码定位**：`packages/pipeline/src/draft-step.ts:226-253, 274-306` [`HEAD:90b45a1`], `apps/web/src/workbench/DialogueStream.tsx:383-397` [`HEAD:90b45a1`]。
- **物理执行序列**：
  1. 用户在前端点击“停止生成”按钮，`DialogueStream.tsx:385` 执行 `requestControllerRef.current?.abort()` 中断前端 `fetch` 连接；
  2. 服务端在 `apps/web/server/routes/pipelineRoutes.ts:626` 通过 `res.on('close', () => abortController.abort())` 捕获连接断开，并触发底层的 `AbortSignal`；
  3. 底层 `streamOpenAiChat` 成功终止了与远程大模型服务商的 socket 读取；
  4. 然而在 `packages/pipeline/src/draft-step.ts:233-252` 中：
     - 当检测到 `aborted()` 时，代码调用了 `cancelCandidate(opts.bookRoot, candidate.id)`，将 `.mozhou/draft_candidates.jsonl` 中的候选状态强制标记为 **`status: 'cancelled'`**；
     - 但紧接着在循环退出后（line 243），代码又调用了 `writeDraftState(opts.bookRoot, { status: 'partial', ... })`，将 `.mozhou/draft_state.json` 标记为 **`status: 'partial'`**！
     - 产生严重数据状态分裂：候选池中该候选是 `cancelled`（不可采纳），而运行状态文件中却是 `partial`（部分可用）；
  5. 更加严峻的是前端的不可达盲区：前端 `handleStop` 将本地状态置为 `partial: true`，但 `DialogueStream.tsx:438` 的采纳函数直接写死拦截：
     `if (... || draftTerminal?.partial === true) return;`
     前端根本没有提供传入 `confirmPartial: true` 的交互通路，导致被截断的优质半稿在前端实质上**不可采纳**，只能丢弃！

---

## 二、 系统级交互不变量 (Interaction & Idempotency Invariants)

为了彻底解决上述三大痛点，构建具备工业级鲁棒性的客户端-服务端交互行为语义，下一轮改造必须严格确立并遵守以下五大系统不变量：

### 不变量 INV-RETRY-1：自身成功识别不变量 (Self-Success Disambiguation Invariant)
服务端对于任何携带客户端请求唯一标识（`clientRequestId`）或内容哈希（`bodySha256`）的状态变更请求，必须具备区分**「本调用方上一尝试已成功落盘（Self-Success）」**与**「他人并发修改落盘（Foreign Conflict）」**的确定性判别能力。
- 若判定为自身成功，服务端**严禁返回 HTTP 409**，必须返回 **HTTP 200 OK 并附带 `alreadyApplied: true`** 及当时的真实落盘版本与状态。

### 不变量 INV-RETRY-2：幂等返回等价性不变量 (Idempotent Replay Equivalence Invariant)
对于任何已经成功执行的操作，使用完全相同的幂等凭证（`idempotencyKey` / `clientRequestId`）发起的重放请求，其返回给客户端的业务有效载荷（Payload）必须与第一次成功执行时**语义严格等价**：
- 包括但不限于：生成的业务版本号 `revision`、文件摘要 `contentSha256`、定稿标识 `commitId`、事件凭证 `receiptId`。
- 重放请求在服务端必须保证**零磁盘写入、零大模型重复调用、零新事件追加、零费用扣减**。

### 不变量 INV-RETRY-3：真实冲突零副作用不变量 (Zero Side-Effect on True Conflict Invariant)
当服务端判定确实发生外部并发冲突（`existing.revision !== expectedRevision` 且内容哈希不匹配，或正文被外部第三方编辑器修改 `PreWriteHashMismatch`）时：
- 服务端在进入核心写路径或耗费资源的 LLM 流水线之前，必须立即 Fail-Closed 拒绝；
- 拒绝时磁盘正文、正典追踪流、事件账本、SQLite 投影必须保持**绝对零字节变更**。

### 不变量 INV-CANCEL-1：取消物理隔离不变量 (Cancellation Physical Isolation Invariant)
当客户端显式取消（Abort）或网络连接断开时：
- 服务端必须立即停止向大模型服务商发起后续请求，并断开出站 Socket；
- 任何在断开后晚到的残留网络 Chunk，必须在内存缓冲边界被**确定性丢弃**，绝对不允许继续写入任何正典文件或候选持久化存储池；
- 绝对不允许未完成的取消操作污染正在运行的其他章节或后续批次。

### 不变量 INV-CANCEL-2：状态机单调终止不变量 (Monotonic Cancellation Termination Invariant)
候选工件（Draft Candidate）与章节运行态（Draft State）在经历取消流程后，其终态必须在全局存储中保持**单调一致**：
- 若属于“用户主动放弃”，两处均收敛为 `cancelled`；
- 若属于“断流/截断但保留半稿”，两处均收敛为 `partial`；
- 严禁出现一处存 `cancelled`、另一处存 `partial` 的状态分裂。

---

## 三、 草稿保存真幂等重试与冲突区分协议设计 (Save Draft Protocol)

### 3.1 协议升级：引入 Client Request Token 与内容指纹
对 `POST /api/chapter.prose.save` 接口契约进行向后兼容的严格增强：

#### 请求体增补字段
```ts
export interface SaveProseDraftRequestPayload {
  readonly root: string;
  readonly chapterIndex: number;
  readonly body: string;
  /** 作者实际读取并编辑的基线版本（必填整数 >= 0 或 null 表新建） */
  readonly expectedRevision: number | null;
  readonly title?: string;
  readonly confirmExternalOverwrite?: boolean;

  /* ---- 下一轮新增幂等控制字段 ---- */
  /**
   * 客户端每次显式编辑保存生成的唯一请求标识（UUID v4 或 ULID）。
   * 客户端在因超时、断网进行重试时，必须沿用相同的 clientRequestId。
   */
  readonly clientRequestId: string;
  /**
   * 客户端计算的请求正文 SHA-256 哈希值（64位小写十六进制）。
   * 服务端用于在版本号漂移时进行零副作用的自身成功比对。
   */
  readonly bodySha256: string;
}
```

#### 响应体增补字段
```ts
export interface SaveProseDraftResponsePayload {
  readonly ok: true;
  readonly chapterIndex: number;
  readonly revision: number;
  readonly phase: 'draft';
  readonly created: boolean;
  /** 标识本次响应是否由幂等重放命中返回 */
  readonly alreadyApplied: boolean;
  readonly authorEditSignal?: AuthorEditSignalView;
}
```

---

### 3.2 服务端三阶判别状态机 (Three-Tier Evaluation Matrix)

服务端在收到保存请求后，不再机械执行单薄的 `existing.revision === expectedRevision` 比对，而是执行严格的三阶判别状态机：

```text
[收到保存请求 (expectedRevision, clientRequestId, bodySha256)]
               |
               v
       [检查章是否已定稿?] ------ (是 committed) -----> [409 CHAPTER_COMMITTED]
               |
            (否 draft)
               v
     [expectedRevision 匹配?]
        /             \
      (是)            (否: 盘面 revision !== expectedRevision)
      /                 \
     v                   v
[写前哈希守卫检查]     [检查盘面当前状态与请求内容]
  - 匹配: 正常落盘 r+1   - 阶1: 是否命中 clientRequestId 幂等缓存?
  - 失配: 409 EXTERNAL   - 阶2: 盘面 revision === expectedRevision + 1
                         且 盘面 bodySha256 === request.bodySha256 ?
                                 /                \
                              (命中任意)         (均不命中)
                                /                    \
                               v                      v
                   [200 OK alreadyApplied: true]  [409 PROSE_REVISION_CONFLICT]
                   (确认为自身上一次超时落盘)     (确认为他人并发修改冲突)
```

#### 判别规则矩阵定义

| 序号 | 盘面现状特征 | 请求携带参数 | 判别结论 | HTTP 状态码 | 业务代码 / 动作 |
|---|---|---|---|---|---|
| **P-1** | `phase === 'committed'` | 任意 | 已定稿保护 | **409** | `CHAPTER_COMMITTED`（拒绝普通保存） |
| **P-2** | `revision === expectedRevision` 且 写前哈希匹配 | 任意 | **正常保存路径** | **200** | 写入盘面 `revision + 1`，更新幂等记账，返回 `alreadyApplied: false` |
| **P-3** | `revision === expectedRevision` 但 写前哈希失配 | `confirmExternalOverwrite !== true` | 外部并发改盘 | **409** | `PROSE_EXTERNAL_CHANGE`（提示外部编辑器修改） |
| **P-4** | `revision === expectedRevision` 但 写前哈希失配 | `confirmExternalOverwrite === true` | 作者显式强制覆盖 | **200** | 强制覆盖写入 `revision + 1`，刷新基线 |
| **P-5** | `revision !== expectedRevision` | 命中该章 `clientRequestId` 幂等记账 | **自身重试命中 (Token Match)** | **200** | **直接返回当前 revision，`alreadyApplied: true`，零写盘** |
| **P-6** | `revision === expectedRevision + 1` | 盘面当前 `bodySha256 === request.bodySha256` | **自身重试命中 (Content Match)** | **200** | **确证为自身上一请求已落盘，返回当前 revision，`alreadyApplied: true`** |
| **P-7** | `revision !== expectedRevision` | 未命中 P-5 且 未命中 P-6 | **真正并发版本冲突** | **409** | `PROSE_REVISION_CONFLICT`（他人或其他标签页已修改） |

---

### 3.3 零存储膨胀的内存+轻量意图落地结构
为了高效支持 P-5 与 P-6 的判别，同时避免引入复杂的第三方数据库或产生无限膨胀的垃圾文件，设计两级幂等记账机制：

1. **第一级：进程内 LRU 环形缓存 (In-Memory Hot Cache)**
   - 在 `apps/web/server/bookAccess.ts` 或专门的 `saveIntent.ts` 中维护每本书最近 100 次保存记录：
   ```ts
   interface RecentSaveRecord {
     readonly clientRequestId: string;
     readonly chapterIndex: number;
     readonly revision: number;
     readonly bodySha256: string;
     readonly savedAt: number;
   }
   ```
   - 内存查找开销为 $O(1)$，可在毫秒级拦截网络重发的超时包。
2. **第二级：磁盘轻量标记持久化 (Durable Chapter Meta)**
   - 在正文文件所在目录维护轻量级的 `.mozhou/chapters/ch_<index>_meta.json`，或直接在正文 Markdown 的 frontmatter 中记录最近一次写入的 `lastClientRequestId`：
   ```yaml
   ---
   mozhouId: ch_node_01j9x...
   revision: 3
   chapterIndex: 1
   phase: draft
   lastClientRequestId: req_01j9x...
   lastBodySha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
   ---
   ```
   - **自洽优势**：当 Node.js 进程重启或在测试多进程切换时，磁盘 frontmatter 随正文原子更新，天然具备故障自愈与跨进程一致性，无需额外维护散落的日志文件。

---

### 3.4 客户端自动重试与“读后再存”确定性修复算法

客户端（`ProseEditorPanel.tsx`）在接入真幂等契约后，重构保存时序：

```ts
// 伪代码实现：前端防冲突与幂等重试封装
async function executeRobustSave(text: string, currentExpectedRevision: number | null): Promise<SaveResult> {
  const clientRequestId = generateULID();
  const bodySha256 = await computeSha256(text);
  
  const maxAttempts = 3;
  let attempt = 0;
  
  while (attempt < maxAttempts) {
    attempt++;
    try {
      const response = await postWithTimeout('/api/chapter.prose.save', {
        root: book.root,
        chapterIndex,
        body: text,
        expectedRevision: currentExpectedRevision,
        clientRequestId,
        bodySha256,
      }, { timeoutMs: 5000 });
      
      return response; // 成功 (可能 alreadyApplied: true)
    } catch (err: any) {
      if (err.status === 409) {
        if (err.code === 'PROSE_REVISION_CONFLICT') {
          // 真正的冲突：读取最新盘面内容供用户裁决
          throw new TrueConflictError(err);
        }
        if (err.code === 'CHAPTER_COMMITTED') {
          throw new AlreadyCommittedError(err);
        }
        throw err;
      }
      
      // 遇到网络超时或 503 等瞬态错误，进行退避重试 (沿用相同的 clientRequestId 和 bodySha256)
      if (isTransientNetworkError(err) && attempt < maxAttempts) {
        await sleep(computeJitterBackoff(attempt));
        continue;
      }
      throw err;
    }
  }
  throw new Error('SAVE_TIMEOUT_AFTER_RETRIES');
}
```

---

## 四、 章节定稿提交重试与账本核验协议设计 (Chapter Commit Protocol)

### 4.1 编排层重试契约与 Commit Request Token 绑定
章节提交（`POST /api/chapter.commit`）作为全系统最高风险的写操作，必须杜绝因超时重发导致的重复 LLM 抽取与错误拦截。

#### 契约扩展字段
```ts
export interface ChapterCommitRequestPayload {
  readonly root: string;
  readonly chapterIndex: number;
  readonly summary: string;
  readonly expectedRevision: number;
  readonly usage?: readonly UsageFact[];

  /* ---- 下一轮新增重试控制字段 ---- */
  /** 客户端提交唯一流水号 */
  readonly clientRequestId: string;
  /** 拟定稿正文的 SHA-256，用于在 phase 变为 committed 时的归属对账 */
  readonly contentSha256: string;
}
```

---

### 4.2 提交状态查询与对账端点 (Commit Status Query Endpoint)

为了彻底解决“超时后客户端无法得知上一请求是否已经定稿”的问题，必须正式设立**轻量级提交对账查询接口**：

#### 路由契约定义
- **HTTP 方法与路径**：`POST /api/chapter.commit.status`
- **安全策略分级**：`'book'`（要求 `AuthorizedBook` 守卫）
- **请求体**：
  ```json
  {
    "root": "C:\\zcode\\novel-ai\\books\\bk_01...",
    "chapterIndex": 1,
    "clientRequestId": "req_commit_01j9x...",
    "contentSha256": "3a7b..."
  }
  ```
- **服务端处理逻辑**：
  1. 读取磁盘 `proseChapterPath(chapterIndex)`；
  2. 若 `scan.phase === 'draft'`：说明定稿未发生，返回 `{ ok: true, state: 'not_committed', currentRevision: scan.revision }`；
  3. 若 `scan.phase === 'committed'`：
     - 比对盘面正文哈希 `sha256Hex(scan.body)` 与请求的 `contentSha256`；
     - 读取最近一条 `ChapterCommitted` 事件行（`.mozhou/events.jsonl`）；
     - **确证对账**：若哈希一致，或者事件行记录的 `clientRequestId` 匹配，确证为**调用方自身的提交已经成功落盘**；
     - 返回 HTTP 200 并恢复完整提交回执：
       ```json
       {
         "ok": true,
         "state": "already_committed",
         "matched": true,
         "commitId": "cmit_01j9x...",
         "chapterIndex": 1,
         "contentSha256": "3a7b...",
         "committedAt": "2026-10-03T02:00:00.000Z",
         "message": "上一提交已成功入账，无需重试"
       }
       ```
     - 若哈希不一致且标识不匹配：说明该章已被其他协同者或重开后重新定稿，返回 `{ ok: true, state: 'already_committed', matched: false, error: '该章已被其他提交定稿' }`。

---

### 4.3 客户端 Commit 重试防重逻辑与状态恢复时序

```text
[作者点击「定稿提交」]
          |
          v
[生成 commitClientRequestId + 计算 contentSha256]
          |
          v
[调用 POST /api/chapter.commit (超时设置 35s)]
          |
    +-----+-----+
    |           |
(成功 200)   (超时/网络断开)
    |           |
    v           v
[展示完成]  [调用 POST /api/chapter.commit.status 查询对账]
                |
          +-----+-----+
          |           |
     (已定稿且匹配) (仍为 draft)
          |           |
          v           v
     [展示完成并补齐   [安全发起第二次重试]
      commitId 凭证]
```

通过这一闭环，网络超时不再让客户端陷入死胡同，客户端通过单次对账查询即可精确恢复提交凭证，保障了全链路事务感知的一致性。

---

## 五、 全链路取消语义与晚到流块物理隔离规范 (Full-Chain Cancellation)

### 5.1 四级取消信号传导拓扑 (Four-Level Cancellation Topology)

一个完整的生成取消操作，绝不能仅仅是前端关闭连接，必须在全链路四个层次建立严格同步的取消拓扑：

```text
[Level 1: UI 交互层]
  - 用户点击「停止生成」或「切换章节」
  - 触发前端 AbortController.abort()，清理本地 reader
          |
          v (HTTP 连接断开)
[Level 2: BFF 网关层 (pipelineRoutes.ts)]
  - res.on('close') 监听捕获
  - 触发路由内部 AbortController.abort()
  - 标记当前 candidateId 处于已取消态
          |
          v (传入 AsyncGenerator Signal)
[Level 3: 服务端流式引擎层 (streamOpenAiChat)]
  - 捕获 Signal abort 事件
  - 立即向远端大模型 HTTP 出站请求发送 fetch abort
  - 终止 StreamReader 循环，关闭本地 Socket 句柄
          |
          v (管线拦截与收尾)
[Level 4: 数据平面与磁盘持久化层 (draft-step.ts)]
  - 拒绝向 draft_candidates.jsonl 追加任何晚到 Delta
  - 原子更新候选池状态为 'cancelled' 或确定性 'partial'
  - 写入最终 draft_state.json，释放全局运行锁
```

---

### 5.2 晚到 Chunk 隔离与丢弃边界 (Late-Arriving Chunk Isolation)

在异步并发流式处理中，即便网络被取消，操作系统的 TCP 接收缓冲区中可能依然残留有 1~2 个已经到达的 SSE 数据帧。

#### 物理隔离不变量规范
1. **内存丢弃墙 (In-Memory Drop Gate)**：
   在 `packages/pipeline/src/draft-step.ts:232` 的消费循环中：
   ```ts
   for await (const delta of opts.stream()) {
     if (opts.signal?.aborted) {
       // 立即丢弃，严禁调用 appendCandidateDelta
       break;
     }
     // 正常写入...
   }
   ```
2. **底层存储防污染护栏**：
   在 `packages/pipeline/src/draft-candidate.ts:appendCandidateDelta` 内部设置硬件级守卫：
   - 检查该候选当前状态。若状态已被置为 `cancelled`、`accepted` 或 `failed`，调用必须直接抛出 `CANDIDATE_TERMINAL`，严禁在终态之后写入任何新增字节。

---

### 5.3 候选状态与草稿状态一致性收敛 (Candidate & Draft State Alignment)

针对先前复盘中发现的 `draft_candidates.jsonl`（记 `cancelled`）与 `draft_state.json`（记 `partial`）状态分裂缺陷，重新规范收敛规则：

```text
用户停止生成触发 Abort
       |
       v
是否有正文增量产出 (producedChars > 0)?
       /                       \
     (是)                      (否)
      /                          \
     v                            v
[用户显式点击「中断并保留半稿」?]    [纯空流被取消]
    /                 \                   |
  (是)               (否)                 v
   /                   \         [状态统一收敛为 cancelled]
  v                     v        - candidate.status = 'cancelled'
[状态统一收敛为 partial] [状态统一收敛为 cancelled] - draft_state.status = 'cancelled'
- candidate: 'partial'  - candidate: 'cancelled'
- draft_state: 'partial'- draft_state: 'cancelled'
- 可进入后续受控采纳   - 不污染候选区
```

**关键修复规约**：
- 严禁在同一个代码分支中对同一事件写入两个相悖的状态词条；
- 明确判定意图：如果生成过程被作者主动中止，且作者意图是“放弃这次生成”，则统一标记为 `cancelled`；若意图是“就停在这里，我要这段半稿”，则统一标记为 `partial`。

---

### 5.4 半稿可采纳性（Partial Accept）前端闭环与显式交互

解决前端 `DialogueStream.tsx:438` 阻止采纳半稿的缺陷：
1. **前端交互解禁**：
   当 `draftTerminal?.partial === true` 时，界面不得置灰隐藏采纳按钮，而是展示特定的**「采纳半稿进正文」**按钮（附带黄色告警图标与字数说明）；
2. **显式确认通道**：
   用户点击后，弹出确认气泡：*“当前内容为未完结的半稿（共 N 字）。确认将其采纳进正文吗？”*
3. **参数传递完备化**：
   确认后，调用 `/api/draft.accept` 时显式附带：
   ```json
   {
     "candidateId": "cnd_01j9x...",
     "confirmPartial": true,
     "allowPartial": true
   }
   ```
   服务端校验到 `confirmPartial === true`，顺利放行并通过 CAS 将半稿安全合并进正文，实现产品层面的体验闭环。

---

## 六、 全局错误分类学与客户端重试退避策略 (Error Taxonomy & Retry Policy)

### 6.1 四级错误分类矩阵 (Four-Tier Error Classification Matrix)

系统内发生的所有 HTTP 错误与异常，必须严格归入以下四级分类体系，各层调用方必须按照统一的行为准则进行响应，禁止无脑重试或盲目弹窗：

| 错误类别 | HTTP 状态码 | 典型业务代码 (Code) | 错误特征与本质 | 客户端处理策略 | 最大重试次数 / 预算 |
|---|---|---|---|---|---|
| **Tier 1: 瞬态网络/容量错误 (Transient)** | 502, 503, 504, 429, ECONNRESET, ETIMEDOUT | `PROVIDER_BUSY`, `RATE_LIMIT_EXCEEDED`, `SOCKET_HANGUP` | 临时性故障、服务器过载、LLM 网关限流或连接重置。操作未产生确定性终态。 | **安全自动重试**（执行带 Full Jitter 的指数退避；若携带 `Retry-After` 则严格遵从）。 | 3 次，总时限不超过 15s |
| **Tier 2: 确定性参数/权限错误 (Terminal)** | 400, 401, 403, 404, 422 | `INVALID_BOOK_REQUEST`, `UNAUTHORIZED`, `LOCAL_NATIVE_ONLY`, `CHAPTER_MISSING` | 请求数据非法、未登录、越权、访问不存在资源。重试 100% 必然再次失败。 | **严禁重试**。立即中断流水线，向 UI 准确呈现错误原因与修复引导。 | 0 次（立即抛错） |
| **Tier 3: 语义版本/状态冲突 (Conflict)** | 409 | `PROSE_REVISION_CONFLICT`, `PROSE_EXTERNAL_CHANGE`, `CHAPTER_COMMITTED`, `CANON_PROPOSAL_PENDING` | 盘面版本已被推进、外部编辑器改盘、已定稿或有待决提案。非物理损坏，属业务时序分叉。 | **严禁盲目重试**。执行「对账核对（Reconcile）」：读取最新盘面或发起状态查询；区分自身成功与他人修改后交由作者裁决。 | 0 次（必须经对账或作者裁决） |
| **Tier 4: 系统底层/破坏性故障 (Fatal)** | 500 | `INTERNAL_SERVER_ERROR`, `PENDING_COMMIT_CONFLICT`, `DATABASE_CORRUPT` | 2PC 日志严重冲突、SQLite 文件损坏、主密钥解密失败。系统不变量受损。 | **严禁自动重试**。记录全息错误现场，进入灾难诊断模式，提示作者执行「从 Markdown 正典重建数据库」自愈。 | 0 次（触发自愈与告警） |

---

### 6.2 客户端退避重试算法规范 (Exponential Backoff with Full Jitter)

对于 Tier 1（瞬态错误），客户端必须严格采用业界公认的 **Full Jitter（全随机抖动）指数退避算法**，严禁使用固定间隔重试，防止瞬时网络恢复时千百个客户端并发重试引发服务端雪崩（Thundering Herd Problem）。

#### 算法数学公式
对于第 $i$ 次重试（$i \in \{1, 2, \dots, N_{\max}\}$）：
$$T_{\text{temp}} = \min(T_{\max}, \quad T_{\text{base}} \times 2^{i-1})$$
$$T_{\text{sleep}} = \text{UniformRandom}(0, \quad T_{\text{temp}})$$

- **基础退避时间** $T_{\text{base}} = 500\text{ ms}$
- **最大退避上限** $T_{\max} = 4000\text{ ms}$
- **最大重试次数** $N_{\max} = 3$

#### TypeScript 标准参考实现
```ts
export function calculateFullJitterBackoff(attempt: number, baseMs = 500, maxMs = 4000): number {
  const exponentialMax = Math.min(maxMs, baseMs * Math.pow(2, attempt - 1));
  // 在 0 到 exponentialMax 之间均匀分布取随机值
  return Math.floor(Math.random() * exponentialMax);
}
```

---

### 6.3 重试预算 (Retry Budget) 与死循环熔断机制

为了防止弱网环境下客户端陷入持续重试耗尽电量和带宽，引入客户端重试预算（Retry Budget）机制：
1. **单次用户交互预算**：单个保存或提交按钮点击，总重试时间窗口不得超过 12 秒；
2. **全应用重试配额**：在滑动 60 秒时间窗口内，重试请求占总发起的写请求比例不得超过 20%。当超过此阈值时，自动触发熔断，降级为“网络不稳定，请检查连接后手动点击重试”，保护本地系统资源。

---

## 七、 回归验证方案与门禁准入要求 (Verification & Acceptance Gates)

为确保上述规范在工程实现中得到 100% 履约，下一轮实施必须配套开发以下测试套件与验证门禁：

### 7.1 新增单元测试与契约测试用例集

1. **草稿保存真幂等测试 (`saveProseDraft.idempotency.test.ts`)**：
   - 模拟连续两次发送完全相同的 `expectedRevision`, `clientRequestId` 与 `body`；
   - 验证第二次调用立即返回 200 `{ alreadyApplied: true }`，盘面版本维持 $r_1$ 不递增，底层原子写函数调用次数恰好为 1。
2. **草稿保存真冲突区分测试 (`saveProseDraft.conflict-disambiguation.test.ts`)**：
   - 验证在正文已被第三方修改推进到 $r_1$ 时，携带旧 `expectedRevision: 0` 且哈希不同的请求被坚决拦截在 409 `PROSE_REVISION_CONFLICT`；
   - 验证请求携带 `expectedRevision: 0` 但哈希恰好与盘面 $r_1$ 一致时，顺利放行返回 200 `alreadyApplied: true`。
3. **定稿提交查询对账测试 (`chapterCommit.status.test.ts`)**：
   - 模拟定稿完成后丢弃响应，通过 `/api/chapter.commit.status` 成功换取 `commitId`，验证正文与事件账本零重复写入。

### 7.2 模拟超时与断网重试实测套件 (Mock-Network Probes)
编写独立的系统级隔离探针 `probe-retry-cancellation.cjs`：
- **探针 A**：注入 100ms 随机延迟与 50% 响应丢包率，驱动前端保存逻辑连续运行 50 次，验证**零虚假 409 弹窗**，磁盘最终正文与作者输入逐字比对一致；
- **探针 B**：在流式生成中段（产出 200 字时）主动调用 `abort()`，验证大模型请求立即被中止，候选池与状态文件状态 100% 收敛对齐，磁盘零孤儿 `.tmp` 泄漏。

### 7.3 CI 流水线门禁准入标准
本规范落地合并进 `develop` 分支前，必须满足：
- [ ] 所有新增幂等与取消测试用例通过（`pnpm test` 绿灯）；
- [ ] 探针 A 与探针 B 连续运行 10 轮无任何失败断言；
- [ ] 严格执行代码图谱门禁：`gitnexus check --cycles` 为 0，受影响模块的 `impact` 影响面严格收敛在预定边界内。
