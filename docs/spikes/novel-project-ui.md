# Spike: 项目页信息架构（Novel Project UI）

- **日期**: 2026-08-09
- **风险类型**: 交互/信息架构（章节+人物库+世界观一页怎么组织）
- **分支**: `prototype/novel-project-ui`（`app/app/prototype/novel-project` + `prototype-switcher.tsx`，3 变体 A/B/C 浮动切换）
- **结论**: ✅ 三栏工作台布局胜出（章节列表 / 人物库 / 世界观设定 并排），已并入工单 05 的 projects-view 真实实现
- **Reproduction**: 分支保留 3 变体代码，`git show prototype/novel-project-ui` 可回放

## 探针问题
小说项目详情页需要同时呈现章节（多、可排序）、人物库、世界观设定，一页怎么组织不拥挤、不割裂。

## 关键决策
1. **变体 A（三栏工作台）胜出**：`grid lg:grid-cols-3` 并排人物库/世界观/章节，每栏独立滚动，左侧作品列表。选中即真实数据（05 工单落地 `projects-view.tsx`）。
2. **变体 B/C（分段导航 / 大纲+抽屉）**：否决 —— 多一跳交互，且章节是主频操作应常驻可见。
3. 后续 RAG 注入配置、审查记录、导出区块在 A 基础上向下追加（不挤占三栏）。

## 验证证据
- 浏览器实测 3 变体切换（浮动 bar）
- 工单 05 契约测试 `tests/http/novels.test.ts`（19 用例）覆盖真实 CRUD

## 相关
- 主线实现：`app/components/features/projects-view.tsx`
- 归档：V1.0 已随 `v1.0.0-release` 冻结
