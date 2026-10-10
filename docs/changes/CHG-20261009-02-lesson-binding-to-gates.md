# CHG-20261009-02 经验绑定到已有检查入口（L01 / L08）与缺口登记

> 触发：用户授权「设定一个目标，使用你的智能体团队做完」。`CHG-20261009-01` §7「后续候选」首条写明"把 L01/L08/L11/L24 绑定到已有检查入口（低代价，建议先做）"，本变更执行该条。
> 基线 HEAD `8fb9798ae4eb36ee07226bcb60f02be4e9a9cc0e`、分支 `feature/windows-local-release`。
> **AI 参与披露**：本变更的门脚本实现由团队成员产出，正例实验、证据文件与本记录由 AI 队长撰写。人工负责目标确认、范围裁定与验收。未列 AI 为共同作者，无 `assisted-by` / `co-developed` trailer。

## 1. 需求来源

`CHG-20261009-01` 产出 `lessons.md`（L01–L24），但经验停留在散文层。本变更只做一件事：**把其中可机械化的条目，落到仓库已有的检查入口上，并用实跑证明它们有效**。

范围限定：只绑定、只验证、只登记。不修既有缺口，不统一退出码，不改产品行为。

## 2. 观察基线（改前）

| 事实 | 出处 | 结果 |
|---|---|---|
| 基线脏条目 | `git status --porcelain` | **135 个**（终态 136 = 135 + 本队新增产物） |
| 与 `-01` 记录的差异 | `CHG-20261009-01` §2 | `-01` 记 131；差 5 项归因**并行术语会话**（`.archify/`、`provider-utils.test.ts`、两份 CHG-20261007 术语记录、`ambiguity-checklist.md`、`navigation-acceptance-report.json`），**非本轮产生** |
| 门脚本规模 | `scripts/verify-gates-contract.mjs` | 68 行 / 3120B，仅 5 项检查，**只读 `ci.yml`** |
| 门清单规模 | `docs/gates.md` | 115 行；登记 12 个门名 |
| 既有 STALE | `gate-baseline-before.json` | `check:term-map`、`check:architecture` 均 **exit 1** |

**STALE 归因**：`docs/term-map.md` 的改动 mtime 为 `2026-10-07 23:21:48`，**早于本队启动 23:50**，内容为术语条目新增与「上下文收据→上下文凭证」统一；`docs/architecture.md` 无未提交改动。二者**与本变更无关**，修复未授权，**未动**。

全程零 git 写操作：未 commit、未 push、未 stash、未 reset。

## 3. 实际变更

仅两个文件：

| 文件 | 改动 |
|---|---|
| `scripts/verify-gates-contract.mjs` | 68 → 约 200 行。新增 **L01**（产交付物的入口必须有来源戳引用）与 **L08**（以 `.github/workflows/*.yml` 为事实来源对账门清单）两项检查；新增 `--strict-gaps` 开关 |
| `docs/gates.md` | 115 → 150 行，**仅追加**「门清单已知缺口（可见，不阻塞）」一节 |

配套文档（本目录）：`binding-plan.md`（可行性判定）、`binding-evidence.md`（实跑证据）、`t3-acceptance-checklist.md`、`t3-briefing.md`、`enforcement-chain-evidence.md`、`graph-gate-status.md`、`gate-baseline-before.json`。

**产品代码、共享指令、workflow、发布脚本均未改动。** 全部实验性临时改动已按 MD5 还原。

## 4. L08 的实质改进

原第 3 项检查只读 `.github/workflows/ci.yml` 一个文件。新检查**枚举全部 workflow**（`ci.yml` / `release.yml` / `graph-gate.yml` / `security.yml`），提取其执行的 `pnpm run <门名>` 与 `node scripts/*.mjs`，逐一核对是否在 `docs/gates.md` 登记。

这直接补上了原检查的结构性盲区：三条此前无人发现的漏登记路径被查出并登记。

## 5. 验收：三条判据的实跑结果

### 判据① 会触发并拦截 —— 通过

**证据来自第三次实验，前两次失败如实记录**（详见 `binding-evidence.md` §2.1–2.3）：

- **第一次失败**：临时副本方案下 `exit=1`，但输出是 `ENOENT verify-real-model-journey.mjs` —— **脚本自身崩溃，非检查报红，不构成有效证据**；补齐依赖后又出现 16 项路径缺失噪声。副本方案废弃。
- **第二次失败**：破坏方式有缺陷。`check:term-map` 在 `docs/gates.md` 出现 **2 处**（登记行 + 正文提及），全局改名造成残留干扰。
- **第三次有效**：仅删除含 `pnpm run check:term-map` 的登记行 →
  - 默认模式：缺口由 1 增至 2，输出 `GAP   CI(ci.yml) 执行了 check:term-map，但 docs/gates.md 没有登记它。`，`exit=0`
  - 同破坏 + `--strict-gaps`：`FAIL: 2 项`，`exit=1`
- **还原确认**：备份与原始文件 MD5 均为 `0301BE27AE97001F3DCF270FA7DBB62E`，还原后一致，无残留标记，复跑回到 `PASS: 1 项已知缺口`。

L01 侧：`scripts/build-release.mjs` 全文 0 处来源戳引用而被列为 GAP；对照组 `windows/build.mjs` 经 `source-stamp.mjs` 打戳判为 OK。

### 判据② 不误伤 —— 通过

- `scripts/launcher.mjs` 被**精确排除**，输出附理由：release.yml 的本地运行时冒烟测试，验证「能起来」，不判定内容质量
- `check:glossary` → `PASS`，exit 0
- `check:readmes` → `PASS: 9/9 个包 README 四段齐备`，exit 0

### 判据③ 不改变产品行为 —— 通过

- 改动仅两个文件，零 `packages/`、`apps/`、`.github/` 新增条目
- `--strict-gaps` 全部实现仅 `if (STRICT_GAPS) problems.push(...knownGaps);` 单向上推，**无少报分支**；`package.json` 与 `.github/` 中 grep 无命中，CI 现状不变

### 五门退出码前后对比

| 门 | 改前 | 改后 | 判定 |
|---|---|---|---|
| `check:gates` | 0 | **0** | 未被改坏 |
| `check:glossary` | 0 | **0** | 未受影响 |
| `check:readmes` | 0 | **0** | 未受影响 |
| `check:term-map` | 1 | **1** | 既有 STALE，归因本队之外 |
| `check:architecture` | 1 | **1** | 既有 STALE，归因本队之外 |

## 6. 不可机械化条目的处理

| 条目 | 判定 | 理由与替代 |
|---|---|---|
| **L24** 经验须绑定机械入口 | **不可机械化** | 建一个「检查散文是否被绑定」的门是**自指**的——该门本身也需被绑定，无法收敛。`report.md:156-159` 已证明文本回放不能作为判定依据。改为登记 + 触发条件索引 + 真实任务前瞻检验（超出本轮范围） |
| **L02 / L18** | **不可机械化** | 同上，不强行加检查。判定见 `binding-plan.md` |
| **L11** 状态绑定退出码 | **部分** | `docs/gates.md:85-95` 早已如实记载退出码不统一，**那是既有内容，非本轮成果**。本轮仅使其可被检查自动发现；**未统一退出码**（需逐脚本确认调用方，属独立改动） |

## 7. 缺口登记（记录现状，不假装已解决）

| 缺口 | 处置 |
|---|---|
| `build-release.mjs` 无来源戳 | **仍存在**。补戳会改动发布产物内容与元数据，需显式授权，不在本轮范围 |
| `check-import-cycles.mjs` 未登记 | 已登记。**其事实连同退出码不统一，`docs/gates.md` 既有正文早已如实记载（10-07 既有），不是本轮成果** |
| `real-model-gate.mjs` 未登记 | 同上，已登记 |
| 退出码 0/1/2 不统一 | **未处理**，已划为独立改动 |

**设计原则**：缺口进入显示路径而非被删除。为让门变绿而删掉能查出真实缺口的检查，正是 L08 本身的失败方式。

## 8. 遗留与未验证

1. **未执行任何 GitHub Actions workflow**；未重建安装器；未验证托管环境（secrets / OIDC / hosted runners）；未验证浏览器真实点击路径；未调用付费模型
2. **本次未过图谱门禁** —— 索引 stale，`--repair-fts` 失败；`cycleCount: 0` 仅代表「截至索引时刻无环」，**不构成通过**
3. **未验证经验条目的预防效果** —— 回放 21/22（无经验）vs 22/22（有经验）是**回放结果**，单次每组、合成文本、非严格盲测，**不构成预防效果证据**。验证预防效果需真实任务前瞻检验，成本高、不在本轮范围
4. `docs/changes/` 32 份记录中仅 11 份含 AI 参与披露 → **21 份历史欠账**（登记为遗留，不追溯修改）
5. `docs/gates.md:104-108` 实测基线记 103 文件 / 910 测试（2026-10-02），`PROJECT-MAP.md:381` 记 117 文件 / 1048 用例（2026-10-07）→ **落后 138 个用例**（登记为遗留，本轮不修）
6. 队长曾在途中误判 `scripts/lib/source-stamp.mjs` 路径（正确为 `scripts/release/lib/`），并三次误报文件损坏（PowerShell `Measure-Object -Line` 不计空行、`[System.IO]` 忽略 `workdir`）—— 均已核实纠正，记录在此以备复用

## 9. 回滚方法

改动仅两个文件，回滚简单：

1. `git checkout -- scripts/verify-gates-contract.mjs docs/gates.md`
2. 删除 `docs/retrospectives/mozhou-experience-20261009/`
3. 删除本文件，移除 `PROJECT-MAP.md` 中 `CHG-20261009-02` 条目

无数据迁移、无 API 变更、无产物格式变化，回滚无残留风险。**注意**：回滚会一并移除已登记的缺口说明，那三条漏登记路径将重新无人知晓。

## 10. 后续候选

补 `build-release.mjs` 来源戳（需显式授权，改产物元数据）→ 统一退出码（逐脚本确认调用方）→ 修正 `gates.md` 实测基线数字 → 接入检索 / 做成 Skill → **真实任务前瞻检验**（唯一能验证预防效果的方式）。

**经验库为参考材料，不成为新的流程权威**；与现有契约冲突时以契约为准，并追加更正说明而非改写旧结论的理由。