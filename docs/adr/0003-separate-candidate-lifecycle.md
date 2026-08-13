# ADR-0003：将候选生命周期从写作上下文修复中隔离

- 状态：Accepted
- 日期：2026-08-13

当前提交链中的候选生命周期实现依赖尚未进入同一交付边界的 schema/migration，并且扩大了写作上下文修复的外部语义。决策是：本轮只交付写作上下文、最终 payload 观察和生产 Mock 配置安全；候选生命周期另建 Spec/Contract Delta，覆盖 schema/migration、generationKey、状态机、SSE、回放、discard 与正文 revision 冲突后再独立实现。
