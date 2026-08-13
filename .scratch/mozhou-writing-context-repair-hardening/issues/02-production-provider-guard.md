# 02 — 生产 Provider 配置 Fail Closed

**What to build:** 当生产环境错误配置 `CHAT_PROVIDER=mock` 时，当前写作请求明确失败，不启动模拟模型，也不静默切换 one-api；测试环境仍可显式使用 Mock。

**Blocked by:** 01 — 统一最终 Provider Wire Payload
**Status:** implemented — `132ed7c`, `d147e86`

- [x] `NODE_ENV=production` 与 `CHAT_PROVIDER=mock` 的组合在 transport composition root 被识别为配置错误。
- [x] 错误发生在 provider 消费前，不产生模拟文本，不调用 one-api。
- [x] 路由沿用既有安全错误归一化，客户端只收到通用失败信息，不泄露环境变量或内部错误。
- [x] 测试/开发环境的显式 Mock 行为保持可用。
- [x] 未配置 Mock 时仍走真实 one-api transport。
- [x] 增加请求级 HTTP/transport 回归测试，证明错误不会改变既有 SSE 领域事件语义。
