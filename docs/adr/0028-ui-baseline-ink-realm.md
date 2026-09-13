---
status: accepted
date: 2026-09-12
description: 'UI 视觉基线升级：采纳「MoZhou Ink Realm / 墨境」token 与材质体系（superseding ADR-0027 的色彩/材质决策，继承其信息架构与作者主权语义）'
tags:
  - mozhou
  - ui
---

# 0028. UI 基线升级：Ink Realm / 墨境（superseding 0027 的视觉层）

- **状态**：Accepted（实现授权：2026-09-12 设计验收通过）
- **前置**：ADR-0027（Ink Orbit 基线——其信息架构、17 项导航、Workbench+InspectorTower、Candidate→Approval→Commit、作者主权与真实状态纪律**全部继续有效**）
- **设计规格**：`docs/superpowers/specs/2026-09-12-mozhou-ink-realm-design.md`（已验收）+ `apps/web/prototypes/ink-realm/`（高保真原型与追踪矩阵）

## Context

设计阶段（2026-09-12）产出并验收通过了 Ink Realm 全产品设计包：东方未来主义 × 文学沉浸空间 × 精密 AI HUD × 高级卡牌信息系统。ADR-0027 的紫色单一主色（`#8b78ff` 系）、贴边后台感与「纯抽象墨流作为唯一世界背景」被验收裁决升级；但其域词汇、状态语义与实现切片纪律不变。按主规格 §0 要求，本 ADR 作为修改 runtime token 的前置授权。

## Decision

1. **色彩 token 值替换（同名换值，消费方零改动）**：`src/styles/globals.css` 基色组按 Ink Realm 语义重写——Canvas Void `#05090D`、Surface 阶冷青墨系（`#0C171E/#102029/#152832`）、Hairline 青玉系、Gold/Jade/Green/Warning/Red 语义色进场；**Gold `#D6B36A`=作者主权（Accept/Confirm/Commit/Publish），Jade `#72C9C4`=AI/系统**。旧紫 `#8b78ff` 退役为 experimental/unknown 专用（`--violet-experimental`），不再是全产品主色。`--color-primary` 等 @theme 槽位随之重映射。
2. **材质体系**：新增 `src/styles/ink-realm.css`（于 `ink-orbit.css` 之后 import），提供 Scene Glass / Ink Glass / Reading Slate / Metal Rim 四材质与 Pipeline 六态（selected/running/done/blocked/failed/unavailable）、导航金脊选中态、AI Candidate 标注、Scene System 场景层。`ink-orbit.css` 保留为过渡底座，其组件类被逐材质取代后清退（后续票）。
3. **Scene System 一等公民**：L0 Scene 图（内置 CSS 场景/用户上传）→ L1 Atmosphere（暗角+颗粒，`pointer-events:none`）→ L2 Veil+Foreground Figure（可换可关）。Scene 是**本地 UI preference（`mozhou.scene.v1`），不是 Canon**；改动不触碰正典/正文/Receipt/Pipeline 状态；云同步未上线不宣称云同步。V1 上传预算：背景 ≤8MB（JPG/PNG/WebP，≥1280px），人物 ≤4MB（透明 PNG/WebP，≥600px）；超预算 dataURL 不落盘（会话内有效并明示）。
4. **排印**：三轨维持——系统无衬线（操作）/宋体系（文学，字族首位加 "Noto Serif SC"）/Mono（证据）。正文 16–18px、lh 1.85–2.0、measure 60–75 字。
5. **触点纪律**：移动端主交互目标 ≥44px，token `--touch-target-min:44px` 统一治理。
6. **Truthfulness 纪律不变**：501 fail-closed 能力不得渲染「本地内置数据源」类矛盾徽标；accepted ≠ committed；selected pipeline stage ≠ executed。

## Consequences

- `ink-orbit.css` 中依赖旧紫的渐变/发光样式被 ink-realm.css 覆盖；WebGL 墨流（InkBackground）在 V1 退为可选路径——Scene Layer 的静帧 CSS 场景即为其允许的 static fallback；WebGL 墨流的 Jade 化重接为后续票。
- 全部 UI 测试以 className/data-testid 断言为主，token 换值不破坏行为测试；受影响快照（换肤 markup 变更处）随实现票显式更新。
- 实现按可观察垂直切片推进：地基 token → P0 真值修复 → QualityPanel 初载契约修复 → 壳层换肤 → Scene System → 对话流标注 → 移动触点。
