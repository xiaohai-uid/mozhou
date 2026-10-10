# 墨舟 (MoZhou Novel OS) 架构设计与长篇生产线全景评审专资
> **文档版本**: 2026-09-02 · v2.0 Architecture Deepening  
> **工程基准**: Monorepo (`C:\zcode\novel-ai`), GitNexus 知识图谱 7,653 节点 / 16,604 依赖边，0 循环依赖  
> **目标读者**: 外部 AI 架构师 / 资深系统架构师评审通道  

---

## 1. 架构定位与核心设计哲学 (System Overview & Philosophy)

墨舟（MoZhou Novel OS）是一个**面向百万字长篇网文的本地优先（Local-First）创作操作系统与连续性工程流水线**。

长篇小说（100万~500万字）在 AI 介入时面临的本质困境不是“单次生成的文笔不够好”，而是**时间推移下的全局连续性坍塌（Context Entropy & World Collapse）**：
* 角色认知超前（全知视角泄漏，主角提前知晓隐秘）；
* 因果债务遗忘（前文借贷的因果、发下的誓言、重伤状态在几十万字后凭空消失）；
* 战力与境界漂移；
* AI 机械腔调与死板套话的同质化积累；
* 百万字上下文暴力灌入导致的“注意力模糊与时间序错乱”。

### 墨舟的五大反直觉架构铁律（Constitutional Invariants）：
1. **每一章开始前精确取上下文，每一章通过审查后再原子写回“正史”**：严禁无序自由生成与模糊黑盒循环。
2. **双平面数据面（Dual-Plane Sync）**：
   * **真理平面（Truth Plane）**：Git-friendly 的纯文本（Markdown + 严格 YAML Frontmatter + JSONL 账本），人读可审查、可版本管理、无平台锁定；
   * **查询平面（Projection Plane）**：端侧 SQLite（`runtime.sqlite`），纯确定性无损投影，损坏或版本漂移时可 100% 纯内存扫描正史重造（Full-Absorption Rebuild），不依赖外部迁移。
3. **确定性 0-Token 守卫与概率模型解耦**：
   * 11 项机械门禁（引号匹配、4-gram 方差、禁语红线、字数窗口）与时间线单调性由纯算术/正则代码执行，耗时 <5ms，消耗 0 Token；
   * 概率性大模型（LLM）仅负责“给定场景契约下的文本延展”与“高阶叙事建议”，永不给予大模型直接篡改正史的权力。
4. **认知隔离（Epistemic Levels & Zero-Leakage POV）**：
   * 事实分层管理：读者已知（reader）、主角已知（protagonist）、配角特定认知；
   * 秘密进入 `secret.*` 谓词，未授权视角的上下文装配与“秘密不存在”在语义上逐字段不可区分。
5. **拒绝伪解决方案**：
   * 拒绝 AutoGen / CrewAI 等多 Agent 虚拟辩论（耗费大量 Token 却无法保证状态一致）；
   * 拒绝在本地核显/弱 GPU 上跑 70B 大模型正文（正文直连 DeepSeek / OpenAI 等成熟端点；本地只跑 BGE-small ONNX CPU 量化嵌入与正则分析）；
   * 拒绝一上来把几百万字正文切片灌入向量数据库（向量检索极易召回“语义相似但时间线已过时”的错误状态）。

---

## 2. 现有单体仓库架构与模块职责 (Monorepo Breakdown)

墨舟采用 pnpm workspace 组织的 TypeScript 严格类型单体工程（Monorepo），完全解耦无循环依赖：

```
C:\zcode\novel-ai\
├── packages/
│   ├── kernel/            # 领域核心 Schema 与只读类型（九柱实体、品牌化 ULID、时空事实）
│   ├── data-plane/        # 双平面同步引擎、SQLite 投影、章节生命周期、Reconciliation
│   ├── context-compiler/  # 2 阶段预留预算上下文装配器、三通道召回、ContextReceipt 凭证
│   ├── quality-engine/    # 11 项机械门禁、Sepia 叙事评分、style-metrics、失败记忆
│   ├── pipeline/          # 10 步事务流水线状态机、executeChapterReview 统摄调度、ProposalPort
│   ├── runtime/           # 技能注册表、能力处方（Recipe）、发布总线（PublishBus）
│   ├── flywheel/          # 风格学习器、写作特征提取、离线质量评定
│   └── benchmark/         # L1/L2 确定性台架、回归测试套件
└── apps/
    └── web/               # 桌面端 + 移动端自适应商业化全景工作台、Connect API 中间件
```

### 各核心子系统深度剖析：

### 2.1 `@mozhou/kernel`（冻结领域九柱）
* **`TemporalFact`**：时空事实原子行，具备显式章节有效区间 `[valid_from, valid_until]`，四态生命周期（`planned` → `candidate` → `confirmed` / `rejected`）。
* **`KnowledgeState`**：认知状态行，定义特定持有者在特定章节对某事实的掌握层级（`knows` / `suspects` / `believes` / `ignorant`）。引用 `rejected` 事实自动级联失效。
* **`NarrativePromise`**：叙事承诺与伏笔追踪，严格六态（`introduced` → `reinforced` → `due` → `paid_off` → `abandoned` → `overdue`）。
* **`RelationshipState`**：人物/势力动态关系演变。
* **`TimelineEvent`**：不可变时空事件，严格受递增序数与时间线单调性制约。
* **`Scene`**：章下挂接的原子写作单元，承载 POV、beats、summary 与退出状态。
* **`ChapterCommit`**：单章原子提交记录，绑定正文 Hash、提取的五族 Delta 与依赖清单。
* **`ContextReceipt`**：物理落盘的上下文凭据，每次生成前由服务端确定性装配产出，具备唯一 `inputsDigest`，用于无损时间旅行与重放。

### 2.2 `@mozhou/pipeline`（10 步事务管线）
单章生产生命周期严格由 `ChapterProductionSession` 状态机驱动，每步流转记录至 Event Ledger：
```
1. prepare        -> 内存查询作者意图、大纲节点、活跃伏笔、角色认知
2. compile        -> 生成 ContextReceipt 凭证，两阶段配额装配 ContextPacket
3. draft          -> 流式生成 phase=draft 正文，支持断流 partial 半稿恢复
4. review         -> executeChapterReview 统摄机检、语义审查、金句收割与反例库沉淀
5. user_edit      -> 结构化作者编辑捕获（段落替换/追加，保护位检验）
6. final_extract  -> 提取五族候选 Delta（事实、关系、认知、伏笔、时间线）
7. continuity_gate-> 纯机械硬冲突检测（时间线单调、POV秘密零泄漏、引用完整性）
8. canon_proposal -> 风险三档分流（Low 自动合流，Medium 队列，High 强制确认）
9. commit         -> 相位由 draft 翻转为 committed，原子写回真理平面文件并刷新基线
10. flywheel_record-> 任务收尾、用量统计、风格飞轮学习器触发
```

### 2.3 `@mozhou/data-plane`（双平面与门面深模块）
* **`LocalDataPlane`**：对盘与投影的唯一权威入口，封装 `open(root)`、`queryStoryBrain()`、`getWorksOverview()`、`getChangeMatrix()`、`commitChapter()` 与 `verifyBaseline()`；
* **外部冲突和解（ReconciliationService）**：作者在 Obsidian、VS Code 等第三方编辑器随意改动草稿时，启动时通过 Hash 比较区分草稿自由编辑与正史越权修改，引导进入 ProposalPort 确认。

### 2.4 `@mozhou/quality-engine`（文学审查与文风评分）
* **11 项纯算术机械门禁**：字数窗口检验、未清理占位符（TODO/XXX）拦截、中英文多层引号闭合对称、相邻段落 5-gram 复读、单章 4-gram 词频方差（同一 4 字短语 >= 6 次拦截）；
* **Sepia (StoryScope) 3 轮 AI 腔调诊断**：Pass 1 叙事架构（禁止直接说教）、Pass 2 语篇流动（段末设问偏高检测）、Pass 3 表层套话（典型 AI 句式扣分）；
* **`style-metrics.ts`**：提取对白占比、平均句长、感官描写密度、动作节奏比率。

---

## 3. 外部咨询建议 vs 墨舟现状对照矩阵

| 咨询方建议核心论点 | 墨舟现有实现状况 | 达成共识度 | 当前工程判定与处置 |
|---|---|:---:|---|
| **反对一键全自动，坚持结构化状态驱动** | 墨舟坚持 10 步事务管线与作者主权，每步均有账本与凭据 | **100%** | 完全一致，坚决贯彻。 |
| **中间数据强制 Zod / 强类型结构化** | `@mozhou/kernel` 与 `@mozhou/pipeline` 纯 TS 严格品牌化类型与模式守卫 | **100%** | 已落地，可进一步补充前置 Zod 解析守卫。 |
| **全文检索优先于向量库（SQLite FTS5 优先）** | 墨舟采用确定性事实 + 2-hop 图谱拓扑 + BGE-small (ONNX CPU) 三通道混合 | **95%** | 认可建议。墨舟未采用重型向量库，现有一阶段完全满足；后续可在 SQLite 投影内开启 FTS5 虚拟表。 |
| **引入 Promptfoo 进行提示词与设定回归** | 墨舟现有 `packages/benchmark` 仅包含确定性 L1 台架与质量回归，缺乏专门的 Promptfoo 套件 | **差异点** | **采纳为 P0 演进项**：建立专门的小说设定不崩 Promptfoo 规则包。 |
| **暂缓引入 LangGraph / Langfuse** | 墨舟自建 Event Ledger、ContextReceipt、Time-travel 恢复机制与任务状态机 | **100%** | 完全认同。自研管线仅千行代码且完全掌控，不平白引入重量级第三方框架。 |
| **按场景卡（SceneCard）分段生成正文** | 墨舟底层具备 `Scene` 实体与 beats 属性，但前端交互目前多以章为大单元推进 | **差异点** | **采纳为 P0 演进项**：在工作台交互层将章拆分为 3~4 个场景卡，并强化退出状态确认。 |
| **提炼明确的因果合约（Causal Contract）** | 墨舟目前使用 `NarrativePromise` 与 `TemporalFact` 组合表达伏笔与约束 | **差异点** | **采纳为 P1 演进项**：将因果债务抽象为独立的数据结构与门禁规则。 |
| **禁止在本地 Intel 集显机器上硬跑大模型** | 墨舟生成直连远端高智商模型（DeepSeek/OpenAI），本地仅执行确定性规则 | **100%** | 完全一致，绝不把本地算力浪费在低质生成上。 |

---

## 4. 拟引入的 3 大关键架构增量设计草案

### 4.1 增量一：小说“设定防崩” Promptfoo 回归测试套件 (P0)

* **目标**：在 CI 或本地一键执行提示词与模型的回归评测，确保任何 Prompt 或模型微调不会引发“战力崩塌”、“死者复生”、“秘密泄露”。
* **配置草案 (`packages/benchmark/promptfoo/promptfooconfig.yaml`)**：
```yaml
description: "墨舟长篇网文角色与因果连续性防崩评测"
prompts:
  - "file://packages/context-compiler/prompts/chapter_draft.json"
providers:
  - id: "deepseek:deepseek-chat"
  - id: "openai:gpt-4o"
tests:
  - description: "主角严禁提前知悉核心机密（认知零泄漏断言）"
    vars:
      pov: "protagonist"
      chapterIndex: 3
      sceneGoal: "深夜审讯俘虏"
    assert:
      - type: not-contains
        value: "真神降临仪式"
      - type: javascript
        value: "!output.includes('假神法印真相')"

  - description: "死亡角色不可无故复活对话"
    vars:
      deadCharacters: ["char:wang_lin"]
    assert:
      - type: javascript
        value: "!output.match(/王林(?:推门|冷笑|说道|拔剑)/)"

  - description: "文学质感红线机检（无总结体套话）"
    assert:
      - type: not-regex
        value: "(?:他终于明白|这一夜注定无人入眠|深吸了一口气)"
```

### 4.2 增量二：场景卡与显式“退出状态（Scene Exit State）” (P0)

* **概念定义**：一章由 3~5 个 `Scene` 组成。每个 Scene 生成后，必须由模型或作者提取并确认其 **`SceneExitState`**，作为下一场景的编译强依赖。
* **数据契约草案**：
```typescript
export interface SceneExitState {
  readonly sceneId: SceneId;
  readonly physicalDamage: readonly { readonly entity: EntityRef; readonly description: string }[];
  readonly knowledgeGained: readonly { readonly holder: EntityRef; readonly factRef: string }[];
  readonly resourcesChanged: readonly { readonly entity: EntityRef; readonly delta: string }[];
  readonly relationalShift: readonly { readonly from: EntityRef; readonly to: EntityRef; readonly newStatus: string }[];
  readonly openSuspense: string; // 留给下一场景或章末的未决钩子
}
```

### 4.3 增量三：因果合约（Causal Contract）专属门禁 (P1)

* **概念定义**：玄幻/修仙/悬疑长篇中极其普遍的“天道誓言”、“借贷契约”、“因果借法”，必须具备硬时间窗口与惩罚机制。
* **数据契约草案**：
```typescript
export interface CausalContract {
  readonly contractId: string;
  readonly creditor: EntityRef;       // 债权方（天道/古神/主角）
  readonly debtor: EntityRef;         // 债务方
  readonly consideration: string;     // 标的物 / 获取的能力
  readonly dueChapter: number;        // 到期章节
  readonly priceToPay: string;        // 必须支付的代价
  readonly breachPenalty: string;     // 违约天谴 / 惩罚
  readonly status: 'active' | 'fulfilled' | 'breached' | 'waived';
}
```
* **门禁行为**：`ContinuityGate` 在到达 `dueChapter` 时，检查债务方是否支付代价。若未履行且无延期剧情，标定为 `hard_conflict`，阻断原子提交。

---

## 5. 交给专家 AI 评审的核心问题清单 (Review Rubric for External AI)

请外部架构审查 AI 重点就以下关键架构分歧进行深度审视与决疑：

1. **场景级（Scene-Level）与章级（Chapter-Level）的管线粒度权衡**：
   * 墨舟目前将 10 步事务管线（Prepare -> Compile -> Draft -> Review -> Extract -> Gate -> Commit）设在**章（Chapter）**级别；
   * 外部建议将正文生成细拆为 1,200~2,500 字的场景，单章由 3~5 场景组合。
   * **问题**：是将 10 步流水线整体下沉至 Scene 级别（会导致 Receipt 与提交记录暴增），还是维持 Chapter 级别的事务性，而在 Draft 内部引入 Scene-level 的微迭代与 Exit State 累加？哪种方案长期演进成本最低？

2. **因果合约（Causal Contract）建模路径抉择**：
   * 方案 A：独立立表为九柱之外的第十柱实体，拥有完全专属的生命周期和审计器；
   * 方案 B：将其作为 `TemporalFact` 的 `predicate = 'contract.*'` 特化谓词，复用现有的时空事实有效区间与失效级联。
   * **问题**：哪种方案更利于保持代码图谱的简洁与轻量？

3. **Promptfoo 本地测试用例的生命周期管理**：
   * 如何优雅地将小说作者在墨舟创作台中沉淀的设定（人物、世界观、禁忌），自动反哺生成 Promptfoo 的 yaml 断言用例，避免作者需要手动维护两套文档？

4. **全文检索（SQLite FTS5）与图谱拓扑漫游的融合方案**：
   * 目前 `@mozhou/context-compiler` 采用 2-hop 关系图走查 + 关键词匹配 + BGE-small 向量。
   * **问题**：如果在 SQLite 投影内开启 FTS5，如何与图谱漫游的结果做最优雅的 Reciprocal Rank Fusion (RRF) 混合重排？

---
*文档已在本地落盘，可直接交付架构审查 AI 审阅。*
