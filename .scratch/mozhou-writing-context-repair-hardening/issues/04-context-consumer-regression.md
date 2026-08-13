# 04 — 独立与章节 Consumer 全链路回归

**What to build:** 将独立写作对话和章节写作对话接入已验证的语义/wire seam，证明写作上下文、压缩、归属、章节历史、SSE 和真实 one-api 链路在同一交付中成立。

**Blocked by:** 01 — 统一最终 Provider Wire Payload；02 — 生产 Provider 配置 Fail Closed；03 — 从最终 Payload 派生 Observer 事实
**Status:** ready-for-agent

- [ ] 独立无作品请求包含 Base Identity 和 independent Mode Contract；未绑定作品时 RAG 关闭。
- [ ] 已绑定独立会话只使用服务端确认的作品范围，客户端 novel id 不能覆盖会话归属。
- [ ] 章节请求包含合法章节历史和本轮 user；正文参考与 ConversationHistory 分离。
- [ ] 合法选区进入独立 selection 区段，非法选区不进入模型上下文。
- [ ] 短历史、长历史、压缩失败和本轮 user 不参与压缩的行为通过真实 consumer seam 验证。
- [ ] 归属失败在 provider 调用前终止，既有 HTTP/SSE 错误语义保持不变。
- [ ] SSE abort、终止单发、close-once 和安全错误回归通过。
- [ ] TypeScript、完整 Vitest、production build、数据库/HTTP consumer 验证通过。
- [ ] 真实 one-api smoke 证明独立/章节请求到达真实网关并返回正确 SSE；不把真实网关当作 scope metadata 证明。
- [ ] 干净 `0536fa9` 基线可独立构建和检查；不引入候选生命周期 schema/migration。
- [ ] 完成后重新运行 Standards/Spec 双轴 code review，并保留发布前证据。
