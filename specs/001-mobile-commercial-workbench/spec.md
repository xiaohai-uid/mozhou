# Specification: 移动端商业化全景工作台 (Mobile Commercial Workbench)

**Feature**: `001-mobile-commercial-workbench`  
**Status**: Draft / Baseline Approved  
**Created**: 2026-09-02  
**Target Platform**: Mobile Web / PWA / Responsive Web (< 768px Viewport)  
**UI Reference**: `apps/web/prototypes/opendesign-mobile-flagship-os.html`  

---

## 1. Context & Business Value

墨舟 (Novel OS) 桌面端已完成 17 航道全量业务能力、数据面与发布打包，但在移动端（手机与窄屏平板）上缺乏完整且对齐全部服务颗粒度的商业化移动端界面。

本功能以 `opendesign-mobile-flagship-os.html` 为 UI 基线，将墨舟的 **17 航道数据面**、**商业化闭环工具**（版本历史时光机、每日码字目标、灵感起名工坊、全格式导出排版、平台敏感词审查、创作者账户与离线许可证）全面接入 `apps/web` 生产代码，实现高质量的移动端小说创作体验。

---

## 2. User Scenarios & Acceptance Criteria

### 2.1 创作者日常移动端写作 (Workbench Flow)
- **场景**：作者在手机浏览器中打开墨舟，进入当前小说章节正文。
- **验收标准**：
  1. 页面自适应移动端屏幕（375px ~ 430px），支持沉浸式正文阅读与编辑；
  2. 顶部展示「今日码字目标进度条（如 3,420 / 4,000 字）」与连更打卡状态；
  3. 八步管线滑轨（设定/大纲/草稿/审查/修订/排版/分卷/发布）支持水平横向滑动与点击切换；
  4. 叙事张力计实时绘制动态贝塞尔波形折线图；
  5. 底部悬浮写作船坞（Composer v2）支持输入推进指令、插入快捷技能胶囊（【加冲突】、【精简叙述】、【回收伏笔】），并触发流式生成；
  6. 正文高亮呈现伏笔金色锚点（Foreshadowing）与行内微批注。

### 2.2 版本时光机与防丢稿差异回滚 (Version History Diff)
- **场景**：作者误删文字或希望恢复之前的初稿。
- **验收标准**：
  1. 点击顶栏「时光机」按钮，呼出半屏抽屉，列出历史快照列表（如 Rev 4、Rev 3、Rev 1）；
  2. 可视化查看段落增删 Diff（红色删除线、绿色新增高亮）；
  3. 点击「恢复此版本」可安全回滚正文并同步更新磁盘数据面。

### 2.3 检视塔四枢纽审查与敏感词体检 (Inspector Stack & Compliance)
- **场景**：作者在移动端核验设定一致性与平台违禁词。
- **验收标准**：
  1. 底部切换到「检视」导航，支持 Tab 切换：设定事实 (Story Brain)、装配看板 (Receipt)、变更影响 (Matrix)、质量审查 (Quality)；
  2. 设定事实区清晰呈现已确认正典 (Canon) 与主角视角认知 (Perspective)；
  3. 装配看板呈现 SHA-256 校验与 Token 消耗；
  4. 变更矩阵呈现跨章受损章节与一键重新穿透操作；
  5. 敏感词审查面板实时比对阅文/番茄平台敏感词库，反馈合规状态与架空机构名建议。

### 2.4 作品资产全景管理与多格式导出 (Works & Export Hub)
- **场景**：作者查看分卷进度，并导出稿件给编辑。
- **验收标准**：
  1. 底部切换到「作品」导航，展示字数、规划章数、实体卡统计三宫格；
  2. 呈现第一卷多章节目录列表与创作相位（定稿/细纲/待动笔）；
  3. 呼出「导出」抽屉，支持一键导出 Word (`.docx`)、纯文本 (`.txt`)、电子书 (`.epub`) 与 Markdown (`.md`)；
  4. 支持番茄/起点后台标准格式（自动首行缩进两全角空格、去多余空行、标点全角规范）一键复制。

### 2.5 资源端侧多源爬虫与对标拆解 (Resources & Crawlers)
- **场景**：作者检索热榜小说并一键提取正文进行对标分析。
- **验收标准**：
  1. 底部切换到「书源」导航，支持起点/七猫/番茄多源关键词检索；
  2. 呈现搜索卡片（书名、作者、榜单热度、简介）；
  3. 点击「导入拆解」触发后端 Crawl4AI 智能抓取并一键入库。

### 2.6 创作者账号与离线商业许可证 (Account & License)
- **场景**：创作者登录账号、同步多端数据或激活终身 Pro 密钥。
- **验收标准**：
  1. 顶部状态胶囊与系统中心展示创作者身份卡（@道玄先生，daoxuan@mozhou.ai）；
  2. 呼出登录抽屉支持邮箱/密码登录与注册切换；
  3. 呼出许可证抽屉支持输入 License Key 激活 Pro 终身权益。

---

## 3. Non-Functional & Ergonomic Requirements

1. **去 AI 味与视觉质感**：
   - 严禁堆砌无意义的大写英文口号与廉价 Emoji；
   - 统一采用 1.6px 细笔触的现代 SVG 线性矢量图标；
   - 采用深邃的物理流动水墨 Canvas 背景与 Double-Bezel 铝晶物理卡片圆角。
2. **移动端触控规范**：
   - 所有按钮、标签与选择项必须满足 `>= 44px` 防误触尺寸；
   - 支持移动端半屏抽屉手势滑出与点击空白关闭；
   - 底部 5 大 Tab 导航采用磨砂玻璃背景（`backdrop-filter: blur(24px)`），适应 iOS 底部安全区。
3. **软键盘与视口避让**：
   - 悬浮写作船坞输入时动态监听 `visualViewport`，确保输入法弹出时不遮挡输入区域。

---

## 4. Key Entities & Data Mapping

- `BookInfo`: `{ root, bookId, title, chapterCount }`
- `ProseChapter`: `{ chapterIndex, title, prose, wordCount, revision }`
- `WritingGoal`: `{ targetWords, currentWords, streakDays }`
- `VersionSnapshot`: `{ revision, timestamp, summary, diffLines }`
- `StoryBrainFacts`: `{ canon: TemporalFact[], perspective: KnowledgePerspectiveEntry[] }`
- `ChangeMatrix`: `{ traversals: ImpactRecord[], chapterStatuses: Record<number, string> }`
- `Membership`: `{ planName, licenseKey, expiresAt, features }`
