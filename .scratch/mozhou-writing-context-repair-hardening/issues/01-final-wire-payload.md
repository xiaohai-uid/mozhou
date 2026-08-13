# 01 — 统一最终 Provider Wire Payload

**What to build:** 让独立对话、章节对话和压缩请求都通过同一条传输转换，把语义层写作请求转换为 provider 实际消费的完整 wire payload；测试可以同时观察语义 payload 与最终 provider body。

**Blocked by:** None — can start immediately
**Status:** implemented — `132ed7c`, `d147e86`, `8b79968`

- [x] `PreparedChatRequest` 继续表达 system、语义 messages、本轮 user 和脱敏 scope metadata。
- [x] transport 拥有唯一的 wire payload 转换，system message、语义 messages、model 和 stream 参数顺序明确。
- [x] completion 与 streaming 共享同一转换规则，仅 stream 参数不同。
- [x] fake transport/capturing adapter 读取转换后的最终 payload，而不是复制 route 或 context builder 的中间对象。
- [x] 真实独立/章节 consumer 测试能断言语义 seam 与 wire seam 的对应关系。
- [x] 现有对外请求字段、SSE 领域事件和数据库语义不变。
- [x] 不引入候选生命周期字段、schema 或 migration。
