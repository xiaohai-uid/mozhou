# 墨舟参考项目复盘 · 卷二：按问题分组的综合研究（第二~五阶段）

- **日期**: 2026-08-23
- **方法论**: 按委托方研究纲领执行——**不让本地 Agent 逐个项目孤立地看，而是按"墨舟需要解决的问题"分组参考**，避免退化成"抄一个小说生成器"。任务框架统一为：*作为架构审查员，提取各项目解决的问题、失败原因、可迁移设计，并重新评估 MoZhou 架构；禁止直接复制代码或 UI；聚焦领域模型、Runtime、数据流、状态管理与商业闭环。*
- **与卷一关系**: 卷一（`reference-retrospective-20260823.md`）= 第一阶段（确定内核：OpenWrite/jarvis-write/天命三仓深挖）。本卷覆盖第二~五阶段共 10 个信息源，按问题组 A-K 组织。

## 研究矩阵

| 阶段 | 问题组 | 信息源 | 研究方式 | 状态 |
|---|---|---|---|---|
| 一 | A/B/C 内核与一致性 | OpenWrite · jarvis-write · 天命 | 四路源码深审（卷一） | ✅ |
| 二 | D Context/Memory | NovelAI Lorebook · Novelcrafter Codex · NovelForge DSL | 文档爬取×2 + 源码×1 | ✅ |
| 三 | E/F 产品与商业化 | Sudowrite 动作化 · 笔灵收益路径 | 产品层调研 | ✅ |
| 四 | H/J Runtime 与失败面 | DeepSeek Harness 本体 · AI-Novel-Writing-Assistant+Issues | 本地取证 + Issue 矿 | ✅ |
| 五 | G 方法论资产 | oh-story-claudecode × 本地 story-* 蒸馏版对照 | 资产盘点 | ✅ |
| — | K 数据飞轮/Evals | DeepSeek Harness Trace + OpenAI Evals 思路 | 主审人推导（本卷 §K） | ✍️ |

---

## §A 小说产品核心架构重估（承卷一）

**卷一定论回放**: 三参考仓在"确定性约束引擎"上集体失守；Openwrite 的 Application Service 分层（tools/craft/models + ReAct 编排 + 双入口 Goethe/Dante）证明"稳定领域内核 > Agent 直接调 API"的路线可行但罕见。新证据回填处待第二阶段报告合并。

**交叉结论（§A 收口）**: Novelcrafter 以 Scene 为最小同步单元贯穿 Plan/Write/Chat/Review 四模式——印证"稳定领域内核>Agent 直调 API"，且给出内核边界的修正信号：**墨舟 Story Kernel 的一等实体必须下沉到 Scene 粒度**（beats/summary/POV 挂 Scene），仅到 Chapter 粒度会让四模式共享失败。Sudowrite 的五级动作位结论见 §E.2。

## §B 长篇一致性重估（承卷一）

**交叉结论（§B 收口）**: 四方独立证据汇流验证 ADR-0002 方向正确且领先——
- jarvis: valid_from/until SQL 区间 + KnowledgeState"谁知道什么"表 ✅ 结构正确，但注入 40 条硬上限+无检索=执行天花板
- 天命: 账本式一致性领域分类学最全（事实快照/卷里程碑/跨卷存档/Deadline/Pledge/SecretReveal 时限约束+漂移自动回填）
- openwrite: truth 三件套+快照回滚+批注 DSL+"正文事实>大纲计划"仲裁+伏笔 DAG 环检测
- Novelcrafter Progressions: 设定变更绑场景序号、仅对其后生成可见——**独立产品对 valid_from 的重新发明**，最强旁证
- NovelAI 反面: 单步重建 context 无时间维度，百万字规模必失效
**墨舟补强**: Canon 注入配 embedding 双路召回（卷一 M5）+ k-hop 图召回触发源必入候选集（§D.3）+ KnowledgeState 需要一等 Schema 而非 prompt 段落。

## §C 章节事实管理 / Chapter Commit 重估（承卷一）

**已有三方证据**: 天命 GuideContextService 分层装配 + 事实快照账本；openwrite 写章=事务单元（正文+truth+memory 同提交，失败回滚 `chapter_pipeline.py:947,1034`）；novel-ai chapters.revision 乐观锁 + 候选生命周期。
**交叉结论（§C 收口）**: 五个项目在"章节提交"上的最大共性短板=**都在事后补救而非事务化提交**。墨舟十步管线（Prepare→…→Continuity Gate→Canon Proposal→Commit→Flywheel Record）把 Commit 做成一等事务，是全部参考项目中唯一的前瞻设计。采纳的补强：①完成态判定单一事实源（ANWA #90 三层定义冲突教训）；②每章落盘即持久+UI 可见恢复入口（#60 断线丢 6 章教训）；③canon-write 三级写权限（DSH §H.5）；④artifact_delta 异步回灌不阻塞正文热路径（ANWA）；⑤protectedUserContent+stale 标记（ANWA）。

## §D Context / Memory 架构（最高优先级）

### D.1 NovelAI Lorebook 五机制（crawl4ai 全量抓取 docs.novelai.net）

1. **条件召回**: Activation Keys 大小写不敏感 + `/…/` 正则 key + `&` AND 共现；Advanced Conditions 含 Numeric Comparison(`currentStep`)/Random Chance/AND/OR/NOT 组合。⚠️ 无数值 priority；NAI 的"cascade"指递归扫描而非淘汰级联
2. **插入位置**: Insertion Position（0=顶、负数从底）+ **Key-Relative Insertion**（相对最后命中 key 的位置）+ Prefix/Suffix
3. **Token 预算两阶段装配**: 先按 Insertion Order 高→低**预订 Reserved Tokens** 再放置；超预算淘汰序=Order 升序；Do Not Trim=整条原子进出。官方明示 lorebook 可 "cancel out story text"——设定可吞噬正文
4. **生命周期**: Search Range 上限 10000 字符；递归扫描但**触发源文本不保证入 context**；Ephemeral Context `{+3~10,-2:text}` = 按 Story Step 计时的 TTL 时效条目
5. **可视化**: Context Viewer 以 Stages 回放装配，逐条记录 Stage/Order/Identifier/**Inclusion/Reason**/Key/Reserved/Tokens/Trim Type

### D.2 Lorebook 机制级局限（墨舟必须超越处）

①漏召本质缺陷：激活=字符串布尔事件，别名/意译全漏召、中文分词放大、作者枚举成本随世界观线性增长；②常用词误召；③无相关性度量，人工 Order 百万字规模不可维护——Lorebook 大型化失效根因；④图式知识被降维成字符串扫描。

### D.3 迁移清单 → Context Compiler

直接迁移: 两阶段装配（先订后放）/原子条目/相对定位/TTL 时效。
必须升级: keys → 关键词快通道＋embedding 双路合并打分；递归扫描 → Temporal Canon Graph 显式 k-hop 召回（触发源必入候选集）；固定窗 → 分层窗口；Random/Numeric 条件 → Policy 层声明式节奏规则。
**Receipt 升等**: NAI 把 Inclusion+Reason 做成产品功能而非日志——墨舟 Context Receipt 应为一等产物（每次生成可复算可 diff），并给 story text 保底配额防设定挤掉正文。

### D.4 NovelForge @DSL 拆解（源码实证）

真实度: 主链路可用、关键子系统半成品——后端仅 1 个测试文件；`budget_stats` 恒返回 `{}` 是桩（`context_service.py:226`）。

DSL 机制（解析器在渲染进程 `contextResolver.ts` 765 行）: `@标题.path`｜`@type:角色卡[过滤器].{f1,f2}`｜`@self/@parent`｜`facts.*`｜`kg:实体名`｜`chapters:previous`。三大亮点：①**`previous:global:N`** 卡片树按 display_order 构先序序列取时间近邻——确定性查询算子；②**`[filter:]` 编译为 FilterCond[] 且右值支持 `$self.content.volume_number - 1` 相对表达式——每条 @引用本身就是可静态提取的依赖声明**（Dependency Manifest 声明式语法雏形）；③单遍非递归展开一跳确定性天然无环 + 失败显性化（空串/[Error]标记）。反面：三套引用机制互不相通；领域概念硬编码进通用 resolver 被自家工程规则打脸；**装配在客户端=服务端零凭证零审计**。

对墨舟: 先序树 previous 选择器入 Canon Graph 算子库；@引用静态提取进 Dependency Manifest；Receipt 记录每次解析失败及原因；Compiler 保持一跳确定性，跨实体组合交图查询；**装配必须在服务端**。
**核心命题冻结**: AI 不应该看到所有资料，而应该看到正确资料——对应 Context Compiler / Receipt / Policy 三件套

## §E 商业小说产品形态

### E.1 Novelcrafter Codex：一等对象的产品化样板

- **解决什么**: 窗口有限 vs 设定一致性要求高的矛盾——Codex 把 Character/Location/Object/Lore/Subplot/Other 变成按"名称+别名"检测命中才注入的一等对象；Research 区物理隔离"人看但不给 AI"的内容防上下文污染
- **条目解剖**: Name 即主键 + Aliases（默认大小写不敏感）+ Description（AI 主上下文带快照历史）+ 自定义 Details 控件（可挂 book/series 作用域与 AI 可见性档位）+ Relations 嵌套组（提"黑手党"连带成员/据点，官方警告慎防级联膨胀）
- **AI Context 四档**: Always / Detected(默认) / Detected-off / Never —— 中控台装配原语
- **Progressions（杀手锏）**: 设定状态变更以"加注"绑到具体场景，**仅对该场景之后的生成可见**——时间线维度设定版本控制，防提前剧透。网文境界/伤势漂移刚需，直接印证墨舟 Temporal Canon 的 valid_from 设计
- **Plan/Write/Chat/Review 闭环**: Scene 是贯穿最小同步单元（summary/beats/POV）；Matrix 场景×实体电子表格 = Pro Studio 主视图候选；Mentions 跨五域反向索引（含聊天："这个设定在哪聊过"）

### E.2 Sudowrite：AI = 编辑器里的动词，不是对话框

核心范式（第三方指南总结）："在编辑器上以按钮操作调用 Write/Rewrite/Describe 等功能，无需写 prompt"。

| 动作 | 入口 | 输入→输出 |
|---|---|---|
| Write | 光标处按钮 | 读当前文脉（跨 25 文档最多 2 万词）→ **多候选卡片（最多 6 变体）**+ Creativity Slider 调风险 |
| Rewrite/Expand | 选中文本→菜单 | 选语气（Show Not Tell / More Inner Conflict 等 8 种）→原地替换 |
| Describe | 选中名词/场景 | 五感情景描写备选 |
| Brainstorm | 面板 | 多方案+点赞学习偏好 |
| Feedback | 全文按钮 | 编辑视角"5 个可执行改进点" |

Story Engine = Bible 分步问卷引导（Braindump→Synopsis→Genre→Characters→Worldbuilding→Outline）；Import Novel 可从已有稿自动反建 Bible——博客原话："笔记不只是躺着，AI 写下一章时会读它们"。Plugins 1000+ 社区按钮可传 Bible 变量可多级编排=命令广场形态。

**结论（墨舟三栏中控台的 AI 形态）**: AI 以**五级动作位**出现——①选区动作（润色/扩写）②光标动作（续写多卡）③面板动作（脑暴/Feedback）④项目级向导（拆纲→章纲→正文）⑤画布/插件广场兜底长尾。聊天只是旁路，不是主入口。

### E.3 迁移清单与勿抄

迁移: 双区制条目（AI 视图/研究者视图）、AI Context 四档、Progressions 绑章节号、别名表+排除词（中文绕开分词难题）、book/series 双作用域多书共世界观、Tags 不入 AI 的元数据纪律、Scene 作为 Plan/Write 同步单元。
勿抄: UI 视觉文案；"Chat 锁高档"定价（中文网文日更 Chat 是刚需，应本地优先+BYOK 低门槛、对自动化增值收费）；云同步架构；英文复数启发式；封闭六类型枚举（墨舟开放自定义实体类型）。

## §F 中文网文商业化（笔灵拆解）

**命题验证: 用户买的不是 AI，是收益路径。** 笔灵把每个功能都译成收益语言：黄金开头="写出编辑最爱的开头"、大纲="编辑认证·过稿率超高"、去AI味="一键提升过稿率"、拆书="写得好不如仿得好"。

**平台适配 ≠ 文风切换，而是投稿决策服务**: 其 /tougao 页做"投稿平台大PK"表格——起点/番茄/晋江/七猫/飞卢的热门题材+真金白银福利（番茄 3000 元/月全勤+1000 完本；晋江打赏 50%+订阅；飞卢 70% 分成+400 全勤），配"测一测你的天命平台"测试。**平台规则数据化成获客钩子**——这正是墨舟 Market Brain 的产品形态答案。

**成功案例库**: 分新手签约/稳定发文/签约赚钱/踩坑/作者访谈五层，第一人称标题+学习人数制造从众。

**迁移清单**: ①卖"路径"不卖功能（工具→攻略→案例→付费闭环）；②Market Brain 复刻"平台福利对照表+天命平台匹配器"，数据注明来源与时点；③Skill 卡片文案写**过程指标**（日更达成率/完本率）不写收入承诺；④案例库必须含失败案例。

**勿抄**: "编辑认证""过稿率超高"无据背书；"副业收入超主业"诱导性收入话术（广告法风险）；"仿写爆款"直白当卖点（同质化+版权双险，应表述为"结构拆解学习"）；信用点焦虑式计量计费。

*取证说明: ibiling 定价档位登录后才可见（未登录 404），价格仅首页横幅"终身 VIP 199 元"可证，已如实标注。*

## §G 方法论资产 → Capability Registry 种子

### G.1 资产全景（上游 v0.7.6 `9d0bd5f` × 本地 story-* 对照）

| 技能 | 含金量 | 核心资产 |
|---|---|---|
| 拆文 long/short-analyze | ★★★★★ | 唯一 Stage 0-6 管道；**量化爽感指标**（反应篇幅比≥1.5、铺放比）；黄金三章逐字段模板；冲突升级"口头→经济→暴力" |
| 去AI味 deslop | ★★★★★ | **7 Gate 分类**（禁用词/句式套路/心理告知/节奏均匀/对话腔/结尾升华/解释腔）+ 分级删除上限（轻≤15%/中≤25%/重≤35%）+ 确定性预检脚本 + 最小干预原则 |
| 写作 long-write | ★★★★☆ | 卷纲（剧情单元卡+卷契约+终局底牌）→细纲（五列表格+复沓锚句）→正文；"细纲是『要发生什么』的契约不是正文的形状"；伏笔权威追踪文件 |
| 审查 review | ★★★★☆ | "审查是找问题不是验证正确性"；S1-S4 Findings Schema；黄金三问（无原文证据不输出）；18 维 rubric。扣分：并行分工非真对抗辩论 |
| 扫榜 scan | ★★★☆☆ | 方法论优秀（"单本排名只是线索，跨样本重复模式才算信号"+平台差异论），但爬虫数据源脆弱勿入墨舟 |

### G.2 ⚠️ 关键发现：本地"蒸馏版"= v0.7.2 原样快照

CRLF 行尾与 byte-identical 比对证实：本地 story-* 技能是上游 v0.7.2 快照**而非二次创作**。快照内方法论零损失，但**丢了 v0.7.3→v0.7.6 四版进化**：
1. `tracking_commit.py` 追踪事务门（堵"静默写出无追踪正文"漏洞）
2. `check-outline-copy.js` 细纲照搬检测
3. long-write SKILL.md 82KB→按需拆分加载（上下文省 20-40%）
4. narrative-writer 空转规则修复（工具白名单没 Bash 却被要求跑 Bash 统计字数——"规则挂在无法执行的命令上"）
5. 参考文件条件化必读表

另：本地 storyrepo 自研引擎与上游技能**双轨并存有打架风险**，须先裁决主轨。

**判定：上游更成熟。墨舟 Capability Registry 的炼化基线应对齐 v0.7.6（pin `9d0bd5f`），而非 openwrite 曾 pin 的旧版 `48a4789`。**

### G.3 Registry 种子清单（MIT，需 pin-commit + 出处标注）

1. 黄金三章拆解模板 + 爽点/钩子类型学
2. 爽感量化指标（铺放比、反应篇幅比≥1.5、反应层四级递进）
3. 去AI味 7 Gate 规则集 + banned-words + 确定性预检思路
4. 读者契约/期待债/终局底牌理论
5. 审查 rubric S1-S4 + 黄金三问 + 证据铁律
6. 扫榜三原则与平台差异框架（仅方法论，不带爬虫）
7. 细纲内容层/形状层契约 + 复沓锚句机制
8. writing-craft 微观技法（身体细节替情绪词、道具三次出现、数字叙事）

每项标注 `derived from worldwonderer/oh-story-claudecode@9d0bd5f (MIT)`，经广场合规炼化流程转写。

### G.4 勿抄清单

① 多 CLI 适配层全部勿抄（hooks/commands/多端部署机制）；② 平台爬虫脚本勿入墨舟（反爬合规+selectors 易失效），只取多榜单交叉验证方法；③ storyrepo 与上游技能勿同时启用同一生产链路；④ 拆文边界声明中给上游自动化管道的"抗拒绝话"需按墨舟安全策略重写。

## §H Runtime 思想：Model ≠ Agent

**命题**: `LLM + Novel Runtime = Novel Agent System`（迁移自 `Model + Harness = Agent System`）

### H.1 DSH 架构要素盘点（实际文件证据，全部只读取证）

| 层 | 证据路径 | 要点 |
|---|---|---|
| 全局指令 | `~/.dsh/AGENTS.md` | 指令与代码彻底分离；声明优先级链 |
| 配置 | `~/.dsh/settings.yaml` | 声明式模型注册表（providers/models/contextWindow/maxTokens）——LLM 路由是配置不是代码 |
| 钩子 | `hooks.json + hooks/*.mjs` | 四生命周期面（SessionStart/UserPromptSubmit/PostToolUse/Stop），钩子=外部进程协议化桥接 |
| Profile 装配 | `profiles/web/package.json` | **双清单制**：pnpm.overrides 将 28 个内核包 pin 到固定版本；`bundles` 数组挂载 23 个外挂插件 |
| 补丁注入 | `cordis.patch.yml` | insert/disabled 补丁 + managed block + `.bak` 备份链 |
| 热注入 | `super-injector/` | 免重启注入/卸载 + 自愈日志 + 统计 |
| 会话/状态 | `sessions/<ws>/<uuid>/session.jsonl.zstd` + `session_projcache.json` | 事件溯源单文件按工作区分桶；投影缓存=CQRS 读模型，可从 Ledger 重建 |
| 审计 | `change-ledger/v1/workspaces/` | 按 workspace 分版本的变更台账 |

### H.2 六要素提炼

1. **Runtime**: 内核=被锁版本的包集合，稳定靠"锁死+外挂"而非冻结代码；能力变更免重启
2. **Plugin**: 三级扩展位——bundle（装配期）/ patch（配置期）/ 热注入（运行期+自愈回滚），每级幂等有备份
3. **Tool**: 统一 schema 原生工具 + MCP 桥标准化外部能力，每个外部条目声明超时/重连/失败策略——失败不拖垮宿主
4. **Session**: 事件溯源单文件（jsonl+zstd）；回合级回滚
5. **State**: 状态≠事件——投影从 Ledger 可重建，读性能与会话真相分离
6. **Trace**: 会话流即完整 trace 支撑回放评估；权限三级使写操作天然带审计边界

### H.3 映射表：DSH → 墨舟 Novel Runtime

| DSH | 墨舟对应物 |
|---|---|
| 内核 overrides 包集 | 章节事务管线内核（版本锁死） |
| bundles 清单 | Capability Registry |
| cordis.patch.yml | 能力补丁：风格包/题材包按 id 启停 |
| hooks 四生命周期 | SkillRuntime 钩子：ChapterStart / PreCommit(定稿) / PostRevise |
| settings.yaml providers | 分级模型路由：大纲强模型、润色快模型 |
| session.jsonl.zstd | Event Ledger（章节事务流） |
| session_projcache | 一致性投影：人物关系/伏笔账本，可重建 |
| change-ledger | 写作变更审计台账 |
| PostToolUse validate-write | 设定一致性校验钩子 |
| 权限三级 | 写作动作分级（见 E-3） |

### H.4 不该照搬

① 十几个自由 MCP server + bash 全开放的工具面对写作用户是纯干扰——墨舟收敛为受控能力集；② subagent/workflow 自由编排不暴露给终端用户，只作后台引擎；③ 手工 patch 文件+bak 备份链是开发者运维产物，产品必须 UI 化为 Registry 管理；④ danger-full-access 对消费级写作产品无意义。

### H.5 "内核稳定+能力外挂"三条架构建议

1. **双清单装配制**: 内核（章节事务管线）以 override 锁版本；Capability Recipe/风格/题材作为独立包进 bundles 清单，"装能力=加一行"，卸载即净，禁用走 patch disabled 而非删除
2. **Ledger 与投影分离**: 正文/设定变更加 append-only Event Ledger（jsonl）；人物卡、伏笔账本、字数统计全部做成 projection 可重放重建——Recipe 基准评测 = 固定输入事件流重放，四层飞轮直接吃 Ledger 差量
3. **写作生命周期钩子 + 三级写权限**: ChapterStart/PreCommit/PostRevise 挂一致性校验与评分；权限分级 read(拆文参考) / draft-write(草稿自由) / canon-write(世界观事实仅经校验事务写入)，canon 写入强制落 change-ledger——**创作自由度与事实约束解耦**

## §I 失败雷区：从别人家 Issue 里学（ANWA 98 例全量统计）

> 样本: ExplosiveCoderflome/AI-Novel-Writing-Assistant 全量 98 issue 元数据 + 45 关键 issue 正文。定位="AI 导演式全自动长篇生产"，目标用户不懂写作的新手。

| 失败类 | 占比/数量 | 代表 issue | 根因 |
|---|---|---|---|
| 部署/模型接入劝退 | ~20%，占比最大 | #28 配了 Gemini 提示"未配置 DeepSeek"（路由写死默认供应商） | 供应商地狱是获客漏斗第一道闸 |
| 流程卡死/状态循环 | ~13 例 | #84 导演停 98% waiting_approval 用户只能改库；#116 replan_required 无限暂停循环；#39 token 空转 | 该停不停(#132)、不该停狂停(#116)的停止边界两难 |
| JSON 结构化输出失败链 | ~11 例最高频技术故障 | #21 schema 过严直接拒绝；#10 repair 只修语法不修语义 | AI-first 无降级路径=单点脆弱 |
| 断点/数据安全 | 少但杀伤力最大 | **#60 断线后已写 6 章全部丢失**；#53 跨设备续写无方案 | 前作矩阵"断网恢复缺失"完全应验 |
| 黑盒不透明 | #80 标题即结论 | traceStore/SSE 基础设施都在只是没接 UI；#73 单章烧 80k token 用户只会问怎么办；#79 Prompt Cache 命中率≈0% 成本翻倍 | 数据躺在库里≠透明 |

架构承诺 vs 用户现实: README 承诺"可暂停可恢复"，现实 #60 整段丢失。**架构先进性集中在导演编排层，用户流失发生在编排层之外的输入端（模型接入）和输出端（透明度）。**

## §J 大型小说 Agent 系统的可迁移设计（ANWA 正面部分）

1. **控制面/执行面分离 + 四表事实源投影**（DirectorRun/StepRun/Event/Artifact）——墨舟 Event Ledger 直接参照
2. **问题治理统一链路**: 稳定问题码→冻结策略快照→fingerprint 幂等→四动作枚举（auto_retry/continue_with_warning/pause_for_manual/fail_task）
3. **质量债而非失败**: 局部问题降级记账、修复封顶一次；只有 replan/安全/数据完整性可停全局链
4. **artifact_delta 异步回灌**: 正文热路径只管产出，账本更新异步化
5. **protectedUserContent + stale 标记**: 人工编辑受保护，上游重算只置下游 stale 不清正文
6. **反模式清单制度化**（recurring-failure-modes.md:"不许用降低轮询频率掩盖 API 阻塞"这类负面规则）

### 墨舟避坑六条（别人的血泪）

1. **每章落盘即持久 + UI 可见恢复入口**（#60 最痛教训）；完成态判定单一事实源（#90 三层定义冲突教训）
2. **结构化输出三级降级**: 宽松 schema→定向重生坏字段→人工模板兜底；给本地小模型留活路否则用户群砍半
3. **停止策略显式契约并双向实测**: 既测"该停不停"也测"确认后必推进"，每个检查点配回归测试
4. **透明度一等公民从 V1 开始**: 步骤面板/当前 prompt/token 数/失败分类进 UI，trace 别躺库
5. **供应商适配层前置**: base URL 可相对、自定义 provider、连接测试按钮、缓存友好 prompt 前缀
6. **撤销/回退入口与新手引导同权**: 十步管线每步都有可见"上一步"

## §K 数据飞轮 / Agent 评估：OpenAI Evals 思路 → Novel Benchmark（主审人推导）

### K.1 Evals 五要素到小说域的映射

| OpenAI Evals 要素 | 通用语义 | 墨舟对应物 | 冻结状态 |
|---|---|---|---|
| Task | 可重复执行的评测单元 | Benchmark Scenario（50 章合成剧本，migration-plan §2 已定义 8 个剧情锚点） | ADR-0016 已有 |
| Input | 确定性输入 | 章节前 Canon 快照 + Intent + Skill Recipe（版本钉死） | Phase 1 落地项 |
| Expected Result | 判定基准 | CANON_ACCURACY≥99% / KNOWLEDGE_LEAK=0 / PROMISE_RECALL=100% 等 6 指标 | 已冻结量化目标 |
| Scoring | 规则评分器优先，模型判分需防自评作弊 | 机检六项（规则）+ LLM Judge 仅限非机械维度且 Judge≠Author 模型 | 需补强：Judge 独立性约束 |
| Regression | 回归基线 | Capability Recipe 版本升级前后跑同一 Scenario 集，禁止"升级即全量重写评测" | 需补强：Recipe↔Benchmark 版本矩阵 |

### K.2 数据飞轮的评估闭环（借 DSH Trace 思想）

Event Ledger（append-only）不只是审计日志，它是飞轮的训练数据源与评测回放源：
1. **Trace 即语料**: 每次章节事务的十步事件链（Prepare→…→Flywheel Record）落 EventLedger，作者接受/拒绝/改写动作即偏好信号（EMA α=0.05 静默学习）
2. **回放即回归**: 新版 StyleLearner/TaskModelEvaluator 上线前，用历史 Ledger 回放对比指标漂移——这是 DSH "change-ledger + 自动化 run history" 思想的直接移植
3. **静默纪律**: 飞轮任何学习产物进入生成上下文前必须可解释（Receipt 里标注"此段风格偏置来自最近 N 次修订统计"），否则退化为黑盒——ANWA 的黑盒教训前置规避

### K.3 本节结论（无外部依赖，直接生效）

- Benchmark 必须与 Capability Recipe 双向版本钉死（M14 新增建议）
- LLM-as-Judge 只允许评"文风/爽感"等主观维度的**相对排序**，禁绝对分数；机械维度一律规则机检（呼应卷一 N8"宣称挂 Gate B"）

---

## 终章：MoZhou 架构重评（18 篇 ADR 逐条判定）

> 判定口径：**验证成立**（外部证据支持现行设计）/ **需升级**（方向对但规格要加严）/ **需补强**（补充新冻结条目）。无"需降级"项——两卷研究没有发现任何一条 ADR 方向性错误，这本身是 Gate A 阶段最重要的质量信号。

| ADR | 判定 | 证据与动作 |
|---|---|---|
| 0001 Kernel-over-Adapter | ✅验证成立 | openwrite 双入口+领域内核形态；DSH bundle 制；Novelcrafter Scene 共享对象。**修正**: 内核一等实体下沉到 Scene 粒度 |
| 0002 Temporal Canon | ✅验证成立 | Novelcrafter Progressions 独立重新发明 valid_from=最强旁证；天命账本分类学可抄。**升级**: KnowledgeState 一等 Schema；embedding/k-hop 双路召回 |
| 0003 Dependency Manifest | ✅验证成立 | jarvis "LLM 猜+30 章封顶"反证必要性；NovelForge @引用=静态依赖声明的语法思路可采纳 |
| 0004 Context Compiler+Receipt | ✅强验证 | NAI Inclusion/Reason 产品化先例 + NovelForge budget_stats 桩反例。**升级**: Receipt 一等产物（可复算可 diff）、story text 保底配额、装配必须在服务端 |
| 0005 Policy Flywheel+Privacy | ✅验证成立 | openwrite 全仓零遥测示范可行；笔灵话术红线进 Market Brain 规约 |
| 0006 Local Data Plane | ✅验证成立 | 本地优先是所有竞品共同短板=差异化机会；Sudowrite/NAI 云存储反衬 |
| 0007 Event Architecture | ✅验证成立 | ANWA 四表投影 + DSH jsonl.zstd 事件溯源双印证。**采纳**: Ledger 与投影分离、artifact_delta 异步回灌 |
| 0008 Evaluation Engine | ✅+§K 强化 | Judge≠Author 模型、Judge 只准相对排序 |
| 0009 Capability Registry | ✅验证成立 | DSH 三级扩展位（bundle/patch/热注入）+ Sudowrite Plugins 形态；UI 化 Registry 管理禁手工 patch 文件 |
| 0010 External-edit Reconciliation | 🔧需补强 | ANWA protectedUserContent+stale 标记模式直接采纳 |
| 0011 Compaction+POV Slicing | ⚠️需升级 | **禁关键词抽取式压缩**（openwrite 反例），LLM 摘要替代；渐进预算分级保留 |
| 0012 Style Evolution Anti-drift | ✅验证成立 | 补 Receipt 可解释偏置标注（"此段风格偏置来自最近 N 次修订统计"） |
| 0013 Concurrency+Sampling | ✅验证成立 | novel-ai 抽卡已通；jarvis 任务级路由三表照抄；多候选卡片+创造力滑杆为默认 UI 形态 |
| 0014 Conflict Reconciliation | ✅验证成立 | "正文事实>大纲计划"仲裁（openwrite）写入规格 |
| 0015 Market Brain Boundary | ✅验证成立 | 笔灵"平台福利对照表+天命匹配器"为产品形态模板；数据注明来源时点 |
| 0016 Two-tier Benchmark | ✅+§K 强化 | M14 Recipe↔Benchmark 版本矩阵；回放即回归（EventLedger 重放） |
| 0017 Market Sources | ✅验证成立 | 合规来源纪律维持；爬虫勿抄（oh-story/天命双反面） |
| 0018 Two Hard Gates | ✅全程有效 | 本次两卷研究即 Gate A 输入件本身 |

### 新增 Gate A 冻结条目（接卷一 M1-M13 / N1-N9）

**MUST**:
- **M14** Capability Recipe 与 Benchmark Scenario 双向版本钉死，Recipe 升级必须重放回归
- **M15** LLM-as-Judge 仅限主观维度相对排序，禁绝对分数；机械维度一律规则机检
- **M16** AI 能力注册为五级动作位（选区/光标/面板/项目向导/广场），聊天为旁路非主入口
- **M17** 结构化输出三级降级：宽松 schema → 定向重生坏字段 → 人工模板兜底（给本地小模型留活路）
- **M18** 供应商适配层 V1 前置：自定义 provider/base URL 相对化/连接测试/缓存友好 prompt 前缀
- **M19** 透明度一等公民从第一版开始：步骤面板/token 消耗/失败分类进 UI，trace 不躺库
- **M20** 方法论种子炼化基线 = oh-story v0.7.6（pin `9d0bd5f`），八类资产按 §G.3 清单转写

**MUST NOT**:
- **N10** 禁在客户端装配生成上下文（服务端确定性装配 + Receipt 凭证）
- **N11** 禁信用点焦虑式计量计费与无据背书话术（"过稿率超高""副业超主业"）
- **N12** 禁把 subagent/workflow 自由编排暴露给终端用户（后台引擎专用）

### 两卷总结论

13 个信息源、11 个问题组交叉验证后的核心判断不变且更硬：**墨舟的 18 篇 ADR 在方向上无一被证伪，真正的风险全部集中在执行密度**——测试密度（jarvis 541 反例 vs 天命零测试）、透明度（ANWA #80）、恢复语义（#60）、以及"约束建议化"的旧引力（卷一 §6.1）。Gate A 的输入已备齐：卷一 M1-M13/N1-N9 + 本卷 M14-M20/N10-N12 共 33 条冻结条目，可直接逐条转写为工单验收断言。

---

## 附录 B. 卷二取证说明

- 七路并行深审: NovelAI Lorebook（crawl4ai 全量 docs.novelai.net）/ Novelcrafter（官网+docs）/ NovelForge（本地源码）/ ANWA（本地源码+98 issue 全量元数据+45 正文）/ DSH（~/.dsh 只读取证）/ oh-story（上游 v0.7.6 `9d0bd5f` × 本地蒸馏版 byte-level 对照）/ Sudowrite+笔灵（crawl4ai，受限页如实标注）
- 主审人抽验: DSH 报告三数字（28 overrides/23 bundles/25 skills）实测吻合
- 取证局限: Novelcrafter Review 模式公开文档最少未验证；ibiling 定价档位登录墙后不可见；Sudowrite help 域已下线改用官网+博客+第三方指南交叉；ANWA live 行为未实测
- vault 回写: 分身报告部分归档（NovelAI inbox 笔记、Novelcrafter reference 笔记）；主审汇总回写待 om MCP 可用会话补记
