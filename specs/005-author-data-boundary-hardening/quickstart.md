# Quickstart 验证指南: 作者数据完整性与出站边界加固

**Feature**: `005-author-data-boundary-hardening` | **Date**: 2026-10-12

本文件给出**可运行的验证步骤**，用于独立复核本轮行为。全部命令在仓库根 `C:\zcode\novel-ai` 执行，使用 Git Bash。

> 前置：Node ≥ 22（本机实测 v24.18.0）、pnpm 已安装、依赖已装（`pnpm install`）。全部用例使用隔离临时书根，不触碰作者作品、账户或数据库。

## 1. 编译与静态检查

```bash
pnpm build                                    # tsc -b，期望 0 错误
pnpm --filter @mozhou/web typecheck           # 期望 0 错误
pnpm lint                                     # 期望 No issues found
```

## 2. 逐切片定点验证（快速）

```bash
# 采纳：身份前置、结果补全、意图格式
npx vitest run packages/pipeline/src/draft-accept.test.ts packages/pipeline/src/draft-accept-audit.test.ts

# 账本：追加失败、半行恢复
npx vitest run packages/runtime/src/eventBus.test.ts packages/runtime/src/eventBus.append-failure.test.ts

# 取消：等锁期间取消
npx vitest run packages/pipeline/src/draft-step.lockAbort.test.ts
```

```bash
# 出站：解压、取消分类、真实回环端到端
pnpm --filter @mozhou/web test -- --run \
  server/net/pinnedHttp.test.ts \
  server/llm/openaiStream.cancelBinding.test.ts \
  server/crawlers/provider-utils.pinned.test.ts \
  server/search/provider.test.ts \
  server/routes/draftCandidates.test.ts
```

**期望**：全部通过。其中每条针对修复窗口的用例，在修复前的实现上**必然失败**（这是本轮的回归锁标准）。

## 3. 全量回归

```bash
pnpm test:packages     # 期望 121 文件 / 1081 用例通过（另 bench 3 条）
pnpm test:web          # 期望 159 文件 / 1324 用例通过（15 skipped）
```

## 4. 推送前必过的门

```bash
node scripts/ci-gate.mjs graph-check      # 期望 status: clean / cycleCount: 0
node scripts/ci-gate.mjs import-cycles    # 期望 0 个依赖环
node scripts/ci-gate.mjs doc-gates        # 期望 exit 0（若报 STALE 先跑 node scripts/gen-architecture.mjs）
node scripts/ci-gate.mjs duplication      # 期望 exit 0
```

## 5. 手工观察点（不需要真模型）

| 观察 | 期望 | 对应契约 |
|---|---|---|
| 同一采纳请求连发两次 | 第二次正文版本不增长、结果一致 | C1 / SC-001 |
| 删除 `.mozhou/operations/<hash>.json` 后重试同一采纳 | 结果记录被补齐、正文版本不增长 | C1 / SC-002 |
| 同一幂等键换一个操作标识重试 | 409 `IDENTITY_MISMATCH`，正文与候选零变更 | C1 / SC-003 |
| 对含私网解析的域名发起出站 | 拒绝，且没有任何出站连接 | C4 / SC-006 |
| 上游返回压缩内容 | 读取结果与未压缩一致 | C4 / SC-007 |

## 6. 本轮**不**覆盖的验证（勿据此声称通过）

真实两进程争用、真实进程中断恢复、真实模型调用下的取消与恢复、真实 DNS rebinding 攻击、修复后的完整作者旅程。这些需要真实进程/凭据/受控攻击环境，本轮只有单进程用例、注入式夹具与真实回环 HTTP。
