# INK_REALM_COVERAGE_REPORT.md — §32 Design Acceptance Matrix 逐项验收

> **实现状态同步（2026-09-13 · /code-review 两轴发现修复完毕）**
> 门禁实测（写入前即时复跑）：**apps/web 231/231 测试全绿（36 文件）+ typecheck 0 错 + 0 cycles**。本轮修复对应两轴审查发现：
> **Standards 轴**：①原型类名回归 live CSS（.badge 族/.btn-sm/.row-evidence+.em/.note/.input 补进 ink-realm.css——硬违规清除）②桌面三 Sheet（场景/工具/能力详情）接共享 useSheetA11y：Escape+焦点入面板+Tab 困拢+焦点返回（SceneSettingsSheet 原双份 Escape 处理合并）③SlashCommandMenu 去除 onBlur 关闭（Tab 不再误关），Escape+外点关闭，菜单项 hover 改 CSS 类（.ir-menu-item，Bubble 同步）④管线 done/failed 增加 ✓/× 文本线索（状态不再只用颜色）⑤JS hover 去重、parentDirOf 抽 shell/paths.ts、InspectorSummary/StageState/quality 形状单一出处化、chapterDraftKey 内联清除、--world-gap/--ir-r-md/--ir-sheet-t 定义、交互金/玉描边 token 化（场景画法字面量按 ADR 保留）。
> **Spec 轴**：①图标统一 18px/1.4 stroke（TopBar+WorkbenchView）②场景「恢复默认场景（全局）」控件补齐（confirm 门）③桌面 Sheet 焦点返回（同 ②）④InkBackground/FluidInkBackground 死代码删除（ADR-0028"可选路径"以 git 历史为载体）⑤Mobile Scene 同会话跟随（mozhou:scene-refresh+storage 监听）⑥capabilityDetails.ts 抽独立模块（漂移注释+兜底 detailOf）。
> **正确性修复**：proseRoutes 补 `assertSafeBookRoot` + `plane.close()`（try/finally，句柄不泄漏）；DialogueStream「采纳进写作层」遇已有作者文本先 confirm（不静默覆盖）。
> **覆盖声明更正**：前块③"唯一一行级介入"表述不准——pipelineRoutes.ts 工作树同时载有用户先行的 LocalDataPlane 重构（非本设计改动）；本设计在该文件的介入仅 ENOENT 守卫 hunk。`graph:status` stale 系 cli/status.js:67 结构性判据（未提交即 stale），索引内容与本轮修复后磁盘逐文件一致。
> 门禁计数说明：231 而非 233——MobileChains 4 例并拆/场景 1 例断言迁移后总数微调，全绿口径不变。

> **实现状态同步（2026-09-13 · 二轮复验 91/100 后七项收尾完成）**
> 门禁实测（本块写入前即时重跑）：**apps/web 233/233 测试全绿（36 文件）+ typecheck 0 错 + 0 cycles**。七项收尾：
> ① **主权链闭环（P1）**：新增 `POST /api/chapter.prose.save`（proseRoutes.ts，挂 api.ts）——章缺失自动建章草稿、存在则 revision+1 原子覆写，phase 恒 draft（**绝不翻转 Commit**）；ProseEditorPanel 新增「落为当前章草稿（Accept → Active Draft）」金色按钮（成功后广播遥测刷新）；DialogueStream done 态新增「采纳进写作层（Accept → Active Draft）」——Candidate 文本写入 ch<N> 写作层缓存。链路语义：Candidate（流式候选）→ Accept（作者显式按钮）→ Active Draft（写作层/盘上草稿）→ Commit（质量门后管线）。黑盒 HTTP 集成测试 4 例（proseRoutes.test.ts：建章/递增覆写/400/quality 守卫）。
> ② **报告与事实一致**：上轮"225/225"系 CapabilitySquareView 契约锚点（data-capability-id）加入后未重跑 -u 所致——已核对快照 diff 属批准的卡牌墙结构变更，-u 对齐；本轮真实数字 233/233（新增 8 例：主权链 4 + 移动链路 4）。
> ③ **Quality 500 修复（P1/P2）**：/api/chapter.quality 对无章新书由 500 改为 200 no_review（pipelineRoutes.ts 外科守卫，仅该分支；黑盒测试断言）。注：该文件属用户未提交改动面，此为唯一一行级介入，已在此登记供审查。
> ④ **390 顶栏裁切（P2）**：≤420px Hub 头部动作钮图标化 + 允许换行（mobile-workbench-390.png 重拍实证，时光机完整可见）。
> ⑤ **错误书架截图（证据修正）**：mobile-system-shelf-390.png 重拍——现确为设置 Hub 书架展开态（真实 /api/library 行 + 当前书高亮 + 打开=library.open→onSwitchBook）；根因是 Mobile Shell Hub 由内部 state 而非桌面 view 驱动，已加 data-hub 锚点两段点击。
> ⑥ **新链路测试缺口**：新增 MobileChains.test.tsx 4 例（章节抽屉真实行+点章回调 / Composer inject 追加与幂等 / 书架行渲染+library.open→onSwitchBook）。
> ⑦ **DrawerSheet a11y**：Escape 关闭 + 打开焦点入面板 + Tab 循环困拢 + 关闭后焦点返回。
> **GitNexus 证据状态（如实）**：`analyze --pdg` 已在本块写入前重跑（42,931 nodes / 86,953 edges，Indexed commit = Current commit = b2a0930）；`graph:status` 仍显示 stale 系 **CLI 结构性判据**——`cli/status.js:67` 明文规定未提交改动即 stale（"a repo with uncommitted source changes is stale even at the same commit"）。在仓库所有者对其未提交工作（含 14 个先于本设计的 server/packages 文件）做出提交决策前，该标志无法转绿；索引内容本身与磁盘逐文件一致。
> 遗留登记：P2-4 遮蔽 demo（systemRoutes）与 P2-5 注册表颗粒拆分属服务端/user 决策项，未动。

> **实现状态同步（2026-09-13 · 晨审 78/100 CONDITIONAL PASS 后 §H 六项修订完成）**
> 正式实现已落地工作树（未提交）：切片 1 + FAIL 轮 6 项 + 晨审 6 项。晨审 §H 完成证据：
> ① Scene Focus X/Y 双滑杆 + 重置（scene-atmosphere-focus-1440.png）②Reading Slate 冻结进生产（`.reading-slate` + ProseEditorPanel 挂载 WorkbenchView；editor 6 组件全部去 indigo/zinc/blur/pulse/emoji → token 化；AI 选区动作无契约=诚实不可用；质量遥测条因 quality-engine 包根携 node:crypto 暂留插槽并明示）③Mobile 四链闭合（MobileChaptersDrawer 直读 /api/works 点章切章；SystemHub 书架直读 /api/library+/api/library.open 实化切书；ProseReadingFlow 载入真实章元数据+本地 Active Draft 缓存并明示非 Commit；PlotBranch 选择/灵感采用经 inject 管道真实回填 Composer，"采用灵感并返回写作"语义为真）④TensionSpark 词表纠正为 prepare→commit 八步 + 旧紫 #9d8dff → token ⑤DesktopToolModals 四工具从中央遮罩 Modal 改为右侧 non-blocking Sheet（无 scrim，Escape/收起关闭）⑥像素级截图验收落盘 `screenshots/`（8 张：1440/1280 工作台、技能广场 Hero Sheet、场景 Sheet、氛围 Focus、Mobile 工作台/章节抽屉/书架切书，均由 headless Chrome 对 dev server 实拍）。
> 另：P2-3 移动正文恢复可选（.mobile-viewport user-select:text）；测试 225/225 全绿 + typecheck 0 错 + 0 cycles；`/api/chapter.quality` 对无章新书返回 500 为服务端鲁棒性发现（UI 已诚实显示错误，路由属用户未提交改动面，未触碰）。
> 本文件以上"设计阶段"章节保留为历史轮次记录；当前状态以本块为准。

> **验收轮次记录**
> · **第 1 轮（本报告初版）**：本地自评 93/93 PASS。**用户验收裁决：CONDITIONAL PASS**——不接受自评口径，最终计数修正为 **PASS 86 / PARTIAL 3 / BLOCKED_BY_REAL_CAPABILITY 4 / MISSING 0**（PARTIAL=移动 InspectorHub tab 40px、移动 ResourcesHub 主交互 40px、触点 44px 门禁未真正达成；BLOCKED=Novel Breakdown / Rank Scan / Web Search / 移动 Quality 四项真实能力缺失）。另记录 P0×2（生产代码 truthfulness 矛盾，实现期修复）、P1×5、P2×3、P3×1。
> · **第 2 轮（验收修订轮，当前版本）**：按验收 §F 最小修订清单执行 5 项（GitNexus 刷新+delta / Scene 上传完整交互 / 世界感收敛 / 完整 Skill Square / Mobile 44px 清零），全部完成并附驱动验证证据；3 项 PARTIAL 的根因（40px 内联值）已清除。**本报告不自行宣布 PASS——冻结升级（CONDITIONAL PASS → PASS）由用户的短复审裁决。**
>
> 主规格：`docs/superpowers/specs/2026-09-12-mozhou-ink-realm-design.md` §32。
> 状态口径：**PASS**=该检查项在本设计包中有明确设计落点；**BLOCKED_BY_REAL_CAPABILITY**=设计已完成诚实 unavailable 态，真实能力本身被 truthfulness gate / provider 前提阻断（这是产品事实，不是设计缺陷）；**CODE_PRESENT_UNMOUNTED**=设计按实验/未挂载域保留位置，未画成上线；**DESIGN_DELTA_FOUND**=审计发现规格未覆盖/与现状矛盾的增量事实及处置。
> 证据链：`INK_REALM_SURFACE_MAP.md`（HEAD b2a0930 逐行追踪）→ 各原型页锚点。
> 原型目录：`apps/web/prototypes/ink-realm/`（index + 01–09 + assets/ink-realm.css + 本报告 + Surface Map + Design System）。

---

## Shell（7/7）

| §32 检查项 | 状态 | 设计落点 | 证据/说明 |
|---|---|---|---|
| Top HUD 全功能覆盖 | PASS | 03 · Top HUD | 品牌印+当前书 chip（Scene thumbnail）+今日码字诚实未接入+时光机/灵感/导出/敏感词（SVG 替代 emoji）+本地就绪；全部现状控件保留（Surface Map §1.2） |
| Scene System 入口 | PASS | 03（场景按钮）→ 02 全交互 | NEW_DESIGN_REQUIREMENT；右侧 non-blocking Sheet 四分区 |
| 17 项导航全部存在 | PASS | 03 · 左导航 | 5 组 17 项与 views.ts:19-58 一一对应；金脊选中态 |
| 8 步 Pipeline 全部存在 | PASS | 03 · Pipeline | prepare→commit 原词表；六态（selected/running/done/blocked/failed/unavailable）；selected≠executed |
| current book / no-book 两态 | PASS | 03（「无书态示例」切换钮） | 无书：chapterbar 置灰+InspectorEmpty 语义+stage 置灰；有书：完整工作台 |
| desktop 1440 / 1280 | PASS | 03（1440 网格）+ DESIGN_SYSTEM §14（1280 列宽契约） | 世界缝隙 8–12px；正式双视口浏览器验收图属实现阶段门禁（DESIGN.md §15.8 纪律保留） |
| mobile <768 五 Hub | PASS | 09 | 五 Hub 全数 + 抽屉 + 触点规则 |

## Workbench（12/12）

| 检查项 | 状态 | 落点 | 说明 |
|---|---|---|---|
| Create Book | PASS | 03 · 建书卡 | 单字段→POST /api/book；失败就地 role=alert |
| chapter navigation | PASS | 03 · Chapter Rail | NEW_DESIGN_REQUIREMENT：横向章轨（章序/标题/draft/committed/revision/wordCount 真实字段）；数字输入降级快速跳章；无缩略图数据不伪造封面 |
| DialogueStream question | PASS | 03 · qblock | Jade 提问块；q2 备选问题列为新增落点（契约已在） |
| choices | PASS | 03 · choice pills | 选择即时回填；answered 相位死状态在设计态机修正 |
| author answer | PASS | 03 · composer | 中性高对比，不做夸张气泡 |
| 9 capability skills | PASS | 03 · skill row | 恰 9 项原词表（DIALOGUE_CAPABILITIES）；Jade 选中语义 |
| style rail unavailable | PASS | 03 | 「未接入（V1 空态）」显式保留 |
| provider unavailable | PASS | 03 · unavailable 卡 | 结构化 blocker（预检 banner + PROVIDER_UNAVAILABLE 双路径）；非仅灰输入框 |
| draft streaming | PASS | 03 · AI CANDIDATE | 流式+caret+start 帧证据行（contextTokens/provider）；AI CANDIDATE 标签为新增 |
| draft done/error | PASS | 03（done）/ 09（inline error banner） | done 附「已流式落盘为 CH12 草稿」服务端真实行为；error 从 alert 改 inline（移动端 9 处 alert 同口径） |
| ledger refresh | PASS | 03 · ledger | Evidence Row 化；刷新禁用态（无书） |
| tool entry points | PASS | 03 · 4 工具 → 08 | history/inspiration/export/compliance 全数 |

## Quality（13/13）

| 检查项 | 状态 | 落点 | 说明 |
|---|---|---|---|
| no report | PASS（含 DESIGN_DELTA_FOUND） | 05 · 初载态 | **修复**：按服务端真实 `{status:'no_review'}` 三态建模；现状 no_review 误显 stale 已在设计纠正 |
| pass | PASS | 05 · PASS 卡 | 不做绿色 SaaS 分数卡 |
| blocking fail | PASS | 05 · NEEDS REWORK 卡 | blocking 列表只在状态脊暗红 |
| refused | PASS | 05 · REFUSED 卡 | 语义 provider 缺席 fail-closed |
| stale/current | PASS | 05 | stale 徽标+成因文案 |
| revision/hash | PASS | 05/03 | r3 · 9f2c1a77…（mono） |
| rework count | PASS | 05 | attempt 1/2 → 2/2 禁用「已达上限」；服务端 422 兜底 |
| blocking findings | PASS | 05 | ruleId(v)+evidence note+excerpt |
| advisories | PASS | 05 | 「建议，不阻断」区 |
| semantic reviewer unavailable | PASS | 05 | Gate 3 banner；attached 为缺省（无假徽标） |
| run review | PASS | 05 | 运行文学审查（AI Jade） |
| apply rework | PASS | 05 | 仅 blocking verdict 且未达上限时激活 |
| record correction | PASS | 05 | 10 原因下拉+note 只留本机+已记录态 |

## Story Brain（8/8）

| 检查项 | 状态 | 落点 | 说明 |
|---|---|---|---|
| 5 entity classes | PASS | 05 | 人物/物品/地点/势力/概念（EntityRef 五冻结命名空间） |
| entity filter | PASS | 05 | 点击过滤/再点取消；subject=null 可见性注记 |
| outline tree | PASS（含 DESIGN_DELTA_FOUND） | 05 | 总纲→卷→**arc→章**（arc 层为审计新增落点）；当前章高亮 |
| canon | PASS | 05 | 主角 POV 授权通道标注 |
| suspects | PASS | 05 | 仅 kernel presentation，秘密值零泄漏（ADR-0026） |
| believes | PASS（含 DESIGN_DELTA_FOUND） | 05 | holder 视角行为设计新增（数据已有未渲染） |
| invalidated | PASS | 05 | 失效认知·引用已否决事实 |
| empty/error/loading | PASS | 05 | 三区空态全量+单点错误+分区 loading 设计（现状仅全局刷新文案） |

## Receipt（9/9）

| 检查项 | 状态 | 落点 | 说明 |
|---|---|---|---|
| list | PASS | 05 | receiptId/ch/tok/hash 四字段全渲染 |
| selection | PASS | 05 | aria-pressed 选中行；刷新失效提示为新增 |
| hash match/mismatch | PASS | 05 | mismatch 显式红（INV-R6 sha256 复算真值） |
| budget 4-part | PASS（含 DESIGN_DELTA_FOUND） | 05 | reserved/story/fixed/slack+cap；recall_filter 对账脚注为审计新增 |
| entry included/excluded | PASS | 05 | exclusion reason 全展示 |
| Replay Inputs | PASS | 05 | tokenizer/config/candidates/digest 四格+assembledBy/taskType |
| resume open | PASS | 05 | sessionOpen 绿点+currentStep+lastReceiptId+回工作台 |
| committed | PASS（含 DESIGN_DELTA_FOUND） | 05 | committed 分支；resume.finished 语义修复 |
| no-session | PASS | 05 | 「无开放生产会话」分支 |

## Change Matrix（5/5）

| 检查项 | 状态 | 落点 | 说明 |
|---|---|---|---|
| three cell states | PASS | 05 | needs_rework/resolved/not_affected（红/绿/—+文本标签） |
| stale total | PASS | 05 | stale {n} 徽标 |
| traversal details | PASS（含 DESIGN_DELTA_FOUND） | 05 | traversalId/taskRef/trigger/recordedAt/upstream；**revisionBriefs 重写任务书为最大新增落点**；upstream revision 显示为修复 |
| rerun enabled/disabled | PASS | 05 | 仅 stale 行；全局单飞 |
| empty/error/loading | PASS | 05 | 空态+alert+busy |

## Works / Library / Resource（12/12）

| 检查项 | 状态 | 落点 | 说明 |
|---|---|---|---|
| works metadata/stats | PASS | 04 | 五统计+元数据；genres 空显示「通用网文」不虚构 |
| outline | PASS | 04 | 节点 type/status；0 节点空态文案修复 |
| chapter list | PASS | 04 | phase/wordCount/revision |
| bookshelf scan | PASS | 06 | 刷新书库/扫描中 busy |
| skipped warning | PASS | 06 | 显式提示；path+reason 收进 disclosure（增强） |
| local import | PASS | 06 | 书名输入+零外部抓取标注+409 冲突 |
| open/current | PASS | 06 | 当前打开禁用态+gold 徽标 |
| book source text search | PASS | 06 | 多源并发（起点+七猫）；degraded notes 上墙（修复） |
| URL crawl | PASS | 06 | crawl4ai/HTTP 双通道标注；initialBody→第一章 |
| crawl preview | PASS | 06 | 300 字摘录+channel 徽标 |
| real result vs local sample distinction | PASS | 06 | REAL SEARCH RESULT / CRAWLED WEB CONTENT / LOCAL PRESET 三种卡形态+独立分区 |
| capability square 4 statuses | PASS | 06 | native/provider_required/configuration_required/external_source_required 全量+evidence 行；detail Sheet 为新增 |

## Other views（9/9）

| 检查项 | 状态 | 落点 | 说明 |
|---|---|---|---|
| tasks + filters + traversal audit | PASS | 06 | 事件流水+四过滤+traversal 列表；canon/system 死标签移除；taskRef/upstream 为新增落点 |
| style sample metrics | PASS | 04 | 五指标+字数/均句长，真实计算语义 |
| sepia score / tells | PASS | 04 | Pass1/2/3+aiTellsSummary |
| current style profiles | PASS | 04 | 四场景 r{revision}+null 引导卡 |
| novel breakdown unavailable current state | PASS · BLOCKED_BY_REAL_CAPABILITY | 04 三态 | 501 NOVEL_BREAKDOWN_NOT_IMPLEMENTED 真实文案；FUTURE DATA LAYOUT 明示 |
| rank scan unavailable current state | PASS · BLOCKED_BY_REAL_CAPABILITY | 06 | 501 RANK_SOURCE_NOT_CONFIGURED；**「本地内置数据源」矛盾徽标删除（DESIGN_DELTA_FOUND）** |
| web search unavailable current state | PASS · BLOCKED_BY_REAL_CAPABILITY | 06 | 501 WEB_SEARCH_NOT_CONFIGURED；死分支/死徽标处置 |
| cloud local-ready vs cloud-unavailable | PASS（含 DESIGN_DELTA_FOUND） | 06 | localReady 驱动徽标（修复硬编码）+syncState 诚实文案上墙+backup 恒 501 显式 unavailable |
| membership free vs future plan | PASS | 06 | license null 真实态+规划中 plans+无购买/激活假按钮 |

## Auxiliary / Latent（9/9）

| 检查项 | 状态 | 落点 | 说明 |
|---|---|---|---|
| Wizard 5 steps | PASS（含 DESIGN_DELTA_FOUND） | 07 | 建书/世界观/大纲/首章/连写；每步一个决策；进度脊柱；Back/Close/Replay；**删除断线提示（OutlineNodeScan 无据暗示）**；后四步=收集输入不暗示已写入 Canon |
| inspiration local presets | PASS | 08 | 4 骰 LOCAL PRESET 卡牌化；零 AI 生成声明 |
| history unavailable | PASS | 08 | 诚实卡 |
| compliance unavailable | PASS | 08 | 诚实卡 |
| export mainline unavailable | PASS | 08 | 诚实卡（export-suite 不越位） |
| advanced editor system retained | PASS · CODE_PRESENT_UNMOUNTED | 08 | Reading Slate 10% 形态+bubble/slash/diff 三重编码语言；9 文件 INTEGRATION PENDING 标注 |
| Canon Graph marked experimental/mock-bound | PASS · CODE_PRESENT_UNMOUNTED | 08 | mock nodes 事实声明+低饱和拓扑+Jade/Gold contract edges 方向 |
| Genre Kits marked code-present / integration pending | PASS · CODE_PRESENT_UNMOUNTED | 08 | apply 按钮禁用直至持久化契约；Narrative Kit 子域不另起商店 |
| export-suite format capability not overstated | PASS · CODE_PRESENT_UNMOUNTED | 08 | TXT/DOC 真实能力 vs EPUB fallback 不得标完整封装——格式能力档案表 |

## Mobile（9/9）

| 检查项 | 状态 | 落点 | 说明 |
|---|---|---|---|
| WorkbenchHub | PASS（含 DESIGN_DELTA_FOUND） | 09 · Phone 1 | 真实件升主位（书/PlotBranch/Composer 流式）；今日码字诚实卡；TensionSpark/ProseReadingFlow 显式未接入；**choice 回填 Composer、skills 显式标注**（修复断线） |
| InspectorHub | PASS（第 1 轮 PARTIAL：tab 40px → 修订轮已修复） | 09 · Phone 2 | facts/receipts/matrix 三真实加载；四个 tab 接入 `--touch-target-min`，44px 达标 |
| WorksHub | PASS | 09 · Phone 3 | 五统计+章行+加章禁用+distill 占位 |
| ResourcesHub | PASS（第 1 轮 PARTIAL：主交互 40px → 修订轮已修复） | 09 · Phone 4 | 检索+提取+零结果诚实态；「提取正文→导入」接入 token，44px 达标 |
| SystemHub | PASS（含 DESIGN_DELTA_FOUND） | 09 · Phone 5 | 授权档案+任务计数+云未接入；**切书行接线修复** |
| drawers | PASS | 09 · Phone 6 | 1 真 7 诚；Bottom Sheet 统一规格（handle/close/focus/reduced-motion） |
| mobile quality unavailable truthfully | PASS · BLOCKED_BY_REAL_CAPABILITY | 09 · Phone 2 | 原文诚实卡全保留 |
| touch targets | PASS（第 1 轮 PARTIAL → 修订轮已修复并 token 化） | 09 + DESIGN_SYSTEM §8.1 | `--touch-target-min:44px` 单一 token；blanket 规则覆盖 .btn/.pill/.choice/.ptab；grep 审计 0 残留（<44px 交互目标） |
| figure layer default off | PASS | 09（全机无 Figure 层+注记） | veil 加重至 .68 |

---

## 汇总

- **§32 全部 93 项**：Shell 7 · Workbench 12 · Quality 13 · Story Brain 8 · Receipt 9 · Change Matrix 5 · Works/Library/Resource 12 · Other views 9 · Auxiliary/Latent 9 · Mobile 9 —— 每项均有设计落点。**两轮口径**：第 1 轮自评 93 PASS（被验收修正）；验收最终计数 **PASS 86 / PARTIAL 3 / BLOCKED 4 / MISSING 0**；修订轮已清除 3 项 PARTIAL 根因（40px 内联触点）并补齐修订清单全部 5 项，冻结升级待用户短复审。
- **BLOCKED_BY_REAL_CAPABILITY**（4 项，与验收计数一致）：Novel Breakdown / Rank Scan / Web Search（501 fail-closed，三态设计）+ 移动端 Quality（未接入，诚实卡）。
- **CODE_PRESENT_UNMOUNTED**（5 域 19+ 对象）：Advanced Editor 9 文件 · FloatingInspirationDrawer（含 mock 回复，禁止入产品）· Canon Graph（mock-bound）· Genre Kits · Export Suite · GoalProgressWidget · MoZhouApiClient SDK · InspectorPlaceholder · 服务端 demo 路由三套 · session.open/advance 无 UI · questions[2]/start 帧/unavailable 事件/answered 相位等契约级死件 —— 全部在设计包中保留位置且明确标注，无一冒充上线。
- **DESIGN_DELTA_FOUND**（14 条，全量登记于 Surface Map §10）：QualityPanel 初载契约失配、无 accept/AI CANDIDATE 契约、Wizard 无据暗示、RankScan/WebSearch 501 态矛盾徽标、degraded/localReady 未消费、revisionBriefs/resume.finished 未渲染、StoryBrain arc/holder 缺失、移动端 9 处 alert/断线组件/触点不足/缺发行 CSS/正文不可选、dialogue=Placeholder、pipeline 无 UI 消费会话端点、桌面无编辑器挂载、GET /api/membership 探活、genres 空兜底 —— 每条已给出设计态处置并在原型中体现。

### 验收修订轮执行证据（对应验收 §F 五件事）

| §F 修订项 | 执行结果与证据 |
|---|---|
| 1. GitNexus 刷新 + Surface delta | `run.cjs analyze` 全量重建（17:58，27.3s）；Indexed commit=Current commit=b2a0930；工作树 14 个修改文件与首轮审计同集合；`canonical-recipes.ts` 经查为既有 `createDraftRecipe` 的 runtime re-export，无新路由/UI → **Surface Map 零增量**（Surface Map §11）。终轮 `--pdg` 重建见 §11.2 |
| 2. Scene 背景人物替换完整交互 | 02 页新增真实 `input[type=file]`×2 + 格式/尺寸预算（8MB/4MB）/最低分辨率（1280/600px）校验 + 缩略图预览 + 替换/移除 + objectURL 生命周期回收 + 三类错误态。**驱动验证 5 路径全过**：gif→格式错误态、64×64→分辨率错误态、1920×1080→预览+应用（meta 显示 1920×1080·1.54MB·PNG）、800×1100 透明人物→应用、移除→回退内置+天际线恢复 |
| 3. 世界感收敛 | 场景画层重构（主体带 `::after` 化）+ 四场景亮度整体跳档（夜空 #0b1826→#35688a、月亮/地平线光晕/窗灯可辨、02 默认验收截图通过）；氛围暗角 .62→.40；03/04/06 veil 降档；人物剪影增辉；**Inspector/证据塔/正文未增加任何装饰**（P1-3 的克制要求） |
| 4. 完整 Skill Square | 新增 10-skill-square.html：17/17 真实注册表（label/description/status/evidence 逐字取自 systemRoutes.ts:11-156）+ 5 组节奏 + 单选 hero + 可操作 detail Sheet（描述/证据/启用前提/真实不可用原因/动作契约/视图落点）。**驱动验证**：17 卡计数、rank-scan→真实 501 语义、workbench→native 隐藏不可用区、单选态，全部通过 |
| 5. Mobile 44px 清零 | `--touch-target-min:44px` 进 token 层；09 页 9 处接入 + blanket 规则（.btn/.pill/.choice/.ptab）；修复 `.tools-row .pill` 32px 覆盖缺陷；grep 审计 **0 个 <44px 交互残留** |
| （附加）P2-1 1280 拥挤 | 03 页 ≤1360px：辅助列折叠为「辅助 ⌄」Sheet、右塔 392→340、中栏让宽；1280×900 渲染截图确认 |
| （附加）P2-2 交互深度 | 06 补 Skill Square 指针页交互；10 页全交互；08/09 保持高保真规格板定位（验收已认可「对设计交付够用」） |

- **诚实性红线自查**：原型中所有样例数据带 `DESIGN FIXTURE` 徽标；灵感/样例带 `LOCAL PRESET`；未接入能力带真实 unavailable 文案+错误码；Skill Square detail 全部为注册表/服务端真实语义，17 项均无 enable/apply 假按钮；Scene/Figure 为 CSS 合成占位（无任何游戏版权资产）；无紫蓝渐变默认主色；正文区 Reading Slate 10% 沉浸。
- **本阶段边界**：仅设计。未修改 `apps/web/src` 生产代码、后端、数据库、domain package；未安装依赖；未 commit；全部产物隔离于 `apps/web/prototypes/ink-realm/`（GitNexus 索引重建为其索引目录自身的预期写入，已由验收 §F-1 授权要求）。

## 交付物清单

| 文件 | 内容 |
|---|---|
| INK_REALM_SURFACE_MAP.md | HEAD b2a0930 全量追踪矩阵（Shell/17 视图/Inspector 四域/Workbench/Wizard/辅助/Mobile/隐性子系统/40 路由/14 条 DESIGN_DELTA） |
| INK_REALM_DESIGN_SYSTEM.md | Token/材质/排印/色彩语义/卡牌/按钮/状态/动效/可访问性/响应式 + Ink Orbit 迁移映射 |
| assets/ink-realm.css | 设计系统可运行实现（原型共享） |
| index.html | 原型总览+图例 |
| 01-token-board.html | Token board（色彩/材质/排印/卡牌/按钮/状态/六态管线/动效/强度表） |
| 02-scene-system.html | Scene System 交互原型（三层解耦+Sheet 四分区+实时预览+作用域） |
| 03-desktop-shell.html | Desktop 1440 旗舰（Top HUD+17 导航+8 步六态+Workbench 全协议+Evidence Tower 四域+双书态） |
| 04-views-creation.html | 写作对话落点/我的作品/风格蒸馏/小说拆解三态 |
| 05-views-inspector.html | Story Brain/装配看板/变更矩阵/质量门中心页（含质量四态切换） |
| 06-views-resources.html | 任务中心/书源搜索/书源书架/技能广场/扫榜/联网/云同步/会员 |
| 07-wizard.html | Wizard 五步交互（含建书失败就地呈现演示） |
| 08-aux-latent.html | 灵感工坊/三 unavailable 工具/Advanced Editor/Canon Graph/Genre Kits/Export Suite/移动死件处置 |
| 09-mobile.html | 五 Hub+抽屉六机位（Figure 默认关/veil 加重/44px token 化） |
| 10-skill-square.html | 完整技能广场：17 项真实注册表全上墙 + 4 状态 + evidence + 可操作 detail Sheet |

> 设计阶段到此停止。在用户明确批准前：不修改生产 UI、不重构组件、不安装依赖、不替换 Tailwind/Vite/React、不新增后端接口、不更新 ADR 为已实施、不 commit/push 生产实现。
