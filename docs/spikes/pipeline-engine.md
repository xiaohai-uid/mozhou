# Spike: 管线引擎状态机（Pipeline Engine Reducer）

- **日期**: 2026-08-09
- **风险类型**: 技术可行性（LLM 输出结构化 + 校验重试 + 记账语义）
- **分支**: `prototype/pipeline-engine`（`prototype/pipeline-engine.prototype.html`）
- **结论**: ✅ 可行，已并入主线（`lib/pipeline/`，04/05/06 工单使用）
- **Reproduction**: 原型 HTML 保留于 `prototype/pipeline-engine.prototype.html`（git 历史可随时回放）

## 探针问题
对话管线需要：LLM 输出 → JSON 校验 → 失败自动修复重试 → Token 记账，且记账不能污染语义。

## 关键决策（已验证，勿重复研究）
1. **reducer 纯函数状态机**：`initialState → start → llmResult → validateOk/validateFail → ok/failed/aborted`。所有动作经 reducer 派生，可测试、可回放。
2. **verdict 语义（最重要）**：`meter` 动作仅当任务处于 **running** 态时记账；非 running（ok/failed/aborted）完全忽略 meter —— 防止"校验失败重试的中间 LLM 调用"污染最终账本。
3. **校验失败自动重试**：`maxRetries=3`，`lastError` 回传给 provider 用于修复提示，重试次数计入预算。
4. **budget 上限**：超预算立即 abort，避免失控调用。

## 验证证据
- `app/tests/unit/pipeline.test.ts`（14 用例）+ `pipeline-stream.test.ts`（7 用例）覆盖 reducer 全分支
- 契约测试 `tests/http/chat.test.ts` 的 SSE 全链路（start/delta/done/error）基于该状态机

## 相关
- [[LingBi]] 无；本项目主线 `lib/pipeline/{engine,reducer,validate}.ts`
- 归档：V1.0 已随 `v1.0.0-release` 冻结
