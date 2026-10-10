# 队长侦察记录（2026-10-09）

本文件是队长在派发团队前亲自核实的事实，供 t1/t2/t3 直接引用，避免重复排查。**未经实跑的一律标注。**

## A. L01 防护已存在且生效（纠正我自己的误判）

我最初判定"`scripts/lib/source-stamp.mjs` 不存在、L01 防护失效"——**这是错的**，原因是我查错了目录。真实路径是 `scripts/release/lib/source-stamp.mjs`。

实跑证据：

```
$ node scripts/release/windows/build.mjs --print-stamp
{
  "sourceCommit": "8fb9798ae4eb36ee07226bcb60f02be4e9a9cc0e-dirty",
  "sourceCommitSha": "8fb9798ae4eb36ee07226bcb60f02be4e9a9cc0e",
  "dirty": true,
  "dirtyFiles": 132
}
exit 0
```

事实清单：
- `scripts/release/lib/source-stamp.mjs`（26 行）存在，`git ls-files` 已跟踪。
- 由提交 `1957bd1`（2026-10-08 22:37，*"fix(release): 安装器产物戳如实标注脏工作区（-dirty + dirtyFiles）"*）新增，是 HEAD `8fb9798a` 的祖先。
- `computeSourceStamp(headSha, porcelainOutput)` 是纯函数，干净/脏两个分支可直接单测，无需跑 git。
- `scripts/release/windows/build.mjs:15-22`：读戳 → `--print-stamp` 只打印退出 → 脏时 `console.warn`。
- **`sourceCommitSha` 与当前 `git rev-parse HEAD` 一致**（8fb9798a），说明脏文件计数 132 覆盖了本轮新增的三份产物与地图登记，符合预期。

**真正剩下的缺口**：脏工作区只产生 `console.warn`（第 21 行），**不阻断、不改退出码**。即 L01 属于"提示型"防护——它让产物无法冒充干净提交（这一点成立），但不会阻止把脏产物拿去交付。t1 需判定这是否满足经验要求；若需改为阻断型，必须评估对现有发布流程的影响与回滚方式。

## B. `docs/gates.md` 的实测数字已腐化，但 `check:gates` 仍 PASS（新发现，直接支撑 L08）

这是本轮最有价值的新证据，且此前未被任何记录指出。

| 位置 | 内容 | 日期 |
|---|---|---|
| `docs/gates.md:104-108` | "**103 个文件 / 910 个测试**全部通过，耗时 14.66s" | 2026-10-02 |
| `PROJECT-MAP.md:381`（CHG-20261007-18） | "`pnpm run test:packages` **117 文件 1048 用例**通过" | 2026-10-07 |
| `PROJECT-MAP.md:498`（CHG-20261007-20） | "117 文件/1048 用例" | 2026-10-07 |

即门清单的实测基线比项目地图的权威记录**落后 5 天、少 14 个文件、138 个用例**，而 `check:gates` 依然通过。

**根因**（读 `scripts/verify-gates-contract.mjs` 得出，68 行全文已读）：该脚本的 5 项检查分别是——①gates.md 提到的 `pnpm run <name>` 在 package.json 中存在；②提到的脚本路径真实存在；③`check:glossary`/`check:architecture`/`check:gates` 同时在 gates.md 与 ci.yml；④铁律「BLOCKED 不是 PASSED」在场；⑤`verify-real-model-journey.mjs` 的 `--strict` 实现与文档一致。

**没有任何一项检查实测数字的新鲜度**。这正是 L08 描述的失效模式：门清单声称记录了现状，但现状变了而门不报。

## C. L11 的现状：契约完整，退出码仍不统一（gates.md 自己承认）

`docs/gates.md:85-95` 有专门的「已知缺口」章节，明说"退出码在全仓不统一"，并给出 0/1/2 的实际分布，且明确"统一退出码是一次独立的、需要逐个脚本确认调用方的改动，**不在本轮范围内**"。

同时 `docs/gates.md:9-19` 的「一条铁律」已经写清了 BLOCKED 与 PASSED 的区分方法（优先级：读结构化产物 → 用 `--strict` → 都没有则承认无法区分）。

给 t1 的判定提示：L11 的"状态绑定机器可判定结果"在 `verify:real-model` 上**已完整实现**（`result.json` + `--strict`），缺口在**其余门未接入**。绑定应聚焦"哪些门该有结构化产物或 strict 模式"，而不是重新发明契约。

## D. 并行会话的未提交改动（不可回退）

采集基线时门禁层已有 13 个 `scripts/*.mjs` + `.github/workflows/ci.yml` 为脏。已核实 `scripts/ci-gate.mjs` 的差异仅一字：

```
- 补 lint——本地只跑 build+test 漏掉 lint，导致推送门禁在 CI 的静态检查步被拦。
+ 补 lint——本地只跑 build+test 漏掉 lint，导致推送门在 CI 的静态检查步被拦）。
```

属 CHG-20261007-20 的术语统一（门禁→门）。**不得回退**。

## E. 目录写入范围协调

本文件由队长写入 `docs/retrospectives/mozhou-experience-20261009/`。t1 计划产出 `binding-plan.md`、t2 产出 `binding-evidence.md`、t3 写 `docs/changes/` 与 `PROJECT-MAP.md`。同目录不同文件，无重叠。