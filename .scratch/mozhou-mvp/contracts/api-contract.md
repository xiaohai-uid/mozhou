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
}
// SSE 事件流（每行 data: {...}，\n\n 分隔；事件顺序：start → delta* → done，出错时 error 替代后续流）：
interface ChatStreamEvent =
  | { type: "start";  sessionId: number }        // 会话已建立
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

## 7. 抽卡模式 — 🧊 冷冻（前端并行调用）

```typescript
// POST /draw（每个选中模型各发一次，Promise.all 并行）
interface DrawRequest {
  model: "deepseek-v4-flash" | "glm-4.5-flash";
  instruction: string; // 写作指令 textarea
}
interface DrawResponse { text: string } // 该模型生成文字
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
