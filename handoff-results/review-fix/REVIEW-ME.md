# 墨舟 · 第四轮审计修复交回包（review-fix）

- 交回包绝对路径：`C:\zcode\novel-ai\handoff-results\review-fix`
- 生成时间：2026-09-30T11:45Z
- 上一版交回包：**原样保留**在 `C:\zcode\novel-ai\handoff-results\`（未删除、未覆盖、未改写任何文件）
- 真实模型调用次数：**0**（本轮未发任何一次真实请求，见 §3 证据）
- 生产代码改动：**0**（9 个目标文件 sha256 逐字节一致，见 `target-file-hashes-verified.txt`）

---

## 0. 一句话结论

Codex 的两条主要指摘都已处理：**两次 B 的账目已按「能核实的写、不能核实的写 UNKNOWN」重建**；
**结论已按「真实通道只证明了两条、其余来自受控替身」更正**。整张工单的共享额度从「本进程局部变量」
改成了「跨进程原子账本 + 唯一发放入口 + 默认关闭」，并用 52 项**离线**测试证明它挡得住异常、429、
取消、重启和并发。所有新结论都来自替身与离线测试，**没有一条靠真实请求补证**。

---

## 1. [P1] 两次 B 为什么只有一笔账

### 1.1 结论

上一版 `calls.json` 漏了一笔，且 **9 这个数字不是已审定总数**。修正后：

| 口径 | 数字 | 依据 |
|---|---|---|
| 上一版声称 | 9 | 手写数组 `allRealAttempts`，**不可信** |
| 本轮重建的**遗留**真实调用 | **9 条**（含 2 条端点 UNKNOWN） | `harness/runs-ledger.md` 的 LEGACY 表，逐条给依据 |
| 其中端点身份**无法核实** | **2 条** | seq2、seq6，标 `UNKNOWN` |
| 本轮新增真实调用 | **0** | 工单账本 `spend: []` |

**为什么两次 B 只有一个候选** —— 这是「账目漏记」，不是「只发生了一次调用」：

- 10:15:20Z 的一次 B **确实发生**，终态是上游 429（tpm/rpm），0 个 delta。上一版 runner 在
  `openDraftStreamReal` 里已经 `realCalls.push(...)` 记录了它，但 `export-results.mjs` 的手写数组
  **没有把这一条抄进去** —— 漏记发生在导出环节，不在运行环节。
- 10:16:06Z 的成功那次（candidateId `a60d02ba-…`，302 字，19480ms）是**另一次**调用，
  由 `handoff-results/test-logs/phase-b.log` 的 10:16:29 `done` 帧行独立留档。
- 10:23:54Z 的那次（224 字，38972ms）是**第三次**，它才是被抄进旧 `calls.json` 的那一条
  （旧 `artifacts/phase-b.json` 的 `realModelCalls[0]`：elapsedMs 38972 / deltaChars 224）。

所以真实情况是 **B 阶段至少发生过 3 次真实调用，旧账本只记了 1 次**。这也解释了 Codex 看到的
「10:16 的 302 字候选与 10:23 的 224 字候选为何只有一笔账」。

### 1.2 为什么端点身份判为 UNKNOWN 而不是「真实」

10:16 那次能拿到的只有两样东西：start 帧自报的 `provider: "real-openai-compatible"`、以及耗时。
**不足以区分真实上游与本地替身**，理由有三条，全部是代码事实：

1. `apps/web/server/routes/pipelineRoutes.ts` 的 start 帧 provider 字段由 `generationTarget`
   解析结果填充，真实端点与替身端点都会走到同一个 openai-compatible 分支；
2. 上一版 harness 的 B 阶段 `startServer({real:true})` **不注入受控端点**，但它也没有把
   `MOZHOU_API_BASE` 的实际取值写进任何留档文件 —— 没有可对照的端点覆盖值；
3. 旧 `phase-b.json` 的 `serverLogTail` 里**没有** `mozhou-tier-route` 行，而
   `apps/web/server/llm/generationTarget.ts:218-270` 的 BYOK 路径**根本不打印** tier-route trace ——
   所以「没有 tier-route 行」既不能证明是真实、也不能证明是替身。

**因此：端点身份 = UNKNOWN。** 没有猜测，没有用「耗时像公网」之类的主观推断代替证据。
同样的判据把 10:28:46 那次连接层 `fetch failed`（失败在任何帧之前）也判为 UNKNOWN。

### 1.3 账目是怎么生成的（不再是手写数组）

- 权威账目：`harness/accounting.mjs` 的工单账本 `<ticketDir>/ledger.json`，**每一次真实请求在发送前**
  由 `spendRealCall()` 原子写入一行，reservationId 唯一。
- 报告账目：`harness/make-ledger.mjs` **自动扫描** `runs/*/run-meta.json` + `runs/*/frames-*.ndjson`
  + 旧包留档，输出 `harness/runs-ledger.json` / `.md`。运行期间产生的条目没有任何手写成分。
- 只有「上一版 harness 期间发生、且原始帧已被覆盖」的 9 条以 LEGACY 常量形式登记，每条强制带
  `endpointProvenance` 与 `provenanceBasis` 字段，取值只能是 `KNOWN_*` 或 `UNKNOWN`。

**已知的历史证据缺口**（不靠真实请求补证，如实上报）：
两次 B 的原始 NDJSON 帧已不可得（数据根被删除、旧 `artifacts/` 被后续运行覆盖），
所以 seq2/seq3 只能引用日志行的结构化引用，无法给出逐帧原文。

---

## 2. [P2] 结论更正

上一版报告把受控替身的结果和真实上游的结果混在一起陈述了。更正如下，逐条对应 Codex 的指摘：

| 命题 | 上一版说法 | **更正后** | 本轮如何验证 |
|---|---|---|---|
| 断流后正文不变 | 真实通道验证 | ✅ **真实通道验证过**（第 3 轮，2 次真实调用） | 保留旧证据 |
| 取消后再生成可采纳 | 真实通道验证 | ✅ **真实通道验证过** | 保留旧证据 |
| 终态候选再取消返回 409 | 已验证 | ⚠️ **来自受控替身**，且**不是 409**：客户端断开产出的是 `partial`，`cancelCandidate` 接受 `partial`，返回 200 | 本轮 c-control 离线复跑通过 |
| 取消后作者手动编辑再采纳 | 已验证 | ⚠️ **来自受控替身** | 本轮 c-control 离线复跑通过 |
| 重启后恢复 | 已验证 | ⚠️ **来自受控替身** | 本轮 c-control 离线复跑通过 |
| 浏览器「停止生成」入口 | （隐含已具备） | ❌ **仍未实现**。全仓无任何 `/api/draft.cancel` 的调用方 | 静态核查，见 `UNVERIFIED.md` |
| `pnpm test` 的 flake 归因于负载 | 已归因 | ⚠️ **未独立证明**。重复观测到 `memoRoutes.test.ts` 超时与 `pipelineRoutes.tierRoute.test.ts` ENOBUFS，但没有做「同负载/不同负载」对照实验 | 保留为未验证 |

**本轮不实现停止按钮** —— 按指令留到下一张工单。

---

## 3. 零真实调用的证据

| 证据 | 内容 |
|---|---|
| `harness/ticket-ledger.json` | `realCallAllowance: 0`、`spend: []` —— 本轮账本零占用 |
| `logs/runner-r2.log` + `runs/c-real-real-…/phase-c-real.json` | 以 `--channel real` + 假凭据跑 c-real，终态 `BudgetExhaustedError: BUDGET_EXHAUSTED`，**在发出请求之前**抛错；该运行目录内 **0 个 frames-*.ndjson** |
| `runs/guard-…/phase-guard.json` | 6 项门禁探针全部 fail-closed，`networkUsed: false` |
| `logs/offline-budget.log` | 52 passed / 0 failed，并发、原子性、异常、429、取消、重启全部用**假 transport** 验证 |

注：`--channel real` 需要凭据才能起服务。本轮用 `MOZHOU_API_KEY=dummy-not-a-real-key` +
`MOZHOU_API_BASE=https://127.0.0.1:1/v1`（**一个不存在的环回地址**）起服务，
即使额度门被绕过也绝无可能到达真实供应商；实测是在额度门就被挡下。
第一次跑没有设这两个变量，服务因缺凭据直接拒绝启动，结论相同。

---

## 4. 共享额度的实现与离线验证

### 4.1 默认值与开关

- **默认替身**：`--channel` 缺省即 `controlled`，服务进程的 `MOZHOU_API_BASE` 被指向本机替身，
  凭据是占位串。不给参数就**不可能**碰真实上游。
- **真实通道默认关闭**：必须显式 `--channel real`；且工单账本 `realCallAllowance` **缺省 0**。
  两者都满足才可能发真实请求。

### 4.2 唯一入口 + 先记账后发送

`generate()` 是唯一的分流函数（`runner.mjs:214`）：
- `controlled` → `openDraftStream()` 直接打替身，**不占额度**；
- `real` → `sendReal()`，后者**先** `guardedSend()` → `spendRealCall()` 写盘占用，
  **再** 调用 transport。`sendReal()` 里没有 try/finally 退款 —— 异常、429、取消都不退。

`offline-budget.test.mjs` 的 T14 对 `runner.mjs` 做**结构扫描**（不靠注释）：
打 `/api/draft.stream` 的 fetch 有且仅有 1 处、`generate()` 内部各有 1 处
`openDraftStream`/`sendReal`、`sendReal()` 同时含 channel 判定与 `guardedSend` 调用、
默认 channel 为 controlled。任何「新增一条绕过额度的新路径」都会让这条测试变红。

### 4.3 跨进程共享与并发

锁用 `mkdirSync` 的原子性（Windows 上比文件锁可靠）：锁目录 `<ticketDir>/.ledger.lock`，
30s 陈旧锁可回收，5s 取不到锁抛 `LOCK_TIMEOUT`（fail-closed，不猜额度）。
写账本用 tmp + `renameSync` 原子替换。

### 4.4 离线验证矩阵（`logs/offline-budget.log`，52 项全过）

| 场景 | 断言要点 |
|---|---|
| 传输异常 | transport 被调 1 次；**进入 transport 前账本已记账**；异常如实抛出；**不退款**；第 2 次被挡且 transport 不再被调 |
| 429 | 两次 429 各消耗 1 次额度、**不退款**；第 3 次被挡；错误如实带出 |
| 客户端取消 | **不退款**，账本留有取消原因（可审计） |
| 进程重启 | 父进程占用已落盘；子进程第 1 次成功、第 2 次被挡；**重启不重置** |
| 并发（两组） | 8 进程/额度 3 → 恰好 3 成功；6 进程/额度 1 → 恰好 1 成功；其余全被挡 |
| 多入口绕过 | 额度用尽后直接调 `spendRealCall` 也被挡；非法 channel 被拒；空 reason 被拒 |
| 非法预算 / 损坏账本 / 缺账本 / 锁超时 | 全部 fail-closed（`BUDGET_INVALID` / `LEDGER_CORRUPT` / `LEDGER_MISSING` / `LOCK_TIMEOUT`） |
| 受控通道 | 能发请求但**零额度占用** |
| 原子写 | 账本始终是完整可解析 JSON，无 `.tmp` 残留 |

---

## 5. 运行目录与防覆盖

- 每次运行落在**唯一目录** `runs/<phase>-<channel>-<ISO 时间>-<随机后缀>/`。
- 目录内保留：`run-meta.json`（channel 与额度）、`run.log`、`frames-*.ndjson`（**原始帧，未加工未截断**）、
  服务端日志、上游事件、`phase-*.json`（含逐条断言与证据）。
- **防覆盖**：`RUN_ID` 带毫秒时间戳 + 3 字节随机；再叠加一道显式闸 ——
  `runner.mjs:112-115`，若 `run.json` 已存在则以退出码 3 拒绝启动。
- 账目生成器只读这些目录，不写回运行目录。

本轮共 6 个运行目录（4 个受控 + 2 个被额度门挡下的 real），已全部随包交付在 `runs/`。

---

## 6. 未验证范围

见 `UNVERIFIED.md`（逐条列出，含「为什么本轮没有验证」与「需要什么才能验证」）。

---

## 7. 回滚方式

见 `ROLLBACK.md`。**一句话**：删掉 `handoff-results\review-fix\` 即可 —— 本轮没有动过生产代码、
没有动过旧交回包、没有提交/推送/部署。

---

## 8. 目录清单

```
review-fix/
├─ REVIEW-ME.md                  本文件
├─ CHANGES.md                    逐条变更说明
├─ UNVERIFIED.md                 未验证范围
├─ ROLLBACK.md                   回滚方式
├─ runner.mjs                    改后的运行器（仓库外）
├─ controlled-upstream.mjs       改后的受控替身（仓库外）
├─ harness/
│  ├─ accounting.mjs             工单共享额度账本（跨进程原子）
│  ├─ transport.mjs              guardedSend 唯一发放入口
│  ├─ make-ledger.mjs            自动账目生成器（扫描 runs/）
│  ├─ runs-ledger.json / .md     账目（自动生成）
│  ├─ ticket-ledger.json         工单账本本体（allowance=0, spend=[]）
│  └─ tests/
│     ├─ offline-budget.test.mjs 52 项离线测试
│     └─ child-spend.mjs         并发子进程
├─ logs/                         6 份运行日志 + 离线测试日志 + 机器可读结果
├─ runs/                         6 个运行目录（含原始 NDJSON 帧）
├─ diffs/                        5 个新文件的 unified diff
├─ repo-status-after.txt         与 baseline 逐行相同
└─ target-file-hashes-verified.txt  9 个生产文件逐字节一致
```
