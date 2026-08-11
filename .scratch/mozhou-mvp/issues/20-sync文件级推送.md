# 20 — sync 文件级推送（V1.1 Journey ④）

**What to build:** WebDAV 文件级单向推送（备份语义）：作品章节 → `mozhou/<作品名>/<章节号>-<标题>.md`；手动"立即同步" + autoSync 自动（正文保存后防抖触发）；同步状态真实化。

**Blocked by:** —（契约 22 已 Frozen；syncConfigs + chapters.content 已就绪）

**Status:** ready-for-agent

**决策（spec.md Journey ④）：** 范围=作品章节正文；方向=单向推送（mtime 覆盖远端）；触发=手动 + autoSync（PATCH content 后防抖）；格式=`mozhou/<作品名>/<章节号>-<标题>.md`

**契约（api-contract.md 第 22 节）：**
- `POST /api/v1/sync/push` → 200 `{ pushed, at }` / 失败 502 可读文案
- autoSync：PATCH content 后触发（异步不阻塞）
- SYNC_PROVIDER=mock（测试）：push 返回固定成功（复用现有连接测试 mock 模式）

- [ ] 服务层 `lib/sync/service.ts`：pushToWebDAV（MKCOL 逐层建目录 + PUT 每章 md；正文为空章节跳过；SYNC_PROVIDER=mock 分支）
- [ ] 路由 `POST /api/v1/sync/push`（归属校验 + 失败可读文案）
- [ ] autoSync 触发：PATCH content 保存成功后若 autoSync → fire-and-forget push（防抖 5s？实现期定：直接触发，不做防抖——保存频率低）
- [ ] 契约测试：push 成功（mock，pushed 计数）/ 未配置 400 / 未登录 401
- [ ] sync-view：立即同步按钮（真实 push + 状态"上次推送 {time} · {N} 章"）/ 错误显示
- [ ] 契约文档已并入（22 节）

**验收：** 配置 WebDAV 后点"立即同步"→ 状态显示推送时间与章节数；autoSync 开启时保存正文自动推送。
