---
date: 2026-08-24
description: "#51 Grill 终裁——学习器本体协议 A1-A4/B1-B6 定案值与理由（Wayfinder 拍板记录）"
tags: [mozhou]
---

# T51 · Wayfinder Grill 终裁：学习器本体协议（偏好推理面 + 风格演化）

> 裁决对象：xiaohai-uid/mozhou#51（地图 #46 · Phase 4 数据飞轮）。
> 研究基线：[t47-a](./t47-a-author-preference-learner.md)（A 组依据）· [t48-b](./t48-b-style-learner.md)（B 组依据）。
> 不可推翻锚：ADR-0012 四场景型独立分面 + EMA α=0.05（docs/adr/0012:9-22）；Q13 判别键（kernel-schema-decisions.md:85）与 I1 语义（kernel-schema.ts:76-82）。
> 纪律：研究建议为基线，仅在推翻/补全处展开证据；每项给实现票可直写的唯一答案；决不了的进 §4 DEFER，不和稀泥。

## 0. 裁决总览

| 项 | 终裁 | 一句话定案 |
|---|---|---|
| A1 | 批准 | κ₀=8 + 权重表照抄；退火=1/(κ₀+W) 隐式衰减，无日程表 |
| A2 | 批准+补全 | 否决延迟启动；七维 m₀ 常数表全量定案；快照延迟物化 |
| A3 | 否决增补 | displayOrder 不入 payload；账本发布序即呈现序 |
| A4 | 批准冻结 | f1-f7 逐字冻结；词表依赖型特征显式出界 |
| B1 | 批准豁免案 | 受控豁免（唯一写者+强制审计）走 Contract Delta；否决去保护位 |
| B2 | 批准复用 Port | ProposalPort 第三后端；永挂待决、无静默生效 |
| B3 | 政策定案/数值 DEFER | 冻结常量+台架回填两票节奏批准；阈值数值缓议 |
| B4 | 批准全注入 | 四场景型 ×4 section；否决 top-2；≤800 token 断言 |
| B5 | 批准入词表 | 非成对收尾事件；payload 顶层化修正一处 |
| B6 | 批准 | 四常数照案；Δmax 激活域澄清（regime 保险丝） |

## 1. A 组终裁（AuthorPreferenceLearner，t47 §4/§6）

### A1 · κ₀ 与权重、退火策略 ——【终裁】批准研究建议

**理由**：multi-candidate.ts:6-8 已预埋「喂 Tier-1 偏好 EMA」措辞，κ₀ 加权增量均值正是该注释的可测落地（t47 §4.1 一式覆盖三选项）；candidate_decision 的 1.0 权重名副其实——双路非空/不相交/可回溯三重校验在写入时机械保证（multi-candidate.ts:121-136），学习器零清洗成本（F1）。显式退火日程表属投机配置：1/(κ₀+W_d) 随数据单调递减，本身就是退火；漂移响应 κ_eff←κ_eff/2 渐近不达零，「保留历史和、不清零」（t47 §4.3）由数学结构保证，无需另设 floor。

**定案值（实现票直写）**：
- κ₀=8（各维独立）；w 表：candidate_decision=1.0 ／ edit_blocks author insert\|replace=0.3 ／ author delete=0.15 ／ assistant=0 ／ FlywheelRecorded=0。
- 主画像均值 mean_d=(κ_eff·m₀_d+S_d)/(κ_eff+W_d)，n_eff=κ_eff+W_d；**主均值不是 EMA**。
- M_d←(1−0.15)·M_d+0.15·x 仅作漂移检测短窗，禁止被下游当画像消费。
- 漂移判定：\|M_d−mean_d\|>2σ_d 且连续 ≥10 条观测 ⇒ 该维 κ_eff←κ_eff/2（每合格批至多一次；单调不回升，仅删除 .mozhou/preference/ 手动重置回 κ₀）。
- σ_d 用加权增量方差（West/Welford 递推）；该维累计观测 <5 时跳过漂移判定（σ 无意义）。

### A2 · m₀ 中性常数表 vs 延迟启动 ——【终裁】批准常数表路线，否决延迟启动；七维数值全量定案

**理由**：κ₀ 加权均值的全部意义就是先验影响随 W 自动衰减（W≈40 后先验占比 <17%），m₀ 出错的代价有界且自愈；延迟启动会在冷启动语义上开第二条路径——edit_blocks 高频流下「首个决策」的触发点定义模糊，且多一套空态分支，违背最简实现。V1 不按题材初始化维持不变（kernel 无 archetype/genre 字段，t47 §4.3）。

**定案值（m₀ 表，来源列注明谁拍的）**：

| 维度 | m₀ | 来源 |
|---|---|---|
| sent_len_mean | 42 | t47 §4.3 原值 |
| sent_len_p90 | 65 | **grill 新钉**（≈1.55×mean，中文网文右偏分布的中性估计） |
| dlg_char_ratio | 0.30 | t47 §4.3 原值 |
| para_line_span | 2.0（行） | **grill 新钉**（网文短段落中性值） |
| ttr_win500 | 0.55 | t47 §4.3 原值 |
| cand_len_delta | 0 | **grill 新钉**（中性=无长度偏好） |
| level_mix（cursor 占比） | 0.5 | **grill 新钉**（中性） |

**物化纪律**：m₀ 只存在于 learner 模块常量；profile.json 在首批观测 reduce 之后才创建——下游永远读不到「纯先验快照」。此条吸收延迟启动方案的合理内核（不输出未学习状态），又不引入第二套冷启动语义。

### A3 · displayOrder 是否增补 payload ——【终裁】否决增补，确认研究判断

**理由**：呈现意图可从账本恢复——presentCandidates 按 options 迭代发布（multi-candidate.ts:69-83），行序即权威时序（ledger.ts:12-14 明文）；API 契约已保序（PresentedCandidate[] 按入参序返回，multi-candidate.ts:81），乱序展示属 UI 实现 bug 而非信号缺口。payload 增补动的是共享事件契约面：受控增补清单当前为空（F4），为假想风险开洞违背「契约默认冻结」（repo AGENTS.md UVSD §3.10-11）。

**定案**：learner 以同窗口 CandidateCreated 的账本 position 升序为呈现序；observation 记 sourcePosition 对齐该序。未来 UI 若引入真重排（如候选拖拽排序），届时走 Contract Delta 另议，本票不留字段。

### A4 · 特征最小面 7 标量冻结 ——【终裁】批准冻结

**理由**：f1-f7 全部确定性可算（replacementText 瞬时读取 + CandidateCreated.chars join，无 LLM、无重型 NLP，F5）；动作动词密度/心理描写占比需封闭词表资产，全仓不存在（t47 §2.1 grep 证据），引入即超范围。sceneType:null 占位与归属划分一致——场景归因协议归 #48（t47 §2.2），CONTEXT.md:67-69 的「parameterized by scene type」由 #48 兑现。

**定案**：f1-f7 按 t47 §2.1 表逐字冻结（含 TTR 双重计数取均、delete 块仅贡献 f4 行跨度统计、f6 按 level 分桶）。显式出界：动作动词密度、心理/描写占比、一切需词表资产的量、一切 LLM 参与的特征计算。伴生验收 = R1 标量红线扫描（preference 目录全文不含 events.jsonl 中 ≥8 字符正文子串，t47 §3.2）。

## 2. B 组终裁（StyleLearner，t48 §3/§4/§6/§8）

### B1 · I1 矛盾：受控豁免 vs 改种子质子 flag ——【终裁】批准受控豁免案，否决去保护位

**理由**：①规格层命令自动精修：data-flywheel-spec.md:56 "Continuously refines StyleProfile vN based on edit deltas"，且建书种子在同文件里同时宣告 protected:true（create-book.ts:91）与「EMA 平滑结果算完即落盘」（create-book.ts:142）——种子自身要求两者并存，证明 I1 的立法本意是挡生成管线改写作者宪法文件，不是禁飞轮自维护（采纳 t48 §1.2 推断）。②改 protected:false 是向所有自动化通道全面投降：中央守卫 assertAutomationReadOnly（protection.ts:52-63）从此对文风.md 永久失明，未来任何管线误写都无闸门；受控豁免把例外收窄到一个具名写者。③kernel-schema.ts:335 明示「EMA 平滑簿记归 flywheel 层」——flywheel 层写、kernel 存结果是既定分工。④作者权威无损：手改走 EXTERNAL_MODIFIED 对账（chapter.ts:16、local-data-plane.ts:4 检测面已在），learner 每批前重读盘上现值作 old 基线（t48 §4-C）。

**定案（Contract Delta 必写条款，UVSD rule 11 同步 schema/文档/实现/测试）**：
1. 豁免主体唯一：StyleProfileStore（flywheel 维护通道）是唯一合法自动化写者；authorIntent 不享豁免（create-book.ts:75 「宪法层整体受保护」自此分裂为两档，Delta 里明说）。
2. 豁免以写缝收口实现：data-plane 新增 writeStyleProfiles(bookRoot, profiles) 单口（原子替换 + revision+1 + refreshManifestEntries，沿 user-edit-step.ts:213-224 先例）；规范条款「除 writeStyleProfiles 外任何自动化代码禁止写 STYLE_PROFILE_PATH」，以回归测试固化（旁路写入 ⇒ ProtectedContentViolationError）。
3. 强制审计：每次写盘必须同事务发布 StyleProfileUpdated（B5）；无事件写入视同 I1 违例——审计替代禁令。
4. 作者手改永远赢（EXTERNAL_MODIFIED 五态，local-data-plane.test.ts:131-144 先例）。
5. 文风.md body 升级为 fenced-YAML profiles map（t48 §6-A），建书种子同步替换占位文本。

### B2 · sensoryDensity/actionPacing 旁路确认面 ——【终裁】批准复用 ProposalPort（第三后端）；否决独立 review 面

**理由**：ProposalPort 已是统一确认面黑盒——「一个 Port，两个调用方」，confirm/reject/editAccept 逐条粒度、待决跨重启持久（proposal-port.ts:1-28）；LLM 风格建议与 canon 提案/对账提案是同构决策问题（人裁决机器建议），再造第二套 review 面属平行机制重复。S5 边界直接移植：LLM 结论只是旁路建议、不入 Gate（chapter-pipeline-spec.md:54-56）。

**定案（确认面契约）**：
- 载体：ProposalPortRef 增第三判别位 {port:'style'}（proposal-port.ts:40-42 联合扩展，走 Contract Delta）。
- 何时弹：第 10 步批处理时生成为 pending 条目（S8 纪律：跨重启保持待决）；UI 在窗口闭合后拉取呈现；不阻断正文管线（降级先例 record-step.ts:120-124）。
- 可否静默：**无超时自动生效、无静默批量接受**——未决建议永挂 pending，对应分面保持种子空值（宁缺毋滥，t48 §3 诚实降级）；作者可在设置关闭旁路建议的生成以省 LLM 成本，但已生成的建议仍须逐条决毕。
- 粒度：（scenarioType, facet）逐条；editAccept 修正值即时入档并流入 B3 校准数据面。
- 审计分工：Port 决策本身不发事件（proposal-port.ts:21-23 纪律不变）；分面实际变更审计由 B5 事件承担。

### B3 · 分类器校准节奏 ——【终裁】政策面定案；阈值数值 DEFER（见 §4-1）

**政策定案（可直写）**：
- V1 分类器 = 机械启发式（引号密度→dialogue 等）+ 低置信度整批跳过（t48 §3）；**未命中任一触发器的块跳过，绝不落默认桶**——交叉污染是 ADR-0012 Context 段点名的首要危害（docs/adr/0012:5）。
- 词表与阈值为模块内冻结常量，**不做运行时在线自举/自训练**：避免自证循环（与「保留不动不计观测」同理，t48 §3）与投机配置。
- 校准数据面 = ProposalPort 决策流（B2 的 editAccept 修正 = 带标签样本）+ classifierSkipLog（与 driftLog 同级入 profile）；台架校准票按里程碑离线跑，结论以常量回填 PR 落地——**两票节奏批准**（回答 t48 §8-3：是）。
- bge-small-zh 二阶段升级路径保留（packages/context-compiler/assets/models/bge-small-zh-v1.5/ 在库），V1 不依赖。

### B4 · 注入范围：四场景型全注入 vs top-2 ——【终裁】批准全注入；否决 top-2

**理由**：①预算充裕：4 section 估算 ≤800 token << structuralCapTokens 默认 4096（assemble.ts:117,128），省 token 收益趋零；②top-2 需要「本章属哪两个场景型」的运行期预测器——恰是 B3 里最不可靠的组件，把它插进注入路径等于把分类误差放大成上下文系统性缺失，是 ADR-0012 反交叉污染初衷的漏洞版；③全注入保持确定性：Receipt 按 identifier diff 可定位单一场景型的画像变更（StructuralSection 契约 assemble.ts:84-89），top-2 的动态选择集会让 replayInputs 依赖预测器状态，伤可复算性。CONTEXT.md:69 avoid「prompt prefix」不妨碍量化结果经 structural 通道注入——该通道定义原文即含风格段（compile.ts:116-117、kernel-schema.ts:362-364）。

**定案**：renderStyleSections(profiles) 恒输出 4 条，identifier=`style_profile:<scenarioType>`，content 为分面的人读指令渲染；渲染器自带总量断言 ≤800 token（chars/1.7 近似估算即可），超限抛错不静默截断（宁败不猜——超限说明画像膨胀是 bug）；编排方 Prepare 后读文风.md → 渲染 → 填 RunCompileRequest.structuralSections（compile-step.ts:48,118 缝已预留）。

### B5 · StyleProfileUpdated 入词表 ——【终裁】批准；payload 草案一处修正

**理由**：画像更新今天在账面上不可审计（domain-events.ts:19-34 十四词条无任何风格事件，t48 §1.3）——它是 B1 豁免的审计支柱、回滚契约的重放底座（t48 §4-C）。增补通道合规：词表真源自 kernel、修订纪律有先例（T16 #40 增 CandidateDeltaExtracted，domain-events.ts:11-13 头注）。非成对定性正确：FlywheelRecorded 先例成败都落账、不入 EVENT_PAIRS（record-step.ts:126-137 对照 domain-events.ts:47-51）。

**修正**：taskRef/chapterIndex 是 DomainEvent 顶层字段（domain-events.ts:38-44），t48 §4-C 草案把它们装进 payload 属冗余，剥出。定案形状：

```
type: 'StyleProfileUpdated'
taskRef: string（顶层，窗口 ULID）· chapterIndex?: number（顶层，可空 = 全书级批次）
payload: {
  afterByScenarioType,        // 四 ScenarioType → 分面 after 全量
  beforeDigest: string,       // sha256(canonicalJson(before))；before 不内联（账本瘦身）
  sampleCount: number,        // 本批有效编辑块数
  alphaUsed: number,          // 0.05 | 0.2
  regimeChange?: boolean,     // payload 位，不加词条（t48 §6-F 照案）
  rolledBackTo?: number       // 回滚锚批次
}
```

DOMAIN_EVENT_TYPES 尾部追加一条；EVENT_PAIRS 不动。移交 #49 汇总入受控增补清单。

### B6 · α / Δmax / Nmin / taboo 数值定案 ——【终裁】批准；附 Δmax 激活域澄清

**理由**：α=0.05 是 ADR-0012 Decision 3 明文（docs/adr/0012:21-22），约束面内无裁量空间；Nmin=10 与「无输入即无漂移」自洽（t48 §4-A），编辑稀疏章画像冻结是特性不是缺陷；taboo 走集合语义不走 EMA 正确，(词,章) 去重、容量 50 同时是 B4 预算的守护项。

**Δmax 澄清（grilling 发现，实现票须知）**：常规 α=0.05 下标量分面单批位移上界 = α×值域 = 0.05 < 0.1，钳制恒不激活；其真实作用域是 regimeChange 快速跟随期（α_boost=0.2 > 0.1）的单批过冲保险丝。这是设计意图不是冗余——快速跟随时才需要闸。分布分面逐桶 EMA 重归一化后同样受钳制（t48 §3）。

**定案值**：α=0.05；α_boost=0.20（仅 regimeChange 批次起用）；Δmax=0.10（钳制后重归一化使 Σshare≈1，kernel-schema.ts:331 契约）；Nmin=10（本场景型有效编辑块数，不足则本批不更新）；taboo 转正 = 跨 ≥2 章 且 ≥3 次命中、表长 ≤50。EMA 半衰期参考 ln0.5/ln0.95≈13.5 批、有效记忆 ≈20 批（t48 §2 数学推导，漂移感知窗口据此设 ≥20 批）。

## 3. 实现票直写常数总表

| 常数 | 值 | 出处 |
|---|---|---|
| κ₀ | 8 | A1（t47 原值批准） |
| w 表 | 1.0 / 0.3 / 0.15 / 0 / 0 | A1 |
| 漂移检测 α | 0.15 | A1 |
| 漂移触发 | \|M−mean\|>2σ 连续 ≥10 条 → κ_eff 减半 | A1 |
| σ 估计 | 加权增量方差；<5 条跳过判定 | A1（grill 补钉） |
| m₀ 七维 | 42 / 65 / 0.30 / 2.0 / 0.55 / 0 / 0.5 | A2（65、2.0、0、0.5 为 grill 新钉） |
| 风格 EMA α / boost | 0.05 / 0.20 | B6（ADR-0012 / t48） |
| Δmax / Nmin | 0.10 / 10 | B6 |
| taboo | ≥2 章 ≥3 次，容量 50 | B6 |
| 注入 | 4 sections，≤800 token 断言，cap 4096 | B4 |
| 事件 | StyleProfileUpdated，非成对，payload 见 B5 | B5 |

移交边界（沿 t48 §7）：#49 收 StyleProfileUpdated 形状 + editCount 口径 Σ\|blocks\|/窗；#47/#48 共用同一个 edit_blocks Observation 提取器，禁止两套解析。

## 4. DEFER 清单

1. **分类器置信阈值数值 + 触发词表初值（B3）**——阻塞面：分类器尚未实现、repo 内无标注语料，现在拍任何数字都是虚构；出路：台架校准票离线实测后以常量回填 PR 落地。政策面（跳过不落默认桶、冻结常量、两票节奏）已全部定案，本项不阻塞 B 组其余实现。
2. **regime 切换常数 R_high（近 5 章编辑块总量阈值）与 K（连续同向批数）（B6 附带）**——阻塞面同上（无实测数据）；同一台架票回填。α_boost=0.20 已定；R_high/K 未定期间 regimeChange 恒 false、α_boost 不激活，不影响其余机制上线。
3. 其余决议项（A1-A4、B1、B2、B4、B5、B6 数值）全部给出唯一答案，无保留。
