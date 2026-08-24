# 墨舟 Landing「夜墨编辑工作室」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不触碰后端和应用内业务的前提下，把公开 Landing 重做成更完整、克制、可响应的中文写作产品入口。

**Architecture:** 沿用现有 Next.js App Router、Server Components、Tailwind v4 和拆分后的六个 landing 组件。用全局 token 统一颜色、圆角、排版和动效，再分别重排 Hero、FeatureBento、ProductPreview、MemorySection、Ethos、CtaSection。无需新增依赖或引入客户端状态。

**Tech Stack:** Next.js 16.3, React 19, TypeScript, Tailwind CSS v4, `@phosphor-icons/react`。

## Global Constraints

- 只修改公开首页及其 landing 组件，不改变 API、认证、数据库、工作台和路由契约。
- 遵守 `C:\zcode\novel-ai\app\AGENTS.md` 的 Next.js 16 规则和项目 UVSD 约束。
- 不新增第三方依赖，不新增动画库，不新增外部图片请求。
- 继续使用单一紫色动作色，避免随机渐变和重复卡片模板。
- 目标视口固定为 1440、1024、768、390。
- 完成前必须运行 `npm run gate:milestone`，并通过真实浏览器截图检查。

### Task 1: 固化 Landing 视觉 token 与安全动效

**Files:**
- Modify: `app/app/globals.css`
- Modify: `app/app/layout.tsx`
- Modify: `app/app/page.tsx`

**Interfaces:**
- Consumes: 现有 `--background`、`--accent`、`--surface` 等 CSS token 和六个 landing 组件。
- Produces: 统一的墨色背景、纸白文字、单一紫色强调、容器圆角、按钮动效和首帧安全的入场动画。

- [ ] **Step 1: 调整 token 和字体层级**

  在 `globals.css` 中把背景、表面、正文、弱文本和 accent 收敛到一套墨色与纸白体系，保留现有 Tailwind 自定义颜色名称，避免组件逐个改名。设置 `font-family` 的正文、等宽元数据和标题用途，并保持中文系统 fallback。

- [ ] **Step 2: 修复入场动效的首帧风险**

  让 `.mozhou-rise` 不再依赖动画才能显示内容，改为通过可选的增强类控制位移和透明度；为 reduced motion 提供静态状态，并把闪烁光标纳入 reduced motion 规则。

- [ ] **Step 3: 统一页面容器与导航语义**

  在 `page.tsx` 中给页面主结构增加稳定的内容容器类和跳过链接，保持现有 Logo、登录、注册 href 不变。导航主按钮、次按钮和焦点状态使用全局 token。

- [ ] **Step 4: 运行类型检查**

  Run from `app`: `npm exec -- tsc --noEmit`

  Expected: exit code 0，且没有新增 TypeScript 错误。

### Task 2: 重做 Hero 首屏

**Files:**
- Modify: `app/components/landing/hero.tsx`

**Interfaces:**
- Consumes: `next/link`、现有 `PenNib` 图标、`/register` 和 `/login` 路由。
- Produces: 首屏左右分栏、章节编辑预览、明确的主次 CTA、可读且不依赖动画的内容。

- [ ] **Step 1: 保留并收紧 Hero 文案**

  保留中文写作者定位、主标题和两段描述，调整最大宽度与排版，使桌面端标题保持 2 行以内，移动端仍可自然换行。

- [ ] **Step 2: 把右侧卡片改成编辑器预览**

  将现有章节卡拆为顶部章节状态、正文预览、技能/模型状态、底部写作台元数据四个区域。用背景层级代替额外阴影，保持 `aria-hidden` 装饰元素不参与阅读顺序。

- [ ] **Step 3: 统一 CTA 状态**

  主按钮使用实心 accent，登录使用低权重描边按钮；两者都加入 hover、active 和可见焦点状态，避免按钮文字换行。

- [ ] **Step 4: 在 1440px 与 390px 渲染首屏**

  检查标题、按钮、预览卡的边界，确认首帧内容可见、没有水平溢出。

### Task 3: 重排 FeatureBento 功能网格

**Files:**
- Modify: `app/components/landing/feature-bento.tsx`

**Interfaces:**
- Consumes: 现有六项能力和 Phosphor 图标。
- Produces: 桌面端无孤立卡片的 dense bento，移动端紧凑的单列功能列表。

- [ ] **Step 1: 为能力项定义明确的布局角色**

  用 `featured`、`memory`、`utility` 三类角色替代仅由 `variant` 控制的外观，让“写作对话”跨两行，其余五项填满网格，不产生空洞。

- [ ] **Step 2: 减少重复视觉噪声**

  只让主卡使用 accent 图标和轻微背景光，其余卡片使用纸白/墨灰层级；数字编号改为弱元数据，不让每张卡都抢主视觉。

- [ ] **Step 3: 写出移动端明确退化**

  768px 以下恢复单列，卡片采用统一内边距和更紧凑的垂直节奏，保证所有文案可读。

- [ ] **Step 4: 检查桌面网格**

  在 1024px 和 1440px 截图确认六项能力形成完整组合，不出现最后一张卡独占左下角。

### Task 4: 升级产品预览、长文记忆、理念和 CTA

**Files:**
- Modify: `app/components/landing/product-preview.tsx`
- Modify: `app/components/landing/memory-section.tsx`
- Modify: `app/components/landing/ethos.tsx`
- Modify: `app/components/landing/cta-section.tsx`

**Interfaces:**
- Consumes: 现有静态示例内容和 `/login`、`/register` 链接。
- Produces: 更像真实写作产品的对话预览、档案式记忆展示、安静的理念区和单一主动作 CTA。

- [ ] **Step 1: 重做 MiniChat 视觉层级**

  保留真实语义标签与只读输入框，增加明确的生成状态、技能状态和“插入正文”提示，但不增加真实交互或 API 调用。

- [ ] **Step 2: 重做 MemorySection 的关系感**

  保留人物、设定、章节内容，使用错位卡片和轻量关系线/标签层级，使三项内容看起来属于同一个记忆系统，而不是三张相同卡片。

- [ ] **Step 3: 收敛 Ethos 和 CTA**

  理念区减少编号依赖，CTA 区减少重复 eyebrow 和发光阴影，保留一个清晰主按钮和一个登录次按钮。

- [ ] **Step 4: 检查 768px 与 390px**

  确认对话气泡、记忆卡、CTA 按钮不发生裁切、溢出或异常换行。

### Task 5: 真实浏览器视觉验收与回归

**Files:**
- Modify: only if visual verification finds a defect in the files above.

**Interfaces:**
- Consumes: 运行中的 Next.js dev server、公开首页、目标视口矩阵。
- Produces: 可复核的桌面/移动端截图和回归命令结果。

- [ ] **Step 1: 启动唯一 dev server**

  Run from `app`: `npm run dev -- --port 3002`

  Expected: server listens on port 3002 without starting a second instance.

- [ ] **Step 2: 截图检查四个视口**

  检查 1440、1024、768、390 四个视口的首屏、功能区、对话区、CTA 区；记录首帧可见性、网格完整性、横向溢出和按钮可达性。

- [ ] **Step 3: 检查 reduced motion 与焦点环**

  使用浏览器的 reduced motion 设置和键盘 Tab 导航，确认主要内容仍显示，焦点环清晰。

- [ ] **Step 4: 运行完整门禁**

  Run from `app`: `npm run gate:milestone`

  Expected: TypeScript、Vitest 和 Next.js build 全部 exit code 0。

- [ ] **Step 5: 查看 diff 并提交**

  Run: `git diff --check; git status --short; git diff --stat`

  Expected: 仅包含本计划涉及的 landing、token、设计文档和计划文件，随后提交：

  ```bash
  git add app/app/globals.css app/app/layout.tsx app/app/page.tsx app/components/landing docs/superpowers/specs/2026-08-16-mozhou-landing-redesign-design.md docs/superpowers/plans/2026-08-16-mozhou-landing-redesign.md
  git commit -m "design: refine mozhou landing visual system"
  ```
