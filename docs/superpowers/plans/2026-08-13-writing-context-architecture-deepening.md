# Writing Context Architecture Deepening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不涉及支付、不重做现有 UI 和不扩张数据库 schema 的前提下，让墨舟的独立对话、章节对话、压缩、候选应用、payload observation 和 SSE 链路达到可验证的功能生产级。

**Architecture:** 两条对话 consumer 统一进入 `writing-context` module，由它生成现有 `PreparedChatRequest`；streaming 与 compression 共用一个模型 transport adapter。章节 replay/candidate/ownership 由领域 module 负责，payload observation 从最终请求派生，SSE 只共享 framing/lifecycle 而保留领域事件。

**Tech Stack:** Next.js 16、TypeScript、React、Drizzle、PostgreSQL、one-api、SSE、现有 Vitest/HTTP 测试与生产构建链。

## Global Constraints

- 不新增数据库表、字段、embedding、Canon 系统或会员/支付功能。
- 不重做现有聊天 UI；模型行为与最终 payload 是本轮验收终点。
- 不保留旧的重复上下文组装路径、旧的直接 one-api fallback 或重复 SSE lifecycle；删除旧路径而不是增加兼容层。
- 每个切片必须先写失败测试，再实现最小代码，再跑 TypeScript、production build、真实模型 smoke、数据库验证和网页端审阅。
- observer/log 只记录 route、mode、section kinds、roles、counts、scope presence、compression flags；不得记录小说正文、完整 prompt、token 或 secret。
- `system` 表达模型应知道的上下文；`messages` 只表达可重放历史事实与本轮用户消息，current user 必须最后且只出现一次。
- 章节 replay 只纳入 `user + done`、`assistant + completed_candidate`、`assistant + applied`；排除 generating/stopped/error、当前 user 和当前 assistant candidate。
- route 保留同步 ownership precheck；domain transaction 继续做最终 ownership 裁决。

---

> 执行约束：本计划基于 `docs/adr/0001-writing-context-boundaries.md` 与 `docs/adr/0002-writing-context-architecture-deepening.md`。目标是让已上线的墨舟达到“不含支付”的功能生产级，而不是重新设计页面或重写系统。

## 总体执行规则

- 工作目录：`C:\\zcode\\novel-ai\\app`。
- 代码、测试、路由和 provider 的每个改动都必须先写失败测试，再实现最小代码，再扩大到真实 consumer。
- 保留现有外部 API 事件语义、数据库 schema 和生产 URL；删除重复旧路径，不新增兼容层。
- 每个切片单独完成：单测 → HTTP/consumer 测试 → TypeScript → production build → 真实模型 smoke → DB 验证 → 网页端审阅。
- 任何切片失败时，停止进入下一切片，记录具体失败的 module、interface、seam、depth、locality 或 leverage 问题。
- 不在测试 mock 中宣称真实 payload 正确；测试必须读取 provider seam 的最终 request。
- observation 只输出结构化脱敏事实：route、mode、section kinds、roles、counts、scope presence、compression flags；不得输出小说正文、完整 prompt、API token。

## 目标结构

```text
Independent Chat Consumer ─┐
                           ├─> writing-context module ─> PreparedChatRequest
Chapter Chat Consumer ─────┘             │
                                         ├─> payload observation
                                         └─> model transport
                                              ├─> streaming adapter
                                              └─> completion adapter (compression)

Chapter candidate lifecycle ─> chapter domain module ─> DB transaction
SSE routes ─> shared framing/lifecycle module + route-owned domain events
```

## Slice 1：统一写作上下文 module

### Task 1: Slice 1 — 统一写作上下文 module

消除 `service.ts` 与 `chapter-chat.ts` 中重复的 history/compression/RAG/style/skill/system/messages 组装，建立唯一的 `writing-context` module。第一切片不改变用户可见行为，只让两个 consumer 产生同一套可验证结构。

### 1.1 先写失败测试

- [ ] **Step 1: 新增写作上下文契约测试**

新增 `C:\\zcode\\novel-ai\\app\\tests\\unit\\writing-context.test.ts`，覆盖：

1. section 顺序严格为 `base_identity`、`mode_contract`、owner/context、chapter reference、selection、style、skill、compression summary。
2. 缺少可选 section 时不生成空标签，不改变必需 section 顺序。
3. system 由 section 内容一次渲染；messages 只包含 replayable history，并把当前 user 放在最后且只出现一次。
4. independent mode 与 chapter mode 使用各自 mode contract，但共享 section renderer 和 message builder。
5. 当前 user 为空、重复、或不在最后时测试失败；实现后必须归一化为最后一条唯一 current user。
6. 当前 novel/chapter owner facts 在 context 中明确标记；无 owner 时不偷偷检索其他作品内容。
7. 返回值是现有 `PreparedChatRequest`，而不是绕开 provider seam 的另一种请求对象。

### 1.2 实现 module

- [ ] **Step 2: 实现最小 context builder**

新增 `C:\\zcode\\novel-ai\\app\\lib\\chat\\writing-context.ts`，集中以下职责：

```ts
type WritingContextMode = "independent" | "chapter";

type WritingContextSection = {
  kind:
    | "base_identity"
    | "mode_contract"
    | "owner_context"
    | "chapter_reference"
    | "selection"
    | "style"
    | "skill"
    | "compression_summary";
  content: string;
};

type WritingContextInput = {
  mode: WritingContextMode;
  model: string;
  sections: WritingContextSection[];
  history: ChatMessage[];
  currentUser: ChatMessage;
  observation: Omit<ChatObservationScope, "systemSections" | "currentUserIndices" | "historyCountAfter">;
};

function buildWritingContext(input: WritingContextInput): PreparedChatRequest;
```

具体实现要求：

- 把 `BASE_IDENTITY`、两个 mode contract 和 section label mapping 从 `stream-provider.ts` 移到 context module；`stream-provider.ts` 只保留 provider transport/adapters。
- 复用现有 `ChatMessage` 和 `PreparedChatRequest`，不新增第二套 message 类型。
- 统一做 `history + currentUser` 归一化；不把 current user 拼入 system。
- section 数组是 context module 的内部事实；外部仍得到现有 `system: string`，并把 section kinds 放入 observation。
- 当前 selection、style、skill、RAG、chapter reference 由 consumer 查询/验证，context module 只负责排序、渲染和请求构造，不越权访问数据库。

### 1.3 接入两个 consumer

- [ ] **Step 3: 接入 independent 与 chapter consumer**

修改：

- `C:\\zcode\\novel-ai\\app\\lib\\chat\\service.ts`
- `C:\\zcode\\novel-ai\\app\\lib\\novels\\chapter-chat.ts`

要求：

- consumer 保留各自的 owner check、DB 写入和领域事实收集。
- consumer 不再手工创建 `providerMessages`、`system` 或 `currentUserIndices`。
- 两个 consumer 都调用 `buildWritingContext`，然后把返回值交给 `makeChatProvider`。
- 先保留 compression 的调用位置，Slice 2 再替换其 transport；本切片只改变组装 locality。

### 1.4 Slice 1 验证

- [ ] **Step 4: 执行 Slice 1 本地门禁、真实 payload 验证和网页端审阅**

运行：

```powershell
cd C:\\zcode\\novel-ai\\app
npm test -- --runInBand tests/unit/writing-context.test.ts tests/unit/payload-consumer.test.ts
npm run typecheck
npm run build
```

然后用独立对话和章节对话各发送一条短消息，确认 provider capture 中 `messages` 最后一条是当前 user，system section 顺序一致；确认数据库中 user/assistant 记录仍只写入一次。完成后提交给网页端审阅，审阅通过才进入 Slice 2。

## Slice 2：把压缩收拢到统一模型传输 adapter

### Task 2: Slice 2 — 统一模型 transport 与 compression adapter

让流式生成和压缩摘要共享 one-api URL、认证、model、请求构造、响应解析和错误归一化；压缩 domain module 不再直接 fetch 或读取环境变量。

### 2.1 先写失败测试

- [ ] **Step 1: 新增 transport 与 compression adapter 失败测试**

新增 `C:\\zcode\\novel-ai\\app\\tests\\unit\\llm-transport.test.ts` 与 `C:\\zcode\\novel-ai\\app\\tests\\unit\\compress-adapter.test.ts`，覆盖：

1. completion adapter 发出 non-stream request，stream adapter 发出 stream request；两者共享同一配置解析和认证 header。
2. completion adapter 正确解析正常 JSON、空 choices、错误 JSON、非 2xx；错误类型/消息归一化且不泄露 token。
3. compression 只接收注入的 completion adapter；测试中替换 adapter 后不会触网。
4. adapter 失败时 compression 返回 ADR-0001 要求的 fail-open 结果：原始有效 history + current user 仍可发送。
5. mock provider 与真实 provider 都经过同一请求契约；不能因为 mock 而跳过最终 messages 断言。

### 2.2 实现 transport module

- [ ] **Step 2: 实现共享 completion/stream transport**

新增 `C:\\zcode\\novel-ai\\app\\lib\\chat\\llm-transport.ts`，定义内部 transport interface：

```ts
type CompletionRequest = {
  model: string;
  system?: string;
  messages: ChatMessage[];
  temperature?: number;
};

type CompletionResult = {
  text: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
};

type LlmTransport = {
  complete(request: CompletionRequest): Promise<CompletionResult>;
  stream(request: PreparedChatRequest): StreamProvider;
};
```

实现要求：

- one-api URL、token、fetch、SSE parsing、JSON parsing 只出现在 transport/adapter module。
- `OneApiStreamProvider` 改为 transport 的 stream adapter；对外保留现有 `StreamProvider`，避免 pipeline 重新定义接口。
- completion adapter 复用相同的配置和错误归一化。
- transport 默认 factory 只在 composition root/consumer 入口创建；domain compression 接收 adapter 参数。

### 2.3 改造 compression

- [ ] **Step 3: 删除 compression direct fetch 并接入注入 adapter**

修改 `C:\\zcode\\novel-ai\\app\\lib\\chat\\compress.ts`：

- 删除其中的 `fetch`、环境变量读取和 provider 分支。
- `compressHistory(messages, completionAdapter)` 只处理 token window、summary prompt、kept history 校验和 fail-open。
- `CHAT_PROVIDER=mock` 的测试行为移到可注入 fake completion adapter，避免 domain module 感知部署环境。
- 保留 `KEEP_RECENT`、summary 上限、压缩触发阈值和 fail-open 语义，除非测试证明现有值错误。

修改两个 consumer：每次请求创建一次 transport，把同一个 transport 的 completion adapter 传给 compression，把 stream adapter 传给 `makeChatProvider`。不得生成第二个配置路径。

### 2.4 Slice 2 验证

- [ ] **Step 4: 执行 Slice 2 本地门禁、真实压缩 smoke 和网页端审阅**

```powershell
cd C:\\zcode\\novel-ai\\app
npm test -- --runInBand tests/unit/llm-transport.test.ts tests/unit/compress-adapter.test.ts tests/unit/compress.test.ts tests/unit/payload-consumer.test.ts
npm run typecheck
npm run build
```

使用真实 one-api 配置做一次独立对话压缩 smoke；只验证请求成功、summary/kept 结构和 provider payload，不把正文写入日志。验证压缩失败时仍能生成当前消息。网页端审阅通过后进入 Slice 3。

## Slice 3：章节 replay policy 与候选 lifecycle module

### Task 3: Slice 3 — 章节 replay policy、candidate lifecycle 与 ownership

让章节上下文只重放确定的持久化事实，让生成、停止、错误、应用和并发 revision 由一个候选 lifecycle module 负责；避免 `chapter-chat.ts` 同时承担上下文、provider、candidate state 和 mutation。

### 3.1 先写失败测试

- [ ] **Step 1: 新增 replay、candidate lifecycle 与 ownership 失败测试**

新增：

- `C:\\zcode\\novel-ai\\app\\tests\\unit\\chapter-replay.test.ts`
- `C:\\zcode\\novel-ai\\app\\tests\\unit\\chapter-candidate-lifecycle.test.ts`

覆盖：

1. replay 只纳入 `user/done`、`assistant/completed_candidate`、`assistant/applied`。
2. `generating`、`stopped`、`error`、当前 user 和当前 assistant candidate 不进入 provider history。
3. 同一 requestHash/generationKey 重试复用未过期 candidate；过期 generating candidate 进入 error 后才能新建。
4. provider 完成、用户停止、provider 错误分别产生明确 candidate status 和可重放结果。
5. apply 必须同时验证 owner、candidate status、baseRevision、expectedContent；revision 变化或内容变化时拒绝 mutation。
6. 两个并发 apply 中只有一个成功；失败方不能覆盖正文，也不能把另一方 candidate 标记为 applied。
7. user message 和 assistant candidate 的 DB 持久化仍然 exactly-once，失败重试不重复插入。

### 3.2 抽出 replay module

- [ ] **Step 2: 实现可重放历史 module**

新增 `C:\\zcode\\novel-ai\\app\\lib\\novels\\chapter-replay.ts`：

```ts
function isReplayableChapterMessage(row: ChapterMessageRow): boolean;
function buildChapterReplayHistory(rows: ChapterMessageRow[], currentUserId: string, candidateId?: string): ChatMessage[];
```

实现必须以 DB status 为准，不根据 content 是否为空猜测状态；最后一条 current user 由统一 writing-context module 添加。

### 3.3 抽出 candidate lifecycle module

- [ ] **Step 3: 实现 candidate lifecycle module 并替换 chapter orchestration 中的状态 SQL**

新增 `C:\\zcode\\novel-ai\\app\\lib\\novels\\chapter-candidate.ts`，集中：

- prepare/reuse candidate；
- stale generating recovery；
- complete/stopped/error settle；
- apply with owner/status/revision/expectedContent/race guards。

`chapter-chat.ts` 保留 orchestration：收集 owner/context facts、调用 replay/context、调用 transport、发出领域结果；不再手写 status transition SQL。

不改变 `chapter_messages` schema，不删除已有 `generationKey`、`requestHash`、`baseRevision`、`status` 事实。

### 3.4 ownership seam

- [ ] **Step 4: 收拢 route/domain ownership resolver**

新增 `C:\\zcode\\novel-ai\\app\\lib\\novels\\ownership.ts` 或在 candidate domain module 中提供单一 owner resolver，统一：

- route precheck 用于同步 404；
- domain transaction 用于最终裁决；
- novel/session/chapter/candidate 必须属于同一 user/novel scope。

route 不直接复制复杂 ownership join；domain transaction 不依赖 route 已经通过 precheck 这一事实。

### 3.5 Slice 3 验证

- [ ] **Step 5: 执行 Slice 3 本地门禁、真实候选 smoke、DB 验证和网页端审阅**

```powershell
cd C:\\zcode\\novel-ai\\app
npm test -- --runInBand tests/unit/chapter-replay.test.ts tests/unit/chapter-candidate-lifecycle.test.ts tests/http/chapter-continuation.test.ts
npm run typecheck
npm run build
```

真实模型 smoke：发送章节续写、停止、重试、应用、重复应用、revision 冲突各一次；数据库验证每个状态变化、正文 revision 和 candidate 内容。网页端审阅通过后进入 Slice 4。

## Slice 4：payload observation 成为真实 seam，以及统一 SSE framing

### Task 4: Slice 4 — payload observation seam 与共享 SSE framing

让 observation 从最终 request 派生，并消除两个 route 重复的 SSE stream framing/lifecycle 代码，同时保留独立对话与章节对话领域事件差异。

### 4.1 先写失败测试

- [ ] **Step 1: 新增 payload observer 与 SSE framing 失败测试**

扩展 `C:\\zcode\\novel-ai\\app\\tests\\unit\\payload-consumer.test.ts`：

1. observer 从最终 `PreparedChatRequest.system` 和 `messages` 派生 section kinds、roles、current user index、history count；caller 传入的旧计数不能覆盖事实。
2. OneApi adapter、Mock adapter、Capturing adapter 三者看到同一个最终 request；system 的 provider prepend 不能让 observer 看到另一份事实。
3. chapter request 不能出现 `messages=[]` 或缺少最后 current user。
4. observer 结构不包含正文、完整 system、token、secret。

新增 `C:\\zcode\\novel-ai\\app\\tests\\unit\\sse.test.ts`：

1. `start`、`delta`、`done`、`error` 能被编码为合法 SSE frame。
2. close/cancel/error 只执行一次，stream 不重复发送 done/error。
3. safe error 映射不泄露 provider 原始响应、token 或内部 stack。
4. domain event payload 可以透传，不被 shared module 改名或合并。

### 4.2 修正 payload seam

- [ ] **Step 2: 让 observation 从最终 PreparedChatRequest 派生**

修改 `C:\\zcode\\novel-ai\\app\\lib\\chat\\payload.ts` 与 `C:\\zcode\\novel-ai\\app\\lib\\chat\\stream-provider.ts`：

- `buildPayloadObservation` 成为唯一 observation 构造入口。
- `systemSections` 从 context module 的 sections 或可验证 section markers 派生。
- `currentUserIndices`、`historyCountAfter` 从最终 messages 派生。
- provider adapter 不得二次拼出一份未被 capture 的 system；如果外部 API 需要 system message，则在共享 transport 的可观察 seam 之前完成规范化。
- 保持 `CHAT_CAPTURE=1` 只在测试/显式诊断条件下工作。

### 4.3 抽出 SSE module

- [ ] **Step 3: 抽出 shared SSE framing/lifecycle 并保持领域事件不变**

新增 `C:\\zcode\\novel-ai\\app\\lib\\http\\sse.ts`：

```ts
type SseWriter = {
  start(data: unknown): void;
  delta(data: unknown): void;
  done(data: unknown): void;
  error(data: unknown): void;
  close(): void;
};

function createSseStream(run: (writer: SseWriter, signal: AbortSignal) => Promise<void>): ReadableStream<Uint8Array>;
```

只抽 framing、encoder、lifecycle、safe error、close-once；不抽 `done` 的业务字段，不抽 chapter candidate status，不抽 session/novel ownership。

修改：

- `C:\\zcode\\novel-ai\\app\\app\\api\\v1\\chat\\route.ts`
- `C:\\zcode\\novel-ai\\app\\app\\api\\v1\\novels\\[id]\\chapters\\chat\\route.ts`

保留现有 HTTP 404 precheck、事件名、事件字段和领域错误码，仅把重复 stream boilerplate 替换为 shared module。

### 4.4 Slice 4 验证

- [ ] **Step 4: 执行 Slice 4 本地门禁、浏览器验证和网页端审阅**

```powershell
cd C:\\zcode\\novel-ai\\app
npm test -- --runInBand tests/unit/payload-consumer.test.ts tests/unit/sse.test.ts tests/http/chat.test.ts tests/http/chapter-continuation.test.ts
npm run typecheck
npm run build
```

用浏览器分别打开独立对话和章节对话，检查 start/delta/done/error、取消和刷新；检查 observer/日志无正文泄露。网页端审阅通过后进入 Slice 5。

## Slice 5：全链路生产门禁与部署

### Task 5: Slice 5 — 全链路生产门禁与部署

把前四个 module 的局部正确性收敛为可部署的功能生产级证据，覆盖非支付范围内的核心写作流程。

### 5.1 回归与删除测试

- [ ] **Step 1: 补齐全链路回归与 deletion tests**

新增/补齐：

- independent chat：无 RAG/无技能仍有 BaseIdentity；有 novel/style/skill 时 section 顺序和 owner scope 正确。
- chapter chat：current user、replay history、chapter reference、selection、candidate apply 全部进入真实 payload/DB 链路。
- compression：触发、kept history、summary、fail-open、transport error。
- ownership：跨 user、跨 novel、跨 chapter、跨 session 均在 route/domain 两层拒绝。
- payload observer：真实 final payload 与 observation 一致。
- SSE：正常完成、provider error、用户取消、客户端断开。
- deletion test：删除旧的独立组装逻辑、压缩 direct fetch、重复 SSE boilerplate 后，搜索仓库不得出现第二条生产路径。

### 5.2 本地门禁

- [ ] **Step 2: 执行完整本地测试、TypeScript 与生产构建**

```powershell
cd C:\\zcode\\novel-ai\\app
npm test -- --runInBand
npm run typecheck
npm run build
```

记录：测试文件/测试数、构建版本、Next route 清单、数据库迁移状态、环境变量名（不记录 secret 值）。

### 5.3 真实环境验证

- [ ] **Step 3: 执行真实 provider、数据库和作品隔离 smoke**

在生产配置下只使用测试账号和短文本：

1. 创建新作品，不配置人物、世界观、章节时，仍可从独立写作对话开始；RAG 区域为空不是阻塞条件。
2. 创建章节并发送续写请求；模型收到当前 user 和章节参考。
3. 让同一对话达到压缩阈值，验证 kept history 仍进入 provider。
4. 生成候选、停止、重试、应用和 revision 冲突。
5. 刷新、重新进入页面、切换作品，验证 session/chapter/novel scope 不串线。
6. 模拟 provider 4xx/5xx、空响应、SSE 中断，验证用户可见错误和 DB 状态可恢复。

### 5.4 部署与网页端审阅

- [ ] **Step 4: 部署 canary/revision，完成网页端审阅并记录 production-ready 证据**

- 先部署到现有生产平台的 canary/revision；确认 health、静态资源、API route 和数据库连接。
- 执行上述 smoke；失败立即回滚当前 revision，不修改数据库 schema。
- 网页端审阅内容必须包含：URL/revision、独立对话、章节对话、压缩、候选应用、错误恢复、作品隔离、观测脱敏结果。
- 网页端明确通过后，才把最终 revision 标记为 production-ready。

## 完成定义

只有以下全部满足，才可报告“非支付功能达到生产级”：

1. 五个切片的测试与构建门禁通过。
2. 删除测试确认没有重复上下文、重复压缩 transport、重复 SSE lifecycle。
3. 两条对话链的真实 provider payload 可被 capture/observer 证明。
4. 章节 candidate lifecycle 和 revision/race 保护经过真实 DB 验证。
5. 独立写作新作品在空 RAG 状态下可直接开始，不被空资料区阻塞。
6. 部署 revision 通过网页端全流程审阅。
7. 文档、ADR、CONTEXT 和任务日志记录最终架构与剩余已知限制。
