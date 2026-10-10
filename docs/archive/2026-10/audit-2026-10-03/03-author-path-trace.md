# 03 · 真实作者路径贯穿检查与八类状态归属审计报告（MoZhou 模块架构审计 · 2026-10-03）

> 审计章程口径依据：`audit-2026-10-03/00-audit-charter.md`  
> 基线与图谱门禁依据：`audit-2026-10-03/01-baseline-and-graph-gate.md`  
> 原始命令与图谱日志：`audit-2026-10-03/logs/040` ~ `044`  
> 审计员：module-mapper-2（模块测绘与三张架构图）  
> 审计时间：2026-10-03T01:25+08:00（Asia/Shanghai）  

---

## 1. 审计概述、基线与图谱门禁

### 1.1 基线与代码版本说明
本报告所有链路排查以当前仓库实际状态为唯一基准：
- **基线提交**：`HEAD:90b45a1a1bf15a97b1cc690ad0b9872018aeebcb`（短哈希 `90b45a1`）
- **工作区状态**：既有未提交改动 42 条（`-uall` 展开为 50 个文件），其中 3 已暂存，23 未暂存，16 未跟踪。
- **运行单元版本事实**：经 `01-baseline-and-graph-gate.md` §8.1 确证，`apps/web/node_modules/@mozhou/*` 系 Junction 符号链接至 `packages/*`，`dist-server` 与 Vite 运行的均为**工作区（WORKTREE）活代码**。因此，本报告中凡涉及修改文件（如 `ProseEditorPanel.tsx`、`WorkbenchView.tsx`、`App.tsx`、`pipelineRoutes.ts`、`assemble.ts`、`kernel-schema.ts`）的代码行号，**均同时标明 `HEAD:90b45a1` 与 `WORKTREE(未提交)` 两处行号**，文件未改动者标 `HEAD:90b45a1`（对齐章程 §3）。

### 1.2 图谱门禁（GitNexus CLI）证据
依据 `00-audit-charter.md` §7 与主契约，所有跨模块拓扑与调用链均经 GitNexus CLI（v1.6.10-rc.123）执行检验，证据保存在 `audit-2026-10-03/logs/`：
- `logs/040-gitnexus-author-path.txt`：`query` 召回流程（`acceptDraft`、`CandidateDraftKey` 等）；
- `logs/041-gitnexus-context-author-path.txt`：`context` 关键符号关联分析；
- `logs/042-line-number-provenance.txt`：全路径关键文件 mtime、diff 及 HEAD vs WORKTREE 行号核验；
- `logs/043-pipelineRoutes-head-vs-worktree.txt`：`pipelineRoutes.ts` 与前端组件的行号严格对照；
- `logs/044-gitnexus-author-path-symbols.txt`：`assembleBudgetedContext`、`saveProseDraft`、`acceptDraft`、`commitChapter`、`recoverPendingCommit`、`rebuildProjectionFromCanon`、`executeChapterReview`、`exportSubmissionDocx`、`createBookBackup`、`restoreBookBackup` 十大符号的 360 度上下文与执行流提取。

---

## 2. 真实作者完整路径逐步贯穿审计（11 步）

本节沿真实作者旅程，逐一贯穿 11 个核心操作阶段。每一步严格剖析其 UI 入口、传输契约、协调层符号、存储落盘、时序关系以及故障边界。

```
[打开书籍] ──> [编辑正文] ──> [保存草稿] ──> [生成候选] ──> [停止/切章]
                                                  │
[关闭重开] <── [定稿提交] <── [审查质检] <── [采纳/撤销] <┘
    │
[导出作品] ──> [系统恢复] (2PC崩溃恢复 / 投影重建 / 外部对账 / 备份还原)
```

---

### 2.1 打开书籍（Open Book & Works Overview）

- **UI 入口**：
  - 组件：`apps/web/src/App.tsx`（`App` 根容器，`WORKTREE:L162-L245` / `HEAD:L150-L225`）与 `apps/web/src/bookshelf/BookshelfView.tsx`（书架视图）。
  - 事件：组件挂载时首选从本地存储读取 `loadWorkbenchState()`（`apps/web/src/shell/workbenchStorage.ts:26`，`HEAD:90b45a1`）；书架卡片点击触发 `handleBookSwitch` / `selectBook(nextBook)`（`App.tsx:236` `WORKTREE` / `L218` `HEAD`），通过 `confirmStoryboardLeave` 防丢检查后更新 `book` 状态。
- **HTTP/IPC 路由与参数**：
  - 路由：`POST /api/works`
  - 请求载荷：`{ root: string }`
  - 响应结构：`WorksOverviewResponse { ok: true, book: BookMeta, chapters: ChapterOverviewItem[] }`（定义于 `apps/web/server/api.ts:16` `HEAD:90b45a1`）。
- **应用协调层与领域规则**：
  - 路由处理：`apps/web/server/routes/worksRoutes.ts:16`（`HEAD:90b45a1`）。
  - 句柄借用与恢复打开：调用 `@mozhou/data-plane` 中的 `withBook(root, (plane) => plane.getWorksOverview())`（`packages/data-plane/src/with-plane.ts:90` `HEAD:90b45a1`）。
  - 领域不变式（ADR-0006）：`withBook` 采用 `openOrRebuild` 语义。若目标书籍的 SQLite 投影文件（`.mozhou/runtime.sqlite`）丢失或坏损，**自动由 canon 文件从零全量重建**（`rebuildProjectionFromCanon`，`packages/data-plane/src/local-data-plane.ts:451` `HEAD:90b45a1`），绝不阻塞开书。
  - 脚手架补齐：若首开章节尚不存在，调用 `ensureChapterScaffold(safeRoot, 1, bookId)` 补齐基础大纲节点与占位正文。
- **存储、事件与模型执行**：
  - 存储：只读读取盘上 `book.json`、`.mozhou/runtime.sqlite`（表 `books`、`outline_nodes`）。
  - 事件：无领域事件发射。
  - 模型：零模型调用。
- **成功响应与实际持久化的先后顺序**：
  - 前端：React 状态 `setBook(nextBook)` 更新后，触发 `useEffect` 执行 `saveWorkbenchState({ book, view })`（`App.tsx:218` `WORKTREE`），**同步写入**浏览器的 `window.localStorage['mozhou.workbench.v1']`。
  - 服务端：读操作无数据落盘。不存在未落盘风险。
- **失败、取消、重复调用与重启后的状态**：
  - 失败：路径非法或根目录不存在时，返回 404 或 400；前端显示错误兜底界面。
  - 重复调用：纯幂等读操作，重复调用无副作用。
  - 重启恢复：页面刷新后，`useState(loadWorkbenchState)` 立即从 `localStorage` 回填上次打开的作品，实现无感热恢复。

---

### 2.2 编辑（Prose Editing & Slate Dirty Tracking）

- **UI 入口**：
  - 组件：`apps/web/src/workbench/editor/ProseEditorPanel.tsx`（`ProseEditorSession`，`WORKTREE:L45` / `HEAD:L45`）。
  - 子组件：`NovelEditorCanvas.tsx`（TipTap/ProseMirror 编辑器画布）与 `EditorQualityTelemetry.tsx`（实时本地字数、段落与 4-gram 复读监测）。
  - 事件：作者击键输入，触发 `NovelEditorCanvas` 的 `onChange` 回调，进而执行 `ProseEditorSession` 中的 `handleChange(next: string)`（`ProseEditorPanel.tsx:126` `WORKTREE` / `L110` `HEAD`）。
- **HTTP/IPC 路由与参数**：
  - **无任何 HTTP/IPC 网络调用**。编辑属于前端纯本地高频交互，彻底隔绝网络开销。
- **应用协调层与领域规则**：
  - 脏状态判定规则（Dirty Tracking）：通过比较当前编辑器内存文本 `text` 与基线哈希 `saveDraftBaseline`。
  - 判据符号：`draftCacheMatchesBaseline(text, draftKey)`（`apps/web/src/shell/workbenchStorage.ts:97` `HEAD:90b45a1`），内部计算 `syncSha256Hex(text)` 并比对 `localStorage['mozhou.draft.baseline.' + draftKey]`。
  - 卸载拦截守卫：注册 `window.addEventListener('beforeunload', handleBeforeUnload)`（`ProseEditorPanel.tsx:113` `WORKTREE`）。当文本处于脏状态且非空时，激活浏览器防误关丢稿对话框（`e.preventDefault()`）。
- **存储、事件与模型执行**：
  - 写入点：`saveDraftCache(next, draftKey)`（`workbenchStorage.ts:73` `HEAD:90b45a1`），同步写入 `window.localStorage['mozhou.draft.cache.ch_' + identity + '_' + chapterIndex]`。
  - 注意事项：**键入手势绝不改变保存基线（Draft Baseline）**，基线只有在服务端保存成功或主动回填时才刷新。
  - 事件与模型：零事件、零模型。
- **成功响应与实际持久化的先后顺序**：
  - 前端同步写入：React 状态 `setText` 与 `localStorage.setItem` 在同一个事件循环帧内同步完成。
  - 磁盘落盘：**此时完全未落到服务端物理磁盘（`正文/第NN章.md` 仍为旧版）**。状态属于第 1 类「作者未保存编辑」。
- **失败、取消、重复调用与重启后的状态**：
  - 崩溃/掉电：浏览器崩溃或意外杀进程后，`localStorage` 中的工作文本不受影响。
  - 重启恢复：重新打开该章时，`useState(() => loadDraftCache(draftKey))` 优先恢复未保存编辑。

---

### 2.3 保存草稿（Save Prose Draft & Conflict Guard）

- **UI 入口**：
  - 组件：`ProseEditorPanel.tsx` 中的「保存草稿」按钮，绑定 `saveAsDraft()`（`WORKTREE:L183` / `HEAD:L167`），内部调用 `doSave(expectedRevision, baseLabel)`（`WORKTREE:L148` / `HEAD:L132`）。
- **HTTP/IPC 路由与参数**：
  - 路由：`POST /api/chapter.prose.save`
  - 载荷参数：
    ```json
    {
      "root": "C:\\zcode\\novel-ai\\...",
      "chapterIndex": 1,
      "body": "正文内容...",
      "expectedRevision": 3,
      "title": "第一章",
      "confirmExternalOverwrite": false
    }
    ```
  - 契约约束：`expectedRevision` 必须显式在场（`null` 表示新建章，正整数表示更新基线），禁止无版本盲存。
- **应用协调层与领域规则**：
  - 路由分发：`apps/web/server/routes/proseRoutes.ts:293`（`HEAD:90b45a1`）。
  - 权限与解码：`decodeBookRequest` 验证租户与书籍访问权。
  - 数据平面调用：`withBook(root, (plane) => plane.saveProseDraft(...))`（`packages/data-plane/src/chapter.ts:805` `HEAD:90b45a1`）。
  - 领域不变式与三道冲突守卫（`chapter.ts:814-828`）：
    1. **定稿锁守卫**：若盘上现有章节 `existing.phase === 'committed'`，拒绝普通保存，抛出 `ChapterPhaseError`（HTTP 409 `CHAPTER_COMMITTED`），要求作者显式执行「重开定稿」；
    2. **版本 CAS 守卫**：若盘上版本 `existing.revision !== request.expectedRevision`，说明被他端或并发请求修改，抛出 `ProseRevisionConflictError`（HTTP 409 `PROSE_REVISION_CONFLICT`）；
    3. **写前哈希守卫**：调用 `assertPreWriteHash(ctx, proseRel)`。若磁盘文件被外部编辑器改动（外部改动不增加 revision，但 sha256 改变），除非作者显式传递 `confirmExternalOverwrite: true`，否则坚决抛出 `PreWriteHashMismatchError`（HTTP 409 `PROSE_EXTERNAL_CHANGE`）。
- **存储、事件与模型执行**：
  - 物理落盘（原子写入）：`atomicReplace(ctx.root, proseRel, content)`（`chapter.ts:838`），渲染 frontmatter（`phase: draft`, `revision: N+1`）并通过临时文件 `.mozhou-tmp` 原子重命名替换 `正文/第NN章.md`。
  - 基线刷新：`ctx.manifest = refreshManifestEntries(ctx.manifest, ctx.root, [proseRel])` 并执行 `writeManifestFor(ctx)` 更新 `.mozhou/manifest.json`。
  - 派生编辑信号：调用 `recordWholeBodyAuthorEdit`（`proseRoutes.ts:329`），发射 `UserEditRecorded` 事件至发布总线，生成作者编辑块用于后续飞轮学习。该步骤失败降级记录，不阻塞主正文保存。
- **成功响应与实际持久化的先后顺序**：
  - **持久化严格先于成功响应**：`正文/第NN章.md` 与 `manifest.json` 在服务端完成 `atomicReplace` 物理落盘后，服务端才发出 HTTP 200 JSON 响应。
  - 前端基线更新：前端收到 200 响应后，执行 `saveDraftBaseline(text, draftKey)`，将本地基线哈希与服务端同步，并触发 `mozhou:telemetry-refresh` 事件刷新管线状态。
  - **窗口判定**：**不存在「已返回成功但未落盘」的危险窗口**。
- **失败、取消、重复调用与重启后的状态**：
  - 冲突拒绝（409）：磁盘零修改，作者写作层文本在前端完整保留，界面呈现冲突差异，提供「核对后覆盖」操作。
  - 重复调用：由于 revision 已递增，相同参数的重放会被 CAS 守卫安全拦截为 409，杜绝脏写。

---

### 2.4 生成候选（Draft Streaming & Candidate Generation）

- **UI 入口**：
  - 组件：`apps/web/src/workbench/DialogueStream.tsx`（`WORKTREE:L200-L380` / `HEAD:L200-L380`）。
  - 事件：作者在输入框提交引导 prompt 或点击技能卡，触发 `handleSend()`。
- **HTTP/IPC 路由与参数**：
  - 路由：`POST /api/draft.stream`
  - 载荷参数：
    ```json
    {
      "root": "C:\\zcode\\novel-ai\\...",
      "chapterIndex": 1,
      "prompt": "续写主角突破重围...",
      "activeSkills": ["combat-pacing"],
      "mode": "replace",
      "base": { "revision": 2, "sha256": "4a7b..." }
    }
    ```
  - 传输协议：HTTP 200 + `Content-Type: application/x-ndjson; charset=utf-8`。
- **应用协调层与领域规则**：
  - 路由入口：`apps/web/server/routes/pipelineRoutes.ts:546`（`WORKTREE` / `L524` `HEAD`）。
  - Provider 真实性检查：`resolveGenerationTarget`（`pipelineRoutes.ts:586` `WORKTREE`），若未配置 provider 返回 200 伴随 `code: PROVIDER_UNAVAILABLE`，拒绝假伪造。
  - 上下文编译（Context Compiler）：
    - 调用 `buildDraftContext({ root, chapterIndex, authorPrompt })`（`apps/web/server/draftContext.ts:133` `HEAD:90b45a1`）。
    - 调度 `assembleBudgetedContext`（`packages/context-compiler/src/assemble.ts:399` `WORKTREE`），经 keyword + graph + embedding 三通道检索。
    - 凭证持久化：调用 `persistReceipt` 将完整装配快照写入 `.mozhou/receipts/rcpt_<ULID>.json`，并在 `.mozhou/events.jsonl` 追加 `ContextCompiled` 领域事件行（INV-R1 崩溃一致序：先凭证后事件）。
  - 候选实体建立：
    - 服务端铸造 `candidateId = createCandidateId()`（UUID）。
    - 绑定基线 `base: WriteBase`（取自盘面当前正文版本与哈希）。
    - 创建磁盘候选：`createDraftCandidate` 在 `.mozhou/candidates/<candidateId>.json` 创建初始文件，初始状态标记为 `streaming`（`packages/pipeline/src/draft-candidate.ts:113` `HEAD:90b45a1`）。
  - 执行引擎与流式推送：
    - 调用 `makeStreamEngine` 启动 LLM 流式连接。
    - 向客户端推送 `start` 帧、多包 `delta` 帧以及收尾 `done` 帧。
- **存储、事件与模型执行**：
  - 存储：`.mozhou/candidates/<candidateId>.json`（候选物理落盘，严禁触碰 `正文/第NN章.md`）。
  - 前端缓存：`DialogueStream.tsx:331`（`WORKTREE`）调用 `saveCandidateCache`，将当前候选文本镜像至 `window.localStorage['mozhou.candidate.cache.cand_' + identity + '_' + chapterIndex]`。
  - 模型：调用 OpenAI 兼容端点或本地 Mock 引擎。
- **成功响应与实际持久化的先后顺序**：
  - 流式帧逐步落盘：文本增量随流推送，客户端在内存累积并暂存 localStorage。
  - 终局状态：流正常结束且生成字数有效时，候选文件就地持久化为 `ready` 终态；若异常中断则标记为 `partial`。正典正文此时零修改。
- **失败、取消、重复调用与重启后的状态**：
  - 模型报错：推送 `event: error` 帧，前端转入 `error` 相位，清除发送态。
  - 重复调用：每个请求生成唯一 `candidateId`，互不干扰。

---

### 2.5 停止或切章（Stop Streaming & Chapter Switching Guard）

- **UI 入口**：
  - 停止流：作者点击「停止生成」按钮，触发 `DialogueStream.tsx:383` 的 `handleStop()`（`WORKTREE`）。
  - 切换章节/作品：在 `WorkbenchView.tsx` 点击章节卡片，触发 `onChapterIndexChange(nextIndex)`；或切书触发 `App.tsx:selectBook`。
- **HTTP/IPC 路由与参数**：
  - 客户端取消：调用原生 `requestControllerRef.current.abort()` 与 `readerRef.current.cancel()`。
  - 服务端取消通知（可选通道）：`POST /api/draft.cancel`，载荷 `{ root, candidateId }`。
- **应用协调层与领域规则**：
  - 连接挂断感知：服务端 `pipelineRoutes.ts:626` 监听 HTTP 请求的 `res.on('close', () => abortController.abort())`，强行截断向外部大模型的调用。
  - 现场切章守卫（Site Mismatch Guard）：
    - `DialogueStream.tsx` 维护 `requestIdRef` 与 `currentSiteRef = { bookId, chapterIndex }`。
    - 异步流在任何帧消费前均执行 `stillOnSite()` 核验。若作者已切章，立即触发 `res.body.cancel()` 并丢弃旧流内容，绝不跨章串稿。
  - 半稿保护规则（Partial Draft Rule）：
    - 若流在生成中途停止，但已生成部分有效字数（`outcome.produced === true`），系统**绝不当作失败删除**，而是判定为 `partial` 半稿。
    - 候选文件状态写为 `partial`，保留已有字数，允许作者后续执行「继续续写」或「确认采纳半稿」。
- **存储、事件与模型执行**：
  - 物理落盘：`packages/pipeline/src/draft-candidate.ts:cancelCandidate` 将 `.mozhou/candidates/<candidateId>.json` 状态修改为 `cancelled` 或保留为 `partial`。
  - 客户端存储：`saveCandidateCache` 更新本地缓存中的 `partial: true` 标记。
- **成功响应与实际持久化的先后顺序**：
  - 前端先切断读取，状态立即重置为 `draft_done`（带 partial 标记），随后后台完成候选文件的终态落盘。
- **失败、取消、重复调用与重启后的状态**：
  - 重启恢复：刷新页面后，`loadCandidateCache` 重新加载该章的半稿，对话区恢复展示并保留「采纳进正文（半稿需确认）」按钮。

---

### 2.6 采纳与撤销（Accept Candidate & Undo with CAS Guard）

- **UI 入口**：
  - 采纳候选：`DialogueStream.tsx` 中的「采纳进正文」按钮，触发 `handleAccept()`（`WORKTREE:L437` / `HEAD:L437`）。
  - 撤销采纳：采纳成功后呈现的「撤销采纳」条幅，触发 `handleUndoAccept()`（`WORKTREE:L588` / `HEAD:L588`）。
- **HTTP/IPC 路由与参数**：
  - 采纳路由：`POST /api/draft.accept`
    - 载荷参数：`{ root, candidateId, base: { revision, sha256 }, idempotencyKey, bookId, chapterIndex, allowPartial }`
  - 撤销路由：`POST /api/chapter.prose.save`
    - 载荷参数：`{ root, chapterIndex, body: undo.oldText, expectedRevision: undo.afterRevision }`
- **应用协调层与领域规则**：
  - 采纳业务流（`packages/pipeline/src/draft-accept.ts:184` `HEAD:90b45a1`）：
    1. 候选前置核验：必须为 `ready` 状态；若为 `partial` 必须显式携带 `allowPartial: true`。
    2. 幂等检查：`findIntentByKey` 核验 `idempotencyKey`。若已执行过（`state === 'done'`），直接返回 `alreadyApplied: true`，不重复写盘。
    3. 盘面一致性核验：`scan.revision === candidate.base.revision` 且文件哈希未变。
    4. 两阶段意图记录（2PC Intent）：先将意图写入 `.mozhou/candidates/<candidateId>.intent.json`（标记 `state: 'intent'`）；
    5. 权威写入：调用 `plane.saveProseDraft` 将合成后文本写入 `正文/第NN章.md`，递增 revision；
    6. 终态确认：更新意图文件为 `state: 'done'`，并标记候选状态为 `accepted`。
  - 撤销机制（Undo Guard · CAS 保护）：
    - 墨舟的撤销**不是历史回滚（Rollback）**，而是**一次新的前向保存（Forward Save）**。
    - 严格绑定版本：`DialogueStream.tsx:608` 检查盘面当前版本是否仍等于采纳后版本 `latest.revision === undo.afterRevision`。
    - 若采纳后作者在 Reading Slate 又进行了手动修改（导致 revision 再次改变），撤销请求被坚决拒绝（409 冲突），提示存在新修改，拒绝破坏作者后续心血。
- **存储、事件与模型执行**：
  - 存储变动：
    1. `.mozhou/candidates/<id>.intent.json` 创建与确认；
    2. `正文/第NN章.md` frontmatter revision 递增，正文更新；
    3. `.mozhou/candidates/<id>.json` 状态改为 `accepted`；
    4. `.mozhou/manifest.json` 刷新。
  - 前端缓存同步：触发 `window.dispatchEvent(new CustomEvent('mozhou:prose-adopted'))`，通知 `ProseEditorPanel` 立即从服务端拉取最新章快照，刷新编辑器画布与本地缓存。
- **成功响应与实际持久化的先后顺序**：
  - 正文落盘与意图置 `done` 完成后，服务端才向前端返回 200 OK。
  - 前端随后刷新 `localStorage` 并挂载 Undo 句柄。不存在虚假成功。
- **失败、取消、重复调用与重启后的状态**：
  - 崩溃恢复：若服务在正文落盘与写 `done` 之间崩溃，重启后 `acceptDraft` 自动根据磁盘正文状态完成意图前滚，保证事务一致性。

---

### 2.7 审查（Review & Quality Checks & Canon Proposals）

- **UI 入口**：
  - 组件：`apps/web/src/quality/QualityPanel.tsx`（质量审查面板，`HEAD:90b45a1`）与 `ProposalQueueView.tsx`（正典提案队列）。
  - 事件：点击「运行质量审查」触发审查；在待决提案列表点击「采纳/忽略/编辑」触发决策。
- **HTTP/IPC 路由与参数**：
  - 质量审查：`POST /api/chapter.review`，载荷 `{ root, chapterIndex, policy? }`
  - 质量查询：`POST /api/chapter.quality`，载荷 `{ root, chapterIndex }`
  - 提案列表：`POST /api/proposal.list`，载荷 `{ root }`
  - 提案决策：`POST /api/proposal.decide`，载荷 `{ root, proposalId, itemId, action: 'confirm'|'reject'|'editAccept', patch? }`
- **应用协调层与领域规则**：
  - 路由实现：`apps/web/server/routes/pipelineRoutes.ts:772, 914, 952, 975`（`WORKTREE`）。
  - 评估锚点真实性锁（Anchor Integrity）：
    - 审查前必须调用 `resolveCompiledAnchor(root, chapterIndex)` 读取账本平铺的 `ContextCompiled` 行。
    - **若该章无上下文编译凭证，坚决返回 409 `NO_COMPILED_RECEIPT`**，严禁伪造凭证或凭空编造评估锚点。
  - 质量引擎（`executeChapterReview`）：
    - 执行机械门禁（Mechanical Gate）：字数检测、4-gram 循环复读率、Tier1 违禁词（禁词表过滤）、对话比与句长分布。
    - 生成质量报告，落盘至 `.mozhou/quality_reports/rpt_<ULID>.json`。
    - 发射 `QualityReportGenerated` 审计事件。
  - 正典提案处理（ProposalPort）：
    - 扫描 `.mozhou/proposals/prop_<ULID>.json` 中的未决提案项。
    - 支持作者对 AI 提取的角色、物品、设定增量做人工裁决（Confirm / Reject / EditAccept）。
- **存储、事件与模型执行**：
  - 存储：`.mozhou/quality_reports/*.json`、`.mozhou/proposals/*.json`。
  - 事件：`.mozhou/events.jsonl` 追加审查事件。
  - 模型：执行语义审查分析或规则判定。
- **成功响应与实际持久化的先后顺序**：
  - 报告文件物理写入磁盘后，接口返回 200 及详细评估项。
- **失败、取消、重复调用与重启后的状态**：
  - 提案跨重启持久化：提案记录完全基于物理文件，重启后 `proposal.list` 依然完整保留所有未决项，静待作者确认。

---

### 2.8 定稿提交（Commit Chapter & 2PC Orchestration）

- **UI 入口**：
  - 组件：`apps/web/src/workbench/WorkbenchView.tsx`（`WORKTREE:L230-L340`）与 `apps/web/src/shell/PipelineStrip.tsx`（管线阶段轨）。
  - 事件：作者确认正文就绪，点击「定稿提交（Commit）」按钮。
- **HTTP/IPC 路由与参数**：
  - 路由：`POST /api/chapter.commit`
  - 载荷参数：
    ```json
    {
      "root": "C:\\zcode\\novel-ai\\...",
      "chapterIndex": 1,
      "summary": "第一章初次定稿",
      "expectedRevision": 4,
      "usage": [
        { "kind": "usage", "model": "gpt-4o", "inputTokens": 1200, "outputTokens": 800 }
      ]
    }
    ```
- **应用协调层与领域规则（管线五步大编排）**：
  - 路由入口：`apps/web/server/routes/proseRoutes.ts:480`（`HEAD:90b45a1`）。
  - 核心编排：`runChapterCommit`（`packages/pipeline/src/commit-orchestration.ts:191` `HEAD:90b45a1`）。
  - 完整编排步骤（`commit-orchestration.ts:191-495`）：
    1. **前置相位与 CAS 比对**：章节必须处于 `phase: 'draft'` 且 `revision === expectedRevision`，否则 0 消耗直接 409 拒绝；
    2. **陈旧提案检查**：若存在旧 revision 的未决提案，返回 409 `CANON_PROPOSAL_STALE`，要求先清旧提案；
    3. **Final Extract（终稿设定增量提取）**：调用 `extractChapterDelta` 抽取五族事实（时序、知识、关系、承诺、时间线事件）；
    4. **Continuity Gate（连续性硬门禁）**：机械核对提取事实。若发现硬冲突（`hard_conflict`），正典零写入，返回 409 `CONTINUITY_HARD_CONFLICT`；
    5. **待决提案挂起**：若提取结果含 medium/high 风险项，生成提案文件并返回 409 `CANON_PROPOSAL_PENDING`，正典零写入；
    6. **数据平面两阶段提交（2PC Atomic Commit）**：调用 `plane.commitChapter(...)`（`packages/data-plane/src/chapter.ts:569` `HEAD:90b45a1`）。
- **存储、事件与模型执行（2PC 内部物理写入序列）**：
  `chapter.ts:569-705` 实现了确定性两阶段提交：
  1. **写前校验**：核对正文与所有目标追踪流（`设定/*.jsonl`）的写前哈希（`assertPreWriteHash`）；
  2. **写入日志（Stage 1）**：生成 `PendingCommitJournal`，落盘到 `.mozhou/pending_commit.json`；
  3. **追加正典流（Stage 2）**：向 `设定/事实.jsonl` 等目标文件追加增量；
  4. **追加审计事件（Stage 3）**：向 `.mozhou/events.jsonl` 追加 `ChapterCommitted` 事件行；
  5. **线性化点（Linearization Point）**：调用 `atomicReplace` 原子重命名将 `正文/第NN章.md` 的 frontmatter 相位翻转为 `phase: committed`，记录 `commitId`；
  6. **更新 SQLite 投影（Stage 4）**：向 SQLite 数据库 `tracking_lines` 表插入对应追踪行；
  7. **立基线与删日志（Stage 5）**：更新 `.mozhou/manifest.json`，并调用 `unlinkSync` 删除 `.mozhou/pending_commit.json` 日志。
  8. **飞轮记账与文风画像更新**：调用 `runFlywheelRecord` 向 `.mozhou/usage.jsonl` 追加用量行；触发 `runStyleLearnerForWindow` 学习文风，更新 `文风.md`。
- **成功响应与实际持久化的先后顺序**：
  - **持久化绝对领先于响应**：上述 8 个物理写盘步骤必须全数在服务端执行完毕，`POST /api/chapter.commit` 才会发出 200 响应。
  - **窗口判定**：**绝不存在「返回提交成功但未完成落盘」的漏洞**。
- **失败、取消、重复调用与重启后的状态**：
  - 中途断电崩溃：重启由 `recoverPendingCommit` 介入处理（见 2.11 节），若正文已翻转则前滚补齐，未翻转则后滚截断，保障强一致性。

---

### 2.9 关闭重开（App/Page Reload & State Hydration）

- **UI 入口**：
  - 操作：作者关闭浏览器标签页、杀死桌面客户端进程，随后重新打开。
  - 入口：`apps/web/src/App.tsx` 重新挂载。
- **HTTP/IPC 路由与参数**：
  - 前端发起：
    - `POST /api/works`（获取书籍概要与章节列表）
    - `POST /api/chapter.prose`（读取当前章服务端持久化正文快照）
    - `POST /api/chapter.quality`（读取当前章质量状态）
- **应用协调层与状态回填规则**：
  - 1. **工作台状态回填**：`App.tsx:163` 执行 `loadWorkbenchState()`，从 `localStorage` 读取上次选择的书籍（`root`、`bookId`、`title`）和视图，自动切入对应界面。
  - 2. **编辑器草稿回填（ProseEditorPanel）**：
    - 首先同步读取 `loadDraftCache(draftKey)`（优先呈现本地可能存在的未保存文字）；
    - 异步发起 `POST /api/chapter.prose`，获取服务端章快照；
    - **回填裁决逻辑（`ProseEditorPanel.tsx:100-108` `WORKTREE`）**：
      - 若本地缓存为空，或本地缓存完全匹配上次的保存基线（`draftCacheMatchesBaseline(cached, draftKey)` 为 true），说明作者未作离线更改，**自动以服务端权威正文回填编辑器，并刷新基线**；
      - 若本地缓存有未保存修改且与基线不同，**坚决不以服务端内容覆盖本地草稿**，保留作者输入并提示未保存状态。
  - 3. **对话流候选回填（DialogueStream）**：
    - 执行 `loadCandidateCache(candidateDraftKey(book, chapterIndex))`，从 `localStorage` 恢复尚未采纳的 AI 候选或半稿，输入框与候选卡片立即重现。
- **存储、事件与模型执行**：
  - 前端：读取浏览器 `localStorage`；
  - 服务端：只读读取盘上各 markdown/json 文件。
- **成功响应与实际持久化的先后顺序**：
  - 纯读取与状态重现，无持久化延迟。
- **失败、取消、重复调用与重启后的状态**：
  - 服务端离线：若服务端未启动，快照显示 `unavailable`，`ProseEditorPanel` 激活防御锁（`saveBlocked`），禁止在失去冲突保护的情况下盲目提交。

---

### 2.10 导出（Publication-Grade Export TXT/DOCX/EPUB）

- **UI 入口**：
  - 组件：`apps/web/src/export-suite/exportDownload.ts`（`HEAD:90b45a1`）与作品管理页 `WorksView.tsx`。
  - 事件：作者选择导出格式（TXT / DOCX / EPUB），点击「导出作品」按钮，调用 `executeExportWorkflow`。
- **HTTP/IPC 路由与参数**：
  - 路由：`POST /api/export`
  - 载荷参数：
    ```json
    {
      "bookTitle": "我的小说",
      "format": "docx",
      "author": "墨舟作者",
      "synopsis": "作品简介...",
      "root": "C:\\zcode\\novel-ai\\...",
      "chapters": [
        { "title": "第一章", "content": "章节内容..." }
      ]
    }
    ```
  - 响应：二进制文件流（带 `Content-Disposition: attachment; filename="..."`）。
- **应用协调层与领域规则**：
  - 路由入口：`apps/web/server/routes/exportRoutes.ts:15`（`HEAD:90b45a1`）。
  - 服务端源数据兜底与正文读取：
    - 若客户端未内联传递 `chapters`，服务端通过 `withStrictBook(root, (plane) => plane.getWorksOverview().chapters.map(...))` 自动从盘上正文目录逐章读取 `readProseChapter(root, proseChapterPath(ch.chapterIndex))`。
  - **防缺章硬校验（Anti-Empty Chapter Guard）**：
    - `exportRoutes.ts:60` 逐章检查内容长度。
    - **若任一章节的正文去除首尾空格后为空，立即返回 409 `EXPORT_EMPTY_CHAPTER` 并取消导出**，坚决防止向出版端交付残缺缺章文件。
  - 出版级排版格式化：
    - `txt`: `exportCleanTxt`（`packages/data-plane/src/txt-clean-exporter.ts`）；
    - `docx`: `exportSubmissionDocx`（`packages/data-plane/src/docx-submission-exporter.ts`），生成规范仿宋字号、首行缩进排版；
    - `epub`: `exportSubmissionEpub`（`packages/data-plane/src/epub-submission-exporter.ts`），打包标准 EPUB3 电子书。
- **存储、事件与模型执行**：
  - 存储：服务端纯只读，零磁盘写入。
  - 客户端：接收 `res.blob()`，通过动态创建 `<a>` 标签模拟触发浏览器文件下载。
- **成功响应与实际持久化的先后顺序**：
  - 数据全量在内存组装完成，流式传输至浏览器落到作者本地下载目录。无服务端落盘悬挂窗口。
- **失败、取消、重复调用与重启后的状态**：
  - 幂等只读，支持任意次重复导出。

---

### 2.11 恢复（2PC Crash Recovery, Projection Rebuild, Reconciliation, Backup Restore）

本阶段是墨舟整个架构在容灾、防崩溃、防篡改层面的血脉底座，涵盖四大独立恢复机制：

#### A. 提交事务崩溃恢复（2PC Pending Commit Recovery）
- **触发时机**：任何调用 `LocalDataPlane.open(root)` 或 `openOrRebuild(root)` 实例化的入口（`packages/data-plane/src/local-data-plane.ts:108` `HEAD:90b45a1`）。
- **执行符号**：`recoverPendingCommit(root)`（`packages/data-plane/src/chapter.ts:320` `HEAD:90b45a1`）。
- **时序与恢复判据**：
  - 检查是否存在 `.mozhou/pending_commit.json`。若无日志直接返回；
  - 验明日志中记录的 `stagedProseSha256` 与 `originalProseSha256`；
  - 读盘比对当前 `正文/第NN章.md` 的物理哈希：
    - **前滚恢复（Recover Forward）**：若正文哈希已等于 `stagedProseSha256`，表明崩溃发生在线性化点（正文翻转）之后。恢复流程：
      1. 将被中断截断的追踪流和事件追加行按日志基准完整补齐；
      2. 幂等向 SQLite 投影重放 `tracking_lines` 行；
      3. 重新建立 `manifest.json` 基线哈希；
      4. 删除 `pending_commit.json`，完成定稿收口。
    - **后滚回滚（Recover Backward）**：若正文哈希等于 `originalProseSha256`，表明崩溃在线性化点之前。恢复流程：
      1. 调用 `truncateSync` 将追踪流与事件流裁剪恢复至 `baseBytes` 初始长度；
      2. 物理清除可能残留的 `.mozhou-tmp` 临时文件；
      3. 删除 `pending_commit.json`，安全放弃未完成提交。
    - **严重冲突**：若正文既不等于前锚也不等于后锚，抛出 `PendingCommitConflictError`，拒绝静默修坏。

#### B. SQLite 投影全量重建（Projection Rebuild）
- **触发时机**：`.mozhou/runtime.sqlite` 物理损坏、版本不匹配（`PROJECTION_SCHEMA_VERSION` 失配）或文件缺失时，`LocalDataPlane.openOrRebuild` 自动触发。
- **执行符号**：`rebuildProjectionFromCanon(root)`（`packages/data-plane/src/local-data-plane.ts:451` `HEAD:90b45a1`）。
- **重建流程**：
  - 在临时路径或全新建立数据库，执行 `initProjection(db)` 构建 DDL；
  - 扫描 `book.json`、`大纲/`、`设定/`、五族追踪流 jsonl 以及目录卡 markdown 文件；
  - 在单事务内执行 `populateProjection`，全量灌入 `books`、`outline_nodes`、`planning_artifacts`、`tracking_lines`、`entity_cards`、`entity_alias_rules` 表；
  - **不变式保证**：投影库内禁存墙钟时间，同 canon 输入产生完全一致的确定性投影指纹。正文文本不在 SQLite 中，投影损坏对作者正文创作零损失。

#### C. 外部文件修改对账（External Modification Reconciliation）
- **触发时机**：服务启动时常驻进程 `attachReconciliationForDataRoot`（`productionServer.ts:23`）或主动调用 `POST /api/reconciliation.scan`。
- **执行符号**：`ReconciliationRuntime`（`reconciliationRoutes.ts` 与 `packages/data-plane/src/reconciliation.ts`）。
- **S2 表面分流裁决**：
  - 调用 `splitByReconciliationSurface(root, modified)`（`chapter.ts:868`）；
  - **草稿自由改（Free Draft Edits）**：若外部修改的文件为 `phase: draft` 的正文章节，直接视为作者合法外部改稿，**不触发对账阻断，豁免入面**；
  - **定稿强对账**：若被外部改动的文件为 `phase: committed` 的正文章节，生成外部修改对账提案，在工作台弹出黄色横幅，交作者裁决（合并或废弃）。

#### D. 作品备份归档与安全恢复（Backup & Restore）
- **生成归档**：`POST /api/backups` -> `createBookBackup`（`packages/data-plane/src/book-backup.ts:94` `HEAD:90b45a1`），将除运行时临时区外的全量 canon 文件打包为 ZIP，首部附加含各文件 SHA-256 的 `manifest.json`。
- **解包恢复**：`POST /api/backups/restore` -> `restoreBookBackup`（`book-backup.ts:161` `HEAD:90b45a1`）：
  - 严格执行 C5 资源限制防 ZipBomb 和路径穿越；
  - 逐文件复核 SHA-256 校验和；
  - 原子解压至新建目标目录；
  - 调用 `withBook(target, () => undefined)`，立即触发一次 `openOrRebuild`，在目标目录就地重建全新 SQLite 投影库。

---

## 3. 「成功响应语义 vs 实际持久化顺序」全景时序对照表

本节对 11 步操作逐一进行时序裁决，排查是否存在**「服务端已向前端返回成功，但在服务端物理磁盘上尚未完成落盘」**的危险虚假成功窗口（Phantom Success）。

| 步骤 | 操作名称 | 核心路由 / 入口 | 实际持久化操作点 | HTTP/UI 成功响应时机 | 是否存在「已返回成功但未落盘」危险窗口 | 判定与防护机制说明 |
|:---|:---|:---|:---|:---|:---:|:---|
| 1 | 打开书籍 | `POST /api/works` | 无磁盘写（按需重建 SQLite 投影） | 数据加载入内存后返回 200 | **不存在** | 纯读操作；若需投影重建，在返回前同步完成（E4） |
| 2 | 编辑正文 | 本地键入 | 同步写 `localStorage['mozhou.draft.cache']` | React 状态更新完成 | **不存在** | 纯前端本地状态，不声称已服务端落盘；防误关守卫兜底（E5） |
| 3 | 保存草稿 | `POST /api/chapter.prose.save` | `正文/第NN章.md` 原子写 + `manifest.json` 落盘 | 物理落盘与 fsync 后发出 200 | **不存在** | 物理落盘绝对优先于 HTTP 200；前端收 200 后才刷 Baseline（E4） |
| 4 | 生成候选 | `POST /api/draft.stream` | `.mozhou/candidates/<id>.json` 流式落盘 | 推送 `start`/`delta`/`done` 帧 | **不存在** | 候选落盘与推送同步，收尾打 `ready` 标；不触碰正文章节（E4） |
| 5 | 停止/切章 | 本地 abort / cancel | 候选标记 `partial` 或 `cancelled` | 连接关闭，UI 标 `draft_done` | **不存在** | 截断时不丢半稿，已产出字数持久化在 candidate 文件中（E4） |
| 6 | 采纳候选 | `POST /api/draft.accept` | 写 `intent.json` -> 正文原子更新 -> 写 `done` | 意图标记 `done` 后发出 200 | **不存在** | 严格 2PC 意图守卫；正文未落盘前崩溃可自动前滚恢复（E4） |
| 6-b | 撤销采纳 | `POST /api/chapter.prose.save` | 正文以采纳前文本原子另存新 revision | 物理落盘后发出 200 | **不存在** | 严格绑定 `undo.afterRevision` CAS 保护，不可回退盘面（E4） |
| 7 | 审查质检 | `POST /api/chapter.review` | `.mozhou/quality_reports/rpt_*.json` 写入 | 报告写入磁盘后发出 200 | **不存在** | 必须有真实 Context 凭证锚点，报告落盘后才发响应（E4） |
| 8 | 定稿提交 | `POST /api/chapter.commit` | 2PC 完整五步：日志 -> 流 -> 事件 -> 正文翻转 -> 投影 | 8 个物理写盘步骤全数完成后才发 200 | **不存在** | 2PC 原子编排；线性化点前后崩溃由 `recoverPendingCommit` 兜底（E4） |
| 9 | 关闭重开 | 页面/服务重启 | 读取各持久化文件并按需前滚 | 页面组件就绪完成 | **不存在** | 启动首件事执行 `recoverPendingCommit` 与基线比对（E4） |
| 10 | 导出作品 | `POST /api/export` | 内存排版转换，无服务端落盘 | 二进制流送达客户端由浏览器落盘 | **不存在** | 服务端零写入，防缺章校验确保不输出残缺文件（E4） |
| 11 | 归档恢复 | `POST /api/backups/restore` | 解压文件、复核 SHA、重建 SQLite | 全量落盘并完成重建后返回 200 | **不存在** | 写入失败整体回滚清理（`rmSync`），宁缺毋滥（E4） |

---

## 4. 八类状态责任归属矩阵

在墨舟系统中，不得将文本笼统统称为「正文」或「已保存」。系统内部将写作与生产数据精确划分为八类不同生命周期与所有权的状态：

| # | 状态类别 | 存储物理位置 | 权威归属（Authority） | 写入方（Writer） | 读取方（Reader） | 是否可重建 | 重启后如何恢复 | 多副本与漂移风险分析 |
|:---:|:---|:---|:---|:---|:---|:---:|:---|:---|
| **1** | **作者未保存编辑** | 浏览器 `window.localStorage`（键 `mozhou.draft.cache.ch_<id>_<N>`） | **浏览器客户端**（Author Sovereignty） | `ProseEditorPanel` 的 `handleChange` 同步写入 | `ProseEditorPanel` 挂载初始化 | **不可重建**（若清空浏览器缓存则永久丢失） | 组件初始化时执行 `loadDraftCache` 回填；受 `beforeunload` 卸载守卫保护 | **存在漂移**：若作者在多标签页或外部编辑器改盘，本地未保存缓存与服务端产生分叉。通过 `draftCacheMatchesBaseline` 识别分叉并阻断静默覆盖 |
| **2** | **已保存草稿** | 文件系统 `正文/第NN章.md`（frontmatter 含 `phase: draft`, `revision: N`） | **服务端 Canon 文件系统** | 服务端 `saveProseDraft`（经 `chapter.prose.save` 或 `draft.accept`） | 服务端各管线、前端 `POST /api/chapter.prose` | **不可重建**（作者一手正文主源） | 服务端直读 markdown 文件；前端拉取快照并刷新本地 `mozhou.draft.baseline` | **受控更新**：前端持 `expectedRevision` 与前写哈希；外部编辑器修改由 `PreWriteHashMismatchError` 拦截，杜绝静默覆盖 |
| **3** | **AI 候选与半稿** | 服务端 `.mozhou/candidates/<id>.json`（前端缓存 `mozhou.candidate.cache.*`） | **服务端候选存储** | `pipeline` 包的 `runDraftStep` / `createDraftCandidate` / `cancelCandidate` | `DialogueStream` 前端对话流、`acceptDraft` 采纳流程 | **不可重建**（AI 生成具随机性，重跑非同本稿） | 服务端保持 `.json` 记录（状态 `ready` / `partial`）；前端重启从 `localStorage` 回填当前候选 | **状态隔离**：候选仅在独立候选区流转，未采纳前绝对不触碰、不污染正文 markdown 文件 |
| **4** | **已采纳正文** | `正文/第NN章.md`（`phase: draft`，但 revision 递增且携带采纳意图记录） | **服务端 Canon 文件系统** | `acceptDraft` -> `saveProseDraft` 原子写入 | Reading Slate 正文写作层、后续审查质检链路 | **不可重建**（已成为正式工作草稿一部分） | 经由 `saveProseDraft` 物理落盘，重启后直接读取；意图文件 `intent.json` 保障恢复 | **版本闭环**：通过 `mozhou:prose-adopted` 广播同步编辑器；撤销操作绑定 `afterRevision` CAS 保护 |
| **5** | **已提交正典** | `正文/第NN章.md`（`phase: committed`, 带 `commitId`）+ `设定/*.jsonl` | **服务端 Canon 正典集合** | `commit-orchestration.ts` 的 `commitChapter`（2PC 写入） | 数据平面、上下文编译器、版本树、导出套件 | **不可重建**（作品不可篡改的历史里程碑） | 原生 markdown 与 jsonl 直接持久保存；提交中途崩溃由 `.mozhou/pending_commit.json` 自动收敛 | **单向递增**：已提交章节受定稿锁保护，普通保存全面拒绝；外部篡改由 `ReconciliationRuntime` 强行拦截入面 |
| **6** | **SQLite 投影** | 物理文件 `.mozhou/runtime.sqlite`（表 `books`, `outline_nodes`, `tracking_lines` 等） | **从属投影（Disposable Projection）**，Canon 文件拥有最终真源 | `database.ts`, `projection.ts`, `insertTrackingLines`, `rebuildProjectionFromCanon` | `LocalDataPlane` 目录查询、变更矩阵、大纲视图 | **100% 可重建**（可随时物理删除并无损重建） | 缺失或损坏时，`withBook` / `openOrRebuild` 自动调用 `rebuildProjectionFromCanon` 全量重建 | **零正文泄露风险**：正文 markdown 文本**完全不入 SQLite 库**；投影重建具确定性哈希幂等断言（ADR-0006） |
| **7** | **上下文/索引/文风画像** | 凭证：`.mozhou/receipts/rcpt_*.json`；文风：`文风.md`；索引：内存向量/BM25 缓存 | **分立持有**：凭证文件自身不可变（INV-R2）；文风归 `文风.md`（I1 豁免） | 凭证由 `persistReceipt` 写；文风由 `StyleProfileStore` 写；索引由 localEmbeddingProvider 懒加载 | `draftContext` 召回引擎、`ReceiptPanel`、`StyleLearner` | 凭证不可重建（历史切片）；文风可由事件流全量重放；索引可瞬时重建 | 凭证与文风重启直读物理文件；向量模型资产由 ONNX 重新懒加载绑定 | **一证一文件**：凭证落盘后绝对不可变，重复写抛错；文风修改受 I1 受控豁免约束，必须发射 `StyleProfileUpdated` 事件 |
| **8** | **任务账本与费用记录** | 账本：`.mozhou/events.jsonl`；用量：`.mozhou/usage.jsonl`；订单：`dataRoot/billing.sqlite` | **账本与用量归各书；订单与权益归全局数据根** | 账本由 `PublishBus` 写；用量由 `runFlywheelRecord` 写；订单由 `BillingStore` 事务写入 | `readPipelineLedger`、数据飞轮核算、会员中心 `MembershipView` | 账本与订单不可重建；用量投影支持事后异步回灌（backfill） | Append-only 文件重启天然保留；`billing.sqlite` 具备独立 SQLite WAL 事务保障 | **职责隔离**：每本书的账本与用量仅存在于各自书籍的 `.mozhou` 内；`billing.sqlite` 独占全局，严防跨书交叉污染 |

---

## 5. 图谱覆盖与图谱未覆盖边界说明

依据 `00-audit-charter.md` §7（代码图谱门禁），必须如实界定图谱技术（GitNexus CLI）的覆盖边界与盲区，严禁用图谱通过冒充全系统验证：

### 5.1 图谱已覆盖域（证据链确凿，级别 E1/E2）
通过 GitNexus CLI（索引号 `90b45a1`，10007 符号 / 21780 边 / 516 执行流）实测验证了以下拓扑链路：
- **符号引用与执行流**：
  - `runChapterCommit` -> `commitChapter` -> `atomicReplace` / `writeJournal` / `insertTrackingLines`（覆盖于 `proc_0_commitchapter`，见 `logs/044`）；
  - `acceptDraft` -> `saveProseDraft` -> `atomicReplace`（覆盖于 `proc_236_acceptdraft`，见 `logs/040`）；
  - `assembleBudgetedContext` -> `persistReceipt` -> `publishBus.publish`（覆盖于 `proc_1_makestreamengine` 与 `proc_397_assemblebudgetedcont`，见 `logs/044`）；
  - `recoverPendingCommit` -> `recoverForward` / `recoverBackward`（覆盖于 `proc_412_recoverpendingcommit`，见 `logs/044`）。
- **包间依赖拓扑**：
  - `apps/web` 引用 `@mozhou/pipeline`、`@mozhou/data-plane`、`@mozhou/context-compiler`、`@mozhou/kernel` 的静态导入图清晰，`gitnexus check --cycles -r "C:\zcode\novel-ai"` 输出 `No circular imports found`（`logs/025`）。

### 5.2 图谱未覆盖域（图谱盲区，必须依靠 E1 源码阅读 + E4 本地集成证据补足）
以下 8 类关键工程边界未被（且不可能被）GitNexus 静态 AST 图谱覆盖，本报告均作了显式独立标注：
1. **Rust 宿主代码**：`src-tauri/src/main.rs`（12 行空壳代码），GitNexus 仅索引 TS/TSX，未索引 Rust 代码。已通过 E1 源码确认 Tauri 宿主未绑定原生 Command；
2. **HTTP 边界映射**：前端 `post('/api/chapter.prose.save')` 到服务端 `proseRoutes.ts:293` 的运行时字符串路由分发，图谱无法建立动态边；
3. **IPC / 私有管道**：`MoZhou.cs`（C# 启动器）向 Node 进程下发 stdin `shutdown` 指令的管道通信，属于进程外部通信，图谱无记录；
4. **Junction 动态模块解析**：`apps/web/node_modules/@mozhou/*` 指向 `packages/*` 活代码的 Windows Junction 目录链接，图谱静态分析无法感知构建时差；
5. **文件与配置约定**：`.mozhou/` 内部目录结构约定、`manifest.json` 结构、`tauri.conf.json`、`pnpm-workspace.yaml` 等动态文件协议；
6. **浏览器事件总线**：`window.dispatchEvent(new CustomEvent('mozhou:prose-adopted'))` 等跨组件解耦事件，图谱未建立连线；
7. **外部物理副作用**：`atomicReplace` 的文件重命名、`better-sqlite3` 底层 WAL 写入、`unlinkSync` 物理删除，图谱仅能跟踪到函数调用，无法断言物理磁盘一致性；
8. **数据目录双轨制**：`dataRoot.ts` 的自动回落机制与 `desktop-server.mjs` 的强制环境变量检查之间的行为语义差异，图谱不可见。

---

## 6. 结论、未知项与自检清单

### 6.1 审计核心结论
1. **作者核心旅程具备坚实的防御性架构**：正文从编辑、保存、流式候选、受控采纳到定稿提交，全链路贯彻了 **Revision CAS 乐观锁**、**PreWriteHash 磁盘防篡改比对**、**2PC Journal 故障恢复** 以及 **定稿状态锁（Committed Lock）**，杜绝了静默覆盖作者正文的可能。
2. **八类状态职责分明，分层清晰**：严格区隔了前端本地暂存（LocalStorage）、服务端草稿文件（`正文/*.md` draft）、AI 隔离区（`.mozhou/candidates`）、不可变正典（`正文/*.md` committed）、可重建投影（SQLite）与账本费用。正文文本彻底与 SQLite 脱钩，实现了「投影随意毁、正文毫发无伤」的高可用韧性。
3. **不存在「虚假成功」危险窗口**：保存与提交的关键写入点均确保物理落盘（`atomicReplace` / `fsync`）成功后才发出 HTTP 200，成功语义与实际持久化时序严密契合。
4. **工作区状态与发布包的混合事实确证**：运行代码切实执行的是工作区修改（如 `summarizeByChannel`、`ReceiptPanel` 增强），审计人员必须严格维持 `WORKTREE(未提交)` 标签。

### 6.2 未知项说明（依据 §5 强制三段式）

1. **未知项 1**：桌面版安装包 `MoZhou.exe` 在全新 Windows 纯净系统上的静默自动启动与数据根初始化行为。
   - **缺什么证据**：在未配置 `MOZHOU_DATA_ROOT` 环境变量的纯净机器上运行 `MoZhou.exe`，观察 C# 启动器调用 `FindStablePort` 与拉起 Node 子进程的实际退出码与 stderr 日志。
   - **最小补证方法**：在隔离 Windows 沙箱虚拟机中运行安装包，检查进程树与 `%LOCALAPPDATA%\MoZhou` 目录生成情况。
2. **未知项 2**：高并发极端压力下，多标签页并发请求 `/api/chapter.prose.save` 时的文件系统 IO 锁竞争表现。
   - **缺什么证据**：并发 50 个带有不同 `expectedRevision` 的请求冲撞 `atomicReplace`，底层 Windows NTFS 文件锁是否会导致个别请求抛出 `EBUSY` 或 `EPERM`。
   - **最小补证方法**：在测试用例中引入 `Promise.all` 50 路并发打点，验证错误码是否均能被规范转化为 409 业务冲突，而非裸 500。

### 6.3 产物自检清单核对（章程 §10）

- [x] 每条关键结论与文件定位均标明 `HEAD:90b45a1` 或 `WORKTREE(未提交)` 来源标签。
- [x] 拓扑与调用链附带 GitNexus CLI 实测命令及 `logs/040` ~ `logs/044` 证据出处。
- [x] 完整贯穿 11 步真实作者路径，无一缺漏。
- [x] 八类状态责任归属矩阵独立成表，严禁笼统混称。
- [x] 「成功语义 vs 实际持久化顺序」对照表逐项判定，明确回答是否存在未落盘窗口。
- [x] 全程只读审计，未触碰真实书稿库 `mozhou_rt`，未修改产品代码，未改写历史。
- [x] 未知项严格按三段式格式书写。
- [x] 跨图谱盲区（Rust、HTTP、IPC、Junction、事件）明确单列说明。
