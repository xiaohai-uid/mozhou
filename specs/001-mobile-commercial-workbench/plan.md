# Implementation Plan: 移动端商业化全景工作台 (Mobile Commercial Workbench)

**Feature**: `001-mobile-commercial-workbench`  
**Status**: Approved for Task Breakdown  
**Target Application**: `apps/web` (React 18 + Vite + TypeScript)  
**Spec Reference**: `specs/001-mobile-commercial-workbench/spec.md`  
**UI Reference**: `apps/web/prototypes/opendesign-mobile-flagship-os.html`  

---

## 1. Architecture & Component Strategy

### 1.1 双端响应式外壳架构 (Dual-Shell Architecture)
- 在 `apps/web/src/App.tsx` 中引入媒体查询与屏幕宽度监听：
  - **宽屏 (> 768px)**：保持现有的 Ink Orbit 三栏桌面布局（`TopBar` + `CapabilityChannels` + `PipelineStrip` + 中栏工作区 + `InspectorTower`）；
  - **窄屏 (< 768px)**：自动渲染全新的 `MobileShell` 组件，承载五大底部 TabBar 导航。

### 1.2 移动端核心组件分层 (Mobile Component Hierarchy)

```
apps/web/src/mobile/
├── MobileShell.tsx                 # 移动端外壳，承载 Header、StatusBar 与 TabBar
├── components/
│   ├── MobileHeader.tsx            # 顶栏（书名、章节、时光机入口、目录入口）
│   ├── MobileTabBar.tsx            # 底部五大核心导航栏（SVG 极简图标 + 磨砂玻璃）
│   ├── MobileDrawerSheet.tsx       # 通用半屏滑出抽屉容器（手势支持）
│   ├── FluidInkBackground.tsx      # 轻量物理水墨流体 Canvas 背景
│   └── MobileComposer.tsx          # 悬浮写作船坞（支持 visualViewport 软键盘避让）
│
└── hubs/
    ├── WorkbenchHub.tsx            # Hub 1: 创作台（目标进度条、管线、张力曲线、先问决策、沉浸正文）
    ├── InspectorHub.tsx            # Hub 2: 检视塔（四枢纽 Tab：设定事实、装配看板、受损矩阵、质量审查）
    ├── WorksHub.tsx                # Hub 3: 作品管理（分卷全景目录、字数统计、文风画像入口）
    ├── ResourcesHub.tsx            # Hub 4: 资源爬虫（多源检索、起点/七猫/番茄榜单、Crawl4AI 正文提取）
    └── SystemHub.tsx               # Hub 5: 系统中心（创作者卡片、多书库切换、任务账本、云同步、许可证激活）
```

### 1.3 商业化闭环工具抽屉 (Commercial Drawers)
1. **`VersionHistoryDrawer.tsx`**：版本时光机，展示 Rev 历史快照与 Diff 差异对比，提供一键回滚 API 挂载；
2. **`InspirationDrawer.tsx`**：灵感工坊，提供角色起名、宗门、法宝、卡文突发事件骰子算法；
3. **`ExportPublishDrawer.tsx`**：作品导出与一键排版，调用 `proseChapter` 导出 Word / TXT / EPUB 并提供番茄/起点格式规范复制；
4. **`ComplianceDrawer.tsx`**：敏感词审查抽屉，实时校验合规规则；
5. **`AuthDrawer.tsx`** 与 **`LicenseDrawer.tsx`**：创作者登录、注册与离线 License Key 激活。

---

## 2. API & Data Flow Integration

移动端组件 100% 复用后端现有的 `apps/web/server/api.ts` 中间件与 API 路由：
- 创作草稿流：`POST /api/draft.stream`（NDJSON 打字机流式）
- 墨舟先问：`GET /api/draft.question`
- 设定事实：`GET /api/story-brain.facts`
- 装配凭证：`GET /api/receipts` 与 `GET /api/receipt.detail`
- 变更矩阵：`GET /api/change-matrix` 与 `POST /api/change-matrix.rerun`
- 质量审查：`GET /api/quality.review`
- 商业化许可证：`POST /api/membership` 与 `POST /api/membership.activate`
- 多源端侧爬虫：`POST /api/book-source.search` 与 `GET /api/rankings.qidian`
- Crawl4AI 正文抓取：`POST /api/crawler.extract`

---

## 3. Implementation Phasing

- **Phase 1**: 创建 `apps/web/src/mobile/` 目录，移植 SVG 图标集、物理水墨背景、CSS 样式与基础组件。
- **Phase 2**: 实现 `WorkbenchHub` 与 `MobileComposer`（集成码字目标、张力折线、先问决策、时光机）。
- **Phase 3**: 实现 `InspectorHub`（设定事实、凭证、受损矩阵、敏感词合规）。
- **Phase 4**: 实现 `WorksHub`、`ResourcesHub` 与 `SystemHub`（分卷目录、全格式导出、多源爬虫、创作者登录与许可证激活）。
- **Phase 5**: 在 `App.tsx` 中配置双端自适应断点，执行单元测试与 E2E 验证。
