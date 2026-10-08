# CHG-20261008-23 Mimosa 扫描不完整时的处置决策（ADR-0036）

> 触发：用户「按你推荐的来」→ 实施 GitHub 议题 [#95](https://github.com/xiaohai-uid/mozhou/issues/95)。基线 HEAD `5dbec47`。

## 1. 需求来源

议题 #95（`needs-triage`）：提交门禁恒 INCONCLUSIVE；要求「二选一并把决策写进项目文档：①修缓冲后切 `strict`；②显式长期接受 advisory，并写清后果与复核方式」。

## 2. 决策落点选择

仓库 `docs/adr/INDEX.md` 开篇写明「**一个事实只有一个家**：决策只在这里和它指向的 ADR 文件里，不出现在 `GLOSSARY.md`、`AGENTS.md`、`docs/architecture.md`」。安全姿态属决策，故落在 **ADR**，而非变更文档或指令文件。

## 3. 实际变更

1. 新增 `docs/adr/0036-commit-time-security-scan-advisory.md`（合并系列下一个自由号 `0036`）：记录两条路径的实测差异（钩子恒 `scanner_enobufs` vs MCP 路径 `completeness: complete` 919/919）、插件三个旋钮、决策（保持 `open`=advisory）、后果（**不得宣称项目安全**）、切 `strict` 的两个触发条件、以及复核方式（发布审计必须写明扫描完整性；缺结论即 `unverified`）。
2. `docs/adr/INDEX.md`：合并系列范围 `0008–0035` → `0008–0036`（编号规则表与清单标题两处）+ 新增 `0036` 行。

## 4. 验证（实跑层）

| 检查 | 结果 |
|---|---|
| `pnpm run check:glossary` | 见提交前实跑（ADR 引用不新增裸号 0001–0007，预算 54/54 不受影响） |
| `pnpm run check:gates` / `check:term-map` / `check:readmes` | 见提交前实跑 |
| 事实核对 | 决策所依据的两条路径证据均为本次会话实跑/实读：钩子错误 3 次、`coverage.json` 字段实读 |

## 5. 未做与未验证

- **未切 `strict`**：属安全姿态变更，ADR 明确其触发条件；本轮不动环境变量。
- **未修扫描器缓冲问题**：属上游/环境，ADR 只定义「不完整时怎么办」。
- `docs/adr/INDEX.md` 的「挂账项」表未改（其中第 3 项 `.mimosa/hook-state/` 保留期约 953 MB 的处置仍未决，与本 ADR 无关，属独立挂账）。

## 6. 回滚

`git revert <本提交>`（删除 ADR-0036 并还原 INDEX 两处范围与一行清单）。

## 7. 并发说明

工作区另有并行会话的在制改动（术语统一/歧义裁决），本变更用精确暂存只提交本变更文件。
