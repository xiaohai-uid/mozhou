# UI Acceptance Report — 章节级续写 Mock Preview（V1.1 Journey ⑦）

- **日期**: 2026-08-11
- **模式**: UI-First（产品定义层）；工程执行层未启动（无 DB/API/Provider/Ticket）
- **范围**: 章节编辑器 + 续写状态机（⑧ Cancelled 并入）全前端 Mock；入口 = 我的作品 → 章节
- **结论**: **10/10 状态浏览器实测通过**（含 2 个修复迭代），Mock 可完整操作。等待 UI Frozen 批准。

## A. Journey（最终用户路径）

```
我的作品 → 打开章节（章节项可点）→ 章节编辑器
  → 查看/编辑正文（textarea，本地态）
  → 底部"续写"（空章节时变"生成开头"）→ 配置面板（模型/风格/长度三档/要求，可跳过直接续写）
  → 开始生成：Preparing（组织上下文）→ Streaming（候选预览逐字出现，正文锁定，随时可停止）
  → CandidateReady：候选可删改（部分采纳）→ 采纳当前内容 / 重新生成（覆盖旧候选）/ 丢弃
  → Accepted：正文追加 + 撤销条（撤销恢复采纳前快照；再编辑或再续写则撤销权消失）
  → 回到可编辑态，继续写作
```

## B. UI 状态（实际实现，10 态）

| 状态 | 验证 | 说明 |
|---|---|---|
| Idle | ✅ | 正文可编辑，底部续写条 |
| EmptyChapter | ✅ | 空正文：占位文案 + 主按钮变"生成开头"，全流程可走通（0→217 字） |
| Configuring | ✅ | 模型 select + 风格胶囊（Mock 库）+ 长度短/中/长 + 要求输入 + 参考范围说明；可跳过（快捷续写） |
| Generating（Preparing/Streaming） | ✅ | 正文/模型/风格锁定；流式预览 + 光标；"参考前文 N 字"标注；停止按钮 |
| Cancelling（瞬态） | ✅ | 停止 →"正在停止…"250ms → Cancelled（并入 Cancelled 呈现） |
| Cancelled | ✅ | "已停止生成，未写入正文"提示条；正文零变化；可立即重新续写 |
| CandidateReady | ✅ | 候选可编辑预览 + 丢弃/重新生成/采纳当前内容；正文仍锁定 |
| Accepted | ✅ | "已采纳 N 字，正文已更新"+ 撤销采纳按钮；撤销后正文恢复快照（201→275→201 实测） |
| Partial Accepted | ✅ | 删改候选后采纳 = 只采纳保留部分（被删段落未入正文，DOM 断言） |
| Error | ✅ | 红条（失败原因）+ 重试/丢弃；重试进入 Generating；正文零变化 |
| NoModel（ProviderUnavailable） | ✅ | 黄条常显"模型不可用"+ 续写/开始生成禁用；配置可展开查看 |

## C. 关键交互决策（B 节决策落点）

1. **续写入口 = 编辑器底部悬浮条**（+ 章节工具栏同按钮）：正文末尾即续写起点，"顺流而下"；不用 Slash command（中文网文作者无此习惯）不用 Floating action（遮挡正文）。项目现状没有章节编辑器，本页补齐（mock）。
2. **配置只 4 项**：模型 / 风格（单选胶囊，复用 chat 形态）/ 长度三档 / 自定义要求。上下文范围/RAG 跟随作品级开关（projects 页已有），不重复造面板。
3. **AI 不直接改正文**：产出进候选预览区（流式期间正文锁定），Accept 才追加——沿用抽卡候选采纳心智 + 项目安全原则。
4. **Partial Accept = 预览区可编辑 + "采纳当前内容"**：删改即部分采纳，比选区交互简单可靠。
5. **Cancel = 零副作用**：停止 → Cancelled 提示，正文零变化；重新续写从正文末尾继续。
6. **Error 恢复**：红条 + 重试（进入新 Generating，旧候选不残留）/ 丢弃（回 Idle）。
7. **Retry 覆盖旧候选**：候选是"未落地建议"，无存档价值；文案明示"重新生成"。
8. **Undo**：采纳后撤销条常驻，直到正文再编辑或再续写（撤销权转移语义）。

## D. 浏览器验证（实际点击，非代码推断）

- 全流程：打开章节（projects 真实章节 Link）→ 配置展开 → 生成 → 流式 → 候选 → 采纳 → 撤销 → 再续写 → 停止（Cancelled）→ Error（演示）→ 重试 → NoModel（演示）→ Empty（演示）→ 生成开头全流程
- 状态切换全部通过 DOM 断言（按钮 disabled 态、提示条文案、正文长度变化、撤销恢复）

## E. 截图 / DOM 证据

截图（用户 Temp 目录，6 张）：
- `cont-01-configuring.png` — 配置面板（长度三档 + 要求输入）
- `cont-02-candidate.png` — CandidateReady（候选预览 + 三按钮）
- `cont-03-cancelled.png` — Cancelled 提示条
- `cont-04-error.png` — Error 红条 + 重试/丢弃
- `cont-05-nomodel.png` — NoModel 黄条 + 禁用态
- `cont-06-empty-accepted.png` — 空章节生成开头 → 采纳后（0→217 字）

关键 DOM 断言（evaluate_script 实测返回值）：
- 部分采纳：`bodyLen 275 = 201+74，hasCutPart false`（被删段落未入正文）
- 撤销：`bodyLen 201，hasContinuation false`（快照恢复）
- 取消：`cancelledBanner true，bodyLen 201`（零副作用）
- Error：`errorBanner true，hasRetry/hasDiscard true，bodyLen 201`
- NoModel：`yellowBanner true，continueDisabled true，startDisabled true，configOpen true`
- Empty：`emptyBody true，startLabel true` → 采纳后 `bodyLen 217，acceptedBanner true`

## F. 尚未实现（明确标注）

- 正文 content 持久化（chapters 表无 content 列；编辑器正文为本地 state）
- 真实 API / Provider / Streaming（全部为本地定时器 + 假文字池；模型/风格为 Mock 列表）
- 保存/自动保存、章节状态流转（草稿→定稿）
- RAG 上下文真实注入（显示"参考前文 N 字"，未接检索）
- 演示菜单（正常/模型不可用/生成失败/空章节）——仅 Mock 阶段验收用，UI Frozen 后删除
- 正文编辑的撤销（仅采纳撤销；手动编辑无 undo 栈）
- 已采纳字数按字符数计（文案"字"，真实实现可换 token/字符语义）

## G. 实测修复记录（浏览器驱动发现）

1. setTimeout 闭包捕获旧 phase → 流式卡 Preparing（改 genId 代际校验）
2. Accepted 态点续写被守卫拦截（放开 + 撤销权转移）
3. NoModel 时配置面板打不开、看不到禁用原因（黄条移主条常显）

## 停止点

**UI Acceptance Gate 达成。** 未启动任何 API/DB/Provider/Ticket。等待人工批准「UI Frozen」后，按既定流程（grill-with-docs → to-spec → Interaction/Application Contract → Domain/Persistence Model → to-tickets → Walking Skeleton → Progressive Swap → Vertical Slice → TDD → review → E2E → Milestone Gate）继续。
