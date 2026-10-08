# CHG-20261008-22 编码标准抽出：CODING_STANDARDS.md 与 AGENTS.md §7 指针化

> 触发：用户「按你推荐的来」→ 实施 GitHub 议题 [#96](https://github.com/xiaohai-uid/mozhou/issues/96)。基线 HEAD `0b71ee6`。证据分「实跑」与「读代码/文件判定」两层，逐条标注。

## 1. 需求来源

议题 #96（`ready-for-agent`）：仓库根无 `CODING_STANDARDS.md`；判断类约束住在 `AGENTS.md` §7、被每个实现代理每轮加载，而按评审纪律标准应由评审代理读取。目标：建该文件并把 §7 改为指针；边界：走 instruction-maintenance 程序，机械类违规转确定性检查而非写进标准。

## 2. 观察基线

| 事实 | 出处 | 结果 |
|---|---|---|
| 仓库根无 `CODING_STANDARDS.md` | `ls CODING_STANDARDS.md` | 不存在 |
| 评审侧会读该文件 | `.agents/skills/code-review/SKILL.md:36` | 「When `CODING_STANDARDS.md` ... exists, it **must be on the list**」 |
| 三条约束只被 AGENTS.md 自己引用 | `grep -rln "作者决定正文写入\|旧任务不能污染\|恢复必须验证作者数据"` | 命中 `AGENTS.md` 与本目录 CHG-20261008-21（迁移安全，无外部引用需同步） |
| §7 原表被每轮加载 | `AGENTS.md` §7（改前） | 三条约束以表格形式常驻 |

## 3. 实际变更

1. **新建 `CODING_STANDARDS.md`**：声明读者与触发（评审代理读全文；实现代理经 §7 触发条件进入）；只收判断类；机械类→**加检查**（已有检查以 `docs/gates.md` 为唯一权威，本文件不复制该表；尚无检查覆盖的类别是新增检查的候选）；三条约束各写「安全路径 + 硬护栏」；出处与边界（对应**领域契约**、不授权新增功能）。
2. **`AGENTS.md` §7**：原引导句 + 三行表格改为一段指针，保留触发条件（**作者数据相关改动**）、三条约束名称、范围边界与证据链接（净减 5 行，表格内容逐条迁入新文件）。
3. **`AGENTS.md` §8 附带修正**：上一轮提交（`2ecd6e9`）那行用了 `GLOSSARY.md` Part 3 禁用词「门禁」→ 改为 GLOSSARY §2.2 登记名「**自动化门**」（限定为「推送前的自动化门」）。

## 4. 验证（实跑层）

| 检查 | 结果 |
|---|---|
| `pnpm run check:glossary` | **exit 0**（活跃层无 Part 3 禁用词）——修正前为 exit 1，报 `AGENTS.md:97 使用禁用词「门禁」`（即第 3 项附带修正的动因） |
| `pnpm run check:gates` / `check:term-map` / `check:readmes` | exit 0 |
| `pnpm run check:architecture` | **exit 1（STALE）——归因并行会话，不在本变更因果范围**：生成器 `scripts/gen-architecture.mjs:14-27` 的 `countLOC` 统计 workspace 包内全部 `.ts/.tsx/.mjs/.js/.css` 的文件数与行数，而并行会话当前有约 60 个源码文件未提交改动；`docs/architecture.md` 自身未被修改（`git status` 为空），本变更未触碰任何 `.ts/.js` 文件 |
| 测试套件 | 未跑：按 `procedures/verification.md`「docs-only changes need none」 |

## 5. 双轴评审（`/code-review`，Standards + Spec 两代理并行）

**Standards 轴**（4 项，均判断类）与处置：

| 发现 | 处置 |
|---|---|
| 机器检查表与 `docs/gates.md`（自称唯一清单）重复，且无检查器保同步（Shotgun Surgery） | **已修**：删表，改为指向 `docs/gates.md` 唯一权威 |
| 受众错配：文件自称「实现代理不必加载」，但 §1–3 是面向实现者的硬护栏，迁出后不在任何必加载层 | **已修**：§7 指针恢复触发条件（作者数据相关改动），新文件声明实现代理经该触发进入 |
| `:40` 裸用「契约」（GLOSSARY Part 3 第 492 行列为禁用，应作 BFF 契约／领域契约） | **已修**：改为「领域契约」 |
| `check:glossary` 的 `ACTIVE_FILE` 白名单不含根级 `CODING_STANDARDS.md`，故本文件术语合规不在机器覆盖内 | **未修（记为缺口）**：该脚本正被并行会话改动（+48 行 Part 3 检查），未介入他人在制文件 |

**Spec 轴**（无实质缺失）与处置：§8 术语修正属范围蔓延（**保留并披露**：术语门红，且那行本就是本会话上一轮写的）；机械类清单写入「术语用词」超出票据边界（**保留**：与仓库既有 `check:glossary` 一致）；「导入形状／文件位置无对应检查」导致宣称与现状不符（**已修**：改写为「新增检查的候选」）；无变更记录（**本次即补**）。

## 6. 未做与未验证（如实）

- `CODING_STANDARDS.md` 不在 `check:glossary` 的 `ACTIVE_FILE` 白名单内（该文件正被并行会话改动，未介入）。该文件目前按 GLOSSARY 人工合规书写，**机器覆盖缺口**建议由术语线补一行 `ACTIVE_FILE`。
- 「评审代理会真的读本文件」只有**文件/引用一致性**证据（技能规定 + §7 指针），**实际加载与服从未验证**（`procedures/instruction-maintenance.md` 要求区分二者）。
- `check:architecture` 的 STALE 由并行会话造成，未修（修它会把他人未提交改动固化进生成物）。

## 7. 回滚

`git revert <本提交>`；或删除 `CODING_STANDARDS.md` 并把 `AGENTS.md` §7 指针还原为原表格（原文见本提交的 diff）。

## 8. 并发说明

工作区另有并行会话的 123 项未提交改动（术语统一／歧义裁决），本次用精确暂存只提交本变更文件，他人改动一字未动、未暂存。
