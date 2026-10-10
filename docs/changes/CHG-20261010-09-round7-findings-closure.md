# CHG-20261010-09 第七轮复核发现收口（成本上界 / 能力字段类型守卫 / 改密确认假成功）

> 触发：第七轮独立对抗复核（verdict `release`，连续第四次；本轮要求它**证伪**上一批三项并**第一次**去查前端、会话与并发锁）报出的 1 项中等 + 2 项低问题。基线 HEAD `117c886` → `09ebbce`。

## 1. 本批修完的项（3 个提交）

| 提交 | 内容 |
|---|---|
| `4d4e87d` | 改密确认不再丢弃 provider 的确认结果（修掉一处假成功隐患） |
| `b4ce83f` | 单次结算成本加上界；票据能力字段加类型守卫 |
| `09ebbce` | 刷新 `docs/term-map.md`（`ticket` 符号行号上移） |

## 2. 逐项：问题 → 修法

### 2.1 （中）`costFen` 无上界 —— 任一登录用户可打掉全局日成本断路器
**这是上一批「让成本可上报」之后打开的口子**：`quota.ts` 把 settle 的 `costFen` **直接累加进全局** `_dailyCosts`，而日预算是全局配置（`_dailyBudgetFen = 10_000`，`setDailyBudgetFen` 全仓只有测试调用）。复核员实测：某用户 settle `1e308` 后，`dailyCost = 1e308`、断路器为 true，**其他所有用户的下一次 reserve 都返回 429**。

**修法**：新增上界 `MAX_SETTLE_COST_FEN`，超过即显式 400 `COST_FEN_EXCEEDS_LIMIT`，绝不进入全局累加。**依据取自冻结配置值**——`catalog.ts` 的 `billingCatalog.managed.budget.modelBudgetFenPerMonth`（当前 1500，`Object.freeze` 冻结，注释写明「每月模型成本经营保护上限（分）」）。**未采用** `_dailyBudgetFen`：它经 `setDailyBudgetFen` 运行期可变，不是冻结值。`quota.ts` 的累加语义未改。

**残余**：上界是「月经营保护上限约束单次成本」的保守近似——它拦住「一次报出荒谬成本」，不拦「正常量级成本被多次累加后打掉断路器」。后者需按用户配额或请求鉴权解决，属产品决定。

### 2.2 （低）票据能力字段类型守卫 —— `billing/license.ts`
`verifyTicket` 的一致性校验对**非数组** `capabilities` 会抛 TypeError（`data.capabilities is not iterable`），把本应的 403 变成 500。**修法**：比较前先判 `Array.isArray` 且元素均为字符串，不满足即抛既有 `RequestBoundaryError 403 CAPABILITY_PLAN_MISMATCH`，不新造语义。

**残余**：该路径当前不可达（须先有合法签名，而签发器永不产出非数组）；子代理以**自签票据绕过签发器**验证了守卫本身，未验证真实签发流程。

### 2.3 （低）改密确认丢弃 provider 结果 —— 一处假成功 —— `routes/accountRoutes.ts`
非 InMemory 分支调 `provider.confirmPasswordReset(code, newPassword)`（声明返回 `Promise<boolean>`）却**丢弃返回值**。子代理用测试替身复现：替身返回 false 时，实测响应 `200 {"message":"Password reset successfully"}`，且旧 cookie 访问 `/api/account` 得 401（会话已被撤销）——**用户被告知改密成功、实际密码未变**。

**修法**：接收返回值，`false` 即抛 `RequestBoundaryError(400, 'RESET_CONFIRM_FAILED')`，不再撤销会话、不再回报成功。InMemory 分支（单次消费 / 二次拒绝 / 过期拒绝）未动。

**为什么当前不可达**：`consumeResetCode`（`session.ts:544`）只查本进程内存表，而该表只由 `createResetCode` 填充，后者全仓唯一调用点在 InMemory 分支（`accountRoutes.ts:127`）→ Supabase 路径必然先抛 400 `INVALID_RESET_CODE`。本次修的是把它从「假成功」变成「显式失败」的隐患。

## 3. 只报告、未实现：生产改密路径所需的最小接口变更

子代理给出的结论（**本次未实现**，属接口变更需另行裁决）：

- **重置码的权威应是 provider**（Supabase 自管 recover token，本进程表拿不到码）；本进程表只留给 InMemory 与测试。
- `revokeAllForUser` 需要 `userId`，而非 InMemory 分支拿不到它。**最小变更**：把 `confirmPasswordReset(code, newPassword): Promise<boolean>` 改为返回 `{ ok: boolean; userId?: string }`，路由据 `userId` 撤销会话，`ok === false` 即失败。
- **波及面**：全仓 `implements IAuthProvider` 只有两处，均在 `session.ts`（SupabaseAuthProvider、InMemoryAuthProvider）；接口声明在 `session.ts:38`；消费方只有 `accountRoutes.ts`。
- **本地无法验证**：真实 Supabase 的 recover→token→改密链路、返回的 user id、以及改密后 Supabase 自身会话是否失效。

## 4. 一次归因更正（第七轮推翻了我此前的判断）

第六轮我把「`verifyTicket` 新增一致性校验会让旧票据失效」登记为一处代价。第七轮实测证明**该影响为零**：全仓没有该票据的生产消费者——`verifyTicket` 只出现在 `license.ts` 与其测试里，`apps/web/src` 从不调用 `/api/billing/license/ticket`，`src-tauri` 里只有 Tauri 自身的 capability schema。故不会把任何用户挡在门外。

## 5. 第七轮首次覆盖的区域：结论干净

前六轮从未复核前端与会话，本轮逐条核实并判为干净：

- **XSS**：`innerHTML` / `dangerouslySetInnerHTML` 只出现在测试文件。
- **凭据存储**：`localStorage` / `sessionStorage` 里没有 token 或密钥。
- **写锁**：取锁 / FIFO / 超时 / abort / 幂等释放，`finally` 必释放。
- **会话**：`HttpOnly` / `SameSite` / `Secure`、`timingSafeEqual`、不泄露账户是否存在。
- **设备流**：PKCE S256、单次消费、3 设备上限。
- **数据完整性**：没有再发现「吞读错误返回 null」的路径。

## 6. 实跑证据（主会话）

| 检查 | 结果 |
|---|---|
| `pnpm test` | exit 0：包层并行段 119 文件 / **1066 例** + 独占台架段 3 例 + web 段 156 文件 / **1295 例** |
| `pnpm --filter @mozhou/web exec vitest run server/billing server/routes server/auth` | exit 0，65 文件 / **441 例**（新增 6 例） |
| `pnpm build` / `pnpm lint` / `pnpm --filter @mozhou/web typecheck` | 全部 exit 0 |
| `node scripts/check-import-cycles.mjs` | `PASS 595 模块 / 1703 边 / 0 依赖环` |
| `pnpm graph:check` | `cycleCount: 0` |
| `pnpm duplication`（阈值 17%） | 总重复 15.81%，exit 0 |
| 干净 HEAD（`09ebbce`）副本上的五个文档门 | architecture / term-map **FRESH**，glossary / gates / readmes **0** |

## 7. 仍未修 / 未验证（如实）

- **生产（Supabase）路径改密不可用**，且修好它需要接口变更（见 §3，未实现）。
- **成本上界是保守近似**（见 §2.1 残余）。
- 真实生成路径仍未接配额（断路器只在调用方上报 `costFen` 时可达）；托管模型 `sellable: false`、单价 `null`（T18 未实测）。
- `receipt-file.ts` / `report-store.ts` 的 `existsSync` 预检仍是 TOCTOU；`listUserBooks` 仍是无调用方的死代码。
- 未连真实 Supabase；未跑 Tauri 桌面运行时；`#99` 真模型路径（本机无任何 API key）。
- 沿用：未推送（未跑 act 本地 CI 门）、安装器未签名、发布链校验未在 GitHub Actions 上实跑、Mimosa 完整扫描（`scanner_enobufs`，按 ADR-0036 保持 advisory）、4 个 moderate 依赖漏洞未修。

## 8. 并发说明（精确暂存）

本批 6 个源文件与测试在动手前均经 `git status --porcelain` 确认为干净，无夹带。`docs/term-map.md` 的工作区副本属并行会话，本次不覆盖——从 HEAD 版本出发只修正那一处符号行号后入索引。生成物刷新用 `git archive HEAD` 的干净副本作测量环境。

## 9. 回滚

按提交逐个 `git revert`。回滚 `b4ce83f` 后 `1e308` 可再次打掉全局断路器、畸形能力字段会重新抛 TypeError；回滚 `4d4e87d` 后 provider 报失败仍会被当作成功。
