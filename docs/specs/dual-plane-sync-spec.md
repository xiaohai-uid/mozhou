---
date: 2026-08-23
description: '工单 #6 产出：双平面同步语义冻结——分层触发/写前校验/五态对账协议/frontmatter 身份制/书籍目录树 v2，Q1-Q15 两轮 grilling 决策全录'
tags:
  - project-note
  - mozhou
---

# 双平面同步语义与书籍目录树布局（工单 #6 产出）

> 相关笔记：[[kernel-schema-decisions]] · [[kernel-schema-draft]] · [[ADR-0010 External Edit Reconciliation]] · [[MoZhou Wayfinder 地图]]

- **状态**：冻结 v1（随 wayfinder 工单 [#6](https://github.com/xiaohai-uid/mozhou/issues/6) 收口）
- **规范性输入**：ADR-0006（双平面存储）、ADR-0010（hash 对账协议方向）、ADR-0019 §4（保护位/stale）、规格 US#18-20、`kernel-schema.draft.ts`（同步对象 = 已冻结实体）
- **决策过程**：两轮 grilling 共 15 问（Q1-Q15），全部由作者拍板

## 根部决策（Q1-Q7）

| # | 决策 | 选择 | 一句话依据 |
|---|------|------|-----------|
| Q1 | 同步触发总模型 | **分层混合**：规划/宪法层保存即落盘；叙事状态层 ChapterCommit 门控 | 候选态不该污染人读正典；规划工作不能等 commit |
| Q2 | 未提交草稿正文位置 | **草稿即正文文件**（`phase: draft\|committed` 相位机） | `.mozhou/` 隔离会断掉外部编辑器核心场景（US#18/19） |
| Q3 | 投影更新时机 | **write-through 同步**：文件写成功 → 同一逻辑操作内刷投影，失败即报错 | 本地单机毫秒级写入；投影落后窗口让编译器读脏状态 |
| Q4 | 外部修改检测面 | **启动必检 + 运行期 watcher**（mtime 预筛 + hash 复核） | 与 Obsidian 并行使用是核心场景；承诺语义="最终必被检出" |
| Q5 | hash 基线存放 | **`.mozhou/manifest.json`** + rebuild=全量吸收 | SQLite 可弃 ⇒ 基线必须在文件侧 |
| Q6 | 目录树 v2 | ADR-0006 草案细化版（见下节） | 新实体逐个安家，不推翻原结构 |
| Q7 | 多书工作区 | **一书一目录**：打开目录 = 打开一本书 | 文件管理器就是书架；多一层注册表无真实需求 |

### 分层表（Q1 的唯一答案集）

| 实体 | 层 | 落盘时机 |
|------|----|---------|
| AuthorIntent / OutlineNode / Scene / 作者手动创建的 NarrativePromise / StyleProfile | 规划·宪法层 | 应用内保存即写 canon + write-through 投影 |
| TemporalFact / KnowledgeState / RelationshipState / TimelineEvent 的 delta、AI 提取的候选态 | 叙事状态层 | 仅在 ChapterCommit 时 append 进追踪 jsonl；运行期驻留候选态，崩溃丢失可接受（重跑提取） |
| ChapterCommit | 事务单元 | 原子写三件套：正文 md + 追踪 jsonl 增量 + events.jsonl 事件 |

- StyleProfile 的飞轮 EMA 平滑结果同属即时层（算完即落盘）。
- 正文文件相位机：`draft ⇄ committed`。已提交章节在应用内重新编辑 ⇒ 相位移回 `draft`，再提交产生**新** ChapterCommit（旧 commit 永不修改，I5）；重提交管线内部属于十步事务票领地。
- **只有 `phase=committed` 的文件，其外部修改才触发 EXTERNAL_MODIFIED 对账**；草稿随便改。

## 书籍目录树 v2（Q6/Q7 冻结）

```
<书名>/                          # 一书一目录 = 打开一本书
├── book.json                    # BookRecord（id/title/revision/createdAt/updatedAt）
├── 正文/
│   └── 第一卷/
│       └── 第0001章.md          # 正文章文件（draft 或 committed）
├── 大纲/
│   ├── 总纲.md                  # BookNode
│   ├── 第一卷.md                # VolumeNode
│   ├── 第一卷-01-风起.md        # ArcNode（命名自由，身份在 frontmatter）
│   └── 章节/
│       └── 第0001章.md          # ChapterNode 规划态 + scenes[] 数组（Scene 安家处）
├── 设定/
│   ├── 作者意图.md              # AuthorIntent
│   └── 人物/ 世界/ 地点/ 势力/  # Codex 自由 md（可选 ref: 字段声明 EntityRef 映射）
├── 追踪/                        # 叙事状态层真源
│   ├── 事实.jsonl               # TemporalFact[]（压缩留行，I6）
│   ├── 认知.jsonl               # KnowledgeState[]
│   ├── 关系.jsonl               # RelationshipState[]
│   ├── 伏笔.jsonl               # NarrativePromise[]
│   └── 时间线.jsonl             # TimelineEvent[]
├── 摘要/
│   └── 第一卷-压缩摘要.md       # State Compaction 产物（compactedIntoVolumeId 指向处）
├── 文风.md                      # StyleProfile × scenarioType
├── 市场/
│   ├── market-brief.md
│   └── benchmarks/
└── .mozhou/                     # 运行时区：非正典、不参与对账
    ├── runtime.sqlite           # 可弃投影
    ├── events.jsonl             # Event Ledger：纯审计
    ├── manifest.json            # hash 基线
    ├── receipts/                # ContextReceipt 存档（审计产物）
    ├── snapshots/               # 回滚数据源（整书时间点快照）
    ├── indexes/
    └── embeddings/
```

安家要点：Scene 是规划层实体，挂章大纲文件的 YAML 数组里，**不进**追踪 jsonl；commit packet 拆两半——正文进 md、五族 delta 内嵌全记录逐行 append 追踪 jsonl，DependencyManifest/receipt 引用留在 events 侧。

## EXTERNAL_MODIFIED 对账协议细化（Q8-Q12）

### 提案生命周期（Q8/Q11）

```
detected → extracting → awaiting_author → applied | partially_applied | dismissed
               └→ extract_failed（一键重试 → extracting）
```

- 触发源三种：启动扫描、watcher、写前校验（见下）。
- **对账门粒度**：逐条取舍为主界面（接受 / 拒绝 / 编辑后接受），附「全部接受」「全部跳过」批量钮。
- 关键语义：**拒绝一条 delta ≠ 回滚文件**——文件保持作者改后的样子，仅该提取断言不升格为正典实体；基线 hash 无论取舍照常更新。
- 落库 delta 的 `provenance.origin='external'`。
- 软门禁：对账未决期间，以受影响章节为目标的 Context 编译任务给警告（旧投影仍可用、可强行编译，receipt 留痕），不硬阻塞。
- `extract_failed` 不阻塞其他文件的对账，也不阻塞写作（对账只影响叙事状态层）；失败详情记 events.jsonl。

### 写前校验统一纪律（Q9）

**所有应用侧写文件动作之前，先核对该文件盘上 hash 是否等于基线**；不等 ⇒ 挂起本次写入、转入对账流程，应用缓冲作为「本地候选版本」与盘上版本一起呈作者二选一（载入盘上版 / 以缓冲覆盖）。单一规则覆盖正文、jsonl、大纲全部文件类型，杜绝自动保存无声覆盖外部修改的双脏事故。

### 保护位 × 外部编辑（Q10）

保护位**跟随工件而非编辑通道**：对账落库时 `origin` 置 `'external'`，`protectedUserContent` 继承原值。I1 只禁自动化通道，人手的外部编辑不在禁令范围。

### 追踪 jsonl 行级语义（Q12）

| 外部操作 | 语义 |
|---------|------|
| 新增行 | id 前缀/格式 + 字段校验通过 ⇒ 直接验收为新正典实体（`origin='author'`、保护位 true）；失败 ⇒ 该行进解析失败清单，不入库 |
| 修改行 | 实体级 EXTERNAL_MODIFIED 提案，走对账门 |
| 删除行 | 确认提案：默认建议逻辑退役（fact→validUntil 封口或 status='rejected'；promise→abandoned；relationship→validUntil 封口；knowledge→直接删行，I3 本就级联失效；timeline→仅允许显式确认后物理删），坚持物理删则执行——历史事件仍在 append-only 账本里，回放链不断 |

## frontmatter 冻结格式（Q13）

- **范围**：仅内核实体文件——正文章 md、大纲四层节点 md、`设定/作者意图.md`；Codex 自由 md 可选 `ref:` 字段声明 EntityRef 映射，其余不冻。
- **格式**：YAML frontmatter 承载机器字段，正文区承载人读内容；Scene 以 `scenes:` YAML 数组挂在章大纲文件里（`{id, orderIndex, povEntity, status, summary, beats[{description, intentionNote?}]}`，多行文本用块标量）。
- **字段集**：`mozhouId`、`nodeType/kind`、`parentId`、`orderIndex`、`revision`、`status`、`originAuthor`、`protected`、`dependencyNodeIds`（大纲章）；正文章文件额外：`chapterIndex`、`phase: draft|committed`、`commitId?`。
- **身份规则**：id 在 frontmatter，文件名只是皮——作者重命名/移动文件不断链，watcher 按 id 归并 rename 事件。

## 摘要与运行时区的边界（Q14/Q15）

- **摘要文件按规划层真源对待**：即时层落盘；外部修改经结构校验后直接吸收，不走 LLM 提取（它本就是给人读的摘要，无可提取的状态机）；作者动过之后该文件 `protectedUserContent=true`，此后自动压缩通道只能生成新版本文件（如 `第一卷-压缩摘要.v2.md`），不得覆盖作者手稿（I1）。
- **恢复三权分立**：
  1. **canon 文件**是唯一恢复输入——`runtime.sqlite` 丢失 ⇒ 纯确定性扫描 MD/JSONL 重建全部已确认状态 + 新基线（**无 LLM 参与**）；
  2. **events.jsonl** 是纯审计账本（喂 Session Replay 与飞轮），不承担恢复职责；
  3. **snapshots/** 是整书目录（含 `.mozhou`）时间点快照，回滚机制的数据源；快照时机 = 每次 ChapterCommit 后 + 手动触发，保留策略留给实现工单。
- LLM 提取只存在于两处：commit 管线内、对账管线内。重建永远不需要它。

## 同步不变量汇总

| # | 不变量 |
|---|--------|
| S1 | 投影新鲜度 ≤ 文件新鲜度（write-through 保证）；任何不一致以文件为准 |
| S2 | 只有 `phase=committed` 文件的外部修改触发对账；草稿自由改 |
| S3 | 应用侧任何写入前必过 hash 校验（写前校验） |
| S4 | 基线只记应用自己的写入；对账完成即更新基线，与 delta 取舍无关 |
| S5 | 重建纯确定性：canon 扫描即可恢复全部已确认状态，零 LLM |
| S6 | Ledger 不承担恢复职责；快照承担回滚 |
| S7 | 保护位跟随工件，不随编辑通道改变 |

## 相对既有 ADR 的显式细化清单

1. **ADR-0006**：新增 `book.json`、`.mozhou/manifest.json`、`.mozhou/receipts/`；Arc 层文件明确；Scene 安家于章大纲文件；摘要文件获得保护规则。
2. **ADR-0010**：检测面从"启动时"扩为"启动必检 + 运行期 watcher"；提案细化为五态状态机 + 逐条取舍粒度；澄清拒绝 ≠ 回滚文件；新增 jsonl 行级三分法与写前校验前置防线。
3. **US#19**："launch 检测" ⊂ 启动必检，语义被 Q4 吸收并扩展。

## 验收对照（地图 Destination 判据）

- [x] 同步对象 = #4 冻结实体：每类实体的落盘时机有唯一答案（分层表）
- [x] 外部修改从检测到落库全程无临场设计决策（状态机 + 三分法 + 双脏协议）
- [x] "一本书长什么样"：目录树逐文件职责 + frontmatter 字段集冻结
- [x] 重建保证可验证：纯确定性扫描，可写成机械测试（L1 套件删库重建断言）
- [x] `LocalDataPlane` 四方法（writeCanonFile/readCanonFile/syncToProjection/rebuildProjectionFromCanon/verifyHash）语义齐备，实现工单可直接领取
