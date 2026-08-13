# 03 — 从最终 Payload 派生 Observer 事实

**What to build:** 让 observer 从最终语义/wire payload 派生当前 user、消息角色、数量和 system 区段等结构事实，不再把 consumer 传入的 current-user 索引当作权威来源。

**Blocked by:** 01 — 统一最终 Provider Wire Payload
**Status:** ready-for-agent

- [ ] 语义 messages 的最后一条必须是 user；wire messages 去除 system envelope 后的最后一条必须是 user。
- [ ] 缺失、错误位置和重复 current-user 的场景能被 contract 测试捕获。
- [ ] `current_user_present` 与 `current_user_occurrences` 只从最终结构派生，合法 occurrences 为 0 或 1。
- [ ] 不使用全局 content 相等去重，不记录用户消息内容。
- [ ] observer 白名单继续禁止 raw system、messages、正文、选区、RAG、Style、Skill、摘要和凭据。
- [ ] observer 写入异常仍 fail-open，不影响模型请求或 SSE。
- [ ] `payload_schema_version` 保持现有兼容语义。
