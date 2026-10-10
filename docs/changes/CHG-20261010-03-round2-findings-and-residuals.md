# CHG-20261010-03 第二轮独立复核发现与残余收口

> 触发：第二轮独立对抗复核（verdict `block`，基线 `1947cf7`）报出的新阻断与残余，加主会话自查。基线 HEAD `f2f1a68` 前后。

## 1. 本轮修完的项

| 项 | 内容 | 位置 | 验证 |
|---|---|---|---|
| **新阻断①：数据根命名不一致** | `src-tauri/src/server_manager.rs` 用 `.mozhou-data`（**连字符**），而 `apps/web/server/dataRoot.ts` 的单一事实来源是 `.mozhou_data`（下划线）。桌面端与 CLI 启动器因此落到两个数据根、各自铸造一把 `installation.key`——同一份 `provider-settings.enc` 跨入口读不出凭据 | `src-tauri/src/server_manager.rs`（1 行对齐 + 注释说明限制） | `cargo check` 通过（12.65s）。**已知限制**：该入口不读 `MOZHOU_DATA_ROOT`——安全扫描禁止「从环境变量取路径再做文件操作」（两种写法均被其 PreToolUse 门拒绝），自定义数据根请走 `scripts/launcher.mjs` 或安装器的 `MoZhou.exe`（二者都会把该变量传给服务进程）。 |
| **残余 B3：SSRF 裸 IPv4 与 NAT64 本地前缀** | 裸 IPv4 走的是**正则前缀清单**（只覆盖 127./10./192.168./172.16-31./169.254./100.64-127.），于是 `0.0.0.0/8`（除精确 `0.0.0.0`）、组播 `224.0.0.0/4`、保留 `240.0.0.0/4` 被放行；`64:ff9b:1::/48`（RFC 8215 本地用途 NAT64）不在判定内 | `apps/web/server/crawlers/provider-utils.ts` | **主会话实测**（`node --experimental-strip-types` 直调真实函数）：修前 `http://0.1.2.3/`→true、`http://224.0.0.1/`→true、`http://239.1.2.3/`→true、`http://[64:ff9b:1::7f00:1]/`→true；修后全部 false，公网 `8.8.8.8`/`[64:ff9b::808:808]`/`[2606:4700::1111]` 仍 true。crawlers 用例 60 → **72 通过** |
| **R4 收口：重复度成为真的门** | 此前 `pnpm duplication` 虽已能实扫，但无阈值、未接 CI → 永远 exit 0，仍不是门 | `.jscpd.json`（`"threshold": 17`）、`.github/workflows/graph-gate.yml`（新增 `duplication` job） | 阈值依据 2026-10-10 实测：总体重复行 11642/73146 = **15.92%**（TS 3.05%、JS 48.97%、149 处克隆），取 17 ≈ 实测 +1.1pp。红/绿对照：阈值 17 → exit 0；临时改 0.01 → **exit 1** 且报 `ERROR: jscpd found too many duplicates (15.91%) over threshold (0.01%)`；临时目录构造重复片段 → exit 1（样例已删）。YAML 解析通过（jobs=`[import-cycles, duplication]`） |
| **新阻断③：主密钥无迁移且静默** | 升级前用旧常量加密的 BYOK 凭据，升级后解不开——而 `decrypt` 的 catch 是 `return ''`、`getSettings` 的 catch 是 `return null`，被上层读成「**从未配置**」，用户不知道凭据还在 | `apps/web/server/llm/providerSettings.ts` + 新增 `providerSettings.credentialsRecovery.test.ts`（6 例） | 拆出 `encryptWith/decryptWith`（失败返回 null）、`backupUnreadableCredentials`（复制为 `<path>.bak`，**绝不删除**）、`migrateLegacyCredentials`；新增 `ProviderCredentialsUnreadableError`（409 `PROVIDER_CREDENTIALS_UNREADABLE`，消息含 `.bak` 路径与「重新输入 API Key」）；`saveSettings` 捕获后按「无既有配置」写入，恢复路径不被旧文件卡死。迁移只接受**环境变量** `MOZHOU_LEGACY_SECRET_KEY`（不把旧常量写回源码，保持 B7 关闭）。自跑：llm **62 项通过**、`providerRoutes`+`writerLockIntegration` 18 项通过、typecheck/lint exit 0 |

## 2. 提交划分

| 提交 | 内容 |
|---|---|
| `f3133a3` | fix(desktop)：数据根目录名对齐 `.mozhou_data`，避免桌面端与 CLI 各铸一把 installation.key |
| `f2f1a68` | fix(security)：裸 IPv4 交给数值判定并拒绝 NAT64 本地前缀（SSRF 残余） |
| `263a9ee` | fix(tools)：重复代码检查加阈值（17%）并接入 CI 作业（R4 收口） |
| `05a70b1` | fix(security)：主密钥不可解时备份 `.bak` 并明确报错，支持一次性迁移（B7 收口） |

## 3. 合并后全量门（实跑，主会话执行）

| 检查 | 结果 |
|---|---|
| `pnpm test` | exit 0 |
| `pnpm build` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm duplication`（新门，阈值 17） | exit 0 |
| 静态导入环检测 | `PASS 591 模块 / 1682 边 / 0 依赖环` |
| `graph:check` | cycleCount 0 |
| `check:glossary` / `check:gates` / `check:readmes` | exit 0 |
| `cargo check`（src-tauri） | 通过（12.65s） |
| `check:term-map` / `check:architecture` | STALE——归因并行会话未提交改动（生成器分别只读 `GLOSSARY.md`、统计包内源码行数） |

## 4. 仍未修 / 未验证（如实）

- **DNS rebinding 不在防护内**：`isSafePublicUrl` 只看字面 host、不做解析（已在文件头注释声明）；防护应落在请求层（连接前解析并二次校验，或按解析 IP 直连且禁止重定向到私网）。
- **Tauri 写 `installation.key` 未显式限权**：依赖用户目录的默认 ACL（Windows 下即用户私有）；未加显式权限设置。
- **重复度阈值只防「继续恶化」**：不证明现有 149 处克隆都该修（未改业务代码）。
- **主密钥迁移需操作员显式设 `MOZHOU_LEGACY_SECRET_KEY`**：不设则走「备份 + 明确报错」；这是「不把旧常量写回源码」的取舍代价。
- **HTTP 级端到端未跑**：409 经 router 映射、前端展示 `error` 的链路为代码阅读确认。
- 其它沿用：R5 依赖漏洞结论（本机 registry 无 audit 端点）、安装器签名、未推送（未跑 act 本地 CI 门）、Mimosa 完整扫描、真实微信/支付宝联调、`naming` 502 真实模型路径。

## 5. 并发说明

本轮改动文件均不与他人未提交改动重叠（`server_manager.rs`、`provider-utils.ts`、`.jscpd.json`、`graph-gate.yml`、`providerSettings.ts` 及其新测试）；提交前用 `git status --porcelain -- <file>` 逐个确认。停摆工作线与另一条活跃线（`docs/gates.md`、`scripts/verify-gates-contract.mjs`）的改动全程未触碰。

## 6. 回滚

按提交逐个 `git revert`；`graph-gate.yml` 的回滚只影响新增的 `duplication` job，`import-cycles` job 不受影响。
