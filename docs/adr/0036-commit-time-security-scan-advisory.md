---
status: accepted
date: 2026-10-08
description: '提交/推送时 Mimosa 安全扫描长期不完整（scanner_enobufs）时的处置：保持 advisory 不阻断写入，明示「不得宣称项目安全」的后果与复核条件，并给出切 strict 的触发条件'
tags:
  - mozhou
---

# 0036. 提交时安全扫描保持 advisory（扫描结论不完整时的处置）

- **状态**：Accepted
- **日期**：2026-10-08
- **来源**：GitHub 议题 #95（`/retro` 会话候选）；决策过程见 [CHG-20261008-21](../changes/CHG-20261008-21-release-stamp-and-local-graph-gate.md) §3.3
- **前置**：ADR-0031（单一流程权威）

## Context

2026-10-08 实测的安全扫描现状（两条路径表现不同）：

| 路径 | 表现 | 证据 |
|---|---|---|
| 提交/推送钩子 | **恒不完整**：`scanner_enobufs`，提示「未取得完整扫描结论」 | 2026-10-08 三次提交钩子均报此错 |
| MCP 扫描（`security_scan`） | **可完整**：919/919 文件解析、无截断 | `~/.mimosa/security-scans/project-4d5b…/scan-2026-10-06…/coverage.json`：`completeness: "complete"` |

插件的失败模式旋钮（`mimosa/1.0.3/payload/README.md:79-80`）：

- `MIMOSA_HOOK_FAILURE_MODE=open|strict`（默认 `open`）
- `MIMOSA_GIT_GATE_FAILURE_MODE=open|strict`（未设时继承上一个）
- `MIMOSA_HOOK_STRICT=1`（等价 strict）

`strict` 会在「候选缺失、扫描失败、坏输出或 partial coverage」时于写入前直接 **deny**。

问题在于：当前默认 `open` 让一个**永远不说话**的安全门看起来像存在——它既不阻断，也不给出结论。

## Decision

1. **保持 `open`（advisory）**：扫描不完整**不阻断**写入与提交。理由：缓冲问题未解决前切 `strict` 会立刻阻断**全部**提交，把一个环境问题升级成停工。
2. **后果明示**：任何「项目安全」的宣称**无效**。安全结论长期缺失是一项**挂账项**，不得当作已通过；发布审计与交付报告必须写明「未取得完整安全扫描结论」。
3. **切 `strict` 的触发条件**（任一满足即复议本 ADR）：
   - 扫描器缓冲/范围问题解决——钩子路径与 MCP 路径都能 `complete`；
   - 对外分发（公开或商业上线）前的安全复核窗口。
4. **复核方式**：每次发布审计在报告里写明①扫描完整性状态、②是否有结论；缺结论一律标 `unverified`，不得以「扫描已运行」代替「有结论」。

## Consequences

- **正面**：环境级扫描故障不再阻断全部提交；状态如实（不完整就是不完整），不产生虚假的安全通过。
- **负面**：提交时没有安全门，只能靠发布审计与人工复核兜底；本 ADR 只定义「不完整时怎么办」，**不解决**扫描器本身的缓冲问题（属上游/环境）。
- **可逆**：把 `MIMOSA_GIT_GATE_FAILURE_MODE` 设为 `strict` 即可切换为阻断式；本 ADR 给出切换前的条件，避免在缓冲问题未解决时盲目切换。
