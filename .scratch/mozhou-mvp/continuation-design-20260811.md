# 章节级续写 — UI-First 设计文档（V1.1 Journey ⑦，2026-08-11）

> 模式：UI-First + Contract-Driven + Vertical Slice（Matt Pocock Skills 为工程执行层，本阶段只做产品定义层）。
> 本阶段范围：Current UI & Journey Audit → User Journey → UI 状态机 → 全前端 Mock UI → UI Acceptance Report → **STOP**。
> ⑧ Cancelled UI 态已并入本 Journey 状态机（不再独立排队）。

## A. Current UI & Journey Audit（只读探索结论）

### 用户现在在哪里写章节？
**没有章节编辑器。** `chapters` 表只有骨架（ch/title/status/sortOrder，无 content 字段）；`我的作品` 页（projects-view）是纯列表（ch 编号+标题+草稿/定稿胶囊+删除），点章节没有任何动作。**正文目前只存在于写作对话（chat）的消息流里**，与章节实体完全脱节——这是本 Journey 要打通的核心断裂。

### AI 入口在哪里？
- 写作对话（chat）：SSE 流式 + 抽卡候选 + 模型/风格/作品选择器 + 写作工具面板（合同/任务书/机检/上下文）
- 风格蒸馏（distill）：文本 → 四维风格指南 → 风格库 → 回流 chat

### 已有能力哪些可以复用？
1. **抽卡候选采纳模式**（chat drawCandidates → adoptCandidate）："AI 产出进候选区 → 用户点选用 → 进入正文流"——本 Journey 的 Candidate 采纳机制沿用此心智
2. **风格胶囊**（chat 顶部单选胶囊，R4 + 工单 15）：续写配置的风格选择器直接复用此形态
3. **模型选择器**（chat select，MODELS 常量）：复用
4. **Error banner + Retry**（chat error + retryLast）：复用形态
5. **设计系统**：zinc 深色 + violet accent 单色 token、rounded-card/bg-surface/bg-surface-2/text-faint、Phosphor icons、base-ui+cva Button
6. **写作工具面板**（合同必含词/禁区词）：可作续写"参考上下文"的补充信息来源（本阶段不做，留 Contract Frozen 后）

### 哪些 UI 会与章节续写发生冲突？
- **我的作品页**（projects-view）：三栏（人物/世界观/章节）+ RAG 配置 + 审查记录 + 导出，信息密度已满——章节编辑器/续写面板塞进去必然挤压，**不在此页做编辑器**，只加"打开章节"入口
- **chat 对话页**：对话心智 ≠ 成稿心智；续写是"在章节里往下写"，不是"和 AI 聊天"——**不与 chat 合并**
- 写作工具面板：是 chat 的侧栏，不搬进编辑器（阶段外）

### 章节续写最自然从哪里进入？
**我的作品 → 章节列表 → 打开章节 → 章节编辑器页**。续写入口在编辑器**底部悬浮条**（顺流而下的写作动作，正文末尾即续写起点），章节工具栏备选入口。不用 Slash command（中文网文作者无此习惯，且 V1.0 无先例）；不用 Floating action（容易遮挡正文）。

## B. User Journey（章节级续写 · 对话代理式，v2 修订 2026-08-11）

> 用户反馈修订：参考灵笔（lingbi-next，OB/代码核验）的"对话工作方式"——章节续写不是单次生成工具，
> 而是**在章节上下文里与 AI 多轮对话**（接墨舟写作对话的形态），产出经确认插入正文。正文永不锁定。

```
打开作品 → 打开章节（章节编辑器）
→ 查看/编辑正文（随时可改，永不锁定；本地"未保存/已保存"状态展示）
→ 右侧 AI 对话面板：与 AI 对话（多轮）——对话参考当前正文与作品设定
→ AI 回复流式出现（Preparing → Streaming；可随时停止，停止保留已生成部分）
→ 回复完成：可「插入正文」/「忽略」，或继续下一轮对话
→ 插入正文：正文末尾追加 + 消息标记"已插入"
   ⚠ 正文在生成后被修改 → 冲突确认（灵笔 DocumentConflict/CandidateStale 语义）：
     "正文已变化，这条回复基于旧正文" → 仍要插入 / 取消（默认不覆盖用户内容）
→ 空章节变体：空态「让 AI 起笔这一章」→ 自动发起对话 → 回复确认后插入
```

### 交互决策（v2 修订）

| # | 决策 | 理由 |
|---|---|---|
| B1 | 对话面板在**编辑器右侧**（AI 对话栏），不是底部工具条 | 灵笔形态；正文长文写作时右侧对话不打断阅读/编辑；接 chat 消息气泡形态 |
| B2 | 多轮对话（可追问调整），回复完成才可插入；「忽略」即弃 | 对话代理式：写作是"和 AI 来回商量"，不是一次生成任务 |
| B3 | **正文永不锁定**（生成/对话期间可编辑）；插入时快照冲突检测 | 灵笔 DocumentConflict："为了保护你的内容，没有覆盖当前正文"；锁定正文不符合真实写作流 |
| B4 | 冲突时默认不覆盖：黄条 + 「仍要插入 / 取消」 | 用户内容优先（灵笔 keep_current 语义） |
| B5 | 停止保留已输出部分，仍可插入 = 天然部分采纳通道 | 比 v1 的候选删改更自然（对话里选中段即删改） |
| B6 | 保存状态展示（未保存/已保存，2s 防抖本地态）+ 空章节起笔按钮 | 灵笔 SaveStatus/Recovery 语义的 mock 版；真实保存/恢复留 Contract 后 |
| B7 | 错误人性化：标题 + 怎么办 + 动作（retry/reconfigure/switch_model） | 灵笔 humanizeError 语义；"操作没有成功"式裸报错不符合产品 |
| B8 | Cancelled（⑧）并入对话流式：停止 = 消息标记"已停止"，非整页状态 | 对话式中"取消"是消息级动作，不是页面级状态机 |

### 交互决策（v3 修订：技能驱动对话，2026-08-11 用户定案 A）

> 用户反馈（第二轮）："看 OB b（笔枢写作）是怎么对话的，那些 skill 是怎么使用的" →
> 笔枢写作 = 工作流/技能驱动（bishu-novel 插件 33 个 Agent-Prompt 组合，每个写作动作是技能化流程）；
> 墨舟已有 skill 体系（技能广场 + chat 技能胶囊注入 system）。用户定案：**章节续写对话 = 技能驱动**。

| # | 决策 | 理由 |
|---|---|---|
| B9 | 对话面板头部**技能胶囊行**（多选，复用 chat 技能胶囊形态）：场景技能 + 墨舟广场技能（去AI味/人物小传/信息差设计） | 续写不是"裸对话"——AI 按技能 systemPrompt 规则对话产出（笔枢 33 Agent-Prompt 同构） |
| B10 | 场景技能随章节状态切换：非空默认选中「章节续写」，空章节默认「章节起笔」（起笔按钮明示"技能：章节起笔"） | 发起续写 = 触发场景技能；空章节起笔是同一机制 |
| B11 | AI 回复头部显示**本次生效技能标签** `[技能] 章节续写 · 去 AI 味`（发送时快照） | system 注入的可见性（用户知道 AI 按哪些技能在写）；mock 用假技能库，UI Frozen 后换真实 /api/v1/skills |

## C. UI 状态机（对话式，v2 修订）

消息级状态（对话消息自身）：
```text
streaming（Preparing→Streaming）→ done / stopped / error
done → [插入正文] → inserted（或忽略，留在对话）
正文编辑 → 旧回复插入时 snapshot≠body → confirmInsert（仍要插入/取消）
```

页面级状态（面板 + 空章节 + 演示）：
```text
ChatIdle（对话就绪；Empty 变体：空态"让 AI 起笔这一章"按钮）
ChatStreaming（一条回复生成中；输入区变停止按钮）
NoModel（黄条 + 输入/发送禁用）
```

每态：用户看到什么 / 能做什么 / 主按钮 / 能否编辑正文 / 进入 / 退出

| 态 | 看到 | 能做 | 主按钮 | 编辑正文 | 进入/退出 |
|---|---|---|---|---|---|
| ChatIdle | 消息列表 + 输入框 | 对话、编辑正文 | 发送 | ✅ 永不锁 | 打开章节 / 回复完成 |
| ChatStreaming | AI 消息流式 + 光标（Preparing 显示"正在组织上下文…"） | 观察、停止 | 停止 | ✅ 永不锁 | 发送 / 完成或停止 |
| MessageDone | 回复完成 + [插入正文][忽略] | 插入、忽略、继续对话 | 插入正文 | ✅ | 流式完成 / 插入或忽略 |
| InsertConfirm | 黄条"正文已变化，这条回复基于旧正文" + [仍要插入][取消] | 强制插入、取消 | 仍要插入 | ✅ | 正文变化后点插入 / 确认 |
| Inserted | 消息标记"已插入 ✓" | 继续对话 | — | ✅ | 插入成功 |
| Cancelled（消息级） | "已停止 · 可插入已生成部分" | 插入部分、继续对话 | 插入正文 | ✅ | 停止 / 插入或忽略 |
| Error（消息级） | 人性化：标题 + 怎么办 | 重试（再发一轮）、忽略 | — | ✅ | 失败 / 忽略 |
| NoModel | 黄条"模型不可用" + 输入禁用 | — | — | ✅ | 演示/真实无模型 |

演示变体（仅 Mock 阶段）：演示菜单 = 正常 / 模型不可用 / 生成失败 / 空章节示例。UI Frozen 后删除。

## D. Mock 实现范围（第四阶段）

- 新页面 `app/chapter/[chapterId]/page.tsx` + `components/features/chapter-editor-view.tsx`（AppShell 包裹，设计语言全复用）
- 数据**全本地假**：假作品名/章节标题/正文（有正文示例 + 空章节示例）；风格胶囊用假列表（UI Frozen 后换真实 /api/v1/styles）；模型用 MODELS 静态常量
- mock 函数族：`mockContinueChapter / mockStreamContinuation / mockCancelContinuation / mockAcceptCandidate / mockPartialAcceptCandidate / mockRejectCandidate / mockRetryContinuation`（定时器模拟流式，无网络）
- 入口：`我的作品` 章节项包 Link → mock 章节页（query 传 名称/编号/标题）
- 禁止：DB 表、migration、真实 API、Provider、Streaming 服务、Domain abstraction、正式 Ticket

## E. 未决（Contract Frozen 后再定，现在不设计）

- 正文 content 持久化模型（chapters 表无 content 列）
- 生成任务/candidate/event log 的表结构
- 保存/自动保存机制
- 撤销的服务端语义

## F. 浏览器实测发现（2026-08-11，已修复）

1. **流式不启动 bug**：`setTimeout` 回调闭包捕获旧 `phase`（调用时为 configuring），`phase !== "generating"` 永远成立 → 流式卡 Preparing。修复：闭包不查 state，只用 genId 代际校验防竞态。
2. **Accepted 态续写被拦截**：采纳后用户自然想接着往下写，但 `mockContinueChapter` 守卫拒绝 accepted 态。修复：放开 accepted；开始新生成 = 放弃上一次采纳的撤销权（撤销条消失）。
3. **NoModel 时配置面板打不开**：配置展开按钮也随 no-model 禁用 → 用户看不到禁用原因。修复：黄条移到主条常显（不藏进配置面板），配置仍可展开查看（开始生成按钮禁用）。
