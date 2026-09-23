---
date: 2026-08-24
description: T30-C 路取证：上游 oh-story v0.7.6（pin 9d0bd5f）SKILL.md 元数据解剖、参考文件条件化加载、tracking_commit.py 追踪事务门，推导墨舟 CapabilityRecipe 冻结 Schema 候选字段表
tags: [mozhou]
---

# T30-C · CapabilityRecipe Schema 参照系：oh-story v0.7.6（pin 9d0bd5f）解剖

> 对应票：Phase 3 Wayfinder 图研究 #30（三路取证之 C 路：CapabilityRecipe Schema 参照系）
> 调查方式：只读取证。本地 v0.7.2 快照（`/home/a1691/.agents/skills/story-*`）× 上游代理 clone（`~/t30-tmp/oh-story`，checkout `9d0bd5f`）。本报告在 `docs/research/reference-retrospective-vol2-20260823.md` §G 结论之上往字段层细挖，不重做 §G 已有判定。
> 体例范本：`docs/research/t9-local-embedding-feasibility.md`。

---

## 0. 结论先行

1. **frontmatter 元数据层在 v0.7.2→v0.7.6 间几乎冻结**：四个字段 `name / version / description / metadata.openclaw.source`，跨四版进化零结构变化（仅 story-review version 1.1.0→1.1.1）。**上游把「条件化加载」「参数声明」全部放正文约定而非 frontmatter**——墨舟 CapabilityRecipe 若要机器可校验，必须比上游 frontmatter 更结构化，这正是冻结 Schema 的价值位。
2. **参考文件条件化是 pin commit 本体**（`9d0bd5f` = 「fix(agent): 参考文件表条件化」）：核心手法是把软引导「按需读取」升级为硬约束表——**逐行独立判定、命中即必读、禁止以"材料已够"跳过、未命中禁止预加载**，条件分三类：任务阶段触发、输入载荷触发（prompt 给了 X）、兜底触发（索引无匹配时）。
3. **`tracking_commit.py`（1139 行）是与墨舟 ChapterCommit 最同构的参照物**：LLM 只交语义 JSON delta → 脚本内存校验合并 → 重渲染派生视图 → **原子写 `_tracking-state.json` 作为唯一提交点**；带 CAS（`expected_state_revision`）、章序不变量、显式退役声明门、双档容量预算、失败三分法，并由 PreToolUse hook 在写入路径上强制（堵 issue #305「Claude 侧静默写出无追踪正文」漏洞）。
4. **CapabilityRecipe 候选字段 17 项**（§5），其中 14 项有上游实证出处、3 项为推断标注。
5. **版本基线偏差如实记录**：`git describe --tags 9d0bd5f` = `v0.7.6-4-g9d0bd5f`——pin 是 v0.7.6 tag（`0a34c69`）之后又叠了 4 个 fix commit 的 HEAD。Gate A 写「v0.7.6（pin 9d0bd5f）」，炼化时应以 SHA 为准、tag 仅作人读标签。

---

## 1. 版本与快照基线核对（取证前提）

### 1.1 上游 pin 精确状态

- clone：`HTTPS_PROXY=http://127.0.0.1:7892 git clone https://github.com/worldwonderer/oh-story-claudecode.git ~/t30-tmp/oh-story && git checkout 9d0bd5f`，成功。
- `git rev-parse HEAD` → `9d0bd5f5aead707ddcdcf7d5f141b237e2ac464c`，与 Gate A pin 完全一致，无偏差。
- tag 对照（`~/t30-tmp/oh-story` 内 git）：`v0.7.6` = `0a34c69`；`v0.7.6..9d0bd5f` 区间恰 4 个 commit：
  1. `546101e` feat(story-cover): Codex 内置 ImageGen 优先于 API 兜底 (#358)
  2. `6af0529` test: 词法契约替换为行为覆盖 (#359)
  3. `ef6ff7b` fix(story-setup): 部署清单不再把 agent-references 复制进自身 (#364)
  4. `9d0bd5f` fix(agent): 参考文件表条件化 + 细纲情节点五列表格 (#362)
- LICENSE：repo 根 `LICENSE` 首行 `MIT License`（Copyright (c) 2025-2026 oh-story-claudecode）。§G.3 的 MIT 标注纪律成立。

### 1.2 本地快照身份复核

- 抽样 byte 比对（long-write 的 SKILL.md / state-tracking.md / check-ai-patterns.js）：与 v0.7.2 tag blob 直接 cmp 不等，但 `tr -d '\r'` 后逐字节相等——**本地 = v0.7.2 内容等价快照，差异仅 CRLF 行尾**，与 §G.2「原样快照非二次创作」判定一致。
- 文件清单差（本地相对 pin 缺失，`comm` 实测）：
  - long-write：`references/tracking-transaction.md`、`references/workflow-chapter.md`、`references/workflow-setup.md`、`scripts/check-outline-copy.js`、`scripts/tracking_commit.py`
  - deslop / short-write：`scripts/check-outline-copy.js`
  - review / import：`references/tracking-transaction.md` + `scripts/tracking_commit.py`
- 体积对照：本地 long-write `SKILL.md` 77,545 B vs 上游 pin 27,252 B——§G.2 第 3 条「82KB→按需拆分」在文件层坐实（拆出的 workflow-setup/chapter/daily/revision 四件不在本地）。

---

## 2. Q1 · SKILL.md 元数据解剖

### 2.1 frontmatter 字段清单（两版逐字段对照）

来源：各 skill `SKILL.md` 头部 `---` 块。上游路径 `~/t30-tmp/oh-story/skills/<skill>/SKILL.md`，本地 `/home/a1691/.agents/skills/<skill>/SKILL.md`。

| 字段 | 类型 | v0.7.6-4 实例（story-review） | v0.7.2 同位置 | 差异 |
|---|---|---|---|---|
| `name` | string (kebab-case) | `story-review` | 相同 | 无 |
| `version` | semver string | `1.1.1` | `1.1.0` | 唯一实质 bump |
| `description` | string，内嵌触发方式 | "多视角对抗式审查。……触发方式：/story-review、/审查、「审查一下」「帮我审一下」。" | 同文 | 无 |
| `metadata.openclaw.source` | JSON string（嵌套单键对象） | `{"openclaw":{"source":"https://github.com/worldwonderer/oh-story-claudecode"}}` | 相同 | 无 |

其余 skill 版本号两版完全一致：long-write/deslop/short-write/long-analyze/import/long-scan/short-scan 均 `1.0.0`，short-analyze `3.0.0`，setup `1.2.7`（实测输出见 §8 复核命令）。**判定：元数据 schema 四版冻结；版本演化全部发生在正文与附属文件**——上游没有用 frontmatter 承载任何加载逻辑或参数 schema。

### 2.2 description 的隐性结构（上游实证）

每条 description 固定三段式：**一句能力定位 → 一句运行模式/降级行为 → 触发方式枚举**。例：

- review（pin）：「full/lean 模式在已部署 reviewer agents 时并行 spawn；缺失/异常 agents 或 spawn 失败时自动降级 solo，参考文件不可读时使用内置 rubric fallback。」——降级阶梯直接写进 description。
- long-analyze：「跑完黄金三章（Stage 1）后产出快速预览报告并询问是否继续全量拆解」——停靠点行为写进 description。
- short-analyze：「下游 story-short-write 同时读拆文报告 + 情节节点 + 写作手法 + 原文 + _meta.json 写下一篇」——上下游消费契约写进 description。

→ 对墨舟：`description` 不是自由文本，而是「能力摘要 + 运行语义 + 触发词表」三段复合体，冻结 Schema 应将其拆成结构化字段（§5 F4）。

### 2.3 正文骨架对比（v0.7.2 单体 vs pin 路由器）

- v0.7.2 本地 long-write SKILL.md（77KB）：全流程内联，无分载。
- pin long-write SKILL.md（27KB）章节树（`grep '^#'` 实测）：核心方法 → 写作流程（含 **「裸调用与停靠点（防失控）」** §53）→ Phase 1-4 各一小节 → 项目文件结构 + 产物映射表 → 单章写作流程 → 流程衔接 → 参考资料索引 → 语言。
- 分载规则原文（SKILL.md L238 附近）：「开书三阶段（Phase 1-3）在 `references/workflow-setup.md`，单章正文与质量检查（Phase 4-5）在 `references/workflow-chapter.md`，日更批量在 `references/workflow-daily.md`，回炉大修在 `references/workflow-revision.md`」。
- 部署契约：review SKILL.md L9 要求读项目根 `.story-deployed` 的 `agents_version`，与本版 `25` 不一致时**照常 spawn 但发 Notice**，大于 25 时提示先更新上游——版本协商不阻断主流程。

---

## 3. Q2 · 参考文件条件化加载机制（§G.2 进化第 5 条的字段级证据）

### 3.1 pin commit 的 before/after（一手 diff）

`git diff 9d0bd5f~1 9d0bd5f -- skills/story-setup/references/templates/agents/narrative-writer.md`：

- 表头：`何时读取` → **`必读条件`**。
- 引导语：旧「你拥有以下参考文件，**按需读取，不要提前全部加载**」→ 新「你拥有以下参考文件。**逐行独立判定，命中任一条件即必读**（不是要同时满足），不得因「手头材料已够」跳过；未命中的行不要预加载。」
- 同 commit 给 story-architect.md 打同款表（措辞略简），并给 explorer 加停止条件（§3.3）。

三个关键升级：①从「建议按需」变「命中必读 + 双向禁令」（禁跳过/禁预加载）；②条件粒度到行；③新增**输入触发型条件**——不再只看任务阶段，还看本次 prompt 里带了什么。

### 3.2 必读条件的四种类型（narrative-writer 表逐行归类）

| 条件类型 | 行实例（原文节选） |
|---|---|
| A. 任务阶段触发 | writing-craft「**产出正文全程**（首稿/重写/补写，落笔前必读）」；opening-design「**开新书、或写前 3 章时**（落笔前）」；quality-checklist「**审查/评分任务时**」 |
| B. 输入载荷触发 | emotional-arc-design「**prompt 给了 目标情绪 或 selected_emotion_module 时**」；genre-prose-cards「**prompt 给了 genre_prose_card 时**：题材已知直接读单卡，题材未知先读索引」；dialogue-mastery「**本章有对话或台词时**」 |
| C. 兜底触发（fallback chain） | style-genre-modules「**genre-prose-cards 索引无匹配题材单卡时**（通用流派兜底）」 |
| D. 全程常驻 | banned-words「**产出或修改正文时**（Gate A 禁用词，出现即修）」 |

行序即优先序：writing-craft 与 banned-words 排最前（全程必读），兜底类排最后。architect 表同构：hooks-chapter「**写章首/章尾钩子时**（含三翻四震结构）」、outline-methods「**建/补大纲或细纲时**（落笔前必读）」等。

### 3.3 配套的「查无 ≠ 不存在」停止条件（explorer，同 commit）

背景（commit message 自述）：Glob 对「查无」与「拼错」同样静默返回空，上一轮事故中 agent 把书名拼错当成书不存在，走「字段缺失」回退条款**静默换书**，把另一本书的情绪模块当正常结果返回。修复要点（story-explorer.md diff 原文节选）：

- 「**路径一律用字段值逐字拼接**：不添加《》等任何装饰、不改一字——拼错时 Glob 只会静默返回空，与『书不存在』无法区分」；
- 主对标探不到书目录 → 返回 `gaps.benchmark_book_missing: true` + `expected_path`（原样写入实际探测路径供核对），`results` 置空**停止**，「不得改用其他书，也不得走下面的缺失回退」；
- 分类正交化：「书目录存在但缺 `文风.md` 归 `profile_missing`，不占用本分类」（探针是目录下任意文件——「Glob 不接受纯目录模式，`{书名}/` 恒返回空」）。

→ 这是从「加载条件」延伸出的**加载失败分类学**：missing（可降级）/ corrupt-checkpoint（必须停）/ path-missing-but-book-exists（换错误码不换行为）三类不得互相吞并。

### 3.4 skill 级三层路由体系（pin long-write SKILL.md）

1. **场景路由表**（参考资料索引，L242 起）：Phase 1-5 各一张「场景 → 加载文件」两列表，如 Phase 4「打斗/装逼 → references/style-combat-face.md」。开头明示「按场景加载，不一次全部加载」。
2. **产物映射表**（L160 附近）：`文件 | 粒度 | 创建阶段 | 读取时机` 四列，覆盖 设定/大纲/追踪/对标/参考资料 全部 artifact，读取时机列写明条件（如「日更每章整份读」「久别角色按名读取一个小快照」「日更不读」）。这是 skill 级的条件化加载总表。
3. **横切主题权威文件表**（L305 起）：「主题 | 权威文件（先读）| 配套文件（按角度补充）」，并为项目级权威让位：「情绪模块：**对标/{书名}/剧情/情绪模块.md（项目/书级权威）**；无对标或设计新模块时再读 plot-emotion-system.md……不得覆盖对标书权威模块」。

### 3.5 缺失处理矩阵（SKILL.md「缺失文件处理」6 条，L190 附近）

六条规则构成 fail-fast/degrade 二分：角色状态缺失→先 `check` 再重跑事务，禁止手写推断；可选子目录缺失→跳过该模块；情绪模块/节奏缺失→**必须停下**置 `missing_primary_contract: true` + `repair_action`；对标文风缺失但有自定义文风→降级续写、否则 fail-fast（完全无对标项目则整段跳过不阻塞）；伏笔/时间线缺失→视为检查点损坏停止写正文；题材提示卡缺失→不阻塞、写前即时生成。另有独立的「权威优先级」三条（情绪模块 > 节奏 > 文风；自定义文风优先于对标文风，硬安全线归一除外）。

---

## 4. Q3 · tracking_commit.py 追踪事务门（重点解剖）

来源：`~/t30-tmp/oh-story/skills/story-long-write/scripts/tracking_commit.py`（1139 行，review/import 目录各有同内容副本）；协议文档 `skills/story-long-write/references/tracking-transaction.md`（161 行）；hook 层 `skills/story-setup/references/templates/hooks/story_hook_core.js` + `guard-outline-before-prose.sh`。引入史：CHANGELOG L122-141（v0.7.3 单一权威事务模型 #269 #290 #289；后续修 #306 context 字段说明、#305 Claude 侧缺门）。

### 4.1 架构：一个权威 + 多个派生（tracking-transaction.md 权威层表）

| 层级 | 文件 | 语义 |
|---|---|---|
| 唯一权威 | `追踪/_tracking-state.json` | schema、最后提交章、导入截止章、state_revision、上下文结构、全部当前角色/伏笔/时间线状态 |
| 章节记录 | `逐章记录/第NNN章.md` | 本章连续性紧凑变化；目标 ≤1536B、硬上限 3072B |
| 派生视图 | 上下文.md（固定 7 栏 ≤12288B）、角色状态/{名}.md（≤4096 目标/8192 硬上限）、伏笔.md、时间线/{作者真相,读者已知}.md | 完全由权威 JSON 生成，「禁止手改，不作为程序输入」，工具不反向解析 Markdown |

模块 docstring 一句话架构：「The language model supplies compact semantic JSON. This tool validates and merges that input in memory, renders every derived view, then atomically writes `_tracking-state.json` last as the single commit point. One book project has one serial writer; concurrent commits are intentionally unsupported.」

### 4.2 三子命令与双版本号

- `init --project --input`：仅当 `_tracking-state.json` 不存在时执行（「init never overwrites project state」）；遇旧追踪结构先整体移入 `追踪/_旧追踪存档/` 再原地建新协议，校验失败的 init 不动任何文件。
- `commit --project --input`：读权威态 → 内存合并/引用检查/视图渲染/容量检查 → 写逐章记录+派生视图 → 最后原子替换权威 JSON（mkstemp + fsync + `os.replace`）。
- `check --project`：重渲染全部视图并与磁盘逐字节比较；校验逐章记录连续性/规范文件名/体积上限、上下文卡恰好 7 栏且 ≤12288B、角色快照文件集合一致。
- 双版本常量：`INPUT_SCHEMA_VERSION = 1`（事务文档格式）与 `TRACKING_SCHEMA_VERSION = 4`(权威态格式) 分离演进；schema 不符直接拒（hook 层同判：「不是当前 schema_version=4；停止写正文……不保留旧结构兼容路径」）。

### 4.3 六道校验门（堵什么漏洞 / 校验什么）

1. **CAS 门（stale transaction）**：`require(expected_revision == state["state_revision"], "tracking state changed since this transaction was prepared")`。协议文档明确其语义边界：「`expected_state_revision` 用于拒绝基于旧状态构造的顺序 stale transaction，**不是并发锁**」。
2. **章序不变量**：append 必须 `chapter == last_committed_chapter + 1`；revision 必须 `chapter <= last`（不能改写未写的章）。第 0 章项目不得有已埋伏笔/既成时间线事实。
3. **显式退役门（防静默丢历史裁定）**：context 是整份提交的当前值，凡上一版有、本次没有的条目必须逐条列进 `delta.retired_context_items`，否则在任何写入前拒绝——报错原文「context items were dropped without being declared in delta.retired_context_items」。实际退役条目由工具写进本章记录 `## 本章退役登记` 留档可查。
4. **退役时态门**：`retired_characters` 只许出现在 append（「修订记录属于被改写的旧章，落在那里会谎报退役发生的章节」）；同一事务不能既退役又提交同一角色快照；退役角色不得仍列在 `active_character_names`。
5. **容量双档门**：target 档超限只 WARNING（stderr），hard-max 档超限在写入前拒绝（delta 1536/3072B、热上下文 8192/12288B、角色快照 4096/8192B）。CHANGELOG 注明动机：日更每章必读从五个文件收缩到三项，「读取成本 O(N²)→O(N)」。
6. **append 幂等门**：同章 append 且逐章记录已存在时，要求与将生成内容完全一致，否则「chapter delta N already exists with different content」——手写的逐章记录会永久撞死此门，删除手写文件后重跑原事务即可恢复。

另有跨平台细节：角色名 NFC casefold 去重、Windows 保留名/非法文件名字符校验、stdout 直写 UTF-8 绕开 Windows cp1252。

### 4.4 失败三分法（校验失败≠写入失败≠漂移）

tracking-transaction.md 与 workflow-chapter.md 步骤 12 的收敛表述（CHANGELOG 记此为对「恢复指令不收敛」的修复）：

| 失败类 | 判定 | 恢复动作 |
|---|---|---|
| 写入失败 | `_tracking-state.json` 未推进 | 保留原事务 JSON，修正环境后**重跑同一份 commit** |
| 校验失败 | 字段非法/退役未声明/容量超限 | 按报错**改事务本身**再提交；重跑同一份结果不变 |
| 派生视图漂移 | `check` 报「derived view differs from _tracking-state.json」 | 提交该章 `mode=revision` 事务让工具**整份重建**（expected_state_revision 读权威 JSON 的 state_revision——check 失败只往 stderr 打 ERROR、不输出 JSON） |

成功输出紧凑 JSON `{last_committed_chapter, state_revision}`；一切校验错误 exit code 2。

### 4.5 hook 强制层：把门装进写入路径（issue #305）

- `story_hook_core.js` `trackingCheckpointIssue(book, requireState, expectedLastCommitted)`（L107-152）：state 缺失且有正文→拦（给迁移指引）；JSON 不可解析→拦；schema≠4→拦；state_revision 非整数→拦；**派生一致性探针**：从 `上下文.md` 抽「状态修订：N」与权威 JSON 的 state_revision 比对，不一致→给出 revision 重建指引；**首建章序门**：首建第 N+1 章而追踪只提交到 N-1→「首建第N+1章前必须先提交第N章追踪事务」。
- `continuityFindings()`（L157+，advisory 非 blocking）：正文 mtime 新于 `上下文.md` →「正文已更新到「…」但续写状态卡更早——为该章提交 tracking_commit.py 事务」；上下文卡 >12288B → 超预算提醒。
- 接线：`guard-outline-before-prose.sh`（PreToolUse，Write 正文时）在细纲门之后调用共享核 `tracking-checkpoint` 子命令；注释自证漏洞史——「issue #305 之前这道门只进了 JS 核与 codex py，**Claude 侧独缺，会静默写出若干章无追踪的正文**」。降级原则：「node 缺席/核缺失一律放行（宁可漏拦不可误伤）」，SessionStart 提醒与批末 check 兜底。
- 权限边界配套修复（CHANGELOG L141）：story-explorer / consistency-checker 是只读 agent、按设计禁 Bash，改为**消费主会话跑完 `check` 后传入的章号与修订号**——「权限边界不动，也不把随章数增长的完整 state 读进 prompt」。（§G.2 第 4 条 narrative-writer「规则挂在无法执行的命令上」的同族修复。）

### 4.6 与墨舟 ChapterCommit 的同构映射

| oh-story 机制 | 墨舟 ChapterCommit 对应位 |
|---|---|
| LLM 只交语义 JSON delta，确定性脚本校验合并 | 同构：模型产出与状态写入分离，写入路径全部确定性 |
| `_tracking-state.json` 唯一权威 + 派生视图禁手改 | 权威事件流/状态 + 可重建投影 |
| `expected_state_revision` CAS（非并发锁，单写者串行） | 乐观并发控制 + 显式「这不是锁」的语义边界声明 |
| append / revision 两类事务 + 章序不变量 | 追加/修订两类提交 + 序号不变量 |
| 退役必须显式声明，漏写在写入前拒绝 | 防静默丢裁定的显式 diff 门 |
| target/hard-max 双档容量预算 | 上下文预算治理（警告档 + 拒绝档） |
| 失败三分法（重跑同一份 / 改事务 / revision 重建） | 失败分类学写进 recipe，而非临场发挥 |
| PreToolUse hook 强制 + 宁漏拦不误伤降级 | 事务门钩子位（§5 F12） |
| schema_version 双轨（输入 v1 / 状态 v4） | recipe 与其管理的数据分别版本化 |

---

## 5. Q4 · CapabilityRecipe 候选字段表（供 grilling 出题）

置信度：★★★ = 多处上游实证且跨 skill 一致；★★ = 单点实证；★ = 推断。「出处」均为 pin `9d0bd5f` 下路径（缩写 `~/oh-story` = `~/t30-tmp/oh-story`）。

| # | 字段（建议名） | 类型 | 内容 | 出处（上游实证除非标注推断） | 置信 |
|---|---|---|---|---|---|
| F1 | `id` | string kebab-case | recipe 标识 | frontmatter `name`，13 个 skill 全一致 | ★★★ |
| F2 | `recipeVersion` | semver string | 每 recipe 独立演进（setup 1.2.7、short-analyze 3.0.0、多数 1.0.0） | frontmatter `version`；注意与被管数据的 schema_version 双轨（F13） | ★★★ |
| F3 | `source` | {repo, commit, license} | 出处钉扎 | frontmatter `metadata.openclaw.source` 只存 repo URL；commit pin + license 为**推断扩展**（上游靠 git 与根 LICENSE 承载） | ★★ |
| F4 | `brief` | {capability, runtimeSemantics, triggers[]} | 把三段式 description 结构化：能力句/运行与降级语义/触发词枚举 | 各 SKILL.md description（§2.2）；结构化为推断 | ★★ |
| F5 | `taskType` | enum/映射 | 映射墨舟事件 schema 的 taskType（recipe_version 已被引用但零定义） | **推断**：上游以 skill 名 + Phase 路由隐式表达，无显式字段 | ★ |
| F6 | `entry` | {routerDoc, phases[], stopPoints[]} | 入口指令与停靠点（「裸调用与停靠点（防失控）」）、workflow 分载规则 | `~/oh-story/skills/story-long-write/SKILL.md` §裸调用/L222 流程衔接/L236 参考资料索引 | ★★★ |
| F7 | `references[]` | [{path, loadCondition}] | loadCondition 四型：阶段触发/输入触发(prompt 给了 X)/兜底触发/全程常驻；双向禁令（命中必读·禁跳过；未命中·禁预加载） | `templates/agents/narrative-writer.md` 必读条件表（pin diff）；SKILL.md 场景路由表 + 横切主题权威表 | ★★★ |
| F8 | `artifacts[]` | [{path, granularity, createdPhase, readTiming, sizeBudget{target,max}}] | 产物契约：何时创建、何时读、多大 | SKILL.md 产物映射表（四列）；追踪文件体积节（1536/3072 等） | ★★★ |
| F9 | `failureMatrix` | [{condition, action}] | missing→repair / optional→skip / primary-contract-missing→fail-fast+repair_action / drift→revision 重建；降级阶梯 full→lean→solo、rubric embedded fallback | SKILL.md 缺失文件处理 6 条；story-review/SKILL.md Phase 0 预检与降级（Fallback: … -> solo 六种） | ★★★ |
| F10 | `authorityOrder` | [{subject, authoritativePath, fallbackPath}] | 项目级权威压过方法论默认；冲突裁决条款 | SKILL.md 权威优先级 3 条 + 横切主题表「不得覆盖对标书权威模块」；五列细纲表「与本表冲突时以权威副本为准」 | ★★★ |
| F11 | `prechecks[]` | [{script, args, severityPolicy, retryPolicy}] | 确定性预检脚本位：只报告不改写、blocking/advisory 分级、blocking 重试上限后上报用户 | deslop SKILL.md L110「必须先运行本 skill 自带脚本，只报告不修改」+ `--check --fail-on=blocking`；workflow-chapter.md 确定性收尾/退化防护（blocking 最多 2 次） | ★★★ |
| F12 | `trackingGate` | {authorityState, casField, transactionModes[], derivedViews[], budgets, failureTaxonomy, hookPoint} | 追踪事务门钩子位（§4 全套） | `scripts/tracking_commit.py` + tracking-transaction.md + story_hook_core.js/guard-outline-before-prose.sh（issue #305） | ★★★ |
| F13 | `schemaVersioning` | {inputSchemaVersion, stateSchemaVersion} | 事务输入与权威态分离版本化；不兼容即拒、不留兼容路径 | tracking_commit.py 常量区；hook「schema_version=4…不保留旧结构兼容路径」；RETIRED_TRACKING_PATHS 归档机制 | ★★★ |
| F14 | `compatibilityPolicy` | "none" \| 显式迁移路径 | 旧结构不解析、init 归档、迁移走专用入口（story-import 旧追踪迁移） | tracking-transaction.md 尾节；CHANGELOG L67 升级须知 | ★★★ |
| F15 | `deploymentContract` | {bundleVersionField, markerFile, mismatchPolicy} | 已部署产物版本协商：不一致发 Notice 不阻断、更高版本提示勿降级覆盖 | story-review SKILL.md L9（agents_version 25 / `.story-deployed`） | ★★ |
| F16 | `contextBudget` | {hotContextBytes, fixedSections[], perChapterReads} | 热上下文预算与固定栏目数（7 栏 ≤12288B）；日更必读收缩到三项 | tracking-transaction.md 续写状态卡节；CHANGELOG O(N²)→O(N) | ★★★ |
| F17 | `language` | policy | 回复语言跟随用户 + 中文排版规范引用 | SKILL.md「## 语言」节（多 skill 同款收尾） | ★★ |

**推断项汇总（grilling 时需单独盘问）**：F3 的 commit/license 字段化、F4 的结构化拆分、F5 taskType 本身。三者都是「上游隐式做法 → 墨舟显式字段」的升格，风险在于把上游没有约束过的东西冻结成硬 schema。

---

## 6. Q5 · MIT 出处标注格式建议（沿 §G.3 纪律）

1. **条目级脚注**（每个被炼化的方法论条目尾行）：
   > derived from worldwonderer/oh-story-claudecode@9d0bd5f (MIT)
2. **Recipe 字段化**（推荐，机器可查）：`source.repo = "worldwonderer/oh-story-claudecode"`、`source.commit = "9d0bd5f5aead707ddcdcf7d5f141b237e2ac464c"`（全 SHA 落库，短 SHA 仅展示）、`source.license = "MIT"`，另设 `refinedAt`/`refineNote` 记录炼化转写说明——与 F3 对齐。注意 pin 实际是 `v0.7.6-4`，标注一律以 SHA 为准、tag 只作人读别名。
3. **文件级批量声明**（整文件结构性借鉴时）：文件头部注明 `<!-- Anatomy reference: oh-story-claudecode@9d0bd5f skills/story-long-write/SKILL.md (MIT) -->` 类一行；逐字保留的上游文本块须单独标 quote 并附路径行号。
4. 勿抄边界沿 §G.4：多 CLI 适配层（hooks 部署机制本身）不入墨舟——本文引用它们仅作**机制实证**（门的存在性与失败模式），Schema 中对应为 F12/F15 的抽象槽位而非实现拷贝。

---

## 7. 风险与未决（供 grilling 追问）

- R1：pin=v0.7.6-4 的「+4」里只有 `9d0bd5f` 触及方法论文本，另三个是 cover/test/setup 修复——若 grilling 决定改用 tag `0a34c69`，会丢掉条件化加载表的最终形态（它就是 pin 本体），**不建议**。
- R2：上游 frontmatter 无参数 schema、无 machine-readable 加载条件——F7 的 loadCondition 若要冻结成结构化 DSL，是对上游自然语言的**形式化再创作**，需明确这是墨舟自有贡献并同样受 MIT 致谢保护范围之外的自主版权。
- R3：本地快照 CRLF 差异意味着未来做「本地 vs pin」自动比对必须忽略行尾，否则误报全绿/全红。
- R4：`~/t30-tmp/oh-story` 按纪律保留未删，主会话可直接复核（HEAD=9d0bd5f detached）。

## 8. 证据复核命令（主会话可用）

```bash
cd ~/t30-tmp/oh-story && git rev-parse HEAD          # 期望 9d0bd5f5aead707ddcf...464c
cd ~/t30-tmp/oh-story && git describe --tags         # v0.7.6-4-g9d0bd5f
cd ~/t30-tmp/oh-story && git log --oneline v0.7.6..9d0bd5f   # 4 个 post-tag commit
diff <(git -C ~/t30-tmp/oh-story show 9d0bd5f~1:skills/story-setup/references/templates/agents/narrative-writer.md) \
     <(git -C ~/t30-tmp/oh-story show 9d0bd5f:skills/story-setup/references/templates/agents/narrative-writer.md)  # 条件化表 before/after
tr -d '\r' < /home/a1691/.agents/skills/story-long-write/SKILL.md | head -8   # 本地 frontmatter（CRLF 需剥离）
```

*（完。本报告只读取证，除本文件外未写墨舟仓任何路径；未执行任何 git 写操作。）*
