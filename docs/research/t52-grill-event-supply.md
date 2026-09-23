# t52 · grilling 终裁：事件供给面受控增补（P1–P3 / B1–B6）

> 票：#52（Phase 4 数据飞轮 · grilling）· 地图 #46 · 输入 t50-d-event-supply.md + t49-c-task-model-evaluator.md §1.6(G1–G3)
> 方法：票面决议项逐条对照代码实证（文件:行号均已本票复核），基线=t50 研究建议；推翻处给出代码级反证。
> 裁决记号：【终裁】批准 / 修改 / 否决；DEFER 仅用于真阻塞（本票为零，见 §9）。

---

## 0. 裁决总览

| 项 | 决议 | 终裁 | 一句话定案 |
| --- | --- | --- | --- |
| B1 | P1 执行事件桥接签名与可选性 | **修改后批准** | meta 第三参批准；eventPayload 弃平铺标尺、改铸 M14 `recipeSnapshot` 形状；G1 接线并入同票 |
| B2 | P2 deltaStats 盖章 + removedText 体量 | **批准（附精度修正）** | 五字段照采；removedText 全文无截断上限；盖章仅及发布侧克隆块 |
| B3 | P3 nowMs/durationMs 与零时钟边界 | **批准** | 「测量可缺省时钟、时刻戳必显式」判例成立；注释级锚定，不开新 ADR |
| B4 | FlywheelRecorded 不加裸 recipeId | **批准** | 修桥不复制，事件形状零改动 |
| B5 | 旧账本行读取语义 ?? null 缺省 | **批准（附硬约束）** | 新字段一律进 payload 层；DomainEvent 顶层禁止新增字段（白名单重建会丢弃） |
| B6 | learner 读面走 readPipelineLedger | **批准（附勘误）** | 双格式 position 权威序确认；票面引用路径 data-plane→实为 runtime |
| Q-D | scenarioType 发射端预留槽位 | **不做**（有结论的不做，非 DEFER） | 等 #48 分类权属结论，届时一行可选字段随时可补 |
| Q-E | 邻接启发式顺路重构 | **批准** | TaskResult 增只读 taskRef，按 taskRef 精确折叠替代「最近一条」 |

词表与 EVENT_PAIRS 零改动复核通过：DOMAIN_EVENT_TYPES 14 词条不动（kernel/domain-events.ts:19-34）、三组成对约束不动（domain-events.ts:47-51）。

---

## 1. B1 · P1 执行事件桥接 ——【终裁】修改后批准（整批一批）

**批准部分**：
- `RuntimeEngine.execute(taskType, payload, meta?)` 增第三个可选参——生产调用方仅 pipeline/src/draft-step.ts:324 一处，测试全部双参调用（engine.test.ts:37-149、structuredOutput.test.ts:141 实证），可选第三参对既有签名零破坏。
- `meta.parentTaskRef` / `meta.chapterIndex` 两槽位照采：chapterIndex 上 DomainEvent 既有顶层可选槽（domain-events.ts:42），parentTaskRef 进 payload。
- 拆票问题（t50 §7 Q-A）裁定**整批一批**：同一接缝（execute 签名 + DraftStepRequest + GenerationStarted 发布点 engine.ts:123-127）拆两次动，违反票边界纪律（repo AGENTS.md §2.7 跨模块重构禁令的反面——这正是同一行为的必要关联面）。

**修改部分（推翻 t50 平铺标尺方案，代码级证据）**：
t50 P1 提议 `meta.eventPayload: {recipeId, recipeVersion}` 平铺标量入账。**否决该形状**，理由三条：
1. **唯一生产消费者走嵌套路径**：全仓读 recipe 身份的只有 benchmark 版本矩阵 `payload[recipeSnapshot].recipe.recipeVersion` 三级收窄（benchmark/src/version-matrix.ts:18-29、:49），平铺路径消费者为零——grep 实证 recipeId/recipeVersion 写入仅 draft-step.ts:326-327，无任何读取方。
2. **M14 缝形状已在库且自带背书**：`toGenerationStartedPayload(doc)` 返回 `{recipeSnapshot: doc}`（runtime/src/recipe/loader.ts:209-213），注释明示「解析产物本就是纯数据，JSON 序列化往返无损，账本回放可得原快照」。t50 担心的 ADR-0021 体量问题已被 M14 评审时的在码决定覆盖；且嵌整份配方使 GenerationStarted 自包含，正是 ADR-0007(novel):24-25 回放可审计性（"recipe ID, model parameters" 可考）的要求——配方 YAML 后续演进不会伪造历史回放。
3. **同行双份身份 = 冗余投影**：同时盖平铺标量与 recipeSnapshot 违反单一事实源（工程原则 2 最简实现）；UVSD §工程原则1 要求删除无人消费的旧路径而非保留。

**定案值（给实现票）**：
- `DraftStepRequest` 增可选 `recipeDoc?: CapabilityRecipeDocument`（编排方经 loadRecipeById/loadRecipeFile 所得原档；loader 生产接线现状为零调用——loader.ts:183,196 仅测试引用，故设可选，缺省行不含 recipeSnapshot，读侧 null 容忍已是既定行为 version-matrix.ts:33）。
- `runDraftStep` 经 meta 传 `{ parentTaskRef: sessionTaskRef, chapterIndex, ...(recipeDoc ? { eventPayload: toGenerationStartedPayload(recipeDoc) } : {}) }`。
- engine.execute 发布 GenerationStarted 时：chapterIndex 上顶层槽，eventPayload 并入 payload（snapshot 之后）；GenerationFinished/TaskAttemptRegistered 同样上 chapterIndex + parentTaskRef（attempt 序列按 parentTaskRef 分组即重提交轨迹）。
- **业务 payload 中删除 `recipeId`/`recipeVersion` 两键**（draft-step.ts:326-327），prompt/hotContextBytes/mode 留守（binding 消费面不动）。
- **硬约束**：parentTaskRef 只准进 payload，不准上 DomainEvent 顶层——pipeline 读面逐字段白名单重建会静默丢弃未知顶层键（pipeline/src/ledger.ts:57-63「逐字段重建（不透传未知键）」），这是 t50 未点破的读取侧事实。
- G1 接线（M14 中段）随本票闭合：发布点同一处（engine.ts:123-127），拆票必二次动同一 publish——采纳 t49 §5.1 两选项中的「随实现票一并做」。

## 2. B2 · P2 编辑 delta ——【终裁】批准（附精度修正）

**批准部分**：deltaStats 五字段 `(opsInsert, opsDelete, opsReplace, insertedChars, removedChars)` 应用前机械计数盖章（仿 UsageFact 盖章先例 record-step.ts:86-102）；removedText 补齐 diff 另半边——规格三重背书复核无误：ADR-0007(novel):20「diffs between candidate and user final text」（两侧都要）、ADR-0005:25 Tier2 抽象编辑为风格规则、data-flywheel-spec:53 明列 prose deletions。

**体量裁决（t50 §7 Q-B：全文 vs 截断折中）→ 定案全文、无截断上限**：
- 对称性证据：insert 侧 replacementText 今天就无上限入账（user-edit-step.ts:69-70 可选字符串无任何预算校验；validateBlock :73-100 只查存在性不查长度）。单给 removedText 设上限会造成 replace 块两侧不对称失真——原文截断而新文全量，内容级 diff 学不了，恰好废掉本字段的用途。
- 成本面：本地账本 JSONL、人工编辑粒度（章级行操作），量级可控；隐私面无新出口（replacementText 先例 user-edit-step.ts:230-235 原样落账）。
- 若未来真出现体量问题，预算必须双侧同一常量（insertionCap === removalCap），届时受控增补再议。

**精度修正（防实现歧义）**：
1. 字段口径钉死：`insertedChars` = Σ replacementText.length over insert+replace 块；`removedChars` = Σ 被 remove 行以 '\n' join 后的长度 over delete+replace 块；ops* 三计数即块数。
2. removedText 是**步内产出、仅及发布侧**：recordUserEdit 发布前对 blocks 做 map 克隆并在 delete/replace 克隆体上盖 removedText（应用前从行数组截取，user-edit-step.ts:123-148 区间语义现成）；请求侧原数组零触碰（payload.blocks 不再与 request.blocks 同一性，无消费者依赖此同一性）。
3. `EditOperationBlock` 增 `readonly removedText?: string` 时，validateBlock 同步拒绝调用方传入该键——镜像 delete 不得携带 replacementText 的既有守卫（user-edit-step.ts:90-94），宁败不猜，杜绝调用方伪造删除侧文本。

## 3. B3 · P3 生成时长 ——【终裁】批准

- 形状照采：`RuntimeEngineDeps.nowMs?: () => number` 缺省 Date.now、测试注入常数——与同结构既有可选依赖完全同构（engine.ts:97 `deps.newTaskRef ?? (() => newUlid())` 先例）。
- 取样与盖章：execute 入口取样一次，三个 GenerationFinished 出口统一盖 `durationMs`（成功 engine.ts:154-158 / terminal :165-169 / recoverable :176-184），含 fallback 链全程——比 t49 G3 原设想「Record 步传入实测耗时」更优：引擎层测量天然覆盖多 attempt 全程，Record 步拿不到这段区间。
- **零时钟判例边界（t50 §7 Q-C）裁定成立**：「测量值（durationMs）可缺省注入时钟、时刻戳（at/nowIso/createdAtUtc）必显式注入」。依据分界干净：时刻戳先例是「显式注入、缺省不落」（record-step.ts:14、:83 nowIso、:100 条件展开）；而账本任务行起始锚已由 taskRef ULID 自带毫秒时戳（kernel-schema.ts:36-37「字典序 = 时间序」），durationMs 是唯一缺角且属测量域。基准判定器的零时钟纯函数纪律（benchmark types.ts:4）不受影响——那是判定器域，不是引擎运行时域。
- 记录方式定案：**注释级锚定**——engine.ts 新 dep 定义处为主锚（写明两分界），record-step.ts:14 头注交叉引用一句修订；不新开 ADR。理由：边界共两案例且均已被类型签名机械强制（可选注入参数的存在本身就是约束），ADR 文档开销与信息量不成比例（工程原则 2）；出现第三类时间用途时再升格 ADR。

## 4. B4 · FlywheelRecorded 不加裸 recipeId ——【终裁】批准

验证通过：症状贴膏药定性正确——evaluator 需要 provider/model/attempt 轨迹与结局 join，全在引擎命名空间，FlywheelRecorded 单点补 recipeId 解决不了 join 断裂。P1 桥落地后 evaluator 经 `parentTaskRef` 把 FlywheelRecorded（会话命名空间，record-step.ts:126-137 形状复核无误：{outcome, commitId, recordedCount, errorDetail?}）与执行事件连成同窗轨迹，配方身份自 recipeSnapshot 可达。复制面漂移风险消除。事件形状零改动。

## 5. B5 · 旧账本行读取语义 ——【终裁】批准（附硬约束）

- 读侧 `?? null` 缺省确认：条件展开先例逐字核实（record-step.ts:95-100 六连条件展开）；payload 整体透传两侧读者均透明（runtime/eventBus.ts:57-61 整行透传、pipeline/ledger.ts:62 payload 原样携带）。
- **附加硬约束（升级为本票纪律）**：所有 P1/P2 新字段一律落 payload 层或 DomainEvent 既有可选槽（chapterIndex）；**禁止给 DomainEvent 接口新增顶层字段**——pipeline 读面是逐字段白名单重建，未知顶层键被静默丢弃（ledger.ts:57-63），顶层新字段将造成「写侧入了账、读侧永远看不见」的哑字段。runtime 读面同理只认 {seq, event} 外形（eventBus.ts:46-61）。历史行缺新字段 = 学习器缺省处理，冷启动容忍归 #47。

## 6. B6 · learner 读面 ——【终裁】批准（附票面勘误）

- 确认：三个 learner 一律走 `readPipelineLedger` 双格式读面，position 为唯一权威时序（ledger.ts:13-14「跨格式不做 seq 算术」；:41-73 实现）——平铺行 seq 0 起 vs 任务行 seq 1 起，混算必错。
- 确认：runtime `readStoredLines` 跳过平铺行是特性不是缺陷（eventBus.ts:54-56 注释原意即防配对/投影被平铺行干扰），**不得扩展**它去喂 learner——扩展会把 ChapterCommitted/ContextCompiled 灌进配对语义，破坏不变式。
- **勘误**：票面引用 `packages/data-plane/src/eventBus.ts:54-56` 路径不存在——实际文件 `packages/runtime/src/eventBus.ts`（data-plane 包只持 RUNTIME_EVENTS_PATH 常量，ledger.ts:18 引用即证）。内容所指行号吻合，裁决不受影响，实现票按 runtime 路径施工。
- 另勘误：票面 B2 标注「t50 §7 Q-A」实为 Q-B（removedText 体量题）、B3 标注「Q-B」实为 Q-C（零时钟题）——字母错位不影响决议对应关系。

## 7. 附带裁决一：Q-D scenarioType 槽位 ——【终裁】不做（现在）

分类权属未决（发射端盖章 vs 学习端推断）归 #48；现在预留 = 投机字段（UVSD §1.4 禁投机抽象）。预留成本虽低（一行可选字段），但字段一旦入账就有历史行携带语义，事后改口径即脏数据。**定案：等 #48 结论走受控增补，随时可补，本票不留槽。**

## 8. 附带裁决二：Q-E 邻接启发式重构 + t49 G2/G3 收敛

- **Q-E 批准，定案超出研究建议的具体形状**：P1 落地同票把 `lastGenerationFinishedReason`（draft-step.ts:241-251，注释自认依赖 S11 全局单飞）改为按本次执行的 taskRef 精确折叠——前置条件：`TaskResult` 增只读 `taskRef` 字段（engine.ts:159/:170/:185-190 三处返回点纯增量），否则调用方根本拿不到自己这次的 taskRef。S11 单飞解除前此启发式本就不可靠（T19 重提交全量重走场景「最近一对 ≠ 被提交那对」，t50 §2.3 已推断），顺路修掉。
- **t49-G2 就此收敛（无需另开票）**：UsageRecord 不加 taskType/recipeVersion——usage 行本挂会话 taskRef（record-step.ts:36-52），P1 后经 parentTaskRef join 执行行即得双轴，避免身份双写漂移。
- **t49-G3 就此收敛**：P3 durationMs 即 G3 latency 缺口的账面落点（§3 论证引擎层测量优于 Record 步局部计时）。
- 范围外移交（非本票 DEFER）：t49 §2.3 触发阈值数值（R2≥30样本/≥5窗口、R3 Wilson 区间 + 降幅≥10%、R4 双窗≥14天等）与 §5.2 RouteSuggestionIssued 入账与否，归 #49 grilling 拍板，本票不越界。

## 9. DEFER 清单

**空。** 八个决议点（B1–B6 + Q-D/Q-E）全部凭规格/ADR/代码级证据落锤，无一命中「无法决断」标准。真正的未决项都已定向移出：scenarioType 归 #48（§7）、阈值数值与建议物入账归 #49（§8）、recipeDoc 编排方接线细节归实现票在既定契约内二选一（§1 定案值已锁死契约形状，内部路径自由）。

## 附：实现票验收核对单

1. execute 三参可选 meta；GenerationStarted/Finished/TaskAttemptRegistered 均携 chapterIndex（顶层槽）+ parentTaskRef（payload）。
2. GenerationStarted.payload 含 recipeSnapshot（M14 形状）当且仅当 recipeDoc 可得；业务 payload 无 recipeId/recipeVersion 键。
3. DomainEvent 接口零新增顶层字段；EVENT_PAIRS 零改动；词表零改动。
4. UserEditRecorded.payload 增 deltaStats 五字段恒有；blocks 克隆体 delete/replace 带 removedText 全文；validateBlock 拒外部 removedText。
5. GenerationFinished 三出口均盖 durationMs；nowMs 缺省 Date.now、注释锚定判例边界；record-step.ts:14 交叉引用同步。
6. TaskResult 增只读 taskRef；lastGenerationFinishedReason 改 taskRef 精确折叠。
7. 新字段写入全部条件展开（exactOptionalPropertyTypes）；读侧全部 ?? null 容缺。
