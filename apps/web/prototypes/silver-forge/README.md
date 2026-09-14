# Silver Forge — 银白视觉签样原型（T01）

**状态：原型，待用户签样。** 签样通过前不进生产 token、不改 `globals.css` / `ink-realm.css` /
`src/shell/scene/`，不覆盖历史 ADR（签样后由执行票新增 superseding ADR）。

## 打开方式

直接用浏览器打开 `index.html`（纯静态、零依赖、离线可用）：

- `index.html` — 总览 + 工程起点 token
- `cards.html` — 银金卡背 × 正反面 × 常态/选中/不可用 + 无封面态 + 显式翻面
- `workbench.html` — 银白工作台三栏壳（含诚实不可用态示例）
- `storyboard.html` — 漫剧分镜页视觉（镜头卡：画面/对白/时长估计/提示词/原文锚/改编说明）

## 原创性声明

- 场景（`assets/scene-silver.svg`）、徽记（舟帆浮雕）、卡面示意图均为本原型原创，未复制任何
  游戏徽标/色值/Shader 参数；`references/` 仅作方向对照。
- 卡面正面图为**原创示意插画**（正式版替换为作品/角色/镜头真实图像）；无图时是明确「无封面」态。
- **正面最终参考样式由用户选定**；本原型未复用任何被用户否定的旧正面图。

## 验收口径（brief.visual.acceptance 对照）

- 1440 / 1280 / 390 宽截图：见 `evidence/T01/`
- 键盘焦点可见；`prefers-reduced-motion` 降级；触控目标 ≥44px；无持续扫光
- 金银为材质变体，不代表稀有度/质量/身份；真实状态用文字+图标
