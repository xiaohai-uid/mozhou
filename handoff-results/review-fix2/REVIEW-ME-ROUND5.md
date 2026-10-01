# 墨舟第四轮返修 · 第五轮交回包（review-fix2）

范围：**仅外部测试装置 + 本报告**。产品代码一行未改；真实模型调用 0 次；未实现停止按钮；未提交 / 未推送 / 未部署。

---

## 0. 一句话

Codex 第四轮复核提出的 4 条全部核实为真并已修复；新增 25 项离线测试，**修前 14 项红 / 修后全绿**，原 52 项保持 52/52。
同时**主动更正第四轮报告里两处说反的事实**（旧账本到底有什么、10:23 原始帧是否可得）——这两处正是本轮返修要求的第 1 条。

## 1. 本轮修的 4 条（对应 Codex 四条发现）

### 1.1 P1 过期锁：默认 fail-closed，不按年龄删活锁

| 项 | 修前 | 修后 |
|---|---|---|
| 取锁 | `mkdirSync` 失败后看 mtime，>30s 就 `rmSync` 强删 | `mkdirSync(lock)` 原子创建，**EEXIST 就等**，超时抛 `LOCK_TIMEOUT`；**代码里没有任何按年龄删除的路径** |
| 锁的身份 | 只有目录，没有主人 | 锁目录内写 `owner.json {token,pid,host,acquiredAt}` |
| 释放 | `finally { rmSync(lock) }` —— 谁都能删别人的锁 | `releaseLock(ticketDir, token)`：token 不匹配抛 `LOCK_NOT_OWNER` 且**不删** |
| 显式恢复 | 无 | `reclaimLock()`：仅当 `ownerProcessAlive() === false` 才删；判不出（跨主机/不可验证）返回 `null` → 拒绝恢复 |

实测（`harness/tests/audit-red.test.mjs` T15，两个真实进程，额度 1，把锁 mtime 拨回 31 秒前）：

```
修前：父进程 elapsed=2ms 就拿到锁并发出请求   ← 直接夺锁
修后：父进程 elapsed=2491ms，等活锁释放后才进临界区
```

> 复现说明（重要，不夸大）：Codex 脚本里「A 暂停在临时账本写入前」需要把暂停注入到旧实现的临界区内部；
> 我没有改被测实现，而是用**两个真实进程 + 时钟拨旧 31 秒**复现同一类违规（活锁被夺、请求在别人临界区内发出）。
> 旧实现那条「两条 reservation.seq 都是 1、最终 used=1」的具体终态，我没有复现出来 —— 需要往旧实现里插注入点，我没有做。

### 1.2 P1 `initLedger` 重置消耗

- 重复 `initLedger`（同参）**幂等**，保留已有 `spend`；异参拒绝：`ALLOWANCE_CONFLICT` / `TICKET_CONFLICT`。
- 初始化与占用**走同一把互斥锁**（同一个 `withLock`），删掉了原先「先 `existsSync` 再 `init`」的检查-使用竞态。
- 改额度只能走显式 `amendAllowance()`，且**只许增不许减**（`ALLOWANCE_DECREASE_FORBIDDEN`）。
- 新增 `ticket-registry.json`（`<STAGE>/.state/ticket-registry.json`）：同一工单换目录重开 → `TICKET_RELOCATED`，堵死「搬走账本重获额度」。
- v1 → v2 只能走显式 `migrateLedgerV1toV2()`，**不退款**；runner 遇到 v1 会显式迁移而不是重置。

### 1.3 P2 账目按 attemptId 关联，不再按 .ndjson 文件计数

- 账本 schema v2，每条 `spend` 行必带 `attemptId`；`attempts.jsonl` 追加 `started` / `terminal` 事件。
- `spendRealCall` 在**同一把锁内**同时写 `spend` 行和 `started` 事件。
- 帧文件降级为「内容证据」：按 sha256 去重，同内容副本不增加次数。
- **首帧前抛异常**照样有 `terminal` 事件，照计一次（`transport.mjs` 的 catch 路径也写 terminal，全文件无退款分支）。
- 进程中途被杀（有 `started` 无 `terminal`）→ 结果标 **UNKNOWN**，不静默丢。
- `validateLedger` 要求每条 `spend` 都有 `attemptId`、reservationId 唯一。

### 1.4 报告口径

`harness/make-ledger.mjs` 改为导出 `buildLedgerReport()`，跑出**本装置尝试 / LEGACY 历史 / 双向对账**三段，并显式区分：

> 「请求尝试」≠「已核实的真实供应商调用」。

## 2. 本轮**主动更正**第四轮报告的两处错误（Codex 第 1 条要求）

| 第四轮报告的说法 | 实际（我已直接读旧文件核对） |
|---|---|
| 「旧 calls.json 抄了 10:23 那一跳、漏了 10:15 的 429」 | **说反了**。旧 `handoff-results/calls.json` seq1 就是 10:15 的 429，seq2 是 10:16 的 302。漏记的是 **10:23:54 / 224 字 / 38972ms** 那一条 |
| 「10:23 的原始帧不可得」 | **说反了**。`handoff-results/artifacts/context-chapter2.frames.ndjson` 仍在，172 帧、170 个 delta、224 字、candidateId `1bb7d37b-5b0f-4349-b1c4-9de9930e154a` |

## 3. 历史账目：10 个请求尝试（此前记 9 个）

完整表格见 `evidence/runs-ledger.md`，此处只给口径：

- **10 个请求尝试**，其中端点身份 **KNOWN_REAL 只有 2 条**（10:15 与 10:28:46 两次 429，错误体 `429003` 是公网供应商自己的限流码）；
- 其余 **8 条一律 UNKNOWN**。

**统一端点判据**（第四轮报告的问题正是「对 B 拒绝用耗时/provider 判断，却对其他条目用同样依据标 KNOWN_REAL」）：

| 证据 | 判定 |
|---|---|
| 供应商自身错误体（`429003` 等） | `KNOWN_REAL` |
| 只有耗时 / start 帧 provider 字符串 / 旧 harness 自报行 | `UNKNOWN`（这三者对本地替身同样成立） |

补上的第 10 条：

> seq 6 · `2026-09-30T10:23:54Z` · B 阶段 · done · **224 字** · **38972ms** · candidate `1bb7d37b-5b0f-4349-b1c4-9de9930e154a`
> 现存证据：`handoff-results/artifacts/context-chapter2.frames.ndjson`（172 帧）+ `artifacts/phase-b.json`
> 端点身份：**UNKNOWN**（原始帧在，但 start 帧 provider 串与替身取值相同，且该次运行没记 channel）

## 4. 测试：修前 / 修后

| 套件 | 修前 | 修后 | 退出码 |
|---|---|---|---|
| 原 52 项 `offline-budget.test.mjs` | — | **52/52** | 0 |
| 新增 25 项 `audit-red.test.mjs` | **14 红** | **25/25 绿** | 修前 1 / 修后 0 |

同一份 `audit-red.test.mjs` 用 `MOZHOU_LEDGER_IMPL` 指向 `.baseline-round5`（第四轮原件）即得「修前红」；不指向即得「修后绿」。
证据：`evidence/tests/logs-red-BEFORE.log`、`logs-red-AFTER.log`、`artifacts-audit-red.json`。

修前红例中最有代表性的三条：

```
T15  锁被拨旧 31 秒后不得夺锁        elapsed=2ms（直接夺锁）
T16  重复初始化后消耗保持不变        used 1 -> 0（被重置）
T16  初始化/占用交错后一条都不丢      used=1（另两条被覆盖丢失）
```

## 5. 离线阶段与退出码

完整清单见 `evidence/exit-codes.json`。

| 阶段 | 退出码 | 说明 |
|---|---|---|
| `phase=b` | 0 | 第二章拿到第一章上下文 → 采纳 → 导出 |
| `phase=c-control` | 0 | 取消后再生成 → 采纳 |
| `phase=c-disc` | 0 | 断开后服务端无 uncaughtException |
| `phase=guard` | 0 | 额度门 / 损坏账本门 6/6 被拒 |
| `phase=c-real --callBudget 0` | **1** | **预期的 fail-closed**：`guardedSend` 在发请求前抛 `BUDGET_EXHAUSTED`，**0 次网络** |
| `make-ledger` | 0 | 生成账目与对账 |

**真实模型调用 0 次，网络 0 次。** 旧包 `handoff-results/` 与 `review-fix/` 均未覆盖。

## 6. 未验证范围（不要当成已验证）

1. **真实上游的停止 / 计费行为**：本轮 0 次真实调用，`c-disc` 只证明**本地替身上游观察到连接关闭**，不证明真实供应商会停止推理或停止计费。
2. **浏览器停止按钮**：未实现（按要求不做），UI 侧无任何改动。
3. **Codex 复现脚本里的「临界区内暂停」终态**：未复现（需要往旧实现注入暂停点，见 1.1 的说明）。
4. **10 条历史里 8 条的端点身份**：缺原始依据，一律 UNKNOWN，**不能**据此断言它们走过公网。
5. **历史原始帧**：除 10:23 那条外，其余 6 条已随数据根删除 / 被后续运行覆盖，不可恢复（按要求未联网补证）。
6. **跨主机互斥**：`ownerProcessAlive()` 在非本机返回 `null` → 拒绝恢复；跨主机场景未实测。
7. **`ticket-registry.json` 的并发写**：注册表本身用与账本相同的原子写，但没有像账本那样做多进程并发压测。

## 7. 回滚

见 `rollback/ROLLBACK.md`。**只撤销本轮明确的新改动**，不删整份历史装置：

- 方式 A（推荐）：对 7 个被改文件 `git apply -R` 本包的 diff，再删 3 个新增测试文件。历史 `runs/`、`handoff-results/` 一律不动。
- 方式 B：一键脚本 `rollback/rollback.mjs --apply` / `--dry-run`。
- **不提供**「删掉整个 stage 目录」作为默认回滚（Codex 已明确否定）。

## 8. 复现命令

```powershell
cd C:\zcode\novel-ai-handoff-stage4
node harness\tests\audit-red.test.mjs                                   # 修后，应 0
$env:MOZHOU_LEDGER_IMPL="$PWD\.baseline-round5\harness"
node harness\tests\audit-red.test.mjs                                   # 修前，应 1
```

产物路径：`C:\zcode\novel-ai\handoff-results\review-fix2\`