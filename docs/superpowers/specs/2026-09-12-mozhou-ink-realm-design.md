# MoZhou Ink Realm / 墨境 — 全产品 UI/UX 设计规格

> 状态：Design Approved / Implementation Not Authorized
>
> 日期：2026-09-12
>
> 适用主线：`apps/web`
>
> 目标：把现有 Ink Orbit / 夜墨精密仪器升级为 **MoZhou Ink Realm / 墨境**，在不牺牲任何真实功能、状态语义、作者主权与证据可见性的前提下，建立“东方未来主义 × 文学沉浸空间 × 精密 AI HUD × 高级卡牌信息系统”的墨舟专属设计语言。

---

## 0. 本规格的权威边界

本规格不是“重新发明墨舟”，也不是以视觉稿覆盖真实代码。设计时按以下优先级取事实：

1. 当前 `apps/web/src` 实际挂载关系与组件代码。
2. 当前 `apps/web/server/api.ts` 与 `server/routes/*` 的真实数据契约、路由顺序和 truthfulness gate。
3. `CONTEXT.md`、`AGENTS.md` 与现有 domain vocabulary。
4. `docs/adr/0027-ui-baseline-ink-orbit.md` 中仍有效的作者主权、管线、信息架构与 WebGL 克制原则。
5. 本规格定义的新视觉方向与 Scene System。
6. 外部设计参考只能回答“怎么表达”，不能覆盖“产品是什么”。

### 与 ADR-0027 / `apps/web/DESIGN.md` 的关系

- **继续有效**：17 项一级能力、8 步 Pipeline、Workbench + Inspector 架构、Candidate → Approval → Commit、Quality Gate、Story Brain、Context Receipt / 装配看板、Change Matrix、显式 unavailable/blocked/stale/error、作者主权、真实状态优先。
- **拟被升级**：紫色单一主色、贴边三栏后台感、纯抽象墨流作为唯一世界背景、统一卡片材质、桌面优先而移动端次要的旧视觉假设。
- 本规格处于“设计已批准、代码尚未实施”阶段；真正修改 runtime token 前，应在实现阶段新增一条 superseding ADR。设计阶段不得为了方便直接改旧 ADR 或伪装已完成迁移。

---

# 1. Code-Graph Alignment：本设计从代码图谱反推，而不是从截图猜

本次规格按以下图谱层级核对：

```text
App entry graph
  ├─ Desktop shell graph
  │   ├─ TopBar
  │   ├─ CapabilityChannels / 17 views
  │   ├─ PipelineStrip / 8 stages
  │   ├─ Center view switch
  │   ├─ InspectorTower / 4 panels
  │   ├─ WizardOverlay
  │   └─ DesktopToolModals
  │
  ├─ Mobile shell graph (<768px)
  │   ├─ WorkbenchHub
  │   ├─ InspectorHub
  │   ├─ WorksHub
  │   ├─ ResourcesHub
  │   ├─ SystemHub
  │   └─ Drawer system
  │
  └─ Server route graph
      ├─ storyBrainRoutes
      ├─ pipelineRoutes
      ├─ worksRoutes
      ├─ truthfulPreviewRoutes
      ├─ crawlerRoutes
      └─ systemRoutes
```

关键纪律：**一个页面“代码存在”不等于“当前产品已上线”。** 本规格把页面分成三类：

- **A — Mounted / Truthful Live**：当前入口真实挂载，且数据面可用。
- **B — Mounted / Explicitly Blocked or Partial**：入口存在，但真实前提缺失，必须展示 unavailable/partial。
- **C — Code-present / Unmounted or Experimental**：源码已经存在，但当前 App 图谱未把它作为正式可达能力；设计必须保留它的未来位置，但不得把它画成已上线事实。

本地代码树还包含 `.gitnexus/` 索引，以及比顶层导航更细的 editor / canon-graph / genre-kits / export-suite 子系统，因此设计验收不能只数 17 个导航项。

---

# 2. 产品设计命题

## 2.1 核心一句话

> **用户不是在一个黑色后台里写小说，而是进入自己的小说世界；墨舟是一套悬浮在这个世界之上的精密创作仪器。**

视觉分成两套彼此独立但协作的系统：

```text
作品世界 World Layer
    ↓
氛围层 Atmosphere
    ↓
墨舟创作仪器 Instrument Layer
    ↓
作者内容 / AI 证据 Content & Evidence
```

## 2.2 情绪目标

- 第一眼：深、静、昂贵、有世界感。
- 工作 30 分钟后：不疲劳、不抢正文、不妨碍判断。
- 出问题时：比“好看”更快地看清失败、stale、blocked 和证据。
- 做作者决策时：明确感到“AI 建议，作者裁决”。

## 2.3 不做“游戏皮肤”

参考的是高端东方策略游戏的空间感、材质、卡牌和层级，不复制任何现有游戏 Logo、角色、卡面、图标、官方资产或完整布局。

---

# 3. Scene System / 墨境场景系统

这是本次新增的一等公民功能，不是固定背景图。

## 3.1 三层解耦

### Scene Layer
世界环境：海城、云海、雨夜都市、未来长安、书斋、太空巨构、荒漠等。

### Atmosphere Layer
对场景进行统一可读性处理：暗幕、冷暖色调、暗角、颗粒、轻雾、局部光照、极低频 WebGL 墨流。

### Foreground Figure Layer
人物 / 角色 / 剪影 / 前景主体，**必须与背景独立**。用户可单独替换、隐藏和调整。

## 3.2 V1 必备能力

- 内置静态 Scene 选择。
- 上传 JPG / PNG / WebP 背景。
- 上传透明 PNG / WebP 前景人物。
- 人物显示 / 隐藏。
- 人物左 / 中 / 右锚点。
- 人物缩放、透明度。
- Scene focus X / Y。
- 背景亮度。
- 背景模糊。
- Shadow veil / 暗幕强度。
- 全局默认 Scene。
- 每本作品可覆盖全局 Scene。
- 切书时切换对应 Scene Profile。

## 3.3 V1 明确不做

- 视频背景。
- 场景商城。
- 自动从小说正文生成场景。
- 复杂滤镜编辑器。
- 3D 人物模型。

## 3.4 状态与持久化语义

Scene 是**界面偏好，不是小说 Canon**。V1 定义为本地 UI preference：

- 无当前书：使用 global profile。
- 有当前书且有 override：使用 book profile。
- 有当前书但无 override：继承 global profile。
- 删除 book override：回退 global。
- 任何 Scene 改动都不得修改正典、正文、Receipt 或 Pipeline 状态。
- 云同步未上线时，不宣称 Scene 已云同步。

## 3.5 场景设置入口

Top HUD 提供「场景」入口，优先使用右侧 non-blocking Sheet，而不是中心 Modal。Sheet 分为：

1. 场景
2. 氛围
3. 人物
4. 作用域（全局 / 当前作品）

修改实时预览；危险动作只有“恢复默认/删除作品覆盖”需要明确确认。

---

# 4. Layer / Z-axis 设计

固定层级：

```text
L0  Scene image / background WebGL
L1  Atmosphere / vignette / grain
L2  Contrast protection / shadow veil
L3  Application HUD frame
L4  Work surfaces
L5  Text / controls / evidence
L6  Popover / Sheet / command surface
L7  Blocking modal / destructive confirmation
```

硬规则：

- 人物不得进入正文可读区的视觉前景。
- 颗粒和 WebGL 必须 `pointer-events: none`。
- 任何装饰层不得进入键盘顺序。
- 正文区视觉遮蔽应达到约 90–96%，即使背景很复杂也必须稳定可读。

---

# 5. Ink Realm Color Semantics

## 5.1 建议 Token

| Role | Value | Meaning |
|---|---|---|
| Canvas Void | `#05090D` | 最底世界底色 |
| Ink Deep | `#081117` | HUD 深底 |
| Surface 01 | `#0C171E` | 主面板 |
| Surface 02 | `#102029` | Raised |
| Surface 03 | `#152832` | Controls |
| Foreground | `#EDF1ED` | 主文字 |
| Muted | `#A2ADA9` | 次要文字 |
| Faint | `#687671` | 三级信息 |
| Hairline | `rgba(205,225,222,.11)` | 普通边缘 |
| Hairline Strong | `rgba(225,239,235,.21)` | 强边缘 |
| Imperial Gold | `#D6B36A` | 作者决策 |
| Gold Bright | `#F0D18A` | 作者高优先级行动 |
| Jade Cyan | `#72C9C4` | AI / 系统 |
| Jade Soft | `rgba(114,201,196,.12)` | AI selection |
| Success | `#78C79D` | verified / committed |
| Warning | `#D3A765` | advisory / stale |
| Danger | `#D98383` | blocking / destructive |

## 5.2 颜色是产品语义，不是装饰

### Gold = Human Agency
采用、确认、接受、Commit、发布、不可替代的作者主操作。

### Jade = AI / System
生成、分析、运行 Skill、Candidate、工具执行、系统活动。

### Green = Verified Durable State
PASS、Committed、hash match、verified、成功持久化。

### Warning = Attention
stale、advisory、需配置、待作者检查。

### Red = Block / Failure
blocking failure、hash mismatch、error、destructive。

旧紫色不再作为全产品主色；如保留，仅用于 experimental / unknown 等极少数特殊状态。

---

# 6. Material System

## 6.1 Scene Glass

用途：Top HUD、左侧导航、轻量 Sheet。

- 可看见作品世界。
- blur 只用于固定/悬浮层。
- 边缘需要轻微折射高光，不用灰色矩形框。

## 6.2 Ink Glass

用途：Inspector、章节轨、辅助工具面。

- 比 Scene Glass 更黑、更稳定。
- 只保留极少背景信息。

## 6.3 Reading Slate

用途：正文编辑、长篇阅读、重要差异对比。

- 近实心。
- 几乎无玻璃感。
- 最高对比与最低视觉噪声。

## 6.4 Metal Rim / Double Bezel

只用于：当前章节、关键 Skill、Quality 核心摘要、当前作品、重要选中卡。

结构：

```text
outer rim
  └ subtle metallic highlight
      └ 3–5px recess
          └ inner dark core
```

不能给每张卡、每个输入框都套双层边框，否则会退化成页游 HUD。

---

# 7. Typography

保留双轨排印，但做得更明确。

### UI / Operations
系统无衬线：系统字体 / Geist 类视觉替代。用于按钮、导航、状态、证据、任务、表格。

### Prose / Narrative
宋体 / Noto Serif SC / Songti SC。用于书名、章节名、正文、文学内容。

### Evidence / Technical
Mono。用于 hash、receipt id、revision、taskRef、token、event position、traversal id。

正文建议：

- 16–18px。
- `line-height: 1.85–2.0`。
- 阅读 measure 约 60–75 个中文字符。
- 不用卡片包每一段。

---

# 8. Desktop Spatial Shell

逻辑仍是三大区域，但视觉不能再像后台管理：

```text
                 WORLD SCENE

       ┌──────── Top HUD ────────┐

  ┌ Nav HUD ┐  8–12px  ┌ Creation Instrument ┐  8–12px  ┌ Evidence Tower ┐
  │         │           │                     │           │                │
  └─────────┘           └─────────────────────┘           └────────────────┘

                 WORLD SCENE
```

原则：

- 三个区域之间保留可见“世界缝隙”。
- 结构仍可复用当前三栏信息架构，不为了视觉迁移路由或改业务状态。
- 中央创作区始终拥有最大视觉权重。
- Inspector 不能压缩正文到不可读宽度。
- 1280 / 1440 都必须有真实验收图。

---

# 9. Top HUD

当前功能全部保留：

- 墨舟品牌。
- 当前作品切换 / Wizard 重放。
- 今日码字统计：当前未接入，仍显示诚实 unavailable，不伪造数字。
- 时光机。
- 灵感工坊。
- 导出。
- 敏感词 / 合规。
- 本地就绪状态。
- 新增 Scene System 入口。

视觉调整：

- 移除 Emoji 作为正式 UI 图标。
- 使用一套 18px、1.25–1.5px stroke 的墨舟自有 SVG 图标。
- 非阻断工具优先 Popover / Sheet，不强制全部中心 Modal。
- 当前书可以带极小 Scene thumbnail，但不能让封面喧宾夺主。

---

# 10. Left Capability Rail：17 项一级能力一个都不能少

## 创作

1. 工作台
2. 写作对话
3. 我的作品
4. 风格蒸馏
5. 小说拆解

## 检视 · Novel OS

6. Story Brain
7. 装配看板
8. 变更矩阵
9. 质量门

## 工作流

10. 任务中心

## 资源

11. 书源搜索
12. 书源书架
13. 技能广场
14. 网文扫榜
15. 联网搜索
16. 云同步

## 账户

17. 会员中心

### 选中状态

- 左边 2px 左右的金属/金色光脊。
- 极轻 surface lift。
- 图标和文字增强。
- 不用整块高饱和背景。

### 真实状态

如果入口存在但未接入真实数据，不要因为新 UI 更漂亮就让它看起来“可用”。

特别注意：当前顶层 `dialogue` 导航与真正 `DialogueStream` 的挂载位置并不相同。正式设计应把“写作对话”信息架构梳理清楚，但在实现前不得假设已有独立完整页面。

---

# 11. Pipeline Spine：8 步保持原词表

固定顺序：

`prepare → compile → draft → review → extract → continuity → proposal → commit`

中文：准备 → 装配 → 草稿 → 审查 → 提取 → 连续性 → 提案 → 提交。

当前代码中的点击主要驱动视觉 stage / 背景 focus，真实 session binding 尚不等于全部完成，因此设计必须区分：

- selected stage
- live running stage
- completed stage
- blocked stage
- failed stage
- unavailable stage

不能把“被点击”设计成“已执行成功”。

---

# 12. Workbench：视觉旗舰，但正文必须最安静

## 12.1 建议信息结构

```text
Book Context
  ├─ title / book id / genre if real
  ├─ scene context
  └─ chapter rail

Chapter Rail
  ├─ prev / next
  ├─ chapter title
  ├─ phase
  ├─ stale / quality status if real
  └─ fast numeric jump as secondary control

Creation Surface
  ├─ DialogueStream
  ├─ author answer
  ├─ AI draft candidate
  └─ prose/editor surface when integrated

AI Composer
  ├─ prompt
  ├─ skills multi-select
  ├─ style rail (currently unavailable)
  └─ provider state

Auxiliary
  ├─ create book
  └─ ledger
```

## 12.2 Chapter Rail

把当前纯数字“当前章”输入降级为快速跳章辅助；主导航采用横向 Chapter Rail。

卡片可展示的字段必须来自真实数据：

- 章序。
- 标题。
- draft / committed。
- revision。
- wordCount。
- stale / quality 只有真实数据存在时才显示。

没有缩略图数据时不要伪造“章节封面”。

## 12.3 DialogueStream 必须完整保留

现有真实交互：

- 墨舟先问。
- 快捷 choices。
- 作者回答。
- provider availability。
- 9 个 capability/skill 多选。
- style rail 显式未接入。
- NDJSON `start/delta/done/error` 流。
- drafting / done / error。
- 再来一轮。

设计表现：

- AI 问题与系统行为使用 Jade。
- 作者回答使用中性高对比，不做夸张聊天气泡。
- streamed draft 明确标 `AI CANDIDATE`。
- provider unavailable 必须是结构化 blocker，不只是灰掉输入框。

## 12.4 Author vs AI

- 作者正文：正常 paper-white，无装饰框。
- AI Candidate：左侧极细 Jade marker + `AI CANDIDATE`。
- Accepted：短暂 Gold acknowledgement。
- Committed：Green，显示 revision / verified state。
- 不得把 Accepted 画成 Committed。

---

# 13. Editor Subsystem：代码已存在，不能在设计中遗忘

代码树存在以下编辑器组件，即使当前主 Workbench 未把它们全部挂载为正式主路径，也必须在完整设计里预留一致语言：

- `NovelEditorCanvas`
- `BlockEditorEngine`
- `EditorQualityTelemetry`
- `FloatingBubbleMenu`
- `InlineDiffViewer`
- `SlashCommandMenu`
- `useEditorSelection`
- `customNodes`

现有能力包括：中文段落缩进、排版整理、slash command、scene / beat / character 快捷插入、selection 工具、质量 telemetry、inline diff。

### 设计要求

- Editor 使用 Reading Slate，沉浸强度仅 10%。
- Bubble Menu / Slash Menu 从文本选择或输入点原位出现。
- Diff 必须同时使用结构、符号与颜色表达 added/removed/changed。
- 选区、caret、IME、中文输入优先于装饰动画。
- 代码存在但未接入的功能不得在主工作台伪装成已上线；设计稿应标 `CODE-PRESENT / INTEGRATION PENDING`。

---

# 14. Evidence Tower / 证据塔

右侧保留四个真实 Inspector 域：

1. Quality Gate
2. Story Brain
3. Context Receipt / 装配看板
4. Change Matrix

顶部增加只读 summary rail，但每个数字必须有真实数据源；没有则显示 `— / 未载入`。

建议摘要：

```text
CURRENT CHAPTER
12 · 暗潮

QUALITY         PASS / —
CANON           CURRENT / —
CONTEXT         HASH MATCH / —
CHANGE IMPACT   1 / —
```

## 14.1 Quality Gate

必须保留：

- PASS / NEEDS REWORK / REFUSED。
- hasReport。
- current / stale。
- draft revision。
- draft content hash。
- rework attempt 0–2/2。
- semantic reviewer unavailable / attached。
- blocking failures。
- advisories。
- Run literary review。
- Apply rework（仅 blocking，且有上限）。
- Record my correction：reason + note + saved state。

视觉：精密仪器，不做“绿色 SaaS 分数卡”。Blocking 只在关键状态脊使用暗红，不能整页红。

## 14.2 Story Brain

真实三区：

- Entity Cards。
- Outline Tree。
- Facts。

实体种类：人物、物品、地点、势力、概念。

事实通道：canon / suspects / believes / invalidated。

硬约束：POV/秘密信息门禁不能被视觉层绕过；suspect/belief 只渲染安全 presentation。

新视觉：Character Card / Lore Card / Timeline Fragment，但数据结构不变；不因为想做“漂亮关系图”就虚构 edges。

## 14.3 Context Receipt / 装配看板

必须保留：

- Receipt list。
- receipt id / chapter / token count。
- hash match / mismatch。
- budget：reserved / story / fixed / slack / cap。
- entries。
- included / excluded + exclusion reason。
- Replay Inputs。
- tokenizer / compiler / candidates / digest。
- assembledBy / taskType。
- resume：sessionOpen / currentStep / committed / finished / lastReceiptId。
- 回工作台继续。

视觉角色：**AI 飞行数据记录仪**。以 neutral + Jade + Mono 为主，少用 Gold。

## 14.4 Change Matrix

必须保留：

- rows = Traversal。
- columns = chapter。
- needs_rework / resolved / not_affected。
- traversalId。
- taskRef。
- trigger source/ref。
- recordedAt。
- upstream changes。
- stale count。
- rerun，仅 stale 行可操作。

视觉：高密度表格、行列 hover、极薄网格；不要做发光按钮矩阵。

---

# 15. 17 个能力页面的设计颗粒度与真实状态

| View | Runtime state | 必须保留的子功能 | Ink Realm 强度 |
|---|---|---|---:|
| Workbench | A | 建书、DialogueStream、章选择、账本、工具入口 | 80% 外框 / 10% 正文 |
| Dialogue | B | 顶层入口当前不等于独立完整页；真实对话在 Workbench | 70% |
| Works | A | 元信息、统计、大纲节点、章节目录、去工作台 | 90% |
| Style Distill | A | 样本文本、sample metrics、sepia 分数/提示、四场景 profile | 60% |
| Novel Breakdown | B | 当前 truthfulness gate 返回 501；只能做 unavailable 设计 | 60% |
| Story Brain | A | 实体、大纲、facts、filter、refresh | 80% |
| Context Receipt | A | receipt、budget、entries、replay、resume | 30% |
| Change Matrix | A | matrix、details、rerun | 30% |
| Quality Gate | A | review/rework/correction/current/stale/evidence | 30% |
| Tasks | A | traversal audit、event stream、filter、refresh | 30% |
| Book Source | A | query/url、multi-source、crawler extract、import、success/error | 60% |
| Bookshelf | A | scan、skipped、import、open/current | 80% |
| Capability Square | A | 17 capability groups、status、evidence、provider availability | 90% |
| Rank Scan | B | 当前 truthfulness gate 返回 501；不能展示静态榜单为实时 | 45% |
| Web Search | B | 当前 truthfulness gate 返回 501；只能展示未配置状态 | 45% |
| Cloud Sync | B/Partial | local-ready 真实；cloud/backup 未上线或 501 | 45% |
| Membership | B/Partial | community free 真实；购买/激活不可用 | 45% |

A = mounted truthful live；B = mounted but partial / blocked。

---

# 16. Resource / Library Surfaces

## 16.1 Works / Bookshelf：私人藏书馆

使用 Narrative Card，视觉可更沉浸，但统计必须真实。

Works 必须保留：

- title / id / createdAt / genres（为空时不虚构）。
- totalWords。
- totalChapters。
- committedChapters。
- draftChapters。
- entityCount。
- outline nodes。
- chapter phase / wordCount / revision。

Bookshelf 必须保留：

- parentDir。
- scan / busy。
- skipped bad book.json warning。
- import title。
- open/current state。
- chapter count。
- root / book id technical detail可收进 secondary disclosure，但不能丢。

## 16.2 Book Source

保留两条真实路径：

- 普通 query → multi-source search。
- URL → crawler extract。

随后均可导入本地 library；URL 抓取可把 initial body 写入第 1 章。

设计中必须明确区分：

- REAL SEARCH RESULT。
- CRAWLED WEB CONTENT。
- LOCAL PRESET / SAMPLE。

三者不能在同一种卡片状态下混淆来源。

---

# 17. Capability Square / Skill 广场

这是最适合使用高级卡牌语言的页面，沉浸强度 90%。

每张 Capability Card 必须显示：

- 名称。
- 所属 group。
- description。
- status：native / provider_required / configuration_required / external_source_required。
- evidence。
- providerAvailable 相关状态。

不允许把“需要 provider / 配置 / 外部数据源”设计成灰色但仍像可点击的已上线技能。

### Card 行为

- hover：轻微 Z lift，不大角度 3D 旋转。
- selected：局部 Metal Rim 高光。
- detail：右侧 Sheet。
- future enable/apply：只有真实 action contract 存在时才出现。

### Skill 生态心理模型

设计可以强化“装备/组合/收藏”的卡牌感，但不能把能力注册表伪装成游戏数值系统；Level、稀有度、战力等如果没有产品数据，不得新增。

---

# 18. Style Distill / 文风蒸馏

内部视觉隐喻：Style Forge / 文风炉；正式导航名称继续叫“风格蒸馏”。

必须展示真实：

- input sample。
- char count / avg sentence length。
- dialogue ratio。
- short sentence ratio。
- sensory density。
- action pacing。
- sepia narrative score：Pass 1/2/3。
- aiTellsSummary（存在时）。
- current style profiles：scenario / revision / metrics。

样本文本按钮必须标注为 `SAMPLE`，避免用户误认为来自当前作品。

---

# 19. Novel Breakdown / Rank Scan / Web Search：Truthfulness First

这三者当前最容易被“高保真设计”误导。

当前 route order 中 truthfulness gate 会让：

- Novel Breakdown → 501。
- Web Search → 501。
- Rank Scan → 501。

因此设计稿必须优先完成三种状态：

1. 未配置 / 不可用。
2. 为什么不可用。
3. 接入真实 provider/source 后的 future layout（使用明确 `FUTURE DATA LAYOUT` 标签）。

禁止把代码中下游 fallback/static demo dataset 当成当前用户数据。

---

# 20. Cloud Sync

当前真实价值是 Local-First，不是“云已经可用”。

可展示：

- localReady。
- offline_ready。
- local canon file count。
- DB bytes。
- pending local state（真实返回值）。

不可宣称：

- 已云同步。
- 已产生云备份。
- backup success。

`cloud-sync.backup` 当前失败闭合，UI 需要清晰 unavailable，而不是“漂亮的备份成功卡”。

---

# 21. Membership

当前真实产品：Technical Preview / 社区免费版。

- current free plan 可以高质量展示。
- future plans 可以展示“规划中”。
- 购买、激活、密钥提交未上线时不提供假按钮。
- 若未来 license 存在，再展示 planName / status / key / activatedAt 等真实字段。

视觉不能做成传统三塔 pricing SaaS；更像一个作品工具的授权档案页。

---

# 22. Wizard：最强沉浸页面之一

现有五步保持：

1. 建书
2. 世界观
3. 大纲
4. 首章
5. 连写

设计：

- 大 Scene 背景。
- 每步只强调一个决策。
- 左侧 / 顶部显示进度脊柱。
- 世界观、卷级承诺、开场画面、首章目标逐步构成“世界启动仪式”。
- 仍支持 Back / Close / Replay。
- 建书失败必须就地呈现。
- 不能说“世界观已写入 Canon”除非当前代码真的持久化；现有 Wizard 后四步主要是收集输入与 outcome，不得用视觉暗示额外写入已经发生。

---

# 23. Auxiliary Tools / Desktop Tool Surfaces

当前工具入口：

- Version / Time Machine：当前 unavailable。
- Inspiration：本地随机 preset 真可用。
- Export：当前主 DesktopToolModal unavailable；但代码树另有 export-suite 实验组件。
- Compliance：当前 unavailable。

### 灵感工坊

真实本地 preset：人物名、势力名、法宝名、卡文事件。可以做卡牌化“抽取”，但必须标 `LOCAL PRESET`，不是 AI 生成。

### 时光机 / 合规 / 导出

未接线功能以 disabled / unavailable 设计为主。

---

# 24. Code-Present / Unmounted / Experimental Surfaces

这些不能遗忘，也不能冒充主线已经上线。

## 24.1 Canon Graph

代码已有 `CanonGraphView / CanonNodeCard / useCanonGraphData / CreateContractModal / canonSyncBridge`。

当前 `useCanonGraphData` 包含固定 mock nodes/links，因此：

- 可以设计真实未来形态。
- 当前不得把 mock 关系图放进 Story Brain 作为“作品真实关系”。
- 首次真正上线前必须换成数据面契约。

Ink Realm 表现：低饱和关系拓扑 + 局部 Jade/Gold contract edges，避免星空乱线。

## 24.2 Genre Kits

代码已有 `GenreKitMarketplaceView` 与 presets。

当前 apply 主要是局部 UI 状态，不应宣称“已写入当前书”除非真正持久化契约接入。

设计方向：作为 Skill / Resource 市场的 Narrative Kit Card 子域，而不是另起一套商店视觉。

## 24.3 Export Suite

代码已有：

- TXT exporter。
- DOC/DOCX-like HTML exporter。
- EPUB exporter / fallback path。
- PublicationExportModal。

设计必须区分格式真实能力；例如当前 EPUB fallback 到文本时，不得把它标为完整 EPUB 封装成功。

## 24.4 Advanced Editor

见 §13。未来整合时必须沿用同一套 Reading Slate、Candidate、Diff 和 evidence 语言。

---

# 25. Mobile Ink Realm

移动端是正式产品面，不再视为桌面的缩小版。

## 25.1 保留五 Hub

- 创作 Workbench
- 检视 Inspector
- 作品 Works
- 书源 Resources
- 设置 System

## 25.2 Scene 在移动端

- 背景 Scene 保留。
- Foreground Figure 默认关闭，避免小屏拥挤。
- Shadow veil 比桌面更重。
- 不做全屏复杂 parallax。

## 25.3 WorkbenchHub

必须保留：

- 当前书。
- 时光机入口。
- 章节目录入口。
- 今日码字未接入诚实状态。
- TensionSpark / stage interaction。
- PlotBranch / question choices。
- ProseReadingFlow。
- MobileComposer。
- draft stream 成功/失败状态。

当前 `alert()` 反馈在视觉实现阶段应改为 inline / sheet / non-blocking feedback，但业务意义不变。

## 25.4 InspectorHub

真实加载：

- Story Brain facts。
- Receipts。
- Change Matrix。

移动 Quality 当前未接入，必须保持 unavailable，而不是复用桌面 PASS 假数据。

## 25.5 WorksHub

真实：totalWords / chapters / entity count / chapter phase / revision / word count。

加章、移动端 style detail 等未接入功能继续显式 disabled。

## 25.6 ResourcesHub

真实：book source search + crawler extract；无结果时禁止假推荐补位。

## 25.7 SystemHub

真实：tasks + membership；cloud 为未接入状态。

## 25.8 Touch

- 所有主要目标 ≥ 44px。
- Bottom Sheet 有明确 drag handle / close / focus management。
- reduced-motion 时禁用大范围滑动，仅 cross-fade 或静态切换。

---

# 26. Card Taxonomy

不得再用一个 `.card` 解决所有产品内容。

## Narrative Card
作品、章节、世界观摘要。

## Character / Lore Card
人物、地点、势力、概念。

## System Card
Quality、Receipt、Task、Cloud state。

## Capability Card
Skill / capability / provider state。

## Evidence Row
Hash、revision、event、traversal、receipt entry。

每种卡有自己的信息密度和材质强度；不能只靠换颜色区分。

---

# 27. Interaction Components

## Author Primary
Gold。接受、确认、提交、发布。

## AI Action
Jade。生成、分析、运行 Skill、重新分析。

## Neutral
深色低调操作。

## Ghost
辅助跳转、取消、展开。

## Destructive
Danger，仅不可逆操作。

## Commit
Gold 触发；durable verification 成功后状态变 Green。

### Press
按下立即反馈，轻微 `scale(~0.985)` 或 1px 物理位移；不能等到 release 才有视觉反应。

---

# 28. Motion Language

关键词：**Physical / Interruptible / Spatial**。

- 微交互通常 180–280ms。
- Sheet / Popover 从触发源方向出现，并沿原路径退出。
- Hover 不做 layout shift。
- Chapter change 沿 Chapter Rail 方向过渡。
- AI stream 本身就是主动画，不叠加炫技 loading orb。
- 背景只允许极低频、低位移运动。
- 不允许大面积长期漂浮。
- `prefers-reduced-motion`：场景静止、Sheet 改短 cross-fade、语义完全保留。
- 动画优先 transform/opacity；避免 layout-triggering 属性。

---

# 29. Immersion Budget

为了避免“所有页面都像游戏”，每个域有最高沉浸强度：

| Surface | Max intensity |
|---|---:|
| Skill / Capability Square | 90% |
| Works / Bookshelf | 90% |
| Wizard | 90% |
| Workbench frame | 80% |
| Story Brain | 80% |
| Book Source | 60% |
| Style Distill | 60% |
| Novel Breakdown future layout | 60% |
| Rank / Search / Membership | 45% |
| Inspector / Tasks / Receipt / Matrix | 30% |
| Prose editor | **10%** |

“强度”指装饰、背景可见度、卡牌感、材质、动效，不是功能数量。

---

# 30. Accessibility / Truthfulness / Performance

## Accessibility

- 键盘 focus 可见。
- 状态不能只用颜色。
- Tab / Sheet / Modal 保持正确语义和 focus return。
- Error、blocked、stale、candidate、committed 需要文本标签。
- 中文 IME 不被快捷键和动画破坏。
- reduced motion / reduced transparency / more contrast 应有退化路径。

## Truthfulness

- 绝不展示虚假统计。
- 绝不把 demo/fallback dataset 当实时数据。
- 绝不把 code-present/unmounted 画成已上线。
- 绝不把 selected pipeline stage 画成执行成功。
- 绝不把 accepted 画成 committed。
- 绝不把 local-ready 画成 cloud-synced。
- 绝不把 future paid plan 画成可购买。

## Performance

- 大面积 blur 仅用于固定/悬浮层，不用于滚动正文容器。
- 粒子/噪声固定单层。
- Scene 资源需要尺寸预算与 lazy decode。
- WebGL 保持 low-power path + static fallback。
- 正文滚动优先于一切装饰帧率。

---

# 31. Explicit Design Red Lines

1. 不满屏毛玻璃。
2. 不用紫蓝 AI 渐变作为默认高级感。
3. 不让每张卡发光。
4. 不让每个按钮金色。
5. 不把所有控件做成 pill。
6. 不做廉价页游雕花。
7. 不让 Scene / Figure 穿过正文可读层。
8. 不隐藏系统状态换取“干净”。
9. 不把所有次级动作塞进中心 Modal。
10. 不制造不存在的统计、评分、进度、在线状态。
11. 不复制任何现有游戏版权角色、Logo、官方卡面或 UI 资产。
12. 不因视觉重构修改 Author Sovereignty 或 Canon 语义。
13. 不引入第二套完全独立的 mobile 颜色语义；移动端只允许密度/尺寸变体。
14. 不为了设计稿安装新 UI library 或 icon library。

---

# 32. Design Acceptance Matrix：本地 AI 出设计前必须逐项勾选

## Shell

- [ ] Top HUD 全功能覆盖
- [ ] Scene System 入口
- [ ] 17 项导航全部存在
- [ ] 8 步 Pipeline 全部存在
- [ ] current book / no-book 两态
- [ ] desktop 1440 / 1280
- [ ] mobile <768 五 Hub

## Workbench

- [ ] Create Book
- [ ] chapter navigation
- [ ] DialogueStream question
- [ ] choices
- [ ] author answer
- [ ] 9 capability skills
- [ ] style rail unavailable
- [ ] provider unavailable
- [ ] draft streaming
- [ ] draft done/error
- [ ] ledger refresh
- [ ] tool entry points

## Quality

- [ ] no report
- [ ] pass
- [ ] blocking fail
- [ ] refused
- [ ] stale/current
- [ ] revision/hash
- [ ] rework count
- [ ] blocking findings
- [ ] advisories
- [ ] semantic reviewer unavailable
- [ ] run review
- [ ] apply rework
- [ ] record correction

## Story Brain

- [ ] 5 entity classes
- [ ] entity filter
- [ ] outline tree
- [ ] canon
- [ ] suspects
- [ ] believes
- [ ] invalidated
- [ ] empty/error/loading

## Receipt

- [ ] list
- [ ] selection
- [ ] hash match/mismatch
- [ ] budget 4-part
- [ ] entry included/excluded
- [ ] Replay Inputs
- [ ] resume open
- [ ] committed
- [ ] no-session

## Change Matrix

- [ ] three cell states
- [ ] stale total
- [ ] traversal details
- [ ] rerun enabled/disabled
- [ ] empty/error/loading

## Works / Library / Resource

- [ ] works metadata/stats
- [ ] outline
- [ ] chapter list
- [ ] bookshelf scan
- [ ] skipped warning
- [ ] local import
- [ ] open/current
- [ ] book source text search
- [ ] URL crawl
- [ ] crawl preview
- [ ] real result vs local sample distinction
- [ ] capability square 4 statuses

## Other views

- [ ] tasks + filters + traversal audit
- [ ] style sample metrics
- [ ] sepia score / tells
- [ ] current style profiles
- [ ] novel breakdown unavailable current state
- [ ] rank scan unavailable current state
- [ ] web search unavailable current state
- [ ] cloud local-ready vs cloud-unavailable
- [ ] membership free vs future plan

## Auxiliary / Latent

- [ ] Wizard 5 steps
- [ ] inspiration local presets
- [ ] history unavailable
- [ ] compliance unavailable
- [ ] export mainline unavailable
- [ ] advanced editor system retained
- [ ] Canon Graph marked experimental/mock-bound
- [ ] Genre Kits marked code-present / integration pending
- [ ] export-suite format capability not overstated

## Mobile

- [ ] WorkbenchHub
- [ ] InspectorHub
- [ ] WorksHub
- [ ] ResourcesHub
- [ ] SystemHub
- [ ] drawers
- [ ] mobile quality unavailable truthfully
- [ ] touch targets
- [ ] figure layer default off

**任何一项没有设计落点，就不能宣称“全量 UI 设计完成”。**

---

# 33. 本地 AI 的设计阶段工作顺序

1. 重新读取本机最新 `.gitnexus` / 代码图谱，确认本规格与本地 HEAD 是否有新增功能。
2. 读取 `App.tsx`、`views.ts`、`server/api.ts`、`server/routes/*`，建立 mounted / blocked / unmounted 三态清单。
3. 读取现有 `apps/web/DESIGN.md`、ADR-0027 和本规格。
4. 先做完整 Surface Inventory，不画图。
5. 做 Ink Realm token board。
6. 做 Scene System 交互规格。
7. 做 Desktop Shell 高保真。
8. 做 Workbench + Evidence Tower。
9. 按 17 项能力逐页高保真，不能只做 3–5 张代表页。
10. 做 Mobile 五 Hub 与 drawers。
11. 做 latent subsystem placement。
12. 最后用 §32 Acceptance Matrix 对齐颗粒度。
13. 设计审核通过前不修改生产 UI 代码。

---

# 34. 最终设计判断标准

成功不是“比现在炫”。成功应同时满足：

- 第一眼有墨舟独有的东方未来主义世界感。
- 10 分钟后仍然清晰、高效。
- 1 小时写作后正文不疲劳。
- 任何 AI / 系统行为都有来源与状态。
- 任何作者决定都比 AI 建议更有主权感。
- 任意 unavailable 能力都不会被视觉伪装成可用。
- 从 Desktop 到 Mobile 都属于同一个设计宇宙。
- 17 个一级入口、4 Inspector、8 Pipeline、移动五 Hub、辅助工具与 code-present 子系统全部有设计落点。

> **Ink Realm 的目标不是把墨舟做成游戏，而是让墨舟像一件来自小说世界里的专业创作仪器。**
