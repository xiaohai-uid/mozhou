# Contract Delta 001：语义 payload 与 wire payload 双 seam

状态：待实现前审阅  
日期：2026-08-13

## 变化

内部新增明确的 `ProviderWirePayload` 概念。`PreparedChatRequest` 保持语义层结构；transport 唯一负责把可选 system 转成 provider messages 中的 system message，并与语义 messages 拼接。

## 不变

- 对外 chat/chapter chat 请求字段不变；
- SSE 事件名称、领域字段和章节消息状态不因本 Delta 改变；
- 生产 observer 仍只记录脱敏结构；
- 不引入数据库迁移。

## 验收

测试必须同时读取 `PreparedChatRequest` 与 fake transport 捕获的 `ProviderWirePayload`，并证明二者符合转换关系。
