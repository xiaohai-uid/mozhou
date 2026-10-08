# CHG-20261008-24 AGENTS.md 沉积清理（§0 叙事与 CLAUDE.md 重复）

> 触发：GitHub 议题 #97（用户授权）。基线：工作区 `AGENTS.md`/`CLAUDE.md` 均 clean（并行会话改的是其他文件）。证据分「实跑」与「读文件判定」，逐条标注。

## 1. 需求来源

议题 #97：把 `AGENTS.md` §0 的「2026-10-01 裁决」叙事压成指向 `docs/adr/` 的指针；处置只承载 GitNexus 自动块的 `CLAUDE.md`；压缩已定案的「已更正／已废止」注记；信息不得丢失。

## 2. 观察基线（改前）

| 事实 | 出处 | 结果 |
|---|---|---|
| §0 含六线归属表 + 优先级规则 | `AGENTS.md`（HEAD）7–27 行 | 21 行叙事，每轮占上下文 |
| 裁决已有 ADR 承接 | `docs/adr/0031-single-workflow-authority.md` | 六线裁决 + §1–§8 优先，逐条在册 |
| `CLAUDE.md` 全文 = 同一自动块 | `git show HEAD:CLAUDE.md` | 44 行，与 `AGENTS.md` gitnexus 块逐字相同 |
| 有脚本按路径引用 `CLAUDE.md` | `scripts/verify-glossary.mjs:106` | `ACTIVE_FILE` 含 `CLAUDE.md`，存在即 `readFileSync` |
| 三处「已更正」+ 一处「已废止」 | `AGENTS.md` 86/109/115 行 | 均已定案（ADR-0032/0034；`docs/agents/domain.md` 已含 single-context 历史注记） |
| 行数 | `git show HEAD:<f> \| wc -l` | `AGENTS.md` 160、`CLAUDE.md` 44 |

## 3. 实际变更（仅两文件，均为工作区改动，未提交）

- `AGENTS.md` §0（原 7–27 行 → 现 7–9 行）：六线归属表与优先级规则压成一段，保留单一权威、§1–§8 优先、三条降级线及其目录（`.specify/`/`specs/`、`docs/superpowers/`、`.zcode/workflow-drafts/`），并指向 [ADR-0031](docs/adr/0031-single-workflow-authority.md)、`GLOSSARY.md`、`docs/adr/INDEX.md`。
- `AGENTS.md:68`：§7「已废止」注记 → 一句「已更正」，保留原值（本地 issues 目录、「遗留切片」、OB `10_Projects/墨舟.md`）与依据（`GLOSSARY.md` Part 2、ADR-0032/0034）。
- `AGENTS.md:91`：§9 Triage labels 注记 → 一句，保留「已更正」事实与 `docs/agents/triage-labels.md`。
- `AGENTS.md:97`：§9 Domain docs 注记 → 一句，保留 `CONTEXT-MAP.md`／`ADR-0007` 误引已修正的事实。
- `CLAUDE.md`：44 行自动块 → 1 行指针（指向 `AGENTS.md`）。**不删**：`verify-glossary.mjs` 按路径引用它，删除会使该门在本文件仍被 git 跟踪时 `readFileSync` 抛错。

## 4. 验收

- `AGENTS.md` 160 → 142 行；`CLAUDE.md` 44 → 1 行；两文件合计 204 → 143 行（省 61）。
- 四条命令实跑退出码：`check:glossary`=0、`check:gates`=0、`check:term-map`=0、`check:readmes`=0。
- 术语：新增文本无 Part 3 禁用词；「遗留切片」仅出现于 §7 更正句（`verify-glossary.mjs` 白名单 `AGENTS.md|遗留切片` 内）。

## 5. 验证状态与遗留

- 已执行：四条命令实跑（退出码见上）；`git show` 前后行数核对。
- **未验证**：`check:architecture` 因并行会话源码改动为 STALE，本轮未跑、未修；GitNexus 下次 `analyze` 是否会用完整自动块覆写 `CLAUDE.md` 的指针未验证（工具行为，超出本变更范围）。
- **待办（非本文件范围）**：`PROJECT-MAP.md` 的 CHG 索引行由主会话补录（该文件正被并行会话修改，本变更未触碰）。

## 6. 收口修正（主会话，2026-10-08）

子代理把「`CLAUDE.md` 下次 `analyze` 是否会被覆写」列为**未验证**；主会话读了工具实现，结论是**会被追加**，并据此改了实现：

- **工具行为（读源码判定）**：`gitnexus/dist/cli/ai-context.js` 的 `upsertGitNexusSection`（:180-252）——文件不存在 → 创建；**有标记** → 原地替换（若块内含 `<!-- gitnexus:keep -->`，则只刷新统计行、保留用户布局，或 `preserved` 不写）；**无标记** → `// Append new section`（:248-251）把完整自动块**追加**到文件末尾。故子代理交付的「1 行纯指针」在下次 `analyze` 后会被追加成「指针 + 完整块」，去重不持久。
- **修正后实现**：`CLAUDE.md` 改为工具支持的精简块——`<!-- gitnexus:start -->` + `<!-- gitnexus:keep -->` + 一行指针 + 统计行 + `<!-- gitnexus:end -->`。`keep` 路径下工具只刷新统计行（`Indexed as **mozhou** (…)`），指针行与用户布局保留。
- **行数**：`CLAUDE.md` 由子代理交付的 1 行变为 5 行（仍远低于原 44 行）。
- **仍未验证**：下一次真实 `gitnexus analyze` 的实际写入结果（读源码判定为保留，未实跑一次 analyze 验证——analyze 会重写共享索引，避免在并行会话在制时运行）。
