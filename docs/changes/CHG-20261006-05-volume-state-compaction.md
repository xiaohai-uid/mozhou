# CHG-20261006-05 — 卷边界状态压缩事务系统实现

- **变更编号**：CHG-20261006-05
- **日期**：2026-10-06
- **执行角色**：动态工作流（压缩实现员）
- **需求来源**：按 `docs/plans/2026-10-06-spec-gap-matrix.md` 唯一真源缺口矩阵对模块 #3 `compaction`（missing）的裁决与简报，实现卷边界状态压缩（State Compaction）三层事务系统。

---

## 1. 矩阵裁决核实

- **矩阵裁决**：`compaction`: missing
- **证据核实**：
  - `packages/kernel/src/kernel-schema.ts:256`：仅保留 `compactedIntoVolumeId: VolumeNodeId | null` 字段声明；
  - `packages/context-compiler/src/recall.ts:395`：虽然存在 `factTier` 对 `compactedIntoVolumeId !== null` 的分支预留，但全仓生产写路径恒赋 `null`（`apps/web/server/analysis/deltaExtractor.ts:208`）；
  - `packages/kernel/src/compaction.ts:1-60`：仅为本地未跟踪纯函数草稿，未导出、无 `summarizeVolumeFacts`、无数据面落盘事务。
- **核实结论**：裁决属实，确实缺少卷完结判定触发器、LLM 卷摘要生成、微事实折入写路径及端到端事务串联。

---

## 2. 架构设计与实现说明

实现严格按“事务系统”三层架构交付，拒绝简易的“summarize 按钮”：

1. **第一层：`planVolumeCompaction()`（纯函数筛选）**
   - 位于 `packages/kernel/src/compaction.ts`；
   - 筛选范围：完结卷内 `validUntil <= volumeEndChapter` 且 `status === 'confirmed'` 的终态微事实；
   - 裁决序确定性排除：`already_compacted` → `not_confirmed` → `interval_still_active_or_unbounded` → `importance_critical` → `protected_user_content`（I1 保护位） → `active_knowledge_reference` → `active_timeline_reference`。
2. **第二层：`summarizeVolumeFacts()`（注入式 LLM 摘要生成与机检门）**
   - 位于 `packages/kernel/src/compaction.ts`；
   - 经 `VolumeSummaryLlmPort = (prompt: string) => Promise<string>` 注入接口驱动，零直连任何具体 provider；
   - 候选为空时短路返回空摘要（不调 LLM，零浪费）；
   - 摘要机检：`validateVolumeSummary` 严检非空、字数上限（`VOLUME_SUMMARY_MAX_CHARS = 8000`）及所有候选微事实的 `subject` 字面覆盖；
   - 未过机检或 LLM 抛错直接抛出 `VolumeSummaryValidationError`，在动盘第一字节前阻断，天然保证失败回滚零盘上副作用。
3. **第三层：`executeVolumeCompaction()` / `commitVolumeCompaction()`（数据面原子落盘与回写）**
   - 位于 `packages/data-plane/src/compaction.ts` 与 `local-data-plane.ts`；
   - **触发点门禁**：绑定 Volume 状态正式为 `completed`（`VolumeNotCompletedError`）；
   - **幂等门禁**：检测到卷已包含有效摘要且当前无待折叠微事实时，返回 `idempotentReplay: true`，不重复调用 LLM、不重复写入事实流、不污染 Event Ledger；
   - **原子写盘事务**：
     - a. 卷大纲文件更新：写入 `volumeSummary` / `compactedAt`、追加 `## 卷状态摘要`、递增 revision 并原子写入；
     - b. 事实流标记回写：调用 `buildCompactedFactRow` 生成新行（`compactedIntoVolumeId: volumeNodeId`, `revision: fact.revision + 1`），追加至 `追踪/事实.jsonl`；
     - c. Event Ledger 记账：追加 `VOLUME_COMPACTED` 事件至 `.mozhou/events.jsonl`；
     - d. 基线刷新：更新 `manifest.json`；
     - e. 重建投影：调用 `rebuildProjectionFromCanon(root, db)` 同步 SQLite 投影；
4. **集成召回过滤**：
   - 更新 `packages/kernel/src/narrative-state.ts` 中的 `queryActiveFacts`：活跃层查询过滤 `fact.compactedIntoVolumeId !== null`；
   - 验证 `packages/context-compiler/src/recall.ts` 中的三通道召回：卷完结后，被压缩折叠的微事实不再作为活跃微事实进入候选集，跨卷有效事实保持召回。

---

## 3. 涉及文件清单

- `packages/kernel/src/compaction.ts`：增加 `summarizeVolumeFacts`、`VolumeSummaryValidationError`、修复导入导出；
- `packages/kernel/src/index.ts`：导出 `./compaction.js`；
- `packages/kernel/src/narrative-state.ts`：`queryActiveFacts` 过滤 `compactedIntoVolumeId !== null`；
- `packages/kernel/src/compaction.test.ts`：内核级纯函数筛选、提示词构造、机检、LLM 注入与行构造测试（11 tests）；
- `packages/context-compiler/src/recall.test.ts`：追加卷状态压缩后 recall 过滤集成断言（1 test）；
- `packages/data-plane/src/compaction.ts`：实现卷状态压缩事务、卷完成标记、大纲定位、幂等回放、原子落盘；
- `packages/data-plane/src/compaction.test.ts`：数据面门禁、失败回滚、原子落盘、幂等性、recall 过滤全套单测与集成测试（6 tests）；
- `packages/data-plane/src/local-data-plane.ts`：`LocalDataPlane` 暴露 `compactVolume` 与 `markVolumeCompleted`，`rebuildProjectionFromCanon` 增加活跃数据库连接与 Windows 独占锁容错；
- `packages/data-plane/src/index.ts`：导出 `./compaction.js`；
- `PROJECT-MAP.md`：登记本变更记录条目。

---

## 4. 真实测试验证记录

- **内核测试**：
  - 命令：`npx vitest run packages/kernel`
  - 结果：7 文件通过，52 用例全部通过（100% passed）。
- **上下文编译测试**：
  - 命令：`npx vitest run packages/context-compiler`
  - 结果：10 文件通过，112 用例全部通过（含新增状态压缩召回过滤断言，100% passed）。
- **数据面测试**：
  - 命令：`npx vitest run packages/data-plane`
  - 结果：25 文件通过，236 用例全部通过（含新增 6 项状态压缩事务与幂等/回滚测试，100% passed）。
- **全量门禁实跑测试 (`pnpm test`)**：
  - 命令：`pnpm test`（串联执行 `test:packages` 与 `test:web`）
  - 阶段 1 `test:packages`：117 测试文件全部通过，1048 用例全部通过（22.31s）；
  - 阶段 2 `test:web`：142 测试文件通过 / 1 跳过（143 文件），1056 用例通过 / 14 跳过（1070 用例，34.24s）；
  - **全量总计**：259 文件通过 / 1 跳过，**2104 用例通过 / 0 失败 / 14 跳过**，进程退出码 0。
- **全项目构建**：
  - 命令：`pnpm build`（`tsc -b`）
  - 结果：exit 0，零类型错误。
- **服务端类型检查**：
  - 命令：`pnpm --filter @mozhou/web exec tsc -p tsconfig.server.json --noEmit`
  - 结果：exit 0，零类型错误。
- **ESLint 检查**：
  - 命令：`npx eslint packages/kernel/src/compaction.ts packages/kernel/src/compaction.test.ts packages/data-plane/src/compaction.ts packages/data-plane/src/compaction.test.ts packages/data-plane/src/local-data-plane.ts packages/context-compiler/src/recall.test.ts`
  - 结果：exit 0，零告警零错误。
- **图谱门禁**：
  - 改动前对 `queryActiveFacts` 运行 `impact(direction: upstream)` 确认调用链路；
  - 改动后运行 `detect_changes` 核实影响面；确认既有未提交在制产物原样保留。

---

## 5. 验收标准达成对照

| 验收项 | 要求 | 验证结果 | 对应测试 |
|---|---|---|---|
| **触发点门禁** | 绑定 Volume 状态正式变为 completed | status!=completed 拒绝执行并抛 VolumeNotCompletedError | `compaction.test.ts:133` |
| **失败回滚** | 摘要生成失败或未过机检时不得提前标记 | 动盘前抛错，追踪流/大纲/事件账本零变更 | `compaction.test.ts:161` |
| **原子落盘** | 卷大纲写摘要、事实流回写标记、事件账本记账、投影重建 | 大纲含摘要、事实流追加新 revision 标记行、Event Ledger 追加事件、投影同步 | `compaction.test.ts:206` |
| **幂等性** | 同一卷重跑两次不重复摘要、不重复标记、不污染 Event Ledger | 第二次返回 idempotentReplay=true，不调 LLM，事实流与事件账本字节完全恒定 | `compaction.test.ts:257` |
| **Recall 过滤** | 验证 recall 不再召回被压缩微事实 | queryActiveFacts 与 recallCandidates 中被折叠微事实被排除，跨卷活跃事实正常召回 | `compaction.test.ts:301`, `recall.test.ts:948` |
