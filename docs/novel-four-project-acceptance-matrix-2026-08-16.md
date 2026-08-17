# 墨舟 × 四个 GitHub 项目：炼化验收矩阵（2026-08-16）

> 本矩阵基于对四个仓库【真实源码】的逐文件研究（非 README 摘要），并与墨舟当前代码（C:\zcode\novel-ai，HEAD 4dead9a）逐项对照。
> 检查日期：2026-08-16。证据来源：本机克隆（/tmp/gh-four/{DeterminFlow,ArcReel,inkos,oh-story-claudecode}）+ 本机运行实例（DeterminFlow Docker :8020 / ArcReel production-arcreel-1 v0.23.0 / inkos CLI 1.7.2 + Qoder 工作区 / oh-story 部署于 C:\zcode\novels）+ 四份深度研究报告。
> 实现等级：**已吸收**（墨舟已有等价且真实接线的实现）｜**部分实现**（有对应物但缺关键语义）｜**仅参考**（只借鉴思路/文档）｜**缺失**（无对应物）｜**不建议引入**（许可证/定位原因明确排除）。
> 上游证据列给出仓库内文件路径；墨舟落点列给出 novel-ai/app 内路径。

## 0. 四个项目现状快照（GitHub API 实时核验，2026-08-16）

| 项目 | 星标 | 最后推送 | 许可证（LICENSE 实读） | 克隆版本 | 本机运行版本 | 定位 |
|---|---:|---|---|---|---|---|
| DeterminFlow | 430 | 2026-08-11 | AGPL-3.0 | main 0.1.0（Alpha） | Docker :8020（determinflow-core:latest） | 确定性 AI 工作流运行时（多节点编排） |
| ArcReel | 4,033 | 2026-08-16 | AGPL-3.0 + NOTICE §7 附加署名条款 | main 0.26.0 | 容器 0.23.0（落后 3 个 minor） | 自托管 AI 视频生产工作台（漫剧/说书/带货） |
| inkos | 9,020 | 2026-08-16 | AGPL-3.0-only | 1.7.2（monorepo cli/core/studio） | 全局 CLI 1.7.2 + Qoder/inkos-project 工作区（商汤） | AI 原生中文小说创作系统（本地优先，文件即数据库） |
| oh-story-claudecode | 5,647 | 2026-08-16 | MIT | v0.7.6（agents_version 25） | C:\zcode\novels 完整部署（story-setup 1.2.7） | 网文写作 skill 包（扫榜/拆文/写作/去AI味/封面） |

## 1. 相对既有文档的四处重要修正（以源码为准）

1. **DeterminFlow 没有数据库，也没有独立的 Run/Step/Attempt/Checkpoint 实体**。持久化 = DATA_DIR 下每任务一个 JSON 文件（原子 tmp+os.replace 写）；恢复粒度 = 节点级（NodeExecutionState 全量落盘，重启经 RECOVERY_REISSUE 重新走失败节点）。此前文档（novel-production-stack-comparison）中"generation_plan/run/step/attempt/checkpoint 分层"是按 README/理念表述，代码层实际是 WorkflowTask + NodeExecutionState 两个实体。墨舟的 GenerationPlan + SkillRun 在结构上其实更接近 DF 的真实模型。
2. **ArcReel 本机运行 0.23.0**，而 main 已 0.26.0（alembic 迁移已 426+）。研究以 main 为准，运行实例落后约 3 个 minor。
3. **oh-story 上游只有 13 个 skill 目录，且不含 storyrepo**。墨舟 vendor 快照与 13 项能力注册表中的 storyrepo（故事仓库 v2 + engine CLI）来自本地 ~/.agents/skills（墨舟 vendor README 已如实标注来源为本地安装包），其 references/provenance.md 自证为对照 webnovel-writer/oh-story/AI_NovelGenerator/chinese-novelist 的本地复刻包，**无许可证声明、无 git 来源**。因此："13 项能力注册"的构成 = 上游 12 项（缺 browser-cdp）+ 本地 storyrepo 1 项，不可表述为"13 项全部来自 MIT 上游"。storyrepo 相关机制进入墨舟需另行核源与许可。
4. **inkos README 声称的独立多 Agent（Observer/Reflector/Settler/Normalizer）在代码中已并合**：Observer/Reflector/Settler 并入 WriterAgent.settle（writer.ts:392）+ ChapterAnalyzerAgent，Normalizer 无同名类。引述 inkos 角色时应以代码符号为准。

## 2. 炼化验收矩阵

### 2.1 DeterminFlow（借鉴层：确定性任务运行时）

| 上游机制 | 上游证据 | 墨舟当前落点 | 等级 | 缺口 | 许可证风险 | 优先级 | 建议动作 |
|---|---|---|---|---|---|---|---|
| 定义快照冻结（任务启动时把流程/参数写死） | src/workflow/manager.py _freeze_snapshot_definition；task_recovery.py:383 | lib/runtime/generation-plan.ts persistGenerationPlan（generationPlans 表存冻结 plan JSONB） | 已吸收 | 墨舟冻结的是单次生成计划；DF 冻结多节点 DAG + 参数 + 变量。多节点管线未出现前差距无实际影响 | 低（仅理念） | P1 | 将来做多节点管线时把 DAG 定义一并冻结 |
| 运行身份守卫（agent_type/model/prompt sha256 防配置漂移） | src/workflow/runtime_guards.py；nodes/agent.py:240 | 无。GenerationManifest 只做脱敏记录，不校验执行期漂移 | 缺失 | 长任务执行中改模型/技能配置不会被发现 | 低 | P2 | 在生成开始时把实际模型+技能定义 hash 存入 plan，恢复/复用前核验 |
| JSON 校验-确定性修复-限次重试 | src/workflow/json_output.py safe_repair_json_text；output_validation.py json_field_min_chars | lib/pipeline/validate.ts（JSON.parse+zod 必填诊断）；lib/story/deconstruction-pipeline.ts（classifyProviderResponse+repairAttempts+providerAttempts 全链） | 已吸收 | 墨舟修复靠"携带 lastError 重发模型"，非确定性代码修复；缺字段级最小字数门禁 | 低 | P2 | 移植 safe_repair（去 fence/引号/尾逗号）为纯函数 + 单测 |
| 失败-重试-跳过策略状态机（跨重启定时重试） | src/workflow/failure_policy.py（retry_waiting/next_retry_at）；task_recovery.py _activate_due_retries | lib/pipeline/reducer.ts（内存态 attempts/lastError/manualRetry/abort，已接线 chat 与章节）；候选消息状态机 | 部分实现 | 重试计划不持久化，进程重启后无"到期自动重试"；无 fail_auto_skip | 低 | P1 | 把"待重试时间"落库，服务启动扫描到期任务 |
| 节点级断点恢复（进程重启续跑） | src/workflow/task_recovery.py recover_workflow_tasks | deconstructionRuns.status/attemptCount 可恢复（拆解）；候选刷新可恢复；storyWorkflowRuns 存状态但无恢复执行器 | 部分实现 | 无通用后台任务执行器；无按节点/步骤续跑语义 | 低 | P0 | 建 story_jobs 表 + runner，支持 pending/running/failed/retry_at |
| 调用级 Token 账本 + 定价 fail-closed | src/workflow/token_usage.py（call_id roll-up）；pricing.py | lib/schema.ts usageEvents（nodeType+prompt/completion）；SkillRun.promptSection tokens | 部分实现 | 记账粒度是"一次调用一行"无 call_id 关联到具体生成；无单价/成本估算；unpriced 语义无 | 低 | P1 | 记账行加 generationId/callId；接入定价表前不估算成本（fail-closed） |
| 审批节点 + reject_upstream 上游返工 | src/workflow/nodes/approval.py | 候选确认/插入/discard 已实现；无流程级审批节点与上游返工 | 部分实现 | 只有"候选确认"一层；无多节点间人工闸门 | 低 | P2 | 不急于引入；等有多节点管线再设计 |
| 工具白名单/路径沙箱/轮次限制 | src/core/workspace_guard.py；tool_guard.py（按 agent_type 装配工具） | 技能无工具面（正文只经受控 mutation 协议）；owner scope 校验 | 缺失 | 若未来给技能真实工具（文件/搜索）需要整套权限模型 | 低（当前无工具） | P2 | 技能工具化时以"每技能独立工具装配 + 路径沙箱"为模板 |
| 原子落盘（tmp+os.replace） | src/workflow/task_persistence.py | Postgres 事务（prepareChapterCandidate 单事务） | 已吸收（更强） | 无 | 无 | - | 保持 DB 事务，不学文件 rename |
| 内容安全诊断（二分排除法定位敏感消息） | src/core/agent/content_safety.py | 无（依赖模型侧过滤） | 缺失 | 中文网文敏感词/违规定位无产品内诊断 | 低 | P2 | 评估移植为"分段复检定位"工具 |
| JSON 文件当数据库 / 无独立 audit 实体 / 恢复粒度粗糙 | 全仓无 DB；attempt 为软字段 | - | 不建议引入 | 墨舟 Postgres 结构更强 | 中（照搬=AGPL 传染） | - | 不采用；audit 需自建（SkillRun/attemptCount 已起步） |

### 2.2 ArcReel（借鉴层：长任务/事件/产物/成本工程）

| 上游机制 | 上游证据 | 墨舟当前落点 | 等级 | 缺口 | 许可证风险 | 优先级 | 建议动作 |
|---|---|---|---|---|---|---|---|
| 单队列任务状态机（queued/running/cancelling→终态，SQL 守卫幂等） | lib/db/models/task.py；lib/generation_queue.py | 无通用任务队列表；候选消息状态机 + deconstructionRuns + storyWorkflowRuns 分散 | 部分实现 | 章节长生成没有 queued/running 持久化任务记录与统一查询 | 低（理念） | P0 | 建统一 generation_tasks 表承接章节/拆解/扫榜长任务 |
| 活动态去重索引（防重复生成） | task.py idx_tasks_dedupe_active | chapterMessages(chapterId,generationKey) 唯一约束 + requestKey 幂等 | 已吸收（等价） | 无 | 无 | - | 保持 |
| 依赖任务链（父失败级联取消子任务） | task.py dependency_task_id/group/index | 无 | 缺失 | 目前无多步依赖任务 | 低 | P2 | 多节点管线时引入 |
| 取消补偿 + 0-rows-cancelled（迟到完成不得翻转终态） | server/services/generation_tasks.py CompensableGenerationResult；generation_worker.py:771 | chapter-candidate.ts settleChapterCandidate（stopped || existing.status===stopped 防迟到完成回写） | 已吸收（语义等价） | 无产物 claim 回滚（墨舟候选无占位资产） | 低 | - | 保持；独立对话 stop 端点同样受保护 |
| 提交时冻结 checkpoint + 重启续跑 executor（按 provider job_id） | server/services/resume_executor.py；_ensure_checkpoint_endpoint_unchanged | 无。生成在请求生命周期内，断网/重启只能重生成或读旧候选 | 缺失 | 长生成断网恢复是用户痛点（launch-readiness 已列 P0 级体验问题） | 低 | P0 | provider 层记录上游 job_id + 冻结 endpoint，提供 resume 端点 |
| append-only 事件日志（seq+client_key 幂等，UI 唯一读源） | lib/db/models/session_event.py | 无事件日志表（有 timing 日志与消息表，均非事件流） | 缺失 | 无法回放"生成了什么/失败原因/用户操作"时间线 | 低 | P1 | 建 story_events 表（scope+seq+type+payload+clientKey） |
| 参数化 SSE fanout + 项目变更快照差分 | server/sse_channel.py；server/services/project_events.py | lib/http/sse.ts start/phase/delta/done/error 单通道 | 部分实现 | 单流；无多通道订阅/心跳/事件广播（本地工作台未来多窗口同步需要） | 低 | P2 | 本地工作台阶段再引入 |
| 产物血缘 ArtifactBasis（current/stale）+ 版本回滚 | lib/artifact_manifest.py；version_manager.py；artifact_version_restore.py | lib/runtime/types.ts ArtifactRef（provenance/version/culled）+ runtime_artifacts + artifactBindings | 部分实现 | 无 current/stale 失效判定；无版本回滚（正文只有 revision 计数） | 低 | P1 | 给 runtime_artifacts 加 basis/current 判定；正文版本链见 inkos 行 |
| 多供应商可插拔注册表 + 分层计价 | lib/video_backends/registry.py；lib/pricing/{lookup,strategies,types}.py | one-api 网关统一传输；provider 注册表/凭据归属/成本估算未实现（2026-08-16 圆桌已定路线） | 部分实现 | BYOK 隔离（四类来源凭据/费用/账本分离）是当前商业前置 | 中（供应商胶水代码不通用） | P0 | 按既定 provider 注册表路线推进；pricing 分层（估算/结算分离）可参照 |
| 每调用一行用量+费用结算（cost/currency/retry_count） | lib/db/models/api_call.py | usageEvents（tokens 无 cost） | 部分实现 | 无成本字段与货币 | 低 | P1 | 与定价表同步补 cost/currency |
| 视频域模型（分镜/grid/剪映草稿/reference video/带货/统一角色） | lib/grid/、jianying_draft_service.py 等 | 无 | 不建议引入 | 漫剧/视频专属，对小说生产无直接价值 | 中（AGPL+NOTICE 署名） | - | 明确不引入（沿用既有结论）；若未来漫剧另起项目再评估独立服务 |
| 单用户默认/项目目录即边界 | server/auth.py（默认 admin） | 墨舟多用户 | 不建议引入 | 多租户隔离墨舟已具备 | 低 | - | 不采用 |

### 2.3 inkos（借鉴层：小说领域状态/上下文/审查/本地工作台）

| 上游机制 | 上游证据 | 墨舟当前落点 | 等级 | 缺口 | 许可证风险 | 优先级 | 建议动作 |
|---|---|---|---|---|---|---|---|
| 结构化 JSON 权威 + Markdown 投影 + 索引三层 | packages/core/src/state/state-projections.ts；memory-db.ts（FTS5-BM25） | Postgres 真源（novel_trackings JSONB）+ 派生状态卡 UI + RAG 检索 | 已吸收 | 投影层对 Web 不适用；检索用关键词降级（无 embedding 渠道） | 低（理念） | P2 | 检索升级依赖 embedding 渠道，不照搬 SQLite |
| 模型只产 delta、代码层 immutable 校验提交 | state/settler-delta-parser.ts + state-reducer.ts | 候选→确认→受控 mutation；normalizeStoryChapterFacts 限制事实结构 + mergeChapterFacts 幂等 | 已吸收（等价思想） | 无自动事实提取 agent（结算靠 UI 显式填写，既有审计已如实标注） | 低 | P2 | 保持显式合并，不自动猜测事实 |
| 13 态章节状态机（drafting→auditing→audit-failed→revising→approved/published…） | models/chapter.ts ChapterStatusSchema；pipeline/runner.ts | chapters.status 仅 draft/final；候选消息状态机；novelWorkflows ready/writing/active | 部分实现 | 章节级 drafting/auditing/revising 流转缺失，审查与修订无状态承载 | 低 | P0 | 扩展章节状态枚举 + 迁移，审查/修订走显式状态 |
| 每章 intent/context/rule-stack/trace 落盘可复现 | utils/runtime-writer.ts + models/input-governance.ts | GenerationPlan + GenerationManifest（区段 kind+tokens，脱敏）+ SkillRun.promptSection | 已吸收（脱敏版） | 无规则栈（技能规则逐条记录）与检索明细 trace | 低 | P2 | 若需审计回放再补 rule 栈快照 |
| 写锁心跳续租 + 陈旧锁回收 | state/manager.ts（30s/3min/4retry BOOK_BUSY） | Postgres 事务 + 章节 revision 乐观并发 | 已吸收（更强） | 无 | 无 | - | 保持乐观并发；租约锁仅本地文件场景需要 |
| 原子文件集 + 章节版本链 + 整书备份回滚 | utils/atomic-file-set.ts；chapter-workspace.ts .versions/；book-backup.ts | 正文 revision 计数；导出/备份卡片仍 disabled | 缺失 | 无逐版本回滚、无整书导出/备份/恢复（本地工作台硬需求） | 低 | P1 | 正文版本链（修订/重生成/恢复留痕）+ 导出包，见墨舟路线 Gate |
| 结算失败仅重试结算层 + state-degraded | pipeline/chapter-state-recovery.ts | 结算事务 + conflict 拒绝 + 机检不通过 rejected | 部分实现 | 无显式 state-degraded 与"只重跑结算"恢复路径 | 低 | P2 | 结算失败路径补降级状态 |
| 审计→自动修订闭环（85 分阈值，≤N 轮） | pipeline/chapter-review-cycle.ts（PASS=85/NET_IMPROVEMENT=3） | quality_gate post_write 检查（通过/返工原因），无自动修订循环 | 部分实现 | 门禁已真实；"不过→自动改→再审"闭环无 | 低 | P1 | 候选重生成时携带检查失败原因（已有 lastError 语义），限 1 轮 |
| 生产运行快照 + resumeCursor 幂等续跑 | production/harness.ts（ProductionRunSnapshot） | storyWorkflowRuns status/output/error + deconstructionRuns | 部分实现 | 无续跑执行器与光标语义 | 低 | P1 | 并入 P0 任务 runner |
| 会话 jsonl + 每 token 成本审计 | .inkos/sessions/*.jsonl（usage{cost} 实产物） | usageEvents + 消息表；无每消息成本 | 部分实现 | 成本明细无（与 2.2 成本行同源） | 低 | P1 | 记账行关联消息/生成 |
| 每章 4+ 运行时文件风暴 | runtime-writer.ts 多文件双写 | - | 不建议引入 | DB 权威下无意义 | 中（AGPL 传染若照搬代码） | - | 不采用（DB 为权威、投影按需渲染） |
| PID+setInterval daemon（无进程监督） | cli/commands/daemon.ts；pipeline/scheduler.ts | - | 不建议引入 | Web 端应自建 job runner | 中 | - | 不采用；任务 runner 自研 |
| node:sqlite 单机检索 / 明文 secrets.json | memory-db.ts；.inkos/secrets.json 实产物 | - | 不建议引入 | 服务端用 PG/向量 + 密钥管理 | 低 | - | 不采用 |

### 2.4 oh-story-claudecode（借鉴层：写作方法/技能/拆文/机检）

| 上游机制 | 上游证据 | 墨舟当前落点 | 等级 | 缺口 | 许可证风险 | 优先级 | 建议动作 |
|---|---|---|---|---|---|---|---|
| 单一权威追踪 JSON + 确定性派生视图 + 原子提交 | skills/story-long-write/scripts/tracking_commit.py（1139 行） | novel_trackings JSONB 真源 + 结算事务（story/tracking.ts） | 已吸收 | 派生视图是 UI 渲染非 md 文件；固定栏数约束无 | 低（MIT） | - | 保持 |
| expected_state_revision 乐观并发 | tracking_commit.py state_revision | storyTrackingConflictError + expectedStateRevision 条件更新；章节 revision | 已吸收 | 无 | 无 | - | 保持 |
| 固定 7 栏状态卡 ≤12KB + 逐章记录字节上限 | tracking_commit.py CONTEXT_HEADINGS；DELTA_TARGET_BYTES=1536/MAX=3072 | ContextAssembler token 预算 + culled 证据 | 部分实现 | 无固定结构约束；按 token 非字节 | 低 | P2 | 写作上下文固定区段模板 + 预算（契约已冻结，可加约束） |
| 确定性 AI 腔检测器 + 模型退化检测（非 GPT 打分） | skills/story-deslop/scripts/check-ai-patterns.js（1371 行 regex 密度阈值）；check-degeneration.js | quality-gate AI_PATTERN_MARKERS 词表 + 均句长；checks.ts 六项机检 | 部分实现 | 墨舟为轻量词表版；无密度阈值回归集、无退化（复读/截断/占位）检测 | 低（MIT，可直接移植脚本） | P2 | 移植 check-ai-patterns 为 TS 纯函数 + 固定评测集 |
| 拆文 crash-safe Stage 写盘 + 断点续跑 | story-short-analyze _meta.json last_stage_in_progress；long-analyze _progress.md | deconstructionRuns（requestKey 幂等 + status + 阶段产物 + 重试/恢复 UI） | 已吸收 | 无（Web 版更强） | 低 | - | 保持 |
| 六项审查为提示词层（内置 rubric fallback） | story-review SKILL.md | checks.ts 为确定性机检 | 已吸收（更强） | 无 | 低 | - | 不照搬纯提示词审查 |
| 13 项能力注册表 + 诚实状态 | skills/ + marketplace.json | STORY_CAPABILITIES 注册表（native/configuration_required…） | 已吸收 | **storyrepo 来源边界**（见 §1.3）：注册表 13 项含本地复刻包，非全上游 | 中（storyrepo 许可证未声明） | P0 | vendor README 已标注来源；能力表补 provenance 字段 |
| 技能按需加载 + 阶段路由 | 各 SKILL.md + agents_version | SkillRuntime 按阶段路由 + skipped 证据 | 已吸收 | 无 | 低 | - | 保持 |
| 多 CLI 适配（hooks/commands/agents） | story-setup references/ 模板 | 网页端不适用；bootstrap 对应 setup | 仅参考 | 运行时适配层不搬 | 低（MIT） | - | 不迁移 hooks；本地工作台阶段可参考命令面 |
| browser-cdp 浏览器刷榜 | skills/browser-cdp | rankings.ts 用受控榜单接口（番茄） | 不建议引入 | 依赖 Chrome 登录态，不稳定数据源 | 低 | - | 不引入；保持可控榜源 |
| 1-3 小时长篇拆文同步管道 | story-long-analyze SKILL | deconstruct/analyze 为同步请求 | 部分实现 | 长文本拆解应在后台 batch 执行 | 低 | P1 | 长拆解转后台任务（并入 P0 任务 runner） |

## 3. 结论汇总（回答"哪些已吸收/部分/仅参考/缺失/不建议引入"）

**已吸收（墨舟已有真实接线实现）**：定义冻结（GenerationPlan）、JSON 校验重试（拆解链）、候选事务语义（含 0-rows-cancelled 等价）、活动态去重（generationKey/requestKey 幂等）、追踪真源+乐观并发（novel_trackings/stateRevision）、上下文预算裁剪（ContextAssembler）、拆文断点恢复、能力注册表+诚实状态、技能阶段路由、AI 腔轻量检测、六项机检、原子事务写入。

**部分实现（有关键语义缺口）**：持久化重试调度（跨重启）、统一长任务队列与状态、断网续跑（上游 job resume）、事件日志、产物 current/stale 判定、章节状态流转（仅 draft/final）、成本定价与每调用账单、自动修订闭环、后台长任务执行、正文版本链/导出备份。

**仅参考**：oh-story 多 CLI 适配层、inkos 三层记忆的投影与索引方式、DeterminFlow 插件宿主形态。

**缺失**：运行身份守卫（防配置漂移）、通用任务 runner + 恢复点、append-only 事件日志、版本回滚、书级写锁租约（DB 下可用乐观并发替代，不强制）。

**不建议引入**：DeterminFlow 的 JSON 文件当数据库与桌面壳复用、ArcReel 全部视频域模型与供应商胶水代码、inkos 的每章文件风暴 / PID daemon / 单机 SQLite / secrets 明文、oh-story 的 browser-cdp 刷榜与纯提示词审查；以及一切 AGPL 代码的直接嵌入（仅理念借鉴与抽象重写，不整文件拷贝）。

## 4. 分阶段实施建议

### Phase 1：任务运行时（对齐 DeterminFlow/ArcReel 长任务语义）——小说生产最关键
1. 统一长任务表（scope/operation/status/attempt/retryAt/errorClass/providerJobId/idempotencyKey）+ 轻量 runner：章节生成、长拆解、扫榜、结算都登记任务记录（P0）。
2. 持久化重试调度：retry_at 落库，服务启动扫描到期任务续跑（P1）。
3. 断网恢复：provider 层记上游 job_id + 冻结 endpoint 身份，提供 resume 端点（P1）。
4. append-only 事件日志（story_events：seq+type+payload+clientKey），UI 时间线唯一读源（P1）。
5. 长拆解转后台 batch（P1）。

### Phase 2：小说域状态与事务（对齐 inkos/oh-story）
6. 章节状态机扩展（drafting/auditing/audit-failed/revising/approved…）+ 显式审查修订流转（P0）。
7. 正文版本链（修订/重生成/恢复留痕）+ 整书导出/备份/恢复（P1，本地工作台硬需求）。
8. 产物 current/stale 判定（设定变更后候选/摘要失效诊断）（P1）。
9. 自动修订闭环限 1 轮（质量门不过→带原因重生成→再审）（P1）。
10. 结算失败降级路径 state-degraded（P2）。

### Phase 3：技能/供应商/多 Agent 编排（对齐 DeterminFlow 运行时 + ArcReel 供应商层）
11. provider 注册表 + 凭据归属 + 分层定价（估算/结算分离）——BYOK 隔离商业前置（P0，圆桌已定路线）。
12. 运行身份守卫（生成时冻结模型+技能 hash，复用前核验）（P2）。
13. 技能工具化时的权限模型（每技能工具装配 + 路径沙箱 + 轮次限制）（P2）。
14. 多节点管线（DAG 冻结 + 依赖链 + 审批节点）待 Phase 1-2 验证后再评估（P2+）。

### 明确不做（当前 MVP）
- ArcReel 视频/漫剧专属域全部；DeterminFlow/ArcReel/inkos 代码直接嵌入（AGPL）；inkos 文件风暴/daemon/SQLite 模式；oh-story hooks/commands 适配层与 browser-cdp；storyrepo 相关机制在未核源与许可前不进入产品代码。

## 5. 许可证与风险汇总

| 项目 | 许可证 | 商业风险 | 处理原则 |
|---|---|---|---|
| DeterminFlow | AGPL-3.0 | 直接嵌入/衍生并对外提供服务 → 开源义务 | 只借鉴机制（本矩阵机制均为可独立实现的抽象），不整文件拷贝 |
| ArcReel | AGPL-3.0 + NOTICE §7 署名 | 同上 + 修改版须保留 Powered by 署名，名称/logo 商标保留 | 同上；机制借鉴不触发署名义务，但引用思路时保留出处 |
| inkos | AGPL-3.0-only | 同上；对外分发（含打包上架）即触发 | 同上；其机制（状态机/锁/版本链）均为通用工程抽象 |
| oh-story | MIT | 低；但仓库内素材/第三方依赖逐项核对；**storyrepo 不在此列** | 可移植脚本（check-ai-patterns 等）需保留版权声明；storyrepo 单独核源 |

## 6. 证据索引

- 四份深度报告：DeterminFlow/ArcReel/inkos/oh-story（研究会话产出，可回读 /tmp/inkos-report.md、/tmp/gh-four/ArcReel_code_structure_report.md）
- 墨舟代码：app/lib/runtime/（types/generation-plan/skill-run/context-assembler/service）、app/lib/pipeline/（engine/reducer/validate）、app/lib/novels/（chapter-candidate/chapter-chat/chapter-replay）、app/lib/story/（tracking/checks/capabilities/deconstruction-pipeline/rankings）、app/lib/schema.ts（27 表）
- 既有文档：docs/novel-production-stack-comparison-2026-08-16.md（本矩阵为源码级修订版）、docs/mozhu-commercial-readiness-final-2026-08-12.md、docs/launch-readiness-2026-08-16.md、CONTEXT.md、ADR-0006
## 7. OpenWrite 炼化补充（非 GitHub 四项目；OB 逆向资产 + 本地 v1.3.2 客户端，检查 2026-08-16）

> 语料：OB 15 篇（完整产品逆向资产/黑客无痕提取数据包/客户端逆向/动态分析/竞品分析/官网定价/红队审计/会员破解验证/复现实战/08-16 三篇墨舟吸收笔记），全部精读。OpenWrite = Flutter 桌面/移动 AI 小说写作助手（PHP API + New API 网关 + 发卡 VIP + WebDAV 坚果云）。

| OpenWrite 机制 | 上游证据 | 墨舟当前落点 | 等级 | 说明/缺口 |
|---|---|---|---|---|
| AI Agent 工具面（file_read/write/modify、system_command、web_search、ask_user、skill_lookup、novel_ranking、create_project、create/update_skill） | 完整产品逆向资产 §5；黑客无痕提取 §三（工具定义全文） | 技能无工具面（正文经受控 mutation 协议） | 缺失（Phase 3） | Phase 3 权限模板：危险命令需用户批准、交互式命令阻止、大输出写临时文件返回路径、file_read 外部路径需确认、目录沙箱（file_read_allowed_dirs） |
| novel-writer 工作流（读维护文档→读最近5章→生成≥2000字→先展示→question 确认→写入→确认更新维护文档） | 黑客无痕提取 §2.1（SKILL.md 全文） | ContextAssembler 上下文装配 + 候选先展示后确认 + 正文写入 + 追踪结算 | 已吸收 | 等价物齐全；墨舟确认动作显式（插入/丢弃），OpenWrite 靠 question 工具 |
| Skill 三级加载（元数据常驻→SKILL.md≤500行按需→references 按需） | 黑客无痕提取 §2.2（skill-creator SKILL.md） | SkillRuntime 按阶段路由 + skipped 证据 + token 预算裁剪 | 已吸收（更严） | 墨舟契约化/证据化，OpenWrite 靠 agent 自律 |
| 上下文压缩（context_limit=200k、reserved_output_tokens=16k、compressedThroughMessageId） | 黑客无痕提取 §四 | lib/chat/compress.ts（摘要注入 + kept history，P0 已修复） | 已吸收 | 一致 |
| 停止生成 + 状态保护 | 竞品分析；08-16 可借鉴点 | stop 端点 + stopped 终态 + 迟到完成不回写 | 已吸收 | 等价 |
| 会员服务端 gating（离线破解不可行：本地内存 gating、状态源服务端、SHA256 签名、强制更新） | 会员离线破解验证 | 墨舟会员未实现（支付/权益 P0 未开放） | 缺失（商业期） | 架构红线：gating 必须服务端裁决，客户端只缓存展示 |
| 免费模型 + 自定义 API（BYOK 混合，公益模型 deepseek-v4-flash-free） | shared_preferences（llm_base_url/api_key）；官网定价 | 08-16 圆桌已定四类来源隔离路线 | 部分实现 | 尚未实现 provider 注册表（Phase 3） |
| 安全反面教材（明文 HTTP、公告注入无校验、本地 VIP 字段、AI 终端命令面、Skill=提示词+代码+命令供应链、书源 SSRF） | 客户端逆向安全观察；动态分析 E-007（注入已演示）；红队防护方案 | 墨舟生产已 HTTPS/Secret Manager/服务端鉴权/书源受控 | 已规避 | 防护清单：全链路 TLS、服务端权威状态、技能沙箱、书源 URL 白名单、凭据不回传客户端 |
| 竞品弱点（无版本历史/回滚、世界观仅文件、无故事结构工具、非本地优先） | 竞品分析 | 墨舟 + InkOS 方向恰好补齐 | 参考 | 差异化空间 |

**OpenWrite 炼化结论**：价值 = ①生成反馈阶段化 + 受控写回 + 停止保护（08-16 已吸收进墨舟原型 9f6f8e4 与作品方向注入）；②Phase 3 工具权限面现成模板；③会员 gating 架构与安全红线。不复制：直接文件写入、终端命令、明文传输架构、Skill 供应链形态。

