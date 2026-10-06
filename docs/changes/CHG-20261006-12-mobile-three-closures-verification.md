# CHG-20261006-12 — 移动端三闭环核查与验证收尾

> 执行：动态工作流（移动端实现员），ZCode，2026-10-06。  
> 需求来源：动态工作流任务——按 `docs/plans/2026-10-06-spec-gap-matrix.md` 模块 #6（mobile-tension：done）、#7（mobile-skills：done）、#8（mobile-history：done）核实矩阵裁决是否属实；先核实矩阵裁决（读关键代码、跑受影响测试），裁决为 done 且核实通过时，只做核实性收尾并返回 pass（已实现、核实通过、无需开发）；零修改用户在制代码。  
> 领号：PROJECT-MAP.md 顺序递增领取 **CHG-20261006-12**。

## 1. 模块裁决核查结论

缺口矩阵裁决：**`mobile-tension: done`、`mobile-skills: done`、`mobile-history: done` 经实测完全属实**。
在当前工作区中，移动端三闭环（真实张力波形、技能胶囊透传、版本时光机段落 Diff 与安全递增回滚）已完整落地并全链路闭环，无需二次开发：

1. **张力波形闭环（mobile-tension）**：
   - `TensionSparkWidget.tsx:8-58`：彻底移除旧版硬编码点序列 `[20, 38, 30, 60, 48, 75, 68]`，由传入的 `tensionPoints` 动态时序数组驱动 Canvas 绘制折线；
   - 诚实空态保护：当未建书、正文过短（<20字）、无张力数据或时序点数不足 2 点时，`TensionSparkWidget.tsx:59-68` 严格呈现 `data-testid="tension-unavailable"` 诚实不可用卡片（“管线阶段与叙事张力尚未接入”、“Technical Preview 不展示模拟阶段、张力分数或情绪波峰”），绝不伪造虚假波形；
   - 真实服务端分析：`proseRoutes.ts:386-451, 1040-1064` 实现 `POST /api/chapter.tension` 与 `computeChapterTension` 纯函数，按正文动作词频、标点节奏与对白密度动态分段计算真实张力分数与时序曲线，并输出匹配的波峰描述（如“终段悬念留钩：危机悬而未决”）；
   - 前端消费：`WorkbenchHub.tsx:81-112, 241-247` 在选择章节后自动请求 `/api/chapter.tension` 并注入 `TensionSparkWidget`。

2. **技能胶囊闭环（mobile-skills）**：
   - 状态维护与不污染正文：`MobileComposer.tsx:55-68, 99-126` 在输入框下方维护“增加冲突”、“精简叙述”、“回收伏笔”三技能胶囊的独立选中状态数组 `activeSkills`，点击仅高亮胶囊，不向正文输入框强塞中文标签；
   - 契约透传：点击发送时，`MobileComposer` 向回调透传 `(prompt, activeSkills)`，`WorkbenchHub.tsx:122-140` 将其封装在 `POST /api/draft.stream` 请求体中（`{ root, chapterIndex, prompt, activeSkills }`）；
   - 服务端 recipe 映射：`pipelineRoutes.ts:211-226` 中的 `decoratePromptWithSkills` 将 `conflict`（`升级主角遭遇的外部阻力与人际对抗，制造即时危机与利益争夺`）、`concise`（`删减冗余心理交代与背景铺垫，采用紧凑主谓短句加快叙事行进`）、`foreshadow`（`呼应前文埋下的线索暗示与悬念道具，完成因果闭环`）映射为严谨的生成约束提示词，保持既有流式能力。

3. **版本时光机闭环（mobile-history）**：
   - 历史快照 sidecar：`proseRoutes.ts:288-344, 572-592` 在每次正文保存时，通过 `appendChapterHistoryRecord` 向 `.mozhou/history/ch{index}_history.jsonl` 持久化记录每次修订的版本号、正文文本、sha256、字数与保存时间戳；
   - 历史查询接口：`proseRoutes.ts:1065-1116` 提供 `POST /api/chapter.history` 读取所有历史版本快照摘要；
   - 真实段落 LCS Diff：`proseRoutes.ts:346-385, 1118-1169` 实现 `computeParagraphDiff` 与 `POST /api/chapter.history.diff`，基于最长公共子序列（LCS）算法比对两个任意历史版本（如 r8 与 r12），返回精确的 `added`、`removed`、`unchanged` 段落列表；
   - 安全递增恢复：`proseRoutes.ts:1171-1240` 提供 `POST /api/chapter.history.restore`，恢复 r8 时读取其历史正文，调用数据平面 `saveProseDraft` 在当前盘上版本（如 r12）基础上自增生成新版本 r13（body=r8），并将 r13 作为新快照追加落盘，r8~r12 的历史版本永久完整保留，不篡改历史分支；
   - 前端抽屉呈现：`VersionHistoryDrawer.tsx:41-160` 消费上述端点，未建书时显示诚实未接入卡片，有真实数据时展示版本快照芯片列表、红绿段落级 Diff 对比高亮与恢复按钮，恢复成功后展示新版本号反馈。

## 2. 实际变更

本次任务严格遵守红线与任务指示，裁决为 `done` 且核实通过，仅做核实性收尾：
- 零修改产品代码；
- 新增证据文档 `docs/changes/CHG-20261006-12-mobile-three-closures-verification.md`；
- 在 `PROJECT-MAP.md` 中登记变更条目 `CHG-20261006-12`。

## 3. 自动化验证与实跑证据

1. **移动端三闭环服务端契约测试**（`apps/web/server/routes/mobileThreeClosures.routes.test.ts`）：
   - 执行：`pnpm.cmd --filter @mozhou/web test run server/routes/mobileThreeClosures.routes.test.ts`
   - 结果：**8/8 passed**
     - 闭环 1：章节未创建或正文太短（<20字）诚实返回 `available: false`；真实章节正文准确计算张力时序点（>=4点）与波峰描述，验证无硬编码序列；纯函数 `computeChapterTension` 单元测试通过；
     - 闭环 2：`decoratePromptWithSkills` 准确映射 `conflict`、`concise`、`foreshadow` 到对应 recipe 约束；
     - 闭环 3：`/api/chapter.history` 读取多版本快照；`computeParagraphDiff` 与 `/api/chapter.history.diff` 计算段落级 LCS 差异（added/removed/unchanged）；`/api/chapter.history.restore` 恢复 r1 时在 r2 基础上递增创建 r3，正文恢复为 r1 且 r1~r3 历史全量保留。

2. **移动端前端组件与交互测试**（`apps/web/src/mobile/MobileThreeClosures.test.tsx`）：
   - 执行：`pnpm.cmd --filter @mozhou/web test run src/mobile/MobileThreeClosures.test.tsx`
   - 结果：**7/7 passed**
     - 闭环 1：无数据或点数不足时诚实展示“管线阶段与叙事张力尚未接入”；有真实数据时真实渲染 Canvas 折线与描述并移除未接入提示；`WorkbenchHub` 自动请求 `/api/chapter.tension` 并注入组件；
     - 闭环 2：点击技能胶囊切换选中状态，输入框不被强塞中文标签；`WorkbenchHub` 携带 `activeSkills` 向服务端发起 `/api/draft.stream`；
     - 闭环 3：未建书时展示“版本历史尚未接入”卡片；有真实历史时展示版本列表、段落级 Diff 对比高亮与恢复操作，且恢复后成功回调。

3. **移动端全套前端测试**（`apps/web/src/mobile`）：
   - 执行：`pnpm.cmd --filter @mozhou/web test run src/mobile`
   - 结果：4 个测试文件全部通过，**20/20 passed**（MobileThreeClosures 7 passed, MobileShell 5 passed, MobileChains 5 passed, WorkbenchHubDraftStream 3 passed）。

4. **正文与管线关联路由测试**：
   - 执行：`pnpm.cmd --filter @mozhou/web test run server/routes/proseRoutes.test.ts server/routes/pipelineRoutes`
   - 结果：5 个测试文件全部通过，**38 passed | 2 skipped**（proseRoutes 16 passed, pipelineRoutes.tierRoute 17 passed, pipelineRoutes.firstChapter 2 passed, pipelineRoutes.advanceGuard 2 passed, firstChapter.realModel 1 passed | 2 skipped）。

5. **受影响测试套件合计**：
   - **10 个测试文件 65 项测试全部通过（另 2 项为仅在真实模型凭据下启用的 skipped 测试）**。

6. **双端类型检查与构建验证**：
   - 服务端与前端类型检查：`pnpm.cmd --filter @mozhou/web typecheck`（`tsc -b && tsc -p tsconfig.server.json --noEmit`）**exit 0 零错误**；
   - 全工作区构建：`pnpm.cmd build`（`tsc -b`）**exit 0 零错误**；
   - 全仓 ESLint：`pnpm.cmd lint`（`eslint .`）**exit 0 零错误零告警**。

7. **全量门禁实跑（pnpm.cmd test 完整实跑输出）**：
   - 因编排脚本无法直跑（spawn ENOENT 无扩展名问题），由子代理在本地以 `pnpm.cmd test` 完整实跑全量测试；
   - 执行命令：`pnpm.cmd test`（依次执行 `pnpm run test:packages && pnpm run test:web`）
   - **第一段 test:packages**：117 个测试文件全部通过（117 passed），**1048 passed / 0 failed**（耗时 12.87s）；
   - **第二段 test:web**：147 个测试文件通过、1 个跳过（147 passed | 1 skipped），**1086 passed | 14 skipped / 0 failed**（耗时 25.30s）；
   - **全量合计**：**264 个测试文件通过 / 1 个跳过，总计 2134 passed / 14 skipped / 0 failed**，退出码 0，全量 100% 绿色通过；
   - 输出尾部原样截取：
     ```text
       ✓ src/shell/views.test.ts (2 tests) 2ms
       ✓ server/auditUnreferenced.test.ts (7 tests) 2ms
       ✓ src/App.test.tsx (24 tests) 3223ms
         ✓ App 壳集成（T40） > 未建书时质量门 tab 呈显式空态；建书后挂载 QualityPanel 454ms
         ✓ App 首次建书 Wizard（T42） > Wizard 完成后进入常驻工作台；刷新不再自动弹出（localStorage 记忆） 669ms

      Test Files  147 passed | 1 skipped (148)
           Tests  1086 passed | 14 skipped (1100)
        Start at  18:57:57
        Duration  25.30s (transform 14.02s, setup 70.42s, collect 98.84s, tests 174.78s, environment 169.89s, prepare 16.12s)
     ```

8. **GitNexus 图谱门禁**：
   - 执行 `gitnexus check --cycles`：输出 `status: clean, cycleCount: 0, cycles: []`，零依赖循环；
   - 执行 `detect_changes`：核实当前改动符号集中于已有在制工作范围，无越界符号。

## 4. 结论与状态

- 矩阵裁决 `mobile-tension: done`, `mobile-skills: done`, `mobile-history: done` 经实测完全属实；
- 移动端三闭环代码与测试均已完备且高质量通过；
- 本次为核实性收尾，零产品代码修改，返回状态 **pass**。
