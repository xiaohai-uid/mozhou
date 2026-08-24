# 墨舟 (MoZhou) — AI 小说写作产品 · CONTEXT

> grill-with-docs 会话记录。日期：2026-08-09。状态：**设计树已收敛（23/23）**，进入 to-spec 阶段。
> 基于 OpenWrite v1.3.2 逆向数据（case: work/openxz-re，E-004~E-014）+ 开源组件调研（report/OpenWrite-重建缺口开源替代调研.md）。

## 已定决策（前三轮 grilling）

| # | 决策 | 结论 |
|---|---|---|
| Q1 | 项目形态 | **先个人/开源跑通**，验证后再商业化 |
| Q2 | 功能范围 | **增强版**：原版功能集 + Agent 世界观系统/RAG/长文记忆 |
| Q3 | 平台 | **Web 优先**（后续可 Tauri 桌面壳） |
| Q4 | 商业化 | 订阅 + 额度混合（预留设计） |
| Q5 | LLM 成本 | 免费模型平台出 + 高级模型 BYOK |
| Q6 | 目标用户 | 中文网文作者 |
| Q7 | 合规 | 功能流程对齐原版体验；品牌/UI/文案全原创 |
| Q8 | 前端 | Next.js (App Router) + TypeScript + Tailwind + shadcn/ui |
| Q9 | 后端 | Next.js 一体化 API + **one-api** 网关（额度/计费现成） |
| Q10 | 数据库 | PostgreSQL + Drizzle ORM |
| Q11 | 部署 | Docker Compose 单机（Next.js + Postgres + one-api） |
| Q12 | MVP 范围 | 写作对话(流式) + 项目管理(RAG 注入) + 风格蒸馏 + 小说拆解 + 书源搜索；同步/技能广场/扫榜二期 |
| Q13 | 账号 | 邮箱 + 密码（后续可加微信扫码） |
| Q14 | 免费/会员 | 对齐原版划分 + RAG 容量/请求额度（one-api 实现） |
| Q15 | 书源 | Yuedu/legado 书源规则格式 + 内置 3-5 主流源 |
| Q16 | 品牌名 | **墨舟**（临时工作名 novel-ai，仓库/域名待定） |
| Q17 | 开源策略 | MVP 阶段**私有仓库**，跑通后开源 |
| Q18 | 视觉 | 深色编辑器风（全原创设计语言） |
| Q19 | 免费模型 | **DeepSeek 为主 + Qwen 备用**（one-api 自动 failover） |
| Q20 | Agent 实现 | **Agent 框架路线**（待定：自研轻量管线 vs 集成 DeterminFlow） |
| Q21 | 长文记忆 | **pgvector RAG**（世界观/人物库/章节摘要向量检索）+ 上下文摘要压缩 |
| Q22 | 抽卡模式 | MVP 含（并发多模型对比） |

## DeterminFlow 调研结论（2026-08-09，Agent 层参考）

- **alikon-art/DeterminFlow** ★277，AGPL-3.0，Python 3.11+ FastAPI + React + Docker/Postgres + WebSocket + MCP + Cron
- 定位："让不确定的模型，运行在确定的流程里"——节点式工作流运行时（Agent/Script/Approval/Subprocess 四类节点）
- **已在"笔枢写作"(bishuxiezuo.cn) 真实 AI 小说生产链路验证，节省 70%-89% Token**（用户本地 8020 即运行实例，工作流 bishu-novel-polish 章节润色管线：存档检查 → AI 检测 → 自审 agent → 润色）
- 可借鉴理念：节点边界清晰（每个 Agent 只干一件事）/ Task 定义冻结 + 检查点恢复 / 工具白名单黑名单 / **JSON 输出检测-修复-重试** / **Token 账本**（对应墨舟额度计费）/ 下游拒绝触发上游返工（质量闭环）
- **License 冲突**：AGPL-3.0——若墨舟集成它并对外提供 SaaS → 墨舟必须开源（与 Q17 私有冲突）；自部署自用无此义务

## 事实清单（agent 已备，无需用户查）

- OpenWrite 逆向数据全量：27 条提示词（notes/prompts-expanded.txt）、7 工具定义、协议/端点/交互流（E-004~E-014）
- 开源组件选型：one-api(36k★)/acg-faka(5.4k★)/lago(10k★)/Yuedu(12k★)/AI-Novel-Writing-Assistant(2.3k★)/Nextcloud(30k★)
- 书源格式：Yuedu 规则（12k+ 书源生态）
- 部署环境：用户有 WSL + Docker 可用

## 待定

- ~~Q23 Agent 层最终决策~~ → **已定 A：自研轻量管线**（节点管线 + JSON 校验重试 + Token 记账，理念借鉴 DeterminFlow，代码全原创，无 AGPL 包袱；二期再评估复杂工作流需求）

## V1.1 术语表（2026-08-11 定案，工单 14/15）

| 术语 | 定义 |
|---|---|
| 风格蒸馏（distill） | 上传文本 → LLM 分析生成风格指南的过程（`POST /distill`，V1.0 已真实化，无状态） |
| 风格指南（StyleGuide） | 蒸馏产物：**四维** JSON `{narrative 叙事视角, sentence 句式节奏, imagery 意象偏好, rhythm 情绪节奏}` |
| 风格库（style library） | 用户已保存的风格指南集合，`styles` 表（V1.1 新增），命名/列表/删除可管理 |
| styleId 引用 | chat 请求引用已保存风格的方式：请求带 `styleId`，服务端查表注入完整四维指南（替代 V1.0 自由文本 `style`，已删除） |
| 回流（flowback） | R1/R2 决策术语：工具产物一键进入写作对话主流程；蒸馏页"应用到对话"按钮 = 真实库引用的回流 |
| pending 回流 | 蒸馏页 → chat 的暂存通道（sessionStorage `mozhou_pending_style`）；V1.0 存 `{name, guide}`，V1.1 升级为 `{styleId, name}` |
| 风格胶囊 | chat 顶部单选胶囊（R4 决策）：`无` + 我的风格库，同时只生效一种文风 |

## V1.1 决策记录（2026-08-11 grilling Q1-Q6 全按推荐）

1. 风格库管理入口 = 蒸馏页内嵌区块（同页闭环，不做独立管理页）
2. 保存后保留"应用到对话"一键回流（体验不倒退）
3. chat 胶囊演示风格三件套（灰烬写实/意象绵长）**彻底删除**，不转种子数据
4. chat 契约改 `styleId` 引用；`style` 自由文本字段删除（不保兼容原则）
5. 风格编辑/重命名不入 V1.1（工单 07 checklist：命名/保存/删除）
6. 同名风格允许（无唯一约束，与 skills 一致）
7. 限次不扩展（usage 记账已覆盖，会员边界留工单 11）

## V1.1 Journey ⑦ 术语表（2026-08-11，UI Frozen v3 技能驱动对话）

| 术语 | 定义 |
|---|---|
| 章节编辑器（章节页） | 章节级续写的承载页：`/chapter/[id]`，左正文编辑 + 右 AI 对话面板 |
| 技能驱动对话 | 章节续写的工作方式（用户定案 A）：对话面板头部**技能胶囊行**（多选），AI 按技能 systemPrompt 规则对话产出 |
| 场景技能 | 平台内置技能，随章节状态切换：非空章节默认「章节续写」，空章节默认「章节起笔」；用户自定义技能可组合 |
| 注入标签 | AI 回复头部 `[技能] 章节续写 · 去 AI 味`（发送时快照）——system 注入的可见性 |
| 插入正文 | 回复完成 → 正文末尾追加 + 消息标记"已插入"；「忽略」只收起操作区，消息留存 |
| 插入冲突 | 插入时比对生成快照与当前正文；不一致 → 黄条"正文已变化，这条回复基于旧正文"+ 仍要插入/取消（灵笔 DocumentConflict/CandidateStale 语义，默认不覆盖用户内容） |
| 消息级状态机 | streaming（Preparing/Streaming/Cancelling）→ done / stopped / error；"取消"是消息级动作（⑧ Cancelled 并入），非页面级状态 |
| 章节对话留存 | 对话随章节保留（跨会话），回到章节可继续（Q1 定案） |
| 保存语义 | 自动保存（防抖）+ 显式保存并存（Q2 定案）；mock 阶段为本地态展示 |
| 正文锁定 | 永不锁定——对话/生成期间正文可随时编辑（冲突保护兜底） |

## V1.1 Journey ⑦ 决策记录（2026-08-11 grilling Q1-Q4 全按推荐）

1. 章节对话**留存**（跨会话保留，写作工作台的一部分）
2. 正文保存 = **自动保存（防抖）+ 显式保存并存**
3. 场景技能**平台内置**（章节续写/章节起笔）+ 用户自定义技能可组合
4. 范围按 mock 现状冻结：正文撤销仅针对插入；无编辑 undo 栈；插入位置固定正文末尾
5. E 节未决（正文持久化模型/任务与候选表结构/保存落盘机制/撤销服务端语义）→ **Contract Frozen 后再定**

## V1.2 写作上下文契约术语（2026-08-12 Gate 1）

| 术语 | 定义 |
|---|---|
| 写作上下文契约 | 规定一次写作请求中，模型应知道哪些作品资料、对话事实和当前意图，以及这些内容应如何分层进入模型输入的产品行为约定。 |
| 身份基座（Base Identity） | 所有写作对话共享的墨舟中文小说写作助手身份与职责边界；它不是作品资料，也不能替代作者本轮请求。 |
| 模式契约（Mode Contract） | 对独立写作对话或章节写作对话的行为边界说明，规定讨论、分析、起笔、续写、改写和润色之间不能被参考资料擅自混淆。 |
| 作品上下文 | 经过当前用户归属验证、并且确实绑定到当前会话或章节的作品设定、人物、世界观等资料。 |
| 章节参考 | 当前章节正文参考和经过合法性校验的选区；它们是创作参考，不是本轮对话消息。 |
| 章节对话历史 | 按时间顺序保存的章节级 user/assistant 对话事实，与章节正文参考分开管理，不互相替代。 |
| ConversationHistory（可重放对话历史） | 当前业务消息模型中可重放的 user/assistant 对话事实；system/context、observer 元数据和非对话记录不属于历史，本轮请求按消息身份分离后只追加一次。 |
| 本轮请求 | 作者当前明确提交、必须作为最终对话中的最后一条 user 消息发送的一次意图；它不能靠正文参考或技能文案推断。 |
| 保留历史 | 压缩发生后仍以原始消息形式保留的近期对话历史。 |
| 压缩摘要 | 对较早对话历史的语义摘要，只用于补充上下文；它不应伪装成对话消息，也不能与完整早期历史重复发送。 |
| 归属边界 | 由当前登录用户与服务端关系校验决定的会话、作品、章节和 RAG 范围；客户端携带的跨范围标识不能覆盖它。 |
| Payload 观察 | 对最终 provider 输入的结构性验证或脱敏记录，只记录消息角色、数量、上下文区段和归属状态，不记录正文或完整提示词。 |

## 架构深化术语（2026-08-13）

| 术语 | 定义 |
|---|---|
| 写作上下文 | 一次写作请求中，模型需要知道的作品资料、章节参考、对话历史、作者本轮请求及其约束的整体语境；它不等同于正文或历史消息中的任一部分。 |
| 模型传输 | 将已经确定的写作上下文交给模型并接收结果的过程；它负责通信与结果传递，不决定作品上下文或章节候选的业务含义。 |
| 可重放对话事实 | 已完成且允许再次进入模型上下文的作者消息与 AI 回复；生成中、失败、丢弃和半成品记录不属于可重放对话事实。 |
| 候选生命周期 | AI 回复从生成准备、流式生成、完成候选到应用或丢弃的完整过程；候选的状态、幂等键、正文基线和并发结果属于同一生命周期。 |
| 传输事件 | 写作流对客户端公开的 start、delta、done、error 等事件；它表达传输进度，不替代对话事实或候选状态。 |
| 上下文区段 | 写作上下文中具有独立语义和顺序的身份、模式、作品、章节、选区、风格、技能或摘要资料；区段可被观察，但最终仍可渲染为一个 system message。 |
| replay policy | 判断已持久化的章节消息是否属于可重放对话事实的规则；它不决定候选是否可应用，也不把停止、失败或丢弃记录变成对话事实。 |
| 模型候选 | AI 为作者生成、尚未或已经应用到正文的 assistant 内容；它拥有自己的候选生命周期，不等同于已确认正文。 |

## 2026-08-13 架构审查后的边界决策

1. 本轮修复只处理写作上下文契约、最终 payload 观察和生产 Mock 配置安全；模型候选的 generation key、候选状态、discard、回放和正文 revision 并发保护另立工作流，不继续扩张本轮范围。
2. 写作上下文仍保留语义层与传输层两个边界：语义层表达 system、ConversationHistory 和本轮请求；传输层表达 provider 实际消费的完整消息数组。两层都必须可测试，不能把其中一层冒充另一层。
3. 本轮请求由统一上下文构造负责追加为最终消息中的最后一条 user；Observer 不信任调用方提供的 current-user 索引，而验证最终 payload 的结构性事实。
4. 生产环境显式配置 Mock 视为配置错误，必须 fail closed，不得静默使用模拟模型或隐式切换到其他 provider。
5. 已经进入当前提交链的候选生命周期实现必须与本轮上下文修复隔离；本轮不得以“暂不补 schema/migration”的方式保留一个不能独立构建的 HEAD。当前工作树中用户已有的其他未提交改动不属于这次隔离操作范围。
6. 模型输入有两个可观察边界：业务语义层的 `PreparedChatRequest`，以及 transport 生成的 provider wire payload。两者都要测试，且 fake provider 必须读取 transport 实际发送的标准化 payload。
7. `NODE_ENV=production` 下选择 `CHAT_PROVIDER=mock` 是配置错误；错误在 transport composition root 暴露，并由上层安全错误处理转换为通用失败，不启动 Mock，也不静默改用 one-api。
8. 候选生命周期另建 Spec 和 Contract Delta，覆盖 schema/migration、generationKey、状态机、SSE 事件、回放、discard 和 revision 冲突，再独立拆票实现和审查。
9. 本轮上下文修复以候选生命周期引入前的 `0536fa9` 为整理基线；候选相关提交不以手工删除方式混入本轮，用户已有未提交改动不触碰。
10. 模型输入同时有语义 payload 与 wire payload 两个层次：前者保留 `PreparedChatRequest` 的 system/messages 分离，后者由 transport 唯一生成 provider 实际消费的 system + messages 数组；两层都必须测试。
11. 共享 SSE framing 只负责编码、取消、关闭和安全错误，不拥有章节候选、消息状态或领域事件语义。
12. 候选生命周期独立规格的最低范围包括 schema/migration、generationKey 幂等与冲突、完整候选状态机、章节 replay policy、正文 revision/expectedContent 冲突保护、stop/retry/duplicate apply/并发 apply，以及既有章节 SSE 事件契约。


## 2026-08-14 扫榜/趋势/搜索 grilling 决策（Q1-Q8 全部按推荐/用户确认）

### 决策表

| # | 决策 | 结论 |
|---|---|---|
| Q1 | 榜单复刻范围 | 核心榜型全量：热门/新书/阅读/完结 × 女频/男频 × 短篇/长篇（实测 URL 后配置约 8-16 个榜）；题材榜（科幻末世等 18 个×4 组合）二期按需 |
| Q2 | 每榜条数 | 前 20（与番茄页面同量级） |
| Q3 | 扫榜频率与存储 | 每日自动 1 次（对齐番茄日更「每天下午3点前更新截止到上一日」）+ 手动刷新按钮；新建 ranking_snapshots 表（board_id + book_id + rank + captured_at） |
| Q4 | 趋势指标与展示 | 首版：榜单行内涨跌标签（较上次快照）+ 新进榜/跌出榜标记 + 「上升最快 TOP5」「新进榜 TOP5」横区；单书趋势曲线页二期 |
| Q5 | 趋势数据保留 | 90 天，超出自动清理 |
| Q6 | 搜索定位 | 本地书目检索：搜索框在「已扫榜入库书目」内做书名/作者模糊检索，页面标注数据来源；不联网伪造 |
| Q7 | 生产爬取通道 | 部署 crawl4ai（Cloud Run）作兜底抓取通道；榜单主链路保持轻量 fetch + detail-ssr（已验证无签名需求） |
| Q8 | 搜索 API 路径 | a_bogus 签名移植为主：番茄 Web 搜索端点 GET /api/author/search/search_book/v1（参数 filter/page_count/page_index/query_type/query_word）需要 msToken + a_bogus（字节 Web 通用签名）；移植开源算法（mafqla/douyin-api 或 ylcangel/douyin_sign），内联 Next.js API，直接 fetch；crawl4ai 兜底 |

### 事实依据（2026-08-14 调研）

- 番茄 rank 页共 74 个榜单 URL，语义 /rank/{女0/男1}_{短1/长2}_{榜型或题材ID}；已确认 1139=热门（女频）、1017=新书（女频）、8=科幻末世等题材
- 榜单页/搜索页书名均为字体反爬 PUA（U+E000-U+F8FF），detail-ssr（bookId→详情页明文）已线上验证可用
- 搜索页 URL query 参数不触发真实搜索（默认返回「相关」推荐，query_word=0）；真实搜索由页面内输入触发
- 无签名调用 search_book/v1 返回 200 空 body；真实浏览器可出结果；crawl4ai 无头环境被风控拦截
- a_bogus 为字节 Web 通用签名，社区有活跃 Python/JS 实现

### 术语表（2026-08-14）

| 术语 | 定义 |
|---|---|
| 扫榜（ranking scan） | 按配置的榜单列表抓取番茄榜单并落库的过程；每次扫榜 = 每个榜 1 次列表页 + 每本书 1 次详情页（detail-ssr 解书名） |
| 榜单快照（ranking snapshot） | 一次扫榜产生的 (board_id, book_id, rank, captured_at) 集合，ranking_snapshots 表的一批行 |
| 趋势指标（trend delta） | 较最近一次早于本次的快照计算的名次变化：上升/下降/持平/新进榜/跌出榜 |
| 上升最快榜 | 名次上升幅度最大的书集合（横区展示 TOP5） |
| 新进榜 | 本次快照出现、上次快照不存在（或跌出后回归）的书 |
| 书目库（book index） | 由扫榜积累的去重书目集合（book_id + 明文书名 + 作者），本地检索的数据源 |
| 本地书目检索 | 在书目库内按书名/作者模糊匹配的搜索，标注「数据来自扫榜库」，不返回库外内容 |


### AI 消费链路（2026-08-14 prototype V3 + 用户确认）

| 场景 | 内容 | 本期/二期 |
|---|---|---|
| A 开书市场建议 | chat「市场参照」开关：AI 回答自动带最近 7 天榜单摘要（题材×排名变化×在读人数，几百 token） | 本期 |
| D 每日市场简报 | 扫榜后 AI 生成结构化简报（题材风向/新进共同元素/上升最快），存库可查询 | 本期 |
| B 书名生成 | AI 参考热榜书名语料生成 10 候选 + 风格理由 | 本期 |
| C 写作市场参照技能 | 技能广场官方技能（marketRef 注入） | 二期 |

关键设计：快照必须带题材维度（详情页 categoryV2 顺手入库）；AI 消费结构化摘要而非原始快照；marketRef 复用写作上下文注入链（与风格/技能注入同机制）。
UI 形态：prototype V3（上升最快/新进横区 + 榜单涨跌徽标），原型 primary source 在 D:/a/_mozhou_review/prototype-trends.html。

## V1.3 技能运行时 + A 版双栏工作台术语（2026-08-15 定案，handoff 批准）

| 术语 | 定义 |
|---|---|
| 技能运行时（Skill Runtime） | 创作请求的编排层：意图/阶段路由 → pre_write 技能执行 → ContextAssembler 组装 → 正文生成 → post_write 质量门 → SkillRun 证据；技能产物必须经这条链进入正式写作或质量门 |
| SkillDefinition | 技能的可执行定义：key/角色/类型/触发阶段/启用与优先级/token 预算/输入契约/输出契约/执行器；内置五角色 + 自定义（自定义未声明完整契约时 UI 标记「未接入正式写作」，不做假接线） |
| SkillRun | 一次生成中某技能的执行记录：status planned→running→completed/failed/degraded/skipped + evidence applied/not_applied + inputRefs/outputRefs/promptSection（只记 kind+tokens）+ 原因；「已开启」不等于「本次已执行」 |
| GenerationPlan | 模型调用之前冻结的生成计划：generationId（重试幂等锚点）/意图 hash/阶段路由结果/计划技能/候选产物引用/上下文预算 |
| GenerationManifest | 实际到达模型的精确载荷的脱敏清单（区段 kind+tokens、消息角色、实际应用的 SkillRun），复用 PayloadObservation 白名单纪律 |
| ArtifactRef | 产物引用：artifactId/kind/version/scope/provenance/tokenBudget/culled；必须可追溯来源与日期，裁剪不静默 |
| ContextAssembler | 唯一允许决定最终写作载荷的组件；执行器只产 artifact，不直接拼 prompt；归属验证 + token 预算裁剪 + 区段排序 |
| 五个默认角色 | 故事状态（写前上下文）/ 章节规划（写前计划）/ 读者与题材（写前市场约束，未绑定简报→skipped）/ 叙事声音（写前风格）/ 成稿质量门（写后校验）；AI 味预检是质量门的写后检查组，与叙事声音不同阶段 |
| MarketBrief | 扫榜快照聚合出的版本化市场产物（vN，source=ranking-snapshot+capturedAt），用户确认后绑定作品，供 audience_genre 按阶段读取；替代 T9 直拼 marketRef |
| BenchmarkPack | 拆解产物沉淀的方法包（vN，私有，保留来源与「仅作方法参考」边界，不含原作品正文），供章节规划/叙事声音消费；公共模板市场二期 |
| 本次创作链路 | 候选回复可展开的运行证据：使用/跳过技能、读取产物、输出、检查结果、用户覆盖动作；数据源 = GET /api/v1/runtime/generations/:generationId + done.skillRuns |

## V1.3 决策记录（2026-08-15，原型工作区 handoff + ADR-0002/0003）

1. 采用 A 版双栏写作台为产品工作台基线（桌面三栏 + 移动端折叠 + 底部导航 + 证据二级面板）；B/C 版仅作局部交互参考。
2. Skill 运行时契约已冻结于 `.scratch/mozhou-workbench-a/contracts/01-技能运行时契约.md`；变更必须 Contract Delta 并同步 schema/mock/实现/测试。
3. 默认开启 = 按创作阶段自动路由调用，不是每轮无条件注入全部技能资料。
4. 自由回答是一级入口；AI 先提问状态在任何模板选择之前可见；模板是次级入口。
5. 实现入口：`.scratch/mozhou-workbench-a/spec.md` + issues/01-08（运行时骨架+故事状态 → 章节规划 → 质量门 → 叙事声音 → MarketBrief → BenchmarkPack → A 版 UI → 回归部署）；仓库 ADR：docs/adr/0006-skill-runtime-and-workbench-a.md。

## 2026-08-16 任务运行时 grilling 决策（Q1-Q6 全部按推荐定案）

> 来源：五源炼化（DeterminFlow/ArcReel/inkos/oh-story/OpenWrite）+ 两份验收矩阵 + 机制考卷；spec 冻结于 `.scratch/mozhou-task-runtime/spec.md`（approved-frozen，变更须 Contract Delta）；ADR-0007；票：`.scratch/mozhou-task-runtime/issues/01-10`。

| # | 决策 | 结论 |
|---|---|---|
| Q1 | 任务状态词表 | job 与 step 共用枚举 planned→queued→running→waiting_retry→succeeded/failed/cancelled；attempt 独立枚举（queued/running/succeeded/failed/cancelled） |
| Q2 | 事件记录范围 | generation_events 表通用（scope/type/payload/client_key）；首版只写任务事件，业务事件 Phase 2 |
| Q3 | 成本账本形态 | 新建 usage_ledger（attempt 级 + cost_status）；usage_events 保持聚合源不动 |
| Q4 | 人工重试粒度 | step 级；首版仅「未产生结果」的 step 可重试（不重复扣费底线） |
| Q5 | 接入形态 | 选项 A：请求内执行 + 全持久化 + 事件补发 + 失败人工重试；lease/claim 实现并测试，不部署常驻 worker |
| Q6 | 锚点关系 | generationId 与 job_id 强制 1:1；SkillRun 挂 attempt |

术语（新增）：任务运行时（可恢复创作任务运行时）、generation_jobs/steps/attempts/events（四类持久化记录）、结局分类（succeeded/failed_recoverable/failed_terminal/state_degraded）、调用级成本账本（usage_ledger）、事件游标（seq/Last-Event-ID 续传）。

## 2026-08-17 Source-Class / Economics Gate 决策（T5-T6）

| 术语 | 定义 |
|---|---|
| Provider source class | 推理来源的不可跨越分类：`PUBLIC_FREE` 公益免费、`PLATFORM_PAID` 平台付费、`USER_BYOK` 用户自带凭据、`TEST_MOCK` 测试模拟；source class 不是 provider 名称，也不由全局网关 token 推断。 |
| Unified Provider Boundary | chat、chapter、distill、draw、deconstruct 进入模型前的统一 composition root；one-api 只能作为 Adapter，不能在业务路由内直接拼 endpoint/token。 |
| 同类 fallback | fallback 候选必须与 primary source class 相同；`PUBLIC_FREE` 没有同类候选时返回 `FREE_UNAVAILABLE`，不得静默切到付费或 BYOK。 |
| Authoritative usage ledger | 每次推理的 append-only 成本/来源证据，至少关联 request/task、source class、provider/model、credential owner、billing owner、tokens、cost、route、status；旧 `usage_events` 只服务产品 analytics。 |
| 生产 Mock 防火墙 | `NODE_ENV=production` 下任何 `*_PROVIDER=mock` 或 `TEST_MOCK` 配置均 hard fail，不启动 mock，也不自动切 one-api。 |

T5-T6 局部完成证据：76 个测试文件/452 个测试、tsc、Next production build 全绿；这证明 source/economics contract locally green，不等于真实公益 Provider 或 BYOK 已接入。Gate 3 之后仍需单独做真实公益模型 external acceptance，且先保持会员/支付后置。
