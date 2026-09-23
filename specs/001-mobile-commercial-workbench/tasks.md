# Tasks: 移动端商业化全景工作台 (Mobile Commercial Workbench)

**Feature**: `001-mobile-commercial-workbench`  
**Status**: Ready for Implementation  
**Spec Reference**: `specs/001-mobile-commercial-workbench/spec.md`  
**Plan Reference**: `specs/001-mobile-commercial-workbench/plan.md`  
**UI Baseline**: `apps/web/prototypes/opendesign-mobile-flagship-os.html`  

---

## Phase 1: Setup & Infrastructure (基础搭建与样式系统)

- [ ] T001 创建移动端模块目录结构 `apps/web/src/mobile/` 与子目录 `components/`, `hubs/`, `drawers/`
- [ ] T002 [P] 移植与封装 SVG 极简矢量图标集至 `apps/web/src/mobile/components/MobileIcons.tsx`
- [ ] T003 [P] 移植物理水墨流体 Canvas 背景组件至 `apps/web/src/mobile/components/FluidInkBackground.tsx`
- [ ] T004 移植 Double-Bezel 物理同心圆角与去 AI 味暗墨 CSS 至 `apps/web/src/mobile/styles/mobile.css`

---

## Phase 2: Foundational Shell & Routing (移动端外壳与全局 5 Hub 导航)

- [ ] T005 实现通用半屏滑出抽屉组件 `apps/web/src/mobile/components/MobileDrawerSheet.tsx`
- [ ] T006 [P] 实现底部 5 大核心磨砂玻璃导航栏 `apps/web/src/mobile/components/MobileTabBar.tsx`
- [ ] T007 [P] 实现移动端顶部状态栏与灵动胶囊 `apps/web/src/mobile/components/MobileStatusBar.tsx`
- [ ] T008 实现移动端全景外壳 `apps/web/src/mobile/MobileShell.tsx`，整合 5 Hub 路由切换

---

## Phase 3: User Story 1 (US1) - 创作台与悬浮 Composer (P1)

- [ ] T009 [P] [US1] 实现每日码字目标进度条与连更打卡组件 `apps/web/src/mobile/components/GoalProgressWidget.tsx`
- [ ] T010 [P] [US1] 实现八步管线滑轨与张力波形折线组件 `apps/web/src/mobile/components/TensionSparkWidget.tsx`
- [ ] T011 [US1] 实现情节走向推演先问决策卡组件 `apps/web/src/mobile/components/PlotBranchWidget.tsx`
- [ ] T012 [US1] 实现沉浸正文阅读排版流（含伏笔锚点高亮） `apps/web/src/mobile/components/ProseReadingFlow.tsx`
- [ ] T013 [US1] 实现悬浮写作船坞 `apps/web/src/mobile/components/MobileComposer.tsx`（集成软键盘 `visualViewport` 避让与打字机流式生成）
- [ ] T014 [US1] 组装第一核心 Hub `apps/web/src/mobile/hubs/WorkbenchHub.tsx`

---

## Phase 4: User Story 2 (US2) - 商业化闭环工具抽屉 (P1)

- [ ] T015 [P] [US2] 实现版本历史时光机抽屉 `apps/web/src/mobile/drawers/VersionHistoryDrawer.tsx`（Diff 增删对比与一键回滚）
- [ ] T016 [P] [US2] 实现网文灵感起名与卡文骰子抽屉 `apps/web/src/mobile/drawers/InspirationDrawer.tsx`
- [ ] T017 [P] [US2] 实现全格式导出打包与网文一键排版抽屉 `apps/web/src/mobile/drawers/ExportPublishDrawer.tsx`
- [ ] T018 [P] [US2] 实现网文平台敏感词与合规审查抽屉 `apps/web/src/mobile/drawers/ComplianceDrawer.tsx`
- [ ] T019 [US2] 实现创作者登录/注册与离线许可证激活抽屉 `apps/web/src/mobile/drawers/AuthLicenseDrawer.tsx`

---

## Phase 5: User Story 3 (US3) - 检视塔四枢纽、作品资产、资源爬虫与系统中心 (P2)

- [ ] T020 [P] [US3] 实现检视塔四枢纽 `apps/web/src/mobile/hubs/InspectorHub.tsx`（Story Brain、装配看板、受损矩阵、质量门）
- [ ] T021 [P] [US3] 实现作品资产全景 `apps/web/src/mobile/hubs/WorksHub.tsx`（分卷目录、字数统计、文风画像）
- [ ] T022 [P] [US3] 实现资源与端侧爬虫 `apps/web/src/mobile/hubs/ResourcesHub.tsx`（起点/七猫/番茄多源检索、Crawl4AI 抓取入库）
- [ ] T023 [P] [US3] 实现系统与账户中心 `apps/web/src/mobile/hubs/SystemHub.tsx`（创作者身份卡、多书库切换、任务账本、云同步）

---

## Phase 6: Integration & Responsive Switch (双端自适应接入与验证)

- [ ] T024 在 `apps/web/src/App.tsx` 中集成媒体查询断点（`< 768px` 自动渲染 `MobileShell`）
- [ ] T025 运行 Vitest 单元测试与 TypeScript 类型检查，确保双端 0 错误
- [ ] T026 进行真机与 375px/390px 视口无障碍触控与端到端旅程验收
