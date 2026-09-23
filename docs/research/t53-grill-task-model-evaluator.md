# t53 · grilling 裁决：TaskModelEvaluator 演化信号与建议契约（#53）

> 票源：#53（wayfinder:grilling）· 研究输入：t49-c（docs/research/t49-c-task-model-evaluator.md）+ t50-d 命名空间断裂发现
> 方法：票面 C1–C7 逐项对照第一手证据（repo 文件:行号均已复核原文，非转抄研究文档）；推翻须给出规格/ADR/代码级证据。
> 纪律：本票纯文档产出，不改码、不做 git 操作。

## 0. 裁决总览

| 项 | 议题 | 终裁 |
|---|---|---|
| C1 | 只读投影器定位 + L1 资格门 | ✅ 批准 |
| C2 | cell 主键 + taskRef 同窗 join | ✅ 批准（含硬前置：#50-P1 桥接先行） |
| C3 | acceptance/edit_ratio 口径 | ✅ 批准（附记零边界条款） |
| C4 | 阈值五规则数值 | ✅ 批准（R1 锐化、R3 加地板效应条款、R4 切窗机制定案） |
| C5 | 防过拟合四件套形态 | ✅ 批准（V1 影子期 = 时间切窗，可比性边界钉死） |
| C6 | RoutingSuggestion 契约与落点 | ✅ 批准（附重算输入面澄清） |
| C7 | 包位 packages/flywheel | ✅ 批准（附建包时机约束） |

**DEFER：无**——七项均有充分证据可给唯一答案，不和稀泥。

---

## C1【终裁：批准】只读投影器；Benchmark L1 判定器 = 资格门，顺序不可倒置

**理由**
- 测量面确已齐备，无新造必要：运行态信号由账本事件面（kernel/src/domain-events.ts:19-34 十四词条）+ usage.jsonl（pipeline/src/record-step.ts:23,36-52 冻结形状）承载；基准态由 T20 六指标判定器（benchmark/src/types.ts:32-39 METRIC_GATES）+ M14 版本矩阵钩子（benchmark/src/version-matrix.ts:47-54 matrixRowFor）承载。evaluator 若自建测量面即违反工程原则 2/UVSD §1.2。
- 资格门前置是 ADR-0008 的直接推论：Consequences 明文「Every architectural, prompt, or skill upgrade must mathematically demonstrate parity or improvement against historical baselines」（adr/0008 §Consequences L36）；且 KNOWLEDGE_LEAK_RATE ≤0、PROMISE_RECALL ≥1、CONTEXT_BUDGET_OVERFLOW ≤0 是恒值目标（types.ts:34-37），偏好信号再好也不能赎回机械门失败——顺序倒置等于允许泄漏模型靠「作者喜欢」上位。
- evaluator 本体纪律对齐 T20 同界：纯函数、注入时钟、零 LLM（benchmark/src/run.ts:4-6 三锚先例）。

**给实现票的定案值**
- evaluator = 纯函数投影器；输入面固定为三件：readPipelineLedger 双格式读面（pipeline/src/ledger.ts）、usage.jsonl 读面、基准矩阵行存档；输出 RoutingSuggestion[]。
- R1 资格门判定函数直接消费 evaluateMetricGate × METRIC_GATES（types.ts:42-48），禁止复制门限表。

## C2【终裁：批准（含硬前置）】cell 主键确认；但 taskRef 同窗 join 今天不可计算，#50-P1 桥接是其前置票

**理由（这是本次 grilling 最重要的修正）**
- 主键形状本身正确：taskType 取自 GenerationStarted.snapshot（runtime/src/engine.ts:117-122）；route 用 providerId×model 复合键与 TierRoute 对齐（runtime/src/tierConfig.ts:14-19）；recipeVersion 可空收窄沿 readRecipeVersionFromPayload 宁败不猜判例（version-matrix.ts:22-29）。
- **但 join 前提当前为假**：engine.execute 自铸 taskRef（engine.ts:114），发布 GenerationStarted 仅携 {snapshot}（engine.ts:123-127）；usage 行挂的是会话侧 taskRef（record-step.ts:69-70 注释明示「编排方从 ChapterProductionSession.taskRef 取」）；draft-step 把 recipeId/recipeVersion 传进 execute 业务 payload 后被引擎丢弃不落账（draft-step.ts:324-330 → engine.ts:126 只发 {snapshot}）。t50 §0.2 结论经独立复核成立：**今天没有任何账本字段把两个命名空间连起来**，per-model/per-recipe 接受率在账面上不可算。
- 修复路径已备且代价极小：DomainEvent 既有可选字段 chapterIndex（domain-events.ts:42），P1 三槽位补丁全部落在 payload/既有可选字段层，零词表变更、EVENT_PAIRS 零触碰（domain-events.ts:47-51 不动），旧读者整体透传不受影响。

**给实现票的定案值**
- cell := (taskType, providerId, model, recipeVersion | null)，四元组全等才算同 cell。
- join 键 = parentTaskRef（会话侧 taskRef），依赖 #50-P1（parentTaskRef / chapterIndex / eventPayload{recipeId,recipeVersion} 整批落地，同一接缝 execute 签名 + DraftStepRequest，采纳 t50 Q-A 推荐整批不拆票）。**C2 实现票必须排在 #50-P1 之后；P1 未合入前 evaluator 只允许产 watch 条目。**
- recipeVersion=null 的样本行只计观察聚合，不得作为任何 promote/demote 的 basis（配方身份不全，无法走版本矩阵回归证据链）。
- resubmission 多对生成按 parentTaskRef 分组成 attempt 序列；禁止沿用「最近一条 GenerationFinished」邻接启发式（draft-step.ts:241-251，S11 单飞耦合，离线分析不可依赖——t50 Q-E 一并裁定：P1 落地后实现票顺路改为显式桥接查询）。

## C3【终裁：批准】acceptance 仅在多候选择优窗口定义；edit_ratio 无编辑记 0 是正信号

**理由**
- 多候选是显式触发动作且有机械闸：<2 选项直接抛错（multi-candidate.ts:55-57），未触发的章没有偏好事件可言。全章摊派会把「作者没开候选」混进分母，稀释信号并引入 UI 曝光噪声——研究口径（t49 §1.6 G4）成立。
- 分子质量有双重机械保障：accepted/rejected 双路强制同账才构成合法信号（multi-candidate.ts:121-125），决策 id 必须回溯到本窗 CandidateCreated 行、凭空决策宁败不猜（multi-candidate.ts:131-136）。
- edit_ratio 记 0 方向正确：blocks 结构化折算精确（user-edit-step.ts:65-71 行闭区间），「一字未改」对改写负担指标就是最优读数；若改记缺数据，反而把最强正信号丢掉。

**给实现票的定案值**
- acceptance_rate 分母 = 该 cell 内 candidate_decision 形态 UserEditRecorded 行数；分子 = accepted 非空决策数。仅统计双路合法行（单路行发射端本就拒绝，防御式再过滤一层）。
- edit_ratio 定义域 = 走完 user_edit 步的 committed 章；Σblocks 覆盖行数 ÷ 章正文总行数。**边界条款：该步无任何 UserEditRecorded 行 ⇒ 记 0；章未走完 user_edit 步 ⇒ 不入分母也不记 0**——两种「没有编辑行」语义不同，实现票必须分开处理。
- 已知混淆如实记录：记 0 无法区分「审过没改」与「没细看」。V1 接受此噪声（单作者本地流，跨窗相对比较仍有效），缓解靠 S1 显式偏好独立成轴 + R4 双窗确认；不为此新增审查标记埋点（违只读投影器边界）。

## C4【终裁：批准（两处修订）】阈值五规则逐条拍板

**R1 资格门前置 —— 批准并锐化。**
- 「最近一次基准运行」存在陈旧漏洞：若该次运行早于 challenger 当前 recipeVersion 或早于新 CASE 入册，门禁证据失效。ADR-0008 §3 明文「No context policy or prompt recipe can be deployed if any historical CASE fails」。
- **定案：资格门证据 = 针对 challenger cell（route×recipeVersion 组合）在当前 CASE 全集上的最近一次复跑报告（matrixRowFor 产物存档），且夹具集 ⊇ 当前 CASE-NNNN 注册集；无此报告 ⇒ 只能出 watch，不得 promote/demote（demote 走 S6 失败率路除外，见下）。**

**R2 最小样本 —— 批准原值：≥30 decision 且 ≥5 独立章窗口。**
- n=30 时 Wilson 区半宽约 ±18%（p=0.5），配合 R3 双条件与 R4 双窗是可用的下限；再抬门槛会让单作者显式候选流永远够不着（多候选是显式触发，产量天然低），再降则区间无意义。不足时产 insufficient_sample 观察条目，信号不丢失。

**R3 Wilson 双条件 —— 批准主判据，加地板效应条款。**
- 主判据维持：challenger Wilson95 下界 > incumbent Wilson95 上界（S1），且 S2 相对降幅 ≥10%，双条件同时满足。
- **新增地板效应条款：incumbent edit_ratio < 0.05（每百行不足 5 行改动）时，S2 相对降幅判据失去分辨力（低基线上 10% 相对值是噪声量级），改为要求 challenger edit_ratio ≤ incumbent + 0.01（绝对不劣化即可），S1 双区间仍必需。** 这是数值定义修补而非方向变更。

**R4 滞后确认 —— 批准两窗口，切窗机制定案如下。**
- **窗口 = 连续不重叠观测段：自上一窗结束起，满 14 天或满 20 个新 candidate_decision，先到者切窗。** 每窗须独立满足 R2 才计入滞后计数；两窗优势方向相反 ⇒ 计数清零重计；首窗只产 watch。「或」字保留——高产期按量收敛、低产期按时间收敛，适配单作者流量形态。

**R5 单变量单 cell —— 批准原样。**
- providerId+model 成对整体替换尊重 TierRoute 复合键（tierConfig.ts:14-19）；api_key_ref 归作者配置侧补（ROUTE_KEYS 白名单 tierConfig.ts:63，密钥本体永不入配置文件）。多 cell 恶化按（优势宽度×样本量）排序逐个出建议——确定性排序，可实现。

**反向信号（demote）—— 批准。** incumbent 连续两窗跌破资格门，或 S6 失败率 ≥2× 既有基线且 n≥10 → 出 demote 建议；同样只建议不改。S6 数据源（TaskAttemptRegistered 密度 / GenerationFinished 失败态 / FlywheelRecorded outcome=state_degraded，engine.ts:137-141,154-184 + record-step.ts:126-137）均在账。

## C5【终裁：批准】防过拟合四件套形态确认

1. 最少样本（R2）：如上，30/5 定案。
2. Wilson 区间（R3）：二项比例小样本正确工具，裸均值比较否决。
3. **影子期 V1 形态 = 时间切窗先后对比 + CASE 回归守护 —— 批准。** V1 全局单飞 + 单作者，真并行双轨物理不可行（同一章只能有一个 route 生成）。时间切窗的趋势漂移噪声由「收敛孪生」兜底：线上改善必须能在基准夹具复现（USER_EDIT_RATIO_REDUCTION 运行级判据，run.ts:66-68,128），否则视为噪声。**可比性边界钉死：时间切窗结论只在「同 taskType × 同 recipeVersion」内可比；跨 recipe 迭代对比一律走版本矩阵（T2A），禁止拿时间切窗数据横跨配方版本下结论。** V1.5 书内 routing.yaml 覆盖层真双轨留待后续（runtime-capability-spec.md §6 L119）。
4. CASE-NNNN 回归守护 —— 批准。ADR-0008 §3 为硬约束；promote 建议必附「当前 CASE 全集复跑六指标且全过」的证据（matrixRowFor 行引用进 basis.matrixRowRef），与 C4-R1 锐化条款互为表里。

## C6【终裁：批准】只建议不自动改路由；既有校验+热加载生效；suggestions.jsonl 派生面不入账本

**理由**
- 「校验器本身就是安全栏」成立：loadTierConfig 机械 fail-fast（tierConfig.ts:24-28 四类错误码 + 密钥明文拦截 ：63,86-103），mtime 缓存热加载免重启（tierConfig.ts:198-202 mtime 相等复用快照，否则重读重验 ：204-220）。新建写入通道 = 绕开已有安全栏另铺一条路，违反原则 2 与 UVSD §1.2（自动改路由无旅程背书，「作者审阅后代写 settings.yaml」有）。
- 不入真源账本正确：建议是派生面；且新增 RouteSuggestionIssued 属词表受控增补，须走 T16 判例全套（domain-events.ts:4-13 头注），为一个可重算的派生物动 kernel 词表不成比例。
- 冻结形状（t49 §4.1）逐字段核过：suggestionId 铸法沿 record-step.ts:87 先例、createdAtUtc 注入时钟禁 Date.now（run.ts:69 同款）、basis.matrixRowRef 关联 VersionMatrixRow（version-matrix.ts:32-38）——形状可直接冻结。

**一处澄清（防止实现票误解）**
- 「随时可由账本重算」不完全准确：basis.benchmarkGatePassed / matrixRowRef 的重算源包含基准运行产物存档（不在 events.jsonl 内）。**实现票必须写明重算输入面清单 = events.jsonl（readPipelineLedger 双格式）+ usage.jsonl + 基准报告/矩阵行存档三件**，缺一不可重算。

**给实现票的定案值**
- 落点 `.mozhou/suggestions.jsonl`（与 usage.jsonl 同区同级，record-step.ts:23 先例），append-only JSONL，运行时区非 canon 不参与对账。
- 读侧规则：以 (cell 四元组, kind) 最新一条为准，不去重不改写历史行（append-only 纪律）。
- 生效路径照 t49 §4.2：报告渲染 → 作者确认 → 人为/确认命令代写 ~/.mozhou/settings.yaml → loadTierConfig 校验+mtime 热加载即时生效（tierConfig.ts:189-221）→ 变更后首窗强制 watch 态复评。

## C7【终裁：批准】新建 packages/flywheel，三 learner + 投影器同址

**理由**
- 边界论证成立：pipeline 是十步编排域（steps.ts 单窗推进），learner 是离线投影域，依赖集不同（前者面向 PublishBus 写侧，后者面向 readPipelineLedger/usage/矩阵行读侧）；混居让 pipeline 包出现只出不进的畸形单向依赖。现状六个包（benchmark/context-compiler/data-plane/kernel/pipeline/runtime，ls 实证）无容纳处，散入任一包都是错位。
- 不是投机抽象：三个具体消费者已在批准旅程内（Phase 4 #46 地图下 t47-a/t48-b/t49-c），共享读面真实复用；依赖方向 flywheel → {kernel, pipeline(类型+ledger 读面), runtime(tierConfig 只读), benchmark(矩阵行)}，单向无环，pipeline/runtime 不知道 flywheel 存在。
- benchmark 保持独立不入 flywheel：它是 ADR-0008 一等子系统、先于飞轮存在（T20/#44 已交付），flywheel 是它的消费者不是容器。

**给实现票的定案值**
- 新建 packages/flywheel；**建包时机 = 第一只 learner 实现票落地时随票创建（谁先到谁建），不预建空壳包。** 包内第一版只放该 learner 本体 + 其测试；禁止预铺 LearnerBase 之类抽象基类或共享框架层（三 learner 形状差异大，等第二个 learner 出现再看是否提取共性——原则 2/3）。
- evaluator 的 RoutingSuggestion 形状与 suggestions.jsonl 读写缝归 flywheel 包；六指标门限消费只用 benchmark 导出面（evaluateMetricGate/METRIC_GATES/matrixRowFor），禁止 import 其内部模块。

---

## 附 A：t49 §5 开放问题归宿（全部闭合）

| # | 问题 | 归宿 |
|---|---|---|
| 1 | G1 接线归属 | 随 #50-P1 整批（execute 签名 + DraftStepRequest 同一接缝，拆票两次动同一签名不划算）；是 C2 的前置票 |
| 2 | 建议是否入账 | 不入账本，落 suggestions.jsonl（C6） |
| 3 | R2–R5 数值 | C4 定案 |
| 4 | 影子期形态 | V1 时间切窗 + 收敛孪生兜底，可比性边界见 C5-3 |
| 5 | 包位 | packages/flywheel，随首只实现票创建（C7） |

## 附 B：给实现票的依赖序（直写）

`#50-P1 桥接补丁（parentTaskRef/chapterIndex/eventPayload 整批）`
→ `flywheel 建包 + evaluator 投影器（watch-only 起步）`
→ `R1–R5 阈值引擎全量启用（含地板效应条款与切窗机制）`
→ `确认命令代写 settings.yaml 闭环（loadTierConfig 校验栏复用）`

每一步都可独立验收；P1 未合入前 evaluator 不得产出任何 promote/demote。

— 裁决完毕 · 2026-08-24 · 七项零 DEFER —
