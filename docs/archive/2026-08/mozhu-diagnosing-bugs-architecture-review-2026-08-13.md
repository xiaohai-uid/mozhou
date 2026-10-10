# 墨舟架构审查问题诊断记录

日期：2026-08-13  
诊断基点：`v1.2.0-production-live` / `4a1c18e`  ���
当前提交：`075d0ae`  
范围：代码审查发现的四个候选阻断问题；本记录只包含诊断，不包含业务修复。

## Phase 1–2：反馈闭环与最小复现

临时诊断测试曾写入 `app/tests/unit/diagnostic-architecture-review.test.ts`，运行后已删除；没有保留诊断测试或业务改动。

### 1. 生产 Mock 保护

命令：

```text
cd C:\zcode\novel-ai\app
npx vitest run tests/unit/diagnostic-architecture-review.test.ts --reporter=verbose
```

输入：`NODE_ENV=production`、`CHAT_PROVIDER=mock`。  
结果：稳定失败。输出包含 `（模拟流式输出）`。  
根因已确认在 `app/lib/chat/llm-transport.ts:215`：只按 `CHAT_PROVIDER` 选择 Mock，没有环境保护。

### 2. Capturing Provider 与 one-api 最终 messages

输入同一份 `PreparedChatRequest`，system 为 `【base_identity】\n墨舟`，messages 只有当前 user。  
结果：稳定失败。捕获结果：只有 user；fake one-api 收到：system + user。  
根因已确认：`capturePreparedChatRequest()` 保存 `request.messages`，而 `requestMessages()` 在 `llm-transport.ts` 发送前额外前置 system。当前测试 seam 观察的是准备对象，不是完整 wire payload。

### 3. Observer 当前 user 计数

输入最终 messages 为 `[历史 user, 历史 assistant]`，但调用方提供 `currentUserIndices=[0]`。  
结果：稳定失败。Observer 报告 `current_user_occurrences=1`、`current_user_present=true`。  
根因已确认：`buildPayloadObservation()` 信任调用方索引；它没有独立验证“最后一条 user”或当前请求身份。此前“非 user 索引会被过滤”的测试是弱信号，不能覆盖错误指向历史 user 的情况。

### 4. 干净 HEAD 的候选 schema 边界

命令：读取 `git show HEAD:app/lib/novels/chapter-candidate.ts` 与 `git show HEAD:app/lib/schema.ts`，比较候选字段。  
结果：稳定失败，HEAD 的候选代码引用 `generationKey`、`requestHash`、`baseRevision`、`updatedAt`，HEAD schema 缺少至少 `generationKey`、`updatedAt`；对应 schema/migration 只在当前未提交工作树出现。  
结论：当前 HEAD 不是可独立 checkout/build 的候选生命周期交付物；这是交付边界问题，不是可以通过测试全绿推断为已解决的问题。

## Phase 3：按优先级排列的可证伪假设

1. `CHAT_PROVIDER=mock` 生产保护缺失是 Mock 误投产的直接原因；增加 `NODE_ENV` 限制后固定模拟输出应消失。
2. payload seam 的定义停在 `PreparedChatRequest`，而 transport 负责 system envelope；若把捕获与 wire envelope 统一，captured messages 应与 fake one-api body 一致。
3. Observer 的 current-user 元数据是派生事实却以 caller indices 为权威；从最终 messages/明确 current-user 标识重新派生后，错误索引场景应报告 0 或失败，而不是 1。
4. 候选生命周期代码与 schema/migration 未在同一提交边界；提交 schema/migrations 或从 HEAD 移除依赖后，干净 checkout 才能通过对应类型/Drizzle 检查。

## 当前诊断结论

- 四条反馈闭环均已运行；其中前三条为代码行为红测，第四条为干净提交边界红测。
- 目前没有应用修复；临时诊断测试已删除，工作树的用户既有改动保持不变。
- 修复前需要通过 `grill-with-docs` 明确候选生命周期与 generationKey 是否纳入本轮，以及补充 Contract Delta；不能直接把范围扩张或未提交 schema 一并部署。
