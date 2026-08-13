# 墨舟写作上下文修复 Hardening Spec

日期：2026-08-13  
状态：Grill 已批准；待进入 to-tickets / implement 之前的人工 Gate  ���
基线：`0536fa9`（候选生命周期引入前）  
范围：独立写作对话、章节写作对话、最终 provider payload、脱敏 observer、生产 provider 配置安全

## 目标

在不引入章节候选生命周期的情况下，让两条写作对话链共享同一写作上下文契约，并能同时证明业务语义 payload 与 provider 实际消费的 wire payload。

## 冻结决策

1. 每次写作请求都有 Base Identity 和对应 Mode Contract。
2. system 负责身份、模式和已验证参考；messages 负责可重放历史与本轮 user。
3. 本轮 user 必须是语义 messages 的最后一条 user，且只出现一次。
4. `PreparedChatRequest` 是业务语义 seam；transport 生成唯一 `ProviderWirePayload`，其 messages 为 system message + 语义 messages。
5. Capturing Provider / fake transport 必须读取 transport 实际发送的完整 wire payload；测试同时断言两个 seam。
6. Observer 从最终 payload 结构派生 current-user 事实，不信任 consumer 传入的索引，不记录 raw 内容。
7. `NODE_ENV=production` 且 `CHAT_PROVIDER=mock` 是配置错误；transport composition root 请求级 fail closed，上层只返回通用错误。
8. 未绑定作品时关闭 RAG；绑定作品、章节和 style/skill 均按服务端归属裁决。
9. 共享 SSE 只负责编码、取消、关闭和安全错误，不拥有章节领域语义。

## 明确排除

- `generationKey`、候选状态、discard、候选 replay、正文 revision/expectedContent 冲突保护；
- schema/migration 扩张；
- 新聊天 UI、embedding、Canon、多 Agent、工具调用、会员/支付；
- Cloud Run 部署在实现验收前不执行。

## 验收

- 语义 seam 测试覆盖 system sections、历史、当前 user 和 scope。
- wire seam 测试断言 fake one-api 收到的完整 messages 顺序和 role。
- observer 错误索引、缺失当前 user、重复当前 user 均能正确报告结构事实。
- 生产 Mock 配置错误不会启动 Mock 或静默切换 provider。
- 独立/章节 HTTP consumer、短/长压缩、归属失败、SSE 取消与真实 one-api smoke 通过。
- TypeScript、完整测试、production build、干净 checkout 验证通过。

## 后续独立 effort

候选生命周期另建 Spec/Contract Delta，至少覆盖 schema/migration、generationKey 幂等、状态机、章节 replay、discard、正文 revision 冲突、stop/retry/duplicate apply/并发 apply 和既有 SSE 事件契约。
