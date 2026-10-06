# CHG-20261006-07 移动端三闭环落地证据

> 本文件是变更 CHG-20261006-07 的规范证据记录，依据 `docs/plans/2026-10-06-spec-gap-matrix.md` 矩阵对移动端三模块（#6 `mobile-tension`、#7 `mobile-skills`、#8 `mobile-history`）的裁决要求落地。

## 1. 变更背景与核实结论
- 基线：HEAD `40cd257`
- 模块状态核实与修复对照：
  1. `mobile-tension` (原 partial → 现 **done**):
     - 依据：`apps/web/src/mobile/components/TensionSparkWidget.tsx:36` 移除硬编码前 7 点 `[20, 38, 30, 60, 48, 75, 68]`；
     - 接入服务端 `POST /api/chapter.tension`（`apps/web/server/routes/proseRoutes.ts:1040-1065`），基于章节正文动作/冲突词、情绪标点与短句对抗密度计算真实时序波形 `tensionPoints: number[]`、得分 `tensionScore` 与波峰描述 `tensionDesc`；
     - 无真实数据时（短文本或空章）诚实呈现 `unavailable` 卡片，绝不伪造虚假数据。
  2. `mobile-skills` (原 missing → 现 **done**):
     - 依据：`apps/web/src/mobile/components/MobileComposer.tsx:100-145` 彻底移除将 `【增加冲突】` 等中文标签直接写入正文输入框的做法；
     - `MobileComposer` 组件内维护 `activeSkills: string[]` 选中状态，支持高亮与取消选中；
     - `apps/web/src/mobile/hubs/WorkbenchHub.tsx:80-120` 将选中的 `activeSkills` 透传至 `/api/draft.stream` 请求体契约，移除硬编码 `activeSkills: []`；
     - `apps/web/server/routes/pipelineRoutes.ts:189-225` 的 `decoratePromptWithSkills` 完整映射移动端三大技能胶囊（增加冲突、精简叙述、回收伏笔）。
  3. `mobile-history` (原 missing → 现 **done**):
     - 依据：`apps/web/server/routes/proseRoutes.ts:285-350` 实现章节修订历史 Sidecar（持久化至 `.mozhou/history/ch<N>_history.jsonl`），在保存正文成功后自动归档快照；
     - 服务端提供 `POST /api/chapter.history`（读取修订版本列表）、`POST /api/chapter.history.diff`（LCS 段落级差异计算）与 `POST /api/chapter.history.restore`（版本恢复）；
     - `apps/web/src/mobile/drawers/VersionHistoryDrawer.tsx` 真实接入历史数据源：无历史记录时诚实保留“版本历史尚未接入”提示；真实接入后移除该提示，展示版本历史芯片、段落级 Diff 对照（`[+新增]`、`[-删除]`），并支持恢复历史版本（以当前最新 revision 递增创建新版本，永久保留历史）。

## 2. 涉及文件清单
1. `apps/web/server/routePolicies.ts`: 注册 4 个新端点到 `'book'` 作用域白名单；
2. `apps/web/server/routes/pipelineRoutes.ts`: `decoratePromptWithSkills` 扩展移动端三技能配方映射并导出；
3. `apps/web/server/routes/proseRoutes.ts`: 实现张力时序分析端点、版本快照 Sidecar 存储与历史/Diff/恢复路由；
4. `apps/web/src/mobile/components/TensionSparkWidget.tsx`: 移除硬编码点，接入 `tensionPoints` 真实时序；
5. `apps/web/src/mobile/components/MobileComposer.tsx`: 维护技能胶囊选中状态，发送透传 `activeSkills`，不污染正文；
6. `apps/web/src/mobile/drawers/VersionHistoryDrawer.tsx`: 接入真实历史数据源，渲染版本列表、段落 Diff 与恢复交互；
7. `apps/web/src/mobile/hubs/WorkbenchHub.tsx`: 贯通张力数据请求与技能胶囊透传；
8. `apps/web/src/mobile/MobileShell.tsx`: 将 `book` 与 `chapterIndex` 真实传入 `VersionHistoryDrawer`；
9. `apps/web/src/mobile/styles/mobile.css`: 补充技能胶囊选中态与段落 Diff 样式；
10. `apps/web/server/routes/mobileThreeClosures.routes.test.ts`: 新增服务端 8 个契约测试；
11. `apps/web/src/mobile/MobileThreeClosures.test.tsx`: 新增前端 7 个闭环测试；
12. `apps/web/src/workbench/editor/ProseEditorPanel.inlineEdit.test.tsx`: 强类型收敛；
13. `PROJECT-MAP.md`: 登记本变更条目；
14. `docs/plans/2026-10-06-spec-gap-matrix.md`: 更新模块矩阵状态。

## 3. 验证命令与结果
1. 服务端契约测试：
   `pnpm.cmd --filter @mozhou/web test server/routes/mobileThreeClosures.routes.test.ts` → **8 passed (8)**
2. 前端闭环测试：
   `pnpm.cmd --filter @mozhou/web test src/mobile/MobileThreeClosures.test.tsx` → **7 passed (7)**
3. 移动端与正文路由全量回归测试：
   `pnpm.cmd --filter @mozhou/web test server/routes/mobileThreeClosures.routes.test.ts src/mobile/MobileThreeClosures.test.tsx src/mobile/MobileShell.test.tsx src/mobile/MobileChains.test.tsx src/mobile/WorkbenchHubDraftStream.test.tsx src/ui-truthfulness.hardening.test.tsx server/routes/proseRoutes.test.ts` → **7 文件 49 passed / 0 failed (49)**
4. 编辑器 AST 联动回归测试：
   `pnpm.cmd --filter @mozhou/web test src/workbench/editor/ProseEditorPanel.inlineEdit.test.tsx` → **5 passed (5)**
5. 全量测试门禁完整实跑（针对编排脚本 spawn ENOENT 问题的本地真实全量实测）：
   执行命令：`pnpm.cmd test`
   - 第一阶段 `test:packages`：`Test Files: 117 passed (117)`, `Tests: 1048 passed (1048)`, 耗时 12.23s
   - 第二阶段 `test:web`：`Test Files: 147 passed | 1 skipped (148)`, `Tests: 1086 passed | 14 skipped (1100)`, 耗时 14.99s
   - 全量合计：**264 文件通过 / 1 跳过 / 0 失败**，**2134 用例通过 / 14 跳过 / 0 失败**，退出码 **exit 0**
   - 输出尾部：
     ```text
     Test Files  147 passed | 1 skipped (148)
          Tests  1086 passed | 14 skipped (1100)
       Start at  17:17:14
       Duration  14.99s (transform 10.27s, setup 25.18s, collect 66.34s, tests 147.01s, environment 37.35s, prepare 19.03s)
     ```
6. 类型检查：
   `pnpm.cmd --filter @mozhou/web typecheck` (`tsc -b && tsc -p tsconfig.server.json --noEmit`) → **exit 0 零错误**
7. 代码构建：
   `pnpm.cmd build` (`tsc -b`) → **exit 0 零错误**
8. 全仓 ESLint：
   `pnpm.cmd lint` (`eslint .`) → **exit 0 零告警**
9. 图谱架构门禁：
   `gitnexus check --cycles` → **status: clean, cycleCount: 0**
