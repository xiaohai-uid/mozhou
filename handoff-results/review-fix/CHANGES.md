# 第四轮变更说明（CHANGES）

范围声明：本轮**只**改了仓库外的测试装置 `C:\zcode\novel-ai-handoff-stage4\` 与本交回包。
生产代码（`C:\zcode\novel-ai\`）**一个字节都没动**，证据见 `target-file-hashes-verified.txt`。

---

## A. 新增文件（diffs/ 里有完整 unified diff）

| 文件 | 行数 | 作用 |
|---|---|---|
| `harness/accounting.mjs` | 212 | 工单共享额度账本。跨进程原子占用；`allowance` 缺省 0；异常/429/取消/重启**一律不退款**；非法预算、损坏账本、缺账本、锁超时全部 fail-closed |
| `harness/transport.mjs` | 74 | `guardedSend()` —— 真实通道**唯一发放入口**。controlled 通道不占额度；real 通道**先记账后发送**，无退款分支 |
| `harness/tests/offline-budget.test.mjs` | 296 | 52 项离线测试 T1–T14（异常/429/取消/重启/并发/多入口/非法预算/损坏账本/锁超时/受控不占/跨进程原子性/原子写/runner 结构扫描） |
| `harness/tests/child-spend.mjs` | 24 | 并发/重启场景的子进程脚本（只写账本，不发网络） |
| `harness/make-ledger.mjs` | 175 | **自动**账目生成器：扫描 `runs/*/run-meta.json` 与 `frames-*.ndjson`，输出 `runs-ledger.json/.md` |

## B. 修改文件（无版本库基线，给锚点与片段）

### B.1 `runner.mjs`（56 KB）

⚠️ **证据缺口**：本装置在版本库之外，第四轮开工前**没有**保存基线副本，
因此无法提供可机械 apply/revert 的字节级 diff。原文件大小记录为 **46,689 字节**（供核对）。
改后的完整文件在本包根目录，可直接 diff。下表是逐处锚点。

| 位置 | 改前 | 改后 |
|---|---|---|
| 文件头 16-23 | 用法示例只有 3 个 phase，真实通道是默认行为 | 加 `--channel` 语义说明；`c-real` 标注「**默认关闭**，必须显式开启」 |
| 新增 import | 无 | `import { budgetSnapshot, initLedger } from './harness/accounting.mjs'` 与 `import { guardedSend } from './harness/transport.mjs'` |
| 旧 `const ART = join(HERE, 'artifacts')` | 全部产物平铺在一个目录，会互相覆盖 | 保留 `ART` 但**所有写入改到** `RUN_DIR`（`join(ART, ` → `join(RUN_DIR, ` 全量替换） |
| 新增 100-142 | — | `CHANNEL = argOf('channel', 'controlled')` + 非法值退出码 2；`TICKET_DIR`；`CALL_BUDGET = Number(argOf('callBudget', '0'))`；`RUN_ID`（phase-channel-ISO-随机）；**防覆盖闸**：已存在同名 `run.json` 则退出码 3 |
| 新增 119-140 | — | `run-meta.json` 落盘（runId/phase/channel/realModelCallsAllowed/argv）；`writeFrames()` 逐次调用落**原始 NDJSON 帧** |
| 旧 82-98 | `const realCalls = []` + `let realCallBudget = Number(argOf('callBudget','4'))` —— **进程内**计数，默认 4 | 整段删除，改为 `ensureLedger()`（只立案不重置）+ `budgetSnapshot` |
| 旧 100-187 | `openDraftStreamReal()` 自带预算检查 + 手写 `realCalls.push` | 替换为 `summarizeStream()`（只做统计）+ `sendReal()`（判 channel → `guardedSend` → transport，**无 finally 退款**） |
| 新增 205-228 | — | `generate()`（唯一分流）+ `generateWithBackoff()`（每次重试**重新占用**额度） |
| 旧 401 | `await openDraftStreamReal({...}, ..., { maxAttempts: 2, waitMs: 45000 })` | `await generateWithBackoff({ ... })`；新增 `out.providerIdentity` 显式声明本次 channel 与端点身份的可核实性 |
| 旧 457 | 断言 `start.provider === 'real-openai-compatible'` | 放宽为接受 mock，并在同处补 `providerIdentity`（明示「BYOK 不打印 tier-route，端点无法反查」） |
| 旧 491 / 771 / 937 | `out.realModelCalls = realCalls` | `out.ledger = budgetSnapshot(TICKET_DIR)` |
| 旧 518-528 | 受控替身启动逻辑内联在 c-control 里 | 抽成 `startControlledFixture(recordName, {completeAll})` |
| 旧 260-280 `buildEnv(real)` | `real` 时注入凭据 | `CHANNEL === 'controlled'` 时注入替身端点与 `MOZHOU_ALLOW_PRIVATE_LLM=1`（**只在本测试子进程**），real 时才读凭据 |
| 旧 704-787 | c-real 里的 `realAttempt()` 局部计数器 | 删除，改调 `generateWithBackoff()` |
| 新增 925-985 | — | `phaseGuard()`：**零网络**的门禁自检（6 项探针），不启动任何服务 |
| 新增 main 分支 | 只有 b / c-control / c-real / c-disc | 增加 `--phase guard` |

### B.2 `fixtures/controlled-upstream.mjs`（受控替身）

| 位置 | 改前 | 改后 |
|---|---|---|
| 常量区 | 只有 `PORT`、`RECORD` | 新增 `COMPLETE_ALL = args.includes('--complete')` |
| 收尾判定 | `const shouldComplete = promptText.includes('__COMPLETE__') \|\| promptText.includes('__HOLD__')` | `const shouldComplete = COMPLETE_ALL \|\| promptText.includes('__COMPLETE__') \|\| promptText.includes('__HOLD__')` |

原因：让替身**不带控制词地**正常收尾，B 阶段的候选文本才不会被 `__COMPLETE__` 污染。

---

## C. 过程性踩坑记录（值得复核者知道）

1. **子进程脚本被写成测试文件本体** —— `child-spend.mjs` 一度内容是整个 `offline-budget.test.mjs` 的副本，
   导致子进程递归 fork、报错输出 800 KB+。已重写，并在测试顶部加了 `MOZHOU_BUDGET_CHILD=1` 重入硬闸（退出码 97）。
2. **`\n` 在嵌套模板字符串里被吃掉** —— 两处 `writeFileSync(..., JSON.stringify(...) + '\n')` 落成了真换行，
   造成 SyntaxError。已改写并复验 `node --check` 退出码 0。
3. **替身起晚于被测服务** —— c-control / c-disc 原本先 `startServer` 再起替身，
   而 `buildEnv` 在 controlled 通道下需要端点，导致启动即失败。已调整顺序。
4. **T14 最初扫的是错误路径**（`harness/runner.mjs`，实际在上一级），并留下一处引用旧字段的断言，
   跑出 `TypeError`。已修正路径、删掉失效断言，并把 T14 升级为结构扫描。

---

## D. 没有做的事（明确边界）

- 没有实现浏览器「停止生成」入口（下一张工单）。
- 没有新增任何真实模型调用来补证。
- 没有修改生产代码、没有 commit / push / tag / deploy。
- 没有删除或改写上一版交回包。
