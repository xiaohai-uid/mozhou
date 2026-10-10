# 墨舟功能商用级审计报告

日期：2026-08-12  
审计对象：`C:\zcode\novel-ai` 当前 HEAD `9ac33b4` 及已部署的墨舟生产链路  
范围：只审查产品功能完整度与可用性，不审查支付、订阅和计费

## 结论先行

**不能认定墨舟已经达到“功能商用级”。**

更准确的结论是：

1. 墨舟已经上线，核心独立对话/章节对话的上下文修复已经落地；
2. 核心写作 MVP 的一部分已经可用，并且当前本地回归为 `20` 个测试文件、`175/175` 通过，生产构建通过；
3. 但新作品创建后的首次写作黄金路径仍未打通，作品管理页仍存在明确的界面示意/未开放功能；
4. OpenWrite、灵笔、零界道种和 oh-story 中被参考的完整能力，并没有全部进入墨舟；
5. 网页端 AI 已完成的是事实盘点、迁移方案、Gate 和验收矩阵，不是代码迁移、部署或功能实现。

因此当前判定为：

```text
生产上线：是
核心写作链路：部分可用
新用户首次写作：不合格
全功能商用级：NO-GO
```

## 一、当前已经真实完成的部分

### 1. 对话上下文 P0 修复已完成

当前代码已经包含：

- 独立对话的 `base_identity`；
- 独立/章节模式契约；
- 当前用户消息作为 provider `messages` 的最后一条；
- 压缩后 `kept` 历史真正进入 provider；
- 章节对话的当前消息、章节历史和正文参考分离；
- payload observer，用于观察最终请求结构；
- 作品、会话、风格、技能的 owner scope 校验。

证据：

- [`stream-provider.ts`](C:/zcode/novel-ai/app/lib/chat/stream-provider.ts:31)
- [`service.ts`](C:/zcode/novel-ai/app/lib/chat/service.ts:181)
- [`chapter-chat.ts`](C:/zcode/novel-ai/app/lib/novels/chapter-chat.ts:149)

这部分可以说“修复完成”，但它只解决了模型上下文正确性，不能代表整个平台完成。

### 2. 核心账户和基础作品数据已经存在

已有邮箱注册/登录、会话、作品、章节、人物库、世界观条目、风格、技能和用量记录等基础数据结构，并有一定的归属校验和级联删除。

证据：[`schema.ts`](C:/zcode/novel-ai/app/lib/schema.ts:18)

### 3. 章节编辑核心交互已有真实链路

当前章节编辑器已经接入正文加载/保存、章节对话 SSE、对话持久化、候选回复、插入正文、选区替换、冲突提示、Undo/Redo 和自动保存等路径。

但源码中仍保留“Mock Preview”历史注释，作品管理页也仍把章节编辑器标成 Mock Preview。这说明实现状态和产品状态说明没有完全统一，必须在商用前清理。

证据：

- [`chapter-editor-view.tsx`](C:/zcode/novel-ai/app/components/features/chapter-editor-view.tsx:64)
- [`chapter-editor-view.tsx`](C:/zcode/novel-ai/app/components/features/chapter-editor-view.tsx:239)
- [`projects-view.tsx`](C:/zcode/novel-ai/app/components/features/projects-view.tsx:3)

### 4. 当前工程质量门禁通过，但门禁范围有限

本次实际执行：

```text
npm test       20 files / 175 tests passed
npm run build  Next.js production build passed / 37 static pages
```

这证明当前代码可以通过已有自动化测试和构建，不证明所有产品功能都已实现，也不证明每个 UI 的承诺都对应真实后端行为。

## 二、当前仍然不满足商用功能要求的阻断项

### P0：新作品创建后不能自然开始写作

这是当前最直接、也是用户截图已经证明的产品问题。

目前创建作品的 API 只创建 `novels` 记录：

```text
POST /api/v1/novels
→ 创建作品
→ 没有创建第一章
→ 没有返回首写任务状态
→ 没有跳转章节编辑器
```

作品管理页的 `createBook()` 也只刷新作品列表并加载作品详情；它没有创建第一章、没有进入编辑器、没有显示“开始写作”主动作。用户看到人物库 0 条、世界观 0 条、章节 0 章并不知道下一步，这是合理的产品缺陷，不是用户误操作。

证据：

- [`novels/route.ts`](C:/zcode/novel-ai/app/app/api/v1/novels/route.ts:12)
- [`novels/service.ts`](C:/zcode/novel-ai/app/lib/novels/service.ts:54)
- [`projects-view.tsx`](C:/zcode/novel-ai/app/components/features/projects-view.tsx:97)
- [`novel-product-replay-and-web-ai-handoff-2026-08-12.md`](C:/zcode/novel-ai/docs/novel-product-replay-and-web-ai-handoff-2026-08-12.md:9)

当前正确的商用黄金路径应是：

```text
创建作品
→ 原子准备第一章空章节
→ 进入章节编辑器
→ 作者自己写，或让 AI 起笔
→ AI 输出先成为候选
→ 用户确认后才写入正文
```

现有编辑器已经有空章节起笔能力，但它被藏在“先手工新建章节、再点击章节”的后置路径中，不能抵消首写入口缺失。

### P0：作品创建没有原子性和幂等保证

当前新建作品和新建章节是两个独立请求，`createNovel()` 只插入作品；`createChapter()` 通过读取 `max(sortOrder) + 1` 计算章节号。

这会留下功能级风险：

- 创建作品成功、创建第一章失败时，用户得到无法开始写作的半成品；
- 双击/重试可能产生重复作品或重复章节；
- 并发创建章节可能出现相同 `sortOrder`/`ch`；
- 数据库没有看到首写工作流状态或幂等键。

证据：

- [`novels/service.ts`](C:/zcode/novel-ai/app/lib/novels/service.ts:139)
- [`schema.ts`](C:/zcode/novel-ai/app/lib/schema.ts:68)

商用级要求至少是：服务端事务、唯一约束/幂等策略、失败可恢复状态和明确的重试语义。

### P1：作品领域模型过薄，无法承载完整小说生产流程

当前核心 schema 主要是：

```text
novel
chapter
character entry
worldview entry
style
skill
chat messages
```

与参考项目相比，缺少或未形成正式运行时真源的能力包括：

- 作品简报/创作目标；
- 卷纲、章纲、细纲；
- 章节摘要和长期记忆；
- 地点、物品、事件、人物关系等结构化 Canon；
- 参考资料/导入小说/对标库及其归属；
- 分析任务和分析产物；
- 审查任务、审查报告和报告历史；
- 伏笔/故事线/进度追踪；
- 媒体/封面资产；
- 工作流状态、后台任务和恢复点；
- 项目导出包与版本恢复数据。

这不是说这些能力都必须在第一版同时完成，而是当前不能把“人物、世界观、章节三栏”称为完整小说工作台。

### P1：页面中仍有真实的假功能或未开放功能

当前源码明确记录：

- 审查记录是写死的界面示意，不是审查引擎结果；
- 全书 TXT、作品包 JSON、云同步备份三个作品管理卡片全部 disabled；
- RAG 是人物/世界观关键词检索和正文末尾固定 3000 字参考，不是完整语义知识库；
- 技能是名称 + systemPrompt 的注入记录，不是带依赖、权限、工具、产物和执行状态的运行时技能；
- 榜单真实请求失败后会降级为示例数据；
- WebDAV 当前是单向推送，不是双向同步、冲突合并和恢复系统；
- `syncConfigs.password` 仍是明文存储；
- 章节正文没有显式大小上限；
- 没有看到生产级的 IP/接口限流和滥用保护。

证据：

- [`projects-view.tsx`](C:/zcode/novel-ai/app/components/features/projects-view.tsx:442)
- [`projects-view.tsx`](C:/zcode/novel-ai/app/components/features/projects-view.tsx:476)
- [`sync/service.ts`](C:/zcode/novel-ai/app/lib/sync/service.ts:1)
- [`schema.ts`](C:/zcode/novel-ai/app/lib/schema.ts:146)
- [`release-report-v1.2.md`](C:/zcode/novel-ai/docs/release-report-v1.2.md:64)

把这些模块标成“暂未开放/界面示意”是诚实的；但在这些功能未实现前，不能宣称全功能商用。

### P1：拆解、扫榜、技能、封面和 Agent 体系没有形成完整闭环

当前已有部分 API 和页面，但成熟度不同：

- 小说拆解是一次性文本 → LLM JSON 结果，未形成可持续管理的拆解资产和工作流；
- 网文扫榜依赖简单 HTML 解析，失败会回退示例数据；
- 抽卡是候选生成，不是完整多模型工作流；
- 技能主要是文本注入，未实现 OpenWrite/oh-story 那种工具调用、文件读写、权限、候选变更和审计闭环；
- 未见完整的小说封面生成/资产管理能力；
- 未见完整的多 Agent 确定性写作循环、任务队列和可恢复工作流。

以“页面存在”和“路由返回 200”作为完成标准，会把这些部分高估。

## 三、与用户提供的参考项目对照

### OpenWrite

本地逆向资料显示，OpenWrite 的可借鉴能力不是单纯的聊天框，而是：

- 自动读取当前作品、章节、人物、世界观和近期正文；
- Agent 工具：读文件、写文件、列文件、搜索、提问、创建项目、创建技能；
- Skill 渐进加载并影响实际行为；
- 生成结果经过明确的保存/应用动作；
- 多模型/自定义端点；
- 项目导入、导出、回收站、WebDAV；
- 书源、联网搜索、风格蒸馏和技能市场。

墨舟目前只覆盖其中一部分：聊天、章节、人物/世界观、风格、简单技能注入、简单检索和部分同步。OpenWrite 的 Agent 工具面和完整项目生命周期尚未等价实现。

参考：

- [`OpenWrite完整产品逆向资产.md`](C:/Users/a1691/Documents/Obsidian%20Vault/20_Knowledge/OpenWrite完整产品逆向资产.md)
- [`OpenWrite 竞品分析.md`](C:/Users/a1691/Documents/Obsidian%20Vault/20_Knowledge/OpenWrite%20竞品分析.md)

### 灵笔 LingBi

灵笔资料中真正值得作为商用工程基准的不是“功能数量”，而是这些闭环：

- 首章黄金路径；
- 结构化 Canon；
- ContextCompiler 和 token 预算；
- Candidate Store；
- 确定性写作循环；
- MutationProtocol：候选、确认、原子写入、冲突处理和审计；
- 六维审查及报告历史；
- 任务队列、恢复点和真实书仓验收；
- 发布门禁和真实 E2E。

同时必须注意：Obsidian 中灵笔项目本身仍标记为 active，记录明确写着有 38 个未提交改动，需要继续 analyze/test。因此灵笔的设计文档和历史验收资料可以提供方法与基准，不能把所有文档描述直接当作当前运行事实。

参考：

- [`LingBi.md`](C:/Users/a1691/Documents/Obsidian%20Vault/10_Projects/LingBi.md)
- [`灵笔完整模块说明文档v2.md`](C:/Users/a1691/Documents/Obsidian%20Vault/20_Knowledge/AI/灵笔完整模块说明文档v2.md)
- [`LingBi商业级MutationProtocol规划经验.md`](C:/Users/a1691/Documents/Obsidian%20Vault/20_Knowledge/AI/LingBi商业级MutationProtocol规划经验.md)

### 零界道种

零界道种不是和墨舟同类的完整小说 SaaS。它的价值在生产方法：

```text
想法
→ 剧情
→ 分镜
→ 首尾帧/资产锁定
→ 生成
→ QA
```

它可为墨舟提供“资产来源、版本、锁定、验收、回滚”的工作流思想，但不能作为墨舟已经具备小说产品能力的证据。

参考：[`零界道种.md`](C:/Users/a1691/Documents/Obsidian%20Vault/10_Projects/零界道种.md)

### oh-story-claudecode

oh-story 上游是 13 项本地 Agent 技能：

```text
story-setup
story
story-long-write
story-long-analyze
story-long-scan
story-short-write
story-short-analyze
story-short-scan
story-deslop
story-import
story-review
story-cover
browser-cdp
```

Obsidian 中的部署记录只证明它被部署到了本地 `C:\zcode\novels` 的 ZCode 项目目录；它不是墨舟 Cloud Run 运行时的迁移证明。

网页端 AI 的最终状态也已经明确：

```text
事实盘点：完成
兼容方案：完成
迁移代码：未做
Vendor 复制：未做
Adapter：未做
数据库变更：未做
部署：未做
```

因此当前墨舟对 oh-story 的完成度是“已研究、未迁移”，不是“已经融入”。

参考：

- [`oh-story 完整部署 ZCode（2026-08-12）.md`](C:/Users/a1691/Documents/Obsidian%20Vault/20_Knowledge/AI/oh-story%20完整部署%20ZCode（2026-08-12）.md)
- 网页端任务《设计UI开发流程》的最终状态：等待人工审阅，明确未修改代码、未迁移、未部署。

## 四、为什么 175 个测试全绿仍不能说明商用级

测试通过说明“已有测试覆盖的契约没有回归”。但当前测试不能替代以下产品验收：

- 新注册用户能否从创建作品直接进入第一章；
- 所有主按钮是否都有真实动作；
- 页面展示的审查/导出/备份是否有真实数据源；
- 失败后是否能恢复、重试、取消而不丢正文；
- 真实外部源失败时是否不会把示例数据误当真实数据；
- 长篇数据规模、并发保存、重复点击和网络重试是否安全；
- 用户 A 是否永远不能访问用户 B 的作品、参考资料和技能；
- 生产数据库迁移、备份、恢复和版本回滚是否真正演练过。

当前测试基线是“当前已实现切片的回归证据”，不是“完整产品商用认证”。

## 五、达到功能商用级前的最小必做顺序

### Gate 0：先修首次写作黄金路径

必须完成并实测：

```text
注册/登录
→ 创建作品
→ 自动得到第一章
→ 自动进入编辑器
→ 自己输入正文
→ 或点击 AI 起笔
→ 流式候选
→ 用户确认
→ 正文落盘
→ 刷新/重新登录后仍存在
```

同时覆盖双击、刷新、断网、LLM 失败、用户取消和重复重试。

### Gate 1：补齐真源与状态模型

至少需要：首写状态、作品简报、章节摘要/大纲、参考资料归属、候选与变更记录、审查任务/报告、导出包版本和恢复点。首写不应被大纲、人物库或 RAG 阻塞，但专业长篇模式可以要求它们。

### Gate 2：所有 UI 承诺必须二选一

```text
真实接通并有端到端验收
或
从生产 UI 移除/明确标记未开放
```

不能保留写死的审查记录、看起来可点但永远 disabled 的导出入口作为已完成能力。

### Gate 3：完成写作变更协议

借鉴灵笔 MutationProtocol：

```text
生成
→ 候选
→ 用户确认
→ 服务端校验版本/选区
→ 原子写入
→ 可撤销/可恢复
→ 审计
```

所有 oh-story 的 Write/Edit/Rewrite/Deslop 等动作都必须适配到这个协议，不能直接获得正文写权限。

### Gate 4：再迁移 oh-story 13 项能力

采用“完整 Vendor + Native Adapter”，并逐项验收：触发、依赖、上下文、工具/模型执行、产物、用户可见结果、失败与降级、owner scope、候选写入和真实 E2E。只有 13 项都满足，才能说“已迁移”。

### Gate 5：生产级外部能力与恢复

补齐或明确限制：真实导出、WebDAV/同步恢复、审查报告、联网搜索来源、榜单解析、限流、正文大小限制、密钥加密、后台任务、失败重试、备份恢复和生产观测。

## 最终裁决

**墨舟现在可以被称为“已经上线、核心写作 MVP 部分可用、上下文 P0 修复已完成”。**

**不能被称为“从功能上已经达到商用级”，更不能说 OpenWrite、灵笔、零界道种和 oh-story 的能力已经全部融入。**

当前最优先的不是继续堆 13 个技能，而是先把“新作品创建 → 第一章 → 首次写作”打通，并把页面上所有假功能和状态漂移清理干净。否则新增能力越多，用户越难判断什么是真的、从哪里开始。
