# 墨舟 PUBLIC_FREE Provider Gate 状态（2026-08-17）

本表是 N1–N4 完成后的证据冻结。它区分受控契约证据与真实 Provider 证据；`REAL PASS` 仅对明确标注的正常生产纵切片成立，不自动覆盖重试、压缩、回退、续跑或耗尽语义。

| Gate | 受控证据 | 真实证据 | 当前状态 | 阻塞 |
| --- | --- | --- | --- | --- |
| A Boundary | `resolveProviderBoundary`、统一 transport 与 HTTP/章节测试通过；smoke trace 有 `boundaryEntered=true` | CLI 与 Edge 正常请求均确实进入当前边界 | REAL PASS — normal slice | 生产 Provider policy 仍待人类冻结 |
| B Source Class | PUBLIC_FREE source-class contract 与跨类 attempt 拒绝测试通过 | 真实正常请求 trace 为 `PUBLIC_FREE` | REAL PASS — normal slice | 不是人类冻结决定 |
| C Ownership | boundary 测试与 trace 均保留 `credentialOwner=platform`、`billingOwner=provider` | 真实正常请求保留 platform/provider ownership | REAL PASS — normal slice | 正式 ownership policy 仍待冻结 |
| D Mock Firewall | production `TEST_MOCK` 明确拒绝，milestone/build/lint 通过 | 不以 mock 冒充真实 | PASS | 无内部阻塞 |
| E Paid Escalation | 同类 fallback 只接受 PUBLIC_FREE；跨类候选抛 `FREE_UNAVAILABLE` | 未执行真实 escalation/fallback | CONTROLLED PASS / REAL NOT EVIDENCED | 真实同类 Provider 列表 |
| F BYOK Isolation | PUBLIC_FREE 不解析 USER_BYOK boundary；跨类 attempt 拒绝 | 正常路径无 BYOK；无真实 BYOK 场景可验收 | CONTROLLED PASS / REAL NOT EVIDENCED | 外部 Provider policy |
| G Ledger | 477 tests；每个真实 inference 追加独立 usage row，unknown usage 写 null；同一 attempt 的停止账与迟到终态写入幂等 | 本地 prod compose 正常 inference 有 `succeeded/reported` ledger；真实停止 inference 有 `cancelled/unknown` ledger 且 attempt 同步 cancelled | REAL PASS — normal + cancellation slice | 不覆盖 retry/fallback/resume ledger |
| H Retry | retry attempt 1/2 各有独立 attemptId/ledger row 的受控测试通过 | 无真实 retry inference | CONTROLLED PASS / REAL NOT EVIDENCED | 冻结 policy 后补真实证据 |
| I Compression | compression callback 写独立 ledger，unknown/reporting 均有测试 | 无真实 compression inference | CONTROLLED PASS / REAL NOT EVIDENCED | 冻结 policy 后补真实证据 |
| J Fallback | PUBLIC_FREE A 失败 → PUBLIC_FREE B 成功的受控聚合与 ledger 测试通过 | 未冻结真实 A/B Provider | CONTROLLED PASS / REAL NOT EVIDENCED | Provider 列表/政策 |
| K Resume | recovery/reissue attempt 与 append-only ledger 受控测试通过 | 未执行真实恢复后的 inference | CONTROLLED PASS / REAL NOT EVIDENCED | 真实 Worker/Provider |
| L Failure | 单次 `AiNetworkError` 保留为 attempt 级；同类耗尽聚合为 `FREE_UNAVAILABLE` | 本轮是成功路径，无真实同类耗尽证据 | CONTROLLED PASS / REAL NOT EVIDENCED | 真实同类耗尽 |
| M Secret | smoke trace 只输出脱敏字段；不输出 prompt、正文、token、Authorization；vendor 未修改 | CLI 与 Edge 证据未暴露敏感字段 | PASS | 部署日志策略复核 |

## 回归证据

- `npm run gate:milestone`：81 test files / 477 tests、TypeScript、Next production build 全通过。
- `npm run lint`：退出码 0；仅既有 warning。`app/lib/story/vendor/oh-story/**` 纳入 lint ignore，未修改 vendor 源码。
- `npm run smoke:real-llm`：在启动项目现有 postgres + one-api（使用现有 `.env` 与持久化 oneapi-data）后真实通过；`HTTP 200`，事件序列 `start/phase/delta×38/phase/done`，真实正文 234 字。脱敏 trace：`boundaryEntered=true`、`PUBLIC_FREE/one-api/deepseek-v4-flash`、`credentialOwner=platform`、`billingOwner=provider`、attempt `1916`、ledger `1079`、`usageStatus=reported`、terminal `succeeded`。
- Edge 真人式回归：匿名 CTA → `/register`；注册、建作、第一章保存；真实点击发送后约 6.7 秒返回完整续写且无泛化错误；点击插入正文后正文从 68 字变 321 字；刷新与返回作品再重入后正文、对话、插入状态保持；GLM 偏好刷新保持。此前的快速双击、失败语义与不写假正文回归仍保持通过。
- 本地 prod compose 冷启动回归：`postgres` healthy → `one-api` HTTP root healthy → `app` 启动；按 app 实际 compose 网络补齐 0000–0034 迁移后，真实 HTTP 链路注册/建作/保存/`start/delta/done`/消息持久化/插入/刷新全部通过。真实正常 job/attempt/ledger 分别为 `succeeded/succeeded/succeeded+reported`。
- 本地 prod 停止回归：真实请求收到 start 后调用停止接口并断开客户端；响应 `stopped=true`，数据库 job=`cancelled`、attempt=`cancelled/user_cancelled`、ledger=`cancelled/unknown`，停止章节无 queued/running 残留。`llm-transport` 同时显式取消 upstream reader，HTTP 章节回归 32/32。

## 发布裁决

当前为：**NORMAL PUBLIC_FREE PRODUCTION SLICE = REAL PASS；FULL GATE A–M = NOT YET COMPLETE；RELEASE READY = NOT YET。**

本轮已证明正常生成的真实纵切片（Boundary → PUBLIC_FREE → ownership → SSE delta/done → attempt/ledger/usage → Edge 展示 → 插入正文 → refresh/re-entry）通过；不应把它扩大解释为真实 retry、fallback、resume、compression 或 PUBLIC_FREE exhaustion 已通过。

在明确冻结 `PUBLIC_FREE provider / model / endpoint / credential policy / billing policy` 前，禁止接入猜测的 Provider，禁止 PLATFORM_PAID、USER_BYOK 或 production TEST_MOCK fallback，禁止开发会员和支付。冻结后仅需补齐对应真实 Gate 证据，再作最终 Release Ready 裁决。

## 生产拓扑门禁

- R1 `DOCUMENTED / PENDING FREEZE`：生产 Web 与 one-api 分离部署，Web 通过 HTTPS `ONEAPI_BASE_URL` 访问，one-api 使用独立持久化与 Secret Manager；需由发布负责人冻结 provider/model/endpoint/credential/billing ownership。
- R2 `LOCAL COMPOSE PASS / REMOTE VERIFY PENDING`：one-api 已增加 HTTP readiness，prod app 等待 one-api healthy；Cloud Run 的服务就绪、HTTPS 可达与 Secret 注入仍需部署环境验证。
- R3 `LOCAL PASS / REMOTE PENDING`：本地真实 CLI smoke 与 prod compose normal/cancellation slice 已通过；尚缺从部署后 Web 到部署后 one-api 的真实 smoke。
- R4 `LOCAL PASS / DEPLOYED TOPOLOGY PENDING`：本地 Edge 与 prod compose 已通过注册、建作、保存、真实 AI、插入、刷新、重入和停止生成；尚需最终部署拓扑冷启动后的真人验收。
