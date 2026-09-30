# mozhou-pre-push-checks

push 之前的手动检查清单。lefthook 只跑机器能跑的"快检查"，
这份是人 / AI 在 push 前必须逐项过的。

## 检查项（有一项不过就停下修，不许"先推上去再说"）

1. **分支正确**：当前分支是 `feature/*`，基于 `develop` 拉出；PR 目标是 `develop`，不是 `main`
2. **三件套真实跑过**（UVSD §5.19）：`pnpm build`、`pnpm test`、相关 typecheck 都已执行且通过，不许"应该没问题"
3. **影响面确认**：GitNexus `detect_changes()` 确认改动只影响预期符号和执行流；HIGH / CRITICAL 风险先报告用户再继续
4. **工单边界**：diff 只包含当前工单的内容；跨工单的顺手改动拆出去另起分支
5. **契约变更**：动了契约必须有 Contract Delta（schema + mock + 实现 + 测试同步更新）
6. **提交信息**：Conventional Commits 八类前缀（feat/fix/docs/style/refactor/perf/test/chore）；单次提交同一类别、问题不超过 3 个
7. **无秘密**：没有 API key、token、私钥进仓库（`.gitleaksignore` 是最后防线，不是常规手段）
8. **文档同步**：用户可见的行为变更，`CONTEXT.md` / README / 对应文档是否同步更新；有架构取舍是否写了 `.agents/notes/`

全部通过才能 push。
