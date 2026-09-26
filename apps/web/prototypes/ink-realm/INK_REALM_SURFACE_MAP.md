# INK_REALM_SURFACE_MAP.md — 墨舟 Ink Realm 全产品 Surface 追踪矩阵

> **审计事实源**：本地 HEAD `b2a0930`（master，与 origin/master 同步前快照；规格 docs 已通过 ef9f5b5 单独落地，未触碰其他工作）。
> **代码图谱**：GitNexus repo `mozhou` @ `C:\zcode\novel-ai`，索引 commit = `b2a0930` = 本地 HEAD（934 files / 41,588 nodes / 84,715 edges / 509 communities / 496 processes）。图谱交叉查询确认主线 UI 注册表为 `apps/web/src/shell/views.ts`，图谱中其余 UI 命中均属 `app/` 冻结遗留面（ADR-0025 出主线）。
> **未提交工作处理**：工作区存在 15 个未提交文件（`server/draftContext.ts`、`routes/{pipeline,storyBrain,works}Routes.ts`、`src/api.test.ts`、4 个 package 文件、2 个新 runtime 文件）。本矩阵按用户指令以 **HEAD 为最终事实源**；已逐一核对未提交 diff：全部为"文件系统直读 → LocalDataPlane 方法"的内部实现替换，路由路径、响应契约与诚实不可用行为不变。设计与实现均不需要为其分支。
> **证据纪律**：每行均带 `file:line` 证据。探查执行日 2026-09-12。
> **本文件是视觉设计的前置门禁**（主规格 §33 步骤 4；handoff §1）。视觉设计产物见同目录其余文件。

---

## 0. 标记定义（与 handoff §1 一致）

| 标记 | 含义 |
|---|---|
| `MOUNTED_TRUTHFUL` | A 类：入口真实挂载在 App 图谱中，且数据面可用、状态诚实。 |
| `MOUNTED_PARTIAL_OR_BLOCKED` | B 类：入口存在且挂载，但真实前提缺失（truthfulness gate 501 / provider 未配置 / 数据未接入），UI 必须呈现 unavailable/partial。 |
| `CODE_PRESENT_UNMOUNTED` | C 类：源码存在但当前 App 图谱不可达（无 importer / 被上游 gate 遮蔽 / 死分支）。设计保留位置，不画成已上线。 |
| `NEW_DESIGN_REQUIREMENT` | 本规格新增的一等公民能力（如 Scene System），代码中不存在，纯设计新增。或：审计发现的、规格必须新增承载的状态/缺口。 |

矩阵列定义：**功能 → 入口 → 组件（子组件）→ Action → API/状态 → 关键状态语义 → 设计落点 → 标记**。

---

## 1. Shell 层（App 骨架与桌面壳）

### 1.1 App 骨架 — `apps/web/src/App.tsx`

| 功能 | 入口 | 组件 | Action | API/状态 | 状态语义 | 设计落点 | 标记 |
|---|---|---|---|---|---|---|---|
| 桌面/移动分派 | `window.innerWidth<768` resize 监听（App.tsx:75-87,124-133） | `MobileShell` / 桌面壳 | — | 移动分支在 wizardOpen 计算之后 return，**移动端永远看不到 Wizard**（App.tsx:70-72,124） | 无 | 移动端为独立产品面（规格 §25）；桌面壳见 §8；移动原型 09-mobile.html | MOUNTED_TRUTHFUL |
| 工作台状态持久化 | App 挂载 | `loadWorkbenchState/saveWorkbenchState`（App.tsx:64,89-91） | — | localStorage `mozhou.workbench.v1`，严格校验失败回退默认（workbenchStorage.ts:22-42） | 损坏数据静默回退到 no-book+workbench | Scene Profile 持久化沿用同纪律：UI preference、可静默降级 | MOUNTED_TRUTHFUL |
| Wizard 完成标记 | App | localStorage `mozhou.wizard.done`（App.tsx:53-61,111） | 完成/关闭 | 无 API | 纯本地 | Wizard 原型 07 | MOUNTED_TRUTHFUL |
| 检视导航→Inspector tab 联动 | `handleSelectView` | `INSPECTOR_VIEW_TO_TAB`（App.tsx:45-50,93-97） | 点击左侧导航 | 无 | 中心区仍是 PlaceholderView，真实面板在塔内 | 05-views-inspector.html：中心页与塔面板的关系必须显式化 | MOUNTED_TRUTHFUL |
| Pipeline 点击 | `PipelineStrip onSelect` | `setStage`（App.tsx:68,173） | 点击 stage | **无任何后端调用**；stage 仅驱动 `stageToFocus`→InkBackground 光核位移（App.tsx:36-38,164） | selected ≠ executed/live/completed/blocked | 03-desktop-shell.html：六态 stage（selected/live running/completed/blocked/failed/unavailable） | MOUNTED_PARTIAL_OR_BLOCKED |
| 任务徽标 | `CapabilityChannels taskCount={0}`（App.tsx:172） | 恒 0（views.ts:10 注释：不假装有后台任务） | — | 无 | 徽标永不渲染=诚实 | 03：导航徽标保留语义位但恒空 | MOUNTED_TRUTHFUL |

### 1.2 桌面壳组件 — `src/shell/*`

| Surface | 入口 | 组件 | Action | API/状态 | 状态语义 | 设计落点 | 标记 |
|---|---|---|---|---|---|---|---|
| 品牌区 | TopBar.tsx:22-28 | 静态印章「墨」+墨舟+NOVEL OS 2.0 | 无 | 无 | — | 03：Scene thumbnail 位新增于当前书旁（规格 §9） | MOUNTED_TRUTHFUL |
| 当前书/Wizard 重放 | TopBar.tsx:30-40 | `建立作品`（无书→onHome）／《title》（有书→onReplayWizard） | 点击 | 无 API；无书单下拉（切书在 BookshelfView） | 无书/有书两态 | 03：保留两态；书单下拉不做（切书入口在书架） | MOUNTED_TRUTHFUL |
| 今日码字 | TopBar.tsx:42-44 | 静态 `div.quiet-btn` 文本「今日码字统计未接入」 | 无 | **未接入，诚实展示** | unavailable | 03：保留诚实 unavailable；移动端同（§8.1） | MOUNTED_PARTIAL_OR_BLOCKED |
| 时光机/导出/敏感词 | TopBar.tsx:47-58 | 4 个 emoji 按钮 → DesktopToolModals | 点击 | history/export/compliance→Unavailable 卡（DesktopToolModals.tsx:60,79,80） | unavailable 诚实 | 08-aux-latent.html；emoji 换 SVG（规格 §9） | MOUNTED_PARTIAL_OR_BLOCKED |
| 灵感工坊 | TopBar.tsx:50-52 → DesktopToolModals.tsx:62-77 | 本地骰子卡 4 张 | 掷骰 | 纯本地 `shared/inspirationPresets`，无 API | LOCAL PRESET 真可用 | 08：卡牌化抽取，标 `LOCAL PRESET`（规格 §23） | MOUNTED_TRUTHFUL |
| 本地就绪 | TopBar.tsx:59-62 | 禁用按钮+绿点 | 无 | 静态（数据平面本地存储） | local-ready ≠ cloud-synced | 03/06：绿点+文字保留 | MOUNTED_TRUTHFUL |
| 17 项导航 | CapabilityChannels.tsx:20-44 | NAV_GROUPS×5 组（views.ts:19-58） | 点击→setView | 无 | active 态 aria-current | 03：金脊选中态（规格 §10）；17 项全数进原型 | MOUNTED_TRUTHFUL |
| 8 步 Pipeline | PipelineStrip.tsx:7-16,30-31,38 | prepare→commit 8 stage | 点击（纯视觉） | 无 | done/active/default 三态；**无 blocked/failed 态** | 03：新增 blocked/failed/unavailable 三态视觉 | MOUNTED_PARTIAL_OR_BLOCKED |
| 检视塔 4 tab | InspectorTower.tsx:8-13,72-96 | quality/story-brain/context-receipt/change-matrix | tab 切换 | 面板见 §4 | aria tablist 完整 | 03/05：summary rail 新增（数字无源时 `— / 未载入`） | MOUNTED_TRUTHFUL |
| InspectorEmpty | InspectorTower.tsx:46-59 | 无书时四面板全用（App.tsx:137-158） | — | 无 | 建书后可用引导 | 03：Ink Glass 空态 | MOUNTED_TRUTHFUL |
| InspectorPlaceholder | InspectorTower.tsx:18-43 | **无 importer（App 已用真面板）** | — | — | 死代码 | 不进设计；实现阶段可清 | CODE_PRESENT_UNMOUNTED |
| 工具 Modal 壳 | DesktopToolModals.tsx:10,44-57 | 4 modal（history/inspiration/export/compliance） | scrim 点击关闭 | 无 | z=100 blocking modal | 08：spec 改为 non-blocking Sheet 优先（规格 §9）；destructive 才用 L7 modal | MOUNTED_PARTIAL_OR_BLOCKED |
| 墨流背景 | InkBackground.tsx:18-107,109,161-186 | WebGL 单三角+噪声 shader（紫基色 #8b78ff 系） | 无（focus prop 驱动） | reduced-motion 静帧（161-186）；无 WebGL 渐变兜底（128-131） | pointer-events 不拦截 | **被 Scene System 升级**：L0 Scene 图/L1 Atmosphere/L2 veil；WebGL 保留为极低频墨流（规格 §3/§4） | MOUNTED_TRUTHFUL（将被 NEW_DESIGN_REQUIREMENT 升级） |
| 占位中心页 | PlaceholderView.tsx:8-14,32-33 | 4 检视项带「已排票」注 | — | — | **`dialogue` 落入通用占位**（App.tsx:213 ternary 无 dialogue 分支） | 04-views-creation.html：写作对话页的真实形态设计（信息架构梳理，不假装独立页已上线） | MOUNTED_PARTIAL_OR_BLOCKED |
| workbenchStorage | workbenchStorage.ts:14-20,53-71 | book+view；draft cache `mozhou.draft.cache.<chapterKey>` | — | localStorage | 静默失败=增强 | 设计不变 | MOUNTED_TRUTHFUL |

---

## 2. Workbench 域（视觉旗舰）

### 2.1 WorkbenchView — `src/workbench/WorkbenchView.tsx`

组件树（WorkbenchView.tsx:70-168）：`chapterbar`（书名+BOOK id+当前章 number input+4 工具按钮）→ `conversation`（DialogueStream + 建书卡 + 账本卡）。

| 功能 | 入口 | Action | API/状态 | 状态语义 | 设计落点 | 标记 |
|---|---|---|---|---|---|---|
| 建书 | 建书卡（:113-142）；字段仅「作品名」默认 未命名之书（:35） | 提交 | `POST /api/book {title}`（:46）→ storyBrainRoutes.ts:12-19 真实磁盘建书 | busy `创建中…`/成功 `已建：根…`（:131-137）/error `wb-error`（:139） | 03：建书卡保留；规格 §22 建书失败就地呈现 | MOUNTED_TRUTHFUL |
| 章节导航 | 当前章 number input（:77-94） | 输入→setChapterIndex | 无 API（纯状态） | **无 prev/next、无 rail、无 stale/quality 显示** | 03：Chapter Rail 设计（规格 §12.2）为 NEW_DESIGN_REQUIREMENT；数字输入降级为快速跳章 | MOUNTED_PARTIAL_OR_BLOCKED |
| 书上下文 | chapterbar h1（:73-74） | — | title+bookId 前 8 位；**genre 不渲染** | 无 | 03：Book Context 区；genre 仅在真实存在时显示（规格 §12.1） | MOUNTED_PARTIAL_OR_BLOCKED |
| 账本 | 账本卡（:144-164） | `刷新账本`（无书禁用） | `POST /api/ledger {root}`（:59）→ worksRoutes.ts:232-240 | bullet 列表/error alert/静态提示（:151） | 03：Evidence Row 化（mono 事件流） | MOUNTED_TRUTHFUL |
| 工具入口 | 4 按钮（:95-106）→ setActiveModal | 同 TopBar 四 modal | 无新 API | 同 §1.2 | 08 | MOUNTED_PARTIAL_OR_BLOCKED |

### 2.2 DialogueStream — `src/workbench/DialogueStream.tsx`（写作对话的真实家）

**协议全量事实**（每条都有证据）：

| 功能 | Action | API/状态 | 状态语义 | 设计落点 | 标记 |
|---|---|---|---|---|---|
| 墨舟先问 | book 变化时并行 `POST /api/capabilities` + `POST /api/draft.question`（:47-53） | question+hint+choices（服务端 4 项快捷选择）+ questions[2]（**questions 数组客户端从未消费**；服务端 pipelineRoutes.ts:223-248） | ask | 03：Jade 提问块；q2 备选问题列为 NEW_DESIGN_REQUIREMENT（契约已在，仅未渲染） | MOUNTED_TRUTHFUL（questions=部分未用） |
| 快捷 choices | `handleChoice` 填入 textarea（:139-141,188-199） | — | phase `answered` **从未被置位**（:11 死状态）；用户气泡仅在 drafting 后出现（:206-211） | 03：作者回答中性高对比，choice 选中态即时反馈 | MOUNTED_PARTIAL_OR_BLOCKED |
| 作者回答 | textarea（:262-274） | — | provider 不可用时 placeholder 换「草稿 provider 未接入——此处不可用」（:271-272） | 03 | MOUNTED_TRUTHFUL |
| 9 项技能多选 | `toggleSkill`（:150-154）；源=`POST /api/capabilities` → `DIALOGUE_CAPABILITIES` 恰 9 项：续写/sepia 架构创作/sepia 叙事诊断/sepia 就地去味/sepia 意图重写/悬念调度/对白打磨/场景氛围/一致性自查（pipelineRoutes.ts:28-38,218-221） | activeSkills 随流式请求发送（:74-79）；服务端 decoratePromptWithSkills 注入约束（pipelineRoutes.ts:58-83） | provider 不可用时 pills 禁用（:245） | 03：Jade AI Action 语义的 skill pills | MOUNTED_TRUTHFUL |
| 风格轨 | 禁用 radio「未接入（V1 空态）」+提示（:251-257）；footer「已注入 N 项技能 · 风格未接入 · 质量门常驻」（:284） | 无 | 显式 unavailable | 03：保留显式空态 | MOUNTED_PARTIAL_OR_BLOCKED |
| provider 可用性 | 两层：(a) 预检 `providerAvailable=false` → `data-testid="provider-unavailable"` 结构化 banner（:172-176）；(b) 发送时服务端 HTTP 200 `{ok:false,code:'PROVIDER_UNAVAILABLE'}`（:90-99；pipelineRoutes.ts:265-272），非 ok HTTP 同名 code 亦处理（:82-89） | Gate 3 | 结构化 blocker（非灰输入框） | 03：blocker 卡=Jade 系统语义+说明+恢复途径 | MOUNTED_TRUTHFUL |
| 流式草稿 | `POST /api/draft.stream` NDJSON（:71-80）；非 ndjson Content-Type 显式报错（:100-105） | 服务端帧：`start{prompt,contextMode,contextTokens,provider}`（pipelineRoutes.ts:288-295，**客户端解析后忽略**）/`delta{text}`（:285）/`done{outcome,partial,chars}`（:303）/`error`（:306）；`unavailable` 事件在 api.ts:118-122 有类型但**从未发出、客户端也不处理** | drafting→draft_done/error（:121-128）；draft slice kicker=`DRAFT STREAM · 渲染中/完成`（:213-218） | 03：流本身是主动画（规格 §28）；start 帧的 contextTokens/provider 应成为 NEW_DESIGN_REQUIREMENT 的证据行 | MOUNTED_PARTIAL_OR_BLOCKED |
| 草稿持久化 | — | **服务端流式期间原子写入章节草稿**（draft-step.ts:34-56,154-205；绑定 pipelineRoutes.ts:131-152）：第 NNNN 章.md phase='draft' + draft-state JSON | 流=落盘，无需额外「保存」 | 03：draft 完成态显示"已落为当前章草稿"证据；**不存在 accept/commit 按钮**（grep 无 /api/draft.accept） | MOUNTED_TRUTHFUL |
| AI CANDIDATE 标签 | — | **代码中不存在**（grep CANDIDATE/候选 全 src 零命中）；仅 `DRAFT STREAM` kicker | — | 03：`AI CANDIDATE` 标签为 NEW_DESIGN_REQUIREMENT（规格 §12.4）；Accepted/Committed 视觉语言为前瞻规格（无契约，标注 contract-pending） | NEW_DESIGN_REQUIREMENT |
| 再来一轮 | draft_done/error 后按钮（:226-232） | 重置到 ask、清 draft/answer/error（:143-148）；**不重取 question**（旧问题驻留） | — | 03：重开轮次时重新取问是设计诉求（可在原型中体现为「换一个问题」） | MOUNTED_PARTIAL_OR_BLOCKED |
| 错误态 | `role="alert"`（:220-224） | — | error | 03：Danger 语义 | MOUNTED_TRUTHFUL |

### 2.3 写作对话导航项（顶层 `dialogue`）

| 功能 | 入口 | 事实 | 设计落点 | 标记 |
|---|---|---|---|---|
| `dialogue` 导航项 | views.ts:25 | App.tsx:174-213 无 dialogue 分支 → PlaceholderView 通用占位「该功能页尚未实现」（PlaceholderView.tsx:32-33）；真实对话在 Workbench 内 DialogueStream | 04：设计「写作对话」的信息架构落点（入口重定向说明/未来独立页 FUTURE layout），不得画成独立完整页 | MOUNTED_PARTIAL_OR_BLOCKED |

---

## 3. 17 项一级能力逐项矩阵

| # | 视图（id） | 挂载与 Props（App.tsx） | 组件 | Action → API | 关键状态 | 设计落点 | 标记 |
|---|---|---|---|---|---|---|---|
| 1 | 工作台 workbench | :174-181 `WorkbenchView{book,chapterIndex,…}` | 见 §2 | 见 §2 | 见 §2 | 03-desktop-shell.html | MOUNTED_TRUTHFUL（局部见 B 级行） |
| 2 | 写作对话 dialogue | views.ts:25 注册；无渲染分支 | PlaceholderView | — | 占位 | 04 | MOUNTED_PARTIAL_OR_BLOCKED |
| 3 | 我的作品 works | :196-197 `WorksView{root,onGoToWorkbench}` | works/WorksView.tsx(218 行) | 载入 `POST /api/works`（:34） | 元数据：title/ID mono/createdAt（:108-116），**genres 空时兜底「通用网文」（服务端硬编码 genres:[]，worksRoutes HEAD:156）**；统计 totalWords/totalChapters/committed（绿）/draft（amber）/entityCount（:132-152）；大纲节点数+nodeType/status 标签（:158-179，0 节点无专门空态文案）；章节列表 phase 徽标（committed=已定稿/草稿中）+wordCount+r{revision}（:182-212）；无 root→empty 卡+前往工作台建书（:47-72）；busy（仅无数据时 :89-93）/error alert（:94-98） | 04/06：Narrative Card 90% 沉浸 | MOUNTED_TRUTHFUL |
| 4 | 风格蒸馏 style-distill | :200-201 `StyleDistillView{root}` | style-distill/StyleDistillView.tsx(254 行) | 载入 `POST /api/style`（:43，失败**静默吞掉** :45-47）；蒸馏 `POST /api/style.distill {text,root?}`（:60） | 3 个样例按钮=范本输入（:14-27,103-116；标注「填入样例」非当前作品）；指标 charCount/avgSentenceLength/dialogueRatio/shortSentenceRatio/sensoryDensity/actionPascal（:131-171）；sepia Pass1 架构/Pass2 语流/Pass3 表层+tellsSummary（:174-214，条件渲染）；currentProfiles 按 scenario 迭代 r{revision}（:221-250），null→引导卡（:241-249） | 04：Style Forge 文风炉视觉，60% 强度；样例必须显式 SAMPLE 标 | MOUNTED_TRUTHFUL |
| 5 | 小说拆解 novel-breakdown | :202-203 `NovelBreakdownView{root}` | novel-breakdown/NovelBreakdownView.tsx(225 行) | `POST /api/novel-breakdown`（:94-107 payload 用 SAMPLE_BREAKDOWNS 预填） | **生产恒 501** `NOVEL_BREAKDOWN_NOT_IMPLEMENTED`（truthfulPreviewRoutes.ts:13-20，注册序先于 demo：api.ts:377-385 + router.ts:55-60 首中即停）；post() 抛错（lib/post.ts:13-16）→ error 分支（:67-71）；结果四区（storyCore/chapterPacing/characterArcs/emotionalBeats :120-221）**生产不可达**；服务端 demo 生成器为死代码（systemRoutes.ts:207-292）；测试仅 mock 200 | 04：三态设计（未配置/为什么/FUTURE DATA LAYOUT，规格 §19） | MOUNTED_PARTIAL_OR_BLOCKED |
| 6 | Story Brain story-brain | :45-50 联动 tab；中心区 Placeholder；真实面板在塔 | story-brain/StoryBrainPanel.tsx(267 行) | 并行 `POST /api/book.state`+`/api/story-brain.entities`+`/api/story-brain.facts`（:44-48） | 五类实体卡 人物/物品/地点/势力/概念（:19-25）点击过滤（:145-155，selectedRef 客户端过滤；服务端 entityIds 过滤未用）；大纲树=总纲+volume+chapters（:163-200，**arc 层缺失**；currentChapterIndex 高亮 :183-188）；事实四通道 canon（主角 POV 授权，:222-229）/suspects/believes（**仅渲染 kernel presentation，秘密值零泄漏** ADR-0026；:230-245）/invalidated（:246-260）；行数+已过滤标记（:206-208）；空态（:133-137,195-197,215-219）；单一 error alert（:121-125）；刷新按钮（:113-120）；**holder 字段不显示**；subject=null 事实在过滤下消失 | 03/05：Character/Lore Card + Timeline Fragment，80% 强度 | MOUNTED_TRUTHFUL |
| 7 | 装配看板 context-receipt | :148-153 `ReceiptPanel{root,onResume}` | context-receipt/ReceiptPanel.tsx(282 行) | `POST /api/receipts`（:50-61）+`POST /api/receipt`（:63-78）；hashMatch 为服务端 sha256 复算真值（HEAD worksRoutes.ts:28-31） | 列表 ch/receiptId/tok/hash badge（:138-155）；空态「完成一次装配（compile）后…」（:133-137）；budget 四段 reserved(reserve+converge)/story(story_text)/fixed(structural)/cap+slack（:21-26,82-99,161-177；**recall_filter 计入 slack 失真**）；entries 含 included/excluded+exclusionReason（:179-202）；Replay Inputs 四格 tokenizer/config/candidates/digest（:204-236）+assembledBy/taskType（:234-236）；resume 三分支 sessionOpen（绿点+回工作台→onResume App.tsx:152）/committed/无开放会话（:238-270；**resume.finished 被忽略**）；刷新不清 detail（陈旧详情驻留）；parseFailures/recomputationHash/storyTextQuota/activation 等字段未渲染 | 03/05：AI 飞行数据记录仪，neutral+Jade+Mono，30% 强度 | MOUNTED_TRUTHFUL |
| 8 | 变更矩阵 change-matrix | :154-159 `ChangeMatrixPanel{root}` | change-matrix/ChangeMatrixPanel.tsx(179 行) | `POST /api/change-matrix`（:38-49）；`POST /api/change-matrix.rerun {root,traversalId}`（:51-62） | 表 rows=Traversal×columns=chapter（:96-141）；三态 cell needs_rework(红)/resolved(绿)/not_affected(—)（:122-135，缺 cell 默认 not_affected）；行名=upstreamChanges kind:id 摘要+traversalId（:116-121）；表头 stale {n} 徽标（:68,77-79）；详情卡 taskRef/trigger.source:ref/recordedAt/upstream/行内 stale 数（:144-166）；rerun 仅 staleCount>0 且全局单飞（:167）；空态（:98-102）/error（:90-94）；**revisionBriefs（服务端已算好每章重写任务书）完全未渲染**；upstreamChanges[].revision 未显示 | 03/05：高密度薄网格表，30% 强度 | MOUNTED_TRUTHFUL |
| 9 | 质量门 quality-gate | :45-50 联动；真实面板 QualityPanel | quality/QualityPanel.tsx(249 行) | 载入 `POST /api/chapter.quality`（:70-79）；审查 `POST /api/chapter.review`（:81-89）；回炉 `POST /api/chapter.rework`（:91-100）；纠错 `POST /api/chapter.corrections`（:102-116） | **载入契约失配**：HEAD `/api/chapter.quality` 返回 `{status:'no_review'\|'current'\|'stale', report}`（HEAD pipelineRoutes.ts:459-495），面板按 QualitySummary 读 → 初载永远出不了 verdict，且 no_review 的 current:false 误触发「报告已 stale」（:143-147）；`hasReport` 无端点发送=死分支（:140）；verdict PASS/NEEDS REWORK/REFUSED 徽标（:51-61,127-129）；rev+hash 前 12 位（:148-152）；rework `min(n,2)/2` 达上限禁用（:153-157,210-214；服务端 422 QualityReworkLimitExceeded）；语义审查 unavailable banner（:200-204，**attached 无显式 UI**）；blocking failures 列表 ruleId(v)+evidence+excerpt（:170-187）；advisories（:188-199）；纠错 10 原因下拉+note（:38-49,230-244；note 空则省略；已记录状态行 :240-244）；reportId/reportPath/mechanicalGate 未渲染 | 03/05：精密仪器不评分卡；blocking 只在关键状态脊暗红 | MOUNTED_TRUTHFUL（含 DESIGN_DELTA：初载失配） |
| 10 | 任务中心 tasks | :198-199 `TasksView{root,…}` | tasks/TasksView.tsx(203 行) | `POST /api/tasks {root}`（:43）→ worksRoutes.ts:177-230（ledger+listImpactRecords 倒序） | totalEvents/totalTraversals 头（:92-96）；事件流 #position·summary/type/category 徽标（:178-195；CATEGORY_LABELS 的 canon/system 两标签服务端永不产生=:20-21 死映射）；traversal 列表 traversalId/影响 N 章/触发源/recordedAt（:126-146；**taskRef/upstreamChanges/fingerprint/projectionVersion 未渲染**；ImpactRecord 无 stale-count 字段）；过滤器 all/pipeline/traversal/review（:36,83-86,157-167）+空过滤态（:170-173）；刷新（:98-100）；no-root empty+前往工作台（:56-81）；error（:110-114） | 05/06：Evidence Row 流水，30% 强度 | MOUNTED_TRUTHFUL |
| 11 | 书源搜索 book-source | :188-193 `BookSourceView{parentDir,…}` | book-source/BookSourceView.tsx(330 行) | `POST /api/book-source.search {query}`（:93）→ crawlerRoutes.ts:139-151 起点+七猫并发（multisource.ts:36-80）；URL 输入→`POST /api/crawler.extract {url}`（:59）；导入 `POST /api/library.import {parentDir,title,initialBody?}`（:110-114；initialBody 仅当导入名=抓取名 :109；服务端写入第一章 worksRoutes.ts:295-315） | 抓取预览 banner channel=crawl4ai 无头渲染/HTTP 提取+300 字摘录（:61-65,175-185）；合成抓取行 bookId='crawled_url'（:67-79）；3 个 SAMPLE_SOURCES 预设独立分区「预设书源推荐样例」（:21-25,278-305）；成功 banner+前往工作台（:166-173）；error 含 409 重名（:160-164）；no-parentDir empty（:125-150）；**degraded/notes 从未读取**（api.ts:253-254 契约在）——降级检索与正常渲染无差别；REAL/CRAWLED/PRESET 三源分区存在 | 06：三源卡不可混淆（规格 §16.2），60% 强度 | MOUNTED_TRUTHFUL |
| 12 | 书源书架 book-shelf | :182-187 `BookshelfView{parentDir,currentRoot,onSwitchBook}` | shelf/BookshelfView.tsx(197 行) | `POST /api/library {parentDir}`（:42）；`POST /api/library.open {root}`（:57）；`POST /api/library.import {parentDir,title}`（:70，409 重名） | 刷新书库 busy「扫描中…」（:112-114）；skipped 仅显示计数「有 N 个目录 book.json 不可读已跳过」（:44,124-128；**path/reason 丢弃**）；导入书名输入+按钮（:139-154，零外部抓取注释 :136）；打开按钮/当前打开禁用（:181-189）；`{bookId} · {root}` 技术行**常驻显示无 disclosure**（:177-179）；no-parentDir empty（:81-101） | 06：私人藏书馆 90%；技术细节收 secondary disclosure（规格 §16.1） | MOUNTED_TRUTHFUL |
| 13 | 技能广场 capability-square | :194-195 `CapabilitySquareView`（无 props） | capability-square/CapabilitySquareView.tsx(98 行) | `POST /api/capability-square`（:29，一次性+取消守卫） | 注册表=服务端 `CAPABILITY_SQUARE_GROUPS` 5 组 17 项（systemRoutes.ts:11-156；与 NAV_GROUPS 一一对应）；四态 native→原生可用/provider_required/configuration_required/external_source_required（:11-16,73-80）；providerAvailable banner「Gate 3 已开」（:60-64）；卡含 label/status/description/{id}·{evidence} mono（:68-88）；**无 detail Sheet、无卡级动作** | 06：Capability Card 90%；右侧 detail Sheet 为 NEW_DESIGN_REQUIREMENT（规格 §17） | MOUNTED_TRUTHFUL |
| 14 | 网文扫榜 rank-scan | :204-205 `RankScanView`（无 props） | rank-scan/RankScanView.tsx(145 行) | `POST /api/rank-scan`（:23） | **生产恒 501** `RANK_SOURCE_NOT_CONFIGURED`（truthfulPreviewRoutes.ts:31-38）→ error（:56-60）；boards/hotScore/tabs（fanqie_hot 默认）等仅在 200 渲染（:65-133）生产不可达；**「本地离线样例」「本地内置数据源」徽标无条件渲染于 501 错误态**（:46-48，诚实缺口）；服务端 demo 榜+degraded/note 全部死代码（crawlerRoutes.ts:14-127,133；degraded 视图也未读） | 06：45% 强度三态（未配置/原因/FUTURE LAYOUT） | MOUNTED_PARTIAL_OR_BLOCKED |
| 15 | 联网搜索 web-search | :206-207 `WebSearchView`（无 props） | web-search/WebSearchView.tsx(174 行) | `POST /api/web-search`（挂载即空查 :32-34） | **生产恒 501** `WEB_SEARCH_NOT_CONFIGURED`（truthfulPreviewRoutes.ts:22-29）→ error（:53-57；三 gated 视图中唯一有 501 测试）；`!data.ok` 不可用分区（:112-122）**不可达**（post() 抛错）；hotQueries 仅成功响应存在=生产不渲染（:89-106）；摘录复制本地功能（:36-40,157-163）；「本地内置资料库」徽标 501 态仍渲染（:48） | 06：同上三态 | MOUNTED_PARTIAL_OR_BLOCKED |
| 16 | 云同步 cloud-sync | :208-209 `CloudSyncView{root}` | cloud-sync/CloudSyncView.tsx(176 行) | `POST /api/cloud-sync {root?}`（:28）；`POST /api/cloud-sync.backup {root}`（:44） | 服务端诚实值：localReady:true/syncStatus:'offline_ready'/syncState.lastSyncedAt=「云同步尚未上线；当前仅为本地文件模式」（systemRoutes.ts:305-338）；视图仅渲染 localCanonFiles/databaseBytes/pendingChangesCount（:94-108）；**localReady/syncStatus/lastLocalSnapshotAt/syncState 全部不渲染；● 本地离线就绪徽标硬编码**（:59）；backup 服务端先校 root（404）后恒 501 `BACKUP_NOT_IMPLEMENTED`（systemRoutes.ts:347-359）→ sync-error（:64-68）；成功 banner（snapshotId/fileCount/manifestDigest :141-148）生产不可达 | 06：Local-First 档案页；local-ready ≠ cloud-synced | MOUNTED_PARTIAL_OR_BLOCKED |
| 17 | 会员中心 membership | :210-211 `MembershipView`（无 props） | membership/MembershipView.tsx(141 行) | `POST /api/membership`（:19；HEAD 另允许 GET 探活 1f0d655） | 服务端 license 恒 null+3 plans（free_community current/pro_lifetime/studio_team 规划中·价格尚未开放，systemRoutes.ts:363-401）；license null→「社区免费版+正式购买与激活服务尚未上线，Pro 权益不对外宣称已解锁」（:69-84）；license 卡仅在 truthy 渲染（:51-67）；购买区「尚未开放」+不设密钥输入/激活按钮（:124-137，测试断言缺席 :56-67）；`/api/membership.activate` 501（systemRoutes.ts:403-409）无 UI 调用 | 06：授权档案页而非三塔 pricing | MOUNTED_PARTIAL_OR_BLOCKED |

---

## 4. Inspector 四域（塔内真实面板）— 状态→设计落点速查

| 域 | no/empty | loading | error | blocked | current/stale | committed/verified | 设计落点 |
|---|---|---|---|---|---|---|---|
| Quality Gate | 无书 InspectorEmpty；初载 `no_review`（现状误显 stale——DESIGN_DELTA Q1） | 无初载 spinner（点击 Run 后无 busy 显示——DESIGN_DELTA） | role=alert（:132-136） | REFUSED+语义 provider banner | current=false→stale 行（no_review 误触发） | PASS=verified 语义（但 PASS 不自动动作） | 03+05 |
| Story Brain | entities-empty / 尚无正文章 / 无关联事实 | 仅刷新按钮文案 | 单一 alert | POV/秘密门禁（canon 主角 POV、suspects/believes 仅 presentation） | currentChapterIndex 高亮 | canon=主角 POV 授权通道 | 03+05 |
| Context Receipt | receipts-empty | busy 标签+「读取 …」 | 单一 alert | hash mismatch=显式红（非静默） | resume.sessionOpen/currentStep | hash match=绿；committed 分支 | 03+05 |
| Change Matrix | matrix-empty | busy 标签 | 单一 alert | — | stale {n} 徽标；rerun 仅 stale 行 | resolved=绿 | 03+05 |

---

## 5. Wizard — `src/wizard/WizardOverlay.tsx`

| 项 | 事实 | 证据 | 设计落点 | 标记 |
|---|---|---|---|---|
| 五步 | `create 建书 / world 世界观 / outline 大纲 / first-chapter 首章 / continue 连写` | WIZARD_STEPS :21-62 | 07-wizard.html | MOUNTED_TRUTHFUL |
| 唯一后端写入 | 仅步骤 1 `POST /api/book`（无 precreated 时）；**步骤 2-5 零网络调用** | :130-145 | 07：后四步=收集输入与 outcome | MOUNTED_PARTIAL_OR_BLOCKED |
| 输入丢弃 | `worldRule/volumePromise/opening/firstChapterGoal` App.tsx:109-117 只用 root/bookId/title，其余弃 | :75-80,146-157 | 07：UI 文案不得暗示已写入 Canon | MOUNTED_PARTIAL_OR_BLOCKED |
| 无据持久化暗示 | 头注释称 step3 走 /api/book.state OutlineNodeScan、step4 喂首个 ChapterProductionSession——**代码从未调用**；outline 步渲染静态文案「新书已就绪：总纲+第一卷骨架（OutlineNodeScan）…」带 data-testid | :10-11,214-218 | 07：改为「将在写作过程中展开」诚实表述 | MOUNTED_PARTIAL_OR_BLOCKED |
| Back/Close/Replay | 上一步 step0 禁用（:163-166）；×→onReplay（:198-206）；scrim data-close 无处理器（:172 装饰性）；重放=TopBar→wizardOpen | — | 07 | MOUNTED_TRUTHFUL |
| 建书失败 | 就地 `wb-error` role=alert，不跳步（:231-235）；busy 建书中（:252）；错误随步清（:114-116） | — | 07 | MOUNTED_TRUTHFUL |

---

## 6. 辅助工具 / 桌面工具面

| 工具 | 真实状态 | 证据 | 设计落点 | 标记 |
|---|---|---|---|---|
| 灵感工坊 | 本地 4 骰（角色/宗门/法宝/卡文）真可用，零 API | DesktopToolModals.tsx:62-77 | 08：LOCAL PRESET 卡牌化 | MOUNTED_TRUTHFUL |
| 时光机 | Unavailable 卡（固定文案：Technical Preview 不展示虚构记录） | :17-26,60 | 08 | MOUNTED_PARTIAL_OR_BLOCKED |
| 导出 | Unavailable 卡 | :79 | 08；export-suite 见 §7.3 | MOUNTED_PARTIAL_OR_BLOCKED |
| 敏感词/合规 | Unavailable 卡 | :80 | 08 | MOUNTED_PARTIAL_OR_BLOCKED |

---

## 7. Code-Present / Unmounted / Experimental 子系统

### 7.1 高级编辑器 — `src/workbench/editor/*`（9 文件全部零 importer）

| 文件 | 能力 | 关键事实 | 标记 |
|---|---|---|---|
| NovelEditorCanvas.tsx | 网文沉浸 textarea 画卷；Enter 自动两全角缩进（:25-48）；一键网文排版（:51-65,76-84）；接 useEditorSelection + EditorQualityTelemetry | 无 importer | CODE_PRESENT_UNMOUNTED |
| BlockEditorEngine.tsx | 头部自宣称「TipTap AST 块级写作引擎」（:80）**实为纯 textarea，无 TipTap 依赖**；`/` 唤起 SlashCommandMenu；插入【场景切分·POV视点】等标记（:52-71） | 无 importer；声明与实现不符 | CODE_PRESENT_UNMOUNTED |
| EditorQualityTelemetry.tsx | `runDeAiDiagnostics`（@mozhou/quality-engine/de-ai 浏览器安全子路径）实时：字数/段落/4-gram 复读/Tier1 必阻断/Tier2 聚集 + De-AI 正典纯净分/AI 腔调待净化分 | 被 ProseEditorPanel 挂载于正文画布下方 | MOUNTED |
| FloatingBubbleMenu.tsx | 选区弹出 4 预设（sensory_expansion/deslop_sharpen/dialogue_polish/plot_twist）+`…` 自定义指令（:21-26,70-88）；selectedText/onClose 收而不用的 props（:11-15） | 无 importer | CODE_PRESENT_UNMOUNTED |
| InlineDiffViewer.tsx | 双栏 diff：红删除线 原始片段 vs 绿 采纳后重构（:43-59）；放弃(Esc)/采纳替换(Enter) 按钮（:30-39，**无键位接线**） | 无 importer | CODE_PRESENT_UNMOUNTED |
| SlashCommandMenu.tsx | 5 命令：scene 场景切分/character 正典角色卡/beat 剧情节拍/rewrite AI 自动续写/deslop 即时去味（:15-21） | 无 importer | CODE_PRESENT_UNMOUNTED |
| useEditorSelection.ts | textarea/window 选区追踪+合成 rect（:53-61）；mouseup/keyup/selectionchange 监听（:104-130） | 仅被 NovelEditorCanvas 引 | CODE_PRESENT_UNMOUNTED |
| customNodes.ts | EditorBlock 类型（paragraph/heading/scene_break/character_quote）+parse/serialize（:1-41） | 零 importer | CODE_PRESENT_UNMOUNTED |
| dialogue/FloatingInspirationDrawer.tsx | 右侧推演抽屉；**setTimeout(600) 硬编码模拟回复**（:35-41）；一键插入正文按钮（:72-81） | 全仓零 importer（含测试） | CODE_PRESENT_UNMOUNTED（含 mock 回复，禁止当真） |

### 7.2 Canon Graph — `src/canon-graph/`

CanonGraphView/CanonNodeCard/CreateContractModal/canonSyncBridge/useCanonGraphData 全部仅目录内互引，App/MobileShell 不挂载。**useCanonGraphData.ts:25-27 含注释「Standard mock or extracted from local data plane」+字面 mock node 数组**。设计方向：低饱和关系拓扑+局部 Jade/Gold contract edges（规格 §24.1），标注 experimental/mock-bound。→ CODE_PRESENT_UNMOUNTED

### 7.3 Genre Kits / Export Suite

| 子系统 | 事实 | 标记 |
|---|---|---|
| genre-kits/ | GenreKitMarketplaceView+genrePresets 仅目录内互引；apply 为局部 UI 状态 | CODE_PRESENT_UNMOUNTED |
| export-suite/ | PublicationExportModal+docxExporter+epubExporter+txtCleanExporter 仅目录内互引；桌面导出按钮实际走 Unavailable 卡；**EPUB fallback-to-text 路径存在——不得宣称完整 EPUB 封装成功**（规格 §24.3） | CODE_PRESENT_UNMOUNTED |

### 7.4 其他死代码 / 不可达分支（DESIGN_DELTA 源）

| 项 | 证据 | 标记 |
|---|---|---|
| `src/api/client.ts` MoZhouApiClient 全套 SDK（含 activateMembership/searchBookSource/extractCrawler/getCloudSync） | 仅 client.test.ts 消费；所有视图走 lib/post.ts | CODE_PRESENT_UNMOUNTED |
| GoalProgressWidget（移动端今日码字进度+连更，完整实现含诚实 fallback） | 全仓零 importer；WorkbenchHub:142-147 手工复刻其不可用态 | CODE_PRESENT_UNMOUNTED |
| MobileStatusBar（本地时钟+「本地创作者·Technical Preview」胶囊+头像→auth 抽屉） | MobileStatusBar.tsx:12-42，挂载于 MobileShell.tsx:69 | MOUNTED_TRUTHFUL（原型派生 chrome，DESIGN_DELTA：规格未列） |
| WebSearchView `!data.ok` 分区 | WebSearchView.tsx:112-122（post() 抛错致不可达） | CODE_PRESENT_UNMOUNTED |
| CloudSyncView 备份成功 banner | CloudSyncView.tsx:141-148（服务端恒 501） | CODE_PRESENT_UNMOUNTED |
| 服务端三套 demo 数据（novel-breakdown systemRoutes.ts:207-292；rank-scan crawlerRoutes.ts:14-136；web-search 本地 KB :172-231） | 全被 truthfulPreviewRoutes 先注册遮蔽（api.ts:377-385+router.ts:55-60） | CODE_PRESENT_UNMOUNTED（fail-closed 保护对象） |
| TasksView canon/system 分类标签 | TasksView.tsx:20-21；服务端只发 pipeline/traversal/review（worksRoutes:191-208） | CODE_PRESENT_UNMOUNTED |
| `/api/draft.question` questions[2]（q2 主角行动决策） | pipelineRoutes.ts:223-248 有契约；DialogueStream 未消费 | CODE_PRESENT_UNMOUNTED（契约在，渲染缺） |
| NDJSON `start` 帧（contextMode/contextTokens/provider）与 `unavailable` 事件 | start 客户端忽略；unavailable 类型存在（api.ts:118-122）从未发出 | CODE_PRESENT_UNMOUNTED |
| DialogueStream phase `answered` | 声明 :11 从未置位 | CODE_PRESENT_UNMOUNTED |

---

## 8. Mobile 五 Hub + 抽屉（<768px）

挂载：App.tsx:124-133。五 pane 常驻挂载仅 display:none 切换（MobileShell.tsx:72-91；mobile.css:170-186）——InspectorHub/WorksHub/SystemHub 首挂载即发请求。

### 8.1 Hub 矩阵

| Hub | 真实能力 | 诚实不可用/缺口 | 设计落点 | 标记 |
|---|---|---|---|---|
| WorkbenchHub（hubs/WorkbenchHub.tsx,161 行） | 书名（:115-117）；`POST /api/draft.question`→PlotBranchWidget（:28-39，首选项标 推荐/备选 :103-107）；MobileComposer 文本+本地 draft cache（composer_draft）+灵感/加冲突/精简/回收伏笔字面标签（MobileComposer.tsx:14,40,43-48）；`POST /api/draft.stream` NDJSON 完整解析+缺 done 帧显式报错（:50-94） | **今日码字诚实卡**（:142-147）；TensionSparkWidget 恒 unavailable（tensionScore 从未提供 :19→不可用卡 :50-59，8 段 stage 条为死视觉）；ProseReadingFlow **零 props 恒空**「正文数据尚未载入移动端阅读面」（:153；ProseReadingFlow.tsx:76-81）；目录抽屉=PreviewUnavailable（onSelectChapter 收而不用 :19-23）；composer activeSkills 硬编码 []（:57）；**选择 choice 仅本地高亮不回填提交**（PlotBranchWidget.tsx:24-27，onSelectChoice 未传）；9 alerts 见下 | 09-mobile.html：WorkbenchHub 重排（真实件升主位、未接件显式 unavailable） | MOUNTED_PARTIAL_OR_BLOCKED |
| InspectorHub（152 行） | 四 tab 设定事实/装配看板/变更影响/质量审查（:74-79）；并行 facts/receipts/change-matrix（:31-35）；canon/perspective 渲染（:86-101）；hash badge MATCH/MISMATCH（:108-114）；rerun 首行 traversalId（:44-55） | **移动 Quality=显式不可用卡**「移动端尚未接入当前章节选择与质量报告…请使用桌面检视塔」（:136-141）；alert 失败（:53）；tab 条样式类未在发行 CSS 定义（缺样式） | 09 | MOUNTED_PARTIAL_OR_BLOCKED（quality=诚实 unavailable） |
| WorksHub（127 行） | `POST /api/works`（:26）；totalWords/totalChapters/entityCount 三格（:61-65）；章行 第NNN章+字数+Rev+phase 徽标 定稿绿/草稿金/规划 accent（:79-102）；空态（:104）；无数据诚实卡（:109-114） | 加章禁用 title=移动端加章尚未接入（:50-52）；文风画像卡+查看状态→distill 抽屉=PreviewUnavailable（:67-73）；导出抽屉不可用 | 09 | MOUNTED_PARTIAL_OR_BLOCKED |
| ResourcesHub（120 行） | `POST /api/book-source.search`（:27）+degraded→notes 提示（:30,85）；`POST /api/crawler.extract`（:47）按钮提取中…（:102-103）；**零结果诚实卡**「未返回真实书源结果/不使用内置推荐样例补位」（:110-117）；结果卡 title/author/platform/category/intro/status（:94-101） | **解构 `{}` 忽略 book/onOpenDrawer props**（:13）；无结果提示不足 44px 高度问题（.mobile-tag 作提交钮 ≈22px :79） | 09 | MOUNTED_TRUTHFUL（触点缺口为 DESIGN_DELTA） |
| SystemHub（103 行） | 并行 `POST /api/tasks {root}`+`/api/membership`（:27-30，失败静默 null）；许可证行=license.planName??"未激活许可证·Technical Preview"（:38,64）；任务中心行=N 条真实事件/未载入（:67）；云同步行=云同步未接入（:68） | authorName 硬编码「本地创作者」/email「未连接账号」（:19,90）；**onSwitchBook 收而不用——移动端实际无法切书**（:13）；任务行不可点击（无移动任务列表）；账号/许可证/导出/书架抽屉全为 PreviewUnavailable | 09 | MOUNTED_PARTIAL_OR_BLOCKED |

### 8.2 移动抽屉系统

`MobileDrawerSheet`（单实例，ActiveDrawerType=auth/license/history/inspiration/export/compliance/chapters/distill，MobileShell.tsx:52-64,96-107）：backdrop 点击关（:16-20）+显式关闭钮（:48-54）+role=dialog aria-modal（:28）+**装饰性 drag handle 无拖拽逻辑**（:29；mobile.css:365-371）；**无 focus trap/Escape/滚动锁**。仅 inspiration 真可用（InspirationDrawer：本地预设 2×2 卡 :42-126；「采用灵感并返回写作」**仅 alert+关闭，无任何数据回流** :140-143）。其余 7 抽屉=诚实占位（MobileShell.tsx:29-38）。→ 09-mobile.html：Sheet 规格重设（drag handle 语义/focus return/reduced-motion）。MOUNTED_PARTIAL_OR_BLOCKED

### 8.3 移动端 9 处 alert()（视觉实现阶段改 inline/sheet 反馈，业务意义不变——规格 §25.3）

WorkbenchHub:44,95,97；InspectorHub:53；ResourcesHub:42,48,49,51；InspirationDrawer:141（该条文案「已将灵感元素填入写作上下文」与实际行为不符——DESIGN_DELTA 诚实缺口）。桌面端 0 alert。

### 8.4 移动触点/背景事实

- 触点不足 44px 的现有控件：.mobile-action-btn≈32px（mobile.css:232-250）、.mobile-user-btn 28px（:148-160）、.mobile-status-capsule 30px（:112-130）、ResourcesHub tag 提交钮≈22px；tab bar 60px+34px safe-area 达标（:292-320）。→ 09 落点：规格 §25.8 ≥44px。
- 根节点 `user-select:none`（mobile.css:59）使正文不可选——正文阅读面设计必须恢复可选。
- 移动背景=FluidInkBackground 18 粒子+grain（FluidInkBackground.tsx:43-96），**无 stage/focus prop、无 Scene System**；规格 §25.2：Scene 保留、Figure 默认关、veil 更重。
- 缺失发行 CSS 的类（仅存在于旧原型 html）：.composer-bottom-dock/.composer-textarea/.send-action-circle/.ins-tab-strip/.pipeline-strip 等 → 真机上 composer dock 与 inspector tab 条未样式化（DESIGN_DELTA）。

---

## 9. Server API 路由总表（HEAD，按分发顺序 storyBrain→pipeline→works→truthfulPreview→crawler→system）

| Route 文件:行 | Method+Path | 契约/语义 | 消费方 | 标记 |
|---|---|---|---|---|
| storyBrainRoutes.ts:12 | POST /api/book | 建书（/tmp/mozhou-book-<ts> 真实磁盘） | WorkbenchView、Wizard | MOUNTED_TRUTHFUL |
| storyBrainRoutes.ts:20 | POST /api/book.state | CanonState 读面 | StoryBrainPanel | MOUNTED_TRUTHFUL |
| storyBrainRoutes.ts:36 | POST /api/story-brain.entities | EntityCardScan[] | StoryBrainPanel | MOUNTED_TRUTHFUL |
| storyBrainRoutes.ts:48 | POST /api/story-brain.facts | canon/perspective/invalidated+chapters（主角 POV） | StoryBrainPanel、InspectorHub | MOUNTED_TRUTHFUL |
| pipelineRoutes.ts:175 | POST /api/session.open | 章节生产会话开启 | **无 UI 消费** | CODE_PRESENT_UNMOUNTED |
| pipelineRoutes.ts:191 | POST /api/session.advance | 会话步进（prepare→…） | **无 UI 消费** | CODE_PRESENT_UNMOUNTED |
| pipelineRoutes.ts:218 | POST /api/capabilities | 9 能力+providerAvailable | DialogueStream | MOUNTED_TRUTHFUL |
| pipelineRoutes.ts:223 | POST /api/draft.question | question/hint/choices/questions[2] | DialogueStream（questions 未用） | MOUNTED_PARTIAL_OR_BLOCKED |
| pipelineRoutes.ts:250 | POST /api/draft.stream | NDJSON start/delta/done/error（流式期间服务端原子落章） | DialogueStream、WorkbenchHub | MOUNTED_TRUTHFUL |
| pipelineRoutes.ts:313 | POST /api/chapter.review | 产 QualitySummary（auto draft→review、409 拒非 draft/review、policy maxAutomaticReworks=2 校验） | QualityPanel | MOUNTED_TRUTHFUL |
| pipelineRoutes.ts:370 | POST /api/chapter.rework | 回炉（上限 2，422 QualityReworkLimitExceeded） | QualityPanel | MOUNTED_TRUTHFUL |
| pipelineRoutes.ts:395 | POST /api/chapter.corrections | reasons 校验+note 仅本机（400 未知原因） | QualityPanel | MOUNTED_TRUTHFUL |
| pipelineRoutes.ts:436 | POST /api/chapter.quality | `{status:'no_review'\|'current'\|'stale', report,current}` ——**与 QualityPanel 期望的 QualitySummary 失配** | QualityPanel（初载失配） | MOUNTED_PARTIAL_OR_BLOCKED |
| worksRoutes.ts:42 | POST /api/receipts | ReceiptListItem[]（hashMatch=sha256 复算） | ReceiptPanel、InspectorHub | MOUNTED_TRUTHFUL |
| worksRoutes.ts:63 | POST /api/receipt | 详情+resume 投影（不重编译） | ReceiptPanel | MOUNTED_TRUTHFUL |
| worksRoutes.ts:93 | POST /api/change-matrix | matrix+rerunCount+revisionBriefs（briefs 未渲染） | ChangeMatrixPanel | MOUNTED_PARTIAL_OR_BLOCKED |
| worksRoutes.ts:107 | POST /api/change-matrix.rerun | 幂等重跑（404 未知 id） | ChangeMatrixPanel | MOUNTED_TRUTHFUL |
| worksRoutes.ts:137 | POST /api/works | WorksOverviewResponse（**genres 硬编码 []**） | WorksView、WorksHub | MOUNTED_PARTIAL_OR_BLOCKED |
| worksRoutes.ts:177 | POST /api/tasks | 事件+ImpactRecord（倒序） | TasksView、SystemHub | MOUNTED_TRUTHFUL |
| worksRoutes.ts:232 | POST /api/ledger | 管线账本事件 | WorkbenchView | MOUNTED_TRUTHFUL |
| worksRoutes.ts:243 | POST /api/library | scanLibrary+skipped | BookshelfView | MOUNTED_TRUTHFUL |
| worksRoutes.ts:264 | POST /api/library.open | 打开书 | BookshelfView | MOUNTED_TRUTHFUL |
| worksRoutes.ts:284 | POST /api/library.import | 导入（409 重名；initialBody→第一章） | BookshelfView、BookSourceView | MOUNTED_TRUTHFUL |
| **truthfulPreviewRoutes.ts:13** | POST /api/novel-breakdown | **501 NOVEL_BREAKDOWN_NOT_IMPLEMENTED（fail-closed）** | NovelBreakdownView | MOUNTED_PARTIAL_OR_BLOCKED |
| **truthfulPreviewRoutes.ts:22** | POST /api/web-search | **501 WEB_SEARCH_NOT_CONFIGURED** | WebSearchView | MOUNTED_PARTIAL_OR_BLOCKED |
| **truthfulPreviewRoutes.ts:31** | POST /api/rank-scan | **501 RANK_SOURCE_NOT_CONFIGURED** | RankScanView | MOUNTED_PARTIAL_OR_BLOCKED |
| crawlerRoutes.ts:139 | POST /api/book-source.search | 起点+七猫并发（degraded/notes） | BookSourceView（degraded 未读） | MOUNTED_PARTIAL_OR_BLOCKED |
| crawlerRoutes.ts:154 | POST /api/crawler.extract | crawl4ai/http_fallback 双通道 | BookSourceView、ResourcesHub | MOUNTED_TRUTHFUL |
| crawlerRoutes.ts:172 | POST /api/web-search | 本地 KB demo（被 gate 遮蔽） | — | CODE_PRESENT_UNMOUNTED |
| crawlerRoutes.ts:13 | POST /api/rank-scan | demo 榜（被 gate 遮蔽） | — | CODE_PRESENT_UNMOUNTED |
| systemRoutes.ts:172 | POST /api/style | currentProfiles（读失败→null） | StyleDistillView | MOUNTED_TRUTHFUL |
| systemRoutes.ts:188 | POST /api/style.distill | evaluateStyleMetrics 真算 | StyleDistillView | MOUNTED_TRUTHFUL |
| systemRoutes.ts:207 | POST /api/novel-breakdown | demo 生成器（被 gate 遮蔽） | — | CODE_PRESENT_UNMOUNTED |
| systemRoutes.ts:295 | POST /api/capability-square | 17 项注册表+providerAvailable | CapabilitySquareView | MOUNTED_TRUTHFUL |
| systemRoutes.ts:305 | POST /api/cloud-sync | localReady/offline_ready/storageUsage/syncState（诚实文案） | CloudSyncView（仅渲染 3 字段） | MOUNTED_PARTIAL_OR_BLOCKED |
| systemRoutes.ts:340 | POST /api/cloud-sync.backup | 404 校 root→**恒 501 BACKUP_NOT_IMPLEMENTED（未创建任何文件）** | CloudSyncView | MOUNTED_PARTIAL_OR_BLOCKED |
| systemRoutes.ts:363 | POST/GET /api/membership | license=null+3 plans | MembershipView、SystemHub | MOUNTED_TRUTHFUL |
| systemRoutes.ts:403 | POST /api/membership.activate | **501**（无 UI 调用） | — | CODE_PRESENT_UNMOUNTED |

客户端调用纪律：`lib/post.ts:8-18` 对 `!res.ok || ok===false` 统一抛错（error.name=server code）——所有 501/4xx 在 UI 层表现为显式 error 分支。

---

## 10. DESIGN_DELTA_FOUND — 审计发现、规格必须吸收的增量事实

1. **QualityPanel 初载契约失配**：`/api/chapter.quality` 实返回 `{status,report,current}` 而面板按 QualitySummary 读 → 初载出不了 verdict 且 no_review 误显 stale；`hasReport` 死分支。设计的状态机必须按 `no_review/current/stale` 三态建模（05/03），并把「初载即有历史报告」作为一等状态。
2. **不存在 accept/采纳契约**：草稿流式期间服务端已原子落章（draft phase）；无 /api/draft.accept、无 AI CANDIDATE 标签。规格 §12.4 的 Accepted 视觉语言按 contract-pending 前瞻设计，不得画成现有行为。
3. **Wizard 后四步纯收集输入**；outline 步现有文案含无据的「OutlineNodeScan」暗示 → 设计改为诚实表述（07）。
4. **RankScan/WebSearch 在 501 错误态仍渲染「本地内置数据源/本地离线样例」徽标**（RankScanView.tsx:46-48、WebSearchView.tsx:48）→ 设计删除该矛盾元素。
5. **BookSourceView/RankScanView 不读 degraded/note**；CloudSyncView 硬编码 ● 徽标不读 localReady → 设计把 degraded、localReady 作为一等状态行。
6. **ChangeMatrix revisionBriefs 服务端已算未渲染** → 设计为「每章重写任务书」抽屉/详情区（NEW_DESIGN_REQUIREMENT，契约已在）。
7. **Receipt resume.finished 被忽略**；刷新不 clears detail；recall_filter 计入 slack → 设计状态机补 finished、刷新语义、budget 对账注记。
8. **Story Brain arc 层大纲缺失、holder 不显示** → 设计 Outline Tree 含 arc 层（数据在 outlineNodes，客户端只取 volume）。
9. **移动端**：GoalProgressWidget 完整实现未挂载；ProseReadingFlow/TensionSpark/PlotBranch 选择/composer skills 均为断线状态；SystemHub 无法切书；InspirationDrawer alert 文案与行为不符；user-select:none 锁死正文；多处触点 <44px；composer dock/tab 条缺发行 CSS；移动无 Scene System。→ 09 原型全量承载；MobileStatusBar 为规格未列的挂载 chrome。
10. **dialogue 导航=PlaceholderView**（规格已知，矩阵固化）；InspectorPlaceholder 死代码。
11. **pipeline session.open/session.advance 后端存在但无任何 UI 消费** → 设计 8 步 Pipeline 六态时的 live running 态，其数据源契约已存在（NEW_DESIGN_REQUIREMENT 候选，实现阶段接线）。
12. **桌面端无任何编辑器挂载**（正文仅存在于 draft slice 与流文本）→ 规格 §12.1 "prose/editor surface when integrated" 按 CODE_PRESENT_UNMOUNTED + Reading Slate 前瞻设计（08）。
13. 服务端 `GET /api/membership` 探活（1f0d655）为 HEAD 新事实。
14. 未提交工作区：server 4 文件为 LocalDataPlane 化内部替换（契约不变）；packages/runtime 新增 canonical-recipes（无 UI 消费）→ 不影响本设计基线。

---

## 11. Delta Re-audit（验收修订轮 · 2026-09-12，GitNexus 刷新后）

**背景**：第一轮验收（CONDITIONAL PASS）指出「图谱索引时间停在 2026-09-06，工作树已有新的生产代码修改，HEAD 不能完全代表当前工作树」——P1-1 硬门禁。本节为刷新后的 delta 复核记录。

**执行**：
1. `node .gitnexus/run.cjs analyze` 全量重建（2026-09-12 17:58，27.3s，8,345 nodes / 18,448 edges / 509 clusters / 496 flows，该轮无 `--pdg`；随后已用 `--pdg` 重建恢复与原索引同层的 CFG/PDG 能力，见 §11.2 终轮记录）。
2. `node .gitnexus/run.cjs status`：Indexed commit = Current commit = `b2a0930`，analyzer runner identity 一致。
3. **工作树事实覆盖核对**（对验收意见「working tree 新事实全部被覆盖」）：
   - 工作树 14 个 tracked 修改文件与本矩阵首轮审计时的集合**完全一致**（server 4 文件 + api.test.ts + 4 个 package 文件 + runtime index），无新增生产修改面。
   - 新增未跟踪 `packages/runtime/src/canonical-recipes.ts`（+test）：`export { createDraftRecipe }`（runtime/src/index.ts:12）——该函数在首轮审计中已被覆盖（draft-step 经 pipelineRoutes.ts:131-152 使用，原子落章链路）；本次为**既有函数移入 runtime 的 re-export**，grep 确认无任何 server route 新引用、无新 API 路径、无新 UI surface。**Surface Map 零增量**。
4. **本轮设计修订新增的文件**（`prototypes/ink-realm/10-skill-square.html` 等）为设计产物，不属于产品 surface。

**结论**：刷新后的图谱 + 工作树 + git diff 三方交叉后，§1–§10 的全部矩阵行维持有效，无新增/失效行。唯一事实补充：`canonical-recipes.ts` 现为 `createDraftRecipe` 的 runtime 侧出处（引用从 draft-step 内部实现改为包导出），不改变任何 UI 状态语义。

### 11.1 验收修订轮（§F 清单）在本矩阵上的落点

| 验收修订项 | Surface Map 落点 |
|---|---|
| 2. Scene 背景人物替换完整交互 | 02-scene-system.html：file input→格式/尺寸/分辨率校验→预览→应用/替换/移除→objectURL 回收→错误态，五路径已驱动验证（详见 Coverage Report 验收轮次） |
| 4. 完整 Skill Square | 新增 10-skill-square.html：17 项真实注册表（systemRoutes.ts:11-156 原文 label/description/status/evidence）+ 分组节奏 + 单选 hero + 可操作 detail Sheet（启用前提/真实不可用原因/动作契约/视图落点） |
| 5. Mobile 44px 清零 | `--touch-target-min:44px` token（assets/ink-realm.css）；09 页全部交互目标接入 token，grep 审计无 <44px 交互残留 |
| P2-1 1280 拥挤 | 03 页 ≤1360px：辅助列折叠为 Sheet（切换钮「辅助 ⌄」）、右塔 392→340、中栏让宽 |
| P2-3 场景默认过暗 | 场景画层重构：主背景=全尺寸氛围层，天际线/云海/书架主体带移入 `::after`；四个场景亮度整体跳档（夜空 #0b1826→#35688a 可见蓝调、月亮/地平线光晕/窗灯可辨）；默认 veil 0.38、亮度 108%；氛围暗角 0.62→0.40 |
| P3-1 证据可读性 | `.row-evidence` 12→12.5px，标识符恒 Foreground 色 |

### 11.2 终轮重建记录（--pdg · 2026-09-12 18:27:51）

- `node .gitnexus/run.cjs analyze --pdg`：28.0s，**41,805 nodes / 84,932 edges / 509 clusters / 496 flows**——CFG/PDG 层已恢复（首轮刷新曾因缺 `--pdg` 触发 full rebuild 降层，此轮与原索引同层且包含全部最终设计产物与工作树事实）。
- `status`：Indexed commit = Current commit = `b2a0930`；analyzer runner identity 逐字节一致；Indexed 18:27:51（晚于全部设计文件最后修改时间）。
- **关于 `Status: ⚠️ stale` 的最终定性（源码级证据）**：GitNexus CLI `dist/cli/status.js:67-72` 明文规定 `isUpToDate` 需满足 `!isWorkingTreeDirty(repoPath)`——"a repo with uncommitted source changes is stale even at the same commit"。novel-ai 工作树携带 **14 个用户未提交的生产修改文件** + 本设计包产物，因此在**不 commit 工作树的前提下，stale 标志结构性无法消除**。这不是索引陈旧：索引内容 = 当前磁盘状态（含全部未提交事实）。消除路径只剩一个——由仓库所有者对其未提交工作做出提交决策后重跑 `pnpm graph:analyze`。设计阶段不代行该决策（验收边界：不污染未提交工作、不 commit/push）。
- **§F-1 的实质目标已达成**：图谱为最终文件状态、工作树新事实全部被索引覆盖、Surface delta 零增量（§11）。

### 11.3 实现轮增量（2026-09-13 · 晨审 §H 六项后）

实现新增的正式 surface（全部 MOUNTED，细节见 Coverage Report 实现状态块）：
- `src/shell/scene/`（SceneLayer/SceneSettingsSheet/scenePreference）— Scene System 一等公民挂载 App/TopBar/MobileShell；
- `src/shell/shellTelemetry.ts` + `useShellTelemetry.ts` — works/receipts/quality/matrix 四证据 → Pipeline 六态真实绑定（旧"选中之前自动 done"推导废除）+ InspectorTower 摘要轨；
- `src/workbench/editor/ProseEditorPanel.tsx` — Reading Slate 写作层正式挂载 WorkbenchView（Canvas/Slash/Bubble 已 Ink Realm 化并接链；EditorQualityTelemetry 已挂载于正文画布下方，经 quality-engine 的 ./de-ai 浏览器安全子路径；InlineDiff 仍暂留未挂载位）；
- `src/mobile/drawers/MobileChaptersDrawer.tsx` — 章节目录实化（/api/works 直读、点章切章）；
- Workbench 章节轨 / DesktopToolModals→non-blocking Sheet / SystemHub 书架切书（library+library.open）/ PlotBranch·灵感→Composer inject 管道 / TensionSpark 八步词表纠正。
截图验收：`screenshots/*.png` 8 张（headless Chrome 实拍 dev server，1440/1280/390）。


## 12. 状态语义 → 设计落点通用映射（全产品适用）

| 状态 | 视觉语言（Ink Realm） | 证据来源 |
|---|---|---|
| loading/busy | 就地文案换字（扫描中…/读取中…/创建中…/重跑中…），保留容器与上下文 | 全部视图现状一致 |
| empty | 诚实空态卡+唯一下一步（建书/去工作台/完成一次装配后…） | 各 -empty testid |
| error | role=alert 内联 Danger+原因+恢复动作；error.name=服务端 code | lib/post.ts:8-18 |
| blocked | 结构化 blocker 卡（Gate 3 provider/501 三视图/移动 Quality/7 抽屉） | DialogueStream:172-176、truthfulPreviewRoutes、InspectorHub:136-141 |
| current/stale | stale 行/徽标（Warning 语义）；matrix stale {n}；rerun 仅 stale | QualityPanel:143-147、ChangeMatrix:77-79 |
| committed/verified | Green：已定稿徽标、hash match、resolved cell、Committed resume 分支 | WorksView:196-202、ReceiptPanel:151-153 |
| accepted | 无契约——前瞻 Gold 瞬时确认（contract-pending） | §2.2 DESIGN_DELTA 2 |
| unavailable/disabled | opacity+说明文字（「尚未接入」「未接入（V1 空态）」「不使用示例」），从不伪装可用 | TopBar:42-44、DesktopToolModals:17-26、各诚实卡 |
