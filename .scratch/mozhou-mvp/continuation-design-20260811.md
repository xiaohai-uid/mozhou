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

## B. User Journey（章节级续写）

```
打开作品（我的作品 → 选中作品）
→ 打开章节（列表点章节 → 章节编辑器页）
→ 查看/编辑正文（textarea 直接改，本地态）
→ 发起续写（底部悬浮条"续写"→ 配置面板展开）
→ 配置续写条件（模型 / 风格 / 长度三档 / 自定义要求）
→ AI 生成（流式预览区逐字出现，正文不动，可随时停止）
→ 得到 Candidate（预览区可删改）
→ 用户决定：
   ├─ 采纳当前内容（Accept；含删改后的部分采纳 Partial Accept）
   │   → 正文末尾追加 → 撤销条出现（可撤销，恢复采纳前快照）
   ├─ 重试（Retry；新候选覆盖旧候选）
   └─ 丢弃（Reject；候选消失，回到可编辑态）
→ 正文变化完成 → 继续写作或保存（保存机制留 Contract Frozen 后）
空章节变体：正文为空时，入口按钮变"生成开头"——同一状态机，文案不同。
```

### 交互决策（产品侧定案，UI Frozen 后可调整）

| # | 决策 | 理由 |
|---|---|---|
| B1 | 续写入口 = 编辑器底部悬浮条 + 章节工具栏按钮 | 写作是"顺流而下"，正文末尾即续写起点；不引入 Slash command/Floating action |
| B2 | 配置项只展示 4 项：模型 / 风格（单选胶囊）/ 长度（短/中/长）/ 要求（单行，可空） | "只展示真正影响用户决策的东西"；上下文范围/RAG 跟随作品级开关（projects 页已有），不做重复面板 |
| B3 | AI 不直接改正文；产出先进候选区（流式预览），Accept 后才追加 | 沿用抽卡候选采纳心智 + 项目安全原则"AI 不直接静默覆盖正文" |
| B4 | Partial Accept = 候选预览区可编辑（删改后点"采纳当前内容"） | 比选区选择更简单可靠，天然支持部分采纳 |
| B5 | Retry 覆盖旧候选（提示文案明示），Reject 只丢弃候选不动正文 | 候选是"未落地的建议"，重复候选无存档价值；拒绝零副作用 |
| B6 | Accept 后撤销条常驻（直到正文再次编辑或切换章节） | 采纳即改正文，撤销是安全网；mock 阶段撤销恢复本地快照 |
| B7 | 生成/候选期间正文锁定（disabled），Idle/Error/Cancelled/Accepted 可编辑 | 生成中改正文会造成上下文漂移；锁定语义简单可靠 |
| B8 | Cancelled 并入状态机（⑧）：停止按钮 → Cancelling（瞬态）→ Cancelled（提示"已停止，未写入正文"）→ 正文可编辑 | 取消是生成流程的自然组成部分，不是独立功能 |

## C. UI 状态机

收敛指令清单（20 态）后，产品上真正不同的状态为 **8 态**（含 2 个变体标记）：

```text
Idle ──(空正文)──▶ EmptyChapter（变体：入口文案"生成开头"）
 │
 ├─ 点"续写" ──▶ Configuring（配置面板展开；正文可编辑；可随时收起回到 Idle）
 │
 ├─ 点"开始生成" ──▶ Generating（Preparing→Streaming 同屏子阶段；正文锁定；可点停止）
 │                     ├─ 流式完成 ──▶ CandidateReady（候选可编辑预览；正文锁定）
 │                     ├─ 点停止 ──▶ Cancelling（瞬态）──▶ Cancelled（提示条；正文解锁）
 │                     └─ 失败 ──▶ Error（红条+重试/丢弃；正文解锁）
 │
 ├─ CandidateReady：采纳当前内容 ──▶ Accepted（正文追加 + 撤销条）──(撤销/编辑)──▶ Idle
 │                   重试 ──▶ Generating（新候选覆盖旧）
 │                   丢弃 ──▶ Idle
 │
 └─ Error：重试 ──▶ Generating / 丢弃 ──▶ Idle
```

**每态：用户看到什么 / 能做什么 / 主按钮 / 次按钮 / 能否退出 / 能否编辑正文 / 进入 / 退出**

| 态 | 看到 | 能做 | 主按钮 | 次按钮 | 退出 | 编辑正文 |
|---|---|---|---|---|---|---|
| Idle | 正文 + 底部"续写"条 | 编辑正文、发起续写 | 续写 | — | — | ✅ |
| EmptyChapter | 空正文占位 + "生成开头" | 同上，文案变体 | 生成开头 | — | — | ✅ |
| Configuring | 配置面板（模型/风格/长度/要求） | 改配置、开始、收起 | 开始生成 | 收起 | ✅ 随时 | ✅ |
| Generating | 流式预览 + 光标 + "参考 N 字·M 条" | 观察、停止 | 停止 | — | 不可（只能停） | ❌ 锁定 |
| CandidateReady | 可编辑候选 + 三按钮 | 删改候选、采纳/重试/丢弃 | 采纳当前内容 | 重试 / 丢弃 | ✅ 丢弃即退 | ❌ 锁定 |
| Accepted | 正文已追加 + 撤销条 | 撤销、继续编辑 | 撤销 | — | ✅ | ✅ |
| Cancelled | 提示"已停止，未写入正文" | 重新续写 | 续写 | — | ✅ | ✅ |
| Error | 红条（原因）+ 重试/丢弃 | 重试、丢弃 | 重试 | 丢弃 | ✅ | ✅ |

**演示变体（仅 Mock 阶段，验收用）**：演示菜单提供 正常 / 模型不可用（配置面板顶部黄条，开始禁用）/ 生成失败（→ Error）/ 空章节示例。UI Frozen 后此菜单删除。

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
