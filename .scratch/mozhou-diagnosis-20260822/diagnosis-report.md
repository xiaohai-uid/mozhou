# 墨舟三案只读诊断报告 — 2026-08-22

> 基线：`37965d5` main 干净。本报告只读产出，未改任何代码。等用户拍板后进修复批次。

## 案二：插入第二条全报错 —— 根因确诊（两层缺陷叠加，非竞态，必现）

### 缺陷 A（服务端·主犯）：baseRevision 严格相等守卫
`lib/novels/chapter-candidate.ts:73`
```ts
if (input.baseRevision === null || input.baseRevision !== input.chapterRevision) {
  return { ok: false, reason: "revision" };   // → ContentChangedError → 409
}
```
- 候选生成时打点 `baseRevision = 当前章节 revision`（chapter-candidate.ts:208/292）。
- 守卫要求候选生成那一刻的 revision 与插入那一刻**严格相等**。
- 因此：生成候选 A、B（同基线 R）→ 插入 A 成功（revision 变 R+1）→ **B 永久不可插**，409 ContentChanged。
- `force:true` 只豁免 expectedContent 比对（chapter-candidate.ts:617），**不豁免本守卫** → 点「仍要插入」也永远失败。与用户「第一条成功之后全报错」完全吻合。

### 缺陷 B（客户端·帮凶）：insert 响应不带 revision，保存基线停在旧值
- 服务端 `InsertResult` = `{chapter:{content,updatedAt}, messageId}`（chapter-candidate.ts:533）——**没有 revision 字段**。
- 客户端却读 `data.chapter.revision`（chapter-editor-view.tsx:626）→ undefined → `lastSavedRevisionRef` 不前进。
- 后果：第二次插入时 `saveBody()` 先行 PATCH 带 `expectedRevision=旧值`（chapter-editor-view.tsx:197），服务端 CAS 强制比对（chapters/route.ts:80 注释「携带即强制」，无内容相等豁免）→ **PATCH 先吃 409** → toast「正文保存失败，请重试」，insert 请求根本发不出去。
- DevTools 里看到的第一个 409 是 **PATCH** 的 `{code:"ContentChanged"}`；修掉缺陷 B 后才会轮到 INSERT 端点的 409。

### 修复方案（待拍板）
1. 删除 canApplyChapterCandidate 的 revision 相等规则（工程原则#2 最简实现）。防旧正文覆盖已有三层保护：expectedContent 确认 + force 二次确认 + UPDATE 的 CAS where revision=当前值，守卫属重复设防且破坏多候选顺序插入的核心工作流。
2. InsertResult.chapter 增加 revision 字段（契约变更 → 按 UVSD 走 DELTA 改 openapi.yaml）；客户端零改动即可自动前进基线（revisionAfterSave 已采纳服务器值）。
3. 测试：HTTP 级「连续插入两条候选」用例（现网必红）+ canApply 单测调整；现有并发冲突用例保持。

## 案一：技能可选挂载 —— 对照两份决策锚点的偏离清单

锚点A = 2026-08-10 R4「技能胶囊单选/多选注入 system」（commit cc41ef5）
锚点B = 2026-08-15 五要点（墨舟.md 已核对原文）

| # | 决策要求 | 现状（file:line） | 判定 |
|---|---|---|---|
| 1 | 默认技能按阶段自动调用 | 五内置技能 pre_write/post_write 门控注入（skill_definitions 种子 0022 + input gate） | ✅ 符合 |
| 2 | 五类默认创作技能 | story_grounding/chapter_planning/audience_genre/narrative_style/quality_gate 五行种子 | ✅ 符合 |
| 3 | SkillRun 证据 | generationPlans + skillRuns 落库 + 链路抽屉展示 | ✅ 符合 |
| 4 | 自定义 Skill 四要素契约 | contract!=null 才注入（custom-skills.ts:20），创建/安装均写默认契约 | ✅ 符合 |
| 5 | R4 胶囊单选/多选注入 | 胶囊可点（chapter-editor-view.tsx:115/283/884），但服务端把全部 enabled 内置技能无条件注入（chapter-chat.ts:423 `builtinDefinitions.filter(d=>d.enabled)`），**选择对内置技能无效——胶囊是摆设** | ⚠️ 半偏离 |
| 6 | 可选挂载其余技能 | workbench 正式写作链 POST /api/v1/chat payload 只有 {sessionId,model,content,novelId}（workbench-view.tsx:370），**根本不发 skills 字段** → loadCustomSkillDefinitions 收空数组 → 安装的技能永远进不了正式链，UI 也无任何加挂入口 | ❌ 主偏离 |

### 修复方案两选项（需用户拍板）
- **选项甲（诚实标注）**：胶囊只管自定义技能（真实生效，现状已通），内置五技能从胶囊摘除或标「自动」，场景技能（章节起笔/续写）保留硬载。改动最小。
- **选项乙（真实开关）**：胶囊获得对可选内置技能的真实控制权（如 audience_genre/narrative_style 可关），story_grounding/quality_gate 保持常开。需要把 chapter-chat.ts:423 改为按选择过滤 + 契约 DELTA。
- 两案共同必做：workbench 加技能加挂入口并把选中 skills[] 送进 POST /api/v1/chat（服务端已支持 input.skills，纯客户端+payload 改动）；未声明契约被跳过的技能要在 UI 显式提示（消除静默）。

## 案三：UI 巡检结论

1. **globals.css 无删除式覆盖**：7 次提交里只有 +709(0fca8e5)/+42/-14/+19/+41/-10 等，纯追加为主。但 08-21「align UI」一次追加 709 行，现文件 811 行多层设计语言叠床架屋。
2. **真正的覆盖风险在组件层**：08-18~08-22 五天内 c3dafc2(±15k 行/26 文件)、0fca8e5、113a0f3 三波大批次反复重写同一批视图。所有提交共用「王大易」身份，**git 无法事后区分哪些是用户手改**——这正是体感「我的修改总被冲掉」的机制性原因：不是某次提交恶意覆盖，而是代理大批次以 1-2 天为周期整体重写。
3. **历史完整性事故**：e2814e3(08-14) 显示 deconstruct-view/rankings-view 等 6 个文件经历过 UTF-16 事故转 UTF-8，git 记录为二进制 diff，**这些视图的事故前样式不可从 git 恢复**。
4. 处置：按用户指示转向 **UI 先行方法论**——UI 冻结可用后再接后端；后端批次不再顺手重写视图层。（此决定待记入 vault 决策记录，本会话无 om MCP 工具，留待下会话补记或由 wrap-up 钩子归档。）

## 修复批次建议顺序（待拍板）
1. 案二（半天内：删守卫 + DELTA 加 revision + 连插测试）
2. 案一选项甲或乙（先出方案再动）
3. UI 先行重做（单独立项，后端冻结期间进行）
