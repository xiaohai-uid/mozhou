---
status: accepted
date: 2026-08-30
description: 'UI 基线：采纳「Ink Orbit / 夜墨精密仪器」设计语言与专注工作台混合信息架构，legacy 深色工作台设计资产迁入 apps/web，新能力作为面板迁入'
tags:
  - mozhou
---

# 0027. UI 基线：Ink Orbit 深色工作台（legacy 设计语言 × Novel OS 面板架构）

- **状态**：Accepted
- **日期**：2026-08-30
- **来源**：grill-with-docs 会话（两轮 9 问，Q1-Q9 全部落定）+ 三轮原型对照（v2 宏观 IA 三变体 / 夜墨玻璃旗舰 / Codex「Ink Orbit」终选方案），用户终审裁决"就按 Codex 这个来"
- **前置**：ADR-0025（`app/` 冻结为遗留面，Novel OS 主线 = `apps/web + packages/*`）

## Context

用户对比 legacy A 版深色工作台（localhost:3001）、apps/web 极简切片与外部生成方案后裁决：legacy 深色工作台设计语言完胜，但要求"结合 WebGL 与高级设计语言"升维。经三轮原型迭代与功能面盘点（17 项一级功能 + 技能面 + 四新面板），用户最终采纳 Codex 产出的「Ink Orbit / 夜墨精密仪器」方案为 UI 基线。

## Decision

1. **视觉基线 = Ink Orbit（夜墨精密仪器）**：近黑分级表面承载主体视觉重量，窄幅夜墨紫能量线、内侧高光、发丝线、固定颗粒为材质体系（克制玻璃拟态）；排印双轨——系统黑体承载高密度操作信息，宋体承载作品名/章节标题/文学正文；品牌 token 逐值沿用 legacy `globals.css`（`#0b0a0f`/`#f4f1fa`/`#8b78ff` 系，基色不可偏移）。
2. **信息架构 = 专注工作台 + 指挥能力（B+C 混合）**：工作台居中且独占主要画面；左侧五组功能航道（CAPABILITY INDEX，17 项一级功能全部常驻可见可达）；**顶部八步管线为全局脊柱**（prepare/compile/draft/review/extract/continuity/proposal/commit，状态可点击、牵引背景墨迹聚焦）；右侧四面板检视塔（质量门/Story Brain/装配看板/变更矩阵）带状态摘要；Wizard 五步为首次建书覆盖层（可重放，Q3）；技能双胶囊轨（技能多选 + 风格单选）贴近输入动作，完整能力注册表抽屉承载发现与管理。
3. **WebGL 克制原则**：仅最底层低频墨流/微粒/阶段牵引光核，不覆盖正文；`prefers-reduced-motion` 下静止单帧；动效只动 transform/opacity/filter。
4. **工程落点（Q1/Q4/Q5/Q6/Q8/Q9 已锁定）**：设计语言迁入 `apps/web`（Vite+React），引入 Tailwind v4 为样式底座，token/语义类原样搬运；深色唯一主题；桌面优先（1280px 下不崩，移动端不进验收）；无路由库（视图状态 + localStorage）；技能胶囊数据源接 CapabilityRegistry（风格胶囊延后）；面板词汇遵守 CONTEXT.md 规范词（Context Receipt/装配看板，禁用 Context Viewer）。
5. **实施切片**：骨架票先行（Tailwind v4 接入 + Ink Orbit 材质体系 + 航道/管线/检视塔框架 + 存量 QualityPanel/实体网格/账本迁入换肤），随后 Story Brain、装配看板 + Wizard、变更矩阵（唯一新增后端能力 `assembleChangeMatrix`，t75 契约）、中栏写作对话流（`runDraftStep` 流式端点 + provider 配置，排三面板之后，未配 provider 显式 unavailable）。

## Consequences

- `apps/web` 新增 tailwindcss 依赖；legacy `/api/v1/*` 数据形状不迁移，面板一律直引包类型、零 any（t75 契约纪律）。
- 原型与设计材料（含设计任务书）收于 throwaway 分支 `prototype/ui-baseline-2026-08-30`，不入 master；实现票以该分支的 `codex-ui-ink-orbit.html` 为视觉规格来源。
- 「高级感」为持续验收口径：材质配比纪律（亮度阶优先于玻璃拟态、能量线窄幅、WebGL 不犯正文）随实现票执行，不因实现方便而退化。
- Open Design MCP 路线本次未启用（daemon 不可达，实测 `fetch failed`）；后续若启用不改变本基线。
