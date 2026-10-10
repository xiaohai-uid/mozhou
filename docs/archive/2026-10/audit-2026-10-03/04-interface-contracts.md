# 04 · 关键接口行为语义审查报告（12 问契约表）
# (MoZhou / Novel OS 关键接口行为语义审计 · 2026-10-03)

> **审计依据**：`audit-2026-10-03/00-audit-charter.md`（章程口径）、`01-baseline-and-graph-gate.md`（基线事实）、`02-module-inventory-and-boundaries.md`（模块边界）、`03-author-path-trace.md`（作者路径贯穿）、`06-verification-log.md`（隔离实测日志）。  
> **基线标识**：`HEAD:90b45a1`（提交哈希 `90b45a1a1bf15a97b1cc690ad0b9872018aeebcb`，分支 `feature/windows-local-release`，ahead 7）。  
> **工作区状态**：既有未提交 42 条（`-uall` 展开 50 个文件）。凡触及未提交路径的结论均同时标明 `HEAD:90b45a1` 与 `WORKTREE(未提交)` 行号。  
> **审计口径警示（防偷换原则）**：
> - 有类型定义 ≠ 契约完整；
> - 返回 409 ≠ 客户端已确认原操作结果；
> - expectedRevision ≠ 完整幂等保证；
> - 有 AbortController ≠ 全链路停止；
> - 有多个 ID ≠ 已建立全链路因果关联；
> - private 字段 ≠ 业务规则无法绕过。

---

## 目录

1. [一、 契约审计方法与保证强度分级标准](#一-契约审计方法与保证强度分级标准)
2. [二、 关键操作行为语义审查（11 项 12 问契约表）](#二-关键操作行为语义审查11-项-12-问契约表)
   - [2.1 操作一：保存草稿 (Save Prose Draft)](#21-操作一保存草稿-save-prose-draft)
   - [2.2 操作二：采纳候选 (Accept Draft Candidate)](#22-操作二采纳候选-accept-draft-candidate)
   - [2.3 操作三：撤销采纳 (Undo Accept via Forward Save)](#23-操作三撤销采纳-undo-accept-via-forward-save)
   - [2.4 操作四：定稿提交 (Commit Chapter with 2PC Orchestration)](#24-操作四定稿提交-commit-chapter-with-2pc-orchestration)
   - [2.5 操作五：生成候选 (Draft Streaming & Candidate Generation)](#25-操作五生成候选-draft-streaming--candidate-generation)
   - [2.6 操作六：取消生成 (Cancel Generation & Site Mismatch Guard)](#26-操作六取消生成-cancel-generation--site-mismatch-guard)
   - [2.7 操作七：灾难恢复 (Crash Recovery, Rebuild & Backup Restore)](#27-操作七灾难恢复-crash-recovery-rebuild--backup-restore)
   - [2.8 操作八：导出作品 (Publication-Grade Export TXT/DOCX/EPUB)](#28-操作八导出作品-publication-grade-export-txtdocxepub)
   - [2.9 操作九：商业认证与设备授权 (Auth & Device Flow)](#29-操作九商业认证与设备授权-auth--device-flow)
   - [2.10 操作十：模型端点与凭据配置 (BYOK Provider Settings)](#210-操作十模型端点与凭据配置-byok-provider-settings)
   - [2.11 操作十一：商业支付、订单与权益 (Billing, Orders & Entitlements)](#211-操作十一商业支付订单与权益-billing-orders--entitlements)
3. [三、 全接口行为语义横向对比与综合裁决矩阵](#三-全接口行为语义横向对比与综合裁决矩阵)

---

## 一、 契约审计方法与保证强度分级标准

为了将接口审查从「浅层类型定义与文档声称」推进到「深层运行时行为语义」，本次审计针对每个操作严格执行 **12 问闭环审查**。每个回答均必须落到具体的源码位置（`file:symbol:line`），或标注为「仅类型声明」「仅注释声称」「未验证」。

### 保证强度评级（Strength Rating）

- **【强保证 (STRONG)】**：具备物理原子性落盘（fsync/rename）、真正的幂等机制（唯一业务键去重/状态机收敛）、严格的事务边界或两阶段提交（2PC），且崩溃后具备确定性自愈路径，经实测成立。
- **【中保证 (MEDIUM)】**：具备版本 CAS 乐观锁或单实例互斥锁，能在正常竞争下防止丢失更新；但在硬件断电、多进程异常竞争或复合中断下存在边缘状态泄露或脏临时文件残留，需人工介入或前向重试。
- **【弱保证 (WEAK)】**：仅在前端或应用层有状态检查，服务端缺乏强制约束；或虽有错误码返回但无法确定前次操作是否生效；取消操作存在晚到写入漏洞；多 ID 之间未打通因果链条。
- **【无保证 (NONE)】**：纯内存状态未落盘，或依赖未经校验的外部输入，或操作中途崩溃会导致数据静默截断/永久丢失。

---

## 二、 关键操作行为语义审查（11 项 12 问契约表）

---

### 2.1 操作一：保存草稿 (Save Prose Draft)

- **接口定义**：`POST /api/chapter.prose.save`
- **代码实现**：`apps/web/server/routes/proseRoutes.ts:293` (`HEAD:90b45a1`) -> `packages/data-plane/src/chapter.ts:805` (`HEAD:90b45a1`, `LocalDataPlane.saveProseDraft`)
- **保证强度评级**：**【中保证 (MEDIUM)】**

#### 12 问契约表

| # | 核心契约问题 | 审计核查结论与代码证据 (file:symbol:line) |
|---|---|---|
| **Q1** | **谁能调用，权限在哪里检查？** | 客户端 HTTP POST 调用。在本地模式下（`MOZHOU_HOSTED=false`），任何能访问 `127.0.0.1` 的进程均可调用，无鉴权；在托管模式下（`MOZHOU_HOSTED=true`），由 `bookAccess.ts:153` (`decodeBookRequest`) 校验 `principal.userId` 并调用 `assertSafeBookRoot` 防路径穿越。[`HEAD:90b45a1`] |
| **Q2** | **输入约束与前置状态是什么？** | 输入需 `{ root, chapterIndex, body, expectedRevision, title, confirmExternalOverwrite? }`。前置状态必须满足三道守卫：<br/>1. 章节非 committed 态（`chapter.ts:814`）；<br/>2. `existing.revision === expectedRevision`（`chapter.ts:821`）；<br/>3. 写前哈希匹配（`chapter.ts:828`，`assertPreWriteHash`），若外部有改动必须显式 `confirmExternalOverwrite: true`。[`HEAD:90b45a1`] |
| **Q3** | **返回成功具体保证什么？** | **强保证正文原子落盘**：`chapter.ts:838` 调用 `atomicReplace`，经 `.mozhou-tmp` 临时文件 + `fsync` + `renameSync` 原子写入 `正文/第NN章.md`，更新 frontmatter 中 `revision: N+1` 与 `updatedAt`；同步调用 `writeManifestFor` 刷新 `.mozhou/manifest.json`；派生发射 `UserEditRecorded` 事件。[`HEAD:90b45a1`] |
| **Q4** | **修改哪些状态，事务或一致性边界在哪里？** | 修改正文 Markdown 文件和 `manifest.json`。**一致性边界为文件级原子替换（Single File Atomic Rename）**。并非跨文件数据库事务：若在正文重命名后、写 manifest 前断电，正文已落盘但 manifest 滞后。[`HEAD:90b45a1`] |
| **Q5** | **同一请求重复到达会发生什么？** | **非幂等，表现为乐观冲突拒绝**。首次成功后盘上版本已自增为 N+1，重复请求携带原 `expectedRevision: N` 到达时，被 CAS 守卫（`chapter.ts:821`）拦截，抛出 `ProseRevisionConflictError`（HTTP 409）。**返回 409 不等于幂等，客户端无法直接区分是重复请求还是被他人并发改动**。[`HEAD:90b45a1`] |
| **Q6** | **多个调用方竞争时如何处理？** | **CAS 乐观锁排他拒绝**。进程内经 `BookOperationQueue.withBookLock` 串行排队（`bookAccess.ts:101`）；不同客户端竞争同一版本时，先到者成功升至 N+1，后到者 409 拒绝，绝不丢失更新（已由 `probe-02-save-concurrency.txt` 实测确证）。[`HEAD:90b45a1`] |
| **Q7** | **超时后如何确定第一次操作是否成功？** | 客户端无专用 queryId 查单接口。确认手段：客户端必须主动发起 `POST /api/chapter.prose` 拉取当前快照，比对返回的 `revision` 是否自增且正文哈希是否等于拟保存内容的哈希。[`HEAD:90b45a1`] |
| **Q8** | **取消何时生效，晚到结果能否继续写入？** | 服务端底层 `atomicReplace` 为同步阻塞调用，一旦进入无法取消。若客户端在请求发出后中断连接，服务端仍会完成写盘。晚到保存请求若版本未失效会继续写入，若版本已漂移则被 409 拒绝。[`HEAD:90b45a1`] |
| **Q9** | **错误如何分类，哪些可重试？** | 400（参数缺失）：不可重试；<br/>409 `CHAPTER_COMMITTED`：不可重试，需走重开定稿；<br/>409 `PROSE_REVISION_CONFLICT`：禁自动盲目重试，必须由前端提示用户做差异比对后拉取最新版重试；<br/>409 `PROSE_EXTERNAL_CHANGE`：需作者确认覆盖后携带 `confirmExternalOverwrite: true` 重试。[`HEAD:90b45a1`] |
| **Q10** | **进程重启后如何恢复或识别「状态不明」？** | 重启后由文件系统状态为准。**已知缺陷**：若进程在 `atomicWriteFileSync` 期间崩溃，盘上会残留脏文件 `第NN章.md.mozhou-tmp`，系统启动时不会自动清扫（已由 `probe-01-save-interrupt.txt` 实测确证），但后续保存会覆盖之。[`HEAD:90b45a1`] |
| **Q11** | **格式兼容性与版本迁移如何处理？** | 正文采用带 YAML Frontmatter 的标准 Markdown。升级时通过 `yaml-frontmatter.ts` 容忍缺少字段；revision 仅单调递增，无历史负向回退。[`HEAD:90b45a1`] |
| **Q12** | **如何关联全链路 ID？** | **断裂**。响应仅返回 `{ ok: true, revision, sha256 }`。正文 Markdown 文件未记录任何 `requestId`、`traceId` 或用户会话 ID，无法将正文版本精确回溯至特定的 HTTP 访问日志行。[`HEAD:90b45a1`] |

- **破绽与偷换揭示**：`expectedRevision` 仅提供了 CAS 乐观锁，被历史报告误称为「完整的保存幂等」。实际上重复保存会抛出 409 报错，导致客户端必须额外编写恢复逻辑。
- **可复现缺口与最小补证**：未验证。缺什么证据：网络严重抖动下前端自动重试是否会因 409 弹窗惊扰作者。最小补证方法：在前端调用 `doSave` 时模拟 200 丢包触发重试，观察 UI 交互。

---

### 2.2 操作二：采纳候选 (Accept Draft Candidate)

- **接口定义**：`POST /api/draft.accept`
- **代码实现**：`apps/web/server/routes/pipelineRoutes.ts:722` (`WORKTREE(未提交)`) / `L700` (`HEAD:90b45a1`) -> `packages/pipeline/src/draft-accept.ts:184` (`HEAD:90b45a1`, `acceptDraft`)
- **保证强度评级**：**【强保证 (STRONG)】**

#### 12 问契约表

| # | 核心契约问题 | 审计核查结论与代码证据 (file:symbol:line) |
|---|---|---|
| **Q1** | **谁能调用，权限在哪里检查？** | 经由 `pipelineRoutes.ts` 路由守卫检查。校验 `root` 与 `candidateId`，若在 hosted 模式经 `assertSafeBookRoot` 约束。[`HEAD:90b45a1`] |
| **Q2** | **输入约束与前置状态是什么？** | 输入 `{ root, candidateId, base: { revision, sha256 }, idempotencyKey, allowPartial? }`。前置状态：<br/>1. 候选文件 `.mozhou/candidates/<id>.json` 必须存在；<br/>2. 候选状态必须为 `ready`（若为 `partial` 必须显式 `allowPartial: true`，`draft-accept.ts:211`）；<br/>3. 当前盘面版本与哈希必须与 `candidate.base` 严格一致。[`HEAD:90b45a1`] |
| **Q3** | **返回成功具体保证什么？** | **双阶段持久化保证**：<br/>1. 先写意图文件 `.mozhou/candidates/<id>.intent.json` (`state: 'intent'`)；<br/>2. 调用 `saveProseDraft` 将合成后文本安全写入正文 Markdown，版本自增；<br/>3. 更新意图文件为 `state: 'done'`；<br/>4. 更新候选状态为 `accepted`；<br/>5. 返回 `{ ok: true, revision: N+1, sha256, alreadyApplied: boolean }`。[`HEAD:90b45a1`] |
| **Q4** | **修改哪些状态，事务或一致性边界在哪里？** | 修改候选意图文件、候选自身状态、正文 Markdown 及 manifest。**一致性边界为两阶段意图日志（2PC Intent Pattern）**：意图在正文落盘前落盘，崩溃时依此仲裁。[`HEAD:90b45a1`] |
| **Q5** | **同一请求重复到达会发生什么？** | **真正严格幂等（True Idempotency）**！`draft-accept.ts:192-205` 调用 `findIntentByKey(ctx, idempotencyKey)`。若发现已有同 key 意图且处于 `done` 态，直接返回 `{ ok: true, alreadyApplied: true, revision: ..., sha256: ... }`，零重复磁盘写入，零错误抛出。[`HEAD:90b45a1`] |
| **Q6** | **多个调用方竞争时如何处理？** | 先到者锁定基线并成功采纳；后到者因正文版本已自增，盘面核验（`draft-accept.ts:228`）失败，抛出 `AcceptConflictError`（HTTP 409 `ACCEPT_CONFLICT`）。安全排他。[`HEAD:90b45a1`] |
| **Q7** | **超时后如何确定第一次操作是否成功？** | **天然支持**：客户端直接以完全相同的 `idempotencyKey` 重发请求，若第一次已成功，将无害收到 200 `alreadyApplied: true`；或者拉取候选文件查看其状态是否为 `accepted`。[`HEAD:90b45a1`] |
| **Q8** | **取消何时生效，晚到结果能否继续写入？** | 采纳过程不可中途取消。若在调用采纳前调用了 `draft.cancel`，候选变为 `cancelled`，后续采纳直接抛错 `CANDIDATE_TERMINAL`。[`HEAD:90b45a1`] |
| **Q9** | **错误如何分类，哪些可重试？** | 400 `CANDIDATE_PARTIAL`：需提示用户半稿确认后带 `allowPartial=true` 重试；<br/>409 `ACCEPT_CONFLICT`：盘面基线已变，不可盲目重试，需作者重新比对。[`HEAD:90b45a1`] |
| **Q10** | **进程重启后如何恢复或识别「状态不明」？** | `acceptDraft` 具备崩溃自愈能力：若服务器在正文落盘与意图标记 `done` 之间崩溃，重启后再次调用时，检测到正文哈希已等于候选合成哈希，自动补发意图 `done` 并恢复成功。[`HEAD:90b45a1`] |
| **Q11** | **格式兼容性与版本迁移如何处理？** | 意图文件包含 `intentVersion: 1` 声明。向后兼容。[`HEAD:90b45a1`] |
| **Q12** | **如何关联全链路 ID？** | **链路贯通**：`idempotencyKey`、`candidateId`、`receiptId`（继承自候选元数据）与正文 `revision` 在意图文件中全量固化记录。[`HEAD:90b45a1`] |

- **破绽与偷换揭示**：采纳虽然保证了原子合成，但正文最终落盘调用的是 `saveProseDraft`，其生成的正文 frontmatter 中并未反向写入 `candidateId`，导致正文对候选的因果引用仅能依赖候选意图文件单向追踪。
- **可复现缺口与最小补证**：无显著缺口，强保证已由 `probe-05-accept-undo-consistency.txt` 实测通过。

---

### 2.3 操作三：撤销采纳 (Undo Accept via Forward Save)

- **接口定义**：`POST /api/chapter.prose.save`（携带撤销特定基线）
- **代码实现**：`apps/web/src/workbench/DialogueStream.tsx:588` (`WORKTREE:L588` / `HEAD:L588`, `handleUndoAccept`)
- **保证强度评级**：**【中保证 (MEDIUM)】**

#### 12 问契约表

| # | 核心契约问题 | 审计核查结论与代码证据 (file:symbol:line) |
|---|---|---|
| **Q1** | **谁能调用，权限在哪里检查？** | 仅由前端 `DialogueStream` 组件在采纳成功后挂载的 Undo 条幅触发，调用 `/api/chapter.prose.save`。权限同保存草稿。[`HEAD:90b45a1`] |
| **Q2** | **输入约束与前置状态是什么？** | 输入 `{ body: undo.oldText, expectedRevision: undo.afterRevision }`。前置条件：自采纳产生 `afterRevision` 后，作者未在编辑器或他端做出任何新修改。[`HEAD:90b45a1`] |
| **Q3** | **返回成功具体保证什么？** | 保证将正文恢复为采纳前的旧文本，但版本**单调前移至 `afterRevision + 1`**（例如 r1 采纳升至 r2，撤销后内容回滚但版本升至 r3，已由 `probe-05` 实测验证）。更新 manifest。[`HEAD:90b45a1`] |
| **Q4** | **修改哪些状态，事务或一致性边界在哪里？** | 边界等同于标准 `saveProseDraft`。修改正文与 manifest。**核心机制：墨舟的撤销是前向写入（Forward Save），非 Git 式指针回滚**。[`HEAD:90b45a1`] |
| **Q5** | **同一请求重复到达会发生什么？** | 重复请求携带相同的 `expectedRevision: undo.afterRevision` 到达时，因版本已跳升至 r3，被 CAS 守卫安全拦截为 409 冲突，杜绝旧文本重复覆盖。[`HEAD:90b45a1`] |
| **Q6** | **多个调用方竞争时如何处理？** | 若作者在撤销发出前在 Slate 画布键入了新字，导致版本变化，撤销请求被 409 拒绝。系统优先保护作者最新现场输入，拒绝盲目覆盖。[`HEAD:90b45a1`] |
| **Q7** | **超时后如何确定第一次操作是否成功？** | 客户端拉取 `chapter.prose`，比对当前内容是否已回到 `undo.oldText`。[`HEAD:90b45a1`] |
| **Q8** | **取消何时生效，晚到结果能否继续写入？** | 撤销本身无法取消。晚到撤销请求若版本已被作者新编辑超越，则自动失效（409）。[`HEAD:90b45a1`] |
| **Q9** | **错误如何分类，哪些可重试？** | 409 `PROSE_REVISION_CONFLICT`：表明作者已有新编辑，系统关闭撤销条幅，不可自动重试。[`HEAD:90b45a1`] |
| **Q10** | **进程重启后如何恢复或识别「状态不明」？** | **撤销状态易失**：Undo 状态仅保存在前端 React 状态及 `localStorage` 中。若作者刷新页面或重启浏览器，撤销条幅彻底消失，无法再一键撤销（必须手动重开编辑）。[`HEAD:90b45a1`] |
| **Q11** | **格式兼容性与版本迁移如何处理？** | 版本号严格保持单调递增整型。兼容历史回读。[`HEAD:90b45a1`] |
| **Q12** | **如何关联全链路 ID？** | **无链路 ID**。服务端未记录此次保存是「撤销操作」，账本与事件中仅记录普通的 `UserEditRecorded`。[`HEAD:90b45a1`] |

- **破绽与偷换揭示**：将 Undo 实现为前向保存虽然保住了版本单调性，但破坏了「操作元数据溯源」——从服务端审计日志中无法区分作者是「打字写回旧版本」还是「点击了撤销采纳」。且页面刷新后撤销机会永久丢失。
- **可复现缺口与最小补证**：刷新页面后观察撤销按钮是否消失。实测证明刷新后撤销状态清空。

---

### 2.4 操作四：定稿提交 (Commit Chapter with 2PC Orchestration)

- **接口定义**：`POST /api/chapter.commit`
- **代码实现**：`apps/web/server/routes/proseRoutes.ts:480` (`HEAD:90b45a1`) -> `packages/pipeline/src/commit-orchestration.ts:191` (`HEAD:90b45a1`, `runChapterCommit`) -> `packages/data-plane/src/chapter.ts:569` (`HEAD:90b45a1`, `commitChapter`)
- **保证强度评级**：**【强保证 (STRONG) / 极端二次故障下有缺陷】**

#### 12 问契约表

| # | 核心契约问题 | 审计核查结论与代码证据 (file:symbol:line) |
|---|---|---|
| **Q1** | **谁能调用，权限在哪里检查？** | 经 `proseRoutes.ts:480`，由 `decodeBookRequest` 校验书籍租户权限。[`HEAD:90b45a1`] |
| **Q2** | **输入约束与前置状态是什么？** | 输入 `{ root, chapterIndex, summary, expectedRevision, usage }`。前置状态必须通过：<br/>1. `phase === 'draft'` 且 `revision === expectedRevision`（`commit-orchestration.ts:208`）；<br/>2. 无未决提案挂起（`CANON_PROPOSAL_PENDING` / `STALE`）；<br/>3. Continuity Gate 连续性硬门禁通过，0 `hard_conflict`（`commit-orchestration.ts:251`）。[`HEAD:90b45a1`] |
| **Q3** | **返回成功具体保证什么？** | **物理 2PC 完整闭环**：<br/>1. 追踪流（`设定/*.jsonl`）增量追加并 fsync；<br/>2. `.mozhou/events.jsonl` 追加 `ChapterCommitted` 事件；<br/>3. **线性化翻转**：`正文/第NN章.md` frontmatter 翻转为 `phase: committed` 并分配 `commitId`；<br/>4. SQLite 投影插入 `tracking_lines`；<br/>5. `.mozhou/pending_commit.json` 事务日志安全清除；<br/>6. 飞轮用量与文风更新落盘。[`HEAD:90b45a1`] |
| **Q4** | **修改哪些状态，事务或一致性边界在哪里？** | 跨越正文、追踪流 jsonl、事件账本、SQLite 投影、用量账本 5 大物理状态。**一致性边界由 `pending_commit.json` 意图日志守护**，线性化提交点为正文原子重命名。[`HEAD:90b45a1`] |
| **Q5** | **同一请求重复到达会发生什么？** | **非幂等，抛出 409 拒绝**！首次提交后章节相位已为 `committed`。重复请求携带原版本到达时，前置校验失败，抛出 `ChapterPhaseError`（HTTP 409 `CHAPTER_PHASE_INVALID`，已由 `probe-06` 确证）。客户端不可拿 409 当作成功。[`HEAD:90b45a1`] |
| **Q6** | **多个调用方竞争时如何处理？** | 进程内由 `withBookLock` 排队；底层由正文 revision CAS 与 `pending_commit.json` 文件排他锁双重防护。并发提交只有一人能跨过前置守卫。[`HEAD:90b45a1`] |
| **Q7** | **超时后如何确定第一次操作是否成功？** | 客户端不可重发 commit 请求。**唯一正确确认手段**：拉取 `POST /api/chapter.prose`，检查 `phase` 是否已变为 `committed`，并核验返回的 `commitId`。[`HEAD:90b45a1`] |
| **Q8** | **取消何时生效，晚到结果能否继续写入？** | 进入 2PC 执行期后（`commitChapter`）不可取消。前期提取阶段若连接断开，通过 abortController 终止模型调用，正典零改动。[`HEAD:90b45a1`] |
| **Q9** | **错误如何分类，哪些可重试？** | 409 `CANON_PROPOSAL_PENDING`：不可重试，作者必须先至提案队列确认事实；<br/>409 `CONTINUITY_HARD_CONFLICT`：不可重试，需修改正文化解时间线冲突；<br/>500 崩溃：不可盲目重试，交由重启恢复机制。[`HEAD:90b45a1`] |
| **Q10** | **进程重启后如何恢复或识别「状态不明」？** | 服务重启调用 `recoverPendingCommit`（`chapter.ts:320`）：<br/>- 若正文已翻转（前锚成功）：前滚恢复（补全追踪流、重放 SQLite、删日志）；<br/>- 若正文未翻转（前锚未到）：后滚恢复（截断追踪流回 baseBytes、删日志）。<br/>⚠️ **已证实严重缺陷（Probe 07）**：前滚恢复截断旧文件后若**发生二次断电**，再次重启会误判为 `untouched` 并直接删除日志，**导致追踪流增量永久丢失**！[`HEAD:90b45a1`] |
| **Q11** | **格式兼容性与版本迁移如何处理？** | 提交分配 `commitId: cmt_<ULID>`，具备时间戳自解释性；`pending_commit.json` 具备版本标识。[`HEAD:90b45a1`] |
| **Q12** | **如何关联全链路 ID？** | **全链路贯通**：`commitId` 深度注入正文 frontmatter、`ChapterCommitted` 领域事件、SQLite `tracking_lines.commit_id` 及飞轮用量记录。[`HEAD:90b45a1`] |

- **破绽与偷换揭示**：既有架构宣称「完整的 2PC 崩溃一致性」，但未对「恢复过程自身被二次打断」做防卫设计。`recoverForward` 中直接执行有副作用的文件操作而未建立恢复自身的状态机，导致二次断电数据丢失。
- **可复现缺口与最小补证**：`logs/verification/probe-07-commit-stages-and-reinterrupt.txt` 已提供完整复现脚本与日志，证明二次中断导致丢失事实行。

---

### 2.5 操作五：生成候选 (Draft Streaming & Candidate Generation)

- **接口定义**：`POST /api/draft.stream`
- **代码实现**：`apps/web/server/routes/pipelineRoutes.ts:546` (`WORKTREE(未提交)`) / `L524` (`HEAD:90b45a1`) -> `draftContext.ts` -> `assemble.ts` -> `draft-candidate.ts`
- **保证强度评级**：**【强保证 (STRONG)】**

#### 12 问契约表

| # | 核心契约问题 | 审计核查结论与代码证据 (file:symbol:line) |
|---|---|---|
| **Q1** | **谁能调用，权限在哪里检查？** | 经 `pipelineRoutes.ts` 路由守卫校验。hosted 模式校验书籍与配额。[`HEAD:90b45a1`] |
| **Q2** | **输入约束与前置状态是什么？** | 输入 `{ root, chapterIndex, prompt, activeSkills, base: { revision, sha256 } }`。前置条件：必须配置有效 Provider（若无，返回 200 带 `code: PROVIDER_UNAVAILABLE`，拒绝假模拟）。[`HEAD:90b45a1`] |
| **Q3** | **返回成功具体保证什么？** | **候选物理隔离落盘保证**：<br/>1. 装配上下文并生成不可变凭证 `.mozhou/receipts/rcpt_<ULID>.json`；<br/>2. 追加 `ContextCompiled` 领域事件至账本；<br/>3. 在 `.mozhou/candidates/<candidateId>.json` 创建状态为 `streaming` 的候选；<br/>4. 流式传输 NDJSON 帧；<br/>5. 结束时候选置为 `ready`（或 `partial`）。**绝对保证正典正文零字节改动**。[`HEAD:90b45a1`] |
| **Q4** | **修改哪些状态，事务或一致性边界在哪里？** | 仅修改 `.mozhou/receipts/` 与 `.mozhou/candidates/`。一致性边界为单一候选文件，与正文正典完全解耦。[`HEAD:90b45a1`] |
| **Q5** | **同一请求重复到达会发生什么？** | 每次调用均重新铸造全新 `candidateId` 与 `receiptId`，各自生成独立候选文件。并发请求互不冲突。[`HEAD:90b45a1`] |
| **Q6** | **多个调用方竞争时如何处理？** | 候选生成不争夺正文写锁，多个客户端或多会话可并行生成候选，各自写入独立的候选文件。[`HEAD:90b45a1`] |
| **Q7** | **超时后如何确定第一次操作是否成功？** | 客户端可通过 `POST /api/draft.candidate` 传入 `candidateId` 查询候选状态（`ready`/`partial`/`streaming`）与已生成正文。[`HEAD:90b45a1`] |
| **Q8** | **取消何时生效，晚到结果能否继续写入？** | 客户端中断 HTTP 连接触发 `res.on('close')`，服务端 abortController 立即掐断模型请求；**晚到流帧直接丢弃，严禁写入正文，仅以 partial 暂存于候选文件**（已由 `probe-04` 确证）。[`HEAD:90b45a1`] |
| **Q9** | **错误如何分类，哪些可重试？** | 模型超时/网络断开：返回 `event: error` 帧，前端可重试；<br/>`EmptyRecallError`：召回为空时显式抛错，不退回 Mock。[`HEAD:90b45a1`] |
| **Q10** | **进程重启后如何恢复或识别「状态不明」？** | 重启后未完成候选停留在 `streaming` 态。前端通过 `localStorage` 镜像缓存恢复半稿，提供作者查看。[`HEAD:90b45a1`] |
| **Q11** | **格式兼容性与版本迁移如何处理？** | 传输采用标准 NDJSON 协议；候选格式包含 `version: 1` 声明。[`HEAD:90b45a1`] |
| **Q12** | **如何关联全链路 ID？** | **半贯通**：`candidateId` 绑定了 `base: { revision, sha256 }`；但候选元数据中**漏记了 `receiptId`**（仅在服务端日志和事件账本中由时序弱关联），无法直接从候选反查精确装配凭证。[`HEAD:90b45a1`] |

- **破绽与偷换揭示**：流式生成虽然做到了正典隔离，但候选与 Receipt 之间缺乏显式外键 ID 关联，使得「这个候选到底由哪次 Prompt 装配生成」在持久化层出现断链。
- **可复现缺口与最小补证**：检查 `.mozhou/candidates/<id>.json` schema，证实其无 `receiptId` 字段。

---

### 2.6 操作六：取消生成 (Cancel Generation & Site Mismatch Guard)

- **接口定义**：`POST /api/draft.cancel` 与 HTTP 连接中断
- **代码实现**：`apps/web/server/routes/pipelineRoutes.ts:706` (`WORKTREE:L706` / `HEAD:L684`) -> `packages/pipeline/src/draft-candidate.ts:160` (`cancelCandidate`)
- **保证强度评级**：**【强保证 (STRONG)】**

#### 12 问契约表

| # | 核心契约问题 | 审计核查结论与代码证据 (file:symbol:line) |
|---|---|---|
| **Q1** | **谁能调用，权限在哪里检查？** | 客户端调用。校验书籍访问权。[`HEAD:90b45a1`] |
| **Q2** | **输入约束与前置状态是什么？** | 输入 `{ root, candidateId }`。候选处于活动状态。[`HEAD:90b45a1`] |
| **Q3** | **返回成功具体保证什么？** | 保证候选文件被标记为 `cancelled`（或在已有字数时保留为 `partial`）；通知取消并断开调用。[`HEAD:90b45a1`] |
| **Q4** | **修改哪些状态，事务或一致性边界在哪里？** | 仅修改目标候选文件 `.mozhou/candidates/<id>.json`。[`HEAD:90b45a1`] |
| **Q5** | **同一请求重复到达会发生什么？** | 纯幂等操作。重复取消保持已取消态。[`HEAD:90b45a1`] |
| **Q6** | **多个调用方竞争时如何处理？** | 状态机终态收敛，先到取消即可生效。[`HEAD:90b45a1`] |
| **Q7** | **超时后如何确定第一次操作是否成功？** | 查询候选详情，验证 `status === 'cancelled' \|\| 'partial'`。[`HEAD:90b45a1`] |
| **Q8** | **取消何时生效，晚到结果能否继续写入？** | **立即生效**。前端 `stillOnSite()` 守卫拦截切章晚到帧；服务端连接掐断后不再向候选追加文本。[`HEAD:90b45a1`] |
| **Q9** | **错误如何分类，哪些可重试？** | 404 `CANDIDATE_NOT_FOUND`：无需重试。[`HEAD:90b45a1`] |
| **Q10** | **进程重启后如何恢复或识别「状态不明」？** | 重启后候选状态保持持久化结果。[`HEAD:90b45a1`] |
| **Q11** | **格式兼容性与版本迁移如何处理？** | 候选状态枚举值兼容。[`HEAD:90b45a1`] |
| **Q12** | **如何关联全链路 ID？** | 由 `candidateId` 准确锚定。[`HEAD:90b45a1`] |

- **破绽与偷换揭示**：声称「AbortController 能终止模型」，但在服务端若未正确传递 signal 到底层原生 fetch/https 客户端，云端模型依然会在后台消耗 Token 直至完成。墨舟经检查在 `pipelineRoutes.ts:626` 挂接了 `res.on('close')`，本地终止到位。
- **可复现缺口与最小补证**：无显著缺口。

---

### 2.7 操作七：灾难恢复 (Crash Recovery, Rebuild & Backup Restore)

- **接口定义**：`LocalDataPlane.openOrRebuild` / `recoverPendingCommit` / `POST /api/backups/restore`
- **代码实现**：`packages/data-plane/src/chapter.ts:320` (`HEAD:90b45a1`), `packages/data-plane/src/local-data-plane.ts:451` (`HEAD:90b45a1`), `packages/data-plane/src/book-backup.ts:161` (`HEAD:90b45a1`)
- **保证强度评级**：**【强保证 (STRONG) / 投影 100% 自愈 / 2PC二次断电有风险】**

#### 12 问契约表

| # | 核心契约问题 | 审计核查结论与代码证据 (file:symbol:line) |
|---|---|---|
| **Q1** | **谁能调用，权限在哪里检查？** | 提交恢复与投影重建由数据平面初始化时**自动内部触发**；备份恢复由 HTTP 路由 `POST /api/backups/restore` 经书籍访问权限校验后调用。[`HEAD:90b45a1`] |
| **Q2** | **输入约束与前置状态是什么？** | 投影重建无需输入，直接读取当前盘上 Markdown 正典；备份恢复需传入合法 ZIP 文件，通过 `C5_ZIP_LIMITS` 检查（防解压炸弹与绝对路径穿越，`zip-util.ts:25`）。[`HEAD:90b45a1`] |
| **Q3** | **返回成功具体保证什么？** | **1. 投影自愈保证**：SQLite 损坏或版本不符时，100% 依据盘上 Markdown 从零重建全部表结构与数据（`probe-11` 实测通过）；<br/>**2. 提交恢复保证**：单次崩溃下，严格按正文哈希执行前滚（补齐事件/投影）或后滚（截断回滚）；<br/>**3. 备份恢复保证**：逐文件 SHA256 强校验，原子还原全量正典文件。[`HEAD:90b45a1`] |
| **Q4** | **修改哪些状态，事务或一致性边界在哪里？** | 投影重建在单 SQLite 事务内完成；备份还原在新建目标目录下解压；提交恢复修改正文与日志。[`HEAD:90b45a1`] |
| **Q5** | **同一请求重复到达会发生什么？** | 投影重建是完全幂等的确定性覆盖；提交恢复若 journal 已清理，直接安全返回 0 影响；备份还原写入新目录。[`HEAD:90b45a1`] |
| **Q6** | **多个调用方竞争时如何处理？** | 由 `DataRootProcessLock`（进程级）与 `withBookLock`（书籍级）严格排他锁阻断，禁止多实例并发重建同一个库。[`HEAD:90b45a1`] |
| **Q7** | **超时后如何确定第一次操作是否成功？** | 检查 SQLite `user_version` 是否等于 `PROJECTION_SCHEMA_VERSION`；检查 `.mozhou/pending_commit.json` 是否已消失。[`HEAD:90b45a1`] |
| **Q8** | **取消何时生效，晚到结果能否继续写入？** | 恢复与重建过程绝对不可中途取消，属于原子同步阻塞阶段。[`HEAD:90b45a1`] |
| **Q9** | **错误如何分类，哪些可重试？** | `PendingCommitConflictError`：正文哈希既不等于前锚也不等于后锚，表明正文被非法外力损坏，**坚决不自动修复，响亮抛错（Fail-Loudly）**，等待人工介入。[`HEAD:90b45a1`] |
| **Q10** | **进程重启后如何恢复或识别「状态不明」？** | 每次系统启动必走 `openOrRebuild`，自动识别脏状态并自愈。但在二次打断下存在缺陷（见 Q3/Q12）。[`HEAD:90b45a1`] |
| **Q11** | **格式兼容性与版本迁移如何处理？** | `assertProjectionVersion` 对比 SQLite PRAGMA `user_version`。失配时抛出 `ProjectionVersionMismatchError`，触发自动 DROP 表并全量按最新 schema 重建。[`HEAD:90b45a1`] |
| **Q12** | **如何关联全链路 ID？** | 投影内行通过 `ulid` 与 `commitId` 维持因果树；备份清单携带 manifest 哈希。[`HEAD:90b45a1`] |

- **破绽与偷换揭示**：声称「SQLite 投影丢失会导致系统不可用」被证实为虚假警报——SQLite 纯属只读派生副本，100% 可由 Markdown 反向重建。但 2PC 提交恢复在二次中断下的脆弱性是真实盲点。
- **可复现缺口与最小补证**：`probe-11-legacy-format-and-rebuild.txt` 与 `probe-07` 提供完整实测依据。

---

### 2.8 操作八：导出作品 (Publication-Grade Export TXT/DOCX/EPUB)

- **接口定义**：`POST /api/export`
- **代码实现**：`apps/web/server/routes/exportRoutes.ts:15` (`HEAD:90b45a1`) -> `packages/data-plane/src/docx-export.ts` 等
- **保证强度评级**：**【强保证 (STRONG)】**

#### 12 问契约表

| # | 核心契约问题 | 审计核查结论与代码证据 (file:symbol:line) |
|---|---|---|
| **Q1** | **谁能调用，权限在哪里检查？** | 经 `exportRoutes.ts` 路由校验租户权限。[`HEAD:90b45a1`] |
| **Q2** | **输入约束与前置状态是什么？** | 输入 `{ bookTitle, format, author, synopsis, root, chapters? }`。<br/>**硬性前置守卫**：`exportRoutes.ts:60` 执行 Anti-Empty Chapter Guard。**若任一章节正文为空白，立即返回 409 `EXPORT_EMPTY_CHAPTER` 坚决拒绝导出**。[`HEAD:90b45a1`] |
| **Q3** | **返回成功具体保证什么？** | 保证流式返回出版级排版的二进制文件（标准 OOXML docx、EPUB3 或清洗后的 txt）；保证与盘上已提交正典正文内容**逐字严格一致**（`probe-10` 实测验证）。[`HEAD:90b45a1`] |
| **Q4** | **修改哪些状态，事务或一致性边界在哪里？** | **纯只读操作**，服务端磁盘零修改，零状态变化。[`HEAD:90b45a1`] |
| **Q5** | **同一请求重复到达会发生什么？** | 纯幂等读，任意次重复导出结果完全一致。[`HEAD:90b45a1`] |
| **Q6** | **多个调用方竞争时如何处理？** | 无锁并发，多个调用方可同时发起不同格式导出。[`HEAD:90b45a1`] |
| **Q7** | **超时后如何确定第一次操作是否成功？** | 纯客户端下载行为，超时直接重新点击下载。[`HEAD:90b45a1`] |
| **Q8** | **取消何时生效，晚到结果能否继续写入？** | 客户端取消下载即刻终止，服务端断开 socket，无副作用。[`HEAD:90b45a1`] |
| **Q9** | **错误如何分类，哪些可重试？** | 409 `EXPORT_EMPTY_CHAPTER`：需先在编辑器中补齐空白章节正文后重试。[`HEAD:90b45a1`] |
| **Q10** | **进程重启后如何恢复或识别「状态不明」？** | 无状态，不涉及恢复。[`HEAD:90b45a1`] |
| **Q11** | **格式兼容性与版本迁移如何处理？** | 生成的 docx 符合标准 ECMA-376 OOXML 规约；epub 符合 EPUB 3.2 规范。[`HEAD:90b45a1`] |
| **Q12** | **如何关联全链路 ID？** | 导出文档元数据中内嵌书名、作者与导出时间戳。[`HEAD:90b45a1`] |

- **破绽与偷换揭示**：既有文档声称「导出由外部 pandoc 工具实现」，代码实测证明完全由 MoZhou 在 `packages/data-plane/src/zip-util.ts` 中手写底层 ZIP 压缩与 XML 拼装实现，零外部系统依赖。
- **可复现缺口与最小补证**：`logs/verification/probe-10-export-consistency.txt` 证实解压 docx 检查 document.xml 与盘面一致。

---

### 2.9 操作九：商业认证与设备授权 (Auth & Device Flow)

- **接口定义**：`POST /api/account/login`, `/register`, `/device-flow/*`
- **代码实现**：`apps/web/server/routes/accountRoutes.ts:14` (`HEAD:90b45a1`), `apps/web/server/auth/session.ts:10` (`HEAD:90b45a1`), `apps/web/server/auth/deviceFlow.ts:10` (`HEAD:90b45a1`)
- **保证强度评级**：**【强保证 (STRONG)】**

#### 12 问契约表

| # | 核心契约问题 | 审计核查结论与代码证据 (file:symbol:line) |
|---|---|---|
| **Q1** | **谁能调用，权限在哪里检查？** | 登录/注册/设备流启动为公网公开端点；设备解绑与信息查询由 `verifyRequestSession`（`accountRoutes.ts:21`）校验 HttpOnly Session Cookie。[`HEAD:90b45a1`] |
| **Q2** | **输入约束与前置状态是什么？** | 注册要求有效 email 与最小 6 位密码（`accountRoutes.ts:44`）；设备绑定要求基于 PKCE 的 code challenge，且每个账号**最多绑定 3 台活跃设备**（`deviceFlow.ts:38`, `MAX_DEVICES_PER_USER = 3`）。[`HEAD:90b45a1`] |
| **Q3** | **返回成功具体保证什么？** | 保证签发安全会话票据，设置 `HttpOnly; SameSite=Lax; Secure` cookie；设备授权成功后在账户中心记录设备名称、平台与最后活跃时间。[`HEAD:90b45a1`] |
| **Q4** | **修改哪些状态，事务或一致性边界在哪里？** | 修改 `<dataRoot>/accounts/accounts.json`（经 `atomicWriteFileSync` 原子替换落盘）与内存活跃 Session 映射。[`HEAD:90b45a1`] |
| **Q5** | **同一请求重复到达会发生什么？** | 重复注册返回 409 `EMAIL_ALREADY_EXISTS`；重复登录返回新 sessionToken 并刷新活跃时间；设备轮询 `device-flow/poll` 纯幂等。[`HEAD:90b45a1`] |
| **Q6** | **多个调用方竞争时如何处理？** | 账户存储由原子文件写入保证单写者安全；设备超出 3 台时，新设备授权被 400 `DEVICE_LIMIT_EXCEEDED` 拒绝，必须手动解绑旧设备。[`HEAD:90b45a1`] |
| **Q7** | **超时后如何确定第一次操作是否成功？** | 调用 `GET /api/account` 检查当前 Session 是否已建立及已绑定设备列表。[`HEAD:90b45a1`] |
| **Q8** | **取消何时生效，晚到结果能否继续写入？** | 解绑设备（`devices/unbind`）立即吊销对应 deviceToken，使该设备后续 API 请求立即遭遇 401。[`HEAD:90b45a1`] |
| **Q9** | **错误如何分类，哪些可重试？** | 401 `INVALID_CREDENTIALS`：不可重试；400 `DEVICE_LIMIT_EXCEEDED`：需解绑旧设备后重试；403 CSRF 拒绝：需刷新页面取新 token。[`HEAD:90b45a1`] |
| **Q10** | **进程重启后如何恢复或识别「状态不明」？** | 账户与设备列表已原子落盘于 `accounts.json`，重启不丢失；内存 Session 丢失时客户端携带有效 Cookie 可触发自动换票重连。[`HEAD:90b45a1`] |
| **Q11** | **格式兼容性与版本迁移如何处理？** | 账户存储具备 schemaVersion 字段；密码采用加盐安全哈希。[`HEAD:90b45a1`] |
| **Q12** | **如何关联全链路 ID？** | `userId` 贯穿整个请求生命周期，作为 `req.principal.userId` 传递给后续所有业务路由。[`HEAD:90b45a1`] |

- **破绽与偷换揭示**：部分模块在本地模式下直接绕过了账号校验（`isHostedMode() === false` 时放行），导致在本地桌面版中这些鉴权逻辑完全休眠，仅在托管模式（Hosted）激活。
- **可复现缺口与最小补证**：查阅 `productionServer.ts:261`，本地启动时 `hostedMode: false`，证明本地版不强制鉴权。

---

### 2.10 操作十：模型端点与凭据配置 (BYOK Provider Settings)

- **接口定义**：`GET /api/llm/settings`, `POST /api/llm/settings`, `POST /api/llm/test`
- **代码实现**：`apps/web/server/routes/providerRoutes.ts:16` (`HEAD:90b45a1`), `apps/web/server/llm/providerSettings.ts:10` (`HEAD:90b45a1`)
- **保证强度评级**：**【强保证 (STRONG)】**

#### 12 问契约表

| # | 核心契约问题 | 审计核查结论与代码证据 (file:symbol:line) |
|---|---|---|
| **Q1** | **谁能调用，权限在哪里检查？** | 经 `providerRoutes.ts:16` 提取当前 `principal.userId`；未登录用户无法读取或修改他人配置（多租户沙箱隔离）。[`HEAD:90b45a1`] |
| **Q2** | **输入约束与前置状态是什么？** | 输入 `{ apiKey, baseUrl?, model?, providerId? }`。前置条件：<br/>1. `apiKey` 不能为空；<br/>2. `baseUrl` 必须通过 `assertSafeRemoteTarget` 强校验（防 SSRF，禁止指向 `127.0.0.1`、内网私有段、云厂商元数据服务 `169.254.169.254`）；<br/>3. 服务端必须已配置主加密密钥 `MOZHOU_SECRET_KEY`。[`HEAD:90b45a1`] |
| **Q3** | **返回成功具体保证什么？** | **强加密与安全落盘保证**：<br/>1. 明文 API Key 经 AES-256-GCM + IV 加密（`providerSettings.ts:88`）；<br/>2. 密文原子写入 `<dataRoot>/users/<userId>/provider_settings.json`；<br/>3. 配置版本 `configVersion` 递增；<br/>4. GET 端点返回脱敏掩码（如 `sk-****abcd`），**绝对保证明文 Key 永不回显至客户端**。[`HEAD:90b45a1`] |
| **Q4** | **修改哪些状态，事务或一致性边界在哪里？** | 修改单个用户的 `provider_settings.json` 物理文件。边界为用户目录级原子写入。[`HEAD:90b45a1`] |
| **Q5** | **同一请求重复到达会发生什么？** | 幂等更新。配置版本与时间戳向前刷新。[`HEAD:90b45a1`] |
| **Q6** | **多个调用方竞争时如何处理？** | 单用户单文件原子替换，最后写入者生效（Last-Write-Wins）。[`HEAD:90b45a1`] |
| **Q7** | **超时后如何确定第一次操作是否成功？** | 调用 `GET /api/llm/settings`，比对返回的 `configVersion` 与 `updatedAt` 时间戳。[`HEAD:90b45a1`] |
| **Q8** | **取消何时生效，晚到结果能否继续写入？** | 同步文件写入，不支持取消。晚到写入会覆盖早到配置。[`HEAD:90b45a1`] |
| **Q9** | **错误如何分类，哪些可重试？** | 400 `SSRF_BLOCKED`：不可重试，目标 URL 属于危险受限内网；400 `INVALID_API_KEY`：需输入合法 Key。[`HEAD:90b45a1`] |
| **Q10** | **进程重启后如何恢复或识别「状态不明」？** | 重启后服务由 `installation.key` 重新派生主密钥解密配置文件，用户无需重新输入。[`HEAD:90b45a1`] |
| **Q11** | **格式兼容性与版本迁移如何处理？** | 结构含 `configVersion: number`；加密载荷带 auth tag 与 iv。[`HEAD:90b45a1`] |
| **Q12** | **如何关联全链路 ID？** | 与 `userId` 强绑定。模型探针测试记录 `latencyMs`。[`HEAD:90b45a1`] |

- **破绽与偷换揭示**：`POST /api/llm/test` 声称测试连接，实测若传入空 key 会自动回退到环境变量预设的供应商端点，可能给作者造成「我的空 Key 测试成功」的假象。代码在 `providerRoutes.ts:56` 证实了此逻辑。
- **可复现缺口与最小补证**：无显著安全缺口。

---

### 2.11 操作十一：商业支付、订单与权益 (Billing, Orders & Entitlements)

- **接口定义**：`POST /api/billing/orders`, `POST /api/billing/order`, `POST /api/payments/*/notify`
- **代码实现**：`apps/web/server/routes/billingRoutes.ts:18` (`HEAD:90b45a1`), `apps/web/server/billing/store.ts:10` (`HEAD:90b45a1`), `apps/web/server/billing/pollingWorker.ts:46` (`HEAD:90b45a1`)
- **保证强度评级**：**【强保证 (STRONG)】**

#### 12 问契约表

| # | 核心契约问题 | 审计核查结论与代码证据 (file:symbol:line) |
|---|---|---|
| **Q1** | **谁能调用，权限在哪里检查？** | 创单与查单必须为登录用户（`billingRoutes.ts:22`）；查单强制执行**主体隔离（Subject Isolation）**：A 查 B 订单返回 404（`billingRoutes.ts:68`）；支付回调豁免登录，但强制要求 APIv3 (微信) 或 RSA2 (支付宝) 密码学签名验签。[`HEAD:90b45a1`] |
| **Q2** | **输入约束与前置状态是什么？** | 创单输入 `{ planId, channel, idempotencyKey }`。`idempotencyKey` 必须非空（`billingRoutes.ts:31`）；回调要求合规请求体与签名头。[`HEAD:90b45a1`] |
| **Q3** | **返回成功具体保证什么？** | **双重幂等与事务级权益开通保证**：<br/>1. 订单行写入 `<dataRoot>/billing.sqlite`（`orders` 表）；<br/>2. 支付回调验签通过后，在**单一 SQLite 事务内**将订单标为 `paid` 并向 `user_entitlements` 授予权益（`store.ts:180`），绝不丢单；<br/>3. 回调丢失时，由 `pollingWorker.ts` 指数退避主动查单兜底核销。[`HEAD:90b45a1`] |
| **Q4** | **修改哪些状态，事务或一致性边界在哪里？** | 修改 `billing.sqlite` 中的 `orders`、`user_entitlements`、`payment_notifications` 表。**一致性边界为 SQLite 本地事务（ACID）**。[`HEAD:90b45a1`] |
| **Q5** | **同一请求重复到达会发生什么？** | **严格双向幂等**：<br/>- 创单：同用户同 `idempotencyKey` 再次到达，直接返回已有订单；不同参数同 key 返回 409（`store.ts:130`）；<br/>- 回调：重复 Webhook 命中已有 `paid` 态，直接返回 200，绝不重复赠送天数。[`HEAD:90b45a1`] |
| **Q6** | **多个调用方竞争时如何处理？** | 依赖 SQLite 的排他写锁，事务串行化执行。[`HEAD:90b45a1`] |
| **Q7** | **超时后如何确定第一次操作是否成功？** | 客户端以相同 `idempotencyKey` 重发创单；或调用 `POST /api/billing/order` 查单。[`HEAD:90b45a1`] |
| **Q8** | **取消何时生效，晚到结果能否继续写入？** | 超过 24 小时未付订单由 `pollingWorker` 自动标记为 `closed`。晚到成功支付通知依然能核销入账。[`HEAD:90b45a1`] |
| **Q9** | **错误如何分类，哪些可重试？** | 403 `SIGNATURE_VERIFICATION_FAILED`：不可重试；409 `IDEMPOTENCY_CONFLICT`：不可重试。[`HEAD:90b45a1`] |
| **Q10** | **进程重启后如何恢复或识别「状态不明」？** | `billing.sqlite` 采用 WAL 模式持久化。重启后 pending 订单由轮询器自动唤醒继续对账。[`HEAD:90b45a1`] |
| **Q11** | **格式兼容性与版本迁移如何处理？** | 数据库包含 `migrations/001-orders.sql`，通过版本迁移表管控。[`HEAD:90b45a1`] |
| **Q12** | **如何关联全链路 ID？** | **全链路贯通**：`orderId`（系统自编）与 `idempotencyKey`（客户端提供）、`providerTransactionId`（微信/支付宝流水号）、`userId` 在订单表强外键关联。[`HEAD:90b45a1`] |

- **破绽与偷换揭示**：`pollingWorker` 虽然设计了 24h 退避轮询，但在代码中并未作为独立驻留 Worker 线程由操作系统级守护启动，而是依赖外部 cron 或应用启动时触发，长驻稳定性取决于 Node 进程寿命。
- **可复现缺口与最小补证**：无严重漏洞。

---

## 三、 全接口行为语义横向对比与综合裁决矩阵

通过对上述 11 个关键操作的 12 问闭环审查，归纳出全系统的接口一致性与行为语义对照矩阵：

| 操作名称 | 核心端点 / 入口 | 保证强度 | 幂等性保证模型 | 竞态与冲突处理 | 超时确认机制 | 2PC / 事务边界 | 证据文件与关键代码锚点 |
|---|---|:---:|---|---|---|---|---|
| **保存草稿** | `/api/chapter.prose.save` | **中 (MEDIUM)** | 假幂等 (CAS 409) | CAS 拒绝 (先到成功) | 查 `chapter.prose` | 单文件原子重命名 | `chapter.ts:805`, `probe-02` |
| **采纳候选** | `/api/draft.accept` | **强 (STRONG)** | **真幂等** (意图键去重) | CAS 拦截 | 携同 Key 重发 | 意图文件 2PC | `draft-accept.ts:184`, `probe-05` |
| **撤销采纳** | `/api/chapter.prose.save` | **中 (MEDIUM)** | 假幂等 (前向写 r2) | 保护最新编辑 (409) | 查正文内容 | 前向单文件替换 | `DialogueStream.tsx:588`, `probe-05` |
| **定稿提交** | `/api/chapter.commit` | **强 (STRONG)** | 非幂等 (已提交 409) | `withBookLock` + CAS | 查 `commitId` | **5阶段物理 2PC** | `commit-orchestration.ts:191`, `probe-06` |
| **生成候选** | `/api/draft.stream` | **强 (STRONG)** | 独立请求全新 ID | 无锁并行并发 | 查 `draft.candidate` | 候选区单文件隔离 | `pipelineRoutes.ts:546`, `probe-04` |
| **取消生成** | `/api/draft.cancel` | **强 (STRONG)** | 纯幂等状态标记 | 终态收敛 | 查候选状态 | 候选单文件标记 | `draft-candidate.ts:160` |
| **灾难恢复** | `openOrRebuild` / `restore` | **强 (STRONG)** | 确定性幂等重建 | 进程排他锁排队 | 查 schema 版本 | 单 SQLite 事务 / 2PC | `chapter.ts:320`, `probe-11` |
| **导出作品** | `/api/export` | **强 (STRONG)** | 纯只读幂等 | 无锁无争夺 | 客户端重试 | 零写盘纯内存流 | `exportRoutes.ts:15`, `probe-10` |
| **用户认证** | `/api/account/*` | **强 (STRONG)** | 登录幂等/注册去重 | 账号单文件替换 | 查 `/api/account` | 账户文件原子写入 | `accountRoutes.ts:14` |
| **模型凭据** | `/api/llm/settings` | **强 (STRONG)** | 幂等更新覆盖 | 后写者胜 (LWW) | 查 configVersion | AES-GCM 加密落盘 | `providerSettings.ts:10` |
| **商业支付** | `/api/billing/*` | **强 (STRONG)** | **真幂等** (订单与回调) | SQLite 事务锁 | 主动查单 + 重发 | **SQLite ACID 事务** | `billingRoutes.ts:18`, `store.ts:10` |

---

> **审查综合裁决**：
> 1. **两阶段提交与一致性设计优良**：在「采纳候选（`draft.accept`）」与「定稿提交（`chapter.commit`）」两处，MoZhou 展现了高水准的意图日志与 2PC 事务编排，成功隔离了 AI 生成风险，实现了本地优先长篇写作的不变量闭环。
> 2. **三处需正视的语义认知偏差**：
>    - **保存草稿并非真正幂等**：重复保存返回 409，属于乐观冲突拒绝，要求客户端具备自愈探针；
>    - **撤销采纳并非时光倒流**：撤销是前向升版写入（Forward Step），且页面刷新后即丧失快速撤销通道；
>    - **2PC 提交恢复存在二次打断丢数据盲点**：在极端连续断电下，`recoverForward` 恢复流程存在追踪流增量永久丢失的风险（已由实测确证）。
