# 墨舟 V1.2 写作上下文契约修复：最终执行计划

日期：2026-08-12  
状态：待执行；计划已基于本地代码、项目文档、Obsidian Vault、生产部署记录和 Matt Pocock 技能配置交叉核对  
目标读者：将接手墨舟的本地编码 AI、网页端强模型、人工产品负责人  
项目根目录：`C:\zcode\novel-ai`  
生产 Web：`https://mozhou-web-7ecwvlclyq-an.a.run.app`

> 核心指令：这是一个已经上线但 AI 写作行为不符合产品承诺的生产系统。本轮修复模型输入契约，不重做 UI，不扩建平台，不把“加一句身份提示词”当作完整修复。

---

## 1. 本轮唯一目标

把墨舟的两条写作对话链修成可观察、可断言、可回归的统一模型输入链，使以下事实同时成立：

1. 所有写作请求都有固定的“墨舟中文小说写作助手”身份基座；
2. 本轮用户输入以真正的 `user` message 进入最终 provider payload，且只出现一次；
3. 历史压缩发生后，provider 收到的是摘要与保留的近期历史，而不是摘要加完整历史；
4. 章节对话把按时间排序的章节对话历史和本轮用户输入送给模型，正文参考不能替代用户消息；
5. 会话、作品、章节和 RAG 上下文均在用户归属解析完成后才进入 prompt；
6. 测试能够观察最终 provider payload，生产只能记录脱敏结构元数据；
7. 现有 UI、SSE、消息落库、章节插入、Undo/Redo 和冲突保护继续工作；
8. 真实模型和生产环境的行为与上述契约一致。

完成标准不是“测试通过”或“提示词已修改”，而是：

```text
Contract 正确
+ 最终 Provider Payload 正确
+ 自动化测试正确
+ 持久化正确
+ 浏览器行为正确
+ 真实模型行为正确
+ Production Smoke 正确
= RELEASE READY
```

任何一项失败，结论都是 `NOT RELEASE READY`。

---

## 2. 执行者必须先掌握的事实

### 2.1 当前产品不是原型

墨舟是面向中文网文作者的 AI 小说写作平台，技术栈为 Next.js 16.3、React 19、TypeScript、Drizzle、PostgreSQL、one-api 和 SSE。V1.2 已经有真实生产部署，已有作品、章节、人物库、世界观、独立写作对话、章节级对话、风格、技能、插入正文、Undo/Redo、WebDAV 配置和 Web 搜索等界面与链路。

本轮收到的用户反馈是线上 AI 效果不对，不是页面还没设计出来。因此当前任务走“已有行为修复轨”，不走 UI Prototype 轨。

### 2.2 当前生产平台

| 层 | 当前平台 | 已核实状态 |
|---|---|---|
| Web 应用 | Google Cloud Run，服务 `mozhou-web`，区域 `asia-northeast1` | 已上线，公网 URL 本轮探测曾返回 HTTP 200 |
| LLM 网关 | Google Cloud Run，服务 `mozhou-one-api` | 已上线，向 Web 提供 OpenAI 兼容 SSE 接口 |
| 主数据库 | Neon PostgreSQL，数据库记录名 `neondb`，文档记录区域 `us-east-2` | 已上线，保存墨舟业务数据 |
| 网关数据库 | Neon PostgreSQL 独立数据库，记录名 `oneapi` | 已上线，避免与墨舟业务表冲突 |
| 镜像 | Google Artifact Registry | 已使用 |
| 运行时配置 | Google Secret Manager | 已使用；任何密钥值均不属于交接材料 |
| 上游模型渠道 | one-api 后的 SenseNova/DeepSeek、智谱 GLM 等渠道 | 有真实 smoke 记录；具体可用性按执行当日实测 |
| 部署方式 | 手工构建镜像并部署 Cloud Run | 未发现 CI/CD 自动部署管线 |

生产 Cloud Run 记录配置为 1 vCPU、1 GiB、最小 0、最大 2、超时 300 秒。当前仓库没有配置 Git remote。Vercel 和 Cloudflare 只是候选方案，不是当前生产平台；Docker Compose 是本地开发/测试方案，不是当前公网承载平台。

### 2.3 当前版本关系

- 当前本地 `main` HEAD：`6a373e1`，主要新增外部 AI 项目数据包；
- 生产上线记录：commit `4a1c18e`，tag `v1.2.0-production-live`；
- 生产首次 smoke 的消息 ID 撞车修复：`9b9138c`，已包含在后续生产记录中；
- 当前工作树在本计划生成时含未跟踪的审计/交接文档，执行者必须重新运行 `git status --short`，保留这些文件，不得清理或覆盖。

版本规则：本地 HEAD 不能自动等同于当前线上 revision；部署前必须重新核对实际 Cloud Run revision、镜像 tag 和 Git commit。

### 2.4 当前已确认的缺陷

| 编号 | 事实 | 代码证据 | 严重度 |
|---|---|---|---|
| P0-1 | 无 RAG/风格/技能/摘要时，`buildSystemPrompt([])` 返回空字符串，没有写作助手身份 | `app/lib/chat/stream-provider.ts` | P0 产品行为 |
| P0-2 | 章节用户消息会落 `chapter_messages`，但 provider 调用传入 `messages=[]` | `app/lib/novels/chapter-chat.ts` | P0 消息链 |
| P0-3 | `compressHistory()` 返回 `{summary, kept}`，服务只使用 `summary`，仍把完整 `history` 发给 provider | `app/lib/chat/service.ts`、`app/lib/chat/compress.ts` | P0 上下文链 |
| P0-4 | `MockChatProvider` 不读取 `messages`，所以旧测试不能证明最终 payload 正确 | `app/lib/chat/stream-provider.ts` | P0 测试盲区 |
| P1-1 | 未绑定作品时的 RAG 可退化为用户全部作品范围，容易发生作品间上下文串用 | `app/lib/novels/rag.ts` 与独立对话调用链 | P1 数据边界 |
| P1-2 | 技能删除只按 skill id 删除，没有同时限定当前 `userId` | `app/app/api/v1/skills/route.ts` | P1 IDOR |

独立对话首轮当前确实会把刚落库的用户消息包含在 `history` 中；它的主要缺陷是身份缺失和压缩结果未生效。不要把“独立对话 current user 完全缺失”写成既定事实。章节对话才是明确的 `messages=[]`。

### 2.5 生产复现的含义

- 独立写作对话、无作品/技能时输入“你好”，返回通用聊天机器人问候；
- 章节对话带正文参考与技能时，输入“你好”也会生成小说正文；
- 第二个现象不能证明章节链正确。它只说明 system 中的正文参考和技能足以驱动续写，不能证明模型收到了本轮用户消息。

因此根因是“产品身份基座缺失 + 消息/压缩链断裂”，不是 Cloud Run 部署故障，也不能只靠改提示词文案解决。

---

## 3. 资料来源与事实优先级

### 3.1 执行前必读文件

执行 AI 必须完整阅读，不得只读摘要：

1. `C:\zcode\novel-ai\docs\mozhu-writing-context-contract-repair-final-plan-2026-08-12.md`（本计划）；
2. `C:\zcode\novel-ai\docs\mozhu-web-ai-handoff-context-2026-08-12.md`（网页端 AI 自包含项目与部署资料）；
3. `C:\zcode\novel-ai\docs\mozhu-full-materials-audit-report-2026-08-12.md`（全资料交叉审计）；
4. `C:\zcode\novel-ai\docs\project-data-package-v1.3.md`（原始项目数据包）；
5. `C:\zcode\novel-ai\AGENTS.md` 与 `C:\zcode\novel-ai\app\AGENTS.md`（工程约束）；
6. `C:\zcode\novel-ai\CONTEXT.md`（领域词汇与已定产品决策）；
7. `C:\zcode\novel-ai\docs\agents\issue-tracker.md`、`triage-labels.md`、`domain.md`（Matt 技能落盘规则）；
8. `C:\zcode\novel-ai\docs\production-deployment.md` 与 `docs\release-report-v1.2.md`（生产和验收基线）；
9. 当前代码与测试：`app/lib/chat/`、`app/lib/novels/chapter-chat.ts`、`app/lib/novels/rag.ts`、两条 chat route、`app/tests/http/chat.test.ts`、`app/tests/http/chapter-continuation.test.ts`、`app/tests/unit/compress.test.ts`、`app/tests/http/skills.test.ts`。

若网页端 AI 无法访问这些路径，它只能评审本计划，不能宣称已完成代码、测试、部署或生产验证。

### 3.2 事实冲突时的优先级

```text
当前运行代码与当前部署状态
  > 当前审计证据
  > 已验收发布报告
  > 当前产品决策/ADR
  > 历史 CONTEXT 规划
  > 早期 Inbox 摘要或设想
```

例如 `CONTEXT.md` 早期写“Docker Compose 单机部署”，但当前生产事实已是 Cloud Run + Neon。执行者必须把前者理解为历史规划或本地方案，不能用它覆盖生产事实。

### 3.3 参考项目如何使用

| 资料 | 可以借鉴 | 本轮不能做 |
|---|---|---|
| OpenWrite 逆向资料 | 写作助手身份、项目上下文、Skill 工作方式、工具与受控写回的产品结构 | 复制品牌、UI、文案、专有代码；把跨版本逆向推断当当前事实 |
| LingBi / lingbi-next / Fusion | Canon、候选正文、确认后原子写入、fail-closed、MutationProtocol、真实 consumer E2E | 把 Flutter 历史线、Fusion 线和墨舟混成一个实现；借机重写编辑器 |
| 零界道种 | 创作资产、版本与生产包分离的工作流参考 | 把 EP01 漫剧生产包当小说正文；假设未定位的 ch1–4 已存在于当前目录 |
| 《星渊剑主》 | 六章长文 E2E 测试语料，可用于上下文一致性测试 | 当作零界道种或生产用户真实数据 |
| DeterminFlow | 状态机、校验重试、预算与检查点理念 | 引入 AGPL 代码或扩建多 Agent 管线 |

本轮不需要继续逆向 OpenWrite，也不需要联网研究新竞品。现有资料已足以完成写作上下文修复。

---

## 4. 不可违反的执行边界

### 4.1 本轮明确不做

- 不重做聊天 UI，不新建整套页面，不先运行 Prototype；
- 不引入 embedding 渠道，不升级为向量语义检索；
- 不建设多 Agent、工具调用平台、插件市场或工作流编排器；
- 不做会员、支付、跨设备会话、新编辑器或版本历史；
- 不重构整个服务层、数据库层或目录结构；
- 不修改 OpenWrite、LingBi 或零界道种项目；
- 不把生产用户数据复制到测试；
- 不在日志、SSE、错误信息、测试快照或提交中写入完整正文、完整 prompt、用户消息、令牌、数据库 URL 或认证密钥。

### 4.2 代码与 Git 边界

- 当前变更必须遵守仓库 UVSD：一票一个可观察行为、纵向切片、Contract Delta 明示、测试先行；
- 保留所有既有用户修改和未跟踪文档；禁止 `git reset --hard`、`git clean -fd`、覆盖式 checkout；
- 无人值守实现只能从干净、已提交的基线和独立 branch/worktree 开始；
- 本轮预计不需要数据库迁移。若实现者认为必须迁移，先停下提交 Contract Delta，不得直接执行；
- 每个工单独立 commit；不得把无关文件或本地凭据加入 commit；
- `.scratch/` 中存在本地运行与凭据类临时文件。只读取明确属于 tracker 的 Markdown，不扫描、不输出、不提交凭据类文件。

### 4.3 生产边界

- 计划本身不授权部署、修改 Cloud Run、修改 Secret Manager、执行生产数据库迁移或切流量；
- 自动化测试和本地真实模型 smoke 通过后，必须由用户单独批准生产部署；
- 生产观察只允许结构化脱敏元数据，不允许记录内容；
- 部署必须保留上一稳定 revision，并预先写明一条命令可执行的回滚目标。

---

## 5. 墨舟长期开发路由

UI-first 是问题分类后的策略，不是所有任务的固定第一步。

```text
需求 / Bug / 产品反馈
        |
        v
     问题分类
        |
        +---------------------------+
        |                           |
        v                           v
交互或产品行为不明确           已有行为明确但结果错误
        |                           |
        v                           v
Throwaway Prototype            Evidence Audit
        |                           |
人工 UI Freeze                 Context/Behavior Contract
        +-------------+-------------+
                      v
              grill-with-docs
                      v
                  to-spec
                      v
          人工确认 Spec 与 Test Seam
                      v
                 to-tickets
                      v
        人工确认纵向切片与 Blocking Edges
                      v
             implement + TDD
                      v
       UI / Payload / DB / Browser / Real Provider
                      v
               Production Smoke
```

当前任务属于右侧“已有行为明确但结果错误”。本轮禁止先做 UI Prototype。

---

## 6. Matt 技能的实际用法

本机仓库级 setup 已完成，已有：

- `CONTEXT.md`；
- `docs/agents/issue-tracker.md`；
- `docs/agents/triage-labels.md`；
- `docs/agents/domain.md`；
- `.scratch/` 本地 Markdown tracker。

不得再次运行 `setup-matt-pocock-skills`。Matt 文档里的 `/skill-name` 是原环境写法；执行者应通过自己客户端的技能选择方式按名称调用，不得把它当作 PowerShell 或必然存在的斜杠菜单命令。

本轮技能顺序：

```text
grill-with-docs
  -> to-spec
  -> STOP：人工确认 Test Seam、身份文案、消息顺序和范围
  -> to-tickets
  -> STOP：人工确认工单粒度与依赖
  -> implement（逐票）
     -> tdd
     -> code-review
```

新的修复规格放在：

```text
.scratch/mozhou-writing-context-repair/spec.md
.scratch/mozhou-writing-context-repair/issues/01-*.md
```

原因：本地 tracker 约定“一项 feature 一个目录”；旧 `.scratch/mozhou-mvp/` 是 V1.0–V1.2 已完成工单和历史规格的来源，不应覆盖或改写。仍然使用同一个 `.scratch` tracker，不新建 `docs/specs` 或 `docs/tickets`。

---

## 7. 待冻结的统一 Context Contract

### 7.1 System 与 Messages 的职责

```text
SYSTEM
  BaseIdentity
  -> ModeContract
  -> Novel / Canon / owner-scoped RAG
  -> Current Chapter Reference / Validated Selection
  -> Style
  -> Skill
  -> Compression Summary

MESSAGES
  Kept Conversation History（按时间正序）
  -> Current User Message（最后一条、恰好一次）
```

定义：

- `system` 表示模型在本轮应遵守的身份、模式、参考和约束；
- `messages` 表示对话实际发生了什么；
- 正文、RAG、风格和技能都是上下文，不能代替本轮用户消息；
- 对话历史必须按时间正序发送；
- 当前用户消息必须是最后一条 `user` 消息，且不能因“先落库再查历史”与“手工追加”而重复；
- 发生压缩后，只发送 `kept` 和当前用户消息，早期原文不得与摘要重复发送；
- 未发生压缩时，不生成空摘要节；
- system 中每一节有稳定的内部 section 标识，便于测试和脱敏观察，但不新增用户可见 API 字段。

### 7.2 BaseIdentity 推荐文案

以下是进入 `grill-with-docs` 的推荐候选，不允许执行者自行扩写成冗长人格：

> 你是墨舟（MoZhou）的中文小说写作助手，服务中文网文作者。你帮助作者起笔、续写、改写、润色、讨论剧情与人物、整理设定。写作时遵守当前作品设定、章节参考、所选风格与已启用技能；讨论时围绕作者的创作目标给出可执行建议。参考资料用于约束创作，不能代替用户本轮请求。

需要人工冻结的行为：

1. 独立对话输入“你好”时，应以写作助手身份回应并引导到小说创作，不自动假装已有章节；
2. 独立对话可讨论剧情、人物和设定，也可按明确请求输出正文；
3. 章节模式在默认“章节续写/章节起笔”技能下遵守技能的正文输出约束；
4. 用户明确提出讨论、改写、字数、视角等要求时，本轮 user message 必须真正参与决定结果；
5. 与写作无关的普通请求如何处理，应在 Spec 中写成正向行为，不使用模糊的“什么都拒绝”。

### 7.3 必须写入 Spec 的不变量

```text
INV-01  所有写作 LLM 请求都有 BaseIdentity。
INV-02  当前用户输入作为真正的 user message 进入 provider，且只出现一次。
INV-03  system/context 不能替代 current user。
INV-04  压缩后 provider 只收到 summary + kept history，不重发完整早期历史。
INV-05  章节正文是 reference，不是 user message。
INV-06  novel/chapter/session/RAG 在 owner resolution 后才能进入 prompt。
INV-07  测试观察最终 provider payload，不只断言 service 上游参数或数据库落库。
INV-08  生产 observer 只记录结构与计数，不记录正文、消息和 prompt 内容。
INV-09  外部 HTTP/SSE 契约保持不变，除非人工批准 Contract Delta。
INV-10  AI 回复成功后原有持久化、插入、冲突保护和 Undo/Redo 行为不退化。
```

---

## 8. 推荐测试 seam 与 Payload Observer

### 8.1 最高测试 seam

推荐建立一个统一的最终请求对象，例如概念上的 `PreparedChatRequest`，并以“它被交给 provider factory 的那一刻”为主测试 seam。它必须是两条对话路由共同使用的最终输入，而不是上游某个 helper 的半成品。

测试应能从真实 HTTP 路由经过数据库、上下文组装和 provider 选择后，读取测试环境中捕获的最终：

- `system`；
- `messages[]`；
- 消息 role 与顺序；
- 压缩前后计数；
- section 列表；
- owner scope 解析结果。

实现形式由 Spec 冻结。推荐使用只在 `NODE_ENV=test` 且显式启用时生效的 Capturing Provider/测试捕获通道。不得创建生产可访问的调试 API，也不得依赖只回显 system、完全忽略 messages 的旧 Mock 行为。

### 8.2 生产脱敏观察字段

生产只允许记录以下结构元数据：

```text
request_id / route / mode / model
system_present
system_sections[]
system_char_count
message_count
message_roles[]
history_count_before
history_count_after
current_user_present
current_user_occurrences
compression_applied
rag_entry_count
style_present
skill_count
novel_scope_present
chapter_scope_present
owner_scope_resolved
```

禁止记录：原始 system、原始 messages、章节正文、选区正文、RAG 文本、风格内容、技能 prompt、Authorization header、one-api token、cookie、数据库 URL。默认不记录内容哈希，因为本轮不需要它完成验收。

### 8.3 旧测试为什么不够

- HTTP 测试能证明路由、SSE 和落库，但当前不能证明最终 messages；
- `compress.test.ts` 能证明 `compressHistory()` 自己返回 `kept`，但不能证明 service 使用了它；
- 章节测试能证明 user/assistant 已落库，但不能证明 user 进入 provider；
- Mock 回显 system 只能证明部分注入可见，不能证明消息数组、顺序和压缩结果。

新测试必须补上这些 consumer-path 断言，同时保留既有测试作为回归约束。

---

## 9. 分阶段执行计划

### Phase 0：基线与安全检查

执行动作：

1. 阅读第 3.1 节全部文件；
2. 运行 `git status --short`、`git log -8 --oneline --decorate`，记录基线；
3. 确认当前分支、是否存在无关改动、生产 tag 与本地 HEAD 关系；
4. 从 `C:\zcode\novel-ai\app` 运行 `npm run gate:milestone`，记录实际 TypeScript、Vitest、Next build 结果和测试数量；
5. 不手工启动第二个同仓库 Next dev server；HTTP 测试已有动态端口与全局 setup；
6. 若基线失败，先报告失败，不把修复混入本轮工单；
7. 为无人值守实现准备干净的独立分支/worktree。若交接文档尚未提交，先让用户决定是否做 docs-only commit，禁止删除它们来制造“干净”。

完成标准：有可复现的基线记录；工作树中每个改动的归属已知；无秘密进入输出。

### Phase 1：现状证据与请求观察设计

本阶段不改变 AI 产品行为。

必须形成三组现状证据：

| 场景 | 当前应捕获的事实 |
|---|---|
| 独立对话、无注入、首轮 | system 缺失；messages 含当前 user；说明身份缺口 |
| 独立对话、超过压缩阈值 | summary 已生成，但最终 messages 仍含完整 history；说明 `kept` 未接线 |
| 章节对话、带正文和技能 | system 含正文/技能，但最终 messages 为空；说明当前 user 与历史未接线 |

产出：

- 请求编排链路图：route → ownership → persistence → history → compression → RAG/style/skill → final request → provider；
- 独立对话和章节对话的字段对照表；
- 推荐 test seam；
- 生产 observer 数据字典与隐私边界；
- 明确哪些测试将在当前代码上先红。

完成标准：任何接手者都能回答“这次请求最终给模型发送了什么”，且证据不依赖模型回复猜测。

### Phase 2：`grill-with-docs` 与 `to-spec`

`grill-with-docs` 只讨论以下未决项：

1. BaseIdentity 最终文案与非写作请求的正向处理方式；
2. independent / chapter 两种 ModeContract；
3. 章节历史是否复用 8K/70% 压缩策略；推荐复用统一策略，避免无界增长；
4. current user 去重规则；
5. 独立会话与 `novelId` 的唯一可信来源；
6. 未绑定作品的会话是否禁用 RAG；推荐禁用，避免跨作品串设定；
7. Capturing Provider/最终请求对象作为测试 seam 是否获批；
8. observer 是否只进结构日志、不落业务数据库；推荐不新增表；
9. 外部 API/SSE 是否保持不变；推荐保持；
10. 章节历史发送顺序、排除哪些状态或消息类型。

随后调用 `to-spec`，将批准内容写入：

`C:\zcode\novel-ai\.scratch\mozhou-writing-context-repair\spec.md`

Spec 至少包含：Problem、Solution、完整 User Stories、Context Contract、Permission Contract、Persistence Contract、Error Contract、Observer Contract、测试 seam、验收矩阵和 Non-goals。

#### STOP GATE 1：人工批准 Spec

没有用户明确批准以下六项，禁止运行 `to-tickets` 或修改业务代码：

1. BaseIdentity 文案；
2. 两种 ModeContract；
3. system/messages 顺序；
4. compression 与章节历史策略；
5. owner/RAG scope；
6. test seam 和生产脱敏边界。

### Phase 3：`to-tickets` 与切片批准

用 `to-tickets` 把获批 Spec 拆成一票一个完整可观察行为的纵向切片，写入：

`C:\zcode\novel-ai\.scratch\mozhou-writing-context-repair\issues\`

推荐工单顺序如下。

#### 01 — 最终 Payload 可观察

**Blocked by：** 无。  
**交付：** 从独立与章节 HTTP 请求一路走到最终 provider 请求，测试可捕获完整 payload；生产只生成脱敏结构元数据。现有 AI 行为不在本票改变。

验收重点：

- 测试 provider 确实读取 `system` 与 `messages`；
- 能证明独立、压缩、章节三个现状；
- observer 无正文/prompt/secret；
- 不新增生产调试端点；
- 旧 Mock 的测试盲区被消除。

#### 02 — 独立写作对话遵守 Context Contract

**Blocked by：** 01。  
**交付：** 独立对话始终有 BaseIdentity/Independent Mode；当前用户消息恰好一次；压缩后只发送 summary + kept history；SSE 和落库不变。

验收重点：

- 无 RAG/技能/风格时 system 仍存在；
- “你好”表现为小说写作助手，不是无身份通用机器人；
- 短历史保持原顺序；
- 长历史早期原文不再进入最终 messages；
- 当前 user 是最后一条且只出现一次；
- 两轮对话、消息标题、SSE、用量与持久化回归通过。

#### 03 — 章节对话发送真实用户意图与历史

**Blocked by：** 01、02 中的统一请求编排契约。  
**交付：** 章节对话在保留正文/选区/RAG/风格/技能 system 上下文的同时，把章节对话历史与当前用户输入按正序交给 provider。

验收重点：

- 最终 messages 不再为空；
- 当前 user 恰好一次且最后；
- 前轮 user/assistant 可被第二轮请求读取；
- 正文末 3000 字和合法选区继续作为 reference；
- 非法选区仍 fail closed；
- 章节消息持久化、停止、插入、冲突、Undo/Redo 不退化；
- 若历史压缩获批，章节链按同一契约执行并可观察。

#### 04 — 会话、作品与 RAG 归属边界

**Blocked by：** 01、02。  
**交付：** 独立会话只能读取其获批绑定作品的设定；未绑定会话不再默认检索用户全部作品；客户端不能用任意 `novelId` 改变已绑定会话的上下文。

验收重点：

- session owner 与 novel owner 均校验；
- 绑定来源唯一、可解释；
- 未绑定会话 `rag_entry_count=0`；
- 他人作品、章节或设定返回既有 404/失败语义；
- 两个同用户作品之间也不会串设定；
- 不扩建 embedding 或新 RAG 引擎。

#### 05 — 技能删除归属校验

**Blocked by：** 无；为降低并行冲突，推荐在 04 后执行。  
**交付：** 删除技能同时按 `skillId + currentUserId` 限定，越权返回 404，目标技能保留。

验收重点：

- 用户可以删除自己的技能；
- 用户不能删除他人的技能；
- 不存在的 id 与越权保持统一 404；
- 与 styles 删除的 owner-scoped 模式一致。

#### 06 — 真实 Provider 与发布回归

**Blocked by：** 02、03、04、05。  
**交付：** 全量自动化、浏览器、真实 one-api 和生产 smoke 的证据包；无失败项时才给出 Release Ready 建议。

验收重点见第 11–12 节。

#### STOP GATE 2：人工批准 Tickets

用户必须确认：

- 每票是否能在一个新上下文窗口内完成；
- 每票是否是可独立验证的纵向切片；
- blocking edges 是否真实；
- 是否把跨票重构或新产品能力混入；
- 01 的 observability 前置是否保留。

未批准前禁止调用 `implement`。

### Phase 4：逐票 `implement` + TDD

每张批准工单独立执行：

```text
读取 Spec 与当前票
  -> 写下已批准 test seam
  -> RED：一个 consumer-level failing test
  -> GREEN：最小实现
  -> 运行相关单测/HTTP 测试
  -> 检查最终 payload
  -> 检查持久化与 UI 行为
  -> code-review
  -> ticket gate
  -> 独立 commit
```

规则：

- 一次只认领 frontier 中一张未阻塞票；
- 不先批量写所有测试再批量实现；
- 不通过改弱、删除或跳过旧测试来变绿；
- 契约发生变化时先写 Contract Delta，并同步 schema/mock/implementation/tests；
- 若连续两次出现同一失败，或修复必须跨出票据边界，停止并报告；
- 两条对话链迁移完成后，删除被替代的旧编排路径，不保留兼容层或双重实现。

### Phase 5：本地 Release Gate

从 `C:\zcode\novel-ai\app` 执行：

```powershell
npm run gate:milestone
```

并补充：

- `git diff --check`；
- 仅针对变更区域的 code review；
- 最终 payload 契约测试矩阵；
- 两用户、两作品归属测试；
- 长历史压缩测试；
- 独立/章节浏览器真实操作；
- 本地 one-api 真实模型 smoke（不得使用生产密钥输出到终端/日志）。

完成标准：TypeScript、全量 Vitest、Next build、payload、持久化、浏览器和真实 provider 全部通过；实际测试数量写进报告，不硬编码“157”。

#### STOP GATE 3：人工批准部署

向用户提交：

- 每个 commit 与工单映射；
- Contract Delta；
- 测试与 smoke 证据；
- observer 脱敏样例；
- 镜像 tag；
- 待部署 revision；
- 回滚目标；
- 明确说明“预计无数据库迁移”。

只有用户明确批准后，才能进行 Phase 6。

### Phase 6：Cloud Run 部署与生产 Smoke

1. 按 `docs/production-deployment.md` 构建并推送不可变 commit SHA 镜像；
2. 部署新 `mozhou-web` revision，保持上一稳定 revision；
3. 不修改 one-api、Neon schema 或 Secret Manager，除非另有独立批准；
4. 先验证 revision 健康和登录链，再执行写作 smoke；
5. 检查 Cloud Run 脱敏 observer，确认 `current_user_present`、message roles、compression 和 owner scope；
6. 全部通过后再确认流量；失败立即切回上一稳定 revision；
7. 记录线上 revision、镜像 SHA、时间、smoke 账户类型和结果，不记录账号凭据或创作内容。

---

## 10. 自动化验收矩阵

| 场景 | 最终 system | 最终 messages | 持久化/外部行为 |
|---|---|---|---|
| 独立首轮、无注入 | BaseIdentity + Independent Mode | `[current user]` | SSE 正常，user/assistant 落库 |
| 独立多轮、短历史 | 身份/模式；无空 summary | 旧轮正序 + current user | 刷新后消息顺序不变 |
| 独立长历史 | 身份/模式 + Summary | `kept + current user`，不含被摘要早期原文 | `compressed=true`，对话继续成功 |
| 独立绑定作品 | 身份/模式 + owner-scoped RAG | history + current user | injected 仅来自绑定作品 |
| 独立未绑定作品 | 身份/模式；无跨作品 RAG | history + current user | `rag_entry_count=0` |
| 章节首轮 | 身份 + Chapter Mode + 正文/技能等 | `[current user]` | 章节 user/assistant 落库 |
| 章节第二轮 | 同上，含当前 reference | 前轮正序 + current user | UI 消息列表与 provider 顺序各自正确 |
| 章节合法选区 | 含 validated selection | history + current user | 原有 replace/insert 契约不变 |
| 章节伪造选区 | 不发送模型 | 不发送模型 | 400/fail closed |
| 跨用户 novel/session | 不发送模型 | 不发送模型 | 404，observer 不含他人上下文 |
| 同用户两作品 | 只含会话绑定作品 | history + current user | 不串人物/世界观 |
| 越权删技能 | 不涉及 LLM | 不涉及 LLM | 404，他人技能仍存在 |

“系统包含某节”要通过最终 provider payload 断言；“已落库”只能作为持久化断言，不能替代 payload 断言。

---

## 11. 浏览器与真实模型验收

### 11.1 浏览器本地/候选环境

1. 独立写作对话不选作品、不选风格、不选技能，输入“你好”；回复应明确处于小说创作助手语境，并给出创作向引导；
2. 独立对话连续两轮，第二轮引用第一轮明确设定，确认模型能读取历史；
3. 构造超过压缩阈值的测试会话，确认界面仍显示压缩状态、请求仍回答当前问题；
4. 建两个作品，各放一个互斥人物设定；绑定作品 A 的会话不能引用 B；
5. 章节中输入明确续写要求和字数范围，确认回复遵守本轮要求，而不是只受 system 暗示；
6. 章节第二轮要求修改上一轮某个要素，确认模型读到对话历史；
7. 验证停止、部分内容、插入、选区替换、冲突、force、Undo、Redo；
8. 两个用户验证越权会话、作品、章节、RAG 与技能删除。

### 11.2 真实 Provider

真实模型输出非确定，因此验收分两层：

- 结构层必须确定：observer 和捕获证据满足 Context Contract；
- 行为层允许自然语言差异，但必须体现写作助手身份、响应当前用户意图、保持所给作品/章节设定。

不得把某一次“文笔很好”当作 payload 正确的证据，也不得因模型偶发流尾错误忽略结构失败。

### 11.3 生产 Smoke 最小集合

- 注册/登录或专用 smoke 账号可用；
- 独立无技能“你好”进入写作助手语境；
- 独立两轮历史有效；
- 一个绑定作品的 RAG 只命中本作品；
- 章节明确续写请求能被遵守；
- 章节第二轮历史有效；
- SSE、消息落库、刷新、插入、Undo/Redo 正常；
- 脱敏 observer 显示 current user、roles、compression 和 owner scope 正确；
- 错误响应无堆栈、prompt、正文或 secret。

---

## 12. 回滚与失败条件

出现以下任一情况立即停止发布或回滚：

- 当前 user 缺失、重复或不是最后一条 user message；
- 压缩后仍发送完整早期历史；
- 未绑定会话检索到任一作品设定；
- 同用户不同作品或不同用户之间发生上下文串用；
- 生产日志出现原始 prompt、消息、正文、token 或 cookie；
- SSE、消息落库、章节插入、Undo/Redo 或冲突保护退化；
- 全量 gate、build 或真实 provider smoke 失败；
- 新 revision 健康检查失败或错误率明显上升。

回滚只切 Cloud Run 流量到上一稳定 revision；禁止进容器热改代码。失败修复重新走 Git → Test → Commit → Image → Deploy。

---

## 13. 最终交付物

执行完成后必须交付：

1. `.scratch/mozhou-writing-context-repair/spec.md`；
2. 获批的纵向 tickets 及 blocking edges；
3. 必要 ADR/CONTEXT 更新；
4. 最终请求编排与 Payload Observer 实现；
5. independent/chapter/ownership/skill-delete 的自动化测试；
6. 每票独立 commit 列表；
7. Contract Delta 与无数据库迁移声明，或已批准的迁移说明；
8. 本地 milestone gate 报告；
9. 浏览器与真实 provider smoke 报告；
10. 获批后才生成的生产部署、observer 和回滚记录；
11. Obsidian 项目状态更新和可复用经验记录。

最终报告必须区分：代码已完成、测试已完成、真实模型已验证、生产已部署、生产已验收。不得把其中一项冒充全部完成。

---

## 14. 给执行 AI 的分轮指令

### 第一轮：只做证据与 Spec

> 完整阅读 `docs/mozhu-writing-context-contract-repair-final-plan-2026-08-12.md` 及其必读清单。执行 Phase 0–2：复核基线，建立独立/章节最终 payload 的现状证据，使用 `grill-with-docs` 澄清 Context Contract，再用 `to-spec` 写入 `.scratch/mozhou-writing-context-repair/spec.md`。本轮禁止修改业务行为、禁止运行 `to-tickets`、禁止实现、禁止部署。完成后停在 STOP GATE 1，提交 test seam、身份文案、消息顺序、压缩策略和 owner/RAG scope 给用户批准。

### 第二轮：只拆 tickets

> 基于用户批准的 Spec，使用 `to-tickets` 拆成 tracer-bullet vertical slices，逐票写入 `.scratch/mozhou-writing-context-repair/issues/`。至少覆盖最终 Payload 可观察、独立对话、章节对话、会话/作品/RAG 归属、技能删除和发布回归。列出 blocking edges 和每票可独立验证的结果。禁止实现。完成后停在 STOP GATE 2 等用户批准。

### 第三轮及以后：一次实现一票

> 读取获批 Spec 和 frontier 中第一张未阻塞 ticket，使用 `implement` 与 `tdd` 在已批准 seam 上执行 red → green；完成相关 payload、HTTP、持久化和浏览器验证后运行 code review 与 ticket gate，只提交当前票。报告 commit、测试、Contract Delta、未解决风险，然后再领取下一票。所有票完成且本地 Release Gate 通过后，停在 STOP GATE 3 请求部署批准。

---

## 15. 一句话原则

> UI 是墨舟产品定义的起点；最终模型 Payload 是 AI 行为的契约终点；真实生产结果才是最终验收。

