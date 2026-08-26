---
date: 2026-08-24
description: "#47 AuthorPreferenceLearner 信号面与推理面——三类事件取证、特征最小面、P1 边界与 κ 加权增量更新协议"
tags: [mozhou]
---

# T47-A · AuthorPreferenceLearner：信号面与推理面研究

> 对应 issue：xiaohai-uid/mozhou#47（Phase 4 数据飞轮四研究票之一，地图票 #46）
> 规范性输入：[[data-flywheel-spec]] §2/§3.1/§4 · [[0005-policy-flywheel-and-privacy-tiering]] · [[0013-generation-concurrency-and-preference-sampling]] · CONTEXT.md 词条 ScenarioStyleProfile(L67)/Policy Flywheel(L247)/Author Model(L251)/Event Ledger(L259)/Privacy Tier(L263)/Task Projection(L203)
> 代码真源：packages/kernel/src/domain-events.ts（词表）· packages/pipeline/src/{multi-candidate,user-edit-step,record-step,ledger}.ts（生成与落账）
> 调查方式：纯本地只读取证，不改代码不动 git。日期 2026-08-24。所有行号以当日工作树为准。

---

## 0. 结论速览

| # | 发现 | 含义 |
|---|---|---|
| F1 | candidate_decision 是唯一强偏好信号：accepted/rejected 双路强制、不相交、可回溯三重校验在**写入时**机械保证（multi-candidate.ts:121-136）——学习器收到的每条决策都是合法偏好对，无需再验证 | V1 直接喂更新协议，零清洗成本 |
| F2 | edit_blocks 是高密度风格信号，但两条硬条件：①必须按 source==='author' 过滤（user-edit-step.ts:176,207-209）；②其 payload 内嵌 replacementText＝P0 正文片段已随事件进入 events.jsonl（见 K1）——学习器只许持久化标量特征 | 过滤规则 + P1 存储红线 |
| F3 | FlywheelRecorded 零偏好内容（record-step.ts:126-137 只含 outcome/commitId/recordedCount）：用途是任务窗口闭合标记 + 记账降级旗标（state_degraded 窗口的下游指标不可信），权重 0 | 不进偏好向量，进窗口聚合 |
| F4 | **现有事件词表喂得动 V1 learner——受控增补清单为空**。候选呈现顺序可从同窗口 CandidateCreated 行的账本 position 恢复（ledger.ts:13-14 position 即权威时序；presentCandidates 按序发布 multi-candidate.ts:69-83） | 回答地图票 #46 目标 1 的供给面半题；#50 票只需复核 Tier-2/3 |
| F5 | 特征最小面 = 7 个确定性标量：4 文风 + 2 决策 + 1 场景型占位（V1 恒 null，归因协议归 #48）。全部从账本+瞬时读算出，无 LLM、无重型 NLP | §2 给出直写定义 |
| F6 | P1 落点 .mozhou/preference/（observations.jsonl 追加日志 + profile.json 快照），复用 usage.jsonl 的 append-only+读侧去重 IO 纪律（record-step.ts:159-203）；.mozhou 全区不入 canon hash 基线（manifest.ts:24）⇒ 删目录即重置、不触发对账破裂 | §3 三条隔离铁律 |
| F7 | 更新协议唯一答案：**κ₀ 加权增量均值**（Beta-Binomial 共轭的连续推广；固定 α 时退化为 EMA）。冷启动 κ₀ 伪计数，漂移→κ 减半不清零，硬重置=删 preference 目录。代码注释已预埋「Tier-1 偏好 EMA」措辞（multi-candidate.ts:7），本方案把它落成可测公式 | §4 直写公式 |
| F8 | 规格 §4 的 telemetry JSON 是**未来 P2 导出投影的目标形状**，不是账本物理格式——实际账本是 {seq,event} 任务行 + 平铺领域行双格式（ledger.ts:4-8）。learner 消费实际形状；任何 P2 导出必须按 §2 白名单投影 | 防止实现票误按 §4 解析账本 |

**关键事实 K1（隐私相关）**：UserEditRecorded{action:'edit_blocks'} 的 payload 原样携带操作块数组（user-edit-step.ts:234 blocks: request.blocks），其中 insert/replace 块的 replacementText 是作者正文片段——经 PublishBus 单口写入（eventBus.ts:3「唯一账本 append 入口」）落在 .mozhou/events.jsonl。这是 T17 既有的合法行为（chapter-pipeline-spec.md:27 第 5 行只约定结构化块入账），但意味着：**P0 片段存在于运行时区账本中，P1/P2 边界的执行责任在消费者侧，不在账本侧**。

---

## 1. Q1 信号盘点：哪些事件是偏好信号，噪点与置信度怎么算

### 1.1 词表现状

kernel 词表共 14 事件（domain-events.ts:19-34），其中独立的 candidate_decision **不存在**——它是 UserEditRecorded 的 payload action 之一（multi-candidate.ts:143），票面三分法实际对应两类事件三种 action：

| 信号源 | 事件载体 | 有效形态保证 | 密度预期 |
|---|---|---|---|
| 候选择优 | UserEditRecorded{action:'candidate_decision'} | 写入时强制：双路非空（:121-125）、不相交（:126-129）、全部 id 可回溯本窗口 CandidateCreated 行（:131-136，「凭空决策不是信号」） | 低（ADR-0013 局部触发设计使然） |
| 结构化编辑 | UserEditRecorded{action:'edit_blocks'} | 形状校验宁败不猜（user-edit-step.ts:73-100）；保护位拦截 assistant 通道写保护工件（:207-209） | 高（每次人工改稿必产生） |
| 任务收尾 | FlywheelRecorded | 成败都落账（record-step.ts:105-106），outcome∈{succeeded,state_degraded}（:54-55） | 每会话窗口恰一条 |

### 1.2 各信号的噪点分析与置信度基础

**candidate_decision（权重基准 1.0）**
- 信号本质：作者在 ≥2 个真实替代项间的**强迫选择**，三者中唯一无歧义的偏好陈述。ADR-0013:13-15 明确其为 Tier 1 主信号。
- 噪点：①位置偏差——UI 若乱序展示则账本序≠展示序（推断；账本只能恢复发布序）；②长度混淆——作者可能系统性偏爱更长候选，但这本身就是可学习的长度偏好维度（CandidateCreated.chars 提供依据，multi-candidate.ts:78），不算噪声；③level 语境差异（cursor 点插 vs selection 重写是不同决策场景）——按 level 分桶即可。
- 置信度基础：每条 = 一次有效配对比较；同一特征维度的置信度由 n_eff 驱动（§4 公式），无需逐条打分。

**edit_blocks / source='author'（权重 0.3，推断值留 grilling）**
- 信号本质：作者把 AI 产出改成什么样。replace/insert 的 replacementText 是正向风格样本；delete 是「不要什么」的弱负样本。
- 噪点：①编辑动机混杂——改的不只是风格还有情节事实错误，故权重低于决策信号（推断）；②delete 块不带 replacementText（user-edit-step.ts:90-93 形状禁止），只能贡献「被删区间长度/位置」统计，不能贡献文风特征；③**source='assistant' 必须整体排除**——那是 AI 回写通道不是人类偏好（:172-176 通道语义）。
- 置信度基础：连续特征观测，单条信息量低，靠累积 n_eff；与决策信号不同源不同权，分开记账。

**edit_blocks / source='assistant'：权重 0（排除）。** 保护位只挡 protected 工件（:207-209），非保护的 assistant 编辑照常入账——这些是机器写回，混入会污染风格画像。

**FlywheelRecorded：权重 0（不作偏好输入）。** 但有两个不可替代的副用途：
1. **窗口闭合**：commitId 把同 taskRef 窗口内的决策/编辑观测归组到已提交章节，是「按章聚合」的锚点；
2. **降级旗标**：outcome='state_degraded' 表示 usage 投影写失败（record-step.ts:120-124），该窗口的 Tier-2 类派生指标不完整——learner 在 profile 里记 degradedWindows 数供审计，不消费该窗口的 usage 关联面。

### 1.3 规格 §4 与实际账本的分层关系（F8 展开）

data-flywheel-spec.md:84-104 定义了带 privacy_tier/user_action/edit_distance_ratio 的扁平 JSON。实际账本行只有两种（ledger.ts:21-24）：{seq, event: DomainEvent}（PublishBus 单口，eventBus.ts:80）与平铺领域行。结论：§4 形状是**分析投影/导出层的目标契约**（其字段如 ACCEPTED_WITH_EDITS、survival_verified 在现词表中尚无发射方——如实记录，不做臆测映射），learner V1 直接消费 readPipelineLedger 的 task 行，不新建中间层。

---

## 2. Q2 特征 schema：结构化编辑块的量化特征最小面

CONTEXT.md:68 对 ScenarioStyleProfile 的冻结描述：「quantified, archetype-specific … parameterized by scene type (action, dialogue, romance_emotion, exposition_worldbuilding)」。特征必须能按场景型分桶计算，但**场景归因协议本身归 #48**（ADR-0012 领域），本票只预留 sceneType 可空位。

### 2.1 V1 最小特征面（7 个，全部确定性计算）

| # | 特征 | 来源 | 计算 |
|---|---|---|---|
| f1/f2 | sent_len_mean / sent_len_p90 | insert/replace 块的 replacementText（瞬时读取，不持久化原文） | 按 。！？… 切句取字长均值与 90 分位——prose rhythm 主轴 |
| f3 | dlg_char_ratio | 同上 | 「」“”『』引号内字符数 / 总字符数——对话密度 |
| f4 | para_line_span | 操作块本身（无需读文本） | paragraphEnd − paragraphStart + 1 的分布（insert 取 replacementText 行数）——段长跨度；delete 块也可贡献此特征 |
| f5 | ttr_win500 | replacementText | 500 字滑窗 type-token 比（CJK 单字 + 拉丁词元双重计数取均值）——词汇重复度 |
| f6 | cand_len_delta | candidate_decision × CandidateCreated join | Σchars(accepted)/n_acc − Σchars(rejected)/n_rej，按 level 分桶——长度偏好 |
| f7 | level_mix | 两类 action 共用 | cursor/selection 计数占比（语境校正用，不单独进画像） |

明确**不做**进 V1：动作动词密度、心理/描写占比——需要封闭词表资产，repo 内不存在（grep 全仓无此类词表），引入即超范围；留给后续票沿四场景型扩充。

### 2.2 与 StyleProfile 的关系边界

Author Model（CONTEXT.md:251）= 偏好画像本体；ScenarioStyleProfile（CONTEXT.md:67）= 其文风维度的场景型参数化。本票产出的观测流（f1-f7 带 sceneType:null）是两者共同的原料；「观测→StyleProfile vN 快照」的演化规则归 #48。实现票不得在本票范围内写任何场景分类器。

---

## 3. Q3 P1 隐私边界：存放形态、隔离、导出/删除

### 3.1 落点与形状

.mozhou/ 运行时区现状：events.jsonl / manifest.json / runtime.sqlite / receipts/ snapshots/ indexes/ embeddings/（create-book.test.ts:40-64）、usage.jsonl（record-step.ts:23）、reconciliations/（reconciliation.ts:11）。新增：

~~~
.mozhou/preference/
  observations.jsonl   # 追加日志：每条观测一行（append-only，复刻 usage.jsonl 纪律）
  profile.json         # 当前画像快照：特征均值/n_eff/cursor/漂移状态
~~~

选文件不选 SQLite 的理由：状态量级是个位数 KB；usage.jsonl 已验证同构 IO（append-only 写 record-step.ts:160-165、entryId 先到先得读 :180-203、撕裂行容忍 :187-198）；runtime.sqlite 的投影全是可弃重建面而画像是累积态，混入会破坏「投影皆可重建」的心智模型（推断，但与 Task Projection 词条 CONTEXT.md:203-205 的职责划分一致）。

### 3.2 三条隔离铁律（实现票可直接写成断言）

- **R1 标量红线**：preference 目录内任何字节都不得包含 replacementText、候选原文或其可逆编码；只允许数字标量、计数器、id 前缀。验收 = 对 preference 目录全文扫描断言不含 events.jsonl 中出现过的 ≥8 字符正文子串（测试可执行）。
- **R2 导出二分**：profile.json 属 P1，本地默认、仅用户显式开启多设备同步才离开本机（spec §2 表 data-flywheel-spec.md:14）；未来任何 P2 分享走**独立投影函数**，输出仅限 §2 P2 白名单类字段（布尔/比值/版本号），且永不透传 events.jsonl 的 payload 原文（K1 是这条存在的直接原因）。
- **R3 删除即重置**：.mozhou 全区不入 manifest hash 基线（manifest.ts:24「仅 canon 文件，.mozhou/ 永不入册」），故删除 .mozhou/preference/ 不触发对账破裂，learner 回到冷启动默认值。这就是删除语义的全部——不需要墓碑、不需要软删。

### 3.3 与既有隐私面的接缝

embeddings/ 目录（create-book.test.ts:64）与 ADR-0005:19 把 local embedding 索引同列 P1——preference/ 与之同级同待遇。P0 片段只在计算瞬间被内存读取（f1/f3/f5 的原料 replacementText 已在事件里，无需额外打开正文文件），即算即弃。

---

## 4. Q4 增量更新协议：公式、冷启动、漂移与重置

### 4.1 更新公式（唯一答案）

对每个特征维度 d 维护 (S_d, W_d, M_d)（加权和/权重和/短窗 EMA），新观测 (x, w)：

~~~
S_d += w·x          W_d += w
mean_d = (κ0·m0_d + S_d) / (κ0 + W_d)      # 后验均值，n_eff = κ0 + W_d
M_d ← (1−α)·M_d + α·x                      # α=0.15 固定，漂移检测专用
~~~

这是 **κ₀ 加权增量均值**：κ₀→0 且逐条衰减权重时是纯加权平均；W 取固定窗时是 EMA（代码注释 multi-candidate.ts:7 预埋的「Tier-1 偏好 EMA」即此特例）；二元维度上就是 Beta-Binomial 后验均值的连续推广。一张公式覆盖票面给的三个选项，每个量都可单测。

### 4.2 权重表 w（写入实现票）

| 观测类型 | w | 依据 |
|---|---|---|
| candidate_decision | 1.0 | 强迫选择，写入时已机械保真（F1） |
| edit_blocks author insert/replace | 0.3（推断） | 正向风格样本但动机混杂 |
| edit_blocks author delete | 0.15（推断） | 仅贡献 f4 位置统计的弱负样本 |
| edit_blocks assistant | 0 | 机器回写非人偏好（§1.2） |
| FlywheelRecorded | 0 | 窗口锚点非偏好（F3） |

### 4.3 冷启动、漂移、重置

- **冷启动**：κ₀=8、m₀ 取中性常数（sent_len_mean=42、dlg_char_ratio=0.30、ttr_win500=0.55 等，推断值，grilling 定案）。kernel 无 archetype/genre 字段（grep kernel 为空），V1 **不做**按题材初始化——等 book 元数据出现后再作为 m₀ 查表升级，不阻塞 V1。
- **漂移**：|M_d − mean_d| > 2σ_d 且连续 ≥10 条 → 该维度 κ_eff 减半（置信衰减保留历史和），记入 profile.driftLog。**不做硬重置**：风格自然演化应被缓慢跟随，清空等于丢掉已积累的数据资产。
- **手动重置**：删 .mozhou/preference/（R3），UI 语义即「清除我的画像」。
- **幂等消费**：observation 行携带 sourcePosition（readPipelineLedger 的 position，ledger.ts:13-14 权威时序），profile 存 cursor:lastPosition；重启续读、重放去重——对齐 Task Projection「行对齐账本序号」先例（CONTEXT.md:204）。全量重建 rebuildPreference(bookRoot) 必须幂等，验收指纹用**排序后的内容集合哈希**而非物理行序（交错写入与重扫描行序不同，物理行序指纹假红是已知陷阱）。

---

## 5. 推荐设计（实现票可直写）

1. **模块落点**：packages/pipeline/src/preference-learner.ts——复用同包 readPipelineLedger 读缝与 record-step 的 JSONL IO 纪律（pipeline 已依赖 kernel/runtime 所需类型；跨包放置有依赖方向风险——推断，落地时以 import 图复核）。
2. **导出面（纯函数优先）**：
   - extractObservations(rows): PreferenceObservation[]——source 过滤 + 防御性重验 F1 三条件 + 特征计算；
   - reduce(profile, obs): PreferenceProfile——§4.1 公式；
   - runPreferenceLearning(bookRoot)——cursor 续读 + reduce + 双文件落盘；
   - rebuildPreference(bookRoot)——全量重建（幂等，排序内容集指纹验收）。
3. **存储形状**：observation = {obsId, sourcePosition, kind, level?, sceneType:null, features:{f1..f7}, w, at?}；profile = {version:1, dims:{[d]:{S,W,M,sigma2}}, kappaEff, cursor, driftLog[], degradedWindows}。
4. **受控增补清单：空**（F4）。不改 domain-events.ts、不加事件、不改既有 payload——纯新增消费端模块。
5. **验收判据**：①R1 标量红线扫描通过；②同一账本跑两遍 profile.json 字节级一致；③删 preference/ 后 rebuild 结果与增量结果内容集等值；④assistant/delete 观测权重隔离单测；⑤state_degraded 窗口计入 degradedWindows 且不污染 dims。
6. **明确不在本票**：场景分类器与 StyleProfile vN 协议（#48）、TaskModelEvaluator 消费面（#49）、EventLedger 供给面复核（#50）、P2 导出投影（现无消费方，后置）。

## 6. 开放问题（留 grilling）

1. κ₀=8 与权重 0.3/0.15 为推断默认值，需拍板；
2. m₀ 中性常数表数值，或改为「前 N 条只积累不出画像」延迟启动；
3. UI 若乱序展示候选是否值得未来增补 displayOrder 字段（本票判：不需要，V1 以账本发布序近似）。

## 7. 证据索引

代码：packages/kernel/src/domain-events.ts:19-34,38-44 · packages/pipeline/src/multi-candidate.ts:6-8,69-83,101-107,121-136,138-148 · user-edit-step.ts:36,59-71,73-100,172-176,203-209,226-238 · record-step.ts:23,54-55,120-124,126-137,159-165,180-203 · ledger.ts:4-14,21-24,31-75 · packages/runtime/src/eventBus.ts:3,80 · packages/data-plane/src/manifest.ts:24 · packages/data-plane/src/layout.ts:8,11 · packages/data-plane/test/create-book.test.ts:40-64
规格：docs/specs/data-flywheel-spec.md:11-16(§2),20-49(§3),51-58(§3.1),82-104(§4) · docs/specs/chapter-pipeline-spec.md:27,32,48-51 · CONTEXT.md:67-69,203-205,247-249,251-253,259-261,263-265
ADR：docs/adr/0005-policy-flywheel-and-privacy-tiering.md:14-30 · docs/adr/0013-generation-concurrency-and-preference-sampling.md:9-20
