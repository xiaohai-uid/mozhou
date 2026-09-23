# T66 语义层与复用面 Grilling 终裁记录（issue #65）

> 主持：Wayfinder grilling ｜ 日期：2026-08-27 ｜ 状态：终裁定稿
> 输入：票面 #65 决议项 + t64-grilling-input（D08-D16/D23-D28 + R3-R5）+ t61/t63 研究 + 规格/ADR/代码复验
> 基线纪律：研究建议为基线；推翻必须给规格/ADR/代码级证据；数值类一律给定案值；无法决断 → DEFER。
> 行号口径与 t64 一致；本票所有代码/ADR 锚点均已在本会话复验（proposal-port.ts 全量、reconciliation.ts 抽点、domain-events.ts 全量、token-budget/context-receipt 规格、ADR-0003/0014/0019/0021/0024）。
> 范围说明：票面只列 D08-D16、D23-D28、R3-R5；D17/R1/R2（语义输入面终裁）不在本票清单，其影响以"关联裁定"标注、不越权定案。

## 0. 全局裁定（先立三条，贯穿下列各项）

- 【终裁】V1 语义层 = 只读旁路分析器，全链路无默认写口；任何判定不得离开 报告文件→指针事件→派生投影 三条通道（D08/D14 合流）。
- 【终裁】确定性层与语义层边界按 ADR-0024:26（Gate 纯机械 + LLM 旁路）+ ADR-0003（Step1 确定性遍历 / Step2 语义评估 / Step3 作者动作）双锚定，本票所有"谁写谁不写"裁决以此为母版。
- 【终裁】词表纪律（domain-events.ts:4-6 唯一真源 + 死词条禁止回填 :9-10）全程适用；本票批准的全部新词条均带发射方义务，禁止"先加词后实现"。

## 1. 语义层决议（D08-D16）

**D08 语义层身份：advisory-only 只读旁路分析器**
【终裁】批准。S1 上下文适配 / S2 正文-上下文提示 / S3 软性标定入 V1；MUST-NOT-1..5 进验收清单。
证据：ADR-0024:26（Gate 纯机械、LLM 审查降为旁路建议——身份母版）；ADR-0003 决策 Step3（"作者导向动作，绝不静默改写下游正文"）；ADR-0019:14（受保护作者内容，上游重算只能标 stale、禁清除/覆写）；t49-c.md:13（旁路分析器不写路由/配置先例）。MUST-NOT-1 硬冲突→ADR-0014:9-17；MUST-NOT-3 预算→token-budget-assembly-spec.md:70-72（估算器严禁进核算路径）；MUST-NOT-5 真伪→ADR-0019:11（图通道权威、embedding 仅回退）。
定案：S1-S3 实现票可直写（t61:2.3 逐条照录）；MUST-NOT-1..5 各配文件:行号锚点进验收 AC；补 MUST-NOT-6：永不代作者调用 ProposalPort 三动词（与 D15 合并）。无数值。

**D09 载荷形态：新载荷 SemanticAnalysisReport（结合 R3 定案）**
【终裁】批准新载荷、本体不复用 Receipt；R3 同构槽定案 = 引入 entries 同构槽、不引入 replayInputs 同构槽、structural 同构槽 V2 缓。
证据：Receipt 是 (inputs, modelProfile, configVersion, tokenizerVersion) 纯函数输出、同输入逐字节复现（token-budget spec:62-63），非确定性 LLM 判定写入即摧毁 recomputationHash 可复算承诺（context-receipt spec:37,93-94）；Receipt 不可变 I5（spec:39）；死事件已删不可回填（domain-events.ts:9-10 + ADR-0024:26）。replayInputs 槽不成立的证据：重放输入面是 Receipt 契约（spec:79-97），报告锚点已持 receiptId+recomputationHash 指向它——再引入要么内嵌内容本体（违 spec:86 + INV-R5 spec:152）、要么是冗余指针；t63:2.1 的 replayInputs 适配判断针对测试输入固化（T10b 台架夹具职责），不构成报告 schema 需求。
定案：新载荷一报一文件 .mozhou/semantic-analysis/report_<ULID>.json，必带 anchor{receiptId,recomputationHash,chapterIndex,taskType}；entries 槽 = 逐条对位单元（稳定 identifier 键、schema 自闭合于语义层，仿 proposal-port.ts:162-166 泛键值+自闭合形态）；Receipt 生命周期字段（included/excluded/exclusionReason/pending/finalized）一律剥离，覆盖统计用独立计数字段（inputStats.entriesIncluded/Excluded，t61:3.4 已有）；宿主字段级实证为实现票 P0（见 DEFER-4）。

**D10 输入契约：receiptId+recomputationHash+changeSummaryDigest 锚点；T5 摘要带引用不内嵌**
【终裁】批准。
证据：ChangeSummary 判别联合与五类 summarize 提取器已存在（reconciliation.ts:115-147，:196 Extractor，:563-565 extract 注入缝——已复验）；内容本体一律不内嵌（spec:86）；EventLedger 只持指针（ADR-0021:22）。
定案：reconciliationRef{proposalId, changeSummaryDigest}（可选字段），digest = sha256(canonicalJson(ChangeSummary))，自证"评估的是哪版对账状态"；全文/正文/条目内容绝不进入 payload；不引入第二真源。

**D11 降级：L0 跳过 / L1 确定性兜底（默认不做）/ L2 退避重试；永不静默 mock**
【终裁】批准三级结构，L1 明确定案 = V1 不做，且【裁定】即便未来做也落确定性层投影、不进语义报告。
证据：生产永不静默回退 mock、失败必须显式（AGENTS §4 规则 14/15）；失败装配不产凭证、走错误事件（spec:134-136, ADR-0021:6）；L1 价值未实证（t61:6.2-1）；边界论据：L1 的"机械 finding"信号（relevanceScore 分布、exclusionReason/trimType 计数、entryCount 波动）本就是确定性装配的产物（receipt entries/replayInputs 已归档），塞进语义报告即把确定性功能搬进 LLM 面 = D05 边界污染——该职责属于确定性遍历/投影面（E4），不属于 SemanticAnalysisReport。
定案：L0 = 不产报告文件、发 SemanticAnalyzed 指针事件 payload{receiptId, chapterIndex?, taskType, refusal, findingCount:0}、reportId=null；硬不变量：refusal 非空 ⇔ reportId 为 null（互斥必居其一，校验器强制）；L2 = 重试 3 次、退避 1s/2s/4s（常数 RETRY_LIMIT=3, backoff=1s×2^n），超限转 L0；L1 立项评估挂 DEFER-1。

**D12 候选排序与批量：pin→对账命中→stale→主线；批量传输单报产出；窗口不足回退单章**
【终裁】批准，数值定案。
证据：既有候选全序先例（token-budget spec:66-67：pinned DESC → tierRank ASC → relevanceScore DESC → id ASC）；receipts SQLite 投影已含 chapter_index/created_at 排序位、无需新表（spec:68-73）；批量只是传输层优化、每章仍一报一文件（t61:4.2）。
定案：排序键 = ①显式 pin（手动 pin 有实据：ReceiptEntry.activation 'manual_pin'，spec:121）→ ②对账命中（reconciliationRef 存在）→ ③stale（距上次评估最久，沿 ADR-0019:14 语义）→ ④主线（chapterIndex 邻近当前进度）→ 平局 id ASC 收口；"受影响集命中"这一排序位的正式并入待 D17 专票（本票不越权，见范围说明）；batch = 3 章（同 taskType 相邻，常量 semanticBatchSize=3，允许域 1-5），共享 rubric + 共享上下文条目，每章独立 report 文件；批量输入超模型窗口（阈值见 D13）回退单章；每轮 maxReportsPerRun 截断、超出标 deferred 不静默丢。

**D13 token 上限：min(totalTokens×1.0, 16384) 输入 + 输出 ≤512**
【终裁】批准数值定案。
证据：装配包已受 B_total = W − R_out − margin 约束（token-budget spec:76-79）、正文切片受保留配额约束（spec:53 / ADR-0019:12）；计量一律服务端精确 tokenizer、估算器禁核算路径（spec:70-72）；16384 为推断占位（t61:3.3 自标【推断】）。
定案：semanticInputTokensCap = min(装配包 totalTokens × 1.0, 16384)，按"每报告"（每章）计量；输出判定固定小 JSON ≤ 512 tokens；批量调用总输入硬约束 = 模型窗口 × 0.8 − 512，超出即按 D12 回退单章（不新增预算参数）；16384 冻结为 V1 契约值——T28 开工以语义分析实际模型 profile 复核一次，任何改值须走 Contract Delta（AGENTS §3）；报告本体不进预算装配路径、不参与 recomputationHash。

**D14 语义结论入账：报告文件先 → SemanticAnalyzed 指针事件后 → SQLite 派生投影**
【终裁】批准。
证据：崩溃一致序先文件后事件（spec:60-67, ADR-0021:22-23）；不变量 INV-R1 孤儿 receipt 合法、悬空指针非法（spec:148）；不成对事件先例 StyleProfileUpdated（domain-events.ts:14-16）。
定案：顺序 报告文件 → 指针事件 → 投影，绝不倒置；SemanticAnalyzed payload = 指针摘要 {reportId, receiptId, chapterIndex?, taskType, verdict, findingCount, refusal?}，taskRef/chapterIndex 走 DomainEvent 顶层槽位（domain-events.ts:42-48），禁塞 payload/禁新增顶层字段；投影表 semantic_analysis(report_id PK, receipt_id, chapter_index, task_type, created_at, verdict, finding_count, provider, model, input_tokens, output_tokens)，可弃重建 = 扫目录（spec:68-73 先例）；L0 refusal 事件不产生投影行（留痕在 events.jsonl，对齐 spec:134-136 失败错误事件先例）；校验器：事件引用的 reportId 必须指向存在的报告文件，反向悬空即报错。

**D15 与 ProposalPort 关系：默认不参与；critical 至多 style 式旁路；永不代作者调用**
【终裁】批准——V1 零 ProposalPort 集成点，只记录 suggestion；critical→style 桥接 V2 缓。
证据：ProposalPort 是需作者逐条确认的变更面（三动词 confirm/reject/editAccept，proposal-port.ts:197-219）；style 后端"永挂待决、只 confirm 生效、listPending 唯一注册"（proposal-port.ts:162-166/169-174/405-411/412-431）；合成 ref 已把 proposalId 拉伸为 'style:'+id（:257-258）——再为语义建议拉伸即命名空间污染加重恢复面；Port 决策不新增事件、审计在提案记录自身（:21-23）——语义建议留在报告文件即可，无事件/无提案需求；ADRP-0024:26 旁路不阻塞。
定案：V1 语义层不存在任何引用 ProposalPortRef 的代码路径；findings[].suggestion 为唯一下沉面；底线三不（不 call 三动词、不写 canon/提案文件/配置，t61:5.2）；桥接触发条件（作者把 critical 转可确认动作的真实需求）未实证 → 立项评估挂 DEFER-2。

**D16 语义报告保留策略：V1 全保留 vs 裁剪**
【终裁】批准 V1 全保留。
证据：receipt 全保留先例（spec:140 "v1 全保留，清理压至 Gate B 后实测再定"；ADR-0021:21 retention v1 = keep everything）；报告为 KB 级小文件（verdict+findings），全保留使投影重建 = 纯扫目录极简，且保留"为什么这次评估没发现问题"的事后取证材料（与 receipt 全保留同理由）。
定案：V1 无 prune、实现票不写任何清理逻辑；裁剪策略（deferred/旧章）V2 缓，判据草案 = SemanticAnalyzed 引用图 + created_at（对齐 spec:141 prune 预留扩展点形态）。

## 2. 复用面决议（D23-D28；票面编号，括号内为 t64 对应编号）

**D23（t64 D24）不扩 ProposalPortRef 第 4 后端（t63 四条硬证据）**
【终裁】确认，不扩；四条硬证据本会话全量复验无一条失实。
证据：①ref 形态 = 单 proposalId 单条提案（proposal-port.ts:42-45），影响集（多实体）需逐实体合成 ref——'style:'+id 合成已示反例（:257-258）；②PortAction 只有 confirmed/rejected/edit_accepted（:47），style 保底已证决策面只有 confirm 一个生效动作（:417-421）——impact 是只读计算结果、无生效动作；③生命周期污染：pendingItems/finalized（:62-64, 442-444）与 consumed 状态机（:76-77, 287-299），style"永挂待决"已使 finalized 恒 false（:405-411）有前科；④时钟噪声：consumedAt/decidedAt 烙 new Date().toISOString()（:297, :365）——经端口即把噪声带进确定性可重建派生面。
定案：ProposalPortRef 保持封闭三后端不动；impact = E4 派生面只读投影（entity→affected set），沿 kernel 投影合并纪律（domain-events.ts:50）；未来若出现"作者确认影响集"需求，按 d eps 可选注入模式（:176-182）独立立项，不做投机抽象（AGENTS §1.4）。

**D24（t64 D25 + E3 + R4）Traversal 成对 + SemanticAnalyzed 不成对（EVENT_PAIRS 是否一刀切）**
【终裁】定案：成对性按事件语义分派、非一刀切；词表 15→18 可接受。
证据：EVENT_PAIRS 三对 + "head 必须被 tail 闭合、悬挂 head 投影合并时标记"（domain-events.ts:50-55）；StyleProfileUpdated 已成不成对先例（:14-16 "无 head/tail 配对（EVENT_PAIRS 不动）"）——词表本就存在不成对族，纪律的精确形态是「有 head 必 tail；无 head/tail 维度的一次性交付事件不进表」，非新增例外；遍历有生命周期（t63:3 G1），语义判定是单点交付。
定案：TraversalStarted/TraversalFinished 成对入 EVENT_PAIRS（3→4 对，词表 15→17），命名沿 GenerationStarted/Finished 范本（:29-30，备选 ImpactTrace* 否决：与 ADR-0003 "Deterministic Traversal" 术语错位）；SemanticAnalyzed 不成对（词表 17→18），沿 StyleProfileUpdated 先例；三个新词条都必须带发射方实现同步落地（死词条纪律 :9-10）；命名评审 + 契约冻结随 T31；简报 14 vs 实证 15（±1）为非决策项交 T31（见 DEFER-5）。

**D25（t64 R5）派生面指纹剥离时间戳（vault 幂等记忆）**
【终裁】确认剥离；展示字段保留、指纹禁时间戳。
证据：时钟噪声反例实测 = consumedAt/decidedAt 均 new Date().toISOString()（proposal-port.ts:297, :365）；vault 记忆 D1：重建幂等指纹 = 排序后内容集合比较、非物理顺序；t63:4.4 断言面剥离时钟字段。
定案：派生面幂等指纹 = sha256(canonicalJson(sorted(markedChapters, by (chapterIndex, revision))))，禁任何日期/ULID 随机分量；markedAt/createdAt 仅为展示字段（E2 payload 含 markedAt、投影表含 created_at，均不参与指纹计算）；重建幂等测试以排序后集合指纹为断言（t63 §7 第 7 条直接落断言）。

**D26（t64 D26）impact 重算触发：复用 CanonCommitted + 对账终态、不新增触发事件**
【终裁】确认复用、不新增；且本会话实证对账终态信号已存在，无需为语义层/投影层发明任何新事件。
证据：CanonCommitted 在 kernel 词表（domain-events.ts:35）+ Commit 唯一正典写入点（ADR-0024:2）；对账收口论要 emit 'ReconciliationResolved'（reconciliation.ts:916 decideItems 路径——已复验存在），proposal-port.ts:21-23 亦明示"T5 既有 ReconciliationResolved 平铺事件"；对账终态改变章节实体内容 → 投影失效应订阅终态（t63:2.2 末）。
定案：impact 投影订阅面 = CanonCommitted + ReconciliationResolved（data-plane 既有，非 kernel 词表增补）；若 t62 的 D19 补发统一落定信号则一并并入、以不重复为原则；条件性缺口（CanonCommitted 是否覆盖提交路径全部依赖实体变更）由 T25 实证，缺口回填 T25 而非新增事件（见 DEFER-3）。

**D27（t64 D28）黄金对拍台架：dep-graph-10ch + 三层断言 + CASE 守卫**
【终裁】批准。
证据：夹具/断言分层设计（t63:4.1-4.6）；排序后集合比较主断言（vault 记忆 D1）；时钟剥离对象实测（proposal-port.ts:297/365）；直驱遍历 API 不经 ProposalPort（t63:4.5——避免决策通道假信号）。
定案：fixtures/dep-graph-10ch.json 手工枚举固定夹具 = 直线链 ch1→…→ch9 + 跨跳 ch3→ch7 + 菱形汇点 ch5←{ch2,ch4} + 孤立章 ch10；case 表每 case 只改 1 实体 1 字段（改 canon hash 或增删 1 条依赖边）；三层断言：主 = 受影响集合排序后逐项相等（不放宽物理顺序）、次 = 行为级传播深度/影响链逐实体、哨兵 = 受影响集大小/遍历步数（只读、禁当黄金）；断言面剥离 consumedAt/decidedAt 类时钟字段；黄金文件只读入版本库；taskRef 固定注入（绕 engine 生成）。T30 台架票照 t63 §4 落地。

**D28（t64 D27）门禁：资格门 + 四绿**
【终裁】确认。
证据：资格门价值 = "非法台下任何集合/数字不可信"（t63:2.3）——把可复现性从口头约定变门禁；门禁基线 AGENTS §5/§6（TypeCheck/Tests/Build + 不达标不 claim 完成）。
定案：资格门 = 台架运行前置硬校验（引擎/版本锁、输入种子固定、确定性前提就绪），失败即红灯、禁止输出任何断言结果；CASE 守卫 = 每条 case 过 schema 校验（图合法：节点存在、边端点存在、无自环；期望受影响集 ⊆ 可达集），"失败只可能来自遍历实现"成为可证性质；四绿 = TypeCheck / Tests / Build / 黄金对拍台架绿，适用于 T26/T27/T30；投影可重建 → 补重建幂等指纹断言（排序集合哈希）为第六层保障（t63:4.6）。

## 3. 跨研究冲突终裁（R3-R5）

**R3 新载荷 vs 三槽复用（= t64 D23 的定案载体）**
【终裁】本体不复用 ✓、形态同构部分采纳：entries 槽是、replayInputs 槽否、structural 槽 V2 缓——详见 D09。表意复述：SemanticAnalysisReport 自声明 entries 同构槽（稳定分键、自闭合 schema、生命周期字段剥离）但绝不引入 replayInputs 同构槽（重放是 Receipt 契约领地，锚点已指向；重复即冗余或违反 INV-R5）；结构性断言位（依赖边集/传播路径 digest）V2 需求实证后再入 schema。
定案：t64 §3 E6 形状照 D09 定案执行；t63 §7 第 1 条"三槽 DTO 复用方案"实现票按本裁决改写作"entries 单槽同构方案 + replayInputs 明确不引入"。

**R4 成对性 / 词表 15→18 膨胀**
【终裁】可接受；成对性非一刀切——详见 D24。三词条（TraversalStarted/Finished + SemanticAnalyzed）各对应真实处理步骤：遍历生命周期必须 head/tail 收口（悬挂标记机制已存在 domain-events.ts:50），语义判定是单点交付。18 词条是词表补全而非膨胀，前提是每条都带发射方、无死词。
定案：词表 15→18 分两批落地（Traversal 对随 T27、SemanticAnalyzed 随 T28/29），同一契约冻结流程（AGENTS §3）；杜绝"先入表后架空"。

**R5 时间戳：展示保留 markedAt、指纹剥离**
【终裁】确认——详见 D25。投影 schema 含 created_at/updated_at 展示列（审计可读），但重建幂等指纹与所有确定性断言一律排除时间戳与 ULID 随机分量。
定案：见 D25 定案值，不重复。

## 4. t64 §3 受控增补形态确认（票面点名的 E3/E5/E6/E7）

- **E3 SemanticAnalyzed（不成对）**：确认。payload {reportId|null, receiptId, chapterIndex?, taskType, verdict, findingCount, refusal?}；taskRef/chapterIndex 走顶层槽位（domain-events.ts:42-48）；refusal 非空 ⇔ reportId=null（D11 硬不变量）；EVENT_PAIRS 不动。
- **E5 semantic_analysis 投影**：确认。表 schema = D14 定案表；created_at 仅展示、不参与指纹（R5）；可弃重建 = 扫目录；refusal 事件不落行（D11）。
- **E6 SemanticAnalysisReport schema**：确认（形状 = t61:3.4 + D09 定案）：anchor + reconciliationRef? + provider{providerId,model,promptVersion} + inputStats{inputTokens,outputTokens,entriesIncluded,entriesExcluded} + findings[] + verdict + refusal?；findings[].evidence 只引 identifier / 切片引用（ADR-0019:14 + spec:86 零正文泄露）；不看 budget 装配路径、不参与 recomputationHash。
- **E7 .mozhou/semantic-analysis/ 目录**：确认。运行时区非 canon、不参与对账（对齐 receipts 归属理由 spec:27-35：追踪流挂行级对账语义对旁路产物荒谬）；入目录树文档。

## 5. 实现票定案值速查

| 项 | 定案值 |
|----|--------|
| D08 | advisory-only；S1-S3 in；MUST-NOT-1..6 进 AC |
| D09/R3 | 新载荷；entries 槽同构、replayInputs 槽否、structural V2 缓；生命周期字段剥离 |
| D10 | reconciliationRef{proposalId, changeSummaryDigest}；不内嵌 |
| D11 | L0 无文件+refusal 事件（reportId=null）；L1 不做；L2=3 次退避 1s/2s/4s；永不 mock |
| D12 | 排序 ①pin②对账命中③stale④主线→id ASC；batch=3（域 1-5）；deferred 不静默丢 |
| D13 | input=min(totalTokens×1.0, 16384)/章；output≤512；批量总输入≤窗×0.8−512 |
| D14 | 文件→事件→投影；投影表八列；refusal 不落投影；悬空指针非法 |
| D15 | 零 Port 集成；suggestion 唯一下沉；三不底线 |
| D16 | V1 全保留、无 prune 代码 |
| D23 | ProposalPortRef 封闭三后端；impact 走 E4 派生面 |
| D24 | Traversal 对入 EVENT_PAIRS（3→4）；SemanticAnalyzed 不成对；词表 15→18 |
| D25 | 指纹=排序集合哈希；时间戳/ULID 禁入 |
| D26 | 订阅 CanonCommitted + ReconciliationResolved（:916）；无新触发事件 |
| D27 | dep-graph-10ch 夹具；三层断言；CASE 守卫；直驱遍历 API |
| D28 | 资格门 + 四绿（TypeCheck/Tests/Build/台架）；CASE 守卫六条 |

## 6. DEFER 清单

- **DEFER-1 L1 确定性兜底是否值得做**：边界已裁定（做也落确定性层投影、不进语义报告），但"做不做"依赖 V1 生产数据（t61:6.2-1：先跑 L0/L2 再评估）→ 挂 V1.1，数据驱动立项；不阻塞 V1。
- **DEFER-2 critical→style 旁路桥接**：V1 已裁定不做（D15）；V2 触发条件（作者真实出现"把 critical 转可确认动作"需求）未实证 → 需求出现再立项；不阻塞 V1。
- **DEFER-3 对账终态订阅覆盖性实证**：CanonCommitted 是否覆盖提交路径全部依赖实体变更（t63 G4 / t64 D26 疑点）→ T25 实证；若缺口，回填 T25 触发接线而非新增语义层专属事件；不改变 D26 裁决方向。
- **DEFER-4 语义载荷 entries 槽字段级 schema**：t63:1.3 负证据（Receipt 在 proposal-port.ts/kernel 0 命中）——宿主文件与 entries/replayInputs/structural 实际字段语义未实证 → 实现票 P0：grep packages/{pipeline,kernel}/src 与 .mozhou/receipts 读取路径定位宿主后，再定 entries 槽字段级键名/类型；本票已定形态与剥离纪律，不阻塞 E6 冻结。
- **DEFER-5 R6 词表 15 vs 简报 14（±1）**：非决策项（实证 15 词条，domain-events.ts:22-38）；简报笔误 vs 词条拆分待 T31 复核；与 R4 词表增量核算联动。
- **范围外提示（非 DEFER）**：D17/R1/R2（语义输入面 = 受影响 diffs 的载荷携带形态）不在本票清单；本票仅在 D12 排序键/ D14 事件载荷处标注了其影响口，正式终裁留待 D17 专票（t64 预审已倾向候选 (c) + ADR-0003:21 决定性证据，本文不越权）。

## 7. 门禁与交接

- 上述终裁全部落 t64 §4 实现票切分草案：D08-D16 → T28/T29；D23-D28 → T27/T28/T30/T31；E3/E5/E6/E7 → T27/T29 相关票。
- 每张实现票照 AGENTS §5/§6：TypeCheck/Tests/Build 全绿 + 票内测试闭环；git 操作与代码改动不在本票范围（本票纯文档）。

