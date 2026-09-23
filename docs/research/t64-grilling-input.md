# T64 变更影响引擎（Phase 5）Grilling 票输入清单

> 纯文档预审产物 · Phase 5 · 供主会话据此开 grilling 票（grilling ticket input）
> 预审员：Wayfinder grilling 预审 ｜ 日期：2026-08-26 ｜ 状态：草稿（待 grilling 终裁）
> 输入：t60-t63 四路研究（均已定稿）+ ADR 0003/0024/0019 + context-receipt 物理格式规范
> 铁律：候选/冲突只提炼不裁决；数值类建议值标注【需 grilling 终裁】；推荐均带 文件:行号 证据
> 行号口径：研究文档自带行号（t60:3.3 表示该文件第 68-73 行）；代码引用为研究转录的 文件:行号

## 0. 决策项总表

| # | 主题 | 候选 | 推荐（预审倾向） | 出处 |
|---|------|------|------------------|------|
| D01 | 下游索引形态 | a全量倒排 / b现状全扫 / c混合窗内缓存 | c；倒排留缝不建 | t60 问题② |
| D02 | 嗅探触发编排（挂接点归 t62） | 对账收口+Commit 钩子双入口收敛单函数 / 后台 / 手动 | 双入口收敛 + 后台/手动仅降级 | t60:4.2 |
| D03 | 传播写面幂等 | 标记等价短路 / 保持现状非幂等 / upsert | 等价短路（读回全等跳过写） | t60:4.2 |
| D04 | 跨章遍历预算 | 同步硬限 / 阈值降级后台 / 无预算 | 账本≤20k 行、pin≤2k、单次≤100ms【数值需终裁】 | t60:4.2 |
| D05 | Stale 停靠点 | 维持章大纲节点 / 标正文 / commit 粒度 / 独立 impact 投影 | 维持大纲粒度 + impact 投影可选 | t60 问题④ |
| D06 | 钉版组装源（compile 产 manifest 分工） | context-compiler 产 / pipeline compile-step 产 / Phase5 内联 | 随实现票解决（倾向管线侧）【需终裁】 | t60:6.1 |
| D07 | 票面/代码措辞差（SHA vs revision） | 改票面措辞 / 改代码字段 / 维持并声明 | 以代码实证 revision 为准，修订票面与 ADR 措辞 | t60:2.1 |
| D08 | 语义层身份与范围 | advisory-only 只读旁路 / 参与 Gate / 可自动生效 | advisory-only；S1-S3 入、MUST-NOT-1..5 | t61:2.3 |
| D09 | 语义载荷形态 | 新 SemanticAnalysisReport / 折进 Receipt / 复用死事件 | 新 Report 一报一文件 + receipt 锚点；死事件不复用 | t61:3.1 |
| D10 | T5 摘要携带方式 | 仅引用 digest / 内嵌全文 / 不带 | reconciliationRef{proposalId,digest} 不内嵌 | t61:3.2 |
| D11 | 语义输入 token 上限 | 锚定装配包 / 固定值 / 无上限 | min(装配包×1.0,16K) 输入、输出≤512【数值需终裁】 | t61:3.3 |
| D12 | 候选节流排序与批量 | 排序+批量传输单报 / 单章逐个 / 随机 | pin→对账→stale→主线 + 批 3-5 章【批数需终裁】 | t61:4.1-4.2 |
| D13 | LLM 不可用降级 | L0 跳过 / L1 确定性兜底 / L2 重试 | 三级；V1 不做 L1；永不静默 mock | t61:4.3 |
| D14 | 语义结论入账 | 报告+SemanticAnalyzed 指针事件+SQLite 投影 / 仅返回 / 仅事件 | 先文件后事件；投影可弃重建 | t61:5.1,5.4 |
| D15 | 与 ProposalPort 关系 | 默认不参与 / critical→style 桥接(V1) / 代作者确认 | 默认不参与；桥接留 V2 | t61:5.2 |
| D16 | 语义报告保留策略 | V1 全保留 / 按 deferred/旧章裁剪 | 全保留倾向【需终裁】 | t61:6.2-4 |
| D17 | Phase5 遍历输出→语义层输入契约 | 消费 affected diffs / 仅 receipt 锚点 / affected+锚点并存 | ADR 0003:21 已定 Step2 输入=impacted diffs+modified entities，附 receipt 锚点作伴随态【载荷形态需终裁】 | t60:6-3, ADR 0003:21, t61 |
| D18 | 三路径"改动落定"信号定稿 | A 提案终态 / B CanonCommitted / C 复用 A/B（待补读 ADR-0014） | A/B 已实证；C 依赖 P0 补读 | t62:2.4 |
| D19 | 嗅探挂接信号形态（落定事件化） | 补发落定事件/回调 / 轮询 listProposals 终态 / 复用检出事件 | 补发落定事件（现仅检出事件）倾向 | t62:7 P0-2 |
| D20 | 唯一接线形态与顺序 | 数据面公共落定出口 / 事件总线 / 会话内散接 | 单出口顺序 落定→reload→propagate→嗅探；回调 vs 事件需终裁 | t62:4.2,7 |
| D21 | 全书扫描预算参数 | ReconciliationOptions 增 N 章上限+超限分批 / 不加 | 加参数【N 建议 100 章/批，需终裁】 | t62:3.3,7 P1-1 |
| D22 | V1 最小可验证切片范围 | 判据 1-7 全量 / 仅机械段 | 全量倾向；语义段依赖 D17 | t62:5 |
| D23 | Receipt 三槽作语义层载荷底料 | 三槽形态同构+剥离生命周期 / 本体复用 / 不复用借鉴 | 同构 DTO、本体不复用（与 D09 相容） | t63:2.1 |
| D24 | ProposalPort 是否扩 impact 后端 | 扩第 4 后端 / 不扩走派生面 | 不扩（四条硬证据）、派生面只读投影 | t63:2.2 |
| D25 | Traversal 事件增补 | 成对 Started/Finished / 仅 Finished / 不加事件 | 成对入 EVENT_PAIRS，命名过评审 | t63:3 G1 |
| D26 | impact 重算触发 | 订阅 CanonCommitted+对账终态 / 新增触发事件 / 惰性 | 复用订阅、不新增（与 D19/D20 同口径） | t63:3 G4 |
| D27 | 金标准前置层（资格门/CASE 守卫） | 做（分层断言）/ 不做 | 做；受影响集=黄金主断言 | t63:2.3 |
| D28 | 黄金对拍台架与断言 | 10 章夹具+三层断言 / 简化快照对比 | 夹具+排序集合主断言+时钟剥离 | t63:4 |

> 注：编号稳定；D17 跨研究项，D18-D22 为 t62 项，D23-D28 为 t63 项。

## 1. 逐项详情

### 1.1 t60 确定性遍历（D01-D07）

**D01 下游索引形态**
① 问题一句话：DependencyManifest 的"谁读谁"查询用什么索引形态，成本与修复频度如何权衡。
② 候选：(a) 全量倒排（每 commit 增量并入 (kind,id)→[chapterIndex]，查询 O(读者数)）；(b) 现状全扫（每次传播 O(账本行数)，零索引负担，stale.ts:64-97）；(c) 混合窗内缓存（pins 常驻内存 + 按 seq 增量读新增行，查询仍 O(章数)）。
③ 推荐：c) 混合。理由：当前规模（100+ 章、账本 <20k 行【推断】）下 (b) 全扫 µs-ms 级，倒排收益未显性，直接建图索引过拟合（t60:3.3-1）；(c) 成本驱动从"账本行数"降到"增量行数"且不改 stale.ts 查询骨架零回归（t60:3.3-2）；留单缝 findReaders(pins, entry)→number[]，未来 (a) 落地只换实现不动调用方（t60:3.3-3）；千章级或热点化才建 (a)（t60:3.3-4）。
④ 冲突/依赖：ADR 0003:20 措辞"query the dependency graph index"暗示图索引为设计意图，与推荐 c 有意图-落点缺口 → 需 ADR 措辞修订（合并进 D07 或单列）；与 D04 预算共存（缓存摊薄回读 IO）。

**D02 嗅探触发编排（挂接点决策归 t62）**
① 一句话：canon 改动落定后何时触发传播、如何去重。
② 候选：(i) 对账 applied/partially_applied 收口后嗅探（T5 信号，ReconciliationState 五态终态 reconciliation.ts:64-74）；(ii) Commit 后同步钩子（ChapterCommitted 已含 manifest，chapter.ts:613-625）；两者收敛为单一传播函数；(iii) 后台/手动（仅降级与调试）。
③ 推荐：双入口收敛单一传播函数（t60:4.2-1），后台/手动仅作降级与调试面；触发侧按对账条目级天然一次 + 抑制账本先例（reconciliation.ts:149-153）。
④ 冲突/依赖：挂接点最终选择权在 t62 §3.2/3.3（t60:4.3）→ 与 D18/D19/D20 直接耦合；本处只定传播面契约。

**D03 传播写面幂等**
① 一句话：重复嗅探同一变更时，写侧是否留痕、如何短路。
② 候选：(a) 标记等价短路——readOutlineStaleMarker 读回既有标记（stale.ts:114-134）与计算值逐字段全等则跳过写，不等才写（applyMarkerToOutlineNode 现为 revision+1 非幂等，stale.ts:150-160）；(b) 保持现状非幂等，靠触发侧去重担保；(c) 改为 upsert 语义。
③ 推荐：(a) 短路。理由：传播判定面本身确定（computeStaleMarker 纯函数 stale.ts:203-208），缺的只是写面幂等；短路的判据"同标记再传=零写（revision 不变、原子替换不触发）"应进实现票 AC（t60:6-2）。
④ 冲突/依赖：与 D02 的触发侧去重互补（双保险）；watcher 抖动/双入口竞态依赖此短路（t60:4.2-2）。

**D04 跨章遍历预算**
① 一句话：同步嗅探的规模/时间上限与超限行为。
② 候选：(a) 同步硬限+失败打点；(b) 阈值触发降级后台队列；(c) 无预算（当前规模放任）。
③ 推荐：(b) 带阈值的降级，阈值=账本 ≤20k 行、pin ≤2k、单次传播 ≤100ms（当前 100+ 章远在预算内），超限降级后台队列+打点【三数值均需 grilling 终裁】。
④ 冲突/依赖：预算护栏实质是账本回读 IO（t60:4.2-3），与 D01-c 缓存配合后开销转增量；数值口径需与 D20/D21（t62 编排/扫描面）联合对齐拍板。

**D05 Stale 停靠点**
① 一句话：机械遍历产出的"受影响下游"停在哪一层。
② 候选：(a) 维持章大纲节点 StaleMarker 三字段（T6 既有，stale.ts:103-105）；(b) 标到正文；(c) 标 commit 粒度；(d) 独立 impact 派生投影（.mozhou 运行时区，与 usage.jsonl 同层、非 canon，record-step.ts:23）。
③ 推荐：(a) 唯一停靠 + (d) 可选叠加。理由：正文是作者资产，确定性层只写规划面（I1 挡内容重写 stale.ts:11）；正文级判定属 ADR Step 2 语义层（ADR 0003:21）；upstreamRefs 已带精确 (kind,id,revision)+markedAt+reason，commit 粒度不增信息（stale.ts:156-160，t60:5.2-2【推断】）；impact 投影由 StaleMarker 派生、可重建、可弃，不新增语义字段。
④ 冲突/依赖：与 D08 语义层边界（投影 vs LLM 分类）需对齐；清除交互归后续票（stale.ts:13）。

**D06 钉版组装源**
① 一句话：compile 步如何产出 dependencyManifest（当前 compile() 不产 manifest，t60:2.4-1）。
② 候选：(a) context-compiler 产出；(b) pipeline/compile-step 产出；(c) Phase 5 内联实现。
③ 推荐：随实现票解决（t60:6-1），预审倾向 (b) 管线侧——compile-step 已消费 stale 面（compile-step.ts:65-90），组装与消费同侧；【需 grilling 终裁】。
④ 冲突/依赖：依赖 T6 承诺语义（chapter.ts:435-440 dependencyManifest 钉版）；与 D19/D20（t62 接线）同批。

**D07 票面/代码措辞差**
① 一句话：issue #60 票面写"kind+id+SHA"，代码字段实为 revision（≥0 整数版本号）。
② 候选：(a) 改票面措辞与 ADR；(b) 改代码字段为 SHA；(c) 维持并声明口径。
③ 推荐：(a) 以代码实证为准（kernel-schema.ts:107-111,481-483）——改 SHA 会破坏后到者胜语义（revision 可比较、SHA 不可比较，"无 manifest 即清退" stale.ts:88-92）；修订票面与 ADR 措辞。
④ 冲突/依赖：牵连 ADR 0003 措辞（若含 SHA 字样需核对）；与 D01 的 ADR 意图缺口修订合并处理。

### 1.2 t61 语义层（D08-D17）

**D08 语义层身份与范围**
① 问题：LLM 二次分析判什么、是否参与 Gate（t61 问①）。
② 候选：a) advisory-only 只读旁路；b) 参与 Gate；c) 可自动生效。
③ 推荐 a：S1 上下文适配 / S2 正文-上下文提示 / S3 软性标定；MUST-NOT-1..5 = 不裁决硬冲突（ADR-0024:26 纯机械 Gate；ADR-0014:9-17 冲突协议）、不碰 Protected Author Content（ADR-0019:14）、不进预算核算路径（token-budget-assembly-spec.md:70-72）、不改路由配置（t49-c:13）、不判事实真伪（ADR-0019:11）——t61:2.1-2.3 实现票可直写。
④ 冲突/依赖：D05 的"正文影响判定归语义层"在此落实；与 D17 输入契约直连。

**D09 语义载荷形态**
① 问题：复用 ContextReceipt 还是新载荷（t61 问②）。
② 候选：a) 新 SemanticAnalysisReport 一报一文件 .mozhou/semantic-analysis/report_<ULID>.json，必带锚点 {receiptId,recomputationHash,chapterIndex,taskType}；b) 折进 Receipt；c) 复用死事件 AutomatedReviewCompleted。
③ 推荐 a：Receipt 是不可变审计凭证（spec:37,39,93-94 recomputationHash 可复算承诺），非确定性 LLM 判定写入会摧毁承诺；死事件已删不可回填（domain-events.ts:9-10, ADR-0024:26）——t61:3.1。
④ 冲突/依赖：新载荷=受控 schema 增补 → 联动第 3 节增补清单；锚点依赖 Receipt 契约稳定。

**D10 T5 摘要携带方式**
① 问题：语义层是否带对账变更上下文、何种形态。
② 候选：a) 仅引用 reconciliationRef{proposalId,changeSummaryDigest}（提取器已存在 reconciliation.ts:120-140,315/351/449/485）；b) 内嵌全文；c) 不带。
③ 推荐 a：摘要引用自证"评估的是哪版对账状态"，不复制正文、不引入第二真源（沿 spec:86 内容本体不内嵌纪律）——t61:3.2。
④ 冲突/依赖：与 D17 同族——本处定摘要引用形态，D17 定遍历输出→语义层入口接口。

**D11 语义输入 token 上限**
① 问题：语义分析输入/输出的计量与上限。
② 候选：a) 输入 ≤ min(装配包 totalTokens×1.0, 16384)、输出 ≤512 tokens；b) 固定值；c) 无上限。
③ 推荐 a【数值需 grilling 终裁，t61:3.3 自标【推断】】：装配包已受 budget 约束（spec:76-79）、正文切片受 storyTextQuota 约束（spec:53）；计量一律服务端精确 tokenizer（spec:70-72），估算器禁入核算路径（MUST-NOT-3）。
④ 冲突/依赖：语义层只消费 Receipt、不反向影响装配。

**D12 候选节流排序与批量**
① 问题：候选章多时顺序与调用形态（t61 问③）。
② 候选：a) 排序 pinned→对账命中→stale→主线（沿 token-budget-assembly-spec.md:66 候选全序先例）+ 同 taskType 相邻 3-5 章批量一次调用、每章仍单报产出、超预算标 deferred；b) 单章逐个；c) 随机。
③ 推荐 a【批数 3-5 为推断默认，需终裁】：排序复用 receipts SQLite 投影（spec:68-73）不需新表；批量仅传输层优化，结论仍逐章落账、一报一文件不放松（t61:4.1-4.2）。
④ 冲突/依赖：deferred 与 D13 降级、D16 保留策略联动。

**D13 LLM 不可用降级**
① 问题：LLM/provider 不可用时行为（t61 问③）。
② 候选：a) L0 跳过（V1 不产文件、指针事件带 refusal 码）；b) L1 确定性兜底（机械 finding 标 deterministic_fallback）；c) L2 重试 3 次退避 1s/2s/4s 后转 L0。
③ 推荐：三级结构，V1 不做 L1（价值待验证，t61:6.2-1 先跑 L0/L2 再评估）；绝不静默 mock（AGENTS 规则 14/15），失败必须显式（沿 spec:134-136 失败装配走错误事件先例）。
④ 冲突/依赖：L1 机械 finding 与"确定性层/语义层"边界（D05）有张力，需 grilling 明确；重试数值需终裁。

**D14 语义结论入账**
① 问题：判定落事件还是派生面、什么顺序（t61 问④）。
② 候选：a) 报告文件先→SemanticAnalyzed 指针事件后→SQLite 投影 semantic_analysis（对齐 spec:60-67 / ADR-0021:22-23 先文件后事件崩溃一致序）；b) 仅返回不落盘；c) 仅事件。
③ 推荐 a：投影可弃重建=扫目录；SemanticAnalyzed 为不成对事件（EVENT_PAIRS 不动，沿 StyleProfileUpdated 先例 domain-events.ts:14-16），payload 仅指针摘要 {reportId,receiptId,verdict,findingCount,refusal?}，taskRef/chapterIndex 走既有顶层槽位（t61:5.4）。
④ 冲突/依赖：事件词表受控增补纪律（domain-events.ts:4-6）→ 第 3 节清单；与 t63 的 Traversal 事件建议比对（R4）。

**D15 与 ProposalPort 关系**
① 问题：语义判定是否进入提案确认面（t61 问④）。
② 候选：a) 默认不参与、不落提案仓；b) V1 做 critical→style 旁路桥接；c) 代作者 confirm/reject。
③ 推荐 a、桥接留 V2（t61:6.2-2）：ProposalPort 是需作者逐条确认的变更面（proposal-port.ts:42-45,197-219），语义判定旁路不阻塞故默认不进；V1 只记录 suggestion；永不代作者调用三动词、永不写 canon/提案/配置（t61:5.2,5.3）。
④ 冲突/依赖：ADR-0019 保护位——evidence 零正文泄露、动作域仅 {标 stale, 产出建议}。

**D16 语义报告保留策略**
① 问题：report 文件 V1 全保留还是裁剪（t61:6.2-4 开放问题）。
② 候选：a) 全保留（对齐 receipt 全保留先例 spec:140）；b) 按 deferred/旧章裁剪。
③ 推荐 a【需 grilling 终裁】：V1 简单一致，裁剪策略留 V2。
④ 冲突/依赖：影响 .mozhou 目录体量、投影重建成本与扫描耗时。

**D17 Phase5 遍历输出→语义层输入契约【核心 grilling 项】**
① 问题：语义层是否消费 Phase5 确定性遍历的 affected（受影响章）集合 / 差异摘要。
② 候选：a) 语义层入口接收 affected 集合（t60:6-3 建议"affected 集合+差异摘要握手"）；b) 仅 receipt 锚点+changeSummaryDigest 即足够（t61 全篇未消费 affected）；c) affected diffs（ADR 0003:21）+ receipt 锚点并存。
③ 预审倾向转向 (c)：ADR 0003:21 已定 Step 2 契约=send only the impacted chapter diffs and modified entity definitions to an LLM evaluator——ADR 层面语义输入面=受影响章 diffs+修改实体定义；t61 的 receipt 锚点（receiptId+digest）为"评估哪版编译"的伴随态、不替代 affected 输入。终裁落点=载荷携带形态（diffs 是否具名进入 payload）。
④ 冲突/依赖：直接影响 D12 排序键口径（"对账命中" vs "受影响章"）与 D14 事件 payload 是否带 affected 摘要；t62:5-5 已给部分答案——语义判定以确定性摘要为输入、走 extract 注入缝（reconciliation.ts:496,563-566），可并入候选 (a) 作证据；详见第 2 节 R2。

### 1.3 t62 变更入口与触发编排（D18-D22）

**D18 三路径"改动落定"信号定稿**
① 问题：canon 改动三入口（A T5 watcher / B ProposalPort commit / C ADR-0014 guided mutation）各以什么确切信号判定"落定"。
② 实证：A = 对账提案终态（applied/partially_applied/dismissed ∧ resolvedAt≠null ∧ resolution 定值，reconciliation.ts:169-170）随后 reloadManifest 重基线（local-data-plane.ts:187-190）；B = CanonCommitted 事件行落账（session.ts:279-298）∧ commitChapter 相位翻转（local-data-plane.ts:151-154）；C = 【推断】复用 A/B 通道其一，内容未读（t62:2.3）。
③ 推荐：A/B 采 t62 实证信号直接定稿；C 为实现票 P0 前置（补读 ADR-0014 后回填，t62:7 P0-1）。
④ 冲突/依赖：落定信号即嗅探触发条件，与 D02/D19 直连；C 未定不阻塞 V1（主路径 A 证据最全）。

**D19 嗅探挂接信号形态（落定事件化）**
① 问题：嗅探动作挂什么信号——现有事件只有检出 ReconciliationProposed（reconciliation.ts:788-793），无终态事件。
② 候选：a) 提案达终态处补发落定事件/回调（新形态）；b) 调用方轮询 listProposals 终态；c) 复用检出事件+读终态。
③ 推荐 a（t62:7 P0-2）：挂"落定后"信号，触发输入=提案（proposalId/relPath/基线指纹）；不挂 watcher 轮询内部（mtime 预筛是检测层非业务信号，t62:3.2）。
④ 冲突/依赖：新增事件=受控增补（第 3 节）；命名（ReconciliationSettled?）与成对性待 t63 比对（R4）。

**D20 唯一接线形态与消费顺序**
① 问题：Phase5 嗅探与 T6 传播的接线形态（回调 vs 事件总线）与执行顺序。
② 候选：a) 数据面公共落定出口单点，顺序 落定→reloadManifest→propagateStaleMarkers(T6, local-data-plane.ts:183-185)→嗅探动作(Phase5)（t62:4.2）；b) 事件总线（#publish 先例 session.ts:254-260 / emitEvent 先例 reconciliation.ts:788-793）；c) 管线会话内散接。
③ 推荐 a（t62:7 P0-3）：Phase5 是并行消费者、非 T6 链延长段——不改 commitChapter 内部；唯一接线收敛数据面落定出口、管线会话零散接。具体形态（回调 vs 事件总线）t62 未定——需 grilling 终裁。
④ 冲突/依赖：决定 D19 的落地载体；与 D02 同源——双入口信号、单一出口，措辞合并见第 2 节 R1。

**D21 全书扫描预算参数**
① 问题：ReconciliationOptions 是否增加扫描上限与超限分批（票面要求 N 章上限）。
② 候选：a) 增 batch 上限 + 超限分批参数（现 Options 仅 extract 注入点，reconciliation.ts:563-566）；b) 不加、靠 watcher stat 常态低开销。
③ 推荐 a（t62:7 P1-1）：可测性靠 intervalMs 已可配（reconciliation.ts:568-571）；上限建议 N=100 章/批、超限分批【建议值，需 grilling 终裁】。
④ 冲突/依赖：与 D04 口径分层——D04 管传播面（账本 20k/2k），D21 管扫描面，两预算需联合终裁避免冲突。

**D22 V1 最小可验证切片范围**
① 问题：V1 切片边界与验收判据。
② 候选：a) 按 t62 §5 判据 1-7 全量（检出→落定→幂等→机械圈定→语义判定→T6 并行→预算可测）；b) 先机械段（1-4,6-7）、语义段后续票。
③ 推荐 a：7 判据全可测（t62:5），语义判定以确定性摘要为输入、走 extract 注入缝（reconciliation.ts:496,563-566）——与 D17 联动。
④ 冲突/依赖：语义段依赖 D17 终裁；若 D17 悬置则 V1 切票退化方案 b。

### 1.4 t63 复用面（D23-D28）

**D23 Receipt 三槽作语义载荷底料**
① 问题：Receipt 的 entries/replayInputs/structural 三槽能否作语义层载荷底料（t63 问①）。
② 候选：a) 三槽形态同构、剥离生命周期，语义层自声明同构 DTO（仿 StyleSuggestionItem.proposal 泛键值+自闭合 schema，proposal-port.ts:165）；b) 本体复用（坑：条目带生命周期状态耦合 B:62-64）；c) 完全不借鉴。
③ 推荐 a（t63:2.1）：投影逐条单位/重放输入面/结构断言槽均现成；但 Receipt 宿主在 B/C 锚点 0 命中（t63:1.3 负证据），字段语义【推断】——实现票 P0 先 grep 定位宿主。
④ 冲突/依赖：与 D09 相容（本体不复用），张力仅在载荷 schema 形态——见 R3。

**D24 ProposalPort 不扩 impact 后端**
① 问题：impact（entity→affected set）走新增端口后端还是派生面（t63 问①）。
② 候选：a) 扩 'impact' 第 4 后端（机械可扩：ref 字面量+#decide 分派+deps 注入，proposal-port.ts:176-182,387-403）；b) 不扩、走派生面只读投影。
③ 推荐 b（t63:2.2 四条硬证据）：ref 单提案形态错位（style 合成 ref 反例 B:258）、PortAction 无只读动作（B:47,417-421）、pending/finalized 生命周期污染（B:62-64,405-411）、决策落盘时钟噪声传入派生面（B:297,365）。
④ 冲突/依赖：与 D05 同向（impact 仅派生投影）；时钟噪声条款见 R5。

**D25 Traversal 事件增补（成对）**
① 问题：遍历生命周期是否入事件词表、成对与否（t63 问②缺口 G1）。
② 候选：a) 成对 TraversalStarted/Finished 入 DOMAIN_EVENT_TYPES+EVENT_PAIRS；b) 仅 Finished 或仅指针；c) 不加事件只靠投影。
③ 推荐 a（t63:3 G1）：对齐 GenerationStarted/Finished 词表范本（domain-events.ts:29-30）、成对纪律配套悬挂 head 投影合并机制（C:50 规格 §3）；命名评审+契约冻结（AGENTS §3）；词表 15→17。
④ 冲突/依赖：与 E3 SemanticAnalyzed 不成对并立（R4）；事件存在性决定 impact 投影真源——事件派生（t63 G2）vs StaleMarker 派生（t60 D05），真源需 grilling 终裁。

**D26 impact 重算触发**
① 问题：影响投影何时重算（t63 问②缺口 G4）。
② 候选：a) 订阅 CanonCommitted（domain-events.ts:35）+ 对账终态【推断】驱动；b) 新增专用触发事件；c) 每次查询惰性计算。
③ 推荐 a（t63:3 G4, 7-5）：提交路径 CanonCommitted 已覆盖依赖实体变更（需实证覆盖是否完整）；对账终态订阅待实证；条件性才议新触发，默认不加。
④ 冲突/依赖：与 D19/D20 同口径（落定信号驱动）；若 CanonCommitted 未覆盖全部变更源，缺口回填 T25。

**D27 金标准前置层（资格门/CASE 守卫）**
① 问题：正确性金标准集前面要不要资格门与用例守卫（t63 问①）。
② 候选：a) 资格门（台架可复现前提）+ CASE schema 守卫（图合法+期望⊆可达）+ 断言分层；b) 只做对拍不断言前置。
③ 推荐 a（t63:2.3，术语【推断定义】）：把"失败只可能来自遍历实现"变成可证性质；受影响集=黄金主断言，运行时长/实体数=只读哨兵（防脆性）。
④ 冲突/依赖：进 T30 台架票，与 D28 夹具配套。

**D28 黄金对拍台架与断言**
① 问题：确定性遍历机械测试设计与断言纪律（t63 问③）。
② 候选：a) fixtures/dep-graph-10ch.json 固定夹具（直线链/跨跳/汇点菱形/孤立章）+ case 表（每 case 只改 1 实体 1 字段）+ 三层断言；b) 简化快照对比。
③ 推荐 a（t63:4）：主=受影响集合排序后逐项相等（不放宽物理顺序）、次=行为级传播深度、哨兵=数字（禁当黄金）；断言面剥离 consumedAt/decidedAt 时钟字段（B:297,365）；直驱语义层 API 不经 ProposalPort；重建幂等指纹=排序集合哈希（vault 记忆 D1）。
④ 冲突/依赖：直驱的遍历 API 稳定性依赖 T26/T27；golden 只读入版本库。

## 2. 跨研究冲突清单

> 预审只提炼不裁决：每条给矛盾点+预审倾向，终裁归 grilling。

**R1 双入口 vs 唯一出口（t60 D02 × t62 D20 × t63 G4）**
矛盾点：t60:4.2"对账 applied+Commit 钩子双入口收敛单一传播函数"；t62:4.2"数据面公共落定出口唯一接线"；t63 G4"复用 CanonCommitted+对账终态订阅、不新增触发事件"。
预审倾向：非真冲突，是表述差——信号（A 落定提案/B CanonCommitted）两入口、接线（T6 传播+Phase5 嗅探）收敛单出口。需 grilling 确认：唯一接线=数据面公共落定出口（回调 vs 事件总线，t62 §7 未定形=D20）。

**R2 Phase5 遍历产物 vs 语义层载荷锚点（=D17）【核心】**
矛盾点：t60:6-3 期待"affected 集合+差异摘要"握手给语义层；t61 锚点仅 receiptId/recomputationHash/changeSummaryDigest，全篇未消费 affected 集合。
弥合线索：t62:5-5 语义判定以确定性摘要为输入、走 extract 注入缝（reconciliation.ts:496,563-566）。
预审倾向：ADR 0003:21 为决定性证据——语义输入面=impacted diffs+modified entity definitions（支持候选 c）；receipt 锚点为伴随态；需 grilling 定 diffs 的载荷携带形态与 D12 排序键口径。

**R3 语义新载荷 vs t63 三槽复用倾向（t61 D09 × t63 2.1）**
矛盾点：t61 明确不复用 Receipt（摧毁 recomputationHash 承诺）；t63"三槽形态可取、剥离生命周期、自声明同构 DTO"。
预审倾向：相容——本体不复用、形态可同构。唯一张力：SemanticAnalysisReport 是否引入 entries/replayInputs 同构槽（t61 草案只有 findings 无 entries 槽）。

**R4 事件增补成对性（t63 G1 × t61 5.4）**
矛盾点：t63 提议成对 TraversalStarted/Finished（词表 15→17、EVENT_PAIRS 3→4 对）；t61 提议不成对 SemanticAnalyzed（词表 15→16、EVENT_PAIRS 不动，沿 StyleProfileUpdated 先例 domain-events.ts:14-16）。
预审倾向：成对性按事件语义各取（Traversal 有生命周期需 head/tail 收口；SemanticAnalyzed 单点交付无 tail）；需 grilling 确认 EVENT_PAIRS[有 head 必 tail] 纪律是否一刀切，及词表膨胀 15→18 是否可接受。

**R5 时间戳进指纹（t60 D05 impact 投影含 at × t63 2.2/4 禁落时间戳进指纹）**
矛盾点：t60 impact 记录 {upstreamRefs, markedChapters, at, reason} 含 at；t63 引 B:297/365 时钟噪声反例，要求派生面指纹禁时间戳。
预审倾向：展示字段保留 markedAt，但重建幂等指纹=排序后内容集合、剥离时间戳（vault 记忆 D1）。投影 schema 是否含 at 需终裁。

**R6 词表 15 vs 简报 14（±1）**
矛盾点：domain-events.ts:23-37 实证 15 词条，任务简报称 14。
预审倾向：非决策项，实现票复核（拆/合词条或简报笔误）；与 R4 词表增量核算联动。

**R7 票面 SHA 措辞（=D07）**
t60:2.1 实证字段为 revision（≥0 整数）；建议票面+ADR 措辞修订随 T31。

## 3. 受控增补清单草案

> 纪律基线：词表唯一真源 domain-events.ts:4-6（现 15 词条、EVENT_PAIRS 三对，t63 C:23-37/51-55）；DomainEvent 形态 type/taskRef/chapterIndex?/payload?（C:42-48）；契约冻结 AGENTS §3、payload 禁 any/未文档化字段 §12；先文件后事件崩溃一致序 spec:60-67。

| # | 增补项 | 来源 | 形态草案 | 兼容策略 |
|---|--------|------|----------|----------|
| E1 | TraversalStarted（成对） | t63 G1 | DomainEvent{type:'TraversalStarted', taskRef, payload{traversalId, trigger{source:'reconciliation'|'commit', proposalId?/commitId?}, scope{chapterCount, pinCount}}} | 入 EVENT_PAIRS（3→4 对）；悬挂 head 投影合并标记机制已存在（C:50）；命名评审+契约冻结；禁时间戳进指纹场景 |
| E2 | TraversalFinished（成对） | t63 G1 | payload{traversalId, markedChapters[], affectedFingerprint(排序后集合哈希), markedAt} | 与 E1 同批；fingerprint 剥离时间戳（R5） |
| E3 | SemanticAnalyzed（不成对） | t61 5.4 | payload{reportId, receiptId, chapterIndex?, taskType, verdict, findingCount, refusal?}；taskRef/chapterIndex 走顶层槽位 | EVENT_PAIRS 不动；先文件后事件；词表 15→16 |
| E4 | impact 投影（entity→affected set） | t60 D05 + t63 G2 | 派生面：SQLite 表或 .mozhou/impact/ JSON（版本号字段+tmp+rename 原子写，ledger 模板 proposal-port.ts:115/148-154） | 事件派生、可弃重建、指纹可比；与 t60 impact 记录合并同一投影面；真源（Traversal 事件 vs StaleMarker）待终裁 |
| E5 | semantic_analysis 投影 | t61 5.4-3 | SQLite 表(report_id PK, receipt_id, chapter_index, created_at, verdict, finding_count, provider, model, input/output_tokens) | 可弃重建=扫目录 |
| E6 | SemanticAnalysisReport 载荷 schema | t61 3.4 | 一报一文件 report_<ULID>.json：anchor+reconciliationRef?+provider+inputStats+findings+verdict+refusal? | 是否镜像 Receipt 三槽待 R3 终裁；不进预算路径、不参与 recomputationHash |
| E7 | 目录 .mozhou/semantic-analysis/ | t61 5.4-2 | 运行时区非 canon，入目录树文档 | 对齐 receipts 归属（spec:27-35） |

> 明确不增：ProposalPortRef 第 4 后端 'impact'（t63 2.2 四条硬证据）；新触发事件（复用 CanonCommitted+对账终态，D26）；StaleMarker 三字段不动、无新字段（t60 5.2）。

## 4. 建议的实现票切分草案（T25+，按依赖序）

- T25 落定信号与唯一接线：A/B 落定信号取证（D18）+ 补发落定事件/回调（D19）+ 公共落定出口顺序编排（D20）；前置 P0-1 补读 ADR-0014 定路径 C（D18-C）。
- T26 传播面收口：窗内缓存+findReaders 单缝（D01-c）+ 标记等价幂等短路（D03）+ 传播预算与超限降级（D04）。
- T27 遍历触发+impact 投影：挂接 T25 落定信号产出 affected 集合（D02/D22 机械段）；词表增补 TraversalStarted/Finished（E1/E2）+ impact 投影（E4）；停靠维持大纲粒度（D05）。
- T28 语义层骨架：SemanticAnalysisReport 载荷（D09/D10/D11）+ 三级降级（D13）+ 授权面边界（D15 下限）；输入契约按 R2 终裁对接 T27。
- T29 语义层节流与入账：排序+批量（D12）+ SemanticAnalyzed 事件与投影（E3/E5）+ 保留策略（D16）+ 目录 E7。
- T30 黄金对拍台架：dep-graph-10ch 固定夹具+case 表+三层断言+CASE 守卫+资格门（D27/D28）——贯穿 V1 验收判据 1-7（D22）；可与 T27 并行起台架。
- T31 契约与文档收尾：ADR 0003 措辞修订（D07+索引意图缺口）+ 词表契约冻结评审（R6 ±1 复核）+ 事件命名评审（E1/E2/E3）。
- 依赖序：T25 → T26 → T27 → T28 → T29；T30 依赖 T26/T27 遍历面稳定；T31 可全程并行。门禁：UVSD §5 每票必带测试，TypeCheck/Tests/Build 全绿。