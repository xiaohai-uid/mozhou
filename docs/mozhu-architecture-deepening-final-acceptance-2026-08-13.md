# 墨舟架构深化最终验收记录（2026-08-13）

## 结论

本轮已完成并验证墨舟非支付核心写作链路的代码生产候选版本：写作上下文、模型传输、章节回放、候选生命周期、归属校验、最终 payload 观察和 SSE framing 均有实现与测试证据。

本地代码与真实 one-api 链路验收通过；本轮没有完成 Cloud Run 新 revision 的推送和流量切换。原因是当前环境的 gcloud OAuth token 刷新失败（`SSLEOF`），且没有 Application Default Credentials。不能把既有线上版本的 HTTP 200 误写成本轮代码已经上线。

## 已完成的切片

| 切片 | 内容 | 证据 |
|---|---|---|
| 1 | 统一 writing context，固定 BaseIdentity/ModeContract、system/messages 分工和 current user | `8fbc254..e5b6d25`，报告 `task-1-report.md` |
| 2 | 统一 completion/stream transport，selected model 一致，压缩 fail-open | `6dd2e0e..7cad212`，报告 `task-2-report.md` |
| 3 | 章节 replay、candidate lifecycle、ownership、revision/insert 语义 | `4bd3154..fef4849`、`91d34ad`，报告 `task-3-report.md` |
| 4 | 从最终 `PreparedChatRequest` 生成脱敏 observer；共享 SSE framing/cancel/safe error | `29a51d8..370db0f`、`74967bd`，报告 `task-4-report.md` |
| 5 前置 | legacy assistant `done` 归一化为 `completed_candidate`，保持 stopped/error/discarded/generating 不回放 | `b70d3c1`，报告 `task-5-preflight-report.md` |

## 验证证据

- 完整 Vitest：29 个文件，239/239 通过。
- payload-consumer：11/11 通过。
- 相关 replay/chat/observer/SSE/HTTP：95/95 通过。
- chat/chapter HTTP + 本地 PostgreSQL：46/46 通过。
- `npx tsc --noEmit`：通过。
- `npm run build`：Next.js 16.3.0 生产构建通过，42 个页面/路由生成。
- `npx drizzle-kit check`：通过；本地 PostgreSQL migration 已应用。
- 真实 one-api smoke：两次通过，包含注册、作品/章节、正文保存、章节 SSE、候选持久化/刷新、插入正文和正文复读。
- 浏览器本地真实链路：注册、工作台、创建作品、进入第一章、章节起笔、真实生成、插入正文，最终界面显示正文长度和“已插入正文”。
- `next start` 生产构建产物登录页：通过。

## 关键不变量

- 当前用户由最终请求 marker 观测，索引范围校验并去重；current user 由 writing-context 放在 messages 最后一条且只出现一次。
- observer 只写结构化白名单，不记录 raw system/messages、正文、selection、RAG/summary 原文、token 或 secret；observer fail-open。
- SSE 共享层只负责 framing、取消传播、终止生命周期和通用安全错误；领域事件仍由 route 产生。
- 章节 `done` 保持 `{ type: "done", messageId }`。
- candidate 状态和正文 mutation 由数据库/domain authority 决定，SSE/observer 不是事实源。
- `stopped`、`error`、`discarded`、`generating` 不进入章节 replay；legacy assistant `done` 在 replay 前归一化。

## 尚未完成：部署硬门禁

本轮未执行：

1. 使用本轮 HEAD 构建、推送 Artifact Registry 镜像；
2. Cloud Run `mozhou-web` 新 revision 部署；
3. 线上数据库迁移/版本确认；
4. 线上真实模型、SSE、持久化、候选插入 smoke；
5. 新 revision 的浏览器验收和流量切换。

现有公网 URL `https://mozhou-web-7ecwvlclyq-an.a.run.app/login` 由 `curl` 只读探测返回 HTTP 200，说明既有入口可达；不代表本轮 HEAD 已上线。Cloud Run 当前 revision 未能重新读取，原因是 gcloud OAuth refresh 失败且无 ADC。

## 上线下一步

在具备有效 gcloud 登录/ADC 后，按 `docs/production-deployment.md` 执行：构建镜像 → 推送 Artifact Registry → 部署 canary revision → 运行线上 smoke → 浏览器验收 → 通过网页端人工 Gate 后切换 100% 流量，并保留旧 revision 回滚。

