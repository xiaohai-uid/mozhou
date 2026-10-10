# CHG-20261010-04 第三轮复核发现收口（共享 SSRF 判定 / 读失败语义 / 运行态原子写）

> 触发：第三轮独立对抗复核（verdict `block`）报出的 1 项新高危 + 3 项残余。基线 HEAD `efa7f8a` 前后。

## 1. 本轮修完的项

| 项 | 内容 | 位置 | 验证 |
|---|---|---|---|
| **🔴 新高危：LLM 出站 SSRF 门漏改** | `assertSafeRemoteTarget` 实测放行 `[2002:7f00:1::]`（6to4 嵌入 127.0.0.1）、`[64:ff9b:1::a9fe:a9fe]`（NAT64 本地前缀嵌入 169.254.169.254）、`[::7f00:1]`（已废弃 IPv4 兼容）、`[3fff::1]`（文档段）；而 `POST /api/llm/settings` 收任意 baseUrl（仅协议校验）→ hosted 下任一登录用户可借 NAT64/6to4 打内网与云元数据。**同类漏洞爬虫门已修（f2f1a68），此处未同步** | 新建 `apps/web/server/ssrfGuard.ts`（共享判定）；`crawlers/provider-utils.ts` 与 `llm/openaiStream.ts` 改为共用它（各自策略——协议白名单、超时、`redirect:'manual'`——原样保留） | **主会话实测**（直调新模块）：8 个恶意形式（含上述 4 个 + `[::ffff:0:7f00:1]`、`[fc12::1]`、`0.1.2.3`、`224.0.0.1`）全部 `isPrivateOrReservedAddress=true`；3 个公网形式（`[2606:4700::1111]`、`8.8.8.8`、`[64:ff9b::808:808]`）仍放行。`crawlers+llm` **136 用例通过**（含 provider-utils 72） |
| **（中）`getSettings` 读失败变 500** | 上一批迁移修复把 catch 从 `return null` 改成抛错，但**读文件本身**没有 try/catch → 文件损坏/权限/占用直接 500 | `apps/web/server/llm/providerSettings.ts` | 读失败走与「解不开」同一条显式路径（409 `PROVIDER_CREDENTIALS_UNREADABLE`，消息带底层 errno）；新增 `backupUnreadableCredentialsByCopy`（尽力 copy 备份，失败返回 null）与 `describeReadFailure`；**任何路径都不删除用户文件**。测试用「目录占位」稳定复现 EISDIR。llm **64 用例通过** |
| **（低）`draft-step.ts` 运行态裸写** | `writeDraftState` 用裸 `writeFileSync`；`readDraftState` 对撕裂内容宁抛不猜 → 一次崩溃即把该章运行态读废 | `packages/pipeline/src/draft-step.ts` | 改 `atomicWriteFileSync`（与同包 `draft-candidate.ts:399` 一致）；**读路径刻意不改**——该文件没有「上一份可用状态」可回退，返回 null 会把撕裂误判成「从未开流」，语义不明确故不发明。新增 2 例（落盘后为完整 JSON 且无 tmp 残留；撕裂文件宁抛）。pipeline **256 用例通过** |

**共享化顺带暴露并修掉一处真回归**：旧 `openaiStream` 用字符串正则拦 `::ffff:0:127.0.0.1` 的**规范化形态** `::ffff:0:7f00:1`；换成纯位段判定会漏。已在 `isPrivateOrReservedIpv6` 前置「字面还原」补齐（测试含该用例）。另：统一后 IPv4 判定取两侧并集，爬虫侧新增拒绝 `198.18/15`、`198.51.100/24`、`203.0.113/24`（消除漂移的预期增强，72 用例全过）。

## 2. 提交划分

| 提交 | 内容 |
|---|---|
| `890e295` | fix(pipeline)：draft-step 运行态改原子写（撕裂即读废） |
| `7a9705d` | fix(security)：getSettings 读失败走显式 409 而非 500（备份尽力而为，绝不删除） |
| `abd99f5` | fix(security)：抽出共享 SSRF 判定并同步 LLM 出站门（6to4/NAT64/::/96/文档段） |

## 3. 合并后全量门（实跑，主会话执行）

| 检查 | 结果 |
|---|---|
| `pnpm test` | exit 0 |
| `pnpm build` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm duplication`（阈值 17%） | exit 0 |
| 静态导入环检测 | `PASS 593 模块 / 1685 边 / 0 依赖环` |
| `graph:check` | cycleCount 0 |
| `check:glossary` / `check:gates` / `check:readmes` | exit 0 |
| `check:term-map` / `check:architecture` | STALE——归因并行会话未提交改动（生成器分别只读 `GLOSSARY.md`、统计包内源码行数） |

## 4. 仍未修 / 未验证（如实）

- **DNS rebinding 本层不防**：共享判定只看字面 host，已在 `ssrfGuard.ts` 头注释写明防护归请求层（连接前解析并二次校验，或按解析 IP 直连且禁止重定向到私网）。
- **`isPrivateOrReservedAddress` 对非 IP 文本返回 true（fail closed）**：调用方必须先用 `isIP` 门控（`openaiStream` 已如此）。
- **重复度门只比总量**：逐格式极端值可被行数加权稀释（JS 48.97% 被总量 15.89% 掩盖）——登记为技术债，未改。
- **`readDraftState` 撕裂仍抛**（只消除来源，不做自愈）——语义不明确，故意不改。
- **真权限拒绝（EACCES/EBUSY）未构造**：测试只覆盖 EISDIR（跨平台稳定）。
- **Tauri 入口不读 `MOZHOU_DATA_ROOT`**（安全扫描禁止从环境变量取路径做文件操作）——自定义数据根请走 `launcher.mjs` / `MoZhou.exe`。
- 沿用：R5 依赖漏洞结论（本机 registry 无 audit 端点）、安装器签名、未推送（未跑 act 本地 CI 门）、Mimosa 完整扫描、真实微信/支付宝联调、`naming` 502 真实模型路径、`check:term-map`/`check:architecture` 因并行会话未提交改动 STALE。

## 5. 并发说明

`packages/pipeline/src/draft-step.ts` 含停摆工作线的 1 行注释改动（`迟到 chunk 守卫`→`门`），提交时用「工作区内容减去他人 hunk」构造暂存版本，并以 grep 断言暂存差异不含他人措辞（结果 0）。其余四个文件无夹带（已逐个 grep 核实）。

## 6. 回滚

按提交逐个 `git revert`；`draft-step.ts` 回滚需保留停摆工作线的注释改动。
