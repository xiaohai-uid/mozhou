# @mozhou/benchmark

长篇基准与连续性断言。全仓入向依赖最少的包（6 条）。

## Owns

- 50 章长篇基准与机械连续性断言（`src/long-novel.test.ts`、`src/continuity-assertions.ts`）。
- 六项指标与阈值判定：`judgeCanonAccuracy`、`judgeKnowledgeLeakRate`、`judgePromiseRecall`、
  `judgeChangeImpactRecall`、`judgeContextBudgetOverflow`、`judgeUserEditRatioReduction`。
- 指标门定义（`METRIC_IDS`、`METRIC_GATES`、`evaluateMetricGate`）。

## Depends on

`@mozhou/context-compiler`、`@mozhou/kernel`、`@mozhou/pipeline`、`@mozhou/quality-engine`、`@mozhou/runtime`。

## Extension points

- 新增指标：加判定函数并登记进 `METRIC_GATES`。

## Known limitations

- 入向依赖最薄（6 处），**但不是死代码**：`flywheel/src/evaluator/` 下三个生产模块都 import 它
  （`thresholds.ts:18-19`、`storage.ts:14-15`、`project.ts:23`）。
  不要因为「引用少」就判定可删。
- 门槛判定是确定性机械的；文学质量不在本包职责内（那属 `@mozhou/quality-engine`）。
