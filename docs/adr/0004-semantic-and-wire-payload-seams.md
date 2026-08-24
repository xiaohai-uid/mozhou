# ADR-0004：写作请求保留语义 seam 与 wire payload seam

- 状态：Accepted
- 日期：2026-08-13

墨舟的写作上下文修复保留两个不同但都必须可验证的边界：业务层 `PreparedChatRequest` 表达 system、历史 messages 和本轮 user；transport 层生成 provider 实际消费的完整 wire payload，其中包含前置 system message。测试同时断言两层，避免把业务对象误认为 HTTP body，也避免让各个 route 自行组装 provider payload。生产观察继续只记录脱敏结构。
