# CHG-20261008-28 删除陈旧发布前核验脚本（议题 #101）

> 触发：GitHub 议题 [#101](https://github.com/xiaohai-uid/mozhou/issues/101)。基线 HEAD `e242832`。

## 1. 需求来源

议题 #101：`scripts/release/release-verify.mjs` 是 2026-09 恢复期脚本，断言指向已结束的分支与 handoff 路径，且没有任何调用方；要求**删除**或重写为当前有效的发布前检查。

## 2. 观察基线（改前）

| 事实 | 出处 | 结果 |
|---|---|---|
| 陈旧断言 | `scripts/release/release-verify.mjs:24-27` | 检查 2 要求分支 `codex/mozhou-full-release-20260915`；检查 3-5 指向 `C:/codex/handoffs/mozhou-recovery-20260917/…` |
| 无调用方 | `grep -rn "release-verify"`（json/yml/mjs/ts） | **无代码引用**（命中仅 docs/changes 记录与生成物 `codeGraphData.json` 的符号快照） |
| 未被发布路径调用 | `.github/workflows/release.yml` | 不调用它；`pnpm package:windows` 也不经过它 |

## 3. 实际变更

1. **删除 `scripts/release/release-verify.mjs`**——其 5 项检查全部失效（分支断言指向已结束的恢复期、handoff 路径不存在、证据目录判定与当前仓库无关），保留只会给人「发布前有干净检查」的错觉。
2. **其唯一的历史增量已逐字保留**：并行会话（术语统一线）在该文件里有一处**未提交的注释措辞改动**，随删除消失，原文记录如下以免静默丢弃：

```
- * - 发布前以工具重新读取候选 commit、版本、manifest、测试与门禁状态；
+ * - 发布前以工具重新读取候选 commit、版本、manifest、测试与门状态；
```

（即「门禁 → 门」的术语替换。该文件被删除后此改动已无对象；如需追溯可从本记录或 `git show e242832:scripts/release/release-verify.mjs` 取回。）

## 4. 当前发布路径的核验落点（替代关系，避免「删了就没人管」）

| 原脚本想核验的 | 现在的落点 |
|---|---|
| 候选 commit / 版本一致 | `scripts/release/windows/build.mjs` 的产物戳（脏工作区标 `-dirty`，见 CHG-20261008-21）；`release.yml` 的 `workflow_dispatch` 输入 `sourceCommit` |
| 测试全绿 | `release.yml` 的 `pnpm test` 与 `pnpm --filter @mozhou/web test` 步骤 |
| 图谱 clean、0 循环 | 本地 `pnpm graph:check`（AGENTS.md §8 登记）+ 新增 `.github/workflows/graph-gate.yml`（CHG-20261008-27 静态导入环检测） |
| 门状态 | `release.yml` 的 audit / build / lint / typecheck / 文档门步骤 + 真实模型发布门（CHG-20261008-25） |
| 证据链闭环 | `docs/gates.md` 的结构化产物约定（`evidence/real-model-journey/<RUN_ID>/result.json`） |

## 5. 验证（实跑层）

- `grep` 复查：仓库内除 `docs/changes/` 记录外无 `release-verify` 引用（生成物符号快照除外，属数据不是调用）。
- 删除后 `git status` 该文件为 `D`（已暂存删除），无其它文件受影响。

## 6. 未做与未验证（如实）

- **未重写为新的核验脚本**：当前发布路径已由 `release.yml` + `graph-gate.yml` + 产物戳承担核验，再写一个平行脚本没有增量价值。若将来需要「发布前一键核验」，应写成对 `release.yml` 步骤的本地封装（`scripts/ci-gate.mjs` 已是同类入口）。
- **本删除丢弃了并行会话的一处未提交注释改动**（已逐字记录，见 §3）。判定依据：该工作线已**停摆约 25 小时**（其 123 个在制文件最后修改于 2026-10-07 23:26），且该改动所在文件正是本票要删除的对象，删除后该改动失去意义。
- 未验证：`release.yml` 在 GitHub 上的真实执行（本地无法运行 Actions）。

## 7. 回滚

`git revert <本提交>`，或 `git checkout HEAD~1 -- scripts/release/release-verify.mjs`。
