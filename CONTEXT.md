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
