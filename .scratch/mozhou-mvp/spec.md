# 墨舟 (MoZhou) — AI 小说写作平台 MVP 规格

> 状态: ready-for-agent | 来源: grill-with-docs（CONTEXT.md 23 项决策）| 日期: 2026-08-09

## Problem Statement

中文网文作者依赖的 AI 写作工具（如 OpenWrite 类产品）存在三个根本问题：①客户端无秘密但服务端锁定——功能固化、无法扩展、会员体系封闭；②数据（小说项目/风格/技能）被绑定在单一产品里，无法迁移；③免费模型与高级能力割裂，作者要为"额度"和"会员"重复付费。作者需要一款**功能对等甚至更强、数据自有、模型自由**的 AI 小说写作平台。

## Solution

**墨舟**——Web 版 AI 小说写作平台（自有品牌，全原创 UI/文案）：

- **AI 写作对话**（流式输出，DeepSeek 为主 + Qwen 备用，one-api 网关自动 failover）
- **小说项目管理**：人物库/世界观/章节摘要/章节文件，**pgvector RAG 注入**（写作时自动检索相关资料进上下文）——核心差异化
- **风格蒸馏**：上传文本 → LLM 分析生成可复用风格指南
- **小说拆解**：输入书名搜索/上传 TXT → 选择章节 → AI 生成章节大纲
- **书源搜索**：Yuedu/legado 书源规则格式（内置 3-5 主流源，用户可加源）
- **抽卡对比**：同提示词并发多模型输出对比（会员演示点）
- **自研轻量 Agent 管线**：节点式（LLM 调用 + 工具 + JSON 校验重试 + Token 记账），理念借鉴 DeterminFlow，代码全原创（规避 AGPL）
- **账号/会员**：邮箱+密码；免费基础 + 会员（蒸馏/拆解/抽卡/不限次）+ RAG 额度（one-api 记账）

## User Stories

1. 作为网文作者，我可以在浏览器打开墨舟并立即开始与 AI 对话写作，以便无需安装任何客户端
2. 作为作者，我可以创建小说项目（书名/类型/简介），以便组织我的创作
3. 作为作者，我可以在项目中维护人物库、世界观设定、章节摘要，以便 AI 写作时保持一致性
4. 作为作者，写作时 AI 能自动检索人物库/世界观/章节摘要并注入上下文，以便不会写崩设定
5. 作为作者，我可以续写章节、生成章节大纲、分析章节摘要，以便推进创作
6. 作为作者，我可以上传文本让 AI 分析并生成可复用的"风格指南"，以便模仿特定文风（会员）
7. 作为作者，我可以选择已保存的风格指南应用到写作对话，以便保持文风统一
8. 作为作者，我可以输入书名搜索网络小说或上传 TXT，选择章节后 AI 拆解剧情生成大纲，以便研究爆款结构（会员）
9. 作为作者，我可以搜索网络小说书源（Yuedu 规则），以便找到参考文本
10. 作为作者，我可以添加自定义书源规则，以便覆盖更多站点
11. 作为作者，我可以发起抽卡对比（同提示词多模型输出），以便选择最佳模型/文风（会员）
12. 作为作者，我可以切换模型（免费/高级/BYOK），以便控制成本与质量
13. 作为作者，我可以绑定自己的 API key（BYOK），以便使用自己账号的高级模型
14. 作为作者，我可以注册邮箱账号并登录，以便跨设备保存数据
15. 作为作者，我可以看到我的会员状态与额度用量，以便规划使用
16. 作为作者，我可以升级会员（订阅）以解锁全部功能，以便完整使用平台
17. 作为作者，超长对话时系统自动压缩上下文，以便不丢失前文且不超模型限制
18. 作为作者，我可以从 OpenWrite 迁移小说项目（导入目录结构），以便数据自有（二期）
19. 作为管理员，我可以管理模型供应商（one-api 渠道）与额度策略，以便控制成本
20. 作为管理员，我可以查看 token 用量审计（按节点/任务/用户），以便成本核算

## Implementation Decisions

### 架构（Docker Compose 单机）
```
墨舟 Web (Next.js + TS + Tailwind + shadcn/ui)
  ├── 业务 API（Next.js API Routes：auth/novels/chapters/distill/deconstruct/sources/usage）
  ├── 管线引擎（自研轻量节点管线，见下）
  ├── PostgreSQL + pgvector（Drizzle ORM）
  └── one-api（独立容器：LLM 网关/额度/渠道/failover）
```

### 管线引擎（自研轻量，理念借鉴 DeterminFlow）
- 节点类型：`llm`（一次模型调用 + 工具白名单）、`script`（确定性处理：文件读写/书源抓取）、`validation`（JSON 输出校验）
- 核心循环：LLM 调用 → JSON 输出检测 → 校验失败自动修复重试（≤3 次）→ 节点结果入 Token 账本
- 管线实例：`写作对话`（RAG 注入 → LLM → 流式）、`风格蒸馏`（分析 → 风格指南 JSON）、`小说拆解`（抓取/上传 → 选章 → 大纲 JSON）、`自审`（质量检查，不过触发返工——二期）
- Token 记账：每次调用记 provider/model/prompt_tokens/completion_tokens → usage 表 → 额度扣减（与 one-api 对账）

### 数据模型（核心表）
- `users`（id/email/password_hash/membership_tier/created_at）
- `novels`（id/user_id/title/genre/synopsis/cover/settings）
- `chapters`（id/novel_id/order/title/content/status）
- `worldview_entries` / `character_entries`（novel_id/type/content + **embedding 向量列**）
- `styles`（id/user_id/name/guide_json/created_at）——风格蒸馏产物
- `book_sources`（id/name/rule_yaml/status）——Yuedu 规则
- `usages`（id/user_id/provider/model/prompt_tokens/completion_tokens/created_at）
- `sessions`（对话：id/user_id/novel_id/context_compressed_at）

### API 契约（REST，前缀 /api/v1）
- `POST /auth/register|login|logout`
- `GET|POST /novels`，`GET|PUT|DELETE /novels/{id}`
- `POST /novels/{id}/chapters`（含 generate/续写/大纲 action）
- `POST /distill`（multipart 文本 → 风格指南）
- `POST /deconstruct`（book_url 或 file → 章节列表 → 大纲）
- `GET /sources/search?q=&source=`（书源搜索）
- `POST /chat`（SSE 流式；body 含 novel_id/model/风格引用）
- `GET /usage/me`（额度）
- 认证：JWT（httpOnly cookie）+ 中间件

### 其他决策
- RAG：pgvector HNSW 索引；检索 top-k（k=5~8）注入系统提示词"参考资料"节
- 上下文压缩：按 token 阈值触发，压缩历史摘要后继续（借鉴 OpenWrite contextCompression 与 DeterminFlow 压缩理念）
- 书源：Yuedu 规则格式（rule_yaml），解析器自研（规则引擎 ~300 行）
- 会员划分对齐原版：免费=写作对话(限次)+项目+RAG 基础；会员=蒸馏/拆解/抽卡/不限次/RAG 扩容
- 免费模型：DeepSeek-chat 为主 + Qwen 备用，one-api 渠道 failover；BYOK 用户走自有渠道
- 品牌：墨舟；深色编辑器风；UI 全原创（不复制 OpenWrite 视觉/文案）
- 提示词：参考逆向提取的方法论（system prompt 结构/工具定义模式）但**全部重新编写**

## Testing Decisions

- 测试哲学：只测外部行为（API 契约 + 管线输出），不测实现细节
- **管线引擎**是最高 seam：`llm 调用 → 校验 → 重试` 循环用 mock provider 做单元测试；JSON 校验失败重试路径必测
- **API 契约测试**：vitest + supertest 全端点（auth/novels/distill/deconstruct/sources/usage）
- **书源解析器**：用 fixture 书源规则 + 本地 HTML fixture 测提取正确性
- **RAG 检索**：embedding 用 fixture 向量测 top-k 排序与注入格式
- LLM 相关：集成测试用真实 deepseek（低成本）+ 关键路径 fixture 化（避免不稳定）
- 前例：无既有代码库（greenfield），从管线引擎 seam 开始

## Out of Scope

- 云同步（WebDAV/备份迁移）——二期
- 技能广场（Skill 市场）——二期
- 扫榜（网文榜单大数据）——二期
- 从 OpenWrite 数据迁移工具——二期
- 桌面壳（Tauri）——产品验证后
- 支付集成（支付宝/微信/Stripe）——MVP 只做额度框架与会员状态，支付二期
- 微信/第三方登录——二期
- 开源发布——产品跑通后
- 多章节批量管线（DeterminFlow 式复杂工作流）——二期评估

## Further Notes

- **AGPL 规避**：管线理念借鉴 DeterminFlow（AGPL-3.0），代码全原创，不引入其依赖——避免传染义务（墨舟 SaaS 需保持私有）
- **书源合规**：内置源仅收录可公开访问站点；用户自加源自负责任；README/页面免责
- 逆向数据复用清单：case `work/openxz-re/notes/prompts-expanded.txt`（方法论）、E-004~E-014（协议/交互参考）
- 品牌与文案：墨舟全原创；不出现 OpenWrite 相关名称/文案

## Prototype Verdict（2026-08-09，prototype/pipeline-engine 分支）

**问题**：管线引擎「LLM 输出 → JSON 校验 → 自动修复重试 → Token 记账」状态模型是否成立？
**原型**：`prototype/pipeline-engine.prototype.html`（单文件，双击即玩，5 场景向导 + 自由操作）——纯 reducer 模块可 lift 进生产代码。

**验证结果（12/12 断言通过）**：
1. ✅ 一次成功：记账 + 状态 ok
2. ✅ 坏 JSON → 自动修复重试（引擎自行处理，无需人工）
3. ✅ 3 次失败 → 停下等人工 → 人工重试清零
4. ✅ Token 超预算 → 中止（防失控账单）
5. ✅ 完成后非法操作被**完全忽略**（状态/账本/文案三不污染）

**原型发现的两个 bug（已修，生产实现必须保留语义）**：
- **账本污染**：组合 reducer（validateFail(meter(llmRaw()))）中，任务完成后 meter 仍会记账——修复：meter 仅在 running 态记账（`!isRunning → return state`）
- **文案覆盖**：嵌套组合时后层 action 覆盖前层拒绝文案——修复：非 running 态校验/记账动作原样返回 state（完全忽略）

**生产实现要求**：lift `PipelineEngine` 模块（Node/TS 化），保持纯函数语义；reducer 组合顺序固定为 `validate( meter( llmRaw(state) ) )`，每一层都检查 running 态。

## V1.1 迭代（2026-08-11 定案，grill-with-docs）

> V1.0 已收官（UVSD 16 步全走完，109/109 测试，归档 tag v1.0.0-release）。本迭代按 UVSD 16 步执行。

### 范围
- **起步（本迭代先做）**：⑥ 风格库持久化 —— 对应 User Story 6/7 的真实化补全
- **排队**：⑦ 章节级续写（R3 会话↔作品绑定的延伸）、⑧ Cancelled UI 态（SSE 中断，UVSD Stage 2 唯一缺失态）、④ sync 文件级同步执行、⑤ websearch 引用入文写回
- **排除（留后续）**：① 会员支付真实化（支付二期）、② projects 审查记录+导出备份、③ 书源 HTML 规则解析器（R5 决策，工单 08 边界）

### Journey ⑥ 风格库持久化（已冻结）
作者在蒸馏页上传文本 → AI 生成四维风格指南 → 命名保存到"我的风格库"（同名允许）→ 蒸馏页内嵌风格库列表（可删除）→ 保存后可"应用到对话"一键回流 → chat 风格胶囊 = 无 + 我的风格库（演示风格三件套删除）→ chat 请求带 `styleId` → 服务端查 styles 表注入完整四维指南到 system 提示。

**决策（2026-08-11 grilling Q1-Q6，全按推荐定案）**：
1. 管理入口：蒸馏页内嵌区块（保存/列表/删除同页闭环，不做独立管理页）
2. 回流：保留"应用到对话"一键回流；sessionStorage 暂存升级为真实库引用（`{styleId, name}`，name 保留兼容旧读取器）
3. 演示风格三件套（灰烬写实/意象绵长）：彻底删除，胶囊数据源 = 真实风格库
4. 契约：chat 请求 `style` 自由文本删除，改 `styleId` 引用；服务端注入四维指南（`[风格] 名称：叙事视角——…；句式节奏——…；意象偏好——…；情绪节奏——…`）
5. 编辑/重命名：不入 V1.1（工单 07 checklist 只有 命名/保存/删除）
6. 同名：允许（styles 无唯一约束，与 skills 一致）
7. 限次：不扩展（usage 记账已覆盖，会员边界留工单 11）

**数据模型**：`styles`（id/user_id/name/guide_json(jsonb 四维)/created_at）—— skills 表为模板，写路径归属校验防 IDOR。

### Journey ⑦ 章节级续写（已冻结 2026-08-11，UI Frozen v3 技能驱动对话）

> 完整设计文档：`.scratch/mozhou-mvp/continuation-design-20260811.md`（B1-B11 决策 + 消息级状态机 + 浏览器实测记录）。
> ⑧ Cancelled UI 态已并入本 Journey（消息级"停止"），不再独立排队。

#### Problem Statement

作者目前"写章节"没有正文载体：正文只存在于写作对话的消息流（不落章节），我的作品页只有章节骨架（标题/状态，无正文编辑）。章节级续写需要打通：正文编辑 + 在章节上下文里与 AI 技能化对话续写 + 产出确认插入 + 内容保护。

#### Solution（用户视角）

章节编辑器页（`/chapter/[id]`）：左侧正文编辑（永不锁定；自动保存+显式保存，保存状态可见）+ 右侧 AI 对话面板（技能驱动多轮对话——技能胶囊行：场景技能「章节续写/章节起笔」随章节状态切换 + 墨舟广场技能「去AI味/人物小传/信息差设计」+ 用户自定义技能可组合；AI 回复头部显示生效技能注入标签，流式可停止，完成可插入正文/忽略；插入冲突保护不覆盖用户内容；对话随章节留存可跨会话继续）。空章节：「让 AI 起笔」= 触发「章节起笔」技能。

#### User Stories

1. 作为作者，我可以打开作品里的一个章节进入章节编辑器，以便直接编辑正文
2. 作为作者，我可以在正文里随时修改内容（对话/生成期间不锁定），以便写作时自由调整前文
3. 作为作者，我可以在章节页与 AI 对话（多轮），让 AI 参考当前正文与作品设定续写，以便顺着文风往下写
4. 作为作者，我可以在对话中启用/组合技能（章节续写、去AI味、人物小传、信息差设计、我的自定义技能），以便 AI 按技能规则产出
5. 作为作者，我可以看到每条 AI 回复生效的技能标签，以便知道 AI 按哪些规则在写
6. 作为作者，我可以在 AI 回复流式生成时停止，以便不满意时及时打断
7. 作为作者，我可以在停止后插入已生成的部分，以便部分采纳
8. 作为作者，我可以把 AI 回复插入正文（正文末尾追加 + 已插入标记），以便产出落稿
9. 作为作者，我可以忽略 AI 回复（消息留存，仅收起操作区），以便对话记录不丢失
10. 作为作者，生成期间我修改了正文后插入旧回复时，系统提示"正文已变化"并让我确认，以便我的内容不被覆盖
11. 作为作者，我可以看到正文保存状态（未保存/已保存），以便知道内容是否落盘
12. 作为作者，空章节时我可以点"让 AI 起笔这一章"（触发章节起笔技能），以便从零开始
13. 作为作者，我离开章节再回来可以看到上次的 AI 对话与已插入标记，以便继续商量
14. 作为作者，我可以看到人性化的错误提示（标题+怎么办+动作），以便知道失败原因与下一步

#### Implementation Decisions

- 布局与交互：B1-B11 决策（设计文档；右侧 AI 对话面板/多轮对话/正文永不锁定/冲突保护/停止保留部分/保存状态/错误人性化/技能驱动）
- 规格层：Q1-Q4（对话留存/自动保存+显式保存/场景技能平台内置/范围按 mock 冻结）
- **消息级状态机**（原型产出，chapter-editor-view.tsx）：`streaming(Preparing/Streaming/Cancelling) → done / stopped / error`；消息字段含 `skills[]`（生效技能快照）、`snapshot`（生成时正文快照，冲突检测基准）、`inserted`、`confirmInsert`
- **冲突语义**（原型产出）：插入时 `snapshot !== 当前正文` → `confirmInsert` 确认态（仍要插入/取消），默认不覆盖用户内容
- **测试 seam（最高 seam，1 个）**：HTTP 契约测试（`tests/http/`，真实 dev server + mock provider）——章节对话/插入/冲突/技能注入全部在契约层断言；生成内核复用现有管线（runNodeStream），不新增 seam
- 技能注入：复用 chat skills 链路（skills 表 + system 注入 + mock 回显断言，工单 15 模式）
- E 节未决（正文 content 持久化模型、对话消息表、任务/候选表、保存落盘、撤销服务端语义）→ **Contract Frozen 后再定**

#### Testing Decisions

- 只测外部行为（HTTP 契约 + 管线输出），与现有测试哲学一致
- 契约测试：章节对话端点（mock provider 回显 system 提示断言技能注入，工单 15 先例）、插入语义（正文追加）、冲突保护（正文变化后插入 → 确认态）、归属校验（他人章节 404）
- 管线引擎 seam 复用：生成走 runNodeStream（现有 pipeline 测试覆盖 reducer 语义）

#### Out of Scope

- 正文编辑 undo 栈、光标处插入、全文润色/机检等编辑器重型能力（与"章节续写"解耦，留后续）
- E 节未决的持久化/表结构/保存落盘细节（Contract Frozen 后）
- 演示菜单（Mock 验收专用，UI Frozen 后删除）
- ④ sync 文件级同步、⑤ websearch 引用入文（仍在 V1.1 队列）
- ① 会员支付、② 审查记录+导出、③ 书源 HTML 规则解析器（用户已定排除）

#### Further Notes

- 工作方式参考：灵笔 lingbi-next（DocumentConflict/CandidateStale/humanizeError/autosave，代码在 C:\codex\lingbi-next）、笔枢写作（技能化流程，bishu-novel 33 Agent-Prompt 组合）
- Mock 组件 `chapter-editor-view.tsx` 为 progressive swap 基座（mock 函数族 → 真实契约逐票替换）
- 章节对话留存（Q1）意味着对话消息需随章节持久化——具体表结构 Contract Frozen 后定
