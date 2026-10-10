# 绑定证据：L01 / L08 落到 check:gates

> 记录：`CHG-20261009-02`。前置：`CHG-20261009-01`（经验库索引）、`t1-binding-plan.md`（可行性判定）。
> **AI 参与披露**：本文件、门脚本改动与 `docs/gates.md` 登记均由 AI 助手生成；人工负责目标确认、范围裁定与验收。门脚本实现由团队成员 evidence-builder 产出，正例实验与验收取证由队长独立实跑完成。未列 AI 为共同作者。

## 1. 绑定内容与接入点

| 经验 | 绑定规则 | 接入点 |
|---|---|---|
| **L01** 发布证据须对应构建输入 | 凡「产出交付物」的入口，其源文件必须引用 `source-stamp` 或 `sourceCommit`；未引用者列为 GAP | `scripts/verify-gates-contract.mjs`（交付物入口检查） |
| **L08** 本地绿与 workflow 须对账 | 以 `.github/workflows/*.yml` 为**事实来源**，枚举其执行的 `pnpm run <门名>` 与 `node scripts/*.mjs`，逐一核对是否在 `docs/gates.md` 登记 | `scripts/verify-gates-contract.mjs`（workflow 对账检查） |

设计要点：既有第 3 项检查只读 `ci.yml` 一个文件；新检查枚举**全部** workflow（`ci.yml` / `release.yml` / `graph-gate.yml` / `security.yml`）。

## 2. 判据① 会触发并拦截（已实跑通过）

### 2.1 实验方法与一次自我纠错

先尝试**临时副本**方案：在 `%TEMP%` 建副本目录，仅复制门脚本与其依赖文件。第一次运行 `exit=1`，但输出是 `ENOENT scripts/verify-real-model-journey.mjs` —— **这是脚本自身崩溃，不是检查报红，不构成有效证据**。补齐依赖后重跑，输出 16 项 `FAIL ... 文件不存在`，报错被路径缺失噪声淹没，仍无法干净隔离被测规则。

**结论：副本方案在真实仓库结构下不可靠，已放弃。** 改用「备份 → 破坏 → 实跑 → 还原」，全程记录 MD5。

### 2.2 实验一：破坏方法本身有缺陷（已纠正）

首次破坏把 `check:term-map` 全局改名为 `check:term-map-REMOVED`。结果 strict 模式只报 1 项，**未报登记丢失**。

原因：`docs/gates.md` 中 `check:term-map` 出现 **2 处**（第 28 行登记、第 81 行正文提及）。全局改名后 `ci.yml` 的 `check:term-map` 失去字面匹配，本应报缺，但该次运行结论受改名残留干扰，证据不成立。

> **这是实验设计的错误，不是绑定的缺陷。** 据此判定此前"检查抓不住"的怀疑为误判。

### 2.3 实验二：仅移除登记行（有效证据）

只删除 `docs/gates.md` 中含 `pnpm run check:term-map` 的那一行，其余不动。

**默认模式：**
```
  GAP   CI(ci.yml) 执行了 check:term-map，但 docs/gates.md 没有登记它。
        已知缺口：清单声称记录了全部门，实际漏了这条路径。
PASS: 2 项已知缺口（不阻塞），无新增问题。
exit=0
```
缺口数由 1 增至 2 —— **检查准确检测到登记丢失**。

**同一破坏 + `--strict-gaps`：**
```
  FAIL CI(ci.yml) 执行了 check:term-map，但 docs/gates.md 没有登记它。
FAIL: 2 项
exit=1
```

**还原确认：** 备份与原始文件 MD5 均为 `0301BE27AE97001F3DCF270FA7DBB62E`，还原后一致；`docs/gates.md` 无 `REMOVED` 残留；复跑默认模式回到 `PASS: 1 项已知缺口`。

### 2.4 L01 正例（天然成立）

`scripts/build-release.mjs` 全文 0 处 `source-stamp` / `sourceCommit` 引用，而它由 `package.json:build:release` 与 `.github/workflows/release.yml:95` 执行。检查将其列为 GAP。对照组 `scripts/release/windows/build.mjs` 通过 `source-stamp.mjs` 打戳，检查判为 OK。

## 3. 判据② 不误伤（已实跑通过）

- **`scripts/launcher.mjs` 被正确排除**，输出：`已排除：非门（release.yml 的本地运行时冒烟测试：启动应用并 curl 探活，验证「能起来」，不判定内容质量）`。检查未把所有 `scripts/*.mjs` 一律当作门。
- **`check:glossary` → `PASS`，exit 0**
- **`check:readmes` → `PASS: 9/9 个包 README 四段齐备`，exit 0**

## 4. 判据③ 不改变产品行为（已实跑确认）

- 改动仅限两个文件：`scripts/verify-gates-contract.mjs`（静态字符串判定，不执行构建、不写产物）、`docs/gates.md`（仅追加一节）。
- **零产品代码改动**：`git status --porcelain` 136 项 = 基线 135 + 本队新增产物；`packages/`、`apps/`、`.github/` 下无本队新增条目。
- **`--strict-gaps` 无绕门风险**，全部实现仅三行：
  ```js
  const STRICT_GAPS = process.argv.includes("--strict-gaps");
  if (STRICT_GAPS) problems.push(...knownGaps);
  ```
  单向上推，无对应的少报分支。`grep` 在 `package.json` 与 `.github/` 中**无命中**，CI 现状不变。
- **本文件编写期间的破坏性实验已全部还原**，MD5 一致。

## 5. 五门退出码前后对比

基线读自 `gate-baseline-before.json`，字段名为 `exit_code`。

| 门 | 改前 | 改后 | 判定 |
|---|---|---|---|
| `check:gates` | 0 | **0** | ✅ 未被改坏；新增 1 条 GAP 可见 |
| `check:glossary` | 0 | **0** | ✅ 未受影响 |
| `check:readmes` | 0 | **0** | ✅ 未受影响 |
| `check:term-map` | 1 | **1** | ⚠️ 既有 STALE，**归因本队之外** |
| `check:architecture` | 1 | **1** | ⚠️ 既有 STALE，**归因本队之外** |

**STALE 归因证据**：`docs/term-map.md` 的 13 处改动 mtime 为 `2026-10-07 23:21:48`，**早于本队启动（23:50）**，内容为新增术语条目与「上下文收据→上下文凭证」统一，与经验绑定无关；`docs/architecture.md` 无未提交改动。修复未授权，**本队未动**。

## 6. 缺口处置（记录现状，不假装已解决）

| 缺口 | 状态 |
|---|---|
| `build-release.mjs` 无来源戳 | **仍存在**。仅登记于 `docs/gates.md`「门清单已知缺口（可见，不阻塞）」第 1 条。补戳会改动发布产物内容与元数据，需显式授权，不在本轮范围。 |
| `check-import-cycles.mjs` 未登记 | 已登记。**注意**：该事实连同退出码不统一，L08/L11 的现状**早已由 `docs/gates.md` 既有正文如实记载**（10-07 既有），**不是本轮成果**。本轮仅使其可被检查自动发现。 |
| `real-model-gate.mjs` 未登记 | 同上，已登记；既有正文已有其 BLOCKED 语义与 journey 版相反的记载。 |
| 退出码 0/1/2 全仓不统一 | **未处理**。`docs/gates.md:85-95` 已将其划为独立改动，本队**未统一退出码**。 |

## 7. `--strict-gaps` 三条硬约束落实情况

1. **只能收紧不得放宽** —— ✅ 实现为单行 `problems.push(...knownGaps)`，无少报分支
2. **在 `gates.md` 写明该开关** —— ✅ 已写入「门清单已知缺口（可见，不阻塞）」小节，含开关名、默认关闭、仓库无调用方
3. **不用于本轮验收** —— ✅ 第 5 节五门对比全部采用默认模式；strict 仅用于第 2.3 节正例演示

## 8. 不可机械化条目及其处理

| 条目 | 判定 | 处理方式 |
|---|---|---|
| **L24** 经验须绑定机械入口 | **不可机械化** | 建一个「检查散文是否被绑定」的门是**自指**的（门本身也要被绑定），无法收敛。改为：登记 + 触发条件索引 + 真实任务前瞻检验（超出本队范围）。`report.md:156-159` 已证明文本回放不能作为判定依据。 |
| L02 / L18 | 不可机械化 | 同上，不强行加检查。判定见 `binding-plan.md`。 |

## 9. 没跑的（不得省略）

- ❌ 未执行任何 GitHub Actions workflow
- ❌ 未重建安装器
- ❌ 未验证托管环境（hosted runners / secrets / OIDC）
- ❌ 未验证浏览器真实点击路径
- ❌ 未调用付费模型
- ❌ 未验证经验条目的**预防效果** —— 回放 21/22（无经验）vs 22/22（有经验）是**回放结果**，单次每组、合成文本、非严格盲测，**不构成预防效果证据**
- ❌ 未统一退出码
- ❌ **本次未过图谱门禁** —— 索引 stale，`--repair-fts` 失败；`cycleCount: 0` 仅代表「截至索引时刻无环」

## 10. 诚实声明

本轮证明的是：**这两条绑定在对应场景下会报出问题、在不适用场景下不误伤、且不改变产品行为**。

本轮**没有**证明：经验条目能降低真实项目的失败率。那需要真实任务的前瞻检验，成本高、不在本队范围。