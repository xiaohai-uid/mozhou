# @mozhou/pipeline

章节生产管线：十步状态机、候选生命周期、定稿提交。

## Owns

- 十步管线编排（`src/session.ts`：`ChapterProductionSession`，单会话=单提交，崩溃后从步边界检查点重放）。
- 草稿候选的完整生命周期（`createDraftCandidate`、`acceptDraftCandidate`、`cancelCandidate`、`listDraftCandidates`）。
- 定稿编排（`src/commit-orchestration.ts`）与外部编辑对账。
- 提案端口（Proposal Port）：对账与管线的正典提案统一经此等待作者逐项裁决。

## Depends on

`@mozhou/context-compiler`、`@mozhou/data-plane`、`@mozhou/kernel`、`@mozhou/quality-engine`、`@mozhou/runtime`。

## Extension points

- 新增管线步：在会话状态机里加一步，并登记对应的账本任务事件。
- 步契约内联在 `src/steps.ts` 与 `src/index.ts`（本包**没有** `types.ts`）。

## Known limitations

- **204 个具名导出**（2026-10-10 实测：`src/index.ts` 里 `export {…}` / `export type {…}` 标识符去重计数），是全仓最多的包。公开面过大意味着「哪些是真正对外契约」不清晰；
  新增导出前应先确认它属于哪一层。
- 无 `types.ts`——步契约散在 `steps.ts` 与 `index.ts` 里，检索成本高。
- 取消必须覆盖操作生命周期，只改按钮无效（旧流会串到新章）。
