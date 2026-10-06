# CHG-20261006-10 — 卷边界状态压缩（State Compaction）矩阵裁决核实与全要素验收

> 执行：动态工作流（压缩实现员），ZCode，2026-10-06。  
> 需求来源：动态工作流任务——按缺口矩阵（`docs/plans/2026-10-06-spec-gap-matrix.md`）核实模块 #3（`compaction`：done）的裁决；先核实矩阵裁决是否属实（读关键代码、跑受影响测试），裁决为 done 且核实通过时，只做核实性收尾并返回 pass（无需业务开发）；否则按简报补齐缺口。  
> 领号：PROJECT-MAP.md 最新已登记至 CHG-20261006-09，按序领取 **CHG-20261006-10**。

---

## 1. 矩阵裁决核实结论

本会话对 `docs/plans/2026-10-06-spec-gap-matrix.md` 中关于模块 `compaction` 的矩阵裁决进行了细致源码核查、实现边界审查与契约单测实跑：

| 矩阵模块 | 矩阵记录状态 | 核心证据（file:line） | 缺口陈述 | 本轮核实结论 |
|---|---|---|---|---|
| `compaction` | **done** | `packages/kernel/src/compaction.ts:1-344`<br>`packages/data-plane/src/compaction.ts:1-314`<br>`packages/data-plane/src/local-data-plane.ts:424-445`<br>`packages/kernel/src/narrative-state.ts:540` | 无（卷完结压缩引擎、三层事务系统与数据面接口已完整实现，闭环 recall 召回过滤） | **完全属实**。卷边界状态压缩已严格按照“事务系统”实现三层解耦架构；完结卷 completed 触发门禁、幂等性回放、纯函数候选筛选（排除保护位与活跃引用）、注入式 LLM 端口与确定性机检、大纲摘要追加、事实流 compactedIntoVolumeId 标记行回写、Event Ledger 记账、Manifest 基线刷新、SQLite 投影重建以及 recall 召回过滤全链路闭环，单测与集成测试全绿通过。 |

**核实裁决结论：模块已完整实现，状态为 done，核实通过，无需追加业务代码开发。**

---

## 2. 核心架构与功能对照（简报及验收标准逐项核查）

依照【模块简报】与系统规格要求，逐项对账如下：

### 2.1 三层拆分架构（按"事务系统"实现，非简单 summarize 按钮）
1. **第一层：`planVolumeCompaction()` 纯函数候选筛选**：
   - 源码位置：`packages/kernel/src/compaction.ts:87-145`；
   - 逻辑：零 IO、零时钟纯函数。以 `volumeEndChapter` 锚定卷末，依据确定性裁决序（`already_compacted` → `not_confirmed` → `interval_still_active_or_unbounded` → `importance_critical` → `protected_user_content` → `active_knowledge_reference` → `active_timeline_reference`）逐一排查微事实；
   - 产出确定性候选集 `candidates` 与审计排除清单 `exclusions`（均按 factId 字典序升序）。
2. **第二层：`summarizeVolumeFacts()` 经注入式 LLM port 生成摘要**：
   - 源码位置：`packages/kernel/src/compaction.ts:266-302`；
   - 注入式端口：`VolumeSummaryLlmPort = (prompt: string) => Promise<string>`，不直连任何模型服务商；
   - 完整性校验门：候选为空时零开销短路返回；生成结果经 `validateVolumeSummary` 确定性机检，检验非空、字数上限（`VOLUME_SUMMARY_MAX_CHARS = 8000`）以及必需实体 subject 字面出现全覆盖。若机检未过抛出 `VolumeSummaryValidationError`，阻断下层落盘。
3. **第三层：`executeVolumeCompaction()` / `LocalDataPlane.prototype.compactVolume` 数据面原子落盘与标记回写**：
   - 源码位置：`packages/data-plane/src/compaction.ts:204-314`，`packages/data-plane/src/local-data-plane.ts:424-445`；
   - 原子落盘顺序：
     1) 更新卷大纲文件（写入 Frontmatter `volumeSummary`/`compactedAt` 并递增 `revision`，大纲正文追加 `## 卷状态摘要` 章节）；
     2) 回写微事实的 `compactedIntoVolumeId` 追加标记行（`buildCompactedFactRow` 保证内容不可变、revision + 1，满足 I6 行保留与同 id 末行胜出）；
     3) 追加 `VOLUME_COMPACTED` 审计事件至 `RUNTIME_EVENTS_PATH`（Event Ledger）；
     4) 刷新 Manifest 基线哈希记录；
     5) 重建 SQLite 投影（`rebuildProjectionFromCanon`）。

### 2.2 触发点绑定与保护
- **完结门禁**：绑定 Volume 状态正式变为 `completed`（`compaction.ts:210-214` 查卷大纲 Frontmatter 的 `status`，若为 `drafted` 或其他非 `completed` 状态立即抛出 `VolumeNotCompletedError`）；
- **防误触**：不绑定“进入下一卷”，避免作者回改上一卷草稿或切换章节时发生误压缩；
- **完结接口**：提供显式结卷方法 `markVolumeCompleted`（`local-data-plane.ts:443` 与 `compaction.ts:132-156`）。

### 2.3 幂等性与失败回滚保证
- **幂等性（Idempotency）**：同一卷重跑两次，若大纲中已存在卷摘要且当前 snapshot 中已无待折叠微事实，直接返回 `idempotentReplay: true`，**不重复调用 LLM、不重复写入事实流、不污染 Event Ledger**；
- **失败回滚（Failure Rollback）**：LLM 调用超时/异常或摘要机检不通过时，异常在动盘之前抛出，盘面事实流、Event Ledger、大纲节点与 Manifest **保持零修改、零字节写入**，任何事实绝不会被提前标记 `compacted`。

### 2.4 recall 召回过滤闭环
- **活跃事实查询过滤**：`packages/kernel/src/narrative-state.ts:540` 在 `queryActiveFacts` 中显式包含：
  ```typescript
  if (fact.compactedIntoVolumeId !== null) continue
  ```
  被折叠微事实被完全从正文活跃上下文中剔除；
- **长程召回集成断言**：`packages/context-compiler/src/recall.test.ts:948-997` 包含卷状态压缩与召回过滤集成用例，断言卷结卷压缩后，第 11 章生成时该微事实不再被召回，而跨卷有效事实与卷摘要正常发挥作用。

---

## 3. 受影响测试实跑验证记录

本会话在本地 Windows 运行环境使用 `pnpm.cmd exec vitest run` 对受影响模块进行了针对性独立回归验证：

### 3.1 卷压缩纯函数域单测
- 命令：`pnpm.cmd exec vitest run packages/kernel/src/compaction.test.ts`
- 结果：**1 passed (11 tests passed), 耗时 4ms**
  - 有效终态微事实被正确筛选为 candidates
  - 排除各项条件：已折叠、未确认、未过期或无界、critical、受保护、活跃认知与时间线引用
  - 参数非法时抛出 VolumeCompactionInputError
  - 正确检测空摘要、超长与未覆盖 subject 实体
  - buildVolumeSummaryPrompt 生成包含 subject 的提示词
  - 候选为空时短路返回空摘要且不调用 LLM
  - LLM 生成合法摘要且通过校验
  - LLM 摘要未覆盖 subject 时抛出 VolumeSummaryValidationError
  - 为普通事实递增 revision 并赋 compactedIntoVolumeId
  - 已折叠事实再次构造抛出 VolumeCompactionInputError
  - protectedUserContent 事实抛出 ProtectedContentViolationError

### 3.2 卷压缩事务系统数据面单测
- 命令：`pnpm.cmd exec vitest run packages/data-plane/src/compaction.test.ts`
- 结果：**1 passed (6 tests passed), 耗时 392ms**
  - 门禁 1：未完结卷（status != completed）拒绝执行压缩
  - 门禁 2：不存在的 volumeNodeId 抛出 VolumeNotFoundError
  - 失败回滚保证：LLM 失败或摘要校验失败时，零事实被标 compacted，零盘上副作用
  - 原子落盘：成功压缩后大纲写入摘要、事实流回写标记、Event Ledger 记账且投影重建
  - 幂等性：同一卷重跑两次不重复摘要、不重复标记、不污染 Event Ledger
  - 集成断言：卷压缩完成后，queryActiveFacts 不再召回被压缩微事实

### 3.3 上下文召回过滤集成测试
- 命令：`pnpm.cmd exec vitest run packages/context-compiler/src/recall.test.ts`
- 结果：**1 passed (32 tests passed), 耗时 11ms**
  - 包含卷边界状态压缩与召回集成断言（State Compaction Recall Filtering: 卷压缩后已折叠微事实不再作为活跃事实召回；跨卷有效事实保持召回）等全部 32 个用例全部通过。

### 3.4 关联模块全套件回归测试
- 命令：`pnpm.cmd exec vitest run packages/kernel/src/ packages/data-plane/src/compaction.test.ts packages/context-compiler/src/recall.test.ts`
- 结果：**9 passed, 90 tests passed, 0 failed, 耗时 1.01s**（kernel 7 套件 52 tests + compaction 1 套件 6 tests + recall 1 套件 32 tests）。

### 3.5 构建与类型检查验证
1. 全工作区 TypeScript 构建：
   - 命令：`pnpm.cmd build`（`tsc -b`）
   - 结果：退出码 0，零编译错误。
2. 服务端 TypeScript 类型校验：
   - 命令：`pnpm.cmd --filter @mozhou/web exec tsc -p tsconfig.server.json --noEmit`
   - 结果：退出码 0，零类型错误。

### 3.6 全量测试实跑（pnpm.cmd test 真实完整执行记录）

由于 Windows 环境下编排脚本无法以无扩展名方式直接 spawn `pnpm` 导致报 ENOENT，本会话在本地通过 `pnpm.cmd test`（`test:packages && test:web`）执行了完整全量回归测试：

- **命令**：`pnpm.cmd test`
- **执行过程与退出码**：
  1. `test:packages`（`vitest run`）：
     - Test Files: **117 passed (117)**
     - Tests: **1048 passed (1048)**
     - Duration: 15.68s
  2. `test:web`（`pnpm --filter @mozhou/web test`）：
     - Test Files: **147 passed | 1 skipped (148)**
     - Tests: **1086 passed | 14 skipped (1100)**
     - Duration: 15.50s
  3. **全量汇总结果**：
     - 测试文件：**264 passed / 1 skipped / 0 failed (共 265 文件)**
     - 用例总数：**2134 passed / 14 skipped / 0 failed (共 2148 用例)**
     - 退出码：**0 (全部通过，零失败，全绿)**
- **输出尾部原样转录**：
```
  ✓ src/workbench/editor/prose-ast.test.ts (22 tests) 8ms
  ✓ server/billing/catalog.test.ts (21 tests) 6ms
  ✓ src/storyboard/StoryboardView.test.tsx (14 tests) 3794ms
    ✓ StoryboardView（T04 闭环） > U04 原文对照并排（sb-duo）：引文与编辑框同面板，编辑与「改编说明」标签同源同步 380ms
    ✓ StoryboardView（T04 闭环） > 编辑对白后显式保存：payload expectedRevision=null、服务端返回 r1；文本全程不被清空 544ms
    ✓ StoryboardView（T04 闭环） > 409 冲突：本地编辑保留 + 冲突横幅；不静默覆盖 430ms
    ✓ StoryboardView（R1/R2 保存链路） > 409 冲突读 document.revision；显式重试发送 expectedRevision=服务器 revision 528ms
    ✓ StoryboardView（R1/R2 保存链路） > 保存进行中的编辑：成功后文本保留且保持 dirty 584ms
  ✓ src/draftStream.test.ts (17 tests) 4ms
  ✓ src/api/client.test.ts (3 tests) 3ms
  ✓ src/taskStream.test.ts (4 tests) 2ms
  ✓ src/workbench/providerGuidance.test.ts (8 tests) 2ms
  ✓ src/shell/workbenchStorage.test.ts (9 tests) 3ms
  ✓ src/shell/views.test.ts (2 tests) 2ms
  ✓ server/auditUnreferenced.test.ts (7 tests) 2ms
  ✓ src/App.test.tsx (24 tests) 2814ms
    ✓ App 壳集成（T40） > 书名与视图经 localStorage 持久化（建书后写入） 353ms
    ✓ App 首次建书 Wizard（T42） > Wizard 完成后进入常驻工作台；刷新不再自动弹出（localStorage 记忆） 508ms
  ✓ server/routes/writerLockIntegration.test.ts (10 tests) 3120ms
    ✓ scripts/*.mjs 与 TS 原语同一入口 > 脚本侧与 TS 侧拒绝口径对称：UNC 硬拒绝、探测不可判定 fail-closed、opt-in 放行 2714ms

 Test Files  147 passed | 1 skipped (148)
      Tests  1086 passed | 14 skipped (1100)
   Start at  18:28:08
   Duration  15.50s (transform 9.86s, setup 22.76s, collect 69.48s, tests 162.45s, environment 38.58s, prepare 16.11s)
```

---

## 4. GitNexus 图谱门禁与变更核查

1. **改动前影响面分析**：
   - 对核心接口 `queryActiveFacts` 运行 `impact({target: "queryActiveFacts", direction: "upstream"})`，识别出 47 个上游符号/4 个模块与 2 个核心执行流（CommitChapter、SaveProseDraft），核实压缩标记对各上游的查询过滤语义安全透明；
   - 对纯函数 `planVolumeCompaction` 运行 `impact`，确认为在制模块新增符号；
2. **实际变更面核查（detect_changes）**：
   - 运行 `detect_changes({scope: "unstaged"})`，确认工作区现有 38 个改动文件与 59 个符号变更均归属于前序会话在制改动（章节审查解耦、编辑器 AST 化、飞轮接线与移动端三闭环），本轮未修改任何产品代码，零侵入、零污染；
3. **红线恪守声明**：
   - 未执行 `git commit`、`git push`、`git reset`、`git clean` 或 `git checkout`；
   - 现有测试 100% 保持严格断言，未削弱、未删除任何测试；
   - 源码与测试中零可用凭据字面量。

---

## 5. 验收结论

矩阵记录 `compaction: done` **完全属实**。卷边界状态压缩事务系统经全要素代码审查与真实测试实跑核验，逻辑完备、测试严密、幂等与回滚可靠，已具备生产验收条件。本轮作为核实性收尾，提交通过结论。
