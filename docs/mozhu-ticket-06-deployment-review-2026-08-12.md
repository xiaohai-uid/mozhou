# 墨舟 Ticket 06：生产部署审阅包

日期：2026-08-12
状态：RELEASE READY（2026-08-12；网页端人工审阅通过）。

## 当前线上事实

- 平台：Google Cloud Run + Neon PostgreSQL。
- GCP project：`mozhou-prod`。
- region：`asia-northeast1`。
- Web service：`mozhou-web`。
- 公网地址：`https://mozhou-web-7ecwvlclyq-an.a.run.app`。
- 部署前旧 revision：`mozhou-web-00005-mnd`（已保留为回滚目标）。
- 当前 100% 流量 revision：`mozhou-web-00006-wic`。
- 当前线上镜像 tag：`7db6ec4`。
- 当前线上镜像 digest：`sha256:35316beb5ec0c1d4ebde4ce0c4e4efdd2d2de5c2373911eeec0dd52b75294886`。
- one-api service：`mozhou-one-api-00002-97w`，本轮不修改。
- one-api 与 Neon schema 本轮未修改；Secret Manager 内容未修改。

## 本轮候选

- Git commit：`7db6ec4`。
- 包含 Ticket 01–06 的已批准修复。
- 本地 Docker 镜像：`mozhou-web:7db6ec4`。
- 本地镜像 manifest digest：`sha256:5d1f692dbfae9e239da976d86bd7eb3a12ed488bd3f4d97e6e33ed070a74c7b6`。
- Artifact Registry digest：`sha256:5d1f692dbfae9e239da976d86bd7eb3a12ed488bd3f4d97e6e33ed070a74c7b6`。
- 构建命令使用 runbook 已记录的镜像源回退：`BASE_IMAGE=docker.1ms.run/library/node:22-alpine`。
- 本地以 `NODE_ENV=production` 启动后 `/login` 返回 200；临时容器已清理。
- Docker Hub 直连曾因 OAuth 网络失败，未影响镜像源回退构建。

## 部署边界

批准后只执行 Web 服务候选 revision：

1. 将 `mozhou-web:7db6ec4` 标记并推送到现有 Artifact Registry；
2. 用不可变镜像 digest 或 commit-SHA tag 部署新的 `mozhou-web` revision；
3. 保持 one-api、Neon schema、Secret Manager 版本和现有回滚 revision 不变；
4. 等待新 revision Ready，先验证健康页、登录页、未登录 API 401；
5. 再执行专用 smoke tenant 的真实 UI/SSE/持久化/刷新恢复及脱敏 payload 核验；
6. 失败时只切流量回 `mozhou-web-00005-mnd`，不进容器热改；
7. 通过后记录 revision、镜像 digest、smoke 结果，状态才可标为 `RELEASE READY`。

本轮不执行：

- 数据库迁移；
- one-api 部署或配置修改；
- Secret Manager 修改；
- 删除旧 revision；
- 生产日志写入原始 prompt、正文、用户消息、token 或 cookie；
- 未经批准的流量切换或其他生产外部变更。

## 部署与 Production Smoke 结果

- 网页端人工授权：允许部署候选 `7db6ec4`，并要求先以 0% 流量候选验证；上游 TPM 429 不作为本次候选阻断，除非暴露候选特有的数据破坏。
- 候选 revision：`mozhou-web-00006-wic`，先以 0% 流量部署；健康检查通过后完成候选 smoke。
- 候选 smoke：Independent 与 Chapter 均通过真实浏览器 UI → SSE → DB 持久化 → 刷新恢复；各自 API 消息数为 2（user + assistant）。
- 429 路径：DeepSeek 一次上游 TPM 429；前端显示错误，未伪造 assistant 成功消息；改用已配置的 GLM 模型后两条链路均通过。
- 候选日志检查：最近冒烟请求无敏感 query-like 参数；不记录 raw prompt、正文、token 或 cookie。
- 切流量：`mozhou-web-00006-wic` 已切换 100%，旧 revision 保留。
- 正式 URL post-cutover smoke：通过；Independent 与 Chapter 均真实 UI → SSE → DB → 刷新恢复通过。
- 正式 URL健康检查：`/`、`/login`、`/register` 为 200；未登录 `/api/v1/account`、`/api/v1/novels` 为 401；GET `/api/v1/chat` 为 405。
- 最终状态：`RELEASE READY`。
