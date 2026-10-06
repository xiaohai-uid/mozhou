# CHG-20261006-11 — 数据飞轮编排接线核查与验证收尾

> 执行：动态工作流（飞轮接线员），ZCode，2026-10-06。  
> 需求来源：动态工作流任务——按 `docs/plans/2026-10-06-spec-gap-matrix.md` 模块 #4（flywheel：done）核实矩阵裁决是否属实；先核实矩阵裁决（读关键代码、跑受影响测试），裁决为 done 且核实通过时，只做核实性收尾并返回 pass（已实现、核实通过、无需开发）；零修改用户在制代码。  
> 领号：PROJECT-MAP.md 顺序递增领取 **CHG-20261006-11**。

## 1. 模块裁决核查结论

缺口矩阵裁决：**`flywheel: done` 经实测完全属实**。
在当前工作区中，数据飞轮算法编排接线、BFF 路由、行内决策上报、定稿学习触发与前端双面板全链路已完整实现并贯通，无需二次开发：

1. **章节 Accept/Reject/UserEdit/Commit 真实观测接入**：
   - 行内选区 AI 编辑器（Inline AI）通过 `/api/prose.edit.decision` 接收作者的 Accept 或 Reject 决策（`apps/web/server/routes/proseEditRoutes.ts:134-180`）；
   - `recordProseEditDecision`（`apps/web/server/routes/proseEditRoutes.ts:274-310`）使用 `PublishBus` 真实向 Event Ledger 写入双路 `CandidateCreated` 与 `UserEditRecorded { action: 'candidate_decision', level: 'selection' }`；并在落账后即时调用 `runPreferenceLearning(root)` 增量折叠偏好；
   - 章节定稿提交（`/api/chapter.commit`，`apps/web/server/routes/proseRoutes.ts:915-920`）在 `afterRecord` 钩子中触发 `runPreferenceLearning(root)`，自动增量折叠所有新观测并物化 `.mozhou/preference/profile.json` 快照；
   - `TaskModelEvaluator` 评估资格门判定：`/api/flywheel.evaluator.status` 依据 Event Ledger 中决策样本量与章节窗计算门槛（`EVAL_MIN_DECISIONS: 20` 与 `EVAL_MIN_CHAPTER_WINDOWS: 5`），满足时判定 `eligible: true`；提供显式重新评估入口 `/api/flywheel.evaluator.run`。
2. **Web BFF 5 个端点完整实现与装配**：
   - `apps/web/server/routes/flywheelRoutes.ts:59-200` 完整实现 5 个端点：
     1) `POST /api/flywheel.preference`：读取偏好画像与观测计数，区分已物化与冷启动先验；
     2) `POST /api/flywheel.preference.rebuild`：显式全量重建偏好画像；
     3) `POST /api/flywheel.suggestions`：只读获取模型路由建议列表；
     4) `POST /api/flywheel.evaluator.status`：查询当前决策与章节样本量及最小评估门槛；
     5) `POST /api/flywheel.evaluator.run`：显式触发模型评估并追加建议。
   - `apps/web/server/routePolicies.ts:119-123` 登记路由白名单，绑定 `'book'` 作用域隔离策略；
   - `apps/web/server/api.ts:631` 在 `createMoZhouApiRouter()` 中显式装配 `.use(flywheelRoutes)`。
3. **严格不变量（C6）保证**：
   - 坚守“**只建议，不自动改变模型路由**”硬不变量：`flywheelRoutes.ts:203`（接口返回说明：“建议已生成并落入建议表；墨舟遵守不变量约定，不自动改动当前模型路由配置”）、`ModelRoutingSuggestionsPanel.tsx:207`（前端醒目说明）均严格保障系统只产出参考建议，绝不私自改写 `settings.yaml` 或静默切换底层生成模型。
4. **前端消费双面板与诚实空态**：
   - `PreferenceProfilePanel.tsx:1-190`：展示七维偏好画像、观测计数、物化状态、手动全量重建；无数据时展示冷启动通用网文先验（诚实空态），绝不伪造已收敛；
   - `ModelRoutingSuggestionsPanel.tsx:1-290`：展示模型建议列表、资格门/样本量状态、显式重新评估入口；样本不足或无建议时如实展示诚实空态与硬不变量约定说明；
   - `WorkbenchView.tsx:320-330`：在中栏工作台嵌入 `<details className="card-shell studio-flywheel">` 折叠面板，真实挂载 `PreferenceProfilePanel` 与 `ModelRoutingSuggestionsPanel`；
   - `ProseEditorPanel.tsx:270-298`：在作者点击采纳/放弃或通过 Enter/Esc 快捷键采纳/放弃时，异步向 `/api/prose.edit.decision` 安全上报。

## 2. 实际变更

本次任务严格遵守红线与任务指示，裁决为 `done` 且核实通过，仅做核实性收尾：
- 零修改产品代码；
- 新增证据文档 `docs/changes/CHG-20261006-11-flywheel-orchestration-verification.md`；
- 在 `PROJECT-MAP.md` 中登记变更条目 `CHG-20261006-11`。

## 3. 自动化验证与实跑证据

1. **BFF 契约测试**（`apps/web/server/routes/flywheelRoutes.test.ts`）：
   - 执行：`pnpm.cmd --filter @mozhou/web test -- server/routes/flywheelRoutes.test.ts`
   - 结果：**7/7 passed**（包含冷启动诚实空态、观测写入后物化读取、全量重建、建议空态、样本量门槛查询、显式评估与不变量声明断言、400 参数校验）。
2. **观测写入路径与闭环测试**（`apps/web/server/routes/proseEditDecision.test.ts`）：
   - 执行：`pnpm.cmd --filter @mozhou/web test -- server/routes/proseEditDecision.test.ts`
   - 结果：**4/4 passed**（包含 `/api/prose.edit.decision` 接收 accepted 决策落账双候选与择优事件、rejected 决策相反记录、400 参数校验、章节 Commit 触发后自动折叠并物化 profile.json 闭环）。
3. **前端呈现面测试**（`apps/web/src/workbench/FlywheelPanels.test.tsx`）：
   - 执行：`pnpm.cmd --filter @mozhou/web test -- src/workbench/FlywheelPanels.test.tsx`
   - 结果：**4/4 passed**（包含画像面板冷启动空态渲染、已物化画像读数展示与重建交互、模型建议面板空态与不变量说明展示、建议列表指标展示与重新评估交互）。
4. **底层飞轮算法全套测试**（`packages/flywheel`）：
   - 执行：`pnpm.cmd --filter @mozhou/flywheel test`
   - 结果：13 个测试文件全部通过，**133/133 passed**（包含 Wilson 置信区间、样本阈值、偏好学习器、语义分析等）。
5. **密切关联受影响测试**：
   - 执行：`pnpm.cmd --filter @mozhou/web test -- server/routes/proseEditRoutes.contract.test.ts src/workbench/editor/ProseEditorPanel.inlineEdit.test.tsx src/workbench/WorkbenchView.test.tsx`
   - 结果：3 个测试文件全部通过，**24/24 passed**（编辑流契约 12 passed、行内编辑与热键 5 passed、工作台面板 7 passed）。
   - **受影响范围测试合计**：**19 个测试文件 172 项测试全部通过**。
6. **全量门禁实跑（pnpm.cmd test 完整实跑输出）**：
   - 执行命令：`pnpm.cmd test`（依次执行 `pnpm run test:packages && pnpm run test:web`）
   - **第一段 test:packages**：117 个测试文件全部通过（117 passed），**1048 passed / 0 failed**（耗时 12.87s）；
   - **第二段 test:web**：147 个测试文件通过、1 个跳过（147 passed | 1 skipped），**1086 passed | 14 skipped / 0 failed**（耗时 23.72s）；
   - **全量合计**：**264 个测试文件通过 / 1 个跳过，总计 2134 passed / 14 skipped / 0 failed**，退出码 0，全量 100% 绿色通过；
   - 输出尾部原样截取：
     ```text
      Test Files  147 passed | 1 skipped (148)
           Tests  1086 passed | 14 skipped (1100)
        Start at  18:42:41
        Duration  23.72s (transform 10.17s, setup 25.64s, collect 92.16s, tests 163.57s, environment 197.02s, prepare 16.57s)
     ```

7. **双端类型检查与构建验证**：
   - 服务端与前端类型检查：`pnpm.cmd --filter @mozhou/web typecheck`（`tsc -b && tsc -p tsconfig.server.json --noEmit`）**exit 0 零错误**；
   - 全工作区构建：`pnpm.cmd build`（`tsc -b`）**exit 0 零错误**；
   - 全仓 ESLint：`pnpm.cmd lint`（`eslint .`）**exit 0 零错误零告警**。
8. **GitNexus 图谱门禁**：
   - 执行 `gitnexus check --cycles`：输出 `status: clean, cycleCount: 0, cycles: []`，零依赖循环。
   - 执行 `detect_changes(scope: "unstaged")`：审查了工作区修改符号，确认未超出既有在制范围，无意外破坏。

## 4. 结论与状态

- 矩阵裁决 `flywheel: done` 经源码与测试全量核实完全属实；
- 验收项：BFF 契约测试通过、观测写入路径通过、UI 真实读数与诚实空态通过、不变量（只建议不自动改变路由）严格守住；
- 全量门禁实跑：子代理本机使用 `pnpm.cmd test` 实测完整通过（2134 passed / 14 skipped / 0 failed，exit 0）；
- 最终判定：**pass**（已完整实现、核实通过、无需开发）。
