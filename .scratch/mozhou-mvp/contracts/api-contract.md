# 墨舟 API 数据契约（全站，未来演进参考文档）

> 状态：**未来演进参考文档**（MVP 1.0 锁定中）| 日期：2026-08-09
> 来源：全站 13 界面源码分析提炼（全局开发规范 v1.0.0 第三节矩阵的完整版）
> MVP 1.0 范围：仅【1. 认证】【2. 写作对话】为当前主线；其余 11 界面 UI 先行（冷冻），本契约供后续工单实现时对照，**禁止提前编写后端占位逻辑**。

**通用约定**
- Base path：`/api/v1`；所有业务接口需登录，未登录统一返回 `401 { "error": "未登录" }`
- 错误响应统一为 `{ "error": string }`，UI 直接渲染到页面错误区
- 状态标注：✅ 已实现 · 🎯 MVP 1.0 主线 · 🧊 UI 先行（冷冻）

---

## 1. 认证 (Auth) — ✅ 已实现

```typescript
// POST /api/v1/auth/register | /api/v1/auth/login
interface AuthRequest {
  email: string;    // 邮箱（input type=email）
  password: string; // 密码（minLength 8；登录时 current-password）
}
// 成功：200/201，客户端跳转 /workspace（登录支持 ?next= 站内回跳）
// 失败：400/401/409 → { error: string }
```

## 2. 写作对话 (Chat) — 🎯 MVP 1.0 主线

```typescript
// GET  /api/v1/sessions          → 会话列表（左侧栏）
interface SessionListResponse { sessions: SessionItem[] }
interface SessionItem { id: number; title: string }

// POST /api/v1/sessions          → 新建会话
// 201 → { session: SessionItem }

// GET  /api/v1/sessions/[id]/messages → 历史消息
interface MessageListResponse { messages: ChatMessage[] }
interface ChatMessage { role: "user" | "assistant"; content: string }

// POST /api/v1/chat              → 流式续写（SSE，text/event-stream）
// 注：已实现端点的协议以【后端发射端 + 契约测试断言】为准（2026-08-10 核对修正）；
//     UI 消费是协议子集（前端静默忽略未知事件类型），不能作为事件全集来源。
interface ChatRequest {
  sessionId: number | null; // null = 新会话（首个 delta 会带回 sessionId）
  model: "deepseek-v4-flash" | "glm-4.5-flash";
  content: string;          // 用户输入（Enter 发送；上限 4000 字）
  novelId?: number | null;  // 当前作品绑定（R3：RAG 只检索该作品设定）
  styleId?: number | null;  // 风格引用（工单 15）：风格库 id，服务端查表注入完整四维指南；可空
  skills?: string[];        // 技能名列表（任务二-A：按名查 skills 表注入 systemPrompt）
}
// SSE 事件流（每行 data: {...}，\n\n 分隔；事件顺序：start → phase* / delta* → done，出错时 error 替代后续流）：
interface ChatStreamEvent =
  | { type: "start";  sessionId: number; phase: "preparing" } // 会话已建立，准备上下文
  | { type: "phase";  phase: "preparing" | "streaming" | "finishing" } // 阶段变化
  | { type: "delta";  text: string }             // 增量文本，前端累积渲染
  | { type: "done" }                             // 流结束（前端静默跳过，无需渲染）
  | { type: "error";  message: string };         // 生成失败
```

## 3. 写作工具面板（合同/任务书/机检/上下文）— 🧊 冷冻

```typescript
// GET /tools/contract?chapter=ch004 → 本章写作合同
interface ContractResponse {
  mustCover: string[];  // 必含词：["开田","肃界卫","守塔"]
  forbidden: string[];  // 禁区词：["S-001","S-003","S-005","S-006"]
}

// GET /tools/brief?chapter=ch004 → 任务书（四段）
interface BriefResponse {
  sections: { title: string; body: string }[]; // 背景/本章目标/必须推进/红线
}

// POST /tools/checks              → 机器检查
interface ChecksRequest { chapterId: string; text: string }
interface ChecksResponse {
  checks: { name: string; ok: boolean; detail: string }[];
  // name 示例：字数窗口/占位符/泄密扫描/实体登记/复读检测/合同断言
}

// GET /tools/context?sessionId=   → 上下文用量与记忆注入
interface ContextResponse {
  usedTokens: number;      // 4.2K
  maxTokens: number;       // 8K
  autoCompress: boolean;   // 超出 70% 自动压缩
  memories: { name: string; injected: boolean }[];
}
```

## 4. 我的作品 — 🧊 冷冻

```typescript
// POST /novels                → 创建作品（左侧「书名 + 创建」）
interface CreateNovelRequest { name: string }
// 201 → { novel: NovelSummary }

// GET /novels                 → 作品列表
interface NovelListResponse { novels: NovelSummary[] }
interface NovelSummary { id: number; name: string; meta: string; /* "卷一 · 连载中 · 4 章" */ }

// GET /novels/[id]            → 详情三栏
interface NovelDetailResponse {
  novel: NovelSummary;
  characters: { name: string; note: string }[]; // 人物库
  worldviews: { name: string; note: string }[]; // 世界观
  chapters: { ch: string; title: string; status: "定稿" | "草稿" }[];
}
```

## 5. 风格蒸馏 — 🧊 冷冻

```typescript
// POST /distill
interface DistillRequest {
  text: string;      // 文件正文（≥200 字，建议 ≥1 万字，服务端上限 20000）
  source?: string;   // 文件名（展示用）
  dimensions?: ("narrative"|"sentence"|"imagery"|"rhythm")[];
}
interface DistillResponse {
  guide: {
    narrative: string; // 叙事视角
    sentence:  string; // 句式节奏
    imagery:   string; // 意象偏好
    rhythm:    string; // 情绪节奏
  };
  meta?: { input_chars: number; model: string; duration_ms: number; truncated: boolean };
}
```

## 6. 小说拆解 — 🧊 冷冻

```typescript
// POST /deconstruct/analyze
interface DeconstructRequest {
  mode: "search" | "upload";
  query?: string;  // mode=search：书名
  text?: string;   // mode=upload：全文
}
// 第一步响应：章节选择列表
interface ChapterPickResponse { chapters: { ch: string; title: string; words: string }[] }
// 选定后（chapterId）第二步：拆解结果
interface DeconstructResponse {
  structure: string[]; // 结构（开场/中段/收束）
  plot:      string[]; // 剧情（伏笔/人物/推进）
  rhythm:    string[]; // 节奏（句段/缓急/悬念）
}
```

## 7. 抽卡模式 — 🧊 冷冻（已并入写作对话，2026-08-10 结构调整）

> 独立 /draw 页面已删除（用户定案：抽卡是写作流程内联操作，避免复制粘贴）。
> 现形态：写作对话输入区「抽卡」按钮 → 多模型并行生成候选（当前 mock）→ 点选插入对话流。
> 真实双模型不落库抽卡（dryRun）归工单 10，届时契约如下：

```typescript
// POST /chat（dryRun=true，工单 10 实现）— 每个模型各发一次，Promise.all 并行
interface DrawRequest {
  model: "deepseek-v4-flash" | "glm-4.5-flash";
  content: string; // 写作指令（输入区内容）
  dryRun: true;    // 不落库：候选仅供选用
}
interface DrawResponse { text: string } // 该模型生成文字（不写入 messages 表）
```

## 8. 书源搜索 — 🧊 冷冻

```typescript
// POST /search
interface SearchRequest { query: string }
interface SearchResponse {
  results: { source: string; name: string; author: string; site: string; status: string }[];
  // source ∈ shukuge | 22biqu | zxtyz
}
// POST /search/import → 导入到书架
interface ImportRequest { source: string; name: string }
```

## 9. 书源书架 — 🧊 冷冻

```typescript
// GET /shelf
interface ShelfResponse {
  books: { id: number; name: string; source: string;
           progress: string; updated: string }[];
}
// GET /shelf/[id]/chapters → 章节列表
interface ShelfChaptersResponse { chapters: { title: string; isLastRead: boolean }[] }
// GET /shelf/[id]/chapters/[ch] → 正文
interface ChapterTextResponse { text: string }
```

## 10. 技能广场 — 🧊 冷冻

```typescript
// GET /skills/mine → 我的技能；GET /skills/plaza → 广场
interface Skill { id: number; name: string; desc: string; tag: string; author?: string }
interface SkillListResponse { skills: Skill[] }
// POST /skills → 创建（名称/一句话说明/系统提示词）
interface CreateSkillRequest { name: string; description: string; systemPrompt: string }
// POST /skills/[id]/install → 安装广场技能
```

## 11. 网文扫榜 — 🧊 冷冻

```typescript
// GET /rankings/boards → 榜源
interface BoardsResponse { boards: { name: string; site: string }[] }
// GET /rankings?board=畅销榜 Top10 → 榜单
interface RankingsResponse { rows: { rank: number; name: string; heat: string }[] }
// POST /rankings/scan → 扫榜开关
interface ScanToggleRequest { enabled: boolean }
```

## 12. 联网搜索 — 🧊 冷冻

```typescript
// POST /websearch
interface WebSearchRequest { query: string }
interface WebSearchResponse {
  results: { title: string; source: string; snippet: string; url: string }[];
}
// POST /websearch/quote → 引用入文（写回当前会话）
interface QuoteRequest { resultIndex: number; sessionId: number }
```

## 13. 云同步 — 🧊 冷冻

```typescript
// POST /sync/config → 保存并测试连接（WebDAV）
interface SyncConfigRequest { url: string; username: string; password: string }
interface SyncConfigResponse { ok: boolean; message: "已连接" | string }
// GET /sync/status → 同步状态
interface SyncStatusResponse {
  connected: boolean;
  items: { name: string; status: string }[];
  autoSync: boolean;
}
// PUT /sync/config → 自动同步开关
```

## 14. 会员中心 — 🧊 冷冻

```typescript
// GET /account
interface AccountResponse {
  email: string;
  plan: "free" | "member";
  quota: {
    token: { used: string; total: string; pct: number };
    sync:  { used: string; total: string; pct: number };
    draws: { used: string; total: string; pct: number };
  };
}
// POST /account/upgrade → 升级（支付接入占位）
interface UpgradeRequest { plan: "member" }
```

---

**覆盖核对**：13 界面全部入契约（工作台为纯导航页，无数据交换）。✅ 已实现 3 组（认证/会话/对话）；🧊 冷冻 11 组，字段与界面元素一一对应，工单实现时对照本契约。

## 15. 技能广场 — ✅ 已实现（任务二-A）

```typescript
// GET  /api/v1/skills?scope=mine|plaza → 我的技能 / 广场源
interface SkillListResponse {
  skills: { id?: number; name: string; description: string; systemPrompt: string; author: string }[];
}
// POST /api/v1/skills → 创建/安装技能
interface CreateSkillRequest { name: string; description: string; systemPrompt: string; author?: string }
// DELETE /api/v1/skills?id= → 删除
// chat 技能注入：POST /api/v1/chat 请求带 skills: string[]，后端按名查库注入 systemPrompt
```

## 16. 写作机检 — ✅ 已实现（任务二-B）

```typescript
// POST /api/v1/tools/checks
interface ChecksRequest {
  text: string;                 // 正文（200-20000 字）
  mustCover?: string[];         // 合同必含词
  knownEntities?: string[];     // 绑定作品实体库（人物/世界观名）
}
interface ChecksResponse {
  checks: {
    name: "字数窗口" | "占位符" | "泄密扫描" | "实体登记" | "复读检测" | "合同断言";
    ok: boolean;
    detail: string;
  }[];
}
```

## 17. 网文扫榜 — ✅ 已实现（任务二-C，外部源超时降级）

```typescript
// GET /api/v1/rankings?board=畅销榜 Top10
interface RankingsResponse {
  boards: { name: string; site: string }[];
  rows: { rank: number; name: string; heat: string }[];
  board: string;
  degraded: boolean;   // 外部榜源不可达 → 降级数据
  note?: string;
}
```

## 18. 联网搜索 — ✅ 已实现（任务二-C，5s 超时降级）

```typescript
// POST /api/v1/websearch
interface WebSearchRequest { query: string }
interface WebSearchResponse {
  results: { title: string; source: string; snippet: string; url: string }[];
  degraded: boolean;   // 检索不可用 → 降级数据
  note?: string;
}
```

## 19. 云同步 — ✅ 已实现（任务二-C，WebDAV 连接测试）

```typescript
// GET  /api/v1/sync/config → 已保存配置（密码永不回传）
interface SyncConfigResponse {
  configured: boolean;
  url?: string;
  username?: string;
  autoSync?: boolean;
  updatedAt?: string;
}
// POST /api/v1/sync/config → 保存 + 真实 WebDAV 连接测试（5s 超时）
interface SyncSaveRequest { url: string; username: string; password: string; autoSync: boolean }
// 200 { ok: boolean; message: string }（连接失败 ok=false 但 HTTP 200，前端可读错误）
```

---

## 20. 风格库 — ✅ 已实现（工单 14，V1.1 Journey ⑥）

```typescript
// GET  /api/v1/styles → 我的风格库（新→旧，全量无分页）
interface StyleRow { id: number; name: string; guide: StyleGuide; createdAt: string }
interface StyleListResponse { styles: StyleRow[] }

// POST /api/v1/styles → 保存（蒸馏产物持久化；同名允许）
interface StyleSaveRequest { name: string; guide: StyleGuide }
// 400 名称空 / 指南缺四维 → { error: string }
// 201 { style: { id: number; name: string } }

// DELETE /api/v1/styles?id= → 删除（写路径归属校验，他人风格 404）
// 400 缺 id → { error: string }；404 → { error: string }；200 { ok: true }

// StyleGuide（四维，与 POST /distill 返回同形，schema.ts 单一来源）
interface StyleGuide {
  narrative: string; // 叙事视角
  sentence: string;  // 句式节奏
  imagery: string;   // 意象偏好
  rhythm: string;    // 情绪节奏
}
```

---

## Contract Delta 流程（UVSD 第 11 步）

**规则**：契约默认冻结。真实实现发现契约不合理时，走显式 DELTA：

1. 新建 `.scratch/mozhou-mvp/contracts/deltas/DELTA-<NNN>.md`：记录 变更原因 / 变更前后 Schema / 同步修改清单（Schema→Mock→UI→Backend→Tests）
2. 同步更新本文件对应节 + 实现 + 测试
3. 禁止 `data?: any` / 未文档化响应字段绕过契约

**历史 DELTA**：[DELTA-001](deltas/DELTA-001.md) 章节正文保存乐观并发（2026-08-21，见第 24 节）；此前无（V1.0 契约随实现即时补齐）。

**覆盖核对（2026-08-11 更新）**：全站 13 界面 + 认证 → **23 组端点全部入契约**；✅ 已实现 23 组；无冷冻组。

## 22. 云同步推送（V1.1 Journey ④，Contract Frozen 2026-08-11）

```typescript
// POST /api/v1/sync/push → 文件级推送（备份语义，单向）
// 目录结构：mozhou/<作品名>/<章节号>-<标题>.md（正文）
// 200 { pushed: number; at: string }（推送章节数 + 时间）
// 失败 → 502 { error: string }（WebDAV 不可达/凭据错误，可读文案）
// autoSync 语义：正文保存（PATCH content）后若配置 autoSync=true → 触发推送（异步，不阻塞保存）
```

## 23. 搜索引用入文（V1.1 Journey ⑤，Contract Frozen 2026-08-11）

```typescript
// 交互契约（无新端点）：websearch 结果多选 → 引用入文 → sessionStorage 回流通道
// mozhou_pending_websearch = { items: [{ title, source, snippet, url }], at }
// chat 页读取 → 插入消息（对齐 mozhou_pending_deconstruct 回流模式）
// 消息格式：
// 【引用资料】标题（来源）：摘要…
// 来源：URL
// （多条合并一次插入）
```

## 21. 章节级续写（V1.1 Journey ⑦，Contract Frozen 2026-08-11）

> 完整四层契约（Interaction/API/Domain/Persistence）见 `contracts/21-章节级续写契约.md`；工单 16-19 按此实现。
> 已实现端点以后端发射端 + 契约测试为准（工单 16/17/18 已落测试）。

## 24. 章节正文保存与乐观并发（DELTA-001，2026-08-21）

```typescript
// PATCH /api/v1/novels/[id]/chapters?chapterId=N
// 请求：{ title?, status?: "draft"|"final", content?, expectedRevision? }
// expectedRevision 语义：携带即强制（比较并交换，与 insert 的 expectedContent 同构）
//   - 与当前 revision 一致 → 应用变更；content 实际变化时 revision +1
//   - 不一致 → 409 { error: "正文已在其他窗口被修改", code: "ContentChanged", chapter: 当前行 }
//   - 未携带 → 无条件写入（契约要求客户端保存正文时必须携带；服务端不代偿）
//   - 非法值（负数/非整数）→ 400
// 客户端义务：编辑器每次保存正文必须携带上次确认的 revision（GET/PATCH/insert 响应均含）；
// 收到 409 时保留本地文本、显式报错，由用户刷新对账，禁止静默覆盖。
```

## 25. 应用内限流与健康探测（2026-08-22，商用阻断项 C/D）

```typescript
// GET /api/v1/health —— 公开探测（无鉴权，无业务数据）
// 200 { ok: true, db: "up", uptimeSec }   实例存活且 db 可达
// 503 { ok: true, db: "down", uptimeSec } 实例存活但 db 不可达（编排层摘流/重启依据）
//
// 限流（固定窗口，单实例内存；多实例需共享存储）——超限统一：
// 429 { error: "操作过于频繁，请稍后再试" } + Retry-After: <秒>
//   登录 POST /api/v1/auth/login      键=邮箱+来源IP，RATE_LIMIT_LOGIN_PER_MIN 默认 10/分钟
//                                     （密码校验前计数，失败尝试同样计入）
//   AI 昂贵端点按「用户+业务域」计数（每端点独立 30/分钟桶，互不共享）：
//                                     RATE_LIMIT_AI_PER_MIN 默认 30/分钟：
//     POST /api/v1/chat、POST /api/v1/novels/[id]/chapters/chat、
//     POST /api/v1/distill、POST /api/v1/draw、POST /api/v1/websearch、
//     POST /api/v1/deconstruct/analyze
// （六端点均已入 openapi，含 429 $ref；阈值经 RATE_LIMIT_AI_PER_MIN 环境可调）
```
