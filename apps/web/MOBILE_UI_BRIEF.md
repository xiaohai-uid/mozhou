# 墨舟 (Novel OS) 手机端 UI 架构与全量开发对接指引

> **给合作 AI 的交接备忘录**：
> 墨舟是一款生产级、可商用的小说 AI 辅助创作操作系统。后端 20+ API、状态机、数据平面和文学质量门已经全部跑通（848/848 项测试全绿）。
> **当前唯一任务**：为墨舟打造一套具有 **Apple Fluid Motion（WWDC 流体交互）** 与 **WebGL 赛博液态黑曜石** 质感的一等公民**手机端（Mobile Viewports ≤ 768px）UI**。

---

## 1. 核心技术栈与文件结构

- **前端技术栈**：React 18 + TypeScript + Vite + Tailwind CSS v4 + 原生 WebGL 着色器
- **核心前端目录**：`apps/web/`
- **核心文件映射**：
  - `apps/web/src/App.tsx`：应用壳主入口，当前为桌面三栏网格（`grid-template-columns: 228px 1fr 356px`），手机端需改为响应式单列流 + 底部导航 / 顶部抽屉。
  - `apps/web/src/workbench/WorkbenchView.tsx`：中栏创作工作台主容器。
  - `apps/web/src/workbench/DialogueStream.tsx`：中栏写作对话流、墨舟先问、双胶囊轨与流式正文渲染。
  - `apps/web/src/shell/TopBar.tsx`：顶栏品牌与项目切换。
  - `apps/web/src/shell/PipelineStrip.tsx`：八步写作管线指示条（准备→草稿→审查→落定等）。
  - `apps/web/src/shell/CapabilityChannels.tsx`：左侧 17 项功能航道。
  - `apps/web/src/shell/InspectorTower.tsx`：右侧检视塔（质量门 / Story Brain / 装配看板 / 变更矩阵）。
  - `apps/web/src/shell/InkBackground.tsx`：背景全屏 WebGL 墨流着色器（Fragment Shader）。
  - `apps/web/src/styles/globals.css` & `ink-orbit.css`：品牌配色 Token、近黑材质与排印样式。

---

## 2. 墨舟 17 项功能航道与 API 数据契约

全部采用同进程 Connect 中间件直出，请求方式均为 `POST`，内容类型为 `application/json`：

| 模块类别 | 核心功能 | API 端点 | 传输载荷与返回结构 |
| :--- | :--- | :--- | :--- |
| **创作组** | 建书 / 切换作品 | `POST /api/book` | 入参 `{ title }`，返回 `{ ok: true, root, bookId }` |
| | 墨舟先问（问答建议） | `POST /api/draft.question` | 返回 `{ ok: true, question, choices: [...] }` |
| | 流式草稿生成 | `POST /api/draft.stream` | 入参 `{ root, chapterIndex, prompt, skills }`，返回 NDJSON 流式事件（`start` / `delta` / `done`） |
| | 正文与状态读取 | `POST /api/book.state` | 入参 `{ root }`，返回正典状态与章节列表 |
| **检视组** | 文学质量门审查 | `POST /api/chapter.review` | 入参 `{ root, chapterIndex }`，返回 `{ ok: true, report: { verdict, score, issues } }` |
| | 故事脑 (Story Brain) | `POST /api/story-brain.facts` | 入参 `{ root }`，返回 `{ ok: true, facts: [...] }`（含 canon/suspect/belief 认知标签） |
| | 实体网格卡片 | `POST /api/story-brain.entities` | 入参 `{ root }`，返回 `{ ok: true, cards: [...] }` |
| | 装配看板 (Receipt) | `POST /api/receipts` | 入参 `{ root }`，返回装配凭证列表与上下文预算消耗 |
| | 变更影响矩阵 | `POST /api/change-matrix` | 入参 `{ root }`，返回遍历波及矩阵与重跑接口 |
| **工作流** | 任务中心与流水账本 | `POST /api/tasks` / `POST /api/ledger` | 返回系统任务队列与 Traversal 事件流水 |
| **资源组** | 技能广场 (17航道) | `POST /api/capabilities` | 返回系统注册的 17 项能力状态（原生可用 / 需要模型等） |
| | 本地书架扫描与导入 | `POST /api/library` / `POST /api/library.import` | 扫描本地书库或导入第三方书源 |
| | 书源全网检索 | `POST /api/book-source.search` | 入参 `{ keyword }`，返回聚合书源检索结果 |
| | 智能双轨正文提取 | `POST /api/crawler.extract` | 入参 `{ url }`，返回 crawl4ai 清洗后正文并自动建书入库 |
| | 文风画像与蒸馏 | `POST /api/style` / `POST /api/style.distill` | 计算文风矩阵并生成风格特征雷达 |
| | 小说深度拆解 | `POST /api/novel-breakdown` | 逆向拆解长篇网文节拍、钩子与高潮分布 |
| **账户组** | 会员中心与额度激活 | `POST /api/membership` | 激活卡密与额度管理 |

---

## 3. 设计规范与审美准则（Design Tokens & Rules）

1. **色彩与材质体系（Nocturnal Ink & Liquid Glass）**：
   - 纯黑底色：`#040306` / `#09080d`
   - 夜墨紫核心：`#8c7aff` / 渐变 `linear-gradient(135deg, #a79aff 0%, #7058ff 100%)`
   - 发丝线：`rgba(255, 255, 255, 0.08)`
   - 玻璃质感：`backdrop-filter: blur(24px)` + 内描边 `box-shadow: inset 0 1px 1px rgba(255,255,255,0.15)`
2. **Double-Bezel 双层嵌套架构**：
   - 容器均采用外层高透微晶托盘（`p-1 rounded-[2rem]`）+ 内层深空核心（`rounded-[calc(2rem-4px)]`），杜绝廉价 1px 灰线。
3. **Button-in-Button 交互按键**：
   - 发送按键内置半透明微晶圆盘（`w-7 h-7 rounded-full bg-white/20`），按压即时 `scale(0.96)` 物理反馈。
4. **排印双轨制**：
   - UI 操作层：`Geist` / `Plus Jakarta Sans` / `-apple-system` 现代无衬线体；
   - 正文流淌层：`Noto Serif SC` / `Songti SC` 高端衬线宋体，行高 `1.9`，字距 `0.02em`。
5. **视口断点与响应式规则**：
   - 桌面（`> 768px`）：保持经典三栏精密工作台；
   - 移动端（`≤ 768px`）：单列沉浸流，顶部悬浮微岛 Header / 灵动岛，底部悬浮 Composer v3 输入舱，抽屉式 Bottom Sheet 呈现右侧检视塔。

---

## 4. 现成设计原型与高保真代码参考

工程内已生成 3 份可直接双击运行的交互原型文件供对比参考：
1. `apps/web/prototypes/mobile-webgl-flagship.html`（**最终推荐：WebGL 液态黑墨 + Liquid Glass 旗舰版**）
2. `apps/web/prototypes/mobile-flagship-v2.html`（灵动岛 + Double-Bezel 极客版）
3. `apps/web/prototypes/mobile-workbench-variants.html`（三变体发散对比看板）

---

## 5. 开发与验证命令

在项目根目录下：
```bash
# 安装依赖（必须设置跳过 CUDA 下载）
export ONNXRUNTIME_NODE_INSTALL_CUDA=skip
pnpm install

# 启动开发服务器（支持热重载与全量 API 中间件）
pnpm --filter @mozhou/web dev

# 运行全套单元测试与契约测试
pnpm test
pnpm --filter @mozhou/web test

# 生产构建
pnpm build
```
