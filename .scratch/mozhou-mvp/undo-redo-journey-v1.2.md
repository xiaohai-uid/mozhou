# Journey ⑧：正文编辑 Undo / Redo — UI Exploration + Freeze（V1.2）

> 阶段 B 严格 UI-First。本文档 = 编辑器事实调查 + 两个方案 + 推荐 + 冻结决策 + 验收案例。
> 冻结后进入最小真实化（纯前端，预期 **No new API / No new DB / No new dependency**）。

## 1. 当前编辑器技术事实（基于代码与浏览器实证）

| # | 问题 | 事实 |
|---|------|------|
| 1 | 编辑组件 | `components/features/chapter-editor-view.tsx` 原生 `<textarea>`（受控组件） |
| 2 | 实现 | 非 contenteditable / CodeMirror / Lexical / ProseMirror——纯 `<textarea value={body} onChange>` |
| 3 | 编辑状态 | React `useState<string>`（body）+ saveState（saved/dirty/saving/failed） |
| 4 | 自动保存 | `onBodyChange` → setBody + dirty + 2s 防抖 → PATCH content（`chapter-editor-view.tsx:144`） |
| 5 | 显式保存 | 顶栏「保存」按钮 → `saveBody`（同 PATCH 端点） |
| 6 | AI insert 改正文 | `insertToChapter`：先 `saveBody(body)`（防抖未触发时兜底）→ POST insert → 用**服务端返回 content** `setBody`（不本地拼接） |
| 7 | conflict/force insert | 409 ContentChanged → 本地 confirmInsert 态 → force 重发（同一路径） |
| 8 | 原生 Undo 可用性 | 受控 textarea 下用户输入可触发浏览器原生 undo（Chrome）；但**程序性赋值（React setBody）会破坏/重置原生 undo 栈** |
| 9 | 程序性修改进原生栈 | 否——AI insert 后 setBody(服务端 content) 是程序性赋值，不可撤销，且清空原生栈 |
| 10 | 依赖自带 history | 无——依赖仅 @base-ui/react / phosphor / drizzle 等，无任何编辑器库含 undo API |

结论：**浏览器原生 undo 只能覆盖「纯用户输入」这一最小场景**，无法满足核心需求
（AI 插入一次撤销、force insert 一次撤销、保存不破坏 undo、撤销后保存状态正确）。
现有依赖无 history 能力 → 按指令优先级 4，需要最小自定义 history 实现。

## 2. 方案 A：自定义轻量 history 栈（推荐）

`useBodyHistory(initialBody)`：`past: string[]`（undo 栈）+ `future: string[]`（redo 栈）。
所有正文变更走单一入口 `commit(next)`：

- **用户输入**：2s 防抖窗口内连续输入合并为一层 undo（与自动保存同窗口，心智一致）。
- **程序化变更**（AI insert / force insert / 起笔 / 清空）：始终作为**单个原子操作**入栈，不做合并。

```ts
commit(next) {
  if (next === current) return;
  past.push(current); future = [];
  setBody(next); scheduleAutoSave(next); // 与现有 2s 防抖保存一致
}
undo()  { if (!past.length) return; future.push(current); setBody(past.pop()); scheduleAutoSave(next); }
redo()  { if (!future.length) return; past.push(current); setBody(future.pop()); scheduleAutoSave(next); }
```

- **自动保存 ≠ 清空 undo 栈**：saveBody 只更新 `lastSavedContent` ref，不动 past/future。
- **保存状态**：`body === lastSavedContent → saved`，否则 `dirty`（进入防抖自动保存）。
  Undo 恰好回到保存点 → 显示「已保存」；撤销到别处 → dirty → 2s 后保存（行为与手动编辑一致）。
- **force insert 一次撤销**：force insert 的返回值同样走 `commit`（原子）→ 一次 Undo 回到插入前正文。
- **冲突安全**：Undo 只改本地 body；插入仍走 saveBody → 服务端快照比对 → 409 语义不变。
- **会话级**：history 在组件 state/ref 中，切换章节/刷新/跨设备不保留（冻结规则）。
- **键盘**：textarea onKeyDown 拦截 `Ctrl+Z`（阻止默认，避免与原生双重撤销）、`Ctrl+Shift+Z` / `Ctrl+Y`。
- **UI**：正文区 header 加 Undo/Redo 图标按钮（栈空 disabled，title 提示快捷键）。
  不加时间轴 / 历史侧边栏 / 版本页面 / 插入后 toast（「已插入正文」标记已存在）。

## 3. 方案 B：textarea 原生 undo + execCommand 合成程序化修改

- 用户输入免费获得原生 undo（Ctrl+Z / Ctrl+Y）。
- AI 插入用 `document.execCommand("insertText")` 注入 → 单次调用 = 原生栈**一个**条目 → Ctrl+Z 一次整体撤销。
- 自动保存与原生栈天然无关。
- 风险/缺陷：
  - `execCommand` 是**已废弃 API**（Chrome 多年标记 deprecated，移除风险）；
  - 要求 textarea 有焦点（AI 插入时用户通常在聊天面板，不在 textarea）；
  - React 受控组件 + execCommand 有 DOM/state 竞态窗口；
  - 合并粒度不可控（无法保证「连续输入一层」的稳定语义，浏览器实现差异）；
  - force insert / 起笔等路径都要改走 execCommand，绕不开同样的焦点问题。

## 4. 混合方案（否决）

输入用原生栈 + 程序化用自定义栈：Ctrl+Z 一会走浏览器、一会走自定义栈，**undo 序列心智断裂**，
且原生栈被程序化赋值破坏后顺序混乱。否决。

## 5. 推荐方案与决策

**推荐：方案 A。**

- 满足全部核心行为（AI 插入/force insert 单次撤销、保存不清栈、撤销后保存状态正确）；
- 无废弃 API、无焦点依赖、无受控竞态；
- 实现极小（单一 hook，约 80 行），不引入任何依赖、不新增 API/DB；
- 与现有保存状态机（saved/dirty/saving/failed）天然整合。

按指令 §8：方案 A 明显优于方案 B 且不存在高风险产品决策 → **直接进入 UI Freeze，不停 Human Decision Gate。**

### 冻结的交互规范（Frozen）

1. 正文区 header 右侧（保存按钮旁）新增 Undo / Redo 图标按钮；对应栈空时 `disabled`；title=`撤销 (Ctrl+Z)` / `重做 (Ctrl+Shift+Z)`。
2. textarea 内 `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` 生效（阻止浏览器默认，防止双重撤销）。
3. 连续输入（2s 窗口）＝一层 undo；AI 插入 / force 插入 / 起笔 / 清空 ＝ 单原子一层。
4. 撤销/重做后保存状态按「与最后保存内容比较」显示；变化则进入既有 2s 防抖自动保存（撤销内容最终落盘）。
5. 自动保存与显式保存**均不清空** undo 栈。
6. 章节切换 / 页面刷新 / 跨设备：history 不保留（会话级，不升级为持久化系统）。
7. 无时间轴、无历史侧边栏、无版本页、无插入后特殊提示。

## 6. 人工验收案例（15，浏览器真实交互验证）

| # | 案例 | 预期 |
|---|------|------|
| 1 | 普通输入 → Undo | 恢复输入前正文 |
| 2 | Undo → Redo | 恢复撤销前正文 |
| 3 | 多段连续输入 | 2s 窗口内合并为一层 undo；停顿后为另一层 |
| 4 | AI 一次插入大段 → 一次 Undo | 整个插入整体撤销（一次按键） |
| 5 | Undo AI 插入 → Redo | 插入内容完整恢复 |
| 6 | 自动保存后 Undo | 仍可撤销（保存不清栈） |
| 7 | Undo 后保存状态 | 回到保存点=「已保存」；否则 dirty → 2s 后保存 |
| 8 | 显式保存后继续编辑/Undo | 正常 |
| 9 | force insert 后整体 Undo | 一次撤销回到插入前正文 |
| 10 | AI 生成期间用户新增内容 | Undo AI 插入不覆盖生成期间的新增 |
| 11 | Undo 不破坏章节对话 | 消息列表不受影响 |
| 12 | 栈空时按钮 disabled | Undo/Redo 均禁用；输入后 Undo 可用 |
| 13 | 键盘快捷键 | Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 正常 |
| 14 | 鼠标操作 | 点击按钮撤销/重做正常 |
| 15 | 切换章节 | 新章节 history 为空（会话级，不保留） |

## 7. 实现 seam（冻结后）

- **纯前端**：`components/features/undo-history.ts`（hook）+ chapter-editor-view 集成。
- **No new API / No new DB / No new dependency**（与 V1.1 最小化原则一致）。
- 单元测试：hook 的栈语义（合并/原子/undo/redo/save 关系）；契约测试：零改动（无服务端变化）。

## 8. 实现记录（UI Freeze 后最小真实化）

- **seam**：`components/features/undo-history.ts` — `createBodyHistory`（纯逻辑，可单测）+ `useBodyHistory`（useState 惰性实例 + useReducer bump + useMemo 稳定返回对象，getter 惰性读 current/canUndo/canRedo）。
  > 实测发现：返回对象不稳定会导致编辑器加载 effect 每次渲染重跑（请求风暴）——useMemo 稳定化是必要修复。
- **No new API / No new DB / No new dependency**。
- **atomic operation**：`apply()`（AI 插入 / force 插入 / 起笔 / 清空）始终 push 当前值 + 原子更新 = 一层 undo；`type()` 在 2s 窗口内合并连续输入（与自动保存同窗口）。
- **auto-save 共存**：保存（自动/显式）只更新 `lastSavedRef`，不动 past/future 栈；undo/redo 后经统一 `markChanged`：正文 == lastSaved → "已保存"，否则 "未保存" → 2s 防抖自动保存（撤销结果最终落盘）。
- **AI insert / force insert 入栈**：插入成功路径 `apply(服务端 content)`（单原子一层，一次撤销整体回退），不依赖浏览器原生 undo 栈（程序性赋值不进原生栈）。
- **快捷键**：textarea onKeyDown 拦截 Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y（preventDefault 防浏览器双重撤销）；正文区 header Undo/Redo 图标按钮（栈空 disabled）。

## 9. 人工验收结果（浏览器真实交互，15/15 PASS）

| # | 案例 | 结果 | 实测证据 |
|---|------|------|----------|
| 1 | 普通输入 → Undo | PASS | 输入"他抬起头。"(629) → Ctrl+Z → 624 |
| 2 | Undo → Redo | PASS | Ctrl+Shift+Z → 629 |
| 3 | 多段连续输入 | PASS | 同一 2s 窗口输入合并一层（一次撤销整段）；窗口外分层（实测间隔 >2s 时一次只撤销一段，符合冻结语义）；合并窗口精确行为由单测 fake timers 覆盖 |
| 4 | AI 插入大段 → 一次 Undo | PASS | mock 插入 767 字(1396) → 一次 Ctrl+Z → 629 |
| 5 | Undo 插入 → Redo 恢复 | PASS | Ctrl+Shift+Z → 1396 完整恢复 |
| 6 | 自动保存后 Undo | PASS | 输入"他蹲下去。"自动保存(1401) → Ctrl+Z → 1396 |
| 7 | Undo 后保存状态 | PASS | 撤销回保存点="已保存"；撤销到非保存点="未保存"→2s 自动保存（PATCH 序列取证：1401→1396→1402→1396） |
| 8 | 显式保存后 Undo | PASS | 输入→点保存(1405/"已保存")→Ctrl+Z→1400="已保存" |
| 9 | force insert 后整体 Undo | PASS | 409 冲突确认→"仍要插入"→2946→一次 Ctrl+Z→1407 |
| 10 | Undo 不覆盖生成期间新增 | PASS | 生成期间输入"生成期间新增。"(1407)→force 插入→undo→1407 内容完整保留 |
| 11 | Undo 不破坏章节对话 | PASS | 对话面板 8 个消息气泡完整（冲突消息/已插入标记均在） |
| 12 | 栈空时按钮 disabled | PASS | 初始/刷新后/撤销到顶均 disabled；输入后启用 |
| 13 | 键盘快捷键 | PASS | Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 正常 |
| 14 | 鼠标操作 | PASS | 点击重做/撤销按钮正常 |
| 15 | 切换章节 | PASS | 第二章打开后 undo/redo 均 disabled（会话级，不保留） |

自动化：`gate:milestone` PASS（tsc + 149/149 [139 契约 + 10 undo-history 单测] + build 37/37）。
测试操作备注：React 受控组件下 JS setter 不触发 onChange（用 CDP 真实输入）；textarea 失焦时 Ctrl+Z 走浏览器原生栈（所有编辑器同此行为，非产品缺陷）。
已记录的产品边界：undo 撤销 AI 插入后，消息"已插入正文"标记不追踪正文回退（冻结规范 §5 未要求，保持简单）。
