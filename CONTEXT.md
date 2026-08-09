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
