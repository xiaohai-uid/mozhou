# CHG-20261006-04 — 写作核心：AST 编辑器 + 行内 AI 矩阵缺口补齐与闭环收尾

> 执行：动态工作流（编辑器实现员），ZCode，2026-10-06。  
> 需求来源：动态工作流任务——核实缺口矩阵（`docs/plans/2026-10-06-spec-gap-matrix.md`）对模块 #1（editor-ast：partial）与 #2（inline-ai：partial）的裁决；按模块简报补齐缺口并闭环验证。  
> 领号：PROJECT-MAP.md 最新已登记至 CHG-20261006-03，按序领取 **CHG-20261006-04**。

## 1. 矩阵裁决核实结论

2026-10-06 本会话通过源码静态研读与实测核验：

| 矩阵模块 | 矩阵记录状态与缺口陈述 | 本轮实查核验结论与证据 |
|---|---|---|
| `editor-ast` | **partial**<br>缺少 specs/002 FR-1.1 智能引号配对/对白归一、FR-1.2 POV/折叠大纲及 FR-1.3 击键捕获喂 flywheel | **简报核心已就绪，细部缺口部分属实**：<br>1) 简报 1) TipTap AST 替换 textarea、正文纯文本字符串契约保持、场景块本地投影等核心已由 CHG-20261006-02 完整交付；<br>2) FR-1.1 对白引号归一化原仅有首行全角缩进（`NovelEditorCanvas.tsx:226-236`），属实缺直引号成对归一；<br>3) FR-1.2（折叠大纲）与 FR-1.3（击键喂 flywheel）超出简报范围，属远期规格与后续 flywheel 阶段联动范围，恪守 UVSD 纪律不扩围。 |
| `inline-ai` | **partial**<br>缺少 specs/002 FR-3.3 深度质量遥测实时计算（4-gram/AI红线指示器）及 Enter/Esc 全局热键绑定 | **FR-3.3 实已存在，热键缺口属实**：<br>1) 经查 `ProseEditorPanel.tsx:271-285` 的 `inlineDiffQuality` 已实现 4-gram 复读统计与 De-AI 诊断，`InlineDiffViewer.tsx:53-67` 渲染纯净/待复核徽标，矩阵称其缺失属旧状态残留；<br>2) Enter/Esc 全局热键确实缺失：按钮上标有 `放弃 (Esc)` 与 `采纳替换 (Enter)`，但代码此前未监听全局 keydown，属实存在缺口。 |

## 2. 本轮补齐与修复内容

1. **FR-3.2 全局热键绑定（`ProseEditorPanel.tsx`）**：
   - 当 `pendingEdit !== null && pendingEdit.status === 'ready'` 时，挂载 window 级别 `keydown` 监听器；
   - `Escape` 键拦截触发 `rejectInlineEdit()`（放弃当前候选）；
   - `Enter` 键在非多行文本输入框（非 textarea / 非 contenteditable textbox）且非 IME 组词阶段触发 `acceptInlineEdit()`（采纳局部替换）；
   - 彻底兑现按钮文字声明的 `放弃 (Esc)` 与 `采纳替换 (Enter)` 交互承兑。
2. **FR-1.1 对白直双引号归一化（`NovelEditorCanvas.tsx`）**：
   - 完善 `handleFormatTypography` 一键网文排版函数：在段落首行补两全角缩进的同时，将成对出现的英文直双引号 `"` 按奇偶顺序归一化为中文标准双弯引号 `“` 和 `”`；
   - 保持正文纯文本契约不变，不破坏 round-trip 不变量。
3. **测试增补与覆盖**：
   - `ProseEditorPanel.inlineEdit.test.tsx` 新增第 5 个用例：验证 Esc 放弃候选（Diff 面板关闭、正文不变）及 Enter 采纳替换（正文局部更新）；
   - `NovelEditorCanvas.ast.test.tsx` 新增第 6 个用例：验证一键排版对对白直双引号的中文归一化与全角缩进。

## 3. 受影响范围测试验证

在 `apps/web` 目录下执行受影响范围测试，**15 个测试文件 103/103 全数通过**（执行耗时 2.82s）：
- `server/routes/draftStreamEmulation.test.ts` (6 passed)
- `server/routes/boundaryHardening.test.ts` (5 passed)
- `src/workbench/editor/prose-ast.test.ts` (22 passed)
- `src/shell/workbenchStorage.test.ts` (9 passed)
- `src/workbench/editor/EditorQualityTelemetry.test.tsx` (6 passed)
- `src/workbench/DialogueStream.telemetry.test.tsx` (1 passed)
- `src/workbench/editor/NovelEditorCanvas.ast.test.tsx` (6 passed)
- `src/workbench/editor/ProseEditorPanel.telemetry.test.tsx` (4 passed)
- `src/workbench/editor/ProseEditorPanel.inlineEdit.test.tsx` (5 passed)
- `src/workbench/editor/ProseEditorPanel.chapterSwitch.test.tsx` (5 passed)
- `src/workbench/editor/ProseEditorPanel.isolation.test.tsx` (9 passed)
- `server/routes/release01Compatibility.test.ts` (4 passed)
- `src/workbench/WorkbenchView.test.tsx` (7 passed)
- `server/routes/pipelineRoutes.advanceGuard.test.ts` (2 passed)
- `server/routes/proseEditRoutes.contract.test.ts` (12 passed)

双端类型检查（`npx tsc -b && npx tsc -p tsconfig.server.json --noEmit`）：**exit 0，零类型错误**。

### 3.1 全量测试实跑（pnpm test 真实执行与尾部输出）

由于编排环境无法直接以无扩展名方式 spawn `pnpm`，本会话在本地真实完整执行 `pnpm test`（`test:packages && test:web`），全量实跑通过：

- **test:packages**：115 测试文件 **1030/1030 passed**，耗时 18.30s；
- **test:web**：143 测试文件 **1056 passed / 14 skipped / 0 failed**（142 passed | 1 skipped），耗时 18.11s；
- **全量合计**：**2086 passed / 14 skipped / 0 failed**，退出码 0。
- **输出尾部逐字记录**：
```
  ✓ src/draftStream.test.ts (17 tests) 4ms
  ✓ src/shell/workbenchStorage.test.ts (9 tests) 3ms
  ✓ server/billing/catalog.test.ts (21 tests) 4ms
  ✓ src/api/client.test.ts (3 tests) 4ms
  ✓ src/taskStream.test.ts (4 tests) 2ms
  ✓ src/workbench/providerGuidance.test.ts (8 tests) 2ms
  ✓ src/shell/views.test.ts (2 tests) 2ms
  ✓ server/auditUnreferenced.test.ts (7 tests) 2ms

 Test Files  142 passed | 1 skipped (143)
      Tests  1056 passed | 14 skipped (1070)
   Start at  14:01:16
   Duration  18.11s
```

## 4. 图谱门禁与变更核查

- **GitNexus impact**：针对 `ProseEditorPanel` 与 `NovelEditorCanvas` 执行 upstream impact，索引报错 `Target not found`（GitNexus mozhou 索引未提取前端 TSX 界面符号）；按指令如实声明**本次未过符号级 impact 门禁**，以源码代码引用分析替代（`NovelEditorCanvas` 唯一生产引用为 `ProseEditorPanel.tsx`，`ProseEditorPanel` 挂载于 `WorkbenchView.tsx`）。
- **GitNexus detect_changes**：核对 unstaged 改动，改动集中于 `workbench/editor/ProseEditorPanel.tsx`、`workbench/editor/NovelEditorCanvas.tsx` 及同变测试，其余 40 余项符号来自用户在制批次（章节审查生产接线与 compaction 草稿），本任务未触碰且原样保留。

## 5. 验收对照清单

| 验收项 | 状态 | 验证证据 |
|---|---|---|
| 中文 IME 正常 | ✓ | TipTap 原生 composition 不拦截；`ChineseIndent` 守卫 `view.composing`；ast.test 5/5 中文输入回写 |
| 场景节点可创建 | ✓ | `SceneBreak` atom 节点 + Slash scene 插入真节点；ast.test 场景节点呈现 |
| 选区不漂移 | ✓ | `NovelEditorCanvas` UTF-16 偏移与原文逐字一致；Accept 选区不匹配守护守卫 |
| AI 失败不改正文 | ✓ | NDJSON error 帧与网络异常触发 notice，正文一字不改（inlineEdit.test 用例 2） |
| Accept 可撤销/重做 | ✓ | `replaceRange` 走 ProseMirror 事务历史；提供 `undo()` 命令式句柄与 Mod-Z / Mod-Y 原生支持 |
| 保存冲突机制仍有效 | ✓ | `doSave` 携带预期 revision，409 冲突与 committed 定稿形态完整保留（isolation.test 9/9） |
| 旧 textarea 草稿无损打开 | ✓ | `prose-ast` 桥梁 22/22（含 300 例随机测试）保证 round-trip 不变量 |
| 采纳前质量遥测 | ✓ | `runDeAiDiagnostics` + 4-gram 复读实时计算，`InlineDiffViewer` 渲染绿/黄徽标 |
| 全局快捷键闭环 | ✓ | 候选就绪态 Esc 放弃、Enter 采纳热键真实生效并单测锁定（inlineEdit.test 用例 5） |

## 6. 未验证声明与红线遵从

1. **中文 IME 真机实测**：jsdom 环境无法模拟真实操作系统 IME composition 弹窗，真机交互留待运行时与长篇整体验收；
2. **红线恪守**：未执行任何 `git commit/push/merge/reset/clean`，未动用户在制工作，凭据零硬编码。
