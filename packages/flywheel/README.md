# @mozhou/flywheel

策略飞轮：偏好观察、风格学习、路由建议。

## Owns

- 偏好观察与投影（`PREFERENCE_DIMS`、`ObservationKind`、`PreferenceObservation`）。
- 风格学习与漂移判定（`DRIFT_ALPHA`、`DRIFT_STREAK_MIN`）。
- 任务模型评估与路由建议（`src/evaluator/`，含 `confirmRoutingSuggestion`、`RoutingSuggestion`、`RouteChange`）。
- 容量与配额统计。

## Depends on

`@mozhou/benchmark`、`@mozhou/data-plane`、`@mozhou/kernel`、`@mozhou/pipeline`、`@mozhou/runtime`。

## Extension points

- `confirmRoutingSuggestion`：作者显式把一条 promote/demote 建议落到档位配置。**只建议不自动改路由**是硬约束。
- 评估阈值规则集（`src/evaluator/thresholds.ts`）。

## Known limitations

- **159 个具名导出**，公开面同样偏大。
- 评估器子树在 2026-09-30 已接入包的一等公开面，但**运行期仍不可达**：
  `confirmRoutingSuggestion` / `runTaskModelEvaluation` / `readSuggestions` 在生产代码中无调用方，
  也无路由、脚本或定时任务触发；`run.ts` 与 `storage.ts` 至今无测试。
  ADR-0008 的「一等子系统」定位**尚未兑现**——这是仓库自述，不是本文件的推断。
