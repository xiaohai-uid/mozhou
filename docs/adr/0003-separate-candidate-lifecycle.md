# ADR-0003：将候选生命周期从写作上下文修复中隔离

- 状态：Accepted
- 日期：2026-08-13
- 范围：写作上下文修复与章节候选生命周期的交付边界
- 相关：ADR-0001、ADR-0002

## 背景

本次代码审查确认：当前提交链已经包含 `generationKey`、候选状态、回放、discard 和 revision 并发保护的部分实现，但其依赖的 `chapter_messages` schema/migration 尚未进入同一可交付提交边界。与此同时，写作上下文修复的原始目标是统一身份、模式、作品范围、消息历史、压缩和最终 payload 观察。

如果把两者继续混在一起，会得到一个无法从干净 checkout 独立构建的候选版本，也会让章节候选的外部契约在没有明确审阅的情况下随上下文修复改变。

## 决策

1. 本轮只交付写作上下文契约、最终 payload 观察和生产 Mock 配置安全。
2. 当前提交链中的候选生命周期相关实现与本轮隔离；本轮交付必须能够从干净 checkout 独立构建、测试和检查。
3. 候选生命周期另建独立 Spec/Contract Delta，明确 schema/migration、generationKey、状态机、SSE 事件、回放、discard、正文 revision 冲突和验收边界后再实现。
4. 模型输入保留两个测试边界：业务层 `PreparedChatRequest` 与 transport 层 provider wire payload。fake provider 读取 transport 生成的最终 payload，不把业务对象冒充成 HTTP body。
5. 生产环境选择 Mock 是配置错误；transport composition root 必须 fail closed，上层只向客户端暴露通用错误。

## 后果

- 上下文修复的发布候选可以在没有候选 schema 依赖的情况下独立验证。
- 候选生命周期不会因为“上下文修复”名义而绕过外部契约审阅。
- 短期内需要维护两个清晰的工作流和交付边界；这是避免不可构建提交和隐式行为变更的必要成本。

## 被部分取代的决策

ADR-0002 中把候选生命周期作为本轮深化范围的部分内容不再适用于本轮交付；其统一上下文、统一 transport、payload 观察和共享 SSE framing 的决策仍然有效。
