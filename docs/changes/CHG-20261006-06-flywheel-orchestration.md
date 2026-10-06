# CHG-20261006-06 — 数据飞轮生产接线与模型建议呈现

> 执行：动态工作流（飞轮接线员），ZCode，2026-10-06。
> 需求来源：动态工作流任务——按 `docs/plans/2026-10-06-spec-gap-matrix.md` 模块 #4（flywheel：partial）补齐缺口；仅做编排接线，不重写算法，测试与实现同变更新，绝不削弱测试，绝不伪造完成。
> 领号：PROJECT-MAP.md 顺序递增领取 **CHG-20261006-06**。

## 1. 缺口核实（动手前）

矩阵裁决：**`flywheel: partial` 属实**。
- 既有实现：`packages/flywheel/src/learner.ts:45` 已实现 `AuthorPreferenceLearner`（增量折叠与 `rebuildPreference`），`packages/flywheel/src/evaluator/run.ts:120` 已实现 `TaskModelEvaluator`，`apps/web/server/routes/proseRoutes.ts:203` 生产已接入 `runStyleLearnerForWindow`。
- 缺口：`packages/flywheel/README.md:25` 明确声明 `confirmRoutingSuggestion` / `runTaskModelEvaluation` / `readSuggestions` 在生产代码中无调用方；缺少 Web BFF 端点、缺少前端消费界面；缺少章节 Accept/Reject/Commit 真实观测向飞轮的闭环串联。

## 2. 方案与核心不变量

1. **编排不重写算法**：直接复用 `@mozhou/flywheel` 导出的 `loadProfileOrColdStart`, `rebuildPreference`, `runPreferenceLearning`, `readSuggestions`, `runTaskModelEvaluation` 与 `@mozhou/pipeline` 的 `presentCandidates`, `recordCandidateDecision`。
2. **硬不变量（C6）**：**只建议，不自动改变模型路由**。系统只计算并持久化 `RoutingSuggestion` 派生条目，绝不在后台静默改写 `settings.yaml` 或切换底层生成模型。
3. **真实观测接入**：
   - 行内选区 AI 编辑器（Inline AI）通过 `/api/prose.edit.decision` 接收作者的 Accept 或 Reject 决策，使用 `PublishBus` 落账双路 `CandidateCreated` 与 `UserEditRecorded { action: 'candidate_decision', level: 'selection' }`；
   - 章节定稿（`/api/chapter.commit`）在 `afterRecord` 钩子中触发 `runPreferenceLearning(root)`，自动增量折叠所有新观测并物化 `.mozhou/preference/profile.json`。
4. **诚实空态**：偏好画像在无观测时如实提示冷启动先验；模型建议在样本不足或无建议时如实呈现空态与样本进度，绝不伪造虚假数据。

## 3. 实际变更

1. **服务端 BFF 路由新增与装配**：
   - 新增 `apps/web/server/routes/flywheelRoutes.ts`：提供 `/api/flywheel.preference`, `/api/flywheel.preference.rebuild`, `/api/flywheel.suggestions`, `/api/flywheel.evaluator.status`, `/api/flywheel.evaluator.run`；
   - 增强 `apps/web/server/routes/proseEditRoutes.ts`：新增 `/api/prose.edit.decision`，支持 `recordProseEditDecision` 落账；
   - 增强 `apps/web/server/routes/proseRoutes.ts`：在 `/api/chapter.commit` 的 `afterRecord` 钩子中接入 `runPreferenceLearning(root)`；
   - 登记 `apps/web/server/routePolicies.ts`：将上述路由登记为 `'book'` 级隔离策略；
   - 装配 `apps/web/server/api.ts`：在 `createMoZhouApiRouter()` 挂载 `flywheelRoutes`。
2. **前端消费界面新增与挂载**：
   - 新增 `apps/web/src/workbench/PreferenceProfilePanel.tsx`：展示七维偏好画像、观测计数、冷启动诚实空态、全量重建按钮；
   - 新增 `apps/web/src/workbench/ModelRoutingSuggestionsPanel.tsx`：展示模型路由建议列表、当前样本量与资格门状态、硬不变量保证说明、显式重新评估按钮；
   - 挂载 `apps/web/src/workbench/WorkbenchView.tsx`：在中栏工作台嵌入“策略飞轮与模型评估”面板；
   - 增强 `apps/web/src/workbench/editor/ProseEditorPanel.tsx`：在 Accept/Reject 时异步安全上报 `/api/prose.edit.decision`。

## 4. 自动化验证与测试全绿证据

1. **BFF 契约测试**：`apps/web/server/routes/flywheelRoutes.test.ts`（7/7 passed）：
   - 冷启动诚实空态与先验画像（`materialized: false, observationCount: 0`）；
   - 观测产生后画像物化与真实读数（`materialized: true`）；
   - 全量重建（rebuild）；
   - 模型建议空态（`suggestions: []`）；
   - 样本量状态与最小评估资格门门槛；
   - 显式重新评估入口与“不自动改动当前模型路由”硬不变量断言；
   - 缺失 root 防御性 400 校验。
2. **观测写入路径与闭环测试**：`apps/web/server/routes/proseEditDecision.test.ts`（4/4 passed）：
   - `/api/prose.edit.decision` accepted 分支成功落账双候选与择优事件；
   - rejected 分支两路正确反向记录；
   - 非法参数防御性校验；
   - 章节 Commit 触发后偏好画像自动折叠与快照物化闭环。
3. **前端呈现面测试**：`apps/web/src/workbench/FlywheelPanels.test.tsx`（4/4 passed）：
   - `PreferenceProfilePanel` 冷启动诚实空态渲染；
   - 已物化画像读数展示与手动全量重建交互；
   - `ModelRoutingSuggestionsPanel` 诚实空态、样本量状态与硬不变量约定文案；
   - 建议列表项指标展示与显式重新评估交互。
4. **回归与受影响测试**：
   - `packages/flywheel` 全量测试：13 测试文件 **133/133 passed**；
   - `apps/web` 受影响测试：6 测试文件 **39/39 passed**（包含 `WorkbenchView.test.tsx` 7/7、`ProseEditorPanel.inlineEdit.test.tsx` 5/5、`proseEditRoutes.contract.test.ts` 12/12）；
   - 合计受影响范围 **19 个测试文件 172 项测试全部一次性通过**。
5. **全量测试实跑（pnpm test 真实执行与输出尾部）**：
   - 执行命令：`pnpm test`（`pnpm run test:packages && pnpm run test:web`）；
   - 第一段 `test:packages`：117 个测试文件全部通过（117 passed），**1048 passed / 0 failed**（耗时 12.76s）；
   - 第二段 `test:web`：145 个测试文件通过、1 个跳过（145 passed | 1 skipped），**1071 passed / 14 skipped / 0 failed**（耗时 13.94s）；
   - 全量汇总：**262 测试文件通过 / 1 跳过，总计 2119 passed / 14 skipped / 0 failed**，退出码 0，全量 100% 绿色通过；
   - 输出尾部：
     ```text
     Test Files  145 passed | 1 skipped (146)
          Tests  1071 passed | 14 skipped (1085)
       Start at  16:04:43
       Duration  13.94s (transform 9.64s, setup 24.64s, collect 62.30s, tests 140.34s, environment 33.00s, prepare 16.57s)
     ```
6. **代码静态检查**：
   - 前端构建与全仓编译：`pnpm build`（`tsc -b`）退出码 0，零错误；
   - 服务端类型检查：`npx tsc -p apps/web/tsconfig.server.json --noEmit` 退出码 0，零错误；
   - 全仓 ESLint：`pnpm lint` 退出码 0，零错误零告警；
   - 图谱依赖环检测：`gitnexus check --cycles`：`status: clean, cycleCount: 0`，零依赖循环。

## 6. 图谱与 Git 状态

- `gitnexus detect_changes` 已跑，受影响符号已审查，风险归属清晰；
- 严格遵守红线：未执行任何 `git commit/push/merge/tag/reset/clean/checkout/stash` 操作，完整保留工作区所有用户在制工作。
