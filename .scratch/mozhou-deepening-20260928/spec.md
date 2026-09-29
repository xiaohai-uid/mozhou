---
date: 2026-09-28
description: '架构深化计划：Chapter Commit 收口 + 四条浅 module 深化。9 张票，逐票可交付可回滚。'
tags:
  - mozhou
  - refactor
  - spec
---

# 墨舟架构深化计划（2026-09-28）

## 为什么有这份 spec

架构审查（`C:\Users\a1691\AppData\Local\Temp\architecture-review-20260928-112529.html`）产出 5 条深化候选，
经 grilling 与事实核查后拆成 9 张票。**其中两张是纯 bug 修复，与重构无关，且今天就在流血。**

## 硬约束

- AGENTS.md §2 规则 5：一票一件事，可观察。
- AGENTS.md §2 规则 7：本计划**全部**是跨模块重构，**必须**逐票走工单流程，不得直接改码。
- AGENTS.md §2 规则 10/11：票 05 是 **Contract Delta**，需显式契约变更 + 同步 schema/实现/测试。
- 票 09 不排期——它是架构决策，不是代码问题（见下）。

## 执行顺序与依赖

```
01  commit 端点外部改盘 500        ← 纯 bug，无依赖，先做
02  adoptOpenHeads 潜伏缺陷         ← 纯 bug，无依赖
03  session 走完第 9/10 步          ← 依赖 02
04  commitChapter 深 module         ← 依赖 03
05  提交幂等（Contract Delta）      ← 依赖 04
06  Provider Resolution            ← 与 01-05 无文件重叠，可并行
07  Book Request Decoder           ← 必须排在 04 之后（同改 proseRoutes.ts）
08  句柄 seam + 守卫退场            ← 与 01-06 无冲突，净删约 200 行
09  ProposalPort 统一确认协议        ← 不排期，架构决策待定
```

## 不做的事，及原因

- **不改 events.jsonl 的存量数据。** 实测 `openHeads` 有两道闸门挡住旧 web 书的悬挂提案头
  （`openedAtPosition` 恒 null + position 比较），且 `proseRoutes.proposal.test.ts:351`
  已钉住该不变量。**不需要回填。**
- **不改 ADR-0024 的书级单飞。** 决策 4「恢复=按步边界检查点重跑」已隐含「窗口必须能走到
  第 9/10 步」，决策 1 与 4 自洽。缺的是执行（票 03），不是规格。**补一条说明即可。**
- **票 09 涉及 ADR-0010 / ADR-0023，且本质是产品形态问题**——CONTEXT.md 的定位是
  *local-first* novel operating system。hosted 模式下对账 runtime 该不该有主体，
  是「单机软件 vs 多租户服务」的战略选择，不该混在一次重构里。

## 证据

见 `evidence.md`。全部论断经二次 grep 回生产调用点核实，行数为实跑计数。
