# DELTA-004：技能可选挂载——开关型内置技能 + workbench 加挂入口

日期：2026-08-22　|　触发：用户拍板「选项乙：真实开关」（诊断报告 .scratch/mozhou-diagnosis-20260822/）

## 决策依据（不新增需求，回归既有拍板）

- R4（2026-08-10）：chat 风格/技能胶囊，单选/多选注入 system。
- 2026-08-15 五要点：默认技能按阶段自动调用 + 五类默认创作技能 + 自定义 Skill 四要素。

## 变更内容

1. **内置技能分两类**：
   - 基础设施型（始终注入，不进胶囊）：`story_grounding`（故事状态）、`quality_gate`（成稿质量门）；
   - 开关型（进胶囊，用户可选可关）：`chapter_planning`（章节规划）、`audience_genre`（读者与题材）、`narrative_style`（叙事声音）。默认全选，对齐「默认技能按阶段自动调用」。
2. **注入过滤**：三个注入点（chapter chat 主链 / chapter chat post_write / independent chat）由
   `selectBuiltinDefinitions(definitions, input.skills)` 统一过滤——开关型未出现在 skills[] 即不注入。
   此前服务端无视用户选择、全部 enabled 内置技能无条件注入（胶囊为摆设）。
3. **workbench 加挂入口**：POST /api/v1/chat 的 body.skills 语义扩展为
   「我的技能 + 开关型内置技能」；workbench UI 增加技能胶囊行并随请求发送 skills[]
   （此前 workbench 不发送 skills 字段，安装的技能永远进不了正式链）。
4. **GET /api/v1/skills?scope=plaza** 的 builtinSkills[] 每项新增 `toggleable: boolean`，
   客户端据此渲染胶囊，不硬编码技能清单。

## 同步面

- openapi.yaml：/api/v1/chat 与 /api/v1/novels/{id}/chapters/chat 的 body.skills 描述更新；
  skills plaza 响应新增 toggleable
- 实现：lib/runtime/skill-registry.ts（TOGGLEABLE_BUILTIN_KEYS + selectBuiltinDefinitions）、
  lib/novels/chapter-chat.ts（2 处）、lib/chat/service.ts（2 处）、
  app/api/v1/skills/route.ts、chapter-editor-view.tsx、workbench-view.tsx
- 测试：tests/unit/builtin-skill-selection.test.ts（选择器逻辑）、
  tests/http/chapter-continuation.test.ts（按选择过滤的 plannedSkills 证据断言）

## 不做的事

- 场景技能（章节起笔/章节续写）维持现状：硬载直拼注入，不进运行时选择（用户认可的部分）。
- 自定义技能契约门不变（contract != null 才注入，ADR-0002 决策 7）。

## 与上游 spec 的取代关系（2026-08-22 对照审查补充，不改冻结文档原文）

1. **spec.md Journey ⑦ 的胶囊组成描述已被收窄**：spec 原文「场景技能 + 墨舟广场技能（去AI味/人物小传/信息差设计）+ 用户自定义」；
   冻结契约 21（V1.1）落地为「场景技能 + 我的技能（已安装）」，广场件需先安装进我的技能。
   实现遵循契约 21；本 DELTA 新增的开关型内置是第三类（0815 五要点「五类默认创作技能」），三类并存。
   spec.md 为历史 MVP 文档，按 UVSD 规约不在原文件回改，以此处为准。
2. **注入顺序中「风格」段的归属**：契约 21 L51「正文参考→RAG→风格→技能」写作时风格为直拼段；
   工单 04 已改为由叙事声音执行器产出 style_note（执行器头注明确「替换 style 直拼，不保兼容原则」）。
   因此 styleId 仅在叙事声音被选中时生效——未选中而携带 styleId 时风格段静默缺席，这是设计行为非缺陷。
