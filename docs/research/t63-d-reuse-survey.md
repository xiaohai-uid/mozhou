# Issue #63 复用面盘点 —— Phase 5 研究文档

> 研究员：Wayfinder · Phase 5 · 票面：repos/xiaohai-uid/mozhou/issues/63
> 产出：docs/research/t63-d-reuse-survey.md（原 issue-063-reuse-surfaces.md 于 2026-08-26 mv 改名，未提交）
> 纯文档：不改代码、不动 git ｜ 证据纪律：结论带 文件:行号 或 规格:章节；无法实证标【推断】
> 证据源：A=票面正文（gh api issues/63 .body）｜B=packages/pipeline/src/proposal-port.ts（468 行）｜C=packages/kernel/src/domain-events.ts（55 行）

## 0. 票面正文与证据可用性

- A 在本环境**不可取证**：gh CLI 未安装（command not found）；匿名 GitHub API 对 repos/xiaohai-uid/mozhou 返回 **404**（repo 私有；user xiaohai-uid 200 存在）。
- 三问以任务简报表述为操作定义，原文：
  ① 逐件盘点复用：Receipt（entries/replayInputs/structural）能否做语义层载荷底料；ProposalPort 三后端能否扩 impact 后端还是走派生面；Benchmark 资格门/CASE 守卫对遍历正确性金标准集的价值。
  ② 缺口清单（明确列出需新增：事件？投影？派生文件？）沿 kernel 词表纪律。
  ③ 测试面：确定性变遍历的机械测试设计（黄金对拍：10 章依赖图→改 1 实体→断言受影响集），沿 T10b 台架确定性纪律。
- 凡依赖票面/台架文档细节的术语（Benchmark 资格门、CASE 守卫、T10b）在两锚点 0 命中，相关结论一律标【推断】。

## 1. 锚点证据

### 1.1 proposal-port.ts：导出面与三后端形态

导出面（B:42/47/49/57/162/169/176/184/451/466）：ProposalPortRef、PortAction、ProposalPortError、ProposalMutationOutcome、StyleSuggestionItem、StylePortBackend、ProposalPortDeps、class ProposalPort、confirmedAppendsForCommit、listPendingProposalRefs。

- **联合类型**（B:42-45）：{ port:'pipeline'|'reconciliation'|'style'; proposalId } —— 封闭三后端。
- **动作语义**（B:47）：'confirmed' | 'rejected' | 'edit_accepted'；ProposalMutationOutcome（B:57-65）= ref/itemId/action/pendingItems(0=全决毕)/finalized。
- **统一分派**：confirm/reject/editAccept → #decide（B:197-219, 303-316）→ 按 port 分派三私有方法；outcomeOf 定义 finalized = pendingItems===0（B:442-444）。

三后端实现形态（补读 B:80-468）：
- **pipeline（管线）**：pipelineRecord 装载 + consumed 状态拒绝（B:71-80）；pipelineItem 逐条卫兵（未知/已决响亮失败，B:82-94）；applyPatch 顶层浅合并（B:96-103）；决策写回 saveCanonProposal（B:318-341）；Commit 侧读缝 confirmedCanonicalRows：pending 存在即拒（S6，B:268-284）；markConsumed 收口幂等（B:287-299）。
- **reconciliation（对账）**：逐条决策缓冲 ledger（ledgerVersion:1，decisions:{action,decidedAt}，B:109-118）→ 落盘 .mozhou/proposals/port_rcln_<id>.json，**tmp+rename 原子写**（B:148-154）→ 全部决毕一次性 service.decideItems 收口进 T5 五态终态并 unlink 缓冲（B:368-384）；编辑通道=文件本身，editAccept 禁 patch（B:210-215）。
- **style（风格旁路）**：StyleSuggestionItem= id/scenarioType/proposal 泛键值载荷（B:162-166）；StylePortBackend= listPending + accept 回调（写 StyleProfile 唯一写口，B:169-174）；决策**只接受 confirm**，reject/editAccept 显式拒绝（B:412-431）；**永挂待决**——无持久化、无超时自动生效、无静默批量接受（B:405-411）。
- **扩展机制**：后端经 ProposalPortDeps 可选注入（B:176-182），缺省 #requireStyle/#requireReconciliation 响亮报错（B:387-403）。
- **恢复面**：listPendingRefs 全书扫描（pipeline open + reconciliation awaiting_author + style 挂起；style 的 proposalId 为合成 'style:'+item.id，B:242-262）；模块级 confirmedAppendsForCommit / listPendingProposalRefs（B:451-468）。
- ⚠ **时钟噪声**：consumedAt/decidedAt 均烙 new Date().toISOString()（B:297, B:365）——决策面落盘非确定性，测试断言须剥离。

### 1.2 domain-events.ts：kernel 词表

- DOMAIN_EVENT_TYPES（C:22-38）：实证 **15 词条**（TaskStarted/TaskStepTransitioned/TaskAttemptRegistered/TaskFinished/ChapterGenerateRequested/ContextCompiled/GenerationStarted/GenerationFinished/CandidateCreated/UserEditRecorded/CandidateDeltaExtracted/CanonProposalCreated/CanonCommitted/FlywheelRecorded/StyleProfileUpdated），C:23-37 共 15 行——任务简报称 14，**±1 出入**，实现票需复核（拆/合词条或简报笔误）。
- DomainEvent 形态（C:42-48）：type / taskRef(ULID，engine 生成) / chapterIndex? / payload?(Readonly<Record<string,unknown>>)。
- EVENT_PAIRS（C:51-55）：三对（GenerationStarted↔Finished、CanonProposalCreated↔Committed、TaskStarted↔Finished）；注释（C:50，规格 §3）：head 必须被 tail 闭合，悬挂 head 在**投影合并**时标记——kernel 已存在投影合并机制。

### 1.3 负证据

grep B 全集与 C 全集：Receipt / replayInputs / structural **均 0 命中** → 两锚点不含 Receipt，其宿主文件、字段语义需实现票 grep 定位。

## 2. Q1 复用面逐件盘点

### 2.1 Receipt（entries / replayInputs / structural）→ 语义层载荷底料？

判定框架：载荷底料 = 「逐条可寻址、可哈希、可投影、可重放」的数据形态。按简报字段名逐槽评估（⚠ 1.3 已示空窗，字段语义为【推断】，实现票实证）：
- entries【推断】= 逐条载荷列表 → 适配：语义层投影的逐条目单位（每条需稳定键）。风险：若条目带生命周期状态（pending/finalized 观感，B:62-64），复用即把计算载荷与业务决策耦合。
- replayInputs【推断】= 回放入参快照 → 适配度高：确定性重放（T10b）要求输入固化，此槽即现成输入切面，免新建管道。
- structural【推断】= 结构（章节树/依赖边）差异/快照槽 → 适配：金标准需结构断言（边集、传播路径），此槽是现成比对位。
- **先例**：B 内已有「条目+泛键值载荷」形态——StyleSuggestionItem.proposal（B:165）＝LLM 旁路分类结果作为 confirm 前可选载荷。语义层载荷可仿此：条目 {id,type,payload}，payload 泛键值但**闭合于语义层自己 schema**（AGENTS.md §12 禁 any/未文档化字段）。
- 结论：**三槽数据形态可取、生命周期语义剥离**——语义层自声明同构 DTO（entries/replayInputs/structural），绝不把 Receipt 经 ProposalPort 通道复用。

### 2.2 ProposalPort 三后端 → impact 后端 or 派生面？

机械可扩性（已实证）：后端 = ref 字面量 + #decide 分派 + deps 可选注入（B:176-182, 387-403）；加 'impact' 只需第 4 字面量 + #decideImpact + deps.impactBackend。但语义/形态错位，四条硬证据：
1. ref 形态=单 proposalId 单条提案（B:42-45）；style 已把 proposalId 拉伸为合成 'style:'+id（B:258）——反例证明合成 ref 可行但制造非真实提案 id、加重恢复面；impact 结果集（多实体）将需每实体合成 ref。
2. 决策语义错位：PortAction 只有 confirmed/rejected/edit_accepted（B:47）；style 保底也已证明决策面**只有 confirm 一个生效动作**（B:417-421）——impact 是只读计算结果，无任何生效动作。
3. 生命周期污染：pending/finalized（B:62-64, 442-444）与 consumed 状态机（B:76-77, 287-299）；style「永挂待决」使 finalized 恒 false（B:405-411）已有前科，impact 若挂端口须伪造待决。
4. **时钟噪声传入**：决策落盘烙 Date（B:297/365），派生面若复用端口即把时钟噪声带进确定性可重建面。
→ 结论：**不扩 impact 后端，走派生面**——impact 结果 = 投影上的只读查询（entity → affected set），沿 kernel 投影合并纪律（C:50 规格 §3），事件派生、可重建、指纹可比。派生文件的**落盘纪律直接借鉴 reconciliation ledger 模板**：版本号字段（ledgerVersion:1，B:115/370）+ tmp+rename 原子写（B:148-154）+ .mozhou/ 下固定子目录（B:123）。唯一例外（条件性）：未来产品若要求「作者确认后才应用影响集」，才用 ProposalPort 承载确认流——按 AGENTS.md 工程规则 §1.4（不做投机抽象）默认不做。
- 【推断】跨面联动：对账终态（applied/partially_applied/dismissed，B:374）会改变章节实体内容 → 派生面投影的失效/重算触发应订阅对账终态，实现票实证。

### 2.3 Benchmark 资格门 / CASE 守卫 → 遍历正确性金标准集

两术语在锚点 0 命中，属台架/基准文档概念【推断定义】：
- **Benchmark 资格门**【推断】= 基准运行前合法态门禁（引擎/版本锁、输入种子固定、确定性前提就绪）。价值：把「跑金标准的台架必须可复现」从口头约定变门禁——非法台下任何集合/数字不可信。
- **CASE 守卫**【推断】= 用例级 schema 守卫（图合法：节点存在、边端点存在、无自环；期望受影响集 ⊆ 可达集）。价值：把「失败只可能来自遍历实现」变成可证性质——夹具错被前置拦截。
- **对金标准集结论**：两者叠加是高价值前置层；断言**分层**——受影响集=黄金不变式（主），运行时长/实体数=只读哨兵（禁止把采样数字当黄金，防脆性）。沿 vault 记忆：集合断言比较「排序后内容集合」而非物理顺序（D1）。

## 3. Q2 缺口清单（沿 kernel 词表纪律）

词表纪律基线（实证）：15 词条（C:23-37）；DomainEvent 形态=type/taskRef(ULID)/chapterIndex?/payload?（C:42-48）；成对约束 + 悬挂 head 投影合并标记（C:50-55，规格 §3）。
- **G1 事件（新增 2 词条，成对）**：TraversalStarted / TraversalFinished（备选 ImpactTraceStarted/Finished）——入 DOMAIN_EVENT_TYPES + EVENT_PAIRS；命名沿 PascalCase 词表范本（GenerationStarted/Finished，C:29-30）；形态合规 DomainEvent（C:42-48）；实现票过命名评审 + 契约冻结（AGENTS.md §3），payload 禁 any/未文档化字段（§12）。
- **G2 投影（派生面，回应 2.2）**：entity → affected set 影响投影；沿 kernel 既有投影合并纪律（C:50 规格 §3）；事件派生、可重建、指纹可比。
- **G3 派生文件（两类，勿混）**：① runtime 投影落盘 = 借鉴 ledger 模板（版本号字段 + tmp+rename 原子写 + .mozhou/impact/ 固定目录，B:115/123/148-154）；② test golden 文件 = fixtures/dep-graph-10ch.json + case 黄金表，入版本库只读。
- **G4 触发（明确不需新增，条件性）**：若实体变更走提交路径，CanonCommitted（C:35）已覆盖触发，impact 重算挂订阅即可【推断，需实证提交路径是否覆盖全部依赖实体变更】；另考虑对账终态订阅（2.2 末）。
- **G5 契约纪律**：词表/DomainEvent 增量过契约冻结流程，不得绕过（AGENTS.md §3/§12）。
- **明确不做**：ProposalPortRef 保持封闭三后端（不扩 impact）；不为 impact 增加任何 PortAction。

## 4. Q3 测试面：确定性机械测试（黄金对拍，T10b 台架纪律）

1. **固定夹具**（fixtures/dep-graph-10ch.json，手工枚举非随机）：10 章实体 + 依赖边，含直线链（ch1→…→ch9）、跨跳（ch3→ch7）、汇点菱形（ch5←{ch2,ch4}）、孤立章（ch10 无出边）→ 覆盖直接/间接/传播深度/无影响四类路径。
2. **变更操作**：每 case 只改 1 实体 1 字段（改 canon hash 或增删 1 条依赖边）；case 表 {before-graph, mutation, expected-affected-set} 固化 JSON。
3. **断言三层**：
   - 主：受影响**集合相等** = 排序后逐项比较（不放宽物理顺序；D1 记忆直接引证）。
   - 次：行为级逐实体断言传播深度/影响链 = 黄金（幂等指纹记忆第二道保险）。
   - 哨兵（只读）：受影响集大小、遍历步数——禁止当黄金断言（脆性）。
4. **确定性控制**：夹具无时间戳/随机字段；**断言面剥离 consumedAt/decidedAt 类时钟字段**（B:297/365——现决策面已含此噪声，投影派生文件禁落时间戳进指纹）；taskRef 固定注入（C:45 本由 engine 生成）；无并行、无定时依赖、单写者；golden 只读。
5. **实现独立性**：测试直驱语义层遍历 API，**不经 ProposalPort**（与 2.2 一致，避免决策通道假信号）。
6. **门禁化**（接 2.3）：每条 case 过 CASE schema 守卫；台架跑前过资格门；投影可重建 → 补重建幂等指纹测试（排序后集合哈希，D1 直接落断言）作第六层保障。
7. 代表 case 期望（实现票填数）：中段变更→下游闭包；汇点变更→两分支合并集；孤立章变更→空集。

## 5. 结论摘要

- Q1：Receipt 三槽可作载荷底料但**只取形态、剥离生命周期**（宿主待实证，1.3）；ProposalPort **不扩 impact 后端、走派生面**（4 条硬证据，2.2）；资格门/CASE 守卫（【推断】）构成金标准集前置高价值层，断言分层（2.3）。
- Q2：需新增 G1 成对事件 2 词条 + G2 影响投影 + G3 派生文件（runtime/test golden 两类；落盘借鉴 ledger 模板）；触发复用 CanonCommitted、ProposalPort 后端明确不加；词表实证 **15 条**（简报 14，±1 待核）。
- Q3：10 章固定夹具 + 单实体变更黄金对拍；排序集合相等主断言 + 行为级次断言 + 数字哨兵；剥离时钟字段；CASE 守卫 + 资格门；直驱语义层 API 不经 ProposalPort。
- 证据边界：票面正文（A）不可取证，三问按简报操作定义；依赖票面/台架细节处均标【推断】。

## 6. 证据清单对照表

| # | 证据 | 出处 | 用途 |
|---|------|------|------|
| A | 票面正文 | gh api issues/63 | 不可取证：gh 未装；repo 私有 404；user 200 |
| B1 | ProposalPortRef 三后端联合 | B:42-45 | Q1.2 形态错位 |
| B2 | PortAction 决策语义 | B:47 | Q1.2 语义错位 |
| B3 | Outcome pendingItems/finalized | B:57-65, 442-444 | Q1.2 生命周期 |
| B4 | pipeline 装载 + consumed 状态机 | B:71-80, 287-299 | Q1.2 伪生命周期 |
| B5 | reconciliation ledger 持久化（版本号+原子写+目录） | B:109-154, 368-384 | G3 派生文件模板 |
| B6 | style 后端（永挂待决/只 confirm/无持久化） | B:160-182, 405-431 | Q1.2 决策面本质 |
| B7 | deps 可选注入 + 响亮报错（扩展机制） | B:176-182, 387-403 | Q1.2 机械可扩性 |
| B8 | listPendingRefs 恢复面 + style 合成 ref | B:242-262, 258 | Q1.2 合成 ref 反例 |
| B9 | editAccept 通道约束 | B:210-218 | Q1.2 后端差异 |
| B10 | confirmedCanonicalRows 存在 pending 即拒（S6） | B:268-284 | Q1.2 端口义务 |
| B11 | 时钟噪声 consumedAt/decidedAt | B:297, 365 | Q3 断言剥离对象 |
| B12 | 模块级恢复读缝 | B:451-468 | 复用面清单 |
| B13 | **负证据**：B 中 Receipt 0 命中 | grep 全文件 | Q1.1 宿主待实证 |
| C1 | DOMAIN_EVENT_TYPES 15 词条（简报 14） | C:23-37 | Q2 词表基线 |
| C2 | DomainEvent 形态 | C:42-48 | Q2 合规形态 |
| C3 | EVENT_PAIRS + 投影合并（规格 §3） | C:50-55 | Q2 成对纪律 |
| C4 | **负证据**：C 中 Receipt 0 命中 | grep 全文件 | Q1.1 宿主待实证 |
| D1 | vault 记忆：幂等指纹=排序后内容集合+行为级双保险（verified） | memories/2026/08/2026-08-24 重建幂等指纹必须比较排序后的内容集合,而非物理 rowid 顺序.md | Q3 断言设计 |
| D2 | T10a 全链路集成交付 note（T10 编号轨迹） | obsidian-mind/work/active/2026-08-24-mozhou-t10a-compiler-full-chain-integration.md | T10b 台架上下文 |

## 7. 实现票可直写推荐

1. **实证 Receipt**：grep packages/{pipeline,kernel}/src 定位宿主；核对 entries/replayInputs/structural 三字段；产出「三槽 DTO 复用方案」（形态可仿 StyleSuggestionItem.proposal，B:165；生命周期剥离）。
2. **建派生面**：新增 impact 投影（entity → affected set），沿 kernel 投影合并纪律（C:50 规格 §3）；**不改 ProposalPortRef**（B:42-45 保持封闭）。
3. **派生文件落盘**：借鉴 reconciliation ledger 模板——版本号字段 + tmp+rename 原子写 + .mozhou/impact/ 固定目录（B:115/123/148-154）；**禁落时钟时间戳进指纹**（B:297/365 反例）。
4. **kernel 词表增量**：成对 TraversalStarted/TraversalFinished 入 DOMAIN_EVENT_TYPES + EVENT_PAIRS（C:22-38/51-55）；形态合规（C:42-48）；命名评审 + 契约冻结（AGENTS.md §3/§12）。
5. **触发复用**：订阅 CanonCommitted（C:35）与对账终态【推断】驱动重算；条件性才议新触发事件，默认不加。
6. **T10b 黄金对拍台架**：fixtures/dep-graph-10ch.json + case 表；三层断言（排序集合=主/行为级=次/数字=哨兵）；CASE schema 守卫 + 资格门；测试直驱语义层 API 不经 ProposalPort。
7. **重建幂等测试**：投影重建按排序后内容集合指纹比对（D1 直接落断言）。
8. **纪律勾稽**：不改票外无关文件（§18）；失败只修票内因果（§17）；golden 只读入版本库。
