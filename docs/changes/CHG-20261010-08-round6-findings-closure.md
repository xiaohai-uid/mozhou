# CHG-20261010-08 第六轮复核发现收口（计费成本可达 / 票据能力一致 / zip stored 口径 / 目录副作用）

> 触发：第六轮独立对抗复核（verdict `release`，连续第三次；本轮要求复核员**专攻证伪**，四项修复均未被证伪）报出的 2 项中等 + 2 项低问题。基线 HEAD `20903ca` → `81b9637`。

## 1. 本批修完的项（3 个提交）

| 提交 | 内容 |
|---|---|
| `f757cad` | 计费：settle 路由接受并校验 `costFen` 后透传；reserve/settle 保留额度层状态码；票据能力改由套餐推导 |
| `24c3609` | zip 的 `compMethod 0`（stored）分支补按真实字节核单文件上限；备份路由删掉顶部无条件 `mkdirSync` |
| `81b9637` | 刷新 `docs/architecture.md` 与 `docs/term-map.md` |

## 2. 逐项：问题 → 修法

### 2.1 （中）成本断路器永不触发 —— `apps/web/server/routes/managedModelRoutes.ts` + `billing/quota.ts`
**问题**：settle 分支调 `settle(userId, op, tokens)` 不传 `costFen`，而 `quota.ts` 用 `if (costFen > 0)` 才累加日/月成本 → `_dailyCosts` 永不增长 → `isCircuitBreakerTripped()` 与月预算检查永不触发。进一步核实：**settle 路由根本不接受 `costFen` 字段**，即使调用方知道成本也报不上来。

**修法**：读取并校验 `costFen`（必须有限、非负，非法值显式 400 `INVALID_COST_FEN`，不静默当 0），透传给 `settle`；reserve/settle 的错误保留额度层状态码（断路器 429、额度耗尽 402），此前统一压成 402 使断路器对客户端不可见。

**为什么不按 tokens 自算价格**：冻结定价目录 `catalog.ts` 里 `managed.sellable: false`、`includedCallsPerMonth: null`、`worstCasePerCallFen: null`，`pricePerMTokenFen` 注明「null = 未实测」、`p95CallFen` 注明「尚无真实成本数据，禁止销售」——**没有真实单价可算**，且 settle 时点无法确定适用套餐/模型。凭空造价违反「只用冻结数字」的纪律，故成本一律由调用方提供。该约束已写进代码注释。

### 2.2 （中低）授权票据能力与套餐不符 —— `apps/web/server/billing/license.ts`
**问题**：`issueTicket` 默认 `capabilities: ['pro-features']`，而路由不传 capabilities、还把已算出的 `entitlement.entitled` 丢掉不用 → 免费用户（`planId: 'free'`）也能拿到一张**自称 pro 能力**的签名票据，票据自相矛盾；`verifyTicket` 也不校验该字段。

**修法**：新增 `capabilitiesForPlan(planId)`，从冻结目录推导（pro → `PRO_ENTITLEMENT_KEYS`；max → 追加 `managed-model-quota`；free / local_dev / 未知 → 空）；**删除** `issueTicket` 的 `capabilities` 入参，使「票据能力 == 套餐能力」成为签发层硬约束；路由改为 `entitled ? (entitlement.planId ?? 'free') : 'free'`；`verifyTicket` **新增**能力一致性校验（`CAPABILITY_PLAN_MISMATCH`）——**明确标注为新增防御纵深、非既有语义**。

**兼容代价（fail-closed）**：旧版签发器（默认写 pro-features）发出、仍在期内的票据会核验失败；票据 TTL 上限 72 小时，重新签发即自愈。当前该票据无消费者。

### 2.3 （低）zip stored 分支只按声明值判上限 —— `packages/data-plane/src/zip-util.ts`
**修法**：`compMethod === 0` 分支在 `data = rawData` 后按真实 `data.length` 核 `maxSingleFileBytes`，抛既有 `C5_LIMIT_EXCEEDED`，与 compressed 分支的 `maxOutputLength` 口径一致。风险本就很低（stored 1:1 无放大、需同样大的输入、按真实字节的总量检查仍生效），本次是为纪律一致。

### 2.4 （低）备份目录被无条件创建 —— `apps/web/server/routes/backupRoutes.ts`
**修法**：删掉 handler 顶部的 `mkdirSync`，移入 POST 生成备份分支（`try` 内、落盘前）。下载与恢复是纯读分支；未命中任何分支的请求不再在数据根下产生目录副作用。

## 3. 同类扫描（子代理做，结论：未发现新的同类缺陷）

类别：「拿**声明值 / 调用方声称值**当依据做校验或分配，而不是用真实值」（2.3 就是这个类别）。检索式：`Buffer.alloc/allocUnsafe(` 变量尺寸、`new Array(`/`Array.from({length:`、`readUInt/readInt`、`Content-Length`、`body['units'|'tokens'|'count'|…]`、`JSON.parse` 后 `.length` 作循环或分配、base64 解码、`inflate/gunzip`。

逐处核对结论：`namingRoutes.ts` 的 count 有 `1..NAMING_MAX_COUNT` 校验；`managedModelRoutes.ts` 的 units/tokens 仅用于配额记账且 reserve 校验 `>0`、无分配；`security.ts readRequestPayload` 按真实 `bytes += chunk.length` 限体、**不信任 `Content-Length`**；`chapter.ts` / `wechat.ts` 的 base64 用真实解码字节且严格往返校验；`ssrfGuard.ts` 的 fill 限 1..7。

相邻但非同类、**未报为缺陷**：`proseRoutes.ts:355` 段落 LCS 的 O(n·m) 分配由作者正文本身驱动（真实内容，非声明值）。

## 4. 实跑证据（主会话）

| 检查 | 结果 |
|---|---|
| `pnpm test` | exit 0：包层并行段 119 文件 / **1066 例** + 独占台架段 3 例 + web 段 156 文件 / **1289 例** |
| `pnpm build` / `pnpm lint` | exit 0 |
| `pnpm --filter @mozhou/web exec vitest run server/billing server/routes` | exit 0，63 文件 / **421 例**（新增 11 例） |
| `pnpm exec vitest run packages/data-plane/src` | exit 0，27 文件 / **247 例**（新增 2 例） |
| `pnpm --filter @mozhou/web typecheck` | exit 0 |
| `node scripts/check-import-cycles.mjs` | `PASS 595 模块 / 1701 边 / 0 依赖环` |
| `pnpm graph:check` | `cycleCount: 0` |
| `pnpm duplication`（阈值 17%） | 总重复 15.82%，exit 0 |
| 干净 HEAD（`81b9637`）副本上的五个文档门 | architecture / term-map **FRESH**，glossary / gates / readmes **0** |
| 前提核实 | `catalog.ts` 的 `managed.sellable: false`、`pricePerMTokenFen: null`（T18 未实测）——由主会话亲自读取确认 |

## 5. 仍未修 / 未验证（如实）

- **真实生成路径仍未接配额**（前端不调 reserve/settle，全仓只有该路由调它们）：断路器只在调用方上报 `costFen` 时可达。是否把配额接进生成路径属产品设计决定（且托管模型业务 `sellable: false`），本次**刻意不做**。
- **旧票据会核验失败**：新增的一致性校验使旧版票据失效，需重签（TTL 72h）。未实机验证桌面端缓存旧票据的行为。
- zip stored 上限用例用 32 KiB 合成上限（非 100 MiB 真值），判定逻辑等价。
- `receipt-file.ts` / `report-store.ts` 的 `existsSync` 预检仍是 TOCTOU；`listUserBooks` 仍是无调用方的死代码（是否删除属产品决定）。
- 沿用：`#99` 真模型路径（本机无任何 API key）、未推送（未跑 act 本地 CI 门）、安装器未签名、发布链校验未在 GitHub Actions 上实跑、Mimosa 完整扫描（`scanner_enobufs`，按 ADR-0036 保持 advisory）、4 个 moderate 依赖漏洞未修。

## 6. 并发说明（精确暂存）

`packages/data-plane/src/zip-util.ts` 混有并行会话的 1 行术语改动（`严格安全守卫`→`严格安全检查`）：暂存时还原该行措辞后入索引，`git diff --cached` 中他人术语行数 **0**。计费相关的 5 个文件与备份路由两个文件原本干净。`docs/term-map.md` 的工作区副本是对方按其自己的 GLOSSARY 重生成的产物，本次不覆盖它——从 HEAD 版本出发只修正那一处符号行号后入索引。

## 7. 回滚

按提交逐个 `git revert`。回滚 `f757cad` 后免费用户票据会重新带上 pro 能力、断路器重新不可达；回滚 `24c3609` 后备份目录恢复为「任何请求都会创建」。
