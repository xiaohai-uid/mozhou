# INK_REALM_DESIGN_SYSTEM.md — 墨舟 Ink Realm / 墨境 设计系统

> 状态：Design Approved / Implementation Not Authorized（主规格 §0）。
> 本文承接 `2026-09-12-mozhou-ink-realm-design.md`（下称主规格）并落为可执行 token/组件规格；所有原型页共享 `assets/ink-realm.css` 实现。
> 事实基线：`INK_REALM_SURFACE_MAP.md`（HEAD b2a0930 追踪矩阵）。
> 与 ADR-0027 / `apps/web/DESIGN.md` 关系：信息架构、作者主权、Candidate→Approval→Commit、真实状态优先**全部继承**；紫色主色、贴边后台感、单一墨流世界背景、统一卡片材质、桌面唯一优先假设**被本系统升级**。实现阶段须新增 superseding ADR。

---

## 1. 设计命题

> 用户不是在一个黑色后台里写小说，而是**进入自己的小说世界**；墨舟是一套悬浮在世界之上的精密创作仪器。

两套独立但协作的系统：

```text
作品世界 World Layer（L0 Scene → L1 Atmosphere → L2 Figure/Veil）
        ↓
墨舟创作仪器 Instrument Layer（L3 HUD → L4 Work surfaces → L5 Text/Evidence）
        ↓
作者内容 / AI 证据（Content & Evidence，永远最高对比、最安静）
```

不做游戏皮肤：参考高端东方策略游戏的空间感/材质/卡牌/层级，不复制任何游戏 Logo、角色、卡面、图标、官方资产或完整布局。

---

## 2. Color Tokens（§5 全量落地）

### 2.1 基底与文字

| Token | 值 | 用途 | CSS |
|---|---|---|---|
| Canvas Void | `#05090D` | 世界最底色（Scene 未载入时） | `--ir-void` |
| Ink Deep | `#081117` | HUD 深底 / System Card | `--ir-ink-deep` |
| Surface 01 | `#0C171E` | 主面板 | `--ir-surface-1` |
| Surface 02 | `#102029` | Raised / Narrative Card | `--ir-surface-2` |
| Surface 03 | `#152832` | Controls / Capability Card | `--ir-surface-3` |
| Foreground | `#EDF1ED` | 主文字 | `--ir-fg` |
| Muted | `#A2ADA9` | 次要文字 | `--ir-muted` |
| Faint | `#687671` | 三级信息 | `--ir-faint` |
| Hairline | `rgba(205,225,222,.11)` | 普通边缘 | `--ir-hairline` |
| Hairline Strong | `rgba(225,239,235,.21)` | 强边缘 | `--ir-hairline-strong` |

### 2.2 语义色（颜色即产品语义，不是装饰）

| Token | 值 | 语义 | 禁止 |
|---|---|---|---|
| Imperial Gold | `#D6B36A` | **作者主权**：采用/确认/接受/Commit/发布/不可替代的作者主操作 | 不给非作者动作镀金；不给每个按钮金色 |
| Gold Bright | `#F0D18A` | 作者高优先级行动 | |
| Jade Cyan | `#72C9C4` | **AI/系统**：生成/分析/运行 Skill/Candidate/工具执行/系统活动 | 不用于作者决策 |
| Success | `#78C79D` | verified / committed / hash match / 持久化成功 | 不得表达「已接受」 |
| Warning | `#D3A765` | stale / advisory / 需配置 / 待作者检查 | |
| Danger | `#D98383` | blocking failure / hash mismatch / error / destructive | 不整页泛红 |
| Violet（遗留） | `rgba(150,120,255,*)` | **仅** experimental / unknown 极少数状态 | 不再作全产品主色 |

### 2.3 Ink Orbit → Ink Realm 迁移映射（实现阶段替换用）

| 旧 token（globals.css） | 旧值 | 新 token | 新值 |
|---|---|---|---|
| `--background` | `#0b0a0f` | `--ir-void` | `#05090D` |
| `--accent` | `#8b78ff`（紫） | 拆分 | `--ir-gold`（作者）+ `--ir-jade`（AI） |
| `--accent-soft` | `rgba(139,120,255,.12)` | `--ir-jade-soft` / `--ir-gold-soft` | 各语义 |
| `--surface`/`--surface-2`/`--surface-3` | `#15131a/#282330/#1d1923` | `--ir-surface-1/2/3` | 冷青墨系 |
| `--danger/--success/--warning` | `#f28b9b/#80d6b0/#e4b875` | `--ir-danger/--ir-success/--ir-warning` | 降饱和青玉系 |

---

## 3. Material System（四材质，配比纪律）

| 材质 | 用途 | 构成 | CSS class |
|---|---|---|---|
| **Scene Glass** | Top HUD、左侧导航、轻量 Sheet | 半透明 66–72% + blur(14px) 仅限固定/悬浮层 + 边缘折射高光（::before screen 混合） | `.mat-scene-glass` |
| **Ink Glass** | Inspector、章节轨、辅助工具面 | 更黑（90–92%）+ blur(6px) + hairline | `.mat-ink-glass` |
| **Reading Slate** | 正文编辑、长篇阅读、重要 diff | 近实心 98.5%、几乎无玻璃感、最高对比最低噪声 | `.mat-reading-slate` |
| **Metal Rim / Double Bezel** | **仅**：当前章节卡、关键 Skill、Quality 核心摘要、当前作品、重要选中卡 | outer rim 金属渐变描边 → 3px recess（::after 深色内圈）→ inner dark core | `.mat-metal-rim` |

红碑：不给每张卡、每个输入框套双层边框；大面积 blur 不用于滚动正文容器（主规格 §31.1、§30 Performance）。

---

## 4. Layer / Z-axis（八层固定）

| 层 | 内容 | 约束 |
|---|---|---|
| L0 | Scene image / 低频 WebGL 墨流 | `pointer-events:none`；WebGL low-power + 静帧兜底 |
| L1 | Atmosphere：暗角/颗粒/轻雾 | `pointer-events:none`；不入键盘序 |
| L2 | Contrast shadow veil + **Foreground Figure** | Figure 独立、可换可关；不进正文可读区前景 |
| L3 | HUD frame（Top HUD/Nav/Pipeline） | Scene Glass |
| L4 | Work surfaces | Ink Glass / Narrative Card |
| L5 | Text / controls / evidence | 最高对比；正文 Reading Slate |
| L6 | Popover / Sheet / command | 从触发源方向出现，沿原路退出 |
| L7 | Blocking modal / destructive confirmation | 仅 L7 用 scrim；destructive 需显式确认 |

正文可读区视觉遮蔽 ≈90–96%（veil + Reading Slate 叠加达成）。

---

## 5. Typography（三轨）

| 轨 | 字族 | 用于 |
|---|---|---|
| UI / Operations | 系统无衬线（`--ir-sans`） | 按钮/导航/状态/证据标签/任务/表格 |
| Prose / Narrative | Noto Serif SC / Songti SC（`--ir-serif`） | 书名/章节名/正文/文学内容 |
| Evidence / Technical | Mono（`--ir-mono`） | hash/receipt id/revision/taskRef/token/event position/traversal id |

正文规范：16–18px（原型 17px）、line-height 1.85–2.0（原型 1.95）、measure ≈60–75 中文字符（max-width 44em）、段间节奏靠行距不靠卡片、中文段落 2em 缩进（`.prose`，与 NovelEditorCanvas 的 `\n　　` 语义一致）。

---

## 6. Scene System（一等公民；详见 02-scene-system.html 交互原型）

- 三层解耦：**Scene**（世界环境：海城/云海/雨夜/未来长安/书斋/巨构/荒漠）→ **Atmosphere**（暗幕/冷暖/暗角/颗粒/轻雾/极低频墨流）→ **Foreground Figure**（人物/剪影，独立可替换可隐藏）。
- V1 能力（主规格 §3.2 全量）：内置 Scene 选择、背景上传（JPG/PNG/WebP）、人物上传（透明 PNG/WebP）、显示/隐藏、左中右锚点、缩放、透明度、Scene focus X/Y、背景亮度、背景模糊、暗幕强度、全局默认 Scene、按作品 override、切书切换 Profile。
- 入口：Top HUD「场景」→ 右侧 non-blocking Sheet，四分区：场景 / 氛围 / 人物 / 作用域。修改实时预览；仅「恢复默认 / 删除作品覆盖」需 L7 确认。
- **上传交互规格（验收修订轮补充）**：背景与人物上传为完整交互闭环——`input[type=file]`（背景 accept=JPG/PNG/WebP，人物 accept=透明 PNG/WebP）→ 格式白名单校验 → 资源预算（背景 ≤8MB、人物 ≤4MB，主规格 §30）→ 最低分辨率（背景 ≥1280px、人物 ≥600px）→ 缩略图预览（文件名+尺寸+体积+格式 meta）→ 应用/替换/移除 → objectURL 生命周期回收。三类错误态各有明确文案：格式不支持 / 超出预算 / 解码失败或分辨率过低；上传应用后隐藏合成主体带（`has-upload`），移除后恢复内置场景。
- 持久化语义：UI preference，**不是 Canon**；无书=global；有书有 override=book；有书无 override=继承 global；删除 override 回退 global；任何 Scene 改动不得触碰正典/正文/Receipt/Pipeline 状态；云同步未上线时不宣称 Scene 云同步。
- 移动端：Scene 保留，**Figure 默认关闭**，veil 更重，无复杂 parallax。
- 原型占位：背景与人物用 CSS 合成渐变（`ir-scene.*`、`.ir-figure .sil`），标注占位可替换，不使用任何外部图片版权资产。**场景画层结构（验收修订轮）**：主背景仅承载全尺寸氛围层（月/光晕/天极渐变），可辨识的主体带（城市天际线+窗灯、云海、雨丝、书架）置于 `::after` 伪元素——保证任何 `background-size:cover` 上下文下世界层不被拉伸破坏，也让「上传即整图替换」有干净语义。默认档以「场景轮廓真实可辨」为准：夜空中景亮度 #1d4258 档、月亮/地平线光晕可辨、氛围暗角 0.40、默认 veil 0.38 / 亮度 108%（可实时调节）。

---

## 7. Card Taxonomy（五类卡，禁止一个 .card 通吃）

| 卡 | 用于 | 材质/密度 | 证据锚 |
|---|---|---|---|
| **Narrative Card** | 作品、章节、世界观摘要 | Surface-02 渐变 + 14px radius + hover 2px lift | `.card-narrative` |
| **Character / Lore Card** | 人物/物品/地点/势力/概念 | Surface-01 + 10px + hover Jade 描边；POV 门禁不动摇 | `.card-character` |
| **System Card** | Quality/Receipt/Task/Cloud 状态 | Ink Deep + 8px + dense | `.card-system` |
| **Capability Card** | Skill/capability/provider | Surface-03 渐变 + 14px + hover 3px lift；selected=Metal Rim 金脊局部 | `.card-capability` |
| **Evidence Row** | hash/revision/event/traversal/receipt entry | Mono 单行 + hairline 分隔，无边框卡 | `.row-evidence` |

禁：发光卡墙、每卡 Metal Rim、游戏数值系统（Level/稀有度/战力无产品数据不新增）。

---

## 8. Interaction Components（按钮语义）

| 类 | 语义 | 样式 |
|---|---|---|
| `.btn-author` | Gold。接受/确认/提交/发布 | 金渐变底+金描边+Gold Bright 文字 |
| `.btn-ai` | Jade。生成/分析/运行 Skill/重新分析 | Jade soft 底+Jade 描边 |
| `.btn` | Neutral 深色低调操作 | Surface-03+hairline |
| `.btn-ghost` | 辅助跳转/取消/展开 | 透明+hover 微亮 |
| `.btn-danger` | 仅不可逆操作 | Danger soft 底 |
| Commit 流 | Gold 触发 → durable verification 成功后状态变 **Green** | accepted（Gold 瞬时确认，contract-pending）≠ committed（Green 持久） |

**Press**：按下立即 `scale(.985)` 或 1px 位移，不等 release。Focus：2px Jade outline offset 2px。Disabled：opacity .45 + 不可用原因文字。

---

## 9. Status Language（状态即产品）

| 徽标 | 语义 | 规则 |
|---|---|---|
| `PASS` / `已定稿` / `hash match` / `已消解` | verified/committed（Green） | 必须有文本标签 |
| `STALE` / `advisory` / `需配置` | Warning | stale 附「正文在审查后变化」等成因 |
| `BLOCKING` / `REFUSED` / `MISMATCH` / error | Danger | 只在关键状态脊暗红，不整页红 |
| `AI CANDIDATE` | Jade | 流式/候选显式标注（**当前代码缺失，NEW_DESIGN_REQUIREMENT**） |
| `ACCEPTED`（前瞻） | Gold 瞬时确认 | contract-pending，不画成现有行为 |
| `COMMITTED` | Green + revision/verified 证据 | 不与 accepted 混同 |
| `unavailable / blocked` | Warning 虚线卡 `.unavailable` | 必答三问：不可用/为什么/恢复途径；采用真实服务端文案与 code（如 `RANK_SOURCE_NOT_CONFIGURED`） |
| `DESIGN FIXTURE` / `LOCAL PRESET` / `FUTURE DATA LAYOUT` | Faint 虚线徽标 | 原型内样例数据/预设/未来布局显式标注 |
| `EXPERIMENTAL` | Violet | 仅 code-present 未挂载域（Canon Graph 等） |

六态 Pipeline stage：selected（Jade 下脊）/ live running（Jade 流光下脊）/ completed（Green ✓）/ blocked（Warning 虚线）/ failed（Danger）/ unavailable（40% 灰）。**被点击 ≠ 执行成功**。

---

## 10. Motion（Physical / Interruptible / Spatial）

- 微交互 180–280ms（`--ir-t-micro:200ms`）；Sheet 280ms（`--ir-t-sheet`）；缓动 `cubic-bezier(0.16,1,0.3,1)`（沿用 Ink Orbit `--ease`）。
- Sheet/Popover 从触发源方向出现、沿原路退出；hover 无 layout shift（只用 transform/opacity）。
- Chapter 切换沿 Chapter Rail 方向过渡；AI stream 本身是主动画（insertion caret `▎`），不叠 loading orb。
- 背景：仅极低频/低位移；无大面积长期漂浮；颗粒/噪声固定单层。
- `prefers-reduced-motion`：场景静止、Sheet 改 cross-fade、语义全保留（CSS 已内置全量降级）。
- `prefers-contrast: more`：hairline/feant 提亮路径已内置。

---

## 11. Immersion Budget（强度=装饰/背景可见度/卡牌感，非功能数量）

| Surface | Max | 材质基调 |
|---|---:|---|
| Capability Square | 90% | Scene Glass 框 + Capability Card 墙 |
| Works / Bookshelf | 90% | Narrative Card 藏书馆 |
| Wizard | 90% | 大 Scene 启动仪式 |
| Workbench frame / Story Brain | 80% | Scene Glass 外框 + Ink Glass 内核 |
| Book Source / Style Distill | 60% | 半沉浸操作面 |
| Novel Breakdown future layout | 60% | — |
| Rank / Web Search / Membership / Cloud | 45% | 档案页 |
| Inspector / Tasks / Receipt / Matrix | 30% | Ink Glass + Evidence Row |
| **Prose editor（Reading Slate）** | **10%** | 全产品最安静 |

---

## 12. Accessibility / Truthfulness / Performance 红线

- 键盘 focus 可见；状态永不只用颜色（badge 文本标签强制）；Tab/Sheet/Modal 语义与 focus return；error/blocked/stale/candidate/committed 全部有文本标签；中文 IME 优先于快捷键与动画；reduced-motion / reduced-transparency / more-contrast 退化路径内置。
- Truthfulness 七不（主规格 §30）：不假统计、不把 demo/fallback 当实时、不把 unmounted 画成上线、不把 selected 画成 executed、不把 accepted 画成 committed、不把 local-ready 画成 cloud-synced、不把未来付费画成可购买。
- Performance：blur 仅固定/悬浮层；粒子固定单层；Scene 资源尺寸预算+lazy decode；WebGL low-power+static fallback；正文滚动优先于装饰帧率。
- 触点（移动）：主目标 ≥44px，**单一 token `--touch-target-min:44px` 治理，禁止页面内联 40/44/48 混用**（验收修订轮 P1-5 落实）；Bottom Sheet 有语义 drag handle/close/focus management。

---

## 13. 图标策略

移除 Emoji 正式 UI 图标（现状 TopBar ⏱🎲📦🛡️）。采用 18px、1.25–1.5px stroke 墨舟自有 SVG 线性图标（MobileIcons.tsx 的 13 枚 inline SVG 可作为底座扩展），不安装 icon 依赖（主规格 §31.14）。原型中图标以 SVG inline 呈现。

---

## 14. 响应式

- Desktop 验收视口：**1440 与 1280 双档**（三 HUD 区 + 世界缝隙 8–12px）；1280 档收窄列宽、Pipeline 标签隐藏。
- Mobile `<768px`：独立五 Hub 产品面（非桌面缩小版）；Scene 保留 + Figure 默认关 + veil 加重；目标 ≥44px；Bottom Sheet 规范化。
- 两端同一 token 宇宙，移动端只允许密度/尺寸变体（禁第二套色彩语义）。
