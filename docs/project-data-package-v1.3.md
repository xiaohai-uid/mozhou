# 墨舟（MoZhou）AI 小说写作平台 — 项目数据包 & 问题定位

> 用途：交给外部 AI 完整理解本项目并出方案。阅读本文件 + 仓库代码（C:\zcode\novel-ai）即可。
> 生成日期：2026-08-11（V1.2 PRODUCTION LIVE 后，朋友测评反馈驱动）
> 代码基线：git main @ 4a1c18e（tag v1.2.0-production-live）

---

## 1. 当前最主要的问题（分层定位）

### 表象（真实用户反馈，生产已复现）
独立「写作对话」页（/chat）在**未装技能、未绑定作品**时，AI 回复是通用聊天机器人：

```
用户：你好
AI：你好呀！😊 有什么可以帮你的吗？随时问我，无论是问题、聊天还是需要建议，我都很乐意陪你聊聊。
```

同一账号在**章节内对话**（带"章节续写"技能 + 正文参考）问"你好"，AI 会直接续写小说正文（正确行为）。

### 根因
墨舟的对话提示词链 = **纯"内容约束注入"**（RAG 设定/风格指南/技能说明/正文参考），**没有任何产品级"写作助手身份与行为基座"提示词**：

```ts
// lib/chat/stream-provider.ts
export function buildSystemPrompt(injected: string[]): string {
  if (injected.length === 0) return "";   // ← 无注入时 system 消息为空 → 模型裸奔
  return "以下是作者小说设定库中与当前写作相关的参考资料，写作时必须遵守，不得写崩设定：\n" + ...
}
```

对照逆向对象 OpenWrite v1.3.2（提示词全文已提取）：其写作助手有**身份提示词**——
> "你是一个创意小说写作助手…始终保持与现有故事、角色和世界设定的一致性…"

### 结构性根因（供方案 AI 评估，非本轮结论）
1. **双对话系统并行**：独立对话（sessions/messages 表）+ 章节对话（chapter_messages 表），提示词链、技能体系、行为语义不一致（详见 §6）。
2. **"技能"= 纯文本注入**，非工具调用/Agent 体系；OpenWrite 是 LLM 工具面（file_read/novel_create/web_search/…）。
3. **RAG 是字符共现降级检索**（无 embedding 渠道），质量弱（详见 §7.3）。
4. **章节正文只注入末 3000 字**（BODY_REF_LIMIT=3000），无分段/记忆/摘要设计。
5. 无会员/计费/额度体系（OpenWrite 的护城河在服务端计费；墨舟当前免费纯白嫖，依赖 free 模型）。

---

## 2. 产品定位与目标

- **产品**：墨舟（MoZhou）— 面向中文网文作者的 AI 小说写作平台（Web）。
- **核心理念**（用户原话）："让 AI 与你共同创作"；作者数据归属作者；模型自由（DeepSeek 免费为主）。
- **V1.2 已交付范围**：邮箱认证、小说项目管理（人物库/世界观/章节）、章节编辑 + AI 章节对话（续写/起笔/精确插入/Undo/Redo/选区替换/冲突保护）、独立写作对话（会话、作品绑定、风格、技能）、风格蒸馏（四维指南）、小说拆解、抽卡（内联）、书源搜索/书架、扫榜、联网搜索、云同步（WebDAV 配置层）、技能广场、用量记账、会员占位。
- **V1.2 明确不做**（用户拍板）：跨设备同步会话、会员/支付体系、HTML 书源解析器深度、新编辑器迁移、版本历史。
- **当前状态**：V1.2 PRODUCTION LIVE（Cloud Run + Neon，公网可访问）；等待真实使用反馈迭代。

## 3. 系统架构总览

```
浏览器 (Next.js 16 App Router + React 19 + Tailwind 4)
  └─ Cloud Run (asia-northeast1, 0-2 实例, 1vCPU/1GiB, timeout 300s)
      ├─ mozhou-web      Next.js standalone (server.js, PORT/HOSTNAME env)
      └─ mozhou-one-api  one-api v0.6.11 (LLM 网关: 额度/渠道/计费)
Neon PostgreSQL (免费计划, us-east-2)
  ├─ neondb   墨舟主库（13 张表, 迁移 0000-0012）
  └─ oneapi   one-api 独立库（用户/渠道/令牌/日志）
Secret Manager: DATABASE_URL / AUTH_SECRET / ONEAPI_TOKEN / ONEAPI_DB_URL / ONEAPI_SESSION_SECRET
上游模型渠道（one-api 内）:
  - deepseek-sensenova-free: type=1, base_url=https://token.sensenova.cn, model=deepseek-v4-flash（默认）
  - glm-free: type=50, base_url=https://open.bigmodel.cn/api/paas/v4, models=glm-4.5-flash,glm-4-flash
```

技术栈：Next.js 16.3.0（Turbopack, standalone 输出）、React 19.2.8、Drizzle ORM + postgres.js、JWT httpOnly cookie 认证（bcrypt12）、Zod 4、Vitest 契约测试（157 个）。

## 4. 数据模型（Neon `neondb`，13 表全量）

| 表 | 关键字段 | 说明 |
|---|---|---|
| users | id, email(unique), password_hash, tier(free/member), created_at | 认证 + 会员占位 |
| sessions | id, user_id, title, novel_id(nullable→novels), created_at | 独立对话会话，可绑定作品（R3） |
| messages | id, session_id, role(user/assistant), content, created_at | 独立对话消息 |
| novels | id, user_id, name, description, rag_enabled, timestamps | 小说项目 |
| chapters | id, novel_id, ch("001"), title, content(text), status(draft/final), sort_order | 章节正文 |
| character_entries | id, novel_id, name, note | 人物库（RAG 源） |
| worldview_entries | id, novel_id, name, note | 世界观（RAG 源） |
| usage_events | id, user_id, node_type, prompt_tokens, completion_tokens | LLM 用量记账 |
| shelf_books | id, user_id, name, source, author, site, status | 书源书架 |
| skills | id, user_id, name, description, system_prompt, author | 用户技能（纯文本注入） |
| sync_configs | id, user_id, url, username, password(明文⚠️), auto_sync | WebDAV 配置 |
| styles | id, user_id, name, guide_json(四维), created_at | 风格库 |
| chapter_messages | id, chapter_id, user_id, role, content, skills(jsonb), snapshot(生成时正文快照), status(done/stopped/error), inserted(bool) | 章节对话消息 |

## 5. 对话系统现状（核心——方案 AI 必读）

### 5.1 两条并行对话链

**链 A：独立写作对话**（/api/v1/chat，页面 /chat）
- 数据：sessions + messages；能力：多会话、标题自动生成（首条 20 字）、作品绑定（novelId → RAG 按作品过滤）、模型切换、风格选择（styleId）、技能多选（用户 skills 表）
- 流程（lib/chat/service.ts runChat）：归属校验 → 存用户消息 → 拉历史 → **上下文压缩**（8K 窗口，70% 触发，保留近 6 条，摘要 ≤200 字，摘要注入 system）→ RAG 检索 → 组装 extra（摘要/[风格]/[技能]）→ buildSystemPrompt → one-api SSE 流 → 记账 → 存助手消息
- **无身份提示词；无技能时 system 可能为空** ← 问题所在

**链 B：章节对话**（/api/v1/novels/:id/chapters/chat，页面 /chapter/:chapterId）
- 数据：chapter_messages；能力：章节内续写/起笔（SCENE_SKILLS 硬编码）、选区作为 AI 输入（J9）、AI 候选「插入正文/替换选中内容」（精确位置）、Undo/Redo（前端 history 栈）、两层冲突保护
- 注入顺序（lib/novels/chapter-chat.ts runChapterChat）：
  1. `[正文参考]` 章节正文**末 3000 字**
  2. `[所选片段]`（仅当请求以选区为输入）
  3. RAG 检索
  4. `[风格]` 四维指南（styleId）
  5. `[技能]` SCENE_SKILLS（章节续写/章节起笔）+ 用户技能
  → buildSystemPrompt → SSE
- 技能文案（SCENE_SKILLS）：
  - 章节续写："通读前文与作品设定；保持叙事视角与句式节奏；结尾留钩子。只输出正文。"
  - 章节起笔："根据作品设定与风格指南起笔；建立场景与人物；结尾留钩子。只输出正文。"
- **同样无身份提示词**（但正文参考+技能使其行为"看起来对"）

### 5.2 提示词链现状（逐字）

```ts
// buildSystemPrompt（唯一 system 组装点，两链共用）
injected 为空 → ""
非空 → "以下是作者小说设定库中与当前写作相关的参考资料，写作时必须遵守，不得写崩设定：\n" + "- [人物/设定] name：note\n" + "- [风格] ...\n" + "- [技能] ...\n"
```

消息结构：`[system?] + [user/assistant...历史] + [user 当前]`，OpenAI 兼容 `/v1/chat/completions` stream。

### 5.3 上下文与记忆现状
- 独立对话：8K token 窗口（粗略估算 中文 2 字/token），超 70% 触发摘要压缩（compress.ts，摘要模型走同一网关，失败静默降级）
- 章节对话：**无历史压缩**；只注入正文末 3000 字；多轮靠 chapter_messages 全量历史（无上限！）
- RAG：字符共现 top-k=5（无 embedding；停用字过滤；归属校验；作品级开关 rag_enabled）

### 5.4 插入链（J9，已验收闭环）
- POST /novels/:id/chapters/messages/:messageId/insert?chapterId= — body: {content, mode: insert|replace, position?|range?, expectedContent, force?}
- 位置语义：UTF-16 code unit（与 textarea selectionStart/End 一致）
- 两层冲突：expectedContent 乐观并发（409→UI"正文已变化"确认）+ selection source conflict（本地比对，改选区后替换需确认）；force 只跳过用户已确认的冲突
- 前端 undo/redo：自定义 history 栈（2s 输入合并；AI 插入原子一层；保存不清栈；会话级）

## 6. 功能模块现状（API 面全量）

| 模块 | 端点 | 状态 |
|---|---|---|
| 认证 | /api/v1/auth/register\|login\|logout | ✅ 生产 |
| 作品/章节 CRUD | /api/v1/novels[/:id[/chapters[?chapterId]]] | ✅ |
| 人物/世界观 | /api/v1/novels/:id/entries | ✅ |
| 章节对话 | /api/v1/novels/:id/chapters/chat + /messages + /messages/:id/insert | ✅（含 P0 修复） |
| 独立对话 | /api/v1/chat, /api/v1/sessions[/:id/messages] | ✅ 生产 |
| 风格 | /api/v1/styles（CRUD，guide 四维） | ✅ |
| 技能 | /api/v1/skills（CRUD，scope=mine） | ✅（注入式） |
| 蒸馏 | /api/v1/distill（POST 文本→四维指南） | ✅（MOCK 门控：DISTILL_PROVIDER=mock 仅测试） |
| 拆解 | /api/v1/deconstruct/analyze | ✅（同 MOCK 门控） |
| 抽卡 | /api/v1/draw | ✅（同） |
| 扫榜 | /api/v1/rankings | ✅（同） |
| 书源搜索 | /api/v1/search, /shelf | ✅ 简化 title 提取 |
| 联网搜索 | /api/v1/websearch（Bing 无 key HTML，5s 超时降级） | ✅ 生产可用（结果相关性受简化解析限制） |
| 云同步 | /api/v1/sync/config, /sync/push | ⚠️ 配置层完成；无真实凭据；push 未配置返回真实错误 |
| 用量 | /api/v1/account | ✅ |
| 工具检查 | /api/v1/tools/checks | ✅ |

模型白名单（lib/chat/models.ts）：`["deepseek-v4-flash", "glm-4.5-flash"]`，默认 deepseek-v4-flash。
MOCK 门控：DRAW/DISTILL/DECONSTRUCT/RANKINGS 均有 `*_PROVIDER === "mock"` env 门控（测试用，生产不启用）。

## 7. OpenWrite v1.3.2 参照（已逆向，关键差异）

OpenWrite = Flutter 桌面端 AI 小说写作助手（**无秘密瘦客户端**；AI 功能 = 提示词工程 + LLM 工具调用）。与墨舟差异表：

| 维度 | OpenWrite | 墨舟（现状） |
|---|---|---|
| 身份提示词 | ✅ "你是一个创意小说写作助手…始终保持与现有故事、角色和世界设定的一致性…" | ❌ 无（本次主要问题的根因） |
| AI 能力面 | LLM 工具调用：file_read / file_ops / novel_create / terminal / web_search / novel_rank / skill_lookup | 纯提示注入（无工具调用） |
| 项目结构 | 人物库 + 世界观设定 + 章节摘要 + 章节文件（隐含约定） | 人物库/世界观/章节（同思路，RAG 注入） |
| 上下文管理 | contextCompression + opencode_snapshots（项目快照多版本） | 8K 窗口摘要（独立对话）；章节对话无压缩 |
| 云同步 | 自研 WebDAV，四类数据 zip（projects/sessions/memos/skills） | WebDAV 配置层（未接真实凭据） |
| 书源 | 硬编码书源爬取（shukuge/22biqu/zxtyz）+ AnySearch | 简化 title 提取 + Bing 无 key |
| 会员 | 服务端裁决（is_vip 实时查 + force_update/signature 防伪；离线破解不可行） | 无（tier 字段占位） |
| 免费模型 | deepseek-v4-flash-free（opencode.ai/zen/v1） | deepseek-v4-flash（SenseNova）+ glm-4.5-flash |
| 风格蒸馏/拆解 | 会员功能 | 免费（MOCK 门控已就绪，真实化待配） |

**可复用结论**：OpenWrite 的护城河 = 品牌 + 服务端计费 + 运营，非技术；"一模一样的应用"技术上任何人可做。

## 8. 已知问题与约束（截至 2026-08-11）

1. **【本次触发】独立对话无身份提示词 → 通用聊天机器人行为**（详见 §1；修复方向=统一身份提示词基座，需用户拍板语义）
2. sensenova free provider 流尾偶发失败（消息已落库 + 客户端人性化降级 + 重试成功）——优雅处理，非 P0
3. 双对话系统并行（链 A/链 B 行为不一致）——结构性问题，待方案
4. 章节正文仅注入末 3000 字；长文记忆弱（RAG 为字符共现，无 embedding）
5. WebDAV 生产验证待真实凭据；sync_configs.password 明文存储（已标注）
6. 章节正文无显式大小上限（2MB 可存，登录+配额约束，低危）
7. undo/selection 历史、风格选中为会话级（刷新/换端不跨）
8. websearch 结果相关性受简化解析限制（真实检索可用）
9. 技能=文本注入（非工具调用）；无 Agent 体系
10. 无会员/计费/限流（配额靠 one-api 网关；生产无 IP 限流）
11. 测试基建：Next16 dev server 项目级锁 + 字体网络依赖（gstatic 偶发超时需重试）
12. 生产部署细节与踩坑：见 docs/production-deployment.md（可复用）

## 9. 用户工作流与期望（产品语义，方案必须尊重）

- 用户是产品决策者：**一次一条 Journey**；方案需附实证/对比/推荐，拍板后冻结执行
- "我要的是一个写小说的 AI，不是通用聊天机器人"（本次诉求）
- 明确不做（勿重新提议）：跨设备会话、会员/支付、HTML 书源解析器、新编辑器、版本历史、插件市场、RAG 扩建语义化、多 Agent
- 真实用例（零界道种 ch1-4）：作者在章节内对话续写 → 插入正文 → 迭代；风格蒸馏 → 应用到对话；长文设定一致性（人物/世界观）
- 成本红线：仅免费额度（Free Tier + 免费模型），$0 预期；不建昂贵架构

## 10. 开放问题（供方案 AI 输出方案时回答/向用户确认）

1. 身份提示词基座：统一文案/行为边界（写作助手该拒绝什么、输出规范、互动方式）？
2. 是否统一双对话链（章节对话并入独立对话体系 / 保留双链但共享提示词基座）？
3. 技能体系演进：注入式（现状）vs 工具调用式（OpenWrite 路线）？范围？
4. RAG/记忆升级：embedding 渠道（one-api 需配）？章节摘要化记忆？
5. 长对话上下文：章节对话的压缩/裁剪策略？
6. 其它问题按 §8 清单逐一给结论（修/不修/记录）。
