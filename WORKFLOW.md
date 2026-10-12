# 墨舟开发工作流（2026-09-30 修订）

> 目标：让 AI 写出的代码，第一次就接近可合入水平。
> 原则：**机器能拦的归机器**（hooks / CI），**机器拦不住的归 skill**（审查标准），**标准之外的归人**（拍板决策）。

## 我们手里的件

1. **MaTT 智能库** — 知识底座：历史决策、领域知识、踩坑记录。开工前先查，别重复踩坑。
2. **spec-kit**（`.specify/`）— 需求 → spec → plan → tasks 的正规流程。做功能先有 spec，不许直接开写。
3. **UVSD 协议**（`AGENTS.md`）— 工程纪律：工单边界、契约冻结、测试完整性、无人值守规则。这是红线。
4. **本仓库新增的方法论件**（2026-09-30，对标 deepseek-harness 补齐）：
   - `.agents/notes/`：AI 会话决策记录（为什么这样做、放弃了什么、怎么验证）
   - `.agents/skills/mozhou-code-review/`：合入前的尺子（含反 AI 味清单）
   - `.agents/skills/mozhou-pre-push-checks/`：push 前人工清单
   - `.agents/skills/mozhou-doc/`：文档放哪的规矩（一个事实只有一个家）
   - `lefthook.yml`：本地快钩子（pre-commit：空白 + eslint staged；pre-push：typecheck）

## 标准一轮开发长什么样

1. **查**：MaTT 智能库查相关决策和坑；GitNexus `query` 理解现状代码，不靠 grep 猜。
2. **定**：spec-kit 走 specify → plan → tasks。需要拍板的（架构决策、契约变更、模糊需求）停下问人，不猜。（UVSD §6.25）
3. **干**：按 tasks 实现，一个工单一个可观测行为；改符号前先 GitNexus `impact` 看爆炸半径。
4. **自检**：跑 `mozhou-code-review` 自查，反 AI 味清单逐条过；`detect_changes()` 确认影响面。
5. **记**：有架构取舍 → 写 `.agents/notes/`；正式决策 → `docs/adr/`（懒创建）。
6. **推**：过 `mozhou-pre-push-checks` 清单 → push 到 `feature/*` → PR 到 `develop`（不许直推 `main`）。
7. **合**：CI 全绿 + 人工 review → 合入 `develop`。

## 人和 AI 的分工

- AI 做：查资料、写代码、跑验证、自检、写记录。
- 人做：拍板架构决策、批 Contract Delta、合 PR、定优先级。
- AI 不做：猜需求、改弱测试哄 CI、直推 main、提交秘密、做臆测抽象。

## 推广到其他仓库

本 PR 的 `.agents/notes/`、`mozhou-*` skills（把前缀换成对应项目名）、`lefthook.yml`
可直接复制到其他仓库。AGENTS.md 建议追加的片段见本 PR 描述，粘贴即可。

## 下一步（还没做，按优先级）

- [ ] CI 加覆盖率门禁（`test:coverage`）
- [ ] CI 加重复代码检测（jscpd 跨文件）
- [ ] AGENTS.md 字数预算：根文件 ≤ 2000 词，超了拆到子目录 AGENTS.md
- [ ] 文档 freshness 检查：机器生成的目录 / 表格是否过期
