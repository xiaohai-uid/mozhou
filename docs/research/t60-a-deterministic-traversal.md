# T60-A 确定性图遍历层（Deterministic Traversal Layer）研究

> 纯文档研究票 · Phase 5 · GitHub issue #60（确定图遍历层）
> 研究员：墨舟 Wayfinder 角色 ｜ 日期：2026-08-26 ｜ 状态：定稿
> 范围：全仓库只读盘点；不改代码、不动 git；产物 ≤300 行。
> 证据纪律：结论带 文件:行号；无法实证标【推断】；reconciliation.ts 行号经姊妹票 t62 证据缓冲转录。

## 0. 结论速览

1. 现状：DependencyManifest 钉版随 ChapterCommitted 事件行落账（chapter.ts:613-625），消费方 6 处（stale 传播 / 管线 stale_warning / 基准面）；字段形状实证为 {kind, id, revision}（kernel-schema.ts:107-111），票面措辞"SHA"与代码不符。
2. 索引形态：**推荐 c) 混合——pins 窗内缓存 + 全扫查询**；成本驱动已识别为"账本回读 O(事件总数)"（stale.ts:64-97）；当前规模全扫毫秒级，倒排索引收益未显性，留 findReaders 单缝不建。
3. 触发：传播 API 已就绪但**生产未接线**（grep 实证）；嗅探 = 对账 applied 收口 + Commit 后双入口收敛单一传播函数；幂等需加"标记等价短路"（写面当前非幂等，stale.ts:150-160）；同步预算：账本 ≤20k 行、pin ≤2k【建议值】。
4. 停靠：**维持章大纲节点 StaleMarker 粒度**（T6 既有），不标正文、不标 commit 粒度；独立 impact 记录仅作 .mozhou 派生投影（可弃、不碰既有三字段语义）。

## 1. 研究范围与票面四问

### 1.1 已核实事实起点（前序研究员结论，直接采用）
- compile() 不产 manifest：context-compiler/src/compile.ts 无 manifest 引用。
- DependencyManifest 在 commit 步接收：data-plane/src/chapter.ts:440（类型字段）、:610-612（commitChapter 解析调用方传入的 dependencyManifest.entries，冻结校验后落事件行）。
- 管线侧组装/落账在 commit 流程（T3 原子三件套 + T6"DependencyManifest 钉版落事件行"承诺）。

### 1.2 issue #60 票面四问（gh api 实证）
① 盘点现状：DependencyManifest 落在哪些行（T6 事件行/commitChapter 产物）、字段形状（kind+id+SHA）、谁消费（T10a stale 传播/compile-step）——完整 AC
② 下游索引形态拍板：a) 全量图索引（每 commit 扫描 manifest 建 kind→章节倒排）b) 按需扫描（改动时扫全书 manifest）c) 混合（manifest 窗内缓存）——读昂度与修复频度权衡，给推荐+行数级成本
③ 遍历触发协议：canon 文件改动（T5 对账已检测）落定后何时嗅探（Commit 后/后台/手动）？幂等性？跨章扫描预算上限
④ STALE 停靠点：机械遍历产出受影响下游章集合后停在哪——章大纲节点已有 StaleMarker（T6），Phase 5 是否标到正文/commit 粒度，还是有独立 impact 记录（不碰既有 StaleMarker 语义）

> 协作提示：姊妹票 t62《变更入口与触发编排》持有触发挂接点决策（其 §3.2/3.3 待填）；本票与之交叉引用，不重复编排决策。

## 2. 现状盘点：DependencyManifest 的落点与消费方（问题①）

### 2.1 字段形状（kernel 实证）
- `DependencyManifest = { entries: readonly DependencyManifestEntry[] }`（kernel-schema.ts:481-483）；单条 `DependencyManifestEntry { kind: EntityKind; id: string; revision: number }`（kernel-schema.ts:107-111）。chapter.ts:436 注释同口径"编译时读到的 {kind, id, revision} 精确版本"。
- **票面措辞"kind+id+SHA"与代码字段 revision（≥0 整数版本号，非 SHA 串）存在措辞差，以代码实证为准**。
- kind 域：EntityKind 全集 11 值 = book / authorIntent / outlineNode / scene / temporalFact / knowledgeState / narrativePromise / relationshipState / timelineEvent / styleProfile / chapterCommit（kernel-schema.ts:114-125）。
- 校验面：`parseDependencyManifest(entries)` / `parseDependencyManifestEntry(row, index)` 冻结形状校验（kind ∈ ENTITY_KINDS、id 非空、revision ≥0 安全整数），坏清单抛 DependencyManifestError（protection.ts:152-170）；"宁败不脏"——坏清单不产生半提交（chapter.ts:608 注释）。

### 2.2 产生/落账路径（commit 侧，T3+T6）
- 输入面：CommitChapterRequest.dependencyManifest?（chapter.ts:435-440）——T6 钉版，语义为"编译时读到的上游精确版本"。
- 校验落账：commit 时 parseDependencyManifest(request.dependencyManifest.entries) 冻结校验后进 manifestFields（chapter.ts:608-612），与 ChapterCommitted 事件行同构、同一 appendTargets 原子三件套内落 .mozhou/events.jsonl（chapter.ts:613-632；PendingCommitJournal 同批 journal，chapter.ts:634-640）。T3 原子性与 T6 承诺在 commit 面已就位。
- 后到者胜：不带 manifest 的新提交清退该章旧钉版（chapter.ts:437-439；stale.ts:88-92 读侧同语义）。
- pins 物理落点 = 事件账本：ChapterCommit 无独立实体文件（T3 三件套）；账本在运行时区，丢失时传播安全降级为"无可标记章节"、永不误标（stale.ts:15-17）。

### 2.3 消费方清单（读侧，6 处）
1. **stale.ts pin 表**：readChapterDependencyPins 逐行回读 events.jsonl 合并出 ≤章数 条 pin（{chapterIndex, commitId, manifest}）（stale.ts:40-44,64-97）；propagateStaleMarkers 按 (kind,id) 对齐、revision 漂移即命中（stale.ts:170-179,194-208）。
2. **StaleMarker 编解码**：命中章的轮廓节点 frontmatter 落三字段 staleReason / staleMarkedAt / staleUpstreamRefs（stale.ts:103-105,136-163）；reason 枚举 upstream_canon_changed / upstream_outline_changed / dependency_manifest_mismatch（stale.ts:107-111）。
3. **pipeline/prepare.ts:243**：readOutlineStaleMarker(document.data) → prepared.staleMarker；I2 语义=建议性重验信号，警告继续、不阻塞管线（prepare.ts:8）。
4. **pipeline/compile-step.ts:65-90**：StaleMarker → 确定性 stale_warning 结构层段；renderStaleWarningContent 字段拼接+上游引用升序，同标记必同文（compile-step.ts:71-72）。注意：compile-step 消费 stale，但 compile() 自身不产 manifest（已核实事实）。
5. **benchmark/metrics.ts:29,126 + run.ts:45**：DependencyManifestEntry 用于 ContextReceipt.dependencies / modifiedEntities——基准面吃真实结构不建平行世界（metrics.ts:6）。
6. **context-compiler/l1-lifecycle-bench.ts:571**：台架直调 propagateStaleMarkers 验证传播（级联验证面）。

### 2.4 缺环（Phase 5 要补的两处空白）
- **钉版组装源未接**：compile() 不产 manifest → dependencyManifest 目前只能由管线在 commit 时从别处组装；T6 落账面就绪、组装面空白。
- **遍历触发未接线**：propagateStaleMarkers 生产调用方 = 无（仅 stale.test.ts / compile-step.test.ts / l1-lifecycle-bench.ts:571 / local-data-plane.ts:36 导出）；"T5 canon 改动落定后何时嗅探、幂等、跨章预算"三项未定（问题③），停靠粒度未定（问题④）。

## 3. 下游索引形态拍板（问题②）

### 3.1 现状即候选 (b)：按需全扫
- propagateStaleMarkers 每次调用全量重建 pins：readChapterDependencyPins 逐行回读 .mozhou/events.jsonl（stale.ts:64-97）——解析每一行 JSON、跳过撕裂行/非 ChapterCommitted、后到者胜合并（stale.ts:70-96）。
- 成本驱动 = 账本行数（O(事件总数)）而非 entry 数：账本含全部事件类型（ChapterCommitted/GenerationFinished 等），100+ 章多轮提交后【推断】5k-20k 行、0.1-2MB；单次全量回读+解析毫秒级。
- ADR Step 1 措辞"query the dependency graph index"（ADR 0003:20）表明图索引是设计意图——但实现落在 (b)，意图与落点有缺口，正是本问要拍板处。

### 3.2 三候选成本对照（行数级口径）
- **(a) 全量倒排**：每 commit 把该章钉版增量并入 (kind,id)→[chapterIndex]（后到者胜=整章条目替换，天然幂等可重建；形状由 protection.ts:152-170 冻结保证不脏）；传播查询 O(命中读者数)≈O(k)，k≪章数。存储≈pin 条目数（5k-20k 级）。代价：投影生命周期管理 + 与 pins 双份一致。
- **(b) 现状全扫**：每次传播 O(账本行数 + 章数×平均条目)；零索引负担；延迟随账本线性增长。
- **(c) 混合窗内缓存**：pins 镜像常驻内存，触发时按事件行 seq 增量读新增行（ChapterCommitted 事件行自带 seq，chapter.ts:615）；失效键=账本尾部 seq；查询仍 O(章数)（≤100），账本 IO 摊薄为增量。实现可借 record-step afterRecord 注缝先例（t62:3.1）。

### 3.3 推荐：c) 混合 = 窗内缓存 + 全扫查询，倒排留缝不建
1. 当前规模（100+ 章、账本 <20k 行）下 (b) 全扫 µs-ms 级，倒排 (a) 的 k-vs-N 收益尚未显性——直接建图索引属过拟合；符合工程原则"最简单实现、分层生长"。
2. (c) 把成本驱动从"账本行数"降到"增量行数"，且不改 stale.ts 查询骨架（计算正确性零回归）。
3. 留升级单缝：把"查某 (kind,id) 的读者章"收敛为 findReaders(pins, entry) → number[] 单一函数——(c) 下全扫实现，(a) 落地时替换实现不动调用方。
4. 真正建 (a) 的触发条件：千章级 或 传播查询成为热点路径（每次 canon 落定多章多轮查询）——届时从 pins 源重建倒排投影（可弃投影，内容集指纹幂等验证，T10b 台架先例）。
5. benchmark/metrics.ts:29,126 已消费同一 DependencyManifestEntry 形状——索引若建必须与 pins 同源同校验，不建平行世界。

## 4. 遍历触发协议（问题③）

### 4.1 现状：传播 API 就绪、生产未接线
- grep 全仓：propagateStaleMarkers 生产调用方 = 无（仅 stale.test.ts / compile-step.test.ts / l1-lifecycle-bench.ts:571 台架 / local-data-plane.ts:36 导出）→ 触发是 Phase 5 的新增接线工作，"何时嗅探"目前无代码约束。
- T5 canon 改动落定信号 = 对账条目 applied/partially_applied 收口（ReconciliationState 五态终态 reconciliation.ts:64-74【经 t62 转录】；三触发 'startupScan'|'watcher'|'preWriteReferral' reconciliation.ts:73【经 t62 转录】；watcher 轮询缺省 2000ms reconciliation.ts:573【经 t62 转录】）。
- 管线侧另有一个落定点：ChapterCommitted 事件行已含 dependencyManifest（chapter.ts:613-625），"Commit 后"同步钩子可行（record-step afterRecord 注缝先例 t62:3.1）。

### 4.2 推荐协议（挂接点选择详参 t62，本票定传播面契约）
- **嗅探时机：双入口收敛单一传播函数**：(i) 对账 applied/partially_applied 收口后嗅探（canon 改动落定即触发，upstreamChanges 由 T5 检测结果组装）；(ii) Commit 后同步钩子（管线内 canon 提案确认路径）。后台/手动仅作降级与调试面。
- **幂等（两段）**：
  - 判定面：传播是确定性纯函数——同 (upstreamChanges, pins) 必同标记（computeStaleMarker 纯计算 stale.ts:203-208）。
  - 写面：applyMarkerToOutlineNode 每次命中 revision+1（stale.ts:150-160），**非幂等** → Phase 5 需加"标记等价短路"：readOutlineStaleMarker 读回既有标记（stale.ts:114-134）与计算值逐字段全等则跳过写；不等才写。短路后整体幂等，watcher 抖动/双入口竞态零副作用。
  - 触发侧补充去重：同一对账条目/同一 (kind,id,revision) 变更只传播一次（对账条目级天然一次；抑制账本先例 reconciliation.ts:149-153【经 t62 转录】）。
- **跨章预算上限【建议值】**：同步嗅探预算 = 账本行数 ≤20k、pin 数 ≤2k（当前 100+ 章远在预算内），超限降级后台队列；单次传播时间预算 ≤100ms，超限打点。传播比较开销在 (c) 缓存配合下约 O(章数)——预算实质护栏的是账本回读 IO。

### 4.3 与 t62 的关系
- t62（变更入口与触发编排）拥有挂接点与编排决策（§3.2/3.3 待填）；本票定义传播面契约（幂等短路、预算、单一入口），t62 选挂接点时可直接采用。

## 5. STALE 停靠点（问题④）

### 5.1 既有停靠（T6 已实现）
- 停靠 = 章大纲节点 frontmatter StaleMarker 三字段（staleReason / staleMarkedAt / staleUpstreamRefs；stale.ts:103-105，落笔 applyMarkerToOutlineNode stale.ts:136-163）。
- 正文一个字节不动（结构性保证 stale.ts:9,192）；不置 OutlineNodeStatus='stale'、不触发删除/重生成、清除归后续交互票（stale.ts:12-13）。

### 5.2 Phase 5 判定：维持大纲粒度；不标正文、不标 commit 粒度；impact 记录仅作派生投影
- **不标正文**：正文是作者资产，确定性层只写规划面（I1 挡内容重写 stale.ts:11）；正文级影响判定属 ADR Step 2 语义层（LLM 分类 direct_conflict/indirect_drift/cosmetic_only/no_action_needed，ADR 0003:21），非确定性层职责。
- **不标 commit 粒度**：StaleMarker.upstreamRefs 已携带精确 (kind,id,revision)（stale.ts:156-160）+ markedAt + reason——机械面信息已完整；"哪个 commit 失效"属审计查询，可从事件账本回查（stale.ts:64-97 同源）【推断：commit 级标注不增加定位信息】。
- **独立 impact 记录（可选、派生投影）**：若 UI/查询需要"受影响下游集合"的结构化面，建 .mozhou 运行时区投影（与 usage.jsonl 同层、非 canon 不参与对账，record-step.ts:23）——内容 {upstreamRefs, markedChapters, at, reason}，由 StaleMarker 派生、可重建（可弃投影原则），不新增 StaleMarker 语义字段、不改既有语义。
- **边界纪律**：唯一接线 = propagateStaleMarkers 单一入口（对齐 t62:4.2）；author 确认后的清除不改 StaleMarker 语义、归后续交互票（stale.ts:13）。

## 6. 开放问题与后续动作

1. 钉版组装源：compile 步如何产出 dependencyManifest（context-compiler 与 pipeline/compile-step 的分工）——需独立小票或在 Phase 5 内联【推断：与 T6 承诺同批，建议随实现票解决】。
2. 幂等短路的落点与测试判据：同标记再传 = 零写（revision 不变、原子替换不触发）——建议进实现票 AC。
3. 语义层（ADR Step 2）输入契约：Phase 5 输出的 affected 集合 + 差异摘要的握手形状待定，建议 Phase 5 收尾时与语义评估票对齐。
4. t62 未定稿：挂接点最终选择待 t62 结论出来回填 §4.2 引用。
5. 标记清除交互（author 确认后）排期——已知归后续交互票（stale.ts:13）。

## 7. 证据索引（结论 → 证据 文件:行号）

| # | 结论 | 证据 |
|---|------|------|
| 1 | 字段形状 {kind,id,revision} | kernel-schema.ts:107-111,481-483；protection.ts:152-170 |
| 2 | EntityKind 11 值 | kernel-schema.ts:114-125 |
| 3 | 钉版落事件行（T3+T6） | chapter.ts:435-440,608-632,634-640 |
| 4 | 后到者胜 / 无 manifest 即清退 | chapter.ts:437-439；stale.ts:88-92 |
| 5 | pins 全量事件账本回读 | stale.ts:64-97 |
| 6 | 逐 pin 计算命中 | stale.ts:194-229（202-208 核心循环） |
| 7 | 写面 revision+1 非幂等 | stale.ts:150-160 |
| 8 | 正文零触碰 / I2 不清除 | stale.ts:9,12-13,192 |
| 9 | StaleMarker 三字段与 reason 枚举 | stale.ts:103-111,152-160 |
| 10 | 管线消费（prepare/compile-step） | prepare.ts:8,243；compile-step.ts:65-90 |
| 11 | 基准面消费同形状 | metrics.ts:6,29,126；run.ts:45 |
| 12 | 传播生产未接线 | grep 实证（无 pipeline 调用方） |
| 13 | T5 对账五态 / watcher | reconciliation.ts:64-74,149-153,573（经 t62 转录） |
| 14 | ADR 双图层与 Step1-3 | ADR 0003:9-22 |
| 15 | 姊妹票 t62 分区 | t62 §3.1/§3.2/§3.3/§4.2 |
