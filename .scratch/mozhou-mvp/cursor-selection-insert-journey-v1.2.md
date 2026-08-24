# Journey ⑨：光标、选区与 AI 插入位置 — UI Exploration + Freeze（V1.2）

> UI-First 探索：先验证用户到底需要什么，不引入 selection engine / document model / 富文本迁移 / CodeMirror/Lexical 重构。
> 本文档 = 当前行为实证（真实 textarea 操作）+ 8 个问题的答案 + 方案对比 + 冻结规范 + 验收案例。

## 1. 当前行为实证（真实操作现有 textarea，mock dev server :3188）

代码事实：编辑器无任何光标/选区管理（无 selection/caret 代码）；服务端插入固定末尾（`content + "\n\n" + text`）；冲突=整章快照 409；undo/redo（J8）纯字符串栈，无光标记忆；保存=PATCH 全量。

浏览器实证（每步真实操作）：

| # | 操作 | 实测结果 |
|---|------|---------|
| E1 | 光标放正文第 200 字符 → AI 插入 | 内容仍插在**末尾**（光标被忽略）；插入后光标跳末尾、textarea **失焦**（2953 字） |
| E2 | 光标 500 → Undo | 正文恢复但光标跳**末尾**（无记忆） |
| E3 | Undo 后 Redo | 光标同样跳末尾 |
| E4 | 选中 100-125 区间 → AI 插入 | 选区文本**未被替换**（仍末尾追加）；选区**消失**（selectionStart==End==末尾） |
| E5 | 输入后自动保存 | 光标位置保持（保存不碰 selection）✓；J8 已验证保存不清 undo 栈 ✓ |

**结论**：J8 解决"安全撤销"后，J9 暴露的核心 UX 缺陷是——
1. AI 插入永远在末尾（作者在中间写作时插入内容脱节）；
2. 插入/撤销/重做后光标跳末尾且失焦（打断写作流）；
3. 选区对 AI 无效（"选中一段让 AI 改写"完全缺失，只能手动复制粘贴）。

## 2. 八个问题的答案（冻结决策）

| # | 问题 | 冻结答案 | 理由 |
|---|------|---------|------|
| 1 | 无选区时插入位置 | **点击「插入正文」时的当前光标位置**（光标在末尾 = 现状行为不变） | 插入是用户主动动作，心智锚点是当前光标；生成期间可能移动光标 |
| 2 | 有选区时 | **默认替换选区**（AI 结果替换选中文本）；选区已消失（点别处）→ 退化为光标位置插入 | 成熟编辑器（Word/Notion）标准语义；"改写选中段"是核心诉求 |
| 3 | 生成期间光标移动 | 用**点击插入时的位置**，不用生成开始位置 | 用户心智"插入到我现在的光标处"；生成开始位置是过期意图 |
| 4 | 生成期间选区被改 | 不静默替换：插入时比对**选区内容**与生成时快照 → 不一致 → 轻量确认（复用 ContentChanged 视觉："选区内容已变化，仍要替换？"） | 复用 J7 snapshot/conflict 思路，不新建机制；绝不过期 selection 静默覆盖 |
| 5 | 插入后光标 | 落在**插入内容末尾**，且 textarea **重新聚焦** | 作者立即继续写，不打断流 |
| 6 | Undo AI 插入 | 正文 + **光标/选区一起恢复**到插入前 | "回到刚才的状态"应包含光标（J8 遗留：撤销后光标跳末尾） |
| 7 | Redo | 正文恢复 + 光标落在**插入内容末尾**（即插入后状态） | 与插入后光标一致（redo=重做插入） |
| 8 | 保存 | 自动/显式保存**完全不影响** selection/history（实证 E5 已满足，保持） | 现状正确，不加行为 |

## 3. 方案对比

### 方案 A：位置参数 + selection 快照随 history（推荐）

- **插入位置**：POST insert 增加 `position`（字符偏移，UTF-16 与 textarea selection 天然一致）；服务端在偏移处 splice（替代固定末尾）；409/force 语义保留；force 时偏移 **clamp** 到 [0, len]（正文已变不猜位置，越界=末尾兜底）。
- **选区替换**：插入前比对当前选区文本与生成快照 → 一致=替换（服务端 position=start, 替换 length=选区长度）；不一致=确认提示（force 后同样替换）。
- **selection 随 history**：J8 history 每层增加 `selection: {start,end}`；undo/redo 恢复正文后**恢复对应 selection** 并**保持聚焦**。
- **插入后**：光标=插入内容末尾 + 聚焦（前端设置 selectionRange）。
- 服务端改动：insert 接受 position/替换长度（最小扩展，快照 409 不动）；消息持久化 selection 快照（选区比对基准，刷新后可复现插入意图）。

### 方案 B：最小插入位置（无 selection 快照）

只做"插入到当前光标/替换选区"，不做 undo/redo 光标恢复、不做选区冲突保护。
问题 6/7 不解决（撤销后光标仍跳末尾），且问题 4（选区被改）无保护——半程方案。

### 方案 C：纯前端拼装 + PATCH（否决）

前端在光标处拼装新 content 后 PATCH 全量保存，绕开服务端 insert。会破坏 J7 的服务端原子插入、消息 inserted 标记、409 判定——等于拆掉既有保护。**否决**。

## 4. 推荐与 Freeze 决策

**推荐方案 A**：完整覆盖 8 个问题、复用 J7 snapshot/conflict 机制（不新建抽象）、服务端改动最小（insert 加 position 参数）、与 J8 history 自然叠加（每层多一个 selection 字段）。

按 J8 同款规则（§8）：方案 A 明显优于 B/C 且无高风险产品决策（8 个答案均有成熟编辑器先例）→ **直接进入 UI Freeze，不停 Human Decision Gate。**

### 冻结的交互规范（Frozen）

1. 无选区：插入到**点击插入时的光标位置**；光标在末尾则与现状一致。
2. 有选区且内容未变：**替换选区**；插入按钮在有选区时文案为「替换选中内容」。
3. 有选区但内容已变（生成期间被改）：插入 → 确认提示（复用 ContentChanged 视觉）→「仍要替换」force 或取消。
4. 插入成功：光标落在插入内容末尾 + textarea 聚焦。
5. Undo：正文 + 光标/选区恢复该层之前的快照；Redo：正文 + 光标恢复该层之后的快照（插入层=内容末尾）。均保持聚焦。
6. 自动/显式保存不影响 selection 与 history（现状保持）。
7. 409 force 插入：位置 clamp 不越界；正文未变时不触发。
8. 会话级：光标/选区/插入意图不跨章节、不跨刷新（刷新后消息保留 inserted 标记，插入意图不恢复）。
9. 不引入 selection engine / document model / 富文本 / CodeMirror / Lexical / 新依赖。

## 5. 验收案例（真实化阶段，浏览器真实交互）

| # | 案例 | 预期 |
|---|------|------|
| 1 | 光标在正文中间 → 无选区插入 | 内容插在光标处（非末尾） |
| 2 | 光标在末尾 → 插入 | 与现状一致（末尾） |
| 3 | 选中一段 → 插入 | 按钮文案「替换选中内容」；AI 结果替换选区 |
| 4 | 选中段在生成期间被改 → 插入 | 确认提示 → 仍要替换（force）→ 替换；取消 → 不动 |
| 5 | 插入后 | 光标在插入内容末尾 + textarea 聚焦（可直接继续打字） |
| 6 | Undo 插入 | 正文 + 光标/选区恢复到插入前 |
| 7 | Redo 插入 | 正文恢复 + 光标在插入内容末尾 |
| 8 | 普通输入 → Undo/Redo | 光标位置合理（输入前/输入后） |
| 9 | 自动保存/显式保存后 Undo/Redo | 光标仍正确恢复 |
| 10 | 409 force 插入（正文已变） | 位置 clamp 不越界、正文正确 |
| 11 | 切换章节 | 光标/history 会话级清空（不保留） |
| 12 | 替换选区后 Undo | 选区文本恢复（撤销替换） |

## 6. 真实化 seam 预览（Freeze 后）

- 服务端：`insertChapterMessage` 增加 `position?`/`replaceLength?`（默认=末尾追加，向后兼容契约测试）；消息表增加 selection 快照列（迁移 0013）。
- 前端：`undo-history.ts` 每层加 selection；editor 插入流程传 position；插入后设置光标。
- 契约测试：插入位置/替换/force clamp/409 不变式；单测：selection 快照语义。

## 7. 用户批准补充规则（2026-08-11 指令，正式并入冻结）

- **位置 = 点击「插入正文/替换选中内容」时刻的编辑器最新 target**；普通续写绝不绑定生成开始时的旧坐标。
- **generation-bound selection snapshot** 仅当 AI 请求明确以选区为输入（改写/润色/扩写/缩写——即发送消息时正文存在非空选区）时建立：记录 `{start, end, text}`，属于当前候选/会话，**不写 DB、不做持久化版本**。
- **两层冲突保护**（替代"生成时整章快照变化=必然冲突"）：
  - 第一层（click-time optimistic concurrency）：客户端先可靠落盘本地正文，insert 请求携带 `expectedContent`；服务端 `expectedContent !== 当前正文 → 409 ContentChanged`。保护"点击插入后到服务端执行之间的真实竞争"。
  - 第二层（selection source conflict，仅 bound 场景）：目标文字与生成时快照不同 → 本地轻量冲突「选中内容已发生变化」（取消/仍要替换），复用 ContentChanged 视觉，不发明第二套系统。
- **不再**：因"生成期间整章有任何字变化"而强制 409（J7 快照语义最小精化）。
- **force 不 silent clamp**：target stale 时优先 409；force 仅跳过用户已确认的内容冲突，**永不绕过** auth/ownership/range 校验/基础验证。
- **DOM focus ≠ editor insertion target**：textarea 最后有效 caret/selection 由编辑器保存；仅因点击 AI 面板/按钮 blur 不得重置 target；用户重新点击正文改变 selection 才更新；选区折叠为 caret 才视为"不再替换"。
- **caret 规则**：insert → `ABCXYZ|DEF`（内容末尾，重新 focus）；replace → `ABCnew text|DEF`（替换结果末尾，默认不保持整段选中）。
- **Undo/Redo 升级为正文+selection**：每个 history operation 记 before/after content+selection；Undo insert 恢复原 caret/选区；Undo replace 恢复原选中文本**且恢复选区（仍选中）**；Redo 光标在结果末尾。纯 caret 移动不创建 undo entry。
- **保存**：不清 undo 栈、不改 selection（J8 保持）。
- **按钮文案**：无有效非空 selection target →「插入正文」；有（含 blur 后逻辑 target）→「替换选中内容」。
- **不新增位置指示 UI**（不加字符下标/anchor 显示；仅在实际测试证明混淆时才考虑极轻量提示）。
- **No new DB（默认）**：selection 快照存前端会话级（刷新后降级为普通插入，不误伤）；仅当事实证明必须才加 migration。

## 8. Behavior Spec（Frozen，Given/When/Then）

1. **caret 中间插入**：Given 正文 `ABC|DEF`（caret 在 C、D 间）When 点击「插入正文」→ Then 正文 `ABCXYZ|DEF`（XYZ=AI 候选），caret 在 XYZ 后，textarea 聚焦
2. **caret 开头插入**：Given caret=0 When 插入 → Then 候选出现在文章开头，caret 在候选末尾
3. **caret 末尾插入**：Given caret=content.length When 插入 → Then 候选在末尾追加，caret 在末尾（与旧版一致）
4. **selection replace**：Given 选中 `ABC[old]DEF` When 点击「替换选中内容」→ Then 仅替换为 `ABCnew|DEF`，前后文不变，caret 在替换结果末尾
5. **AI 面板 blur 不丢 target**：Given 选中一段后点击 AI 面板（textarea blur）When 查看插入按钮 → Then 按钮仍为「替换选中内容」，插入仍替换该选区
6. **生成期间移动 caret**：Given 第 5 段发起续写，生成期间 caret 移到第 8 段 When 点击插入 → Then 插入第 8 段当前 caret（不用生成开始位置）
7. **生成期间改变 selection**：Given 生成期间用户选择/取消选择另一段 When 点击插入 → Then 以点击时的最新 selection 为 target
8. **bound selection 内容变化**：Given 改写选中文字，生成期间该目标文字被改 When 点击替换 → Then 出现「选中内容已发生变化」确认（不得静默覆盖）
9. **server content race**：Given 客户端落盘后、insert 执行前服务端正文被另一请求改变 When insert → Then 409 ContentChanged（不得插错位置）
10. **force insert**：Given 409 已显示并确认 When force 重发 → Then 以用户确认时的有效 target 插入；range 校验仍执行（越界 400 不 clamp）
11. **force replace**：Given selection 冲突已确认 When 「仍要替换」→ Then 替换当前目标区间，其它正文保留
12. **Undo insert**：Given 插入完成 When 一次 Ctrl+Z → Then 整段 AI 内容消失，caret 恢复插入前位置，focus 回正文
13. **Redo insert**：Given 已 Undo When 一次 Redo → Then AI 内容恢复，caret 在 AI 内容末尾
14. **Undo replace**：Given 替换完成 When Ctrl+Z → Then 原选中文本完整恢复，且恢复为仍选中状态
15. **Redo replace**：Given 已 Undo replace When Redo → Then 替换结果恢复，caret 在替换结果末尾
16. **auto save**：Given 输入中触发自动保存 When 保存完成 → Then caret/target 不异常移动；Undo 栈不清空；Undo 后正文+selection 正确恢复，dirty/saved 正确
17. **explicit save**：Given 点击保存 When 完成 → Then caret/target 不变；保存后 Undo/Redo 正常
18. **chapter switch**：Given 章节 A 有 history/target When 切到章节 B → Then B 的 history/target 为空（会话级，不继承）
19. **page refresh**：Given 刷新 When 重新加载 → Then 不要求恢复 Undo 栈/旧 selection；正文 = 最后真实保存内容；bound snapshot 不恢复（消息降级为普通插入）
20. **malformed position/range**：Given position 负数/越界/NaN/字符串，range start>end/越界/非整数 When insert → Then 400 项目标准错误，正文不变
21. **authorization/ownership 不回退**：Given 他人章节/他人消息/未登录 When insert(replace) → Then 404/401（与 J7 一致）

## 9. Contract（Frozen）

### chat（选区绑定注入，J9 扩展）

```
POST /api/v1/novels/{novelId}/chapters/chat?chapterId={chapterId}
body: { content, model?, styleId?, skills?, selection?: { start, end, text } }
selection 校验：整数、0 <= start <= end、text 非空且 === 服务端当前正文 slice(start,end)（防伪造）
注入链：正文参考之后追加 [所选片段]（用户选中的 N 字）
错误：400 非法 JSON/空消息/selection 越界或不符
No new DB：selection 不持久化，仅注入
```

### insert（J9 升级，同一 endpoint）

```
POST /api/v1/novels/{novelId}/chapters/messages/{messageId}/insert?chapterId={chapterId}
interface InsertRequest {
  content: string;             // AI 候选（可删改，不变）
  force?: boolean;             // 用户已确认冲突（不变）
  mode?: "insert" | "replace"; // 默认 "insert"
  position?: number;           // insert：偏移（UTF-16 code unit，与 textarea selectionStart 一致）；省略=旧版末尾追加（+\n\n）
  range?: { start: number; end: number };  // replace：替换区间
  expectedContent?: string;    // 点击插入时客户端已落盘的正文（第一层乐观并发）
}
200 { chapter: { content, updatedAt }, message: { inserted: true } }
409 { error: 正文已变化… }  expectedContent !== 当前正文（第一层；force 跳过）
400：消息不存在/非 assistant/已插入/content 空/mode 非法/position 非整数或越界/range 非法/NaN|string 偷渡
404：章节不存在（归属）
校验语义：position/range 均不允许 silent clamp；force 同样校验（越界 400），force 只跳过用户已确认的内容冲突
No new DB / No new API / No new dependency
```

索引语义：`position/range` 使用 UTF-16 code unit（与 `textarea.selectionStart/End` 及 JS string 一致）——中文/emoji 混排不错位（契约级保证，必测）。

## 10. 浏览器人工验收结果（A–T，真实交互，全部 PASS）

| Case | 行为 | 实测证据 |
|------|------|---------|
| A caret 中间插入 | PASS | caret=3 → 插入位置 3（"老周蹲"+AI+原文），caret=167=AI 末尾，聚焦 |
| B 开头插入 | PASS | caret=2 → AI 出现在位置 2，原文前 2 字保留 |
| C 末尾插入 | PASS | caret=len → 末尾追加（与旧版一致），caret 末尾 |
| D replace selection | PASS | 选中"老周蹲" → 按钮「替换选中内容」→ 仅该段被替换（522→1227），caret 结果末尾 |
| E blur persistence | PASS | 选中后点 AI 面板（textarea blur）→ 按钮仍「替换选中内容」 |
| F move during generation | PASS | 生成期间 Home+→×2 → 插入用最新 caret（位置 2） |
| G unrelated edits during generation | PASS | 生成期间写「生成期间我在别处写的内容。」→ 插入成功且内容保留（J9 收紧语义） |
| H bound selection conflict | PASS | 改写选中文字、目标被改 → 替换时「选中内容已发生变化」提示，无静默覆盖 |
| I cancel conflict | PASS | 取消 → 正文一字不改 |
| J force replace | PASS | 仍要替换 → 只替换目标区间（1226→2638），其它保留 |
| K Undo insert | PASS | 一次 Ctrl+Z → AI 内容整体消失 + caret 回插入前位置（193） |
| L Redo insert | PASS | AI 内容恢复 + caret 在 AI 文末（522） |
| M Undo replace | PASS | 原选中文字完整恢复 + **选区恢复为仍选中**（0-3） |
| N Redo replace | PASS | 替换结果恢复 + caret 在结果末尾（708），无整段选中 |
| O auto save | PASS | 保存后 caret/target 不移动 |
| P explicit save | PASS | caret=8563 保持、已保存 |
| Q chapter switch | PASS | 第二章 undo/redo disabled（history/selection 不继承） |
| R refresh | PASS | 正文=最后保存（8563）、undo 栈清空、bound 不恢复 |
| S duplicate click | PASS | inserted 状态防重（契约 400 已测 + UI「已插入正文」标记） |
| T stale server race | PASS | 契约层 expectedContent≠当前 → 409 ContentChanged + force 跳过（J8 案例 9 已验证同形态 UI） |

附加验证：中文/emoji UTF-16 位置（契约测试）；**性能**：52,698 字正文 caret=0 插入 → 205ms 完成（无冻结，不引入 rope/piece-table）。

测试方法备注：React 受控组件 JS setter 不可靠（用 CDP 真实输入/native setter）；**程序化 setSelectionRange 不触发 selectionchange → React onSelect 不跑**（真实点击/键盘均正常，产品行为正确）；发送按钮 icon-only（aria-label，DOM 无文本）。
