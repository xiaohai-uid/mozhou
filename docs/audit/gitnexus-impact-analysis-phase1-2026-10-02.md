# GitNexus 代码图谱刷新与待改符号影响面分析报告 (Phase 1)

**生成时间**：2026-10-02  
**执行角色**：`graph-engineer` (Graph Specialist)  
**代码基线**：commit `90b45a1`  
**图谱规模**：10,007 节点 (Nodes) | 21,780 边 (Edges) | 673 聚类 (Clusters) | 516 执行流 (Flows)  
**循环依赖检测**：`No circular imports found` (`status: clean, cycleCount: 0`)  

---

## 一、代码图谱刷新概要

执行 `node .gitnexus/run.cjs analyze` 完成增量分析与图谱对齐：
- **目标提交**：`90b45a1`（最新检出点）
- **图谱状态**：已索引并同步至最新提交
- **架构纯净度门禁**：执行 `node .gitnexus/run.cjs check --cycles --repo "C:\zcode\novel-ai"`，全仓循环引用为 0，符合零循环依赖门禁标准。

---

## 二、待修改文件与核心符号影响面矩阵

| 序号 | 目标文件 / 符号 | 符号 UID / 类型 | GitNexus 风险等级 | 直接调用者 (Direct) | 波及进程数 (Processes) | 影响模块 (Modules) |
|---|---|---|---|---|---|---|
| 1 | `productionRoutes.test.ts` & `pipelineRoutes.ts` (`advanceGuard`) | `Function:...:draftProviderAvailability`<br>`Function:...:createMoZhouApiRouter` | **CRITICAL** (若是改 Router)<br>**LOW** (测试环境注入) | `hasDraftProvider`<br>`pipelineRoutes`<br>60+ 路由句柄 | 27 (若动 Router)<br>0 (测例隔离) | Routes, Memo, Auth, Server, Billing (共 20 模块) |
| 2 | `eslint.config.js` | 根构建配置文件 (非模块符号) | **LOW** (Dev/Lint) | CLI `eslint .` | 0 (不进 runtime) | 全仓工程与静态门禁 |
| 3 | `scripts/gen-adr-refs.mjs` (`AMBIG`) | `Variable:scripts/gen-adr-refs.mjs:AMBIG` | **LOW** | 独立脚本执行 | 0 | Scripts 运维脚本 |
| 4 | `apps/web/src/App.tsx` (`App`) | `Function:apps/web/src/App.tsx:App` | **LOW** | `main.tsx`<br>`App.test.tsx` | 1 (`App → SendJson`) | Shell, Workbench |
| 5 | `apps/web/src/workbench/editor/ProseEditorPanel.tsx` (`ProseEditorPanel`, `ProseEditorSession`) | `Function:...:ProseEditorPanel`<br>`Function:...:ProseEditorSession` | **LOW** | `WorkbenchView.tsx`<br>3 个隔离测试文件 | 4 个草稿持久化流 | Workbench, Shell, Editor |

---

## 三、各目标详细调用链路与波及半径分析

### 1. `productionRoutes` 门控冲突分析 (`productionRoutes.test.ts` & `pipelineRoutes.ts`)

#### 核心链路与符号拓扑
- **关键符号**：
  - `apps/web/server/routes/pipelineRoutes.ts:430-451` (`advanceGuard`)
  - `apps/web/server/routes/pipelineRoutes.ts:150-171` (`draftProviderAvailability`)
  - `apps/web/server/routes/pipelineRoutes.ts:92-95` (`isMockDraftProviderMode`)
  - `apps/web/server/api.ts:createMoZhouApiRouter`
- **GitNexus 影响面**：
  - `createMoZhouApiRouter`：直接上游调用方 60 个，波及 27 条业务执行流，CRITICAL 风险。
  - `draftProviderAvailability`：被 `hasDraftProvider` 与 `pipelineRoutes` 内部 advance 守卫引用，跨 2 条执行流程。
- **故障根因**：
  - 暂存区在 `pipelineRoutes.ts:430-451` 新增了 `advanceGuard` 守卫：当生产会话通过 `/api/session.advance` 进入 `draft` 步时，若 `draftProviderAvailability` 返回 `no_provider_configured`，会以 `409 PROVIDER_UNAVAILABLE` 拒绝推进。
  - `productionRoutes.test.ts`（T06 十步状态机集成测试）运行在沙盒临时目录，未注入任何 Provider 环境变量。其测试用例：
    1. `禁止通过 session.advance 直接跳步到 commit`（Line 161 期望拿到 200 步进至 draft）；
    2. `chapter.review 真实执行并生成带哈希锚定的审查报告`（Line 254 期望在 draft 步后审查）；
    3. `D10：该章无编译凭证时 chapter.review → 409 NO_COMPILED_RECEIPT`（Line 321）。
    全部因 advance 被 `advanceGuard` 拦截为 409 而失败。
- **改动范围与安全约束**：
  - **禁止改动**：绝对不能在 `pipelineRoutes.ts` 中删除或弱化 `advanceGuard`，否则会导致 `pipelineRoutes.advanceGuard.test.ts` 回归失败，且破坏生产防跳步契约。
  - **推荐修复**：在 `apps/web/server/routes/productionRoutes.test.ts` 的 `beforeEach` 中注入 `process.env.MOZHOU_DRAFT_PROVIDER = 'mock'`，并在 `afterEach` 中还原。
  - **实测验证**：注入 `MOZHOU_DRAFT_PROVIDER=mock` 后，`productionRoutes.test.ts` 5 个测试全部一次性通过（5 passed）。
  - **波及半径**：改动完全收敛在 `productionRoutes.test.ts` 内部，生产代码 0 变更，风险极低（LOW）。

---

### 2. `eslint.config.js` 门禁超限分析

#### 核心链路与符号拓扑
- **关键配置项**：`parserOptions.projectService.maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING`
- **故障根因**：
  - 该阈值在 `eslint.config.js:53` 中锁定为 `80`。
  - 随着近期服务端新增测试文件（如 `pipelineRoutes.advanceGuard.test.ts`, `planeSeamMigration.test.ts`, `realModelGate.test.ts` 等），匹配 `defaultProject: 'apps/web/tsconfig.server.json'` 的文件数已达到 86 个。
  - 导致 ESLint 执行时报告 `Parsing error: Too many files (>80) have matched the default project`，整条 `pnpm lint` 门禁挂掉（exit 1）。
- **改动范围与安全约束**：
  - 将 `maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING` 上调至 `120`。
  - **波及半径**：仅影响静态代码检查配置，不影响运行时代码与构建产物。

---

### 3. `scripts/gen-adr-refs.mjs` 未使用变量分析

#### 核心链路与符号拓扑
- **关键符号**：`scripts/gen-adr-refs.mjs:7:7` (`const AMBIG`)
- **故障根因**：
  - `AMBIG` 变量定义后未在脚本后续逻辑中使用，被 `@typescript-eslint/no-unused-vars` 拦截报错。
- **改动范围与安全约束**：
  - 直接删除第 7 行 `const AMBIG = ...`。
  - **波及半径**：仅涉及该维护脚本自身第 7 行，无外部依赖导入，0 运行时风险。

---

### 4. `apps/web/src/App.tsx` 移动端向导与错误边界分析

#### 核心链路与符号拓扑
- **关键符号**：
  - `Function:apps/web/src/App.tsx:App`
  - `Function:apps/web/src/wizard/WizardOverlay.tsx:WizardOverlay`
  - `Function:apps/web/src/mobile/MobileShell.tsx:MobileShell`
  - `File:apps/web/src/main.tsx`（唯一直接运行时调用方）
  - `File:apps/web/src/App.test.tsx`（核心集成测试）
- **GitNexus 调用图**：
  - `main.tsx` → `App` → `MobileShell` (条件分支：`isMobile`)
  - `main.tsx` → `App` → `WizardOverlay` (条件分支：`wizardOpen`)
- **架构缺陷分析**：
  1. **移动端首启向导缺失**：`App.tsx:181-190` 在检测到 `isMobile` 时直接 `return <MobileShell ... />`，该返回发生在 `wizardOpen` 渲染之前（Line 326）。新用户在移动端视口首次访问时，虽处于 `wizardOpen === true` 状态，但向导被直接截断无法显示。
  2. **顶层 Error Boundary 缺失**：目前 `apps/web/src` 没有任何 `ErrorBoundary` 组件。子组件一旦抛出未捕获的渲染异常，会导致整个页面白屏。
- **改动范围与安全建议**：
  - **WizardOverlay 挂载提升**：调整渲染顺序，使 `{wizardOpen && <WizardOverlay ... />}` 能够在移动端和桌面端统一挂载，或者在 `isMobile` 分支中同时包裹 `WizardOverlay`。
  - **引入轻量 ErrorBoundary**：在 `apps/web/src/App.tsx` 顶层及核心视图插槽包裹错误兜底界面（带重试/重载按钮）。
  - **波及半径**：影响 `App` 组件渲染分支。必须通过 `App.test.tsx`、`MobileShell.test.tsx` 及 `WizardOverlay.test.tsx` 的回归验证。

---

### 5. `apps/web/src/workbench/editor/ProseEditorPanel.tsx` 误触丢稿防护分析

#### 核心链路与符号拓扑
- **关键符号**：
  - `Function:apps/web/src/workbench/editor/ProseEditorPanel.tsx:ProseEditorPanel`
  - `Function:apps/web/src/workbench/editor/ProseEditorPanel.tsx:ProseEditorSession`
  - `Function:apps/web/src/shell/workbenchStorage.ts:draftCacheMatchesBaseline`
  - 上游调用方：`apps/web/src/workbench/WorkbenchView.tsx:WorkbenchView`
  - 关联测试：`ProseEditorPanel.chapterSwitch.test.tsx`, `isolation.test.tsx`, `telemetry.test.tsx`
- **GitNexus 进程影响面**：
  - `WorkbenchView → SyncSha256Hex`
  - `WorkbenchView → ChapterDraftKey`
  - `WorkbenchView → LoadDraftCache`
  - `WorkbenchView → SaveDraftCache`
- **架构缺陷分析**：
  - 目前编辑区虽有本地缓存（`mozhou.draft.cache`）与定期自动保存，但当作者输入了新内容尚未保存为草稿（`!draftCacheMatchesBaseline(text, draftKey)`）且用户误操作刷新或关闭页面时，浏览器不会弹出确认拦截框，容易引起作者慌张或数据状态不一致。
- **改动范围与安全建议**：
  - 在 `ProseEditorSession` 中增加 `beforeunload` 事件监听：
    ```ts
    useEffect(() => {
      if (draftKey === null) return
      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        if (!draftCacheMatchesBaseline(text, draftKey)) {
          e.preventDefault()
          e.returnValue = ''
        }
      }
      window.addEventListener('beforeunload', handleBeforeUnload)
      return () => window.removeEventListener('beforeunload', handleBeforeUnload)
    }, [draftKey, text])
    ```
  - **波及半径**：`ProseEditorPanelProps` 外部契约完全不变，不破坏 `WorkbenchView`，对既有切章、隔离和遥测测试用例 0 破坏，风险极低（LOW）。

---

## 四、改动实施结论与下游团队指引

1. **Gate 门禁组建议 (`fullstack-engineer`)**：
   - 目标 1：仅在 `productionRoutes.test.ts` 中通过环境变量 mock provider 消除 409 拦截，严禁篡改 `pipelineRoutes.ts`。
   - 目标 2 & 3：更新 `eslint.config.js`（matchCount 提升至 120）并删除 `scripts/gen-adr-refs.mjs` 中未使用的 `AMBIG` 变量，立即恢复 `pnpm lint` 全绿。
2. **体验与韧性组建议 (`fullstack-engineer`)**：
   - 目标 4：在 `App.tsx` 中将 `WizardOverlay` 挂载逻辑移至移动端分支之前，并在顶层接入 `ErrorBoundary`。
   - 目标 5：在 `ProseEditorPanel.tsx` 的 `ProseEditorSession` 中利用 `draftCacheMatchesBaseline` 挂载 `window.onbeforeunload` 保护逻辑。
