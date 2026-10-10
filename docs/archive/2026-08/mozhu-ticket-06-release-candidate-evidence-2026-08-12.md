# 墨舟 Ticket 06：Release Candidate 证据包

日期：2026-08-12  
范围：仅修复 HTTP 测试中共享 payload observer 的证据隔离问题；没有修改产品 Context Contract、provider 选择、API 行为或生产配置。

## 结论

本地候选版本满足 Ticket 06 的回归要求，状态为：

> READY FOR DEPLOYMENT REVIEW

这不是生产发布批准。没有执行部署，也没有执行修复后的 Production Smoke。

## 代码变更

- `app/vitest.config.ts`
  - HTTP 项目关闭文件级并行，并限制为一个 worker。
  - 原因：HTTP 测试共享同一个真实 Next dev server 和脱敏 observer 文件，文件并行会造成观察记录跨测试串读。
- `app/tests/http/chat.test.ts`
  - 记录请求前的 observer 行数，只在新增观察记录中查找当前测试的 payload。
  - 没有放宽断言，也没有读取或记录正文、完整 prompt、摘要、认证信息。

## 自动化回归

执行命令（工作目录 `app/`）：

```text
npx tsc --noEmit                         PASS
npx vitest run tests/unit tests/http --reporter=dot
  Test Files 20 passed (20)
  Tests      175 passed (175)
npm run build                            PASS
git diff --check                         PASS
```

HTTP 测试的 observer 共享文件已通过串行化保证证据隔离；测试中没有关闭、跳过或弱化产品行为断言。

## 浏览器真实链路

使用本地 Chrome + Stagehand 的真实浏览器执行回归，应用使用确定性的 mock provider，避免把模型偶然成功误认为 payload 正确。浏览器操作覆盖：

1. 注册并登录；
2. 创建作品、章节并保存章节正文；
3. 独立写作对话：通过 UI 输入、发送、接收 SSE、刷新页面、重新打开已持久化会话并恢复消息；
4. 章节对话：通过 UI 输入、发送、接收 SSE、刷新页面并恢复章节消息；
5. 检查最终 observer 结构且确认没有出现原始用户内容。

浏览器结果：PASS。

脱敏 observer 结构（仅结构，不含正文或 prompt）：

```json
{
  "route": "chat",
  "system_sections": ["base_identity", "mode_contract"],
  "message_count": 1,
  "current_user_occurrences": 1,
  "owner_scope_resolved": true
}
{
  "route": "chapter-chat",
  "system_sections": ["base_identity", "mode_contract", "chapter_reference", "skill"],
  "message_count": 1,
  "current_user_occurrences": 1,
  "chapter_scope_present": true,
  "owner_scope_resolved": true
}
```

浏览器测试临时 observer 文件在回归结束后已删除；仓库不保存原始 payload 或临时账号信息。

## 真实 one-api smoke

执行现有脚本：

```text
node scripts/smoke-real-llm.mjs
```

结果：PASS。真实网关、模型响应、SSE delta/done、消息持久化、AI 结果写入正文的完整链路均成功。该 smoke 只证明真实 provider 链路正常，与上面的内部 observer 结构证据分开；没有记录或写入密钥、完整 prompt、小说正文或认证信息。

## 代码审阅

- Standards：PASS；没有发现仓库标准违规或可执行的 Fowler smell。
- Spec：实现方向符合 Ticket 06；改动仅限测试证据隔离，没有产品行为 scope creep。

## 发布边界

- 当前状态：READY FOR DEPLOYMENT REVIEW。
- 禁止由本票自动部署生产。
- 禁止在未获得单独部署批准前执行修复后的 Production Smoke。
- 后续只有在人工审阅批准候选版本后，才可另行讨论“部署候选版本 → Production Smoke → 流量决策”。
