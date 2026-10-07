# DELTA-007：备份下载双通道——/api/backups/download 增加 GET query 通道

日期：2026-10-07　|　触发：发布审计「备份下载契约断裂」阻断项（UI 真实路径 GET ?backupId=... 恒 400）

## 变更原因

UI 下载按钮的 href 是 `GET /api/backups/download?backupId=<id>`（`apps/web/src/cloud-sync/CloudSyncView.tsx:190`），
但服务端下载分支（`apps/web/server/routes/backupRoutes.ts`）只从请求 body 读 backupId。GET 请求 body 为空
（`server/security.ts` `readRequestPayload` 对空 body 返回 `{ body: {} }`），backupId 恒为 null →
用户点击「下载备份归档文件」得到 400 INVALID_BACKUP_ID；只有 POST body 通道才能拿到 ZIP 200。
发布审计判 FAIL（阻断项）。既有测试只覆盖 POST body 通道，未覆盖 UI 实际使用的 GET/query 路径，缺陷漏网。

## 契约 Delta

| | 现状 | 变更后 |
|---|---|---|
| `GET /api/backups/download` | 无契约（实现按 body 读 id，GET 恒 400） | `?backupId=<id>` query 通道，与 POST 通道同校验、同响应 |
| `POST /api/backups/download {backupId}` | 既有 body 通道 | 不变（兼容既有调用与测试） |
| 响应（两通道一致） | — | 200 ZIP（Content-Type: application/zip；Content-Disposition: attachment; filename="<backupId>.zip"）；400 INVALID_BACKUP_ID；404 BACKUP_NOT_FOUND |

以「用户真实路径必须工作」为准：不改 UI，服务端向用户路径对齐为双通道。

## 同步修改清单

1. **Backend**：`apps/web/server/routes/backupRoutes.ts` 下载分支——GET 从 URL query 读 backupId（URLSearchParams），POST 维持 body 读取；trim + 白名单正则 `/^[a-zA-Z0-9_-]{1,64}$/` 校验两通道一致；404、Content-Type、Content-Disposition、Content-Length 行为不变。
2. **UI**：不改（`CloudSyncView.tsx:190` 的 GET query 形状即本 Delta 固化的用户路径）。
3. **Tests**：`apps/web/server/routes/backupRoutes.test.ts` 新增「下载 GET query 通道」用例：合法 id 200 ZIP（断言 Content-Type 与 Content-Disposition）、非法 id（路径穿越形状）400 INVALID_BACKUP_ID、不存在 id 404 BACKUP_NOT_FOUND；既有用例一律未改未删。
4. **契约文档**：本文件 + `api-contract.md` 第 28 节。

## 不做的事

- 不改 UI：用户路径已按 GET query 固化，由服务端对齐。
- 不放宽 backupId 白名单（`/^[a-zA-Z0-9_-]{1,64}$/`）与长度限制，两通道同强度防穿越。
- 不为 POST 增加 query 回退：通道语义保持确定性（GET=query，POST=body），不引入静默优先级。
