---
status: accepted
date: 2026-08-15
---

# ADR-0006：Skill 运行时与 A 版双栏工作台进入真实产品

## 背景

原型工作区（`sites-plugin-sites-openai-bundled`）已接受两项决策：

- ADR-0002「Skill 运行时与正式写作链」：技能必须带输入契约、阶段、执行器、结构化输出与 SkillRun 证据；五个内置默认创作技能按阶段自动路由；MarketBrief / BenchmarkPack 结构化回流。
- ADR-0003「墨舟工作台采用 A 版双栏写作台」：登录后工作台 = 左栏（作品/章节/人物/世界观/专项工具）+ 中栏（AI 先提问、自由回答一级入口、快捷起点、最近正文、候选生成）+ 右栏（本次创作链路、默认技能状态、ContextAssembler 产物、绑定参考）；移动端折叠左右栏 + 底部导航 + 证据进二级面板。

本仓库（`C:\zcode\novel-ai`）现状：技能 = `skills` 表（名称+systemPrompt），runChat/runChapterChat 把选中技能原文拼进 system；RAG/风格/市场直拼注入链；无 SkillRun 证据；工作台为静态欢迎页 + 独立对话页；无移动端布局。审计（原型工作区 `outputs/mozhou-skill-integration-audit.md`）判定这是「假接线」：有适配器 ≠ 已接入正式写作。

## 决策

1. 在真实产品中实现 Skill 运行时：SkillDefinition / SkillRun / GenerationPlan / GenerationManifest / ArtifactRef / ContextAssembler，契约按 `.scratch/mozhou-workbench-a/contracts/01-技能运行时契约.md` 冻结（FROZEN，变更须 Contract Delta）。
2. 内置五个默认创作技能（story_grounding / chapter_planning / audience_genre / narrative_style / quality_gate），互斥、按阶段触发；AI 味预检是质量门的写后检查组，与叙事声音不同阶段。
3. 采用 A 版双栏写作台作为产品工作台基线，在真实代码中重写（原型仅作交互参考，不复刻原型代码/样式）。
4. 自由回答是一级入口；「AI 先提问」状态在任何模板选择之前可见；模板是次级入口（对齐 CONTEXT.md「创作模板」语义）。
5. 默认开启 = 按阶段自动路由调用，不是每轮全量注入。
6. 只重写原型方向，不把原型工作区未跟踪文件带入产品仓库（handoff 约束）。

## 取舍

- 不采用 B 版沉浸式/C 版指挥台作为主布局（保留为局部交互参考）。
- 不保留「每轮注入全部技能资料」的旧模式（token 成本与噪声）。
- 不为自定义技能造完整执行器体系（本期自定义技能保持显式注入，但 UI 如实标记接入状态，不做假接线）。
- 公共模板市场二期；BenchmarkPack 本期私有。

## 实现入口

- Spec：`.scratch/mozhou-workbench-a/spec.md`；契约：`.scratch/mozhou-workbench-a/contracts/01-技能运行时契约.md`；工单：`.scratch/mozhou-workbench-a/issues/01-08`。
- 执行器注册表、ContextAssembler 与 SkillRun 落库在工单 01（运行时骨架 + 故事状态技能，tracer bullet）落地；UI 在工单 07。

## 验收约束

一个技能只有同时具备真实 executor、明确输入来源、结构化输出、正式写作/质量门消费点、SkillRun 证据、失败/降级语义和端到端测试，才能在产品 UI 标记为「已接入」。
