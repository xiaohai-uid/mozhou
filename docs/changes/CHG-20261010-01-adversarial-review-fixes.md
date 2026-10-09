# CHG-20261010-01 对抗评审第 1–2 轮修复落账（含硬阻断 R1 的收口修复）

> 触发：用户 `/workflow 开始推进` → 对抗评审与修复工作流（run `dwfrun-99eae8d8`，含被取代的 `dwfrun-ca16e476`）。基线 HEAD `8fb9798`。

## 1. 评审结论（谁在阻止上线）

**独立放行复核员 verdict = `block`**，理由是硬门 `pnpm lint` 失败（两条解析错误），而 lint 是 `ci.yml:38` / `release.yml:58` 与推送前 act 本地 CI 门的硬步骤。其余门复核通过：`pnpm test` exit 0（web 151 文件/1146 用例/15 skipped）、`pnpm build` exit 0、`graph:check` cycleCount 0、`check:glossary`/`check:gates`/`check:readmes` PASS。

两轮评审共报 **12 项阻断项**（第 1 轮 7 项、第 2 轮 5 项），本轮修复其中 6 项（含 1 项由主会话收口）。

## 2. 本轮已修（均经独立复核者重跑确认）

| 项 | 内容 | 位置 | 证据 |
|---|---|---|---|
| **B1** SSRF 可绕过 | `isSafePublicUrl` 未还原 IPv6 中嵌入的 IPv4，`::ffff:127.0.0.1` / `::ffff:169.254.169.254` / `::ffff:10.0.0.5` 等全部放行，而该门守的是公开路由 `/api/crawler.extract`（`routePolicies.ts:35` 标 `public`） | `apps/web/server/crawlers/provider-utils.ts`（+48 纯新增：`isPrivateOrReservedIpv4`、`extractEmbeddedIpv4`）+ 新增回归测试 | 修复者实跑真实函数：修前 `http://[::ffff:127.0.0.1]/ => true`（对照 `http://127.0.0.1/ => false`）；复核者读 diff（+48 −0，无无关改动）并重跑 42 例全绿 |
| **B3** CSRF 声明漂移 | `assertCsrf`（`session.ts:599`）**生产路径零调用方**，登录响应却下发无人回传的 `csrfToken`，而 `docs/adr/0030` 三处宣称它是唯一在生效的实现 | `apps/web/server/auth/session.ts`、`routes/accountRoutes.ts`、`docs/adr/0030-local-api-trust-model.md` | `grep -rn assertCsrf` 仅命中定义与测试；`grep -rn csrf apps/web/src` 零命中。复核者重跑 `session.test.ts`+`accountRoutes.test.ts` → 15/15 通过，并确认三处原始证据点已消除 |
| **B2** 发行资产用公开常量派生主密钥 | `local-runtime` 的启动路径（`scripts/launcher.mjs`、`启动墨舟.bat`、`start.sh`）**从不设 NODE_ENV/MOZHOU_SECRET_KEY**，于是 `providerSettings.ts:99` 落到 `DEV_FALLBACK_SECRET`（`providerSettings.ts:63` 的公开常量）；实跑编译产物证明派生出的密钥与该常量 `scryptSync` 结果**逐字节相同** | `scripts/launcher.mjs`（生成 `installation.key`） | 复核者核对 `build-release.mjs:86` 与 `启动墨舟.bat:49` / `start.sh:35`，确认 `installation.key` 确实进入发行资产 |
| **R3** 对账 dismiss 无锁 | `reconciliationRoutes.ts:461-479` 的 dismiss 直接改提案状态与 manifest 基线，而同文件 `:446-450` 的 decide 走 `withBookWriteLock`；`syncBaselineForPath`（`reconciliation.ts:941-954`）是对 manifest 的读-改-写，注释自承会误报 EXTERNAL_MODIFIED | `apps/web/server/routes/reconciliationRoutes.ts`（1 处最小改动） | 复核者核对 `git status`（仅该文件）与 diff（单 hunk），确认与 decide 同持写锁 |
| **R4** 重复代码检查假绿空转 | `package.json:39` 未传扫描路径 + `.jscpd.json:7` 用 `formats`（jscpd 3.5.10 只认 `format`）→ 0.084ms 无输出却 exit 0 | `package.json`、`.jscpd.json` | 修复后实扫 **374 文件、149 处克隆**；复核者独立确认两条根因 |
| **R1** 硬阻断：lint 失败（**主会话收口修复**） | ① B1 新增的 `apps/web/server/crawlers/provider-utils.test.ts` 未被 `eslint.config.js:21-56` 的 `allowDefaultProject` 覆盖 → `was not found by the project service`；② `defaultProject` 匹配数 121 > 阈值 120（`eslint.config.js:60`） | `eslint.config.js`（补登记一行 + 阈值 120→140，附注释说明长期正解） | **主会话亲跑**：修前 `pnpm lint` exit 1（输出即「…which does not match 'apps\web\server\crawlers\provider-utils.test.ts'」）；修后 **exit 0** |

## 3. 验证（主会话亲验）

| 检查 | 结果 |
|---|---|
| `pnpm lint` | **exit 0**（修前 exit 1） |
| `pnpm --filter @mozhou/web typecheck` | exit 0 / 0 errors |
| 定向测试 `provider-utils.test.ts` + `session.test.ts` + `accountRoutes.test.ts` | **57 passed / 3 files**，exit 0 |
| 编排器实跑（工作流内） | `pnpm test` exit 0、`graph:check` clean/cycleCount 0 |

## 4. 仍未修（如实，附原因）

| 项 | 内容 | 为何未修 |
|---|---|---|
| **R2** 支付回调验签旁路 | `wechat.ts:99-108` 与 `alipay.ts:66-74` 仅在 `NODE_ENV==='production'` 时强制验签；`wechat.ts:144-151` 允许明文 JSON ciphertext 透传；结合 B2 已证「发行资产不设 NODE_ENV」，该旁路在发行资产上**是活的** | 本轮未派修（超出本轮 3 项上限）；范围受限：`router.ts:81` 的 `assertTrustedRequest` 要求 loopback+Origin，且会员支付真实化是已声明挂账项 |
| **B4/B5** 非原子写 | `draft-accept.ts:101-104` 的 `writeIntent` 与 `draft-candidate.ts:270` 的 `createDraftCandidate` 用裸 `writeFileSync`（同文件更新路径已原子化）；撕裂后候选永久不可采纳（误报 BASE_STALE）或整章候选列表 500 | **两文件均被停摆的并行会话占用**，当前不可编辑（fixable=false） |
| **B6** Tauri 启动器弱密钥 | `src-tauri/src/server_manager.rs:170-181` 用 LCG+墙钟种子生成 `MOZHOU_SECRET_KEY`（对照 `desktop-server.mjs:10` 的 `randomBytes(48)`） | 已核实**不在本次 Windows 安装器发行路径**（MoZhou.exe 走 desktop-server.mjs），故不阻断本次发布，但应修 |
| **B7** dev 回退凭据字面量 | `providerSettings.ts:63` 与 `crawlers/crawl4ai.ts:9` 仍含字面量（B2 修复后 local-runtime 不再用到前者） | 未派修；与「源码不得出现可用凭据字面量」的约束相抵 |
| **R5** 依赖漏洞无结论 | `pnpm audit` 在本机 registry 无 audit 端点（exit 1） | 环境所限；CI/release 步骤的托管结果本地无法复现 |
| SSRF 残余 | `provider-utils.ts:75-76` 的 ULA 判定只匹配字面 `fc00:`/`fd00:`，`http://[fc12::1]/` 仍放行；不做 DNS 解析（rebinding 不在防护内） | 超 B1 范围，未改 |

## 5. 未验证（不掩盖）

安装器未签名；提交时安全扫描恒 INCONCLUSIVE（ADR-0036 advisory）；未推送（未跑 act 本地 CI 门）；`naming` 502 真实模型路径未实测（无凭据）；真实浏览器登录/写请求路径与真实 crawl4ai 端到端未运行；`check:term-map` / `check:architecture` 因并行会话改动为 STALE（判断为工作区产物，未在提交态复核）。

## 6. 提交划分

1. `fix(security)`：B1 + B3（含 ADR 对齐）—— SSRF 与 CSRF 声明两处安全相关修复及其文档对齐。
2. `fix(release)`：B2（local-runtime 生成 installation.key）。
3. `fix(server)`：R3（reconciliation.dismiss 纳入书稿写锁）。
4. `fix(tools)`：R4（jscpd 空转）+ R1（eslint 登记与阈值）——两处「门不工作」的修复。

## 7. 并发说明与本次偏差

- 工作区另有**两条**工作线的未提交改动：术语统一线（123 项，停摆于 2026-10-07 23:26）与另一条**当前活跃**的线（`docs/changes/CHG-20261009-0{1,2}`、`docs/gates.md`、`scripts/verify-gates-contract.mjs`，2026-10-10 00:12–00:28）。
- **本次未写 `PROJECT-MAP.md` 条目**：该文件正被那条活跃线**同时编辑**（00:28 写入），现在写入存在竞态风险。地图登记将在该文件落定后单独补交（属已知偏差，非遗漏）。
- `eslint.config.js` 含术语线的 4 行注释改动，本次用**精确暂存**只提交自己的两处改动，他人改动未动。

## 8. 回滚

按提交逐个 `git revert`；`eslint.config.js` 的回滚需注意保留术语线的注释改动（用 `git revert` 会一并回退该文件，届时需重新应用术语改动）。
