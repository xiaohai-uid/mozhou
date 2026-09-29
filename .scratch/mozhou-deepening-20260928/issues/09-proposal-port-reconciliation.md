---
title: ProposalPort 的 reconciliation 分支零生产调用方【不排期】
status: wontfix
---

## 状态

**架构决策待定，不排期。** 本票记录事实，供将来决策。

## 问题

`proposal-port.ts:2-6` 宣告「一个 Port，两个调用方 … 共用同一确认协议 confirm/reject/editAccept，逐条粒度」，
CONTEXT.md 也把 Proposal Port 定义成两条流程**统一**的确认 API。生产代码不是这样：

- `pipelineRoutes.ts:858-865` 走 port ✓
- `reconciliationRoutes.ts:437` **直接调** `service.decideItems(proposalId, acceptedItemIds)`，
- :458 调 `dismiss()`，:479 调 `retryExtraction()`

⇒ port 自己的 `port:'reconciliation'` 分支（`proposal-port.ts:344-390`，:378 确实调了 `decideItems`）**零 route 调用方**。

两套决策协议、两种粒度（逐条 vs 整数组）、两个待决存储（`prp_*.json` vs `port_rcln_*.json`）。

## 为什么不给排期

它触及 **ADR-0010 / ADR-0023**（两条都默认了「按书根的进程级 runtime」），
而它本质是**产品形态问题**：hosted 模式下对账 runtime 该不该有主体。

CONTEXT.md 的定位是 *local-first novel operating system*——**单机优先**。
「墨舟是单机软件还是多租户服务」是战略选择，不该混在一次重构里。

## 事实（已核实）

- 提案存储**双向可读、互不覆盖**：同目录 `.mozhou/proposals/`，不同前缀（`prp_<ULID>.json` / `port_rcln_<id>.json`），
  不同结构。切换调用方**不产生存量兼容问题**。
- 恢复时未决提案读自 `listCanonProposals`（`proposal-step.ts:188-201`）→ 过滤 `state==='open' && 有 pending item`（`proposal-port.ts:244-248`）。
- 校验锚：`proposalVersion !== 1` 即返回 null（`proposal-step.ts:180`）——**没有版本迁移，不认的即当不存在**。

## 待决问题

hosted 模式下，对账 runtime 归谁？选项与代价需产品侧判断，**不在工程决策范围内**。

