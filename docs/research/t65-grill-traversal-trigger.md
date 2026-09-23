# T65 遍历与触发面 Grilling 终裁记录（issue #64）

> 主持：Wayfinder grilling ｜ 日期：2026-08-27 ｜ 状态：终裁定稿
> 输入：票面 #64 决议项 + t64-grilling-input（D01-D07/D18-D22 + R1/R2/R7）+ t60/t62 研究 + ADR/代码复验
> 基线纪律：研究建议为基线；推翻必须给规格/ADR/代码级证据；数值类一律给定案值；无法决断 → DEFER。
> 同session姊妹票：#65/t66（语义层与复用面）已定稿——本票全局裁定与涉及其边界的裁决与其保持口径一致。

## 0. 全局裁定（继承 t66 §0 三条 + 本票补充）

- 【终裁】确定性层与语义层边界按 ADR-0024:26（Gate 纯机械+LLM 旁路）+ ADR-0003（Step1 确定性遍历/Step2 语义评估/Step3 作者动作）双锚定；本票所有『谁写谁不写』裁决以此为母版。
- 【终裁】词表纪律（domain-events.ts:4-6 唯一真源 + 死词条禁止回填 :9-10）全程适用；本票不批准任何新的词表增补（见下）。
- 【终裁】确定性面的全部产出（受影响集/StaleMarker/impact 投影）是**机械可复算的派生数据**：重建幂等指纹一律采用『排序后内容集合哈希』（vault verified 记忆 D1）、剥离时间戳与 ULID 随机分量（t66 D25 同款）。
- 【终裁·本票补充】**嗅探/触发/传播一律不新增事件词条**：t66 已裁决『对账终态信号已存在、无需为语义层或投影层发明新事件』（t66 D26）；本票将其扩展到确定性面——落定信号用既有对账终态读侧 + 数据面公共出口回调（见 D19/D20），Traversal 成对事件仅作**遍历生命周期观测**（E1/E2，词表 15→17，t66 R4 已批 18 词条口径成立）。

## 1. 确定性遍历决议（D01-D07）

**D01 下游索引形态**
【终裁】批准候选 (c) 混合窗内缓存。定案：pins 常驻内存 + 按 seq 增量读新增行，查询仍 O(章数)；**保留 findReaders(pins, entry)→number[] 单缝**（未来全量倒排只换实现不动调用方）；当前规模和提示下**不建图倒排索引**（千章级或热点查询实证后再建）。ADR 0003:20『query the dependency graph index』措辞与 (c) 的意图-落点缺口 → 并入 D07 同批修订。
证据：t60:3.3-1..4（成本驱动）；stale.ts:64-97（现状全扫）。

**D02 嗅探触发编排**
【终裁】批准『双入口信号、单一传播函数』：对账终态（applied/partially_applied/dismissed ∧ resolvedAt≠null）+ CanonCommitted 事件行两入口，收敛调用同一传播函数；后台/手动仅作降级与调试面。触发侧按对账条目级天然一次 + 抑制账本先例（reconciliation.ts:149-153）去重。
证据：t60:4.2-1；reconciliation.ts:64-74；session.ts:279-298；t62:4.2。

**D03 传播写面幂等**
【终裁】批准标记等价短路 (a)：传播判定面确定性纯函数（computeStaleMarker，stale.ts:203-208）不变；写面前 readOutlineStaleMarker 读回既有标记（stale.ts:114-134）与计算值**逐字段全等则跳过写**（revision 不变、原子替换不触发），不等才写（applyMarkerToOutlineNode 现 revision+1，stale.ts:150-160）。判据『同标记再传=零写』进实现票 AC。与 D02 触发侧去重构成双保险，watcher 抖动/双入口竞态依赖此短路。

**D04 跨章遍历预算**
【终裁】批准阈值触发降级 (b)，数值定案：**账本 ≤20k 行（回读成本护栏）、pin ≤2k、单次传播 ≤100ms**；超限降级后台队列 + 打点（失败显式、绝不静默）。与 D21 扫描面预算（N=100 章/批）联合：D04 管传播面、D21 管扫描面，两口径分层不冲突。
证据：t60:4.2-3（预算护栏=账本回读 IO）；reconciliation.ts:568-571（intervalMs 可配先例）。

**D05 Stale 停靠点**
【终裁】批准 (a) 唯一停靠 = 章大纲节点 StaleMarker 三字段（T6 既有，stale.ts:103-105）+ (d) 可选叠加 = impact 派生投影（.mozhou 运行时区、与 usage.jsonl 同层、非 canon，record-step.ts:23）。**不标正文**（I1 挡内容重写，stale.ts:11）、**不标 commit 粒度**（upstreamRefs 已带精确 (kind,id,revision)+markedAt+reason，commit 粒度不增信息，stale.ts:156-160）。正文级判定归 ADR Step 2 语义层（ADR-0003:21）。impact 投影由 StaleMarker 派生、可重建、可弃，不新增语义字段。

**D06 钉版组装源**
【终裁】管线侧 (b)：pipeline/compile-step 产出 dependencyManifest——compile-step 已消费 stale 面（compile-step.ts:65-90），组装与消费同侧；context-compiler 保持纯装配（compile() 不产 manifest 为既有事实，不改其缝）。依赖 T6 承诺语义（chapter.ts:435-440）。

**D07 票面/代码措辞差**
【终裁】以代码实证为准 (a)：字段为 revision（≥0 整数版本号，kernel-schema.ts:107-111,481-483），**维持 revision 语义**——改 SHA 会破坏后到者胜（revision 可比较、SHA 不可比较，stale.ts:88-92『无 manifest 即清退』依赖此序）。修订 issue #60 票面措辞与 ADR 0003（核对其是否含 SHA 字样）随 T25 实现票同批；与 D01 的 ADR 意图修订合并处理。

## 2. 变更入口与触发编排决议（D18-D22）

**D18 三路径『改动落定』信号**
【终裁】A/B 实证信号直接定稿：A = 对账提案终态（applied/partially_applied/dismissed ∧ resolvedAt≠null ∧ resolution 定值，reconciliation.ts:169-170）随后 reloadManifest 重基线（local-data-plane.ts:187-190）；B = CanonCommitted 事件行落账（session.ts:279-298）∧ commitChapter 相位翻转（local-data-plane.ts:151-154）。C（ADR-0014 guided mutation）【推断】复用 A/B 通道，为实现票 P0 前置补读（ADR-0014 全文）——**不阻塞 V1**（主路径 A 证据最全）。

**D19 嗅探挂接信号形态**
【终裁】**不新增 ReconciliationSettled 词条**：对账终态可读侧直接消费（决策缓冲/提案仓终态判定，既有信号已存在——t66 D26 已实证『对账终态信号已存在』）；若产品面需要『落定通知』，用数据面公共出口的**回调注入**（D20 载体）而非事件词表增补——词表纪律（domain-events.ts:4-6）与 t66 R4『18 词条是补全非膨胀、每条带发射方』平衡下，确定性面零新事件优先。不挂 watcher 轮询内部（mtime 预筛是检测层非业务信号，t62:3.2）。

**D20 唯一接线形态与消费顺序**
【终裁】(a) 数据面公共落定出口单点，顺序固定：**落定 → reloadManifest（local-data-plane.ts:187-190）→ propagateStaleMarkers（T6，:183-185）→ 嗅探动作（Phase5）**；形态 = **回调注入**（沿 record-step afterRecord 先例、proposal-port projectionSink 先例）——不用事件总线（零词表增补、与 D19 一致）；Phase5 是并行消费者、非 T6 链延长段——不改 commitChapter 内部、管线会话零散接。

**D21 全书扫描预算参数**
【终裁】批准增 batch 上限：ReconciliationOptions 增 **N=100 章/批** + 超限分批参数【定案值】；可测性靠 intervalMs 已可配（reconciliation.ts:568-571）。与 D04 分层（扫描面/传播面）联合生效。

**D22 V1 最小可验证切片范围**
【终裁】批准判据 1-7 全量（t62 §5）：检出→落定→幂等→机械圈定（queryActiveFacts/queryInvalidatedKnowledgeStates）→语义判定（走 extract 注入缝，reconciliation.ts:496,563-566）→T6 并行接线→预算可测。语义段依赖 D17 终裁——本票 §3 R2 已给出，**切片不退化为方案 b**。

## 3. 跨研究冲突终裁（R1/R2/R7）

**R1 双入口 vs 唯一出口**
【终裁】确认表述差：信号（A 对账终态 / B CanonCommitted）两入口、接线（T6 传播 + Phase5 嗅探）收敛数据面公共落定出口（D20）——非真冲突，无需调和代码。

**R2 遍历产物 vs 语义锚点（= D17）【核心终裁】**
【终裁】候选 (c)：**语义输入面 = 受影响章 diffs + 修改实体定义**（ADR-0003:21 决定性：『send only the impacted chapter diffs and modified entity definitions to an LLM evaluator』）+ **receipt 锚点伴随态**（receiptId+recomputationHash+changeSummaryDigest——标定『评估哪版编译』，不替代 affected 输入）。载荷携带形态：**diffs 以引用摘要进入 payload**（affectedRefs 具名 + 实体定义摘要，沿 spec:86 内容不内嵌纪律——引用 != 内嵌全文）；影响 D12 排序键（受影响章序，非对账命中序）与 D14 事件 payload 带 affected 摘要。t66 范围外提示（D17 留待专票）由本票闭合。

**R7 词表 15 vs 14**
【终裁】domain-events.ts:23-37 全量复验为 **15 词条**——简报『14』属转录笔误；实现票复核拆分/合并口径并在票面与 ADR 措辞对齐（与 D07 同批）；不影响相位（新词条核算按 15 基准，t66 R4 18 词条口径不变）。

## 4. 受控增补与实现票落点（本票范围）

- 【终裁】确定性面**零新事件词条**（D19：不增 ReconciliationSettled）；TraversalStarted/Finished（E1/E2，t66 已批）仅作遍历生命周期观测入词表（15→17），随 T27 实现票，带发射方义务。
- 【终裁】实现票切分沿用 t64 §4：T25 落定信号与唯一接线（含 D07 措辞修订）→ T26 传播面收口（D01-c/D03/D04）→ T27 遍历触发+impact 投影（D02/D05/D21/D22 机械段 + E1/E2/E4）→ T28/T29 语义层（D08-D17 落点，t66 终裁）→ T30 黄金对拍台架（D27/D28）。

## 5. DEFER 清单

- 无 DEFER。C 路径（ADR-0014 guided mutation 落定信号）为 T25 P0 前置补读项，不阻塞。