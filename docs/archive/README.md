# docs/archive — 历史档案

本目录存放**已完成或已被取代**的审计、评审、验收与发布报告。它们是证据，不是
执行依据，也不应被当作当前产品状态。

## 为什么不放在 `docs/` 一级

`docs/` 一级只保留**活的、有人维护的权威文档**（术语、架构、门清单、部署、
使用说明、开发指南）。历史报告继续堆在一级会造成两个问题：

1. **看起来像现状**——`release-report-v1.0.md` 和 `gates.md` 并排时，读者容易
   拿旧报告当现状依据。
2. **沉淀（sedimentation）**——不断加文件、不敢删，最终没人知道哪些还能信。

归档只改位置，不改内容。

## 目录

| 目录 | 时间跨度 | 内容 |
|---|---|---|
| `2026-08/` | 2026-08-12 ~ 2026-09-03 | 商业化就绪度评估、全材料审计、Web AI 交接、四项目验收矩阵、生产栈对比、V1.2 上下文契约修复计划、V1.3 RC 证据、`production-deployment.md`（已作废的 Next.js + Cloud Run 栈） |
| `2026-10/` | 2026-10-03 ~ 2026-10-10 | 模块级深度工程审计（`MOZHOU_MODULE_ARCHITECTURE_AUDIT.md`）与其复核批次（`audit-2026-10-03/`）、v0.3.0–v1.2 发布报告、W3 运营实施报告 |

## 溯源

归档于 2026-10-10（`CHG-20261010-15`）。文件内容**未作任何修改**，仅移动位置。
Git 保留了完整历史，可用 `git log --follow` 或 `git show <commit>:<原路径>` 追溯。

### 关于 `MOZHOU_MODULE_ARCHITECTURE_AUDIT.md`

它原在仓库根目录，被 `audit-2026-10-03/` 的审计文件反复引用为**被复核对象**
（`00-audit-charter.md` §4 明确「不得覆盖或编辑」）。两份一并归档到
`2026-10/`，保持这组审计的完整证据链。

### 关于 `production-deployment.md`

**已作废**，保留仅供对照：它描述的 Cloud Run + Neon Postgres + Next.js
`next start` + one-api 栈**不属于本仓库交付物**（本仓库无 `app/`、无 `drizzle/`）。
现行部署栈见 [`../deployment.md`](../deployment.md)。

## 当前文档应该去哪

| 想找 | 去 |
|---|---|
| 项目状态与版本 | `../../README.md` |
| 术语 | `../../GLOSSARY.md` |
| 架构 | `../architecture.md`（生成物） |
| 门与验证 | `../gates.md`、`../development.md` |
| 怎么用 | `../user-guide.md` |
| 怎么部署 | `../deployment.md` |
| 决策与理由 | `../adr/INDEX.md` |
| 变更溯源 | `../../PROJECT-MAP.md` |