# CHG-20261006-13 — 设定图谱拖拽连线交互实现与全链路验证

> 执行：动态工作流（图谱实现员），ZCode，2026-10-06。  
> 需求来源：动态工作流任务——按 `docs/plans/2026-10-06-spec-gap-matrix.md` 模块 #9（`graph-connect`：partial）核实矩阵裁决并补齐缺口。  
> 领号：PROJECT-MAP.md 顺序递增领取 **CHG-20261006-13**。

## 1. 缺口核实结论

缺口矩阵裁决：**`graph-connect: partial` 实测完全属实**。
- **现状核查**：`apps/web/src/canon-graph/CanonGraphView.tsx:56-95, 221-276` 原先仅支持点击实体节点查看卡片，以及通过顶部按钮与第一个非己节点打开弹窗建契约并落盘；
- **缺口核实**：画布内确实缺少节点间 drag-to-connect 拖拽连线手势交互、connection handle、临时连线反馈、悬停合法高亮、自连拒绝保护、重复连线检测、撤销操作支持以及键盘/触屏辅助路径。

## 2. 目标行为与设计实现

补齐了设定图谱拖拽连线（Drag-to-Connect）交互体系，保留现有表单作为无障碍 fallback：

1. **SVG Connection Handle 与临时连线**：
   - 节点右边缘配备专属 connection handle（`data-testid="connection-handle-${node.id}"`），准星光标，hover 放大反馈；
   - 监听 Pointer Events（`onPointerDown`、`onPointerMove`、`onPointerUp`、`onPointerCancel`），开始连线时在 SVG 内渲染金色虚线临时交互折线（`temp-connection-line`）及指示光标，并在状态栏提供实时指引。

2. **合法节点悬停高亮与自连拒绝**：
   - 连线拖拽经过节点时，通过几何坐标碰撞（半径 35px）与原生 `onPointerEnter` 双通道高精度检测；
   - 悬停合法节点显示金色呼吸虚线光环（`highlight-target-${node.id}`）；
   - **Self-link 拒绝**：若拖回起点自身，临时线与指示环变红警告；在起点自身释放时明确拒绝并提示「拒绝自连：不可与实体自身建立因果契约」，不打开弹窗，不建立脏连接。

3. **Drop 打开契约弹窗与提交链路**：
   - 松开指针（PointerUp）在合法目标实体时，**不直接创建关系**，而是自动唤起 `CreateContractModal`；
   - 携带正确的 `sourceName` 与 `targetName`，作者选择关系类型（生死盟约、师徒传道、宿命仇敌、庇护救赎、利益交易等）、承诺内容、履约期限及违约惩罚；
   - 确认入典后调用 `addLink` 追加到本地拓扑，同时向 `/api/story-brain.contract` 发起真实落盘请求。

4. **Duplicate-link 重复因果检测**：
   - 检测起点与终点间是否已有现有关系；若已有连接，提示「已有因果连接，将追加新契约约定」，允许作者建立多层级契约而不产生假死或阻断。

5. **Undo 撤销操作栈**：
   - 建立本地 `undoStack`，每次成功入典时压入操作记录；
   - 顶部工具栏提供「↶ 撤销连线 (Ctrl+Z)」按钮及可撤销计数徽标；
   - 支持全局快捷键 `Ctrl+Z` / `Cmd+Z`，撤销时从数据层移除对应契约连线并给出明确反馈。

6. **触屏与移动端适配**：
   - 全链路采用标准 Pointer Events，SVG 画布设置 `touch-action: none` 防止拖拽时页面滚动干扰；
   - 支持 `pointerCancel` 安全退出，几何碰撞算法适配大面积触控指腹。

7. **键盘操作路径与无障碍 Fallback**：
   - 键盘连线模式：在节点 handle 上按 `Enter` / `Space` 或节点上按 `c` 键进入键盘连线模式（顶部显示呼吸横幅引导），按 Tab 移动至目标节点按 Enter 即可唤起契约弹窗，按 `Esc` 退出；
   - 无障碍表单 Fallback：保留顶部「与「XXX」建立契约」按钮，点击可展开无障碍目标实体下拉选择列表（`accessible-target-select`），纯键盘与读屏器用户无需视觉拖拽即可完成同等因果契约建立；
   - 配备 `role="status"` 与 `aria-live="polite"` 状态提示栏，全过程向辅助技术播报。

## 3. 实际变更文件

- `apps/web/src/canon-graph/useCanonGraphData.ts`：导出 `removeLink` 方法供撤销栈消费；
- `apps/web/src/canon-graph/CanonGraphView.tsx`：重构并新增 connection-handle、拖拽临时线、高亮检测、自连拒绝、重复连接检测、撤销栈、触屏 Pointer 监听、键盘连线模式及无障碍 fallback；
- `apps/web/src/canon-graph/CanonGraphView.dragConnect.test.tsx`：新增 8 项全链路自动化测试，覆盖拖拽建连、自连拒绝、重复连接、撤销、触屏、键盘与无障碍路径；
- `docs/changes/CHG-20261006-13-canon-graph-drag-to-connect.md`：本证据文档；
- `PROJECT-MAP.md`：登记本变更条目。

## 4. 自动化验证与实跑证据

1. **新建拖拽连线全链路测试**（`apps/web/src/canon-graph/CanonGraphView.dragConnect.test.tsx`）：
   - 执行：`pnpm.cmd --filter @mozhou/web test src/canon-graph/CanonGraphView.dragConnect.test.tsx`
   - 结果：**8/8 passed**（116ms）
     - 链路 1：从节点 Connection Handle 拖拽至目标节点 -> 唤起契约弹窗 -> 确认提交入典；
     - 链路 2：Self-link 拒绝保护 —— 拖拽回起点自身时拒绝并提示，不打开弹窗；
     - 链路 3：Duplicate-link 处理 —— 检测到已有因果连接时提供提示并不阻断建立新层级契约；
     - 链路 4：Undo 撤销操作 —— 成功建连后可通过按钮或 Ctrl+Z 撤销；
     - 链路 5：触屏 Pointer Event 与 PointerCancel 安全取消；
     - 链路 6：键盘操作路径 —— 节点/Handle 回车进入键盘连线模式，回车目标节点建立契约；
     - 链路 7：键盘按 Esc 取消连线模式；
     - 链路 8：无障碍表单 Fallback —— 选中实体后通过下拉列表建立契约。

2. **契约服务端路由与关联测试**：
   - `server/routes/storyBrainRoutes.contract.test.ts`：**5/5 passed**（验证 `/api/story-brain.contract` 服务端写盘与 S4 基线零漂移）；
   - `server/routes/planeSeamMigration.test.ts`：**14/14 passed**（验证 storyBrainRoutes 端点数据平面行为不变）；
   - `src/workbench/WorkbenchView.test.tsx`：**7/7 passed**。

3. **静态类型检查与代码检查**：
   - 双端类型检查：`pnpm.cmd --filter @mozhou/web typecheck`（`tsc -b && tsc -p tsconfig.server.json --noEmit`）**exit 0 零错误**；
   - 全工作区构建：`pnpm.cmd build`（`tsc -b`）**exit 0 零错误**；
   - 全仓 ESLint：`pnpm.cmd lint`（`eslint .`）**exit 0 零错误零告警**。

4. **GitNexus 代码图谱门禁**：
   - 执行 `gitnexus check --cycles`：输出 `status: clean, cycleCount: 0, cycles: []`，零依赖循环；
   - 执行 `detect_changes`：核实当前改动符号集中于 `CanonGraphView` 与测试，无越界符号。

5. **全量门禁 pnpm.cmd test 完整实跑输出**：
   - 执行命令：`pnpm.cmd test`（包含 `pnpm run test:packages && pnpm run test:web`）
   - 第一段 `test:packages`：117 passed (117 files)，**1048 passed / 0 failed**；
   - 第二段 `test:web`：148 passed | 1 skipped (149 files)，**1094 passed | 14 skipped / 0 failed**（包含新增的 CanonGraphView.dragConnect.test.tsx 8 项测试）；
   - 全量汇总：**265 个测试文件通过 / 1 个跳过，总计 2142 passed / 14 skipped / 0 failed，exit 0 全绿通过**。
   - 输出尾部截取：
     ```text
       ✓ src/membership/MembershipView.test.tsx (2 tests) 88ms
       ✓ src/canon-graph/CanonGraphView.dragConnect.test.tsx (8 tests) 286ms
       ✓ src/cloud-sync/CloudSyncView.test.tsx (2 tests) 93ms
       ✓ src/App.test.tsx (24 tests) 2828ms
       ✓ src/api.test.ts (59 tests) 30583ms

      Test Files  148 passed | 1 skipped (149)
           Tests  1094 passed | 14 skipped (1108)
        Start at  19:29:36
        Duration  32.81s (transform 13.59s, setup 22.40s, collect 78.62s, tests 504.98s, environment 38.54s, prepare 13.46s)
     ```

## 5. 结论

- 缺口已完全补齐：SVG 节点 connection handle、pointer 拖拽连线、临时虚线、目标高亮、drop 打开 CreateContractModal、后端 `/api/story-brain.contract` 提交、undo 撤销、self-link 拒绝、duplicate-link 处理、触屏与键盘操作无障碍全链路闭环；
- 所有受影响测试通过，构建与 lint 零错误，图谱门禁无环，全量门禁 2142 项测试 100% 全绿。
