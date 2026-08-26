# T62 变更入口与触发编排（Phase 5 变更影响引擎）——研究结论

> 状态：完成（Wayfinder 研究交付） ｜ 票源：issue #62（label wayfinder:research，Part of #59 Phase 5 变更影响引擎）
> 产出约定（票面原文）：docs/research/tNN-c-change-ingress.md
> 证据纪律：结论带 文件:行号 或 规格:章节；无法实证标【推断】。本研读范围 = 票面正文 + 三锚点（packages/data-plane/src/reconciliation.ts、local-data-plane.ts、packages/pipeline/src/session.ts）+ docs/adr 目录元数据；未读任何其他源文件。

## 0. 结论摘要（四问各一句）

1. 【①三入口·落定信号】A 外部编辑（T5 watcher）→ 落定为「对账提案终态」：ReconciliationProposal 达
   applied / partially_applied / dismissed 且 resolvedAt 非空、resolution 定值（reconciliation.ts:64-74,169-170），
   随后 reloadManifest 重立基线使该路径不可再检出（local-data-plane.ts:187-190）；B 管线 commit（ProposalPort 确认）→
   落定为「CanonCommitted 事件落账」：第 8 步 CanonProposalCreated 提案头由第 9 步 markCommitted 配对闭合，
   一 session ↔ 一 commit 唯一写点（session.ts:263-298）；C guided mutation（ADR-0014）→【推断】复用同一
   落定通道（提案终态 / 事件行），须补读 docs/adr/0014-canon-conflict-reconciliation-and-intentional-mutation.md 定稿。
2. 【②触发编排】嗅探动作挂「canon 改动落定」信号之后：现成注入缝 = ReconciliationProposed 事件
   （reconciliation.ts:788-793）+ 提案终态（resolvedAt）；先例 = 票面点名「Flywheel afterRecord 注入缝」。
   幂等三重去重已现成（同路径不重复 760-762 / 二次编辑刷新同 id 758-766 / 盘上回退自动 dismissed 672-684 /
   抑制账本 817+）。全书预算：watcher 周期仅 mtime stat 级 O(n)，漂移文件才 SHA-256（603-621,646-659）；
   全量复核仅 startupScan / pollOnce；现实现缺 N 章上限与超限分批参数【推断】实现票补。
3. 【③与 T6】并行链路，非延长：T6 自闭环 commitChapter 钉版（正文相位翻转=线性化点，local-data-plane.ts:152-154）
   → propagateStaleMarkers（183-185）。Phase 5 不插链内；唯一接线 = 公共落定出口后顺序执行
   「落定 → reloadManifest 重基线 → propagateStaleMarkers → 嗅探动作」，接线点收敛在数据面落定出口（单点）。
4. 【④V1 切片】验收判据见 §5：单实体改动 → 检出/落定/幂等 → 机械圈定单一受影响章 → 语义判定，7 条判据全可测。

```
【接线图（文字）】
外部编辑 ──T5：scanExternalModifications('startupScan') / startWatcher(mtime 预筛→SHA-256) / preWriteReferral
        ──► ReconciliationProposal（detected→extracting→awaiting_author→applied|partially_applied|dismissed, extract_failed）
        ──落定(resolvedAt)──► reloadManifest 重立基线（local-data-plane.ts:187-190）
管线commit ──► 第8步 recordProposal: CanonProposalCreated（session.ts:264-277）──► 第9步 markCommitted: CanonCommitted（279-298）
        ──落定(事件行)──► 同一出口
ADR-0014 guided mutation ──【推断】──► 复用同落定通道
                                              ┌──────────────────────────────────────────────┐
                                              ▼ 公共落定出口（唯一接线点，Phase 5/T6 各自消费）  ▼
                              顺序：落定 → reloadManifest → propagateStaleMarkers(T6, 183-185) → 嗅探动作(Phase 5)
```

## 1. 票面要件（issue #62 真源 = gh api）

标题：研究：变更入口与触发编排——canon 改动落定后的嗅探协议
交付要求：研究结论 + 接线图（文字），给实现票可直写。产出 docs/research/tNN-c-change-ingress.md

票面四问原文：
1. 变更入口盘点：canon 文件（设定/大纲/事实 JSONL）被改的路径有哪些——T5 watcher（外部编辑）、
   ProposalPort 管线 commit（内部 canon 提案 confirm）、guided mutation（ADR-0014 引导式突变协议）
   ——各自『改动落定』的确切信号
2. 触发编排：嗅探动作挂在哪个事件/步后（复用 Flywheel afterRecord 注入缝先例？）；幂等重扫；
   全书扫描预算（N 章上限、超限分批）
3. 与既有 StaleMarker 传播（T6：commitChapter 钉版→propagateStaleMarkers）的关系：Phase 5 是延长链路
   还是并行链路——给出唯一接线
4. 渐进回报：V1 最小可验证切片（单实体改动→单一受影响章→机械圈定+语义判定）的验收判据

注：父任务书将 Q2 先例写作「record-step afterRecord」，票面正文写作「Flywheel afterRecord」——语义一致
（记录步后的注入缝），以票面为准。Flywheel 对应 ADR 存在：docs/adr/0005-policy-flywheel-and-privacy-tiering.md。

## 2. 问题① —— 变更入口三路径盘点

### 2.1 路径 A：T5 watcher 外部编辑（对账提案通道，证据最全）
入口与检测：
- 触发源三分：startupScan / watcher / preWriteReferral（reconciliation.ts:73），承诺「最终必检出」
  （reconciliation.ts:6-7）。
- startupScan：应用壳在 LocalDataPlane.open 后立即调用 scanExternalModifications('startupScan')
  （reconciliation.ts:593-596；接线说明 local-data-plane.ts:193-201）。
- 运行期 watcher：startWatcher 立 mtime 快照，周期（缺省 2000ms）比对，漂移才走 SHA-256 复核
  （reconciliation.ts:568-573,603-621,631-659；盘上消失用 NaN 哨兵必判漂移 654-655）。
- preWriteReferral：S3 写前校验抛错后由调用方转介指定路径 intakePaths（reconciliation.ts:689-697）。
- 对账边界：只有 phase=committed 的正文章修改触发对账；draft 自由改不入面（S2）
  （local-data-plane.ts:113-114,135-136,142）。
状态与落定：
- 状态机（注释称「五态」）：detected → extracting → awaiting_author → applied | partially_applied |
  dismissed；extract_failed 为失败态（reconciliation.ts:64-71；OPEN_STATES=detected/extracting/awaiting_author/
  extract_failed 574）。ReconciliationProposal 字段全集 155-173（proposalVersion:1、proposalId=rcln_<ulid>、
  relPath、state、triggerSource、detectedAt、baselineSha256/diskSha256、summary、resolvedAt、resolution、抑制账本）。
- 提案仓持久化：.mozhou/reconciliations/<proposalId>.json，tmp+rename 原子写（reconciliation.ts:699-711）。
- 检出事件：ReconciliationProposed{proposalId, relPath, triggerSource, summaryKind}（reconciliation.ts:788-793）。
- ▶ 改动落定信号 = state ∈ {applied, partially_applied, dismissed} ∧ resolvedAt ≠ null ∧ resolution 定值
  （reconciliation.ts:169-170），随后 LocalDataPlane.reloadManifest 重载基线（S4 吸收后保持 getter 一致，
  local-data-plane.ts:187-190）⇒ verifyBaseline 不再列该路径 ⇒ 幂等收口。
- 自动收口：盘上已回退到基线的未决提案自动 dismissed（reconciliation.ts:672-684）。

### 2.2 路径 B：ProposalPort 管线 commit（内部 canon 提案 confirm）
- 管线会话（ChapterProductionSession，pipeline/src/session.ts:125）第 8 步步锚 =
  recordProposal：仅 step==='canon_proposal' 时可写，StepGuardError 守卫；发布 CanonProposalCreated（提案头），
  「配对约束要求其被 CanonCommitted 闭合——发布总线当场强制」（session.ts:263-277）。
- 第 9 步步锚 = markCommitted(commitId)：一 session ↔ 一 commit 的唯一写点；二次提交即拒；发布 CanonCommitted
  「完成态自此以账本存在性为单一事实源」（session.ts:279-298）。
- 数据面真实写：LocalDataPlane.commitChapter = 原子三件套——正文相位翻转（线性化点）+ 追踪流增量 + 事件行
  （local-data-plane.ts:151-154）。
- ▶ 改动落定信号 = CanonCommitted 事件行落账（session.ts:292-297）∧ commitChapter 相位翻转完成
  （local-data-plane.ts:153）；拒绝路径 = StepGuardError('canon_proposal'|'commit', …)（session.ts:269,285）。
- 注：session.ts 无 ProposalPort 字样（grep 'ProposalPort' 无命中），【推断】ProposalPort 为管线侧对
  canon_proposal 步/提案端口的抽象名，实现票需确认端口文件位置。

### 2.3 路径 C：ADR-0014 guided mutation（引导式突变协议）
- 存在性（目录元数据证实）：docs/adr/0014-canon-conflict-reconciliation-and-intentional-mutation.md
  （与票面「ADR-0014 引导式突变协议」吻合；标题语义 = canon 冲突对账 + 意图性突变）。
- 内容未读（超出三锚点只读范围），落定信号【推断】：guided mutation 是冲突场景对 canon 的意图性写入，
  落定应复用与 A/B 一致的通道——对账提案终态（若走对账面）或 CanonCommitted 类事件行（若走管线面）。
  实现票 P0 = 补读 ADR-0014 定稿。

### 2.4 「改动落定」确切信号对照表
| 路径 | 入口 | 落定信号（确切） | 证据 |
|---|---|---|---|
| A T5 外部编辑 | watcher / startupScan / preWriteReferral | 提案终态 applied/partially_applied/dismissed + resolvedAt 非空；随后 reloadManifest 重基线，不再可检出 | reconciliation.ts:169-170,672-684,788-793；local-data-plane.ts:187-190 |
| B 管线 commit | 第 8 步 recordProposal（canon_proposal 守卫） | CanonCommitted 事件行落账（一 session↔一 commit）；拒绝 = StepGuardError；数据面 commitChapter 相位翻转 | session.ts:264-277,279-298；local-data-plane.ts:151-154 |
| C ADR-0014 guided mutation | mutation 协议（戳 docs/adr/0014-…） | 【推断】复用 A/B 落定通道；待补读 ADR-0014 定稿 | docs/adr/0014-…（元数据） |

## 3. 问题② —— 触发编排（嗅探动作挂接点）

### 3.1 注入缝先例
- 票面点名「复用 Flywheel afterRecord 注入缝先例？」——Flywheel（学习飞轮）afterRecord 类注入缝是生态内
  「记录步后挂动作」的既定模式（对应 ADR：docs/adr/0005-policy-flywheel-and-privacy-tiering.md；缝的代码位
  未在锚点内，标记为票面给定的先例）。
- 管线侧同类缝现成：session.ts 的 #publish 事件总线——recordProposal / markCommitted / finish 均为
  「步后落事件行」的注入缝（session.ts:254-260,271-277,292-298）；对账侧同类缝 = ReconciliationService 的
  emitEvent('ReconciliationProposed')（reconciliation.ts:788-793）。

### 3.2 挂接选择与幂等
- 推荐挂接：嗅探动作挂「落定后」（终态判定），触发输入 = 提案（proposalId/relPath/基线指纹）；不挂 watcher
  轮询内部（mtime 预筛是检测层，非业务信号）。
- 幂等（全部现成，无需新造）：
  1) 同路径已捕获且盘上未再动 → 不重复提案（reconciliation.ts:760-762）；
  2) 同路径二次编辑 → 刷新同一 proposalId（保留 id 与 detectedAt）（758-766）；
  3) 盘上回退基线 → 自动 dismissed（672-684）；
  4) 抑制账本：已被拒的差异对不再重复上报（rejectedLineChanges/Additions，149-153,817+）。
- 嗅探动作自身幂等键 = proposalId（或 relPath+diskSha256）【推断：实现约束】。

### 3.3 全书扫描预算
- 运行期 watcher：每拍 O(n) stat（mtime+size 快照比对），缺省 2000ms；仅漂移文件进 SHA-256 复核
  （reconciliation.ts:568-573,631-644,646-659）→ 常态零 hash 开销。
- 全量 SHA-256 复核仅出现在 startupScan（verifyBaseline 对每个基线条目录 size+sha256，local-data-plane.ts:119-131）
  与确定性 pollOnce（测试/精确控制，reconciliation.ts:598-601）。
- 票面要求「N 章上限、超限分批」：现 ReconciliationOptions 仅 extract 注入点（reconciliation.ts:563-566），
  无预算/分批参数【推断】＝实现票在 ReconciliationOptions 增 batch 上限 + 超限分批（可测：intervalMs 已可配
  568-571）。

## 4. 问题③ —— 与 T6 StaleMarker 传播的关系

### 4.1 T6 链路现状（自闭环）
- commitChapter 钉版：正文相位翻转 = 线性化点 + 追踪流增量 + 事件行（local-data-plane.ts:151-154；实现自
  @mozhou/kernel 10-11）。
- propagateStaleMarkers：LocalDataPlane 面 = 命中章的章大纲节点获得 StaleMarker{reason, upstreamRefs, markedAt}，
  正文零触碰（验收②），且是「保护位工件唯一的合法自动写入通道」（local-data-plane.ts:179-185）。
- T6/I3 查询面：queryInvalidatedKnowledgeStates（170-176）。

### 4.2 结论：并行链路，唯一接线
- Phase 5 是并行消费者，不是 T6 链的延长段：不修改 commitChapter 内部、不把嗅探塞进化步；
  T6 的钉版→传播闭环保持原样。
- 唯一接线（一条）：以「canon 改动落定」为公共触发点，线下游按固定顺序消费：
  落定（A 终态提案 / B CanonCommitted）→ reloadManifest 重基线（local-data-plane.ts:187-190）
  → propagateStaleMarkers（T6，183-185）→ 嗅探动作（Phase 5）。
  接线点收敛为数据面单个出口（LocalDataPlane/ReconciliationService 落定回调），A/B/C 三路共用
  ⇒ 管线会话内零散接、嗅探与污染传播不重复实现。具体接线形态（回调 vs 事件总线）见 §7 推荐。

## 5. 问题④ —— V1 最小可验证切片验收判据

V1 切片 = «单实体改动 → 检出落定 → 机械圈定受影响章 → 语义判定 → 幂等/预算可测»，判据：
1. 检出：外部编辑单卡（entityCard / 事实 JSONL）后 scanExternalModifications('startupScan') 返回
   ScanOutcome.proposed 含 {proposalId, relPath, state:'awaiting_author', triggerSource:'startupScan',
   summary.kind ∈ {entityCard,newEntityCard}}，且 .mozhou/reconciliations/<id>.json 落盘
   （reconciliation.ts:144-145,155-173,175-178,705-711,769-795）。
2. 落定：应用后 state='applied'、resolvedAt≠null、resolution='applied'；reloadManifest 后
   verifyBaseline().modified 不再含该路径（reconciliation.ts:169-170；local-data-plane.ts:116-144,187-190）。
3. 幂等：重复 scan/watcher 同盘面不再产出重复提案；盘上回退自动 dismissed；被拒差异对不上报
   （reconciliation.ts:760-762,672-684,817+）。
4. 机械圈定：单实体改动可由现有查询面圈定到单一受影响章——queryActiveFacts(chapter, entityIds, pov)
   （local-data-plane.ts:161-168）与 queryInvalidatedKnowledgeStates（170-176）。
5. 语义判定：嗅探输出 = 受影响章 id + 判定原由（机械圈定段 + 语义判定段）；语义段以确定性摘要为输入、
   走 extract 注入缝替换（确定性缺省 buildDefaultExtractor，reconciliation.ts:496；LLM 语义提取为后续票注入点
   181-182,563-566）。
6. T6 并行接线：提案 applied 后 outline 节点出现 StaleMarker{reason,upstreamRefs,markedAt} 且正文零触碰，
   可经查询面证实（local-data-plane.ts:170-176,179-185）。
7. 预算可测：全量扫描（startupScan）在单章以内是常数级 stat+hash；watcher 周期只 stat；intervalMs 可配
   （reconciliation.ts:568-573; local-data-plane.ts:119-131）。

## 6. 证据清单

### 6.1 分析性证据（结论 → 来源）
| 结论 | 证据 |
|---|---|
| 触发源三分 + 最终必检出承诺 | reconciliation.ts:6-7,73 |
| 对账提案状态机（detected→…→applied/partially_applied/dismissed, extract_failed） | reconciliation.ts:64-71,560,574 |
| 提案字段（proposalId/resolvedAt/resolution/基线指纹/抑制账本） | reconciliation.ts:155-173 |
| 提案仓原子持久化 .mozhou/reconciliations/*.json | reconciliation.ts:699-711 |
| 检出事件 ReconciliationProposed | reconciliation.ts:788-793 |
| 幂等：同路径不重复/二次编辑刷同 id/回退自动 dismissed/抑制账本 | reconciliation.ts:760-762,758-766,672-684,817+ |
| watcher mtime 预筛→SHA-256；缺省 2000ms；NaN 哨兵判删 | reconciliation.ts:568-573,603-621,631-659 |
| startupScan 全量 size+SHA-256；draft 不入面；committed-only | local-data-plane.ts:113-144 |
| 落定后 reloadManifest 重基线 | local-data-plane.ts:187-190 |
| 管线第 8/9 步：CanonProposalCreated→CanonCommitted 配对；唯一写点 | session.ts:263-298 |
| commitChapter 相位翻转=线性化点 | local-data-plane.ts:151-154 |
| T6：propagateStaleMarkers / StaleMarker 三字段 / 唯一自动写入通道 | local-data-plane.ts:179-185 |
| ADR-0014 存在（引导式突变/意图性突变） | docs/adr/0014-canon-conflict-reconciliation-and-intentional-mutation.md（元数据） |
| Flywheel ADR 存在（afterRecord 先例出处） | docs/adr/0005-policy-flywheel-and-privacy-tiering.md（元数据） |
| 票面正文/产出文件名/Part of #59 | gh api repos/xiaohai-uid/mozhou/issues/62（title+body 全文引于 §1） |

### 6.2 未实证项（显式标注）
- ADR-0014 内容 → 落定信号【推断】；ProposalPort 符号位置【推断】；飞轮 afterRecord 代码位【推断】；
  书目扫描预算参数现状【推断（Options 面可见无该参数，563-566）】。

## 7. 实现票可直写推荐

- P0-1 补读 docs/adr/0014-canon-conflict-reconciliation-and-intentional-mutation.md，定路径 C 落定信号
  （预期：复用 §2.4 A/B 通道其一）。
- P0-2 落定事件化：在 ReconciliationService 提案达终态（applied/partially_applied/dismissed）处补发
  「落定事件/回调」（现只有检出事件 ReconciliationProposed，reconciliation.ts:788-793），或由调用方轮询
  listProposals 终态；嗅探动作只挂此信号。
- P0-3 唯一接线（§4.2）：数据面统一落定出口，顺序 = 落定 → reloadManifest（local-data-plane.ts:187-190）
  → propagateStaleMarkers（183-185）→ 嗅探动作；管线会话内零散接。
- P1-1 ReconciliationOptions 增扫描预算：N 章上限 + 超限分批（reconciliation.ts:563-566 扩展）；
  WatcherOptions.intervalMs 已是暴露参数（568-571），接入配置。
- P1-2 嗅探幂等键 = proposalId / relPath+diskSha256；复用抑制账本（reconciliation.ts:817+）。
- 验收：§5 判据 1-7 可测项全绿；新增测试不低于 1：1（仓库 UVSD 规约 §5：每变更必带测试）。
