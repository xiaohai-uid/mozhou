# CHG-20261010-02 对抗评审剩余阻断修复（R2 / B4 / B5 / B6 / B7）

> 触发：`CHG-20261010-01` 落账后，按独立放行复核员的清单继续修剩余阻断。基线 HEAD `d0a7bc3`（本批 4 个提交落于其后）。

## 1. 本轮修完的阻断

| 项 | 内容 | 位置 | 验证 |
|---|---|---|---|
| **R2** 支付回调验签旁路 | ① 未配置平台证书时**只有 `NODE_ENV==='production'` 才拒绝**，其余环境放行任意签名（只拦 `bad_sign`/`fake_` 前缀）；② `decryptResource` 对 `{` 开头的 ciphertext **直接明文透传**，且**没有任何环境判断**；③ 路由未先判 `isConfigured()` | `apps/web/server/billing/wechat.ts`、`alipay.ts`、`routes/billingRoutes.ts` + 测试 | **两处旁路整体删除**，未新增放行开关：未配置证书一律 503（与 NODE_ENV 无关）；密文一律 AES-256-GCM 解密；路由在 try 前判 `isConfigured()` 直返 503。测试改为**构造函数注入运行时生成的临时 RSA/AES 密钥**做真实验签与真实解密。自跑：billing+routes **10 文件 60 用例通过**，typecheck exit 0 |
| **B7** 源码里的 dev 回退凭据字面量 | `DEV_FALLBACK_SECRET = 'mozhou-default-internal-master-key-2026'`（本地非 production/hosted 时**实际当加密主密钥**）；`crawl4ai.ts` 的 `'local-dev-token'` 默认值 | `apps/web/server/llm/providerSettings.ts`、`crawlers/crawl4ai.ts`、`masterKey.test.ts`、`scripts/launcher.mjs`（注释跟进） | 删除字面量：本地改为读数据根 `installation.key`（缺失则 `randomBytes(48)` 以 `flag:'wx'`+`0600` 现场铸造；格式校验失败明确报错并提示勿替换）。选「运行时随机+持久化」而非「缺失即失败」的理由：既有测试在无密钥的临时数据根保存凭据，且产品有「本地零配置启动」承诺；该做法与 launcher/desktop-server 同一套引导。自跑：3 文件 26 用例通过 |
| **B6** Tauri 启动器弱密钥 | `generate_hex_key_96` 用**线性同余 + 墙钟种子**生成 48 字节（非 CSPRNG），在 `installation.key` 缺失时用作 `MOZHOU_SECRET_KEY` | `src-tauri/src/server_manager.rs`、`src-tauri/Cargo.toml` | 改为 `getrandom::fill`（CSPRNG）。新增直接依赖 `getrandom = "0.3"`——该 crate 已在 `Cargo.lock` 中作为传递依赖（0.3.4），不引入新下载；API 已从 registry 源码核实（`pub fn fill(dest: &mut [u8]) -> Result<(), Error>`）。**`cargo check` 通过（4.15s）** |
| **B4** 采纳意图日志非原子写 | `writeIntent` 用裸 `writeFileSync`；该文件是崩溃恢复的唯一凭证，撕裂后 `JSON.parse` 失败被包装成 `BASE_STALE`，候选此后每次采纳都误报、需手工删文件 | `packages/pipeline/src/draft-accept.ts:101-104` | 改用 `atomicWriteFileSync`（同目录更新路径本就原子）；清理随之无用的 `writeFileSync` import。自跑：pipeline **32 文件 254 用例通过**，`tsc -b` exit 0 |
| **B5** 候选首次落盘非原子 | `createDraftCandidate` 用裸 `writeFileSync`，而同文件更新路径 `:399` 已用 `atomicWriteFileSync`；撕裂后 `readDraftCandidate` 抛错 → `listDraftCandidates` 整表失败（整章 500） | `packages/pipeline/src/draft-candidate.ts:270` | 同上改用 `atomicWriteFileSync`；清理 import |

## 2. 提交划分

| 提交 | 内容 |
|---|---|
| `da092f8` | fix(security)：支付回调验签 fail-closed，删除测试放行与明文透传旁路（R2） |
| `b4825aa` | fix(security)：清除源码里的 dev 回退凭据字面量，本地主密钥改为安装密钥文件（B7） |
| `b5e4505` | fix(desktop)：安装密钥改用 CSPRNG 生成（B6） |
| `54faea3` | fix(pipeline)：采纳意图与候选首次落盘改用原子写（B4/B5） |

## 3. 仍未修 / 未验证（如实）

- **R5 依赖漏洞结论未取得**：本机 registry（npmmirror）无 audit 端点（`ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`）。属环境限制，托管 runner 结果未复现。
- **SSRF 残余**（超 B1 范围）：`provider-utils.ts` 的 ULA 判定只匹配字面 `fc00:`/`fd00:`（`http://[fc12::1]/` 仍放行）；不做 DNS 解析，rebinding 不在防护内。
- **真实微信/支付宝联调未做**：凭据未随包发布，会员支付真实化仍是已声明挂账项。`notifications.ts` 未改（范围外），其内部对同一单例二次验签；路由 catch 仍把验签失败统一映射 401（响应形状未改）。
- **B4/B5 无专门崩溃注入测试**：修复复用了 data-plane 已测的 `atomicWriteFileSync`（`atomic-write.test.ts` 含短写补齐与零进展失败用例），但这两条调用路径本身没有撕裂注入用例。
- **未验证**：安装器签名；未推送（须先跑 act 本地 CI 门）；Mimosa 完整扫描结论（advisory）；`naming` 502 真实模型路径；真实浏览器登录/写请求路径。

## 4. 并发说明（精确暂存）

本批涉及的 `apps/web/server/billing/wechat.ts`（1 处他人注释措辞）与 `packages/pipeline/src/draft-accept.ts`、`draft-candidate.ts`（共 4 处他人注释措辞）均含停摆工作线的未提交改动。提交时用「工作区内容减去他人 hunk」的方式构造暂存版本（`git show HEAD:<f>` 为底、脚本还原他人措辞、`hash-object`+`update-index --cacheinfo`），并在提交前用 grep 断言暂存差异里**不含**他人措辞（结果 0）。他人改动仍原样留在工作区。

## 5. 回滚

按提交逐个 `git revert`；`wechat.ts` / `draft-accept.ts` / `draft-candidate.ts` 回滚时需保留停摆工作线的注释改动（revert 会一并回退该文件，届时需重新应用）。
