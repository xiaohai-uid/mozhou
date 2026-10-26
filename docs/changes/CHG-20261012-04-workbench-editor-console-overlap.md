# CHG-20261012-04 — 工作台矮视口下 AI 控制台覆盖编辑器

- 日期：2026-10-12；执行：ZCode（AI 辅助）。
- 需求来源：真实浏览器实测（chrome-devtools MCP 1.6.0 与 Playwright Python 1.63.0 各驱动一次）发现，用户确认修复。
- 基线：feature/windows-local-release，HEAD 8907eac01c267e96a60025f2bf0e35a98580ef9c，工作区有未提交改动。未提交、未合并、未推送。
- 范围：仅 `apps/web/src/styles/ink-realm.css` 两条规则；未改组件结构，未加依赖。

## 缺陷

在 1280×720 与 1366×768 下，中间栏的 AI 控制台完全压住编辑器，作者点不进写作面。

- 结构：`.studio-canvas` 是 `grid-template-rows: minmax(0, 1fr) auto`，第 1 行放编辑器滚动区（`.studio-editor-scroll`），第 2 行放控制台（`.ai-console`）。
- 直接原因：控制台行取 `auto`，按内容要 550px；容器只有 550px，于是第 1 行被压到 0（实测计算行高 `0px 550px`），编辑器整块落在滚动区可视范围之外。
- 放大因素：`.studio-canvas .reading-slate textarea` 有 `min-height: 470px !important`，比 720p 整列可用高度还大，写入面必然在可视区之外。
- 实测证据：编辑器中心 `elementFromPoint` 命中控制台元素（`choice` / `bubble` / `ai-console-body`），重叠比 1.0；1280×720 截图可见「第 1 章」标题从控制台文字后透出。
- 为什么现有测试抓不到：jsdom 不做布局，组件测试只断言 DOM 与行为，不判几何。

## 修改

1. `.ai-console-body` 的 `max-height` 由固定 `480px` 改为 `clamp(180px, calc(100vh - 620px), 480px)`：先按上方（顶栏 112 + 章栏 58 + 画布头 109 + 正文卡头 60 + 可用正文约 280 ≈ 620）留够，余量归控制台，下限 180px。保留其原有的内部滚动与 sticky 输入区。
2. `.studio-canvas .reading-slate textarea` 的 `min-height` 由 `470px` 改为 `min(470px, 42vh) !important`，矮视口按比例收缩。

两条都只在下限处生效：视口足够高时（约 ≥1100px）控制台仍是 480px、写入面仍是 470px，与改动前一致。

## 验证（本轮实际执行）

- 真实浏览器几何断言（同一构建产物）：
  - 1280×720：写入面可见 50px，编辑器中心命中编辑器本身 → 可点击；控制台 246px。
  - 1366×768：写入面 65px 全可见、可点击。
  - 1920×1080：写入面 65px 全可见、可点击；控制台体 460px（与改动前 480px 基本一致，无回归）。
- 截图留证：`evidence-03-editor-covered-1280x720.png`（修复前）、`evidence-05-fixed-1280x720.png`（修复后）。
- `pnpm --filter @mozhou/web test`：160 文件 / 1338 用例通过（15 跳过）；无测试断言这两处 CSS。
- `pnpm lint` 退出 0；`doc-gates` / `graph-check`（clean, 0 环）/ `import-cycles`（0 环）/ `duplication` 全部退出 0；`docs/architecture.md` 因 CSS 行数变化重生成。
- 未验证：其它分辨率与移动端布局（未测）、真实高分屏 DPI 下的观感（未测）。

## 备注

本轮同时确认了作者核心路径在真实浏览器中端到端可用（建书 → 编辑器输入 → Accept 落草稿 → 清本地草稿缓存 → 刷新由服务端恢复），并记录了另一条过程教训：陈旧 `dist-server` 会产生假失败，测试前必须重建。
