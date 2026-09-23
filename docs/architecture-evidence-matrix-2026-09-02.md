# 墨舟（MoZhou Novel OS）架构主张—代码—测试—证据基线矩阵
> **生成日期**: 2026-09-02  
> **工程基准**: Monorepo (`C:\zcode\novel-ai`), Git commit `b62601d`, GitNexus 7,653 节点 / 16,604 依赖边，0 循环  
> **性质**: 依据终审意见建立的严谨客观的“主张—代码—测试—证据”可复核基线，消灭一切夸大与状态混淆。

---

## 一、九柱与实体状态澄清（九柱实体定义勘误）

### 1. 真实“领域九柱”（`packages/kernel/src/kernel-schema.ts`）

| # | 实体名称 | TypeScript 接口 | 品牌化 ID | 真理平面存储形态 | 核心职责与不变量 |
|---|---|---|---|---|---|
| **1** | **作者意图** | `AuthorIntent` | `aint_${ULID}` | `设定/作者意图.md` | 宪法层蓝图，`provenance.protectedUserContent = true` 强保护，自动化通道严禁改写 |
| **2** | **大纲节点** | `OutlineNode` | `book_/volume_/arc_/chapter_${ULID}` | `大纲/*.md` | 四层大纲树（书/卷/弧/章），承载章级目标、依赖清单与字数预算 |
| **3** | **时空事实** | `TemporalFact` | `fact_${ULID}` | `追踪/时空事实.jsonl` | 带 `[validFrom, validUntil]` 章节区间原子事实，四态（`planned`/`candidate`/`confirmed`/`rejected`） |
| **4** | **认知状态** | `KnowledgeState` | `knst_${ULID}` | `追踪/认知状态.jsonl` | 三级认知（`knows`/`suspects`/`believes`），引用 `rejected` 事实自动级联失效 |
| **5** | **叙事承诺** | `NarrativePromise` | `prom_${ULID}` | `追踪/伏笔承诺.jsonl` | 伏笔与承诺，分支状态机（`introduced` → `reinforced` → `due`，终态分支 `paid_off`/`abandoned`/`overdue`） |
| **6** | **关系状态** | `RelationshipState` | `rels_${ULID}` | `追踪/角色关系.jsonl` | 实体双向动态关系与亲密度值 `[-100, +100]` |
| **7** | **时间线事件** | `TimelineEvent` | `tle_${ULID}` | `追踪/时间线.jsonl` | 不可变事件流水，受严格递增序数 `worldTimeOrder` 与时间线单调性制约 |
| **8** | **分场景文风** | `StyleProfile` | `style_${ULID}` | `文风/*.md` | 四场景文风画像（动作/对白/情感/设定），受滑动窗口更新与画像版本管理 |
| **9** | **章节原子提交** | `ChapterCommit` | `cmit_${ULID}` | `正文/` + Ledger | 正史提交凭据，绑定正文 Hash、五族 Delta、依赖清单，不可变 |

*注：`BookRecord` 为全书元数据容器，`Scene` 为章内写作细分单元，`ContextReceipt` 为只读编译凭据。*

---

### 2. `Scene` 现状 vs `SceneExitState` 目标澄清

* **现状（Code Baseline）**：
  * 定义位置：`packages/kernel/src/kernel-schema.ts:191`
  * 字段现状：
    ```typescript
    export interface Scene extends KernelEntityHead {
      readonly id: SceneId;
      readonly chapterOutlineNodeId: ChapterNodeId;
      readonly orderIndex: number;
      readonly povEntity: PovEntity;
      readonly summary: string;
      readonly beats: readonly SceneBeat[];
      readonly status: SceneStatus; // 'planned' | 'drafted' | 'written'
      readonly provenance: AuthorProvenance;
      readonly stale: StaleMarker | null;
    }
    ```
  * **结论**：当前内核 `Scene` **未承载** `exitState`。
* **P0-1 演进目标（Target Blueprint）**：
  * 遵循终审裁决，`SceneExitState` **不复制五族 Delta 自由文本**，而是设计为规范化的暂存引用清单（Staged Overlay）：
    ```typescript
    export interface SceneExitState {
      readonly sceneId: SceneId;
      readonly chapterSessionId: string;
      readonly draftHash: string;
      readonly deltaRefs: readonly string[];
      readonly unresolvedPromiseRefs: readonly NarrativePromiseId[];
      readonly nextSceneRequirements: readonly string[];
      readonly schemaVersion: 1;
    }
    ```

---

## 二、主张—代码—测试—证据基线矩阵 (Claim-Code-Test-Evidence Matrix)

| 架构主张 (Claim) | 真实实现文件 (Code File) | 核心导出符号 (Symbols) | 验证测试文件 (Test File) | 最近验证结果 (Evidence) |
|---|---|---|---|---|
| **双平面同步与 100% 重建** | `packages/data-plane/src/local-data-plane.ts` | `LocalDataPlane`, `rebuildProjectionFromCanon` | `packages/data-plane/src/local-data-plane.test.ts` | **8/8 通过** (指纹前后一致，版本漂移自愈) |
| **章节原子提交与相位守卫** | `packages/data-plane/src/chapter.ts` | `commitChapter`, `createChapterDraft`, `reopenChapter` | `packages/data-plane/src/chapter.test.ts` | **18/18 通过** (草稿自由改，提交即翻转) |
| **10 步管线状态机** | `packages/pipeline/src/session.ts` | `ChapterProductionSession`, `nextStepOf` | `packages/pipeline/src/session.test.ts` | **9/9 通过** (合法步进与越权跳步拦截) |
| **章节审查深模块统摄** | `packages/pipeline/src/review-step.ts` | `executeChapterReview`, `runReviewStep` | `packages/pipeline/src/review-step.test.ts` | **6/6 通过** (统摄机检、金句收割与账本) |
| **11 项机械门禁算术机检** | `packages/quality-engine/src/mechanical-gates.ts` | `evaluateMechanicalGates`, `detect4GramRepetition` | `packages/quality-engine/src/mechanical-gates.test.ts` | **4/4 通过** (首批 5 大核心门禁 0-Token 机检) |
| **文风度量与 Sepia 评分** | `packages/quality-engine/src/style-metrics.ts` | `evaluateStyleMetrics` | `packages/quality-engine/src/style-metrics.test.ts` | **3/3 通过** (对白比率、感官密度、3-Pass评分) |
| **三通道上下文装配与凭据** | `packages/context-compiler/src/assemble.ts`, `receipt-file.ts` | `compile`, `assembleContextPacket`, `loadReceipt` | `packages/context-compiler/src/assemble.test.ts`, `receipt-file.test.ts` | **32/32 通过** (预留预算配额，inputsDigest 一致) |
| **认知三级通道与零泄漏** | `packages/kernel/src/narrative-state.ts`, `packages/data-plane/src/narrative-state.ts` | `queryActiveFacts`, `queryKnowledgePerspective` | `packages/data-plane/src/narrative-state.test.ts` | **18/18 通过** (未授权视角与秘密不存在不可区分) |
| **全仓 0 循环依赖** | 全仓源码 | `.gitnexus/` 图谱索引配置 | `pnpm graph:check` | **`status: clean, 0 cycles`** (7,653 节点 / 16,604 依赖边) |

---

## 三、实施路线图与实施禁令（对齐终审意见）

### 1. 阶段划分（严守实施纪律，一次只推进一个原子闭环）

```
[当前基线 P0-0] -> 已建立可复核代码-测试矩阵
       │
       ▼
[P0-1: 场景垂直切片] -> 章内会话暂存层（Staged Overlay），单 Scene 编译-草稿-提取-暂存
       │
       ▼
[P0-2: 连续性评测套件] -> L1 ContextPacket 确定性夹具 -> Promptfoo L2 生产边界回归
       │
       ▼
[P1-1: CausalContract 扩展] -> 一等聚合注册 + 向 TemporalFact 投影派生事实 + 违约合法化
       │
       ▼
[P1-2: FTS5 离线评测与候选] -> 权限/时态硬过滤 -> 中文双路词法 -> 加权 RRF 实验
```

### 2. 严格实施禁令（Implementation Prohibitions）

1. **禁令 1**：严禁一次性同时实现 Scene、CausalContract、Promptfoo 和 FTS5，必须按 P0-1 → P0-2 → P1-1 → P1-2 顺序单步闭环推进；
2. **禁令 2**：严禁任何单个 Scene 绕过章节直接触发 `commitChapter` 或修改真理平面；
3. **禁令 3**：严禁把自由文本拼入退出状态，必须复用规范化 Delta 引用；
4. **禁令 4**：严禁把“违约（Breach）”本身当作硬冲突，只有“到期且无任何履约/违约/延期记录”才判定为硬冲突；
5. **禁令 5**：严禁在 RRF 排序阶段跨越时态和 POV 权限硬过滤。
