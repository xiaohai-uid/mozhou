# 墨舟（MoZhou）网页端 AI 自包含项目交接资料

> 这是一份给“无法访问本地电脑、仓库和 Obsidian Vault”的网页端 AI 使用的自包含上下文。阅读本文件即可理解项目的部署平台、项目边界、参考资料和当前主要问题。不要假设可以访问本文提到的本地路径。

配套执行文件：[墨舟 V1.2 写作上下文契约修复最终计划](./mozhu-writing-context-contract-repair-final-plan-2026-08-12.md)。交给执行 AI 时，建议两份文件同时提供。

审计日期：2026-08-12  
项目：墨舟（MoZhou）——中文网文 AI 小说写作平台  
当前产品版本：V1.2；生产发布记录：`v1.2.0-production-live`  
代码技术栈：Next.js 16 App Router + TypeScript + React + PostgreSQL + Drizzle ORM + one-api + SSE

## 1. 项目是什么

墨舟不是通用聊天机器人，而是面向中文网文作者的 AI 小说写作平台。它的核心任务包括：

- 创建作品、章节、人物库和世界观设定；
- 独立写作对话：起笔、续写、改写、剧情讨论、润色；
- 章节内 AI 对话：读取当前章节正文，生成候选文本并插入正文；
- 风格库：保存叙事视角、句式节奏、意象偏好、情绪节奏；
- Skill：把写作行为规则注入模型；
- RAG/设定检索：从人物库和世界观中选取相关条目；
- 小说拆解、风格蒸馏、联网搜索引用；
- 精确插入、选区替换、Undo/Redo、冲突保护；
- WebDAV 同步配置层和用量记录。

产品边界已经明确：当前优先修复写作对话链，不把向量检索、多智能体、跨设备会话、会员支付、深度书源解析、新编辑器、版本历史和插件市场作为本轮前置条件。

## 2. 当前部署平台总表

### 2.1 已确认的线上生产平台

| 层 | 平台/服务 | 当前用途 | 状态 |
|---|---|---|---|
| Web 应用 | Google Cloud Run | 运行墨舟 Next.js standalone Web 服务 | 已部署；服务名 `mozhou-web` |
| LLM 网关 | Google Cloud Run 上的 one-api | 接收墨舟的 OpenAI 兼容聊天请求，负责模型渠道、额度/渠道路由和 SSE | 已部署；服务名 `mozhou-one-api` |
| 主数据库 | Neon PostgreSQL | 存储墨舟用户、作品、章节、消息、风格、技能、设定、用量等 | 已部署；文档记录为 `neondb` |
| one-api 数据库 | Neon PostgreSQL 的独立数据库 | 存储 one-api 自身的用户、渠道、模型和网关数据 | 已部署；文档记录为 `oneapi` |
| 容器镜像 | Google Artifact Registry | 保存墨舟 Web 和 one-api 的 Docker 镜像 | 已使用 |
| 运行时密钥 | Google Secret Manager | 向 Cloud Run 注入数据库连接、认证密钥、one-api 令牌等 | 已使用；值不属于交接资料 |
| 上游模型渠道 | SenseNova/DeepSeek 渠道、智谱 GLM 渠道，经 one-api 接入 | 提供实际文本生成模型 | 生产记录显示真实调用通过，渠道配置可能随时间变化 |

生产部署区域记录为 Google Cloud `asia-northeast1`（东京）。Cloud Run 配置记录为 1 vCPU、1 GiB 内存、最小 0 实例、最大 2 实例、请求超时 300 秒。Web 服务在网络层允许公网访问，但业务 API 仍有登录、归属校验和错误门禁。

### 2.2 当前线上访问地址

生产记录中的墨舟 Web 地址：

`https://mozhou-web-7ecwvlclyq-an.a.run.app`

本次审计用 HTTP 请求验证到该地址返回 200，并识别到页面标题“墨舟 - AI 小说写作平台”。因此可以把它视为当前生产 Web 入口。

one-api 的 Cloud Run 服务存在，但其完整公网地址不是项目交接文档中的固定公开配置；墨舟 Web 通过运行时环境变量指向它。网页端 AI 不需要调用 one-api，只需要知道“墨舟 Web → one-api → 上游模型”这条链路。

### 2.3 生产版本和代码基线

- 生产代码修复基线记录为 commit `9b9138c`，修复了生产空数据库中的消息 ID 撞车问题；
- 生产部署记录随后落在 commit `4a1c18e`，对应 tag `v1.2.0-production-live`；
- 当前本地仓库 HEAD 是 `6a373e1`，主要是供外部 AI 阅读的数据包/文档提交，不应自动理解为已经重新部署到生产；
- 当前仓库没有配置 Git remote，未确认接入 GitHub/GitLab，也没有发现 CI/CD 自动部署配置；部署记录是手工 Docker/Cloud Run 流程。

### 2.4 线上依赖和未完成的平台

| 能力 | 外部平台 | 当前状态 |
|---|---|---|
| 联网搜索 | Bing 搜索回流 | 生产 smoke 记录显示真实回流通过；相关性仍受简化解析限制 |
| 云同步 | WebDAV | 只有配置层和未配置态；没有真实凭据，因此未完成生产验证 |
| 会员/支付 | 无当前生产平台 | 会员 UI 已降为占位/未开放，不是当前生产能力 |
| 书源解析 | 无当前生产平台 | 深度 HTML 解析明确推迟 |
| CI/CD | 无 | 未发现 GitHub Actions、Vercel、Cloudflare 或其他自动部署管线 |

## 3. 本地开发和测试平台

线上 Cloud Run 不是唯一运行方式，仓库保留了 Windows 本地开发方案。

### 3.1 Docker Compose 基础设施

本地 `docker-compose.yml` 编排：

- PostgreSQL 16 + pgvector 容器；宿主端口 5433；
- one-api 容器；宿主端口 3001；
- 可选的墨舟 Web 生产镜像容器；宿主端口 3000；
- 默认开发时推荐宿主机执行 `cd app && npm run dev`，访问 `http://localhost:3000`。

### 3.2 本地测试形态

仓库有三种测试层：

1. Vitest 单元/契约测试；
2. 本地 HTTP/SSE 测试，使用动态端口和测试 provider；
3. `next start` 生产构建、本地数据库和真实 one-api 的 smoke。

已有发布记录显示 V1.2 门禁达到 157/157，build 37/37，并完成真实 LLM/UI smoke。但本次审计发现：旧测试 provider 主要回显 system，不能证明最终 `messages` payload 语义正确。绿色测试结果应理解为路由、SSE、落库和 UI 链路通过，不应直接理解为上下文已经正确送达模型。

## 4. 线上请求链路

```text
浏览器
  -> Cloud Run: mozhou-web
  -> 墨舟 Next.js API
  -> 墨舟聊天/章节写作 service
  -> one-api（Cloud Run）
  -> SenseNova/DeepSeek 或 GLM 上游模型
  -> SSE delta 返回墨舟 Web
  -> 消息写入 Neon PostgreSQL
```

数据库分为两块：

- 墨舟主库：用户、会话、作品、章节、普通消息、章节消息、风格、技能、同步配置、用量和人物/世界观条目；
- one-api 独立库：网关自己的账号、渠道、模型、日志和令牌信息。

## 5. 当前最主要的问题

### P0-1：缺少写作助手身份基座

当前 `buildSystemPrompt` 只在有 RAG、风格、Skill 或摘要时组装“参考资料”类 system 文本；没有注入固定的小说写作助手身份。

结果：

- 独立对话无作品、无技能、无风格时，system 可能为空；
- 模型不知道自己是墨舟小说写作助手；
- 输入“你好”可能得到通用聊天机器人式问候；
- 这不是部署平台故障，是产品提示词基座缺失。

### P0-2：章节对话的用户消息没有进入模型请求

章节接口会接收并保存本轮用户输入，也会拼接当前正文末尾、选区、RAG、风格和技能；但当前 provider 构造时使用空 `messages` 数组。

因此“章节对话看起来会续写”不能证明模型收到了本轮用户问题。更准确地说，正文参考和技能 system 文本把模型推向了续写行为，但本轮用户输入本身存在没有送达模型的风险，代码静态审计已确认这一点。

### P0-3：独立对话压缩结果没有真正替换发送历史

压缩函数返回摘要和近期保留消息，但 service 只把摘要作为额外 system 注入，仍将原始完整 history 传给 provider。于是压缩标志可能为真，但 token 并没有按预期下降，`kept` 没有发挥发送边界作用。

### P1：测试没有观察最终模型 payload

Mock provider 不依赖 messages 生成输出，因此即使 messages 是空数组，很多测试仍会通过。下一步应增加能读取并断言 `system`、`role` 顺序、当前 user、历史数量和作品边界的测试 provider。

### P1：作品/会话/RAG 边界需要统一

独立会话、作品绑定、请求体中的 `novelId` 和 RAG 检索范围目前分散。未绑定作品时，RAG 可能在用户全部作品范围内检索。应先解析并验证真实作品归属，再组装上下文。

### P1：技能删除存在归属校验缺口

技能删除接口当前按技能 ID 删除，缺少同时限制当前用户的 owner 条件。这是明确的对象级授权问题，应单独修复。

### P2：长文记忆和检索能力不足

当前 RAG 是字符共现降级检索，章节正文主要取末尾约 3000 字，没有稳定的 Canon/章节摘要/人物关系编译层。它是真问题，但应在 P0 消除后再扩展 embedding、向量检索或多智能体。

## 6. 参考项目和参考资料

以下内容是本项目的参考来源，不是当前墨舟的部署平台。

### 6.1 OpenWrite：产品结构参照

OpenWrite 是外部小说写作产品的逆向研究对象，不是墨舟的后端或供应商。

从逆向资料提炼出的可借鉴结构：

- 有明确的创意小说写作助手身份提示；
- 会围绕当前作品读取人物库、世界观、章节摘要和近期章节；
- Skill 不只是文本卡片，而是触发条件、读取资料、生成边界和保存流程；
- 工具面包含文件读取/修改、项目创建、技能查询、外部搜索和受控写回；
- 有对话历史和上下文压缩；
- 服务端承担会员、额度和模型能力裁决。

不能直接照搬的部分：

- 逆向资料混合 v1.1.8、v1.2.6、v1.3.0、v1.3.2，不是同一版本；
- 动态分析和安全笔记是按日期记录的观察，不是永久当前状态；
- 终端命令、管理面和供应链风险不能原样引入墨舟。

### 6.2 LingBi：小说产品工程参照

LingBi 是本地优先的小说创作产品/研究线，曾作为墨舟章节写作 UI 和写作管线的参考。

可借鉴原则：

- 世界观/Canon 是一等上下文；
- 模型生成候选正文，用户确认后才原子写入；
- 写作循环是确定性的：读维护资料 → 组装上下文 → 生成 → 候选 → 确认 → 写入；
- Skill 应真正改变模型行为，而不是仅能安装；
- 关键写入必须 fail-closed，有 MutationProtocol 和审计边界；
- 必须验证真实 consumer 链路，不能以“接口存在”代表功能接线完成。

必须区分两条 LingBi 线：历史 Flutter/LingBi 产品线，以及 `lingbi-next`/Fusion 的 Rust/Tauri 本地书仓线。Fusion 的完成记录不能自动当作历史产品或墨舟当前实现。

### 6.3 零界道种：内容生产/漫剧参考项目

零界道种是独立的 AI 漫剧生产项目，不是当前墨舟 Web 的生产数据库。

当前可确认内容：

- 目标链路：想法 → 故事 → 分镜 → 图片/视频提示词 → Veo 生成；
- EP01《不存在的工单》包含 SH017-A、SH017-B、SH018、SH019-A、SH019-B、SH020 六段生产测试；
- v4 已从“靠提示词锁一致性”改为“CG 帧图 + 每镜起尾帧 + 上一镜尾帧连接下一镜起帧”；
- v4 Markdown 和 HTML 是同一版生产包的两种呈现；
- 当前 Vault 可定位到生产工作流和 EP01 v1–v4，但没有确认独立的长篇正文、剧本、人物设定、世界观设定或 ch1–4 文件；
- Inbox 里关于“ch1–4 完整”的摘要没有给出可验证正文路径，不能当作已找到的正文。

因此，网页端 AI 不能把零界道种直接当成墨舟数据库里的小说内容，也不能把 EP01 生产提示词当成长篇小说正文。

### 6.4 《星渊剑主》：长文测试语料

《星渊剑主》是 LingBi E2E 用的六章玄幻长文测试材料，不是零界道种，也不是当前墨舟生产用户的真实作品。

它可用来说明长篇系统需要区分：固定世界观、人物关系、章节摘要、当前章节正文、最近对话和本轮用户意图。它适合做上下文编译和连续性测试，不适合被当作产品资产来源。

### 6.5 DeterminFlow 和其他方法论

墨舟的 Agent 管线借鉴了 DeterminFlow 的“状态机、校验、重试和预算”理念，但代码没有直接依赖其实现。它是方法论参考，不是当前线上部署服务。

## 7. 给网页端 AI 的判断边界

请按下列事实处理本项目：

1. 墨舟已经有真实生产部署，平台是 Cloud Run + Neon，不是只存在于本地的 demo。
2. 当前生产 Web 地址是上文记录的 Cloud Run URL；本次 HTTP 探测返回 200。
3. 生产链路已证明 Web、数据库、one-api、SSE、插入和持久化曾经跑通，但这不代表写作上下文 payload 已经正确。
4. 当前最优先问题是身份基座、章节 user message、独立对话压缩和 payload 测试，不是新增平台或扩大产品功能。
5. OpenWrite 是产品结构参照，不是墨舟代码来源；LingBi 是小说产品工程参照；零界道种是独立漫剧内容生产项目；星渊剑主是测试语料。
6. Vercel、Cloudflare、Docker Compose 是部署方案/本地运行方案，其中 Vercel 和 Cloudflare 没有被确认是当前线上平台。
7. 任何计划都不能要求读取本地路径、Obsidian 或未提供的生产密钥；如果需要正文或设定，必须让用户显式提供文件或内容。

## 8. 推荐下一阶段顺序

### 第一阶段：证明模型到底收到了什么

- 给独立 chat 和章节 chat 增加统一的 payload 捕获 seam；
- 使用脱敏 marker，不记录完整正文和敏感配置；
- 增加能断言 messages 的测试 provider；
- 先让当前代码在章节 user message 为空、压缩 kept 未使用时明确失败。

### 第二阶段：修复三条 P0

- 所有写作对话始终注入固定身份基座；
- 章节对话把本轮用户输入作为 user message 发送；
- 独立对话真正发送压缩后的近期历史和本轮 user；
- 明确 system context 和 messages history 的分工。

### 第三阶段：统一上下文和权限

- 统一 BaseIdentity、ModeContract、Canon/RAG、正文参考、Style、Skill、Summary、History、CurrentUser 的组装顺序；
- 统一 session/novel/chapter owner 解析；
- 修复技能删除 owner 条件；
- 统一所有 LLM 路径的服务端额度裁决。

### 第四阶段：再考虑长文能力

- 章节摘要和 Canon 编译；
- 人物关系和世界线；
- embedding/向量检索；
- 工具调用和受控文件写回。

## 9. 可直接复制给网页 AI 的一句话

> 这是一个已经部署在 Google Cloud Run + Neon PostgreSQL 上的中文网文 AI 写作平台墨舟（MoZhou），Cloud Run 上有墨舟 Web 和 one-api 两个服务，Artifact Registry 保存镜像，Secret Manager 注入运行时配置。当前不是部署平台故障，而是写作上下文链问题：缺少固定写作助手身份基座，章节对话的用户消息没有进入模型请求，独立对话压缩结果没有替换实际发送历史。请先设计脱敏 payload 观察和消息契约测试，再修复三条 P0；OpenWrite 只作为身份/Skill/工具/项目上下文的产品参照，LingBi 只作为 Canon/候选正文/原子写入的工程参照，零界道种是独立漫剧项目，星渊剑主是长文 E2E 测试语料。不要先扩展向量检索、多智能体、跨设备、会员或插件体系。

## 10. 本地证据索引（仅供拥有本地仓库的人）

网页端 AI 不应依赖这些路径；它们只是本地审计来源：

- 生产平台和部署事实：`C:\zcode\novel-ai\docs\release-report-v1.2.md`、`docs\production-deployment.md`；
- 项目数据包：`C:\zcode\novel-ai\docs\project-data-package-v1.3.md`；
- 全资料交叉审计：`C:\zcode\novel-ai\docs\mozhu-full-materials-audit-report-2026-08-12.md`；
- OpenWrite 逆向资料：Obsidian `20_Knowledge` 下以 `OpenWrite` 开头的资料；
- LingBi 资料：Obsidian `10_Projects\LingBi.md` 和 `20_Knowledge\AI` 下的灵笔/Fusion/MutationProtocol 文档；
- 零界道种资料：Obsidian `10_Projects\零界道种.md` 和 `20_AI漫剧\零界道种` 目录；
- 墨舟项目记录：Obsidian `10_Projects\墨舟.md`。
