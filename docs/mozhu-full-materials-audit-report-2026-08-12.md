# 墨舟与相关小说项目全资料交叉审计报告

日期：2026-08-12  
目的：在交给更强模型制定下一阶段计划前，对墨舟代码、仓库文档、Obsidian Vault 中的小说项目、OpenWrite 逆向资料、灵笔资料和零界道种资料做一次只读交叉审计。  
本报告不修改业务代码，不把历史记录、产品设想或逆向推断冒充当前运行事实。

给无法访问本地环境的网页端 AI 使用的自包含版本见：[墨舟网页端 AI 项目交接资料](./mozhu-web-ai-handoff-context-2026-08-12.md)。

基于本审计收敛出的执行方案见：[墨舟 V1.2 写作上下文契约修复最终计划](./mozhu-writing-context-contract-repair-final-plan-2026-08-12.md)。

## 0. 结论先行

### 0.1 原始诊断成立，但还不完整

原数据包关于“独立写作对话没有写作助手身份基座”的判断是正确的：

- `buildSystemPrompt([])` 返回空字符串；
- 有 RAG、风格或技能时，system 只包含参考资料/风格/技能文本；
- 没有任何固定的“你是小说写作助手”身份、工作模式和输出边界；
- 独立对话无作品、无风格、无技能时，模型收到的 system 消息为空，退化成通用聊天机器人是预期结果，而不是部署故障。

证据：[`app/lib/chat/stream-provider.ts`](../app/lib/chat/stream-provider.ts) 第 9–16 行；[`docs/project-data-package-v1.3.md`](./project-data-package-v1.3.md) 第 9–39、88–125 行；Vault 中的[墨舟系统消息核验](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/AI/墨舟系统消息核验.md>)和[墨舟写作对话链审计结论](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/AI/墨舟写作对话链审计结论（2026-08-12）.md>)。

### 0.2 本次审计发现两个更严重的 P0

#### P0-A：章节对话的用户消息没有进入模型请求

章节路由会校验并把用户消息写进 `chapter_messages`，也会把正文末尾、选区、RAG、风格和技能拼成 system 注入；但实际创建 provider 时传入的是空数组：

```ts
makeChatProvider(input.model, [], buildSystemPrompt([...ragLines, ...extra]))
```

见 [`app/lib/novels/chapter-chat.ts`](../app/lib/novels/chapter-chat.ts) 第 116–124、126–173 行。

因此，章节对话“带技能时会续写正文”的现象，不能被解释为“模型正确收到了用户问题、当前章节和完整历史”。更准确的解释是：system 中的正文参考和技能文本足以把模型推向续写行为，而本轮用户输入本身没有被发送给模型。这是比“技能文案缺少身份提示”更基础的消息链断裂。

#### P0-B：独立对话的压缩结果没有真正替换历史

`compressHistory()` 返回 `{ summary, kept }`，其中 `kept` 是应发送的近期历史；但 `chat/service.ts` 只读取 `summary`，最终仍把原始 `history` 全量传给 provider：

```ts
const r = await compressHistory(history);
summary = r.summary;
...
makeChatProvider(input.model, history ?? [], ...)
```

见 [`app/lib/chat/service.ts`](../app/lib/chat/service.ts) 第 139–187 行和 [`app/lib/chat/compress.ts`](../app/lib/chat/compress.ts) 第 38–89 行。

所以当前“压缩已实现”的含义最多是“把摘要额外注入 system”，并不等于“早期消息被摘要、近期消息被保留、发送 token 被减少”。

### 0.3 发布报告没有与上述结论冲突，只是验证层级不同

V1.1/V1.2 发布材料证明了以下事实：登录、作品/章节、SSE、消息落库、刷新、插入、Undo/Redo、生产构建和生产部署链路曾经跑通；V1.2 还记录了真实 LLM smoke 和公网实例状态。

但这些 smoke 没有在模型请求边界捕获并断言最终 `messages` payload。尤其是 V1.1 hardening 的真实模型 smoke 证明了“请求能发出、SSE 能回来、内容能落库”，不能单独证明“当前用户消息、压缩后的历史和章节历史被正确发送”。因此：

> 传输链路通过 ≠ 上下文语义通过。

这解释了为什么旧发布报告可以是绿色的，而本次静态审计仍能发现 P0-A/P0-B。

### 0.4 给强模型的正确问题定义

下一阶段不应只计划“给 `buildSystemPrompt` 加一句身份提示”。完整问题应定义为：

> 墨舟需要建立一个对独立写作对话和章节写作对话都生效的写作模式基座，并保证“本轮用户输入、合适的会话历史/章节上下文、身份与约束、风格和技能”在最终模型 payload 中可观察、可测试、可回归；当前两条链路在身份、消息历史、压缩和测试 seam 上均存在断裂或误判。

## 1. 审计范围与证据等级

### 1.1 本轮实际读取的范围

#### A. 墨舟仓库

仓库：`C:\zcode\novel-ai`。

- `docs/project-data-package-v1.3.md`
- `docs/release-report-v1.0.md`
- `docs/release-report-v1.1.md`
- `docs/release-report-v1.2.md`
- `docs/release-hardening-v1.1.md`
- `docs/deployment.md`
- `docs/production-deployment.md`
- `docs/spikes/pipeline-engine.md`
- `docs/spikes/novel-project-ui.md`
- `docs/agents/domain.md`
- 主要源代码：`app/lib/chat/stream-provider.ts`、`app/lib/chat/service.ts`、`app/lib/chat/compress.ts`、`app/lib/novels/chapter-chat.ts`、章节 chat route、RAG、skills route、session/chat route、schema、迁移和测试。

仓库文档共 13 篇 Markdown，均已纳入盘点；工程 agent 文档只描述 CONTEXT/ADR/工单规则，不包含小说事实，因此只做范围确认，不作为产品证据。

#### B. Obsidian 中的 OpenWrite 逆向资料

已阅读并交叉比对：

- [OpenWrite v1.3.2 Windows 客户端逆向](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/AI/OpenWrite v1.3.2 Windows 客户端逆向（2026-08-09）.md>)
- [OpenWrite v1.3.2 动态分析](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/AI/OpenWrite v1.3.2 动态分析（2026-08-09）.md>)
- [OpenWrite v1.3.2 会员功能离线破解验证](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/AI/OpenWrite v1.3.2 会员功能离线破解验证（2026-08-09）.md>)
- [OpenWrite 复现实战 v1.1.8→v1.3.2 安全态势漂移](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/AI/OpenWrite 复现实战 v1.1.8→v1.3.2 安全态势漂移.md>)
- [OpenWrite 官网更新侦察](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/AI/OpenWrite 官网更新侦察（2026-08-09）.md>)
- [OpenWrite 完整产品逆向资产](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/OpenWrite完整产品逆向资产.md>)
- [OpenWrite 黑客无痕提取完整数据包](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/OpenWrite黑客无痕提取完整数据包.md>)
- [OpenWrite 红队突击安全审计](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/OpenWrite红队突击安全审计.md>)
- [OpenWrite 红队实战发现与全链路防护方案](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/OpenWrite红队实战发现与全链路防护方案.md>)
- [OpenWrite 官网与定价完整数据](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/OpenWrite官网与定价完整数据.md>)
- [OpenWrite 竞品分析](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/OpenWrite 竞品分析.md>)
- [MOC-OpenWrite](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/MOC-OpenWrite.md>)

安全审计材料中包含公开服务、会员门控、命令执行、管理面和供应链风险等敏感细节。本报告只保留产品架构和防护层面的结论，不复制凭据、令牌、地址、可直接利用的端点或攻击步骤。

#### C. Obsidian 中的小说/写作项目

实际命中的小说相关项目有三组：墨舟、LingBi、零界道种；另有一份“星渊剑主”作为 LingBi 的长文 E2E 测试语料，而不是独立产品项目。

##### 零界道种

- [项目记录](<C:/Users/a1691/Documents/Obsidian Vault/10_Projects/零界道种.md>)
- [想法到提示词工作流](<C:/Users/a1691/Documents/Obsidian Vault/20_AI漫剧/零界道种/工作流_想法到提示词_Veo31.md>)
- EP01 原始拼接测试包 v1
- EP01 生产指令 v2
- EP01 生产指令 v3
- EP01 生产指令 v4
- EP01 生产指令 v3 HTML
- EP01 生产指令 v4 HTML

实际目录没有找到独立的《剧本》、人物设定、世界观设定或 ch1–4 正文文件。Inbox 中“ch1–4 完整”的迁移摘要不能替代可定位的正文文件，因此本报告不把它当作已存在的小说正文。

##### LingBi

已阅读项目记录、PRD、架构、技术设计、模块说明 v1/v2、API 契约、改进 spec、文档交叉审查、spec 交叉审查、P0/T1 门禁、v0.5 产品方向决策，以及 Fusion P0–P15、MutationProtocol、Skill、WebDAV、Agent、发布门禁和 E2E 相关材料。

重点文件包括：

- [LingBi 项目记录](<C:/Users/a1691/Documents/Obsidian Vault/10_Projects/LingBi.md>)
- [灵笔 PRD](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/AI/灵笔PRD产品需求文档.md>)
- [灵笔架构文档](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/AI/灵笔架构文档.md>)
- [灵笔技术设计文档](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/AI/灵笔技术设计文档.md>)
- [灵笔完整模块说明文档 v2](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/AI/灵笔完整模块说明文档v2.md>)
- [灵笔 API 接口文档](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/AI/灵笔API接口文档.md>)
- [灵笔文档交叉审查报告](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/AI/灵笔文档交叉审查报告.md>)
- [灵笔 spec 交叉审查报告](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/AI/灵笔spec交叉审查报告.md>)
- [灵笔 v0.5 产品方向决策](<C:/Users/a1691/Documents/Obsidian Vault/00_Command/AI/Decisions/灵笔 v0.5 产品方向决策.md>)
- [LingBi Fusion P12 真实书仓产品级验收](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/AI/LingBi Fusion P12 真实书仓产品级验收完成 (2026-08-08).md>)
- [灵笔 E2E 测试：星渊剑主](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/AI/灵笔E2E测试-星渊剑主.md>)

##### 墨舟

- [墨舟项目记录](<C:/Users/a1691/Documents/Obsidian Vault/10_Projects/墨舟.md>)
- [墨舟写作对话链审计结论](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/AI/墨舟写作对话链审计结论（2026-08-12）.md>)
- [墨舟章节消息链核验](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/AI/墨舟章节消息链核验.md>)
- [墨舟系统消息核验](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/AI/墨舟系统消息核验.md>)
- [墨舟测试边界核验](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/AI/墨舟测试边界核验.md>)
- [墨舟模型请求回归建议](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/AI/墨舟模型请求回归建议.md>)
- [墨舟审计结论](<C:/Users/a1691/Documents/Obsidian Vault/20_Knowledge/AI/墨舟审计结论.md>)
- 2026-08-09 至 2026-08-11 的项目决策和 AI 日志

### 1.2 证据等级

| 等级 | 含义 | 本报告如何使用 |
|---|---|---|
| A | 当前仓库源码、当前测试、当前 schema/迁移 | 用于确认当前实现事实 |
| B | 发布报告、部署 runbook、已记录的真实 smoke | 用于确认曾经验证过的链路；不自动证明所有 payload 语义 |
| C | Vault 中的逆向笔记、动态分析、竞品观察 | 用于产品参照和历史事实；按日期和版本解释 |
| D | 产品决策、Inbox 摘要、未来 spec | 用于意图、边界和计划，不当作当前实现 |

### 1.3 这次没有做的事情

- 没有修改墨舟业务代码。
- 没有重跑公网生产请求；生产复现结论来自既有记录和源码交叉验证。本轮没有把“重新生产复现”冒充成新执行结果。
- 没有使用 OpenWrite 的敏感材料去访问第三方服务。
- 没有把 LingBi 的历史 Flutter 线、LingBi Next/Fusion 线和墨舟 Next.js 线混成同一个当前运行系统。

## 2. OpenWrite 逆向资料给出的产品真相

### 2.1 OpenWrite 的核心不是“一个聊天框”，而是创作工作台

逆向资料共同指向一个结构：

```text
写作身份基座
  + 当前作品上下文
  + 人物库 / 世界观 / 章节摘要 / 近期章节
  + Skill（逐级加载）
  + 工具面（文件、项目、检索、终端、排行等）
  + 对话历史与压缩
  -> 面向长篇创作的模型请求
```

其中最关键的不是 UI 功能数量，而是“模型始终被放在小说创作任务里”。逆向笔记提取到的身份提示核心含义是：模型是创意小说写作助手，要保持现有故事、角色和世界设定一致。该身份提示与当前墨舟的空 system 差异，直接解释了两者在无资料场景下的行为差异。

### 2.2 OpenWrite 的 Skill 是行为入口，不只是装饰文本

内置小说写作 Skill 的工作流包含：

1. 触发在创作意图、续写、初始化项目等场景；
2. 读取人物库、世界观、章节摘要和近期章节；
3. 生成正文，并有明确的长度与输出边界；
4. 先展示结果，再由用户确认保存或更新项目文件。

资料还记录了 Skill 的渐进式加载：元数据 → `SKILL.md` → references/assets。这种设计的价值是把“何时触发、要读取哪些资料、最终如何落盘”绑定成一个可复现的行为协议，而不是只把一句“请续写”拼进 system。

### 2.3 OpenWrite 的工具面带来三项可借鉴能力

逆向资料中出现的工具类别可抽象为：

- 读取/修改/写入作品文件；
- 创建和管理小说项目；
- 查询技能与创作资源；
- 检索外部资料与榜单；
- 执行系统命令或自动化任务。

对墨舟有价值的不是照搬全部工具，而是认识到：长篇写作助手需要“上下文读取”和“受控写回”能力。工具必须带权限、来源、确认和审计边界；尤其不能把高风险命令执行面原样复制到生产产品。

### 2.4 OpenWrite 资料中哪些结论不能直接当当前事实

- v1.2.6、v1.3.0、v1.3.2 资料混存，功能和混淆状态不能跨版本合并。
- 2026-07-29 的服务不可达与 2026-08-09 的恢复是时间状态差异，不是矛盾事实。
- 动态分析、会员门控和红队笔记是当时授权观察结果，不代表今天的服务端状态。
- “完整逆向资产”“无痕提取”等标题是资料作者的工作标签，不代表每一条推断都已由独立实验复现。
- 安全笔记里涉及敏感攻击面，本报告只采用防护和架构层结论。

## 3. Vault 中小说项目的逐项目审计

### 3.1 零界道种：当前更像“漫剧生产实验项目”，不是已归档长篇小说仓库

### 项目目标

零界道种的工作流是“想法 → 故事 → 分镜 → 图片/视频提示词 → Veo 生成”。工作流文档把角色、镜头、声音、构图列为四类锁；项目记录把 EP01《不存在的工单》作为当前执行包，把 EP02 作为下一阶段。

### EP01 版本演进的真实价值

EP01 v1–v4 不是四份并行真相，而是同一段 SH017–SH020 测试包的失败经验迭代：

| 版本 | 主要方法 | 当前解释 |
|---|---|---|
| v1 | 初始首尾帧拼接/角色与场景约束 | 历史方案 |
| v2 | Flow + Nano Banana 2 + Veo Lite/Fast | 历史方案 |
| v3 | Flow 全流程、五段式提示词、SceneBuilder 关键帧 | 历史方案 |
| v4 | 放弃“提示词锁外观”，改为 CG 帧图 + 每镜起尾帧 + 帧链 | 当前方案 |

v4 的关键经验是工程性的：提示词不能可靠锁死设备外观或人物一致性，首尾帧和上一镜尾帧到下一镜起帧的资产链才是更强的约束。v4 要先生成 CG-01～CG-05，再执行 SH017-A、SH017-B、SH018、SH019-A、SH019-B、SH020；当前清单仍是待执行状态。

v4 Markdown 与 v4 HTML 都包含相同的 CG-01～05、SH017–SH020 帧链和 QA 要求，HTML 是交付呈现副本，不是新的版本事实。

### 重要缺口

实际 Vault 目录只找到工作流、EP01 v1/v2/v3/v4 和两个 HTML 交付副本，没有找到：

- 独立剧本正文；
- 人物设定文件；
- 世界观设定文件；
- 章节正文；
- 可验证的 ch1–4 文件。

Inbox 迁移摘要声称“零界道种 ch1–4 完整”，但没有给出对应文件路径。因此，强模型若要规划“小说上下文接入”，必须先把“零界道种的实际正文仓库在哪里”作为待确认输入，不能直接假设 Vault 目录已经包含长篇正文。

### 3.2 LingBi：长篇小说产品理念的主要来源，但资料存在实现成熟度漂移

### 产品理念

灵笔的稳定产品方向是“世界观驱动的 AI 创作”：

- Canon/世界观是核心上下文来源；
- AI 生成候选文本，用户确认后才原子写入；
- 写作循环是确定性的：读取维护资料 → 组装上下文 → 生成 → 候选 → 确认 → 写入；
- 目标用户是长篇网文作者，而不是通用聊天用户；
- Skill 用来改变写作行为，而不只是作为市场卡片存在。

这些原则比某个具体 UI 更值得墨舟吸收，尤其是“候选文本”和“用户确认后原子写入”的边界。

### 两条 LingBi 线必须分开

Vault 同时记录了：

1. 历史 Flutter/LingBi 产品线；
2. `lingbi-next`/Fusion 的 Rust/Tauri 本地书仓线。

Fusion P0–P14 的“完成”不能自动回写成历史 Flutter 产品的当前运行事实。报告中涉及真实书仓、迁移、Windows consumer E2E、发布门禁时，指的是 Fusion 线；涉及 PRD、旧 ServiceLocator、WebDAV 空同步、旧 Agent/Skill 时，指的是历史产品资料。

### 灵笔资料暴露的长期工程教训

交叉审查和实现记录反复出现以下问题：

- 文档把“接口存在”写成“功能可用”；
- 配置能保存，但没有贯通到真正消费者；
- Skill 市场能安装，但 Markdown Skill 尚未真正改变模型行为；
- Agent、WebDAV、导出、恢复等功能在不同文档中成熟度不一致；
- 本地写入安全性最终需要 fail-closed、MutationProtocol、候选确认和审计，而不是相信 UI 禁止按钮。

这正好对应墨舟当前的测试问题：绿色测试如果没有观察到真实 provider payload，只能证明某个 seam 被调用，不能证明模型收到正确语义。

### 3.3 星渊剑主：六章完整长文 E2E 语料，不是零界道种正文

《星渊剑主》是灵笔 E2E 用的完整六章玄幻小说测试素材：

- 主角：叶尘；
- 世界：星渊大陆；
- 核心设定：星力、星渊剑、星渊大帝血脉；
- 主线：废材 → 觉醒 → 家族冲突 → 宗门试炼 → 暗流 → 后续大战；
- 用途：验证人物、世界观、章节、上下文和长文写作链，而不是作为用户真实作品档案。

它对墨舟的价值是测试数据模型和上下文编译器：一个长文系统至少要能区分固定设定、人物关系、当前章节、章节摘要、最近正文和本轮用户意图。它不能被当作零界道种的“缺失正文”来补全。

### 3.4 墨舟：当前实现与产品边界

墨舟当前产品边界是面向中文网文作者的写作工具，核心能力包括作品/章节、独立写作对话、章节级写作对话、风格、技能、RAG 设定、websearch 回流、WebDAV 接口、精确插入和 Undo/Redo。最新项目决策明确：先审计和修复独立/章节对话链，不扩大到向量检索、多智能体、跨设备或会员体系。

这条边界很重要：当前最优先的不是新增更多工具，而是把已有“写作对话”真正变成一个可靠的写作系统。

## 4. 墨舟当前代码真相

### 4.1 独立写作对话链

当前链路大致是：

```text
POST /api/v1/chat
  -> 校验登录/会话
  -> 写入本轮 user message
  -> 读历史
  -> 可能生成 summary
  -> RAG / style / skill 拼接 extra
  -> buildSystemPrompt
  -> provider(messages = history, systemPrompt)
  -> SSE
  -> assistant message 落库
```

实际问题：

1. `buildSystemPrompt` 无注入返回空；
2. identity、创作模式、默认输出行为完全缺失；
3. `session.novelId` 不是可靠的作品上下文边界，当前请求可携带 `novelId`，需要继续核对会话绑定与作品归属；
4. 压缩摘要额外进入 system，但 `kept` 没有替换 history；
5. 用量有记录，但配额门禁不是所有写作路径统一执行；
6. 测试 mock 主要回显 system，不观察 provider 发送的 messages 语义。

### 4.2 章节写作对话链

当前链路大致是：

```text
POST /api/v1/novels/:id/chapters/chat
  -> 校验作品/章节/selection
  -> user chapter_message 落库
  -> 正文末 3000 字 + selection + RAG + style + skill
  -> buildSystemPrompt
  -> provider(messages = [])
  -> SSE
  -> assistant chapter_message 落库
```

这是当前最关键的结构性缺陷：

- `input.content` 被存储，却没有变成 provider 的 user message；
- 章节对话没有传入章节消息历史；
- `snapshot` 用于插入冲突检测，不等于它进入模型上下文；
- 末尾 3000 字、技能和正文参考能让输出看起来像续写，但不能证明模型知道本轮用户到底问了什么；
- scene skill 是“续写指令”，不是身份基座。

### 4.3 RAG 当前不是向量检索，而是字符共现降级检索

`app/lib/novels/rag.ts` 的当前实现：

- 默认 topK=5；
- 先按用户/作品取人物与世界观条目；
- 根据 query 字符共现评分；
- 无共现则返回空；
- 绑定作品时检查作品归属和 `ragEnabled`；
- `novelId=null` 时会在用户全部作品范围内检索。

这不是当前 P0。它会影响长文一致性，但在身份基座、用户消息和历史未进入 payload 之前，扩展 embedding、向量库或多智能体都会放大复杂度而无法解决主链断裂。

### 4.4 其他已确认风险

#### P1：技能删除缺少用户归属条件

[`app/app/api/v1/skills/route.ts`](../app/app/api/v1/skills/route.ts) 第 83–93 行的 DELETE 只按技能 ID 删除，没有同时限制 `userId`。这是明确的对象级授权缺陷，应与写作链修复分票处理。

#### P1：作品/会话边界需要重新证明

独立会话保存了 `novelId`，但绑定关系、创建会话时作品归属和请求中再次传入的 `novelId` 之间存在语义分散。需要在模型上下文和 RAG 之前统一做 owner/binding 解析，避免“显示绑定了 A，实际检索了 B 或用户全部作品”。

#### P1：配额与成本控制未形成统一门禁

代码存在用量事件记录和部分配额逻辑，但并非独立聊天、章节对话、蒸馏、拆解等所有 LLM 路径都以同一门禁裁决。数据包中“无 quota”表述过于绝对，应修正为“存在记录/部分门禁，未形成全路径一致的服务端裁决”。

#### P2：检索质量和长文记忆不足

- 字符共现不是语义检索；
- 章节正文只取末尾约 3000 字；
- 没有稳定的章节摘要/Canon/人物关系编译层；
- 作品未绑定时 RAG 范围过宽。

这些是真问题，但必须在 P0 消除后再处理。

## 5. 测试和发布证据的重新解释

### 5.1 绿色测试实际证明了什么

仓库已记录：

- V1.0/V1.1/V1.2 多轮测试通过；
- 最新门禁为 157/157；
- build 37/37；
- 真实 LLM/UI smoke、SSE、持久化、精确插入、Undo/Redo 曾经通过；
- 生产实例曾完成注册、登录、作品、章节、消息、插入等链路 smoke。

这些结果证明系统的路由、数据库、SSE、前端交互和候选落库链路有较强基础，不应把项目判断成“完全没跑通”。

### 5.2 绿色测试没有证明什么

当前 mock provider 的行为是回显 system 和固定文本；它不根据 `messages` 生成，因此无法发现：

- provider 的 `messages` 是否为空；
- 本轮 user 是否存在；
- 章节历史是否存在；
- 压缩后的 `kept` 是否被使用；
- system 与 user message 的顺序是否正确；
- 作品边界是否混入其他作品。

因此需要新增“红能力 provider”：它必须读取并断言收到的 messages，而不是只回显 system。

### 5.3 生产 smoke 需要补 payload 级回归

生产环境只能保留脱敏后的观测：

- system 是否存在以及 section 名称；
- messages 的 role 序列；
- user message 是否等于本轮输入；
- history 数量、压缩标记、作品/章节 ID；
- prompt token、completion token；
- 不记录完整正文、令牌和敏感设定。

最小真实回归不需要把生产正文打进日志，只要在 one-api/mock gateway 边界记录哈希、角色序列和测试 marker 即可。

## 6. 文档之间的矛盾、遗漏和状态漂移

### 6.1 墨舟发布报告 vs 写作链审计

- 发布报告：真实模型、SSE、落库、插入通过；
- 写作链审计：章节当前消息未进模型，测试 mock 不观察 messages。

解释：两份资料验证的层级不同。发布报告是传输/交互/存储验收，写作链审计是 payload/语义验收。后者应作为当前问题的更高优先级证据。

### 6.2 数据包对章节链的描述过于乐观

数据包把章节历史描述成可用于对话的链路，但当前 `chapter-chat.ts` 明确使用空 messages。报告应修正为：章节消息可持久化、可用于插入和审计，但尚未证明可达模型请求。

### 6.3 LingBi 文档把“有模块”与“模块已接线”混在一起

灵笔文档交叉审查已经指出 PRD、模块文档和架构文档在 Agent、WebDAV、Skill、恢复等成熟度上不一致。强模型引用 LingBi 时必须按版本和分支分层，不得拿设计文档当验收证据。

### 6.4 零界道种项目记录与实际目录不完全一致

项目记录/Inbox 说有 ch1–4、剧本和资产规划，但当前 `20_AI漫剧/零界道种` 目录只确认了生产工作流和 EP01 版本包。这个缺口要先确认来源：正文可能在别的仓库、别的 Vault 区域或未同步位置。

### 6.5 OpenWrite 资料跨版本、跨日期

逆向资料有 v1.1.8、v1.2.6、v1.3.0、v1.3.2，服务器状态也跨 2026-07-29 和 2026-08-09。它适合提取设计模式和安全教训，不适合直接作为当前接口契约。

## 7. 建议强模型采用的优先级

本节不是直接实施计划，而是给下一模型的事实边界和排序依据。

### P0-1：先建立 payload 可观察性和行为契约

在任何 prompt 重构前，先有一个测试 provider 能断言：

```text
system: [base identity, mode, context, style, skills, summary]
messages: [compressed history..., current user]
```

需要覆盖独立对话和章节对话两条链；测试必须失败于当前代码，再在修复后通过。

### P0-2：统一写作身份基座

基座至少包含：

- 你是墨舟的中文小说写作助手；
- 默认服务对象是网文作者；
- 支持续写、改写、起笔、剧情讨论、人物/世界观整理、润色；
- 无关请求应温和引导回创作；
- 写作任务必须遵守当前作品上下文、风格、技能和输出模式；
- 不把参考资料、内部规则和工具细节泄露给用户。

身份基座应独立于 RAG/风格/技能，不能让“有没有资料”决定模型是否知道自己在做什么。

### P0-3：修复消息语义

- 独立对话：发送压缩后的历史和本轮 user，不能重复或遗漏本轮输入；
- 章节对话：发送本轮 user；按产品意图决定是否发送章节对话历史，不能以“已落库”代替“已送模型”；
- system 中的正文参考与 messages 中的对话历史要分工明确；
- 生成用 snapshot 与上下文用 body/context 不要混成同一概念。

### P0-4：修复压缩实际发送逻辑

把 `kept` 真正作为 provider history；summary 作为有明确 section 名称的 system/context；增加 token/消息数断言，防止“compressed=true 但 payload 还是全历史”。

### P1：统一 Context Assembly

建议形成一个纯函数/可测结构：

```text
BaseIdentity
  -> ModeContract
  -> Canon/RAG/正文参考
  -> Style
  -> Skills
  -> Summary
  -> MessageHistory
  -> CurrentUser
```

每个 section 要有来源、优先级、字符/token 预算和是否进入 system/messages 的明确契约。不要继续在两个 service 里各自拼接字符串。

### P1：统一作品和权限边界

- 从已归属的 session/novel/chapter 解析上下文；
- 不信任请求体中的 `novelId` 作为唯一绑定事实；
- RAG 只能在解析后的作品范围内运行；
- 修复技能 DELETE 的 owner 条件；
- 对所有产生 LLM 调用的路径统一服务端配额裁决。

### P2：再做长文能力

只有 P0/P1 通过后，才考虑：

- Canon/章节摘要/人物关系编译；
- embedding 或更强检索；
- 长文压缩与分层记忆；
- 多技能编排；
- 工具调用和受控文件写回。

当前不要把多智能体、向量检索、跨设备、会员和插件市场作为本次修复的前置条件。

## 8. 强模型必须采用的验收标准

### 8.1 独立对话

| 场景 | 必须观察到的 payload | 必须观察到的行为 |
|---|---|---|
| 无作品、无技能、输入“你好” | 非空 base identity；当前 user 存在 | 礼貌但回到写作助手定位，不退化成泛聊天 |
| 无作品、输入“写一个开头” | base identity + current user | 输出创作正文或先澄清必要信息 |
| 绑定作品、输入角色名 | 作品边界内 RAG + current user | 不混入其他作品设定 |
| 超过压缩阈值 | summary + kept history + current user | 发送量下降，行为保持连续 |

### 8.2 章节对话

| 场景 | 必须观察到的 payload | 必须观察到的行为 |
|---|---|---|
| 章节输入“续写下一段” | `[正文参考]` + user message | 真正续写当前章节 |
| 章节输入“把这段改得更冷峻” | selection/body reference + user message | 按用户要求改写，不只盲目续写 |
| 带 scene skill 输入“你好” | base identity + mode/skill + user message | 行为由明确模式决定，不能靠 skill 偶然触发 |
| 多轮章节对话 | 产品指定的 chapter history + current user | 后一轮能引用前一轮，且无跨章节污染 |

### 8.3 回归与安全

- 测试 provider 能读取并断言 messages；
- one-api 边界有脱敏 payload 观测；
- 生产日志不写完整正文、token 或 secrets；
- 作品、章节、会话、技能、RAG 都有 owner/binding 断言；
- `force`/插入逻辑不得绕过权限和 target 校验；
- 157/157 旧回归继续通过，同时新增 payload 契约测试通过；
- 真实模型 smoke 至少覆盖独立 chat 和章节 chat 各一条，不只覆盖插入 UI。

## 9. 最终判断

### 产品判断

这是产品行为缺口和消息链缺陷，不是单纯部署故障。

### 代码判断

当前最主要的三个缺陷按顺序是：

1. 无条件的写作助手身份基座缺失；
2. 章节对话用户消息没有发送给模型；
3. 独立对话压缩结果没有替换实际发送历史。

### 资料判断

- OpenWrite 逆向资料证明“身份 + 作品上下文 + Skill/工具 + 受控写回”是成熟写作产品的结构性能力；
- LingBi 资料证明“Canon、候选文本、确认后原子写入、fail-closed 和真实 consumer E2E”比功能清单更重要；
- 零界道种证明创作生产链需要把版本、资产和当前执行包分开管理，但当前 Vault 没有可定位的长篇正文；
- 星渊剑主是有价值的长文测试语料，不是零界道种正文；
- 墨舟已有较强的 UI、持久化、SSE 和插入基础，但上下文语义链仍未达到“可证明正确”。

### 交给强模型时应附带的最短摘要

> 请基于本报告制定墨舟下一阶段计划。不要只修 `buildSystemPrompt` 文案。先为独立对话和章节对话建立可断言的模型 payload seam；修复章节 user message 未发送、独立对话压缩结果未实际替换历史，再统一身份基座和 Context Assembly；保持现有 Journey 边界，不先扩展向量检索、多智能体、跨设备或会员。OpenWrite 只作为产品结构参照，LingBi 只按版本/分支和真实 E2E 证据引用，零界道种正文缺失必须先确认来源。

## 10. 本轮验证记录

- Git 工作区在本轮业务审计前保持干净，未修改业务代码。
- 当前 HEAD 为已记录的数据包提交，报告是新增的研究文档。
- 既有发布记录：157/157 测试、build 37/37、真实 LLM/UI smoke 和生产部署 smoke 均有文档证据；本报告没有把它们升级解释为 payload 语义证明。
- 本轮完成源码静态核对、Vault 资料核对和相关文件清单核对。
- 本轮未重新执行公网生产请求；下一轮应按第 8 节增加脱敏 payload 回归。
