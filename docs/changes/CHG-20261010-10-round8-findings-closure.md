# CHG-20261010-10 第八轮复核发现收口（成本断路器真缺陷 / 票据验签 / 桌面入口）

> 触发：第八轮独立对抗复核（verdict `release`，连续第五次；本轮要求它**证伪**上一批并明确回答「还有没有属于缺陷而非产品决定的问题」）报出的 **1 处真缺陷** + 1 处潜在安全 + 2 处低。基线 HEAD `1a5a6b1` → `e6abd17`。

## 1. 本批修完的项（2 个提交）

| 提交 | 内容 |
|---|---|
| `e3c2d10` | `settle` 不得把单用户推过其月预算（真缺陷） |
| `e6abd17` | 票据验签只用服务端公钥（潜在安全）；桌面入口缺数据根改 fail-closed |

## 2. 逐项：问题 → 修法

### 2.1 （真缺陷）单用户可打掉全局日成本断路器 —— `billing/quota.ts`
**复核员的机制修正（比我先前的表述更精确）**：单用户「连续 reserve + settle」会被**自己的月预算**挡住；**但先攒预留再逐个结算可以绕过**——先 `reserve` 20 单（成本 0、月消费仍为 0，全部通过），再逐单 `settle(costFen=1500)`，**第 7 单**时日成本 `10500 ≥ 10000`，断路器 tripped，其他所有用户的 `reserve` 都 429。约 14 个请求即可。

**根因**：`settle` 累加成本却**不校验月度预算**；月预算只在 `reserve` 里检查，而它检查的 `_userMonthlyCosts` 只由 `settle` 更新。复核员明确判定这属于**修复不完整**（上一批我加的上界只在路由层、挡不住「多次正常」），不是产品决定。

**修法**：在累加**之前**校验该用户月预算（与 `reserve` 同源：同一 `_userMonthlyBudgetMap`、同一默认值 1500），超出即抛 `RequestBoundaryError(402, 'USER_BUDGET_EXCEEDED')`，**且不写入** `_dailyCosts` / `_userMonthlyCosts`。取舍已写入代码注释：**账本记录的是「被接受」的成本，不是「被尝试」的成本**——若拒绝时仍累加，全局日成本照样被推高，缺陷等于没修。断路器仍是全局语义，未改成按用户。

**边界（已用反向用例确认）**：该修复只保证「单个用户在预算内无法打掉全局断路器」；多个用户各自在预算内的合法消费**仍会**把断路器推到 tripped——这是它的设计意图。

### 2.2 （潜在安全）票据用自带的公钥验签 —— `billing/license.ts`
`verifyTicket` 取公钥用 `publicKey || this._publicKey`，即**优先信任票据自带的公钥**。子代理复现：自造密钥对签一张 `planId: 'max_monthly'` 的票据 → `valid: true`，**签名票据的全部意义被抵消**。

**修法**：不再解构票据的 `publicKey`，`keyToVerify = this._publicKey`；注释写明「票据内 publicKey 仅供客户端离线校验，服务端绝不采信」与密钥轮换的后果。

**既有两个防御用例的改动（不是削弱）**：它们原先用「自签一对临时密钥」绕过签名，好让测试走到能力一致性校验那一步——**正是本次修掉的漏洞**。修复后自签会先在验签环节被拒，故改为白盒取服务端真私钥来构造「签名有效但数据不一致」的票据（模拟签发层缺陷/旧版签发器）。**断言一字未改**。

### 2.3 （低）桌面入口缺数据根时裸抛 —— `scripts/release/windows/desktop-server.mjs`
`resolve(process.env.MOZHOU_DATA_ROOT)` 在缺变量时抛裸 TypeError。改为 fail-closed 的显式报错（缺变量或纯空白均触发），文案说明刻意不回退 cwd 的理由（回退会造出第二个数据根与第二把 `installation.key`）。实测 EXIT=1。

### 2.4 （低）`server_manager.rs` 数据根 —— **只补注释，未改逻辑**
写明：该入口不读 `MOZHOU_DATA_ROOT` 是安全扫描约束（禁止从环境变量取路径再做文件操作）；数据根取自 cwd，换 cwd 会造出第二数据根与第二把 `installation.key`；本 Tauri 入口**不在当前 Windows 发行产物内**。**未改 Rust 逻辑、未绕过扫描策略。**

## 3. 判定不修的一处（如实记录）

第八轮称「非 InMemory 分支在 provider 确认失败前就把重置码烧掉了」。子代理复核后判定**就所述后果不成立**：`consumeResetCode` 在外部 provider 路径必然先抛 `INVALID_RESET_CODE`，到不了 `confirmPasswordReset`，故该后果在生产不可达。真正的潜伏问题是「外部 provider 的重置确认分支是死代码」，修它需要决定外部码如何入账——属 auth 语义与范围扩张（UVSD §2.8 要求停下报告而非扩范围），故**不建议修**，本批未动 `accountRoutes.ts` / `session.ts`。

## 4. 主会话的独立复核与修补

- **负例探针**：把月预算判据临时置为永不成立，`server/billing` 里**正是那条新用例变红**（`单用户无法凭自身结算把全局日成本推过全局日预算`），其余 7 文件仍绿 → 证明它咬住修复点，不是恒真断言；随后还原。
- **我自行修掉子代理漏掉的一处 bug**：拒绝消息里的「恢复日期」原用 `setMonth(+1)` + `setDate(1)`，月末会先溢出到下下个月——实测 `2026-01-31 → 2026-03-01`，而月预算实际在 `2026-02-01` 重置，消息多报一个月。改为按 UTC 无溢出算法，实测 `2026-01-31 → 2026-02-01`。
- **既有测试改动逐条核对**：`license.test.ts` 的两处改动只换了签名用的私钥（自签 → 白盒取服务端真私钥），断言未变；`quota.test.ts` 既有用例未删改（原「月预算超限」用例判据 `0+500 > 500` 为假仍放行，语义原样保留）。

## 5. 实跑证据（主会话）

| 检查 | 结果 |
|---|---|
| `pnpm test` | exit 0：包层并行段 119 文件 / **1066 例** + 独占台架段 3 例 + web 段 156 文件 / **1299 例** |
| `pnpm --filter @mozhou/web exec vitest run server/billing server/routes server/auth` | exit 0，65 文件 / **445 例**（连跑 3 遍均 445 通过） |
| `pnpm build` / `pnpm lint` / `pnpm --filter @mozhou/web typecheck` | 全部 exit 0 |
| `cargo check`（src-tauri） | exit 0 |
| `node scripts/check-import-cycles.mjs` | `PASS 595 模块 / 1703 边 / 0 依赖环` |
| `pnpm graph:check` | `cycleCount: 0` |
| `pnpm duplication`（阈值 17%） | 总重复 15.8%，exit 0 |
| 干净 HEAD（`e6abd17`）副本上的五个文档门 | architecture / term-map **FRESH**，glossary / gates / readmes **0** |
| 生成物刷新 | **无需刷新**（architecture 与 term-map 与 HEAD 差异均为 0） |

## 6. 仍未修 / 未验证（如实）

- **一处未复现的偶发**：子代理报告 `quota.test.ts:110` 在全段首跑时失败一次、隔离与重跑均过。主会话连跑 3 遍全段（各 445 例）与 5 遍 billing 段（各 61 例）**均未复现**，故不下结论。可注意的既有脆弱性：该套件全部使用真实 `Date.now()`（无 `now` 注入），跨 UTC 日/月边界的运行理论上可让「累加」与「读取」落在不同日/月键上——但本次失败时刻为 UTC 10:0x，与此不符。
- **`verifyTicket` 生产无调用方**（仅测试与 `api.ts` 转出）：本次是消除隐患，不是修复一个正在被利用的漏洞。
- **被拒绝的预留仍停留在 `reserved`**，不会自动释放：若上层不调 release 会占住在途额度（未测）。
- Tauri 入口未编译运行（不在发行产物内）。
- 沿用：生产改密不可用且需接口变更（见 CHG-20261010-09 §3）；真实生成路径仍未接配额；receipt/report 的 `existsSync` 预检仍 TOCTOU；`listUserBooks` 仍是无调用方死代码；未连真实 Supabase；`#99` 真模型路径；未推送（未跑 act 本地 CI 门）；安装器未签名；Mimosa 完整扫描（`scanner_enobufs`，按 ADR-0036 保持 advisory）；4 个 moderate 依赖漏洞未修。

## 7. 并发说明（精确暂存）

本批 6 个源文件与测试在动手前均经 `git status --porcelain` 确认为干净，无夹带。生成物无需刷新，故未触碰 `docs/architecture.md` 与 `docs/term-map.md`（后者的工作区副本属并行会话）。

## 8. 回滚

按提交逐个 `git revert`。回滚 `e3c2d10` 后同用户先攒预留再逐单结算可再次打掉全局断路器；回滚 `e6abd17` 后自签任意套餐的票据会再次通过核验。
