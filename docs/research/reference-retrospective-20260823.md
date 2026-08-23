# 墨舟 Novel OS 2.0 · 参考项目深度复盘报告

- **日期**: 2026-08-23
- **性质**: ADR-0018 **Gate A（需求保真门禁）** 的输入件 —— 在写码前把立项参考标准（OpenWrite / jarvis-write / 天命）的真实成色与失败模式冻结为可执行结论
- **方法**: 4 路并行源码深审（jarvis-write / tianming / openwrite 各一路 + 本地 novel-ai 正面基线一路）× 委托方 Obsidian 历史 15 篇语料交叉 × 主审人一手抽验
- **与前作关系**: 补充 `C:\zcode\novel-ai\docs\novel-four-project-acceptance-matrix-2026-08-16.md`（该矩阵覆盖 DeterminFlow/ArcReel/inkos/oh-story 四项目 + OpenWrite 逆向 §7），本报告覆盖墨舟 2.0 立项材料新点名的三个 GitHub 参考

---

## 0. 结论速览

**总判：三个参考项目没有一个"全烂"，但烂法各异，且在同一个地方集体失守——确定性约束引擎缺失或不彻底。这恰好是墨舟 18 篇 ADR 押注的位置，差异化空间成立。**

| 项目 | 工程执行 | 领域设计 | 唯一真矿 | 致命伤 |
|---|---|---|---|---|
| jarvis-write | ★★★★☆ 扎实（541 测试） | ★★★★☆ 时序事实模型 | 任务级模型路由 + 测试纪律 | 约束全建议性、级联 30 章封顶、6-9 次 LLM/章 |
| openwrite v5.8.0 | ★★★☆☆ 中上 | ★★★★☆ Skill 双轨+事务章节 | runtime_skills 协议、pin-commit 炼化、隐私零遥测 | 文档层伪协议漂移、关键词压缩丢因果 |
| 天命 | ★☆☆☆☆ 烂（零测试） | ★★★☆☆ 账本式一致性 | 37 套题材化提示词资产 | 卡密侵入内核、ServiceLocator×962、盗版爬虫 |

**对委托方预设的诚实修正**: "他做得很烂"对天命完全成立；对 jarvis-write 与 openwrite **不成立于工程执行层面**——它们的失败是理念落地后的结构性天花板（约束建议化、检索放弃、成本失控），而非烂尾。墨舟要赢的不是它们的执行质量，而是它们没敢做的确定性引擎。

---

## 1. 身份澄清（防止张冠李戴）

### 1.1 「OpenWrite」同名不同物 ⚠️ 关键发现

| | vault 逆向的 OpenWrite | GitHub LiPu-jpg/Openwrite |
|---|---|---|
| 形态 | Flutter 桌面/移动客户端（`app.so` 12MB Dart AOT） | Python ≥3.10 Agent 工作台 |
| 版本 | v1.3.2（闭源发行包） | v5.8.0（开源仓库） |
| 后端 | PHP API（103.126.101.8:4650 明文 HTTP）+ New API 网关 + 发卡 VIP | 本地 Python 进程，Apache-2.0 |
| 证据 | OB `20_Knowledge/AI/OpenWrite v1.3.2 Windows 客户端逆向（2026-08-09）.md` | 克隆仓 grep 无 openxz/flutter/发卡痕迹；最后提交 2026-08-11 |

**结论**: 二者共享品牌名但技术血统无交集。vault 里"明文 HTTP/本地 VIP 字段/Skill 供应链"等安全反面教材**只适用于闭源版**，不能自动扣到 GitHub 开源版头上；反之亦然。本报告对两者分别评价。

### 1.2 三参考仓技术栈实锤

| 项目 | 栈 | 体量 | 许可证 | 商业模式信号 |
|---|---|---|---|---|
| jarvis-write | Python(FastAPI/SQLAlchemy, ~27k 行后端) + frontend + Tauri 壳 + docker-compose | 432 文件/13M | Apache-2.0 | 无卡密；invite_code 表存在 |
| tianming(天命) | .NET 8.0 + WPF（1926 个 .cs + 302 xaml） | 2989 文件/510M | **无标准 LICENSE**，仅《开源说明.md》 | 卡密授权制商业系统开源版 |
| openwrite | Python ≥3.10（pyproject/uv.lock，skills/tools/craft/models/integrations） | 595 文件/15M | Apache-2.0 | README 致谢 Linux DO 社区 |

---

## 2. jarvis-write 深评

**主审人一手预验**（防分身报告失真的锚点）：
- `backend/app/schemas/canon.py`: 故事宪法 Canon = absences（刻意留白）/devices（常驻装置复现义务）/deadline（结构化倒计时）三类书级恒真声明；docstring 明确记载「窄窗机制」失效病例（圣经只对本章 characters_involved 注入→第 8 章滑出窗口）；纪律「LLM 只提议走建议通道人工确认，绝不自动落库」
- `db/models/`: story_bible / foreshadowing / chapter_state / outline / summary / writing_card 等 18 张表，事实库是结构化存储非 markdown 糨糊
- `engines/{cascade,consistency,drama,polish,drift,tendency,pipeline}` 七引擎目录 + `pipeline/chapter.py` 876 行主链路

### 2.1 项目速览

后端 FastAPI + SQLAlchemy 2 + SQLite 单体（约 2.9 万行），前端 React18 + Vite + TS（约 1.8 万行），Tauri 壳拉起 PyInstaller 后端子进程（`src-tauri/src/lib.rs:1-3`）。docker-compose 单服务单容器。工程纪律远超"烂项目"预期：后端 60 个测试文件 **541 个测试函数**，前端 `any` 仅 3 处，全库 TODO 仅 1 处。

> **核心判定：委托方"它做得很烂"的前提不成立——这是执行相当扎实的项目；真正的问题在理念落地后的结构性天花板，而非工程烂尾。**

### 2.2 三大件真实成色

- **故事圣经：真·结构化。** Fact 表带 `valid_from/valid_until` 时序区间 + importance 分级（`db/models/story_bible.py:39-63`），时序 Relationship 边 + KnowledgeState"谁知道什么"表；"第 N 章角色状态"是真 SQL 区间查询（`bible.py:80-106`）；重写前 purge 并重开区间防记忆污染（`bible.py:241-304`）。
- **伏笔调度：结构化但调度逻辑薄。** 四态 + expected/earliest_payoff 真实存在（`foreshadowing.py:19-38`）；所谓"调度"只是 `expected <= 当前章+2` 过滤加 prompt 提醒；状态流转靠章后 LLM 上报按描述字符串三级模糊匹配，作者自认"宁漏勿错"（`foreshadow.py:65-113`）。
- **大纲级联：规则粗筛 + LLM 精判，非确定性依赖图。** 影响分析 = 改动摘要 + **最多 30 章**下游大纲喂 LLM 判断（`impact.py:22,69-92`），30 章外明文"由用户手动处理"；级联只标正文 `is_stale`，**重写仍需用户逐章手动**。
- **共性病灶：三大件全是"结构化存储 + prompt 注入 + LLM 事后审判 + 人工裁决"，没有一条约束是引擎强制的。** 圣经约束只是草稿 prompt 里的一段文字（`chapter.py:462`），违规靠另一个 LLM 门禁事后发现。

### 2.3 架构亮点（值得尊敬的部分）

LLM 层是全项目最精细处：17 类任务各自路由模型档位/温度/max_tokens 三张表（`llm/router.py:47-110`）；指数退避重试；per-user key Fernet 加密落库；SSRF 防线拦私网 base_url；token 用量逐调用落库。主动砍掉向量 RAG 并在 docs 记录原因——诚实的架构决策。测试纪律是这套复杂管线没崩的真正根因。

### 2.4 失败模式清单（带证据）

1. **约束全是建议性**：prompt 可被无视；门禁本身也是 LLM 判断，仅靠"举证逐字命中否则清空"防幻觉（`checker.py:77`）。"控"最终落在人身上。
2. **放弃检索，长程记忆有天花板**：早期 6 个 Chroma 集合整体移除（`docs/03-engines.md`）；软上下文=滚动摘要+最近 2 章；硬事实最多注入 40 条超限截断（`bible.py:23,137-142`）。没进圣经的细节第 50 章后必然丢。
3. **级联影响 LLM 猜 + 30 章封顶**：改第 2 章对第 80 章的影响系统失明；失配正文人肉逐章重写——"改得动"只做到"知道哪要改"。
4. **单章成本高**：一章 ≈ **6-9 次 LLM 调用**，百万字书 ≈2000+ 次；抽取/契约钉死强档（`router.py:52-53`）。
5. **圣经写回是单点污染源**：purge 重开区间靠 `valid_until==n-1` 启发式（`bible.py:269-277`）。
6. **进程内任务不持久**：asyncio task 存内存 set 重启即丢（`jobs.py:186-198,221`）。
7. **开书摩擦重**：五步向导 + 架构四连调 + 全书蓝图增量生成才写到第 1 章。
8. **前后端契约手写无类型生成**：`api.ts` 手写 1078 行 90 个导出。

### 2.5 对墨舟的避坑建议（jarvis-write 篇）

1. **别把控制层当约束引擎卖**：LLM 约束只能"prompt 建议+事后审计+人裁决"。墨舟应把能确定性校验的（时间线单调、数值断言、结构化 diff）做成硬引擎——这是与 jarvis 拉开差距的最大机会。
2. **Dependency Manifest 必须确定性**：边在写入时建好，影响分析走图遍历全书覆盖；LLM+30 章上限方案在长篇必然失明。
3. **检索与结构化双轨**：Temporal Canon Graph 应配 embedding 检索兜"圣经外的细节"，别学砍 RAG 的成本妥协。
4. **先算清单章 token 预算再定审计链**：6-9 调用/章是日更作者的账单悬崖，审计链做轻/全两档可配。
5. **级联的终点是正文不是报告**：失配章批量重写+断点续跑要做成一等公民。
6. **写回闭环带操作日志**：每条事实记 source+变更史支持任意章回滚。
7. **本地优先就别背多用户包袱**：JWT/邀请码/SSRF 都是公网试用逼出来的，单机直接砍掉；Tauri+本地服务进程壳方案可抄。
8. **测试基线与 ADR 同步冻结**：同级管线复杂度没有 500+ 测试密度就是下一个烂尾。
9. **开书渐进化**：允许"先写第 1 章再补圣经"。
10. **BYOK+任务级路由+用量埋点整套照抄**（与 novel-ai 补课清单互相印证）。

---

## 3. Openwrite（GitHub v5.8.0）深评

### 3.1 真实形态

浅克隆仅 1 个 squash 提交（2026-08-11），演进史不可考。tools/ 约 **56,600 行 Python**（205 文件）、tests 约 25,900 行、Studio Web UI（114KB HTML + 147KB CSS + 6 个 JS 模块）。远超"prompt 合集"：**自研 ReAct 循环**（`tools/agent/react.py:184`，max_turns=20，带工具失败参数修复、截断重试、token 预算自适应），LiteLLM 做 provider 中立封装（非 langchain）。多 Agent 分工：Goethe 长会话规划 / Dante 编排写章 / Writer、Reviewer、Director 子角色（`orchestrator.py:49`）。

### 3.2 Skill 化架构评价（墨舟 Skill 广场最直接前例）

**双轨技能体系，成熟度悬殊：**
1. **运行时层 `tools/runtime_skills/`**（真功能）：manifest.yaml 声明 schema_version/id/agents/**allow_tools/budget**（max_instruction_chars/max_reference_chars/max_tool_calls），builtin→global→project 三层解析（`resolver.py:46`），pydantic 强校验。
2. **文档层顶层 skills/（12 个）**：面向外部宿主（`workflow_scheduler.py:12` 明言实际调用由 OpenCode Agent 按 SKILL.md 执行）。但示例用 `[COMMAND] tool {json}` 伪协议——**全仓库无任何解析器**，与运行时原生 function calling 已脱节。

最亮眼的**拆文炼化合规先例**：oh-story-* 九技能改编自 worldwonderer/oh-story-claudecode，尾注 pin 上游 commit 48a4789、保留 MIT LICENSE、重写边界段适配本地约定——正是墨舟"Skill 广场→炼化"的完整参照。

### 3.3 长篇一致性方案

多层真实机制：src/（大纲唯一真源+author_intent）/data/（运行态）双层分离；真相三件套 current_state/ledger/relationships + 快照回滚（`truth_manager.py:14,295`）；**写章=事务单元**，失败恢复快照（`chapter_pipeline.py:947,1034`）；伏笔 DAG 含环检测；行内状态批注 DSL `//**A[维度]:旧->新**` 且冲突时**正文事实优先于大纲计划**（`character_state_index.py:82-110`）；LightRAG 图检索（embedding 可走本地 fastembed 但实体抽取强制在线 key，`project_search.py:175`）；渐进压缩 L1-L4。

**短板**：节/篇级压缩是**关键词抽取规则引擎**（自述 `progressive_compressor.py:225`），靠"突然/然而/死"打分选段——百万字尺度因果链必丢，"200 万字→5 万字"宣传口径高于实现。

### 3.4 失败模式清单

1. 文档层 `[COMMAND]` 伪协议零解析器，技能与执行脱节
2. 关键词式长程压缩丢因果（`progressive_compressor.py:236-260`）
3. **确认门靠中文关键词判断"用户已确认"**（`confirmation.py:29-45` 否定标记表），歧义语句可误放行
4. 维度数漂移：文档串"33 维度" vs DIMENSION_MAP 实际 37 项
5. 上帝文件 studio_application.py（**4136 行/161 方法**）
6. 无 CI；requirements.txt 与 pyproject 缺项不一致；124 处裸 `except Exception`
7. LightRAG 实体抽取强依赖在线 key，"纯本地搜索"不完整

### 3.5 可借鉴亮点

事务性章节提交；批注 DSL 及"正文事实>大纲计划"仲裁；budget 化 manifest + 三层解析；pin-commit 合规炼化；live_tests 三档分层 + 固定 QA 项目隔离制度；debug 输出递归脱敏；确定性 EPUB3 导出；**隐私干净：全仓库无遥测/analytics**，API key 仅环境变量不入项目/Git/Agent 上下文。

### 3.6 对墨舟的避坑建议（openwrite 篇）

1. Skill 协议以 runtime_skills 的 manifest+budget+分层解析为蓝本，预算字段直接进广场协议
2. 拆文炼化必须 pin 上游 commit + 保 license + 重写边界规则
3. **文档层/运行时层技能必须同源生成**（manifest 渲染出文档），杜绝伪协议漂移
4. 一致性栈组合（真源分离+truth 快照回滚+伏笔 DAG+批注 DSL）值得整套移植，压缩改 LLM 摘要
5. 章节写入=事务单元，任一环节失败整体回滚
6. 确认门用结构化 token/UI 按钮，禁自然语言关键词匹配
7. "无遥测 + key 不落盘 + 日志脱敏"写成产品承诺——对网文作者是硬卖点
8. UI 服务层按 action surface 模块化，避免 4 千行上帝类在 TS 里复现

---

## 4. 天命深评

> 委托方"做得烂"直觉在本项目上**完全成立**（工程层面），但它埋着两座真矿。

### 4.1 项目真相

.NET 8.0 + WPF（仅 Windows），单工程版本 2.8.8，Microsoft Semantic Kernel 编排，内置两个本地 ONNX 模型（bge-small-zh 向量检索 23MB + roberta-tiny 仿人化选词 5.9MB）。**236,899 行 C#，与墨舟 Next.js+TS 完全异构，代码不可移植，只有领域设计可参考。** 仓库卫生灾难：732MB 中 `.git` 223MB、Core 421MB 主要是入库的 bin/obj 构建产物（174 个 DLL、重复 ONNX、甚至运行时日志）；`1.4.6-天命/` 目录名与内部徽章 Version 2.8.7 脱节，两树约 40% 重复。商业化本质=卡密授权制 SaaS 客户端，开源版做了 example.com 占位清理（已验证属实）但整套授权协议代码原样保留。

### 4.2 架构评价

分层**名实部分相符**：Modules 直接穿透引用 Framework（95 文件）、Services 反向依赖 Modules（17 文件）；`Storage/` 0 个 .cs 却画进架构图充当一层——文件夹表演；**DI 是服务定位器反模式，`ServiceLocator.Get<>` 主审复测 962 处**（分身口径 547 仅计泛型形式，实际更严重）；全局静态日志无级别无结构；MVVM 名义下大量逻辑在 code-behind。

但核心创作链路**有真材实料**：`GuideContextService.ModuleExtractors.cs:199-290` 并行装配任务层/前章摘要/前章尾部/事实快照/卷里程碑/跨卷存档 + 状态漂移检测——全项目最有含金量部分；批量生成带字段约束与**实体候选白名单**（`ChapterViewModel.AIGenerate.cs:104-122`："出场角色必须从以下列表中选择，不得编造"）。

### 4.3 提示词资产评价（本项目唯一值得原样搬走的东西）

应用内嵌 **37 个模板**（真实路径：根 `Modules/AIAssistant/PromptTools/PromptManagement/Resources/built_in_templates/` + 根目录【角色定义+创作规范】导出副本 50 文件，均已验证存在）：25 题材 × 角色定义+创作规范、AIGC 润色 6 件套、拆书分析师/校验等角色提示词。以玄幻为例：SystemPrompt 千字级覆盖视觉奇观化/境界质变感/镜头快慢切换、"机缘场/越阶反杀场/势力踩人场"场景范式、第三人称限知细则、爽点情绪设计、三条明确禁忌（禁回合制战斗/禁西方魔法解释/禁圣母宽恕），并带可执行参数（目标字数 3500/段落 175/对话比 25%/题材化节奏模板）。**这是蒸馏过的网文行业工艺知识**，结构化 JSON 存储（Id/Category/Tags/Variables）、经 IPromptRepository 注入管线——可直接移植为墨舟 TS 数据文件。

### 4.4 失败模式与风险清单

1. **零测试**：23.7 万行无任何测试工程，一切效果宣称不可验证（含 README"3000 章依然连贯"）
2. **静默失败泛滥**：空捕获数百处量级（主审复测：单行空 catch 32 + 跨行空块 268）；`async void` 43 处异常不可观测
3. **盗版站爬虫默认值**：笔趣阁系 `shuquta.com/xheiyan.info/bqgde.de` 为拆书默认源（`BookAnalysisViewModel.Import.cs:318` 等，已验证）——法律风险明确
4. **卡密授权闭环残留**：订阅充值/feature_token 服务端验签/心跳质询数千行，二次开发者不重造签名服务端即为死重
5. 服务定位器 962 处 + 上帝基类（DataManagementViewModelBase 1232 行）
6. bin/obj 入库 + 单 commit 历史
7. 安全面尚可：PBKDF2-SHA256 十万次迭代、DPAPI 加密记住密码、纯 JSON 存储无 SQL 注入面

### 4.5 对墨舟的避坑建议（天命篇）

1. **只抄思想不抄代码**：把 GuideContextService 分层上下文当领域规格书读，用 TS 重写
2. **商业化与内核物理隔离**：绝不把授权检查散布进业务路径；未来收费做成外挂网关，内核离线完整可用
3. **账本先行**：事实/伏笔/时限约束作为一等 Schema（ADR 方向正确），勿后补成字符串拼接 Prompt 片段
4. **提示词=版本化数据文件+类型化变量**，37 套资产可移植继承
5. 禁 ServiceLocator、明令禁止空 catch 进 lint 规则
6. **禁爬虫默认盗版源**；导入功能让用户自带文本
7. 第一天上测试；bin/obj 永不入库；命名与语义版本一致

---

## 5. novel-ai 正面基线对账（分身报告已回收，摘要）

**工程底座 8/10**: strict TS 全库 `any` 0 命中；Drizzle 31 表/40 FK/35 迁移；chapters.revision 乐观锁；67 unit + 53 http/e2e ≈599 用例 + gate 三级门禁。
**链路完成度**: 建书/章节/流式对话/风格蒸馏回流/抽卡双模型并发/技能运行时/任务四表 ✅；扫榜半通；RAG 共现字符降级实现（pgvector 是口号）；**BYOK 仅枚举空壳**。
**应继承**: source-class 契约+mock 防火墙、runNode 校验-修复重试、任务四表+usage_ledger、Skill Runtime 六表、revision+候选生命周期、两层 payload 边界、测试金字塔、UI 对账锚点。
**必补课**: BYOK 真实化、三栏前必须引入状态库并拆 1303 行巨石组件、向量检索升级、Postgres→SQLite 双方言验证、prompt 注册表集中化、真实模型 smoke 进 gate:release。

---

## 6. 交叉综合：失败模式的模式学

四个项目（含 novel-ai 对照）横向对齐后，失败不是随机的，而是**九个反复出现的模式**：

1. **约束建议化陷阱（三仓共同失守点，墨舟最大机会）**
   jarvis-write 的圣经约束只是 prompt 里一段话、违规靠另一个 LLM 事后发现；openwrite 的确认门用中文关键词匹配猜"用户已同意"；天命的约束是字符串拼进提示词。**没有任何一个项目拥有"引擎强制"的确定性校验。** 后果一致：长篇一致性沦为概率游戏，然后被宣传口径掩盖。
2. **检索与结构的二选一错误**
   jarvis 砍 RAG（成本妥协）、openwrite 用关键词打分伪装压缩（语义丢失）、天命无检索只有快照。三者都在 50 章后开始丢上下文。正确答案是双轨：结构化 canon 注入恒真事实 + 本地向量检索兜底长尾细节。
3. **影响分析的近视症**
   jarvis LLM 猜 + 30 章硬封顶；天命/openwrite 干脆没有回溯影响分析。改第 2 章对第 80 章的影响在三个系统里都是盲区。唯一解是写入时建边 + 图遍历（ADR-0003 已押注）。
4. **成本盲区**
   jarvis 单章 6-9 次调用（百万字 ≈2000+ 次）；openwrite 宣传"200 万字→5 万字"但压缩层实现撑不起。token 预算必须是一等公民：任务级路由三表（jarvis 亮点）+ 预算化 manifest（openwrite 亮点）+ 轻/全两档审计链。
5. **商业化侵入内核**
   天命连批量生成都先调 CheckFeatureAuth；闭源版 OpenWrite 本地 VIP 字段已被破解验证（vault 语料）。红线重申：授权=外挂网关+服务端裁决，客户端只缓存展示，内核离线完整可用。
6. **测试缺位 = 一切效果宣称不可信**
   天命零测试 vs jarvis 541 个测试（复杂管线没崩的真正根因）vs novel-ai 599 用例——同一变量下的天然对照实验。"3000 章依然连贯"这类宣称没有基准就是营销。
7. **双层技能漂移**
   openwrite 文档层 SKILL.md 与运行时层各自演化出伪协议。技能文档必须从 manifest 同源渲染。
8. **静默失败文化**
   天命空 catch 数百处 + async void×43；openwrite 裸 except×124。错误处理纪律要进 lint 而非进良心。
9. **仓库卫生即工程文化**
   bin/obj 入库、单 commit 历史、目录名与版本号脱节（天命）——仓库混乱度与代码质量高度相关，可作为筛选参考项目的第一眼信号。

---

## 7. Gate A 行为规格冻结输入：must / must_not 清单

> 用途：ADR-0018 Gate A 要求参考标准冻结为精确行为规格后方可写码。以下每条均可直接转写为工单验收断言。

### MUST（必须做到）

| # | 冻结项 | 来源证据 | 关联 ADR |
|---|---|---|---|
| M1 | 影响分析 = 写入时建边 + 图遍历，全书覆盖，禁 LLM-only 猜测 | jarvis `impact.py:22` 30 章封顶反例 | ADR-0003 |
| M2 | 能确定性校验的（时间线单调、数值断言、实体白名单）做成硬门禁引擎；LLM 只审引擎覆盖不到的剩余面 | 三仓共同失守点 §6.1 | ADR-0018 |
| M3 | 章节写入 = 事务单元：正文 + canon 提案 + 记忆同提交，任一环节失败整体回滚 | openwrite `chapter_pipeline.py:947,1034` | ADR-0007 |
| M4 | 时序事实 valid_from/valid_until 落 SQL 区间查询；写回带 source+变更史操作日志，禁启发式区间重开 | jarvis bible.py 正例 + `:269-277` 反例 | ADR-0002 |
| M5 | 上下文双轨：canon 结构化注入 + 本地向量兜底长尾细节（embedding 支持本地 fastembed 类方案） | jarvis 砍 RAG / openwrite LightRAG 各取一半教训 | ADR-0004 |
| M6 | Skill 协议 = manifest(schema/id/agents/allow_tools/**budget**) + builtin→global→project 三层解析 + token 预算裁剪 | openwrite runtime_skills 全套 | Skill 广场 |
| M7 | 技能文档层与运行时层**同源生成**（manifest 渲染文档），杜绝伪协议漂移 | openwrite `[COMMAND]` 伪协议反例 | Skill 广场 |
| M8 | 拆文炼化合规三件套：pin 上游 commit + 保留原 license + 重写边界规则段 | openwrite oh-story 先例 | 拆文炼化 |
| M9 | 提示词 = 版本化 JSON 数据文件 + 类型化变量 + 仓储注入，禁硬编码散落 | 天命 37 套资产形态 + novel-ai 反例 | 拆文炼化 |
| M10 | BYOK 加密存储 + 任务级模型路由（档位/温度/max_tokens 三表）+ 逐调用用量账本 | jarvis crypto/router/usage + novel-ai 双印证 | ADR-0013 |
| M11 | 隐私承诺产品化：零遥测、key 不入项目/Git/Agent 上下文、日志递归脱敏 | openwrite 全仓示范 | ADR-0005 |
| M12 | 开书渐进式：允许"先写第 1 章"，设定可后补；禁六步前置向导强制路径 | jarvis 开书摩擦反例 | Phase 6 UX |
| M13 | 测试密度与管线复杂度同步冻结：核心管线测试基线 ≥500 函数量级，Gate B 真实模型 smoke 进 release 门禁 | jarvis 541 根因 + novel-ai gate 范式 | ADR-0016 |

### MUST NOT（禁止事项）

| # | 冻结项 | 反例证据 |
|---|---|---|
| N1 | 禁任何"仅存在于 prompt、无确定性校验对应物"的约束 | jarvis `chapter.py:462` |
| N2 | 禁自然语言关键词式确认门/状态判定；确认必须是结构化 token 或显式 UI 动作 | openwrite `confirmation.py:29-45` |
| N3 | 禁关键词抽取式压缩替代 LLM 摘要做长程记忆 | openwrite `progressive_compressor.py:236-260` |
| N4 | 禁商业化授权检查进入业务内核调用路径 | 天命 CheckFeatureAuth 散布 |
| N5 | 禁爬虫默认盗版源站；导入 = 用户自带文本（维持既有负面约束 no-pirate-scraper） | 天命 `BookAnalysisViewModel.Import.cs:318` |
| N6 | 禁服务定位器模式与千行上帝文件；TS 侧显式注入、UI 服务按 action surface 模块化 | 天命 ServiceLocator×962、openwrite 4136 行上帝类、novel-ai 1303 行组件 |
| N7 | 禁复制无 LICENSE 仓库的任何代码/资源（天命默认保留所有权利）；bin/obj/日志永不入库 | 天命仓库现状 |
| N8 | 禁效果宣称超出已验证基准范围（宣称必须挂 Gate B 编号） | 天命"3000 章"、openwrite"200 万字→5 万字" |
| N9 | 禁空 catch / async void / 裸 except 进入主干（lint error 级） | 天命数百处空捕获 |

---

## 8. 许可证与合规红线

- Apache-2.0 ×2（jarvis-write/openwrite）：宽松，代码级借鉴可行但建议仍走「机制抽象重写」（与既有矩阵 AGPL 处理原则一致）
- 天命：**无标准许可证 = 默认保留所有权利**。禁止复制任何代码/资源；《开源说明.md》明示的功能理念层面参考需保留出处；其内置爬虫（智能拆书）触碰平台 ToS 红线，墨舟 ADR 已有 no-pirate-scraper 负面约束，维持

## 附录 A. 证据索引与抽验记录

- 克隆基线: `/home/a1691/mouzhou/ref-repos/{openwrite,jarvis-write,tianming}`（shallow, 2026-08-23）
- 历史语料: OB legacy `20_Knowledge/AI/`（OpenWrite 逆向 5 篇 + 炼化结论等）、`10_Projects/墨舟.md`、灵笔 v0.5 决策
- 前作矩阵: `C:\zcode\novel-ai\docs\novel-four-project-acceptance-matrix-2026-08-16.md`
- 四路深审: 并行分身报告 ×4（jarvis-write/tianming/openwrite/novel-ai），主审人逐份抽验

**主审人抽验记录（信任但验证）**：

| 断言 | 分身口径 | 主审复测 | 判定 |
|---|---|---|---|
| jarvis 影响分析 30 章封顶 | `_MAX_DOWNSTREAM=30` impact.py:22 | 一字不差 | ✅ |
| jarvis 测试密度 | 541 个测试函数 | 实测 541 | ✅ 精确 |
| jarvis 单章调用次数 | 6-9 次 | chapter.py 内 LLM 调用相关点 17 处，量级吻合 | ✅ |
| 天命 ServiceLocator | 547 处 | 实测 962（泛型+非泛型全口径） | ⚠️ 更严重 |
| 天命空捕获 | ~343 处 | 单行 32 + 跨行空块 268 ≈ 数百处量级 | ✅ 方向成立 |
| 天命盗版默认源 | shuquta/xheiyan/bqgde | WebCrawlerService.cs:755-756 等四处实锤 | ✅ |
| 天命提示词模板 | built_in_templates/ | 真实路径在根 Modules/ 下，BizPrompt/Spec-玄幻.json 存在 | ✅ |

**未尽事项**：openwrite live_tests 是否实际通过未验证（需真实 key）；jarvis/openwrite 的 mypy strict 绿否未验证；天命 README"3000 章依然连贯"无基准可验。vault 经验回写因本会话未挂载 om MCP 工具暂缺，待工具可用时补记。
