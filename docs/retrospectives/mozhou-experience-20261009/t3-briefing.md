# t3 派发简报：终验收、变更记录与地图登记

> 队长编写，供 map-keeper 接手 t3 时直接使用。所有事实均由队长**独立实跑**得出，不是转述成员自报。
> 判据全文见 `t3-acceptance-checklist.json`（同目录）。本简报是它的执行版说明。

## 你的写入范围（严格限定）

| 可写 | 不可写 |
|---|---|
| `docs/changes/CHG-20261009-02-*.md` | `scripts/**`（t2 的） |
| `PROJECT-MAP.md`（仅在末尾追加） | `docs/gates.md`（t2 的） |
| 本目录下的验收记录文件 | `docs/retrospectives/**/binding-evidence.md`（t2 的） |
| | `packages/`、`apps/`、`.github/` |

**全程零 git 写操作**：不 commit、不 push、不 stash、不 reset、不 checkout。

## 你要分配的编号

`CHG-20261009-02`。`-01` 已用于经验库索引，其记录文件已存在：
`docs/changes/CHG-20261009-01-mozhou-experience-library.md` —— **它是你的格式范例**，请照其结构写。

## 验收十项（逐项给 passed / failed / blocked / unverified，不得整体打勾）

队长已独立实跑并给出观测值的项，你要**自己复跑确认**，不能只引用队长结论：

| 项 | 队长观测 | 你要做的 |
|---|---|---|
| A1 check:gates exit 0 | ✅ 00:17/00:20 两次 exit 0 | 复跑确认 |
| A2 glossary/readmes exit 0 | 基线 0 | 实跑 |
| A3 term-map/architecture STALE 归因 | 队长已证：term-map.md 改动 mtime 10-07 23:21:48，**早于本队启动 23:50** | 复核即可，**不得修复** |
| **A4 缺口持久登记** | ✅ 三条已登记 | 复核。**未登记则不得判 pass** |
| A5 并行会话改动保留 | ✅ `门禁` 计数 0 | 复核两份文件 |
| **A6 触发用例实跑** | 待 t2 | **阻断项**，binding-evidence.md 必须含 |
| A7 不误伤 | launcher.mjs 正确排除 | 复核证据文件 |
| A8 不改产品行为 | 仅改两个文件 | 实跑 `git status` 对比基线 135 项 |
| A9 图谱门如实报告 | **本次未过图谱门禁** | 照抄 `graph-gate-status.md`，**不得写成已通过** |
| A10 变更记录与地图登记 | 你的主职责 | — |

## 四条不可越界的红线

1. **不得为让门变绿而删除任何检查或缺口登记。** 这是 L08 本身的失败方式。
2. **不得修改 check:term-map / check:architecture 的既有 STALE**，也不得算作本轮成果。
3. **不得声称经验条目的预防效果已验证。** 回放 21/22 vs 22/22 是回放结果，不是预防效果证据。
4. **不得以成员自报代替独立实跑。**

## 变更记录必须包含

按 `CHG-20261009-01-mozhou-experience-library.md` 的结构，另加：

- **AI 参与披露**（契约《AI 参与编码的责任边界》）：说明 AI 参与了产出，不列 AI 为共同作者，不加 `assisted-by` / `co-developed` trailer
- **不可机械化条目的处理方式**：L24、L02、L18 判定为不可机械化的理由与替代手段（引用 `binding-plan.md` 的判定即可，但需说明为何「建一个检查散文是否被绑定的门」是自指的）
- **回滚方法**
- **图谱门状态**：如实写「本次未过图谱门禁」，并说明 `cycleCount: 0` 仅代表「截至索引时刻无环」

## 两条遗留，不是本轮成果

登记为遗留即可，**不要修**：

- `docs/changes/` 32 份记录中仅 11 份含 AI 披露 → 21 份历史欠账
- `docs/gates.md:104-108` 实测基线记 103 文件/910 测试（2026-10-02），而 `PROJECT-MAP.md:381`（2026-10-07）记 117 文件/1048 用例 → 落后 138 个用例