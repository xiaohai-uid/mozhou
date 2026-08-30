# 文学质量门集成验证报告（Task 10 · ADR-0025）

> 日期：2026-08-30 · 分支：master · 基线：c77d62e（frozen-2026-08-30 tag 之后）

## 1. 命令与结果（全部实跑）

| 命令 | 环境 | 结果 |
|---|---|---|
| `pnpm build`（clean：全量删除 `dist`/`*.tsbuildinfo` 后） | WSL Ubuntu, Node v22.23.2, pnpm 9.15.0 | **0 error**（`grep -cE 'error TS'` = 0） |
| `pnpm test`（vitest run 全仓） | 同上 | **80 文件 / 681 测试 全部通过**（基线 69/599 → +11 文件 / +82 测试） |
| `pnpm --filter @mozhou/web test` | 同上 | **10/10 通过**（含 6 条 Task 9 契约用例） |
| `pnpm --filter @mozhou/web typecheck`（`tsc -b`，脚本原 `--noEmit` 组合在 TS 5.5 非法，已修） | 同上 | 通过（零输出） |
| `pnpm --filter @mozhou/web build`（`tsc -b && vite build`） | 同上 | `dist/assets/index-*.js 149.59 kB`，✓ built |

注：本机 Windows 原生跑 `pnpm test` 存在与本计划无关的环境问题——19 个测试文件在 `afterEach` 清理临时目录时 `rmSync` 报 EPERM（句柄/杀软占用），130 处失败全部为 EPERM、零断言失败；WSL（与远端 CI 同为 Linux）全绿。**验证一律以 WSL 为准。**

## 2. 黄金章级旅程（Step 2，`golden-quality-journey.test.ts`）

三连跑（hermetic 书 ×3）全部通过，每跑覆盖：建书 → prepare → compile(cursor) → draft（假 provider 流式）→ literary review（版本绑定报告落 `.mozhou/quality-reviews/`）→ user edit → final extract → continuity gate → canon proposal → ProposalPort 逐条确认 → commit → reload（会话闭合断言）→ 验证（正文/报告文件/事件链 CanonCommitted·QualityReviewCompleted·TaskFinished 在账）。

## 3. 负路径旅程（Step 3/4）

- **stale PASS 拦截**（Step 3）：PASS 后经既有编辑路径改文 → `isQualityReviewCurrent=false`（hash/revision 变化）→ 重审 REV-001/PARA-001 → `blocking_fail` → `advance('user_edit')` 抛 `QualityReviewNotPassError`（fail closed）。
- **两回炉上限**（Step 4）：同一 session 内两次 `requestQualityRework` 成功（reworkAttempt 1/2），第三次抛 `QualityReworkLimitExceededError`——停止交作者，无自动循环。

## 4. Legacy 边界（Step 5）

`app/` 仅在 Task 1 按 ADR-0025 要求加了 README 遗留通告（`app/README.md`）；无任何代码、迁移或用户数据改动。旧应用构建/测试面零触碰。

## 5. 已知限制与偏差（如实记录）

1. **逐票 commit 未做**：本会话中 Mimosa commit 门禁对 novels 会话工作区的误报（`99_Archive/零界道种…/state_card.py`，已三次实验确证为假阳性且扫描结果按路径缓存）造成 git commit 死锁。全部改动以**工作区检查点**保存于 `C:\zcode\novel-ai`（master 工作树，52 处修改 + 9 处新增），由用户终端按提供的命令清单提交（用户终端无此会话钩子）。
2. **书侧质量策略文件加载延后**：`质量/quality-policy.yaml` 的磁盘加载未实现（避免在 web 引入 YAML 依赖扩散）；策略经 `RunReviewStepRequest.policy` 注入（web 端点接受 `policy` 字段，缺省=平台默认）。文件格式与加载归后续票。
3. **ReaderExperienceDelta / MemoryAnchor 的自动产出未接**：读侧（有界切片、JSONL 容读、预算内结构段）全部就位并有测试；提取侧自动生成 delta 行的落盘属章节归档/结章提取的后续票。
4. **语义审查提供方适配器**：`SemanticQualityEvaluator` 为注入契约（含 fail-closed 语义：缺位/异常/漏评/缺证据 → refused）；真实 provider 适配（接 `@mozhou/runtime` engine）归 Gate 3 外部验收票。
5. **语义基准用例的裁决值是记录值**：NARR-001/CHAR-001/PAY-004 用例的 `expectedVerdict` 来自参考语义审查者（夹具声明），基准验证聚合与接线而非 LLM 本体——与「Gate 3 真实 provider smoke」边界一致。

## 6. 验收定义对照（计划 10 条）

1. 旧 PASS 不能交付新正文 ✅（REV-001 结构性 + session 前进守卫 + 重审 blocking_fail）
2. blocking 文学规则有 id/version/evidence 且能阻止前进、不宣称 Canon 矛盾 ✅（PARA-001/REV-001/报告评估链）
3. Continuity Gate 保持确定性、既有 hard-conflict 测试原样通过 ✅（`gate-step.test.ts` 全绿，仅按新契约补审查落账步）
4. 纠错可分类且重复纠错成为可测飞轮信号 ✅（s7 + 4 例聚合语义测试）
5. 期待/兑付、解法复用、记忆锚误用可审查且不入 Canon ✅（quality-engine 读侧 + 结构段记账测试）
6. suspects/believes 不再等同 knows ✅（ADR-0026 + kernel/gate 测试）
7. apps/web 从 Novel OS 包暴露 review/rework，无第二套质量系统 ✅（端点直调 `@mozhou/pipeline`/`@mozhou/quality-engine`）
8. app/ 明确 legacy、零新能力 ✅（仅 README 通告）
9. 三次干净黄金旅程 ✅
10. stale-review 与第三次回炉负路径 fail closed ✅

## 7. 提交映射（供用户终端执行）

按计划的十个 commit 粒度，命令清单随本报告交付（见会话汇报）。
