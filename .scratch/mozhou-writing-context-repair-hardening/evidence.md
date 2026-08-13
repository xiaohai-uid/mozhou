# Hardening Evidence

## 基线

- Git baseline：`0536fa9`
- 该基线不包含候选生命周期提交及其未提交 schema/migration 依赖。
- 当前 worktree 从该 commit 独立创建，初始状态干净。

## 已确认缺陷

1. production + `CHAT_PROVIDER=mock` 会输出模拟流。
2. `PreparedChatRequest.messages` 与 one-api wire messages 之间存在 system envelope 差异。
3. observer 依赖 caller-provided current-user indices，错误指向历史 user 时会误报。
4. `075d0ae` 之后的候选实现依赖未提交 schema/migration，已从本 hardening 基线隔离。

## 证据边界

本文件记录诊断事实，不声称已修复；修复必须先红后绿，并在真实 consumer 与 transport seam 验证。
