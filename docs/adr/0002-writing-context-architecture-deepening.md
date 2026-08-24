# ADR-0002：写作上下文、模型传输与候选生命周期深化

- 状态：Accepted
- 日期：2026-08-13
- 范围：`app/lib/chat`、`app/lib/novels`、聊天 API 路由及其测试
- 前置决策：ADR-0001 Writing Context Boundaries

## 背景

墨舟已经上线，当前主要风险不是页面缺失，而是两个对话 consumer 分别组装 system、history、压缩结果、章节参考和当前用户消息；测试又不能稳定观察 provider 最终收到的 payload。章节候选的生成、停止、应用和并发保护也分散在路由、service 和数据库操作之间。压缩器还直接拥有 one-api HTTP 传输，导致同一模型有两条不一致的请求路径。

这使得“代码测试通过”不能推出“模型实际收到正确上下文”，也使章节候选和 SSE 行为难以独立演进。

## 决策

### 1. 以统一写作上下文 module 作为模型请求的唯一组装入口

独立对话和章节对话都必须经过同一个 context module。module 内部使用结构化上下文区段，最终向现有 provider seam 输出 `PreparedChatRequest`：

```text
BaseIdentity
→ ModeContract
→ OwnerContext
→ ChapterReference
→ Selection
→ Style
→ Skill
→ CompressionSummary
→ KeptConversationHistory
→ CurrentUserMessage
```

外部 provider 继续接收单个 system 字符串和 messages 数组；结构化区段仅作为内部事实和可观察元数据存在。system 只表达模型应知道的上下文，messages 只表达可重放的历史事实与本轮用户消息。

### 2. 一个模型传输 module，同时提供 completion 与 streaming adapter

one-api 的 URL、认证、模型选择、响应解析和错误归一化集中在一个 transport module。流式 provider 和压缩摘要都使用该 module 的 adapter。压缩器不再读取环境变量、不再直接 fetch、不再拥有独立的 one-api 配置路径。

### 3. 明确可重放对话事实与章节候选状态

章节历史的 replay policy 固定为：

- 纳入 `user + done`；
- 纳入 `assistant + completed_candidate`；
- 纳入 `assistant + applied`；
- 排除 `generating`、`stopped`、`error`、重复的当前 user 和当前 assistant candidate。

候选 lifecycle module 负责 prepare/reuse、provider 结果 settle、stop/error settle、以及 apply 的 revision/content/race 保护。数据库 schema 不扩张；现有 `chapter_messages` 状态模型继续作为持久化事实源。

### 4. 让 payload observation 从最终请求事实派生

observer 不再接受容易漂移的人工计数作为权威来源。system section、message role、current-user index、history count 和压缩后消息数都从统一 context module 产出的最终 `PreparedChatRequest` 派生；脱敏日志只记录结构，不记录正文、token 或密钥。

### 5. SSE 只共享传输生命周期，不统一领域事件

两个 API route 使用共享 SSE framing/lifecycle/safe-error module，但继续保留各自的 `start`、`delta`、`done` payload 和领域错误码。共享 module 不拥有 novel、chapter、candidate 或 session 语义。

### 6. ownership 仍由领域 module 权威裁决

route 保留请求进入 SSE 前的快速 ownership precheck，以维持同步 HTTP 404 行为；service/domain transaction 内继续执行最终 ownership check。重复校验不是兼容层，而是不同边界的安全职责。

## 不做的事情

- 本轮不新增数据库表、字段、embedding、Canon 系统或会员/支付功能。
- 不重做现有聊天 UI；模型行为与最终 payload 是本轮验收终点。
- 不保留旧的重复上下文组装路径或旧的直接 one-api fallback。
- 不把章节领域事件强行改成独立对话事件。

## 后果

正面后果：两个 consumer 使用同一个上下文契约；压缩与流式请求拥有同一传输事实；测试可以在 provider seam 断言最终 payload；章节候选状态和 SSE framing 可以独立测试。

代价：第一阶段会触及聊天、章节、provider、压缩和 route 测试；每个切片必须先红后绿，并在进入下一个切片前完成真实模型 smoke、数据库验证和网页端审阅。

## 验收门槛

五个切片均满足以下条件才允许声称完成：

1. 单元测试覆盖新 module 的契约和失败路径。
2. HTTP 测试覆盖实际 consumer 到 provider seam 的 payload。
3. TypeScript、生产构建和完整回归通过。
4. 真实模型 smoke 能证明独立对话、章节对话、压缩和候选 lifecycle 的行为。
5. 部署后的网页端验证通过，且没有敏感内容泄露到 observation/log。

