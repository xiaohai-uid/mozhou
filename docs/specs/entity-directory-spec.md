---
date: 2026-08-23
description: '工单 #13 产出：实体目录层（Codex 对应物）Schema 与落点冻结——设定目录卡承载 ref/别名表/AI Context 四档/brief，slug 身份一经引用冻结，知情门禁与四档正交'
tags:
  - project-note
  - mozhou
---

# 实体目录 Schema：别名表/装配策略四档的落点（工单 #13 产出）

> 相关笔记：[[kernel-schema-draft]] · [[dual-plane-sync-spec]] · [[token-budget-assembly-spec]] · [[kernel-schema-decisions]]

> 状态：**已冻结**（2026-08-23，两轮 grilling 共 11 问全 A 通过）
> 前置：#4 kernel-schema.draft.ts · #6 dual-plane-sync-spec.md · #7 Context 查询 API 决议③④ · #8 token-budget-assembly-spec.md
> 上游：#7 雾区毕业项「实体目录与装配策略字段 Schema——决议③的四档需要一个家」

## 0. 一句话

实体目录 = `设定/<类型>/` 下**每实体一张 md 目录卡**：frontmatter 承载机器字段（`ref` / `name` / `aiContext` / `aliases` / `excludedPhrases` / `brief` / `tags`），正文区人读且永不整体入包；slug 身份一经引用即冻结；装配策略四档只裁决激活与否，secret.* 授权行与 POV 切片门禁中央强制、不受任何档位影响。

## 1. 根部决策（Q1-Q8）

| # | 问题 | 裁决 | 一句话依据 |
|---|------|------|-----------|
| Q1 | 落点形态 | **设定目录卡**（非第十柱内核实体、非集中配置对象） | #6 目录树 v2 已预留「设定/ 自由 md + 可选 ref:」，本票升格为正式 Schema；规划·宪法层保存即落盘，与叙事状态层正交；#4 冻结零触碰；YAML frontmatter 可 grep 可外部编辑 |
| Q2 | EntityRef 字符串内容 | **稳定人类可读 slug**（如 `char:lin-feng`），**一经引用即冻结** | #4 决策原文「以稳定字符串引用」；双平面哲学下 fact jsonl 行必须人读可手写；改名风险由别名表吸收（Q3） |
| Q3 | 别名表 Schema | `exact \| regex` 两类 + **卡级**排除词表 + 默认大小写不敏感（per-alias 可覆盖）+ **数组顺序即优先级** | 中文分词不可靠 ⇒ exact 全串匹配优先、regex 兜底变体；全局排除表是 Codex 都没有的复杂度，等真实需求 |
| Q4 | 四档字段 | 命名 `aiContext`（对齐 Codex AI Context 官方用语），默认 `'detected'`；`manual_pin` 维持运行期 AssemblyChannel，不持久化为第五档 | 钉选是动作不是配置；持久化会与 Receipt channel 语义打架 |
| Q5 | book/series 双作用域 | **v1 仅 book**，不预留 scope 字段；series 判出界记地图 Not yet specified | 工程原则：不为想象需求加字段；#9 受控增补先例，series 真来再补 |
| Q6 | AI 面内容 | frontmatter `brief?: string`（作者手写压缩面）；缺省回退 = 正文按 world_rule 档 truncateCap(512) 截断 | 正文区=人读面（Research「永不入 prompt」纪律由此自然成立——只有 brief 进包）；回退保证零配置可用 |
| Q7 | 子目录对齐 | `设定/` 五子目录对齐 EntityRef 五前缀：`人物(char)/ 物品(item)/ 地点(location)/ 势力(faction)/ 概念(concept)`；原「世界/」并入概念 | 五目录五前缀一一映射消除整类归属歧义；走 #6 显式细化清单先例，不动冻结本体 |
| Q8 | tags | **收** `tags: string[]`，永不入包 | Codex 迁移清单 E.8「Tags 不入 AI 纪律」；一行字段换作者组织能力 |

## 2. 下游决策（Q9-Q11）

| # | 问题 | 裁决 | 一句话依据 |
|---|------|------|-----------|
| Q9 | 引用完整性双向规则 | **无卡引用合法**（目录是增强不是前置）；**悬空引用只警告不强拦**——外部改 `ref:` 或删卡后生成悬空引用清单呈作者，不自动迁移、不改历史追踪行 | 事实先行、建卡随后是正常工作流，否则每次提取都逼作者先建卡；jsonl 行级三分法没有「重写引用」操作，加了就破坏 append-only |
| Q10 | Always 档撑爆结构层 | **维持 #8「structuralCapTokens 超出 = 配置错误」纪律**，建卡/UI 侧实时预警（预警属实现票） | 溢出阀等于击穿两阶段预算地基；Always 的语义是「作者拍胸脯保证常驻」，自动降级让常驻变谎话——作者要的是看见超限，不是被静默兜底 |
| Q11 | 字段总表 | **照 §3 冻结**；`name` 单独成字段（显示名≠检测词），建卡时自动入 aliases 首位、作者可删 | 文件名只是皮（Q13 惯例），显示名必须显式；名字太泛的场景作者可自行移出检测集 |

## 3. 目录卡冻结 Schema

```yaml
# 设定/人物/林枫.md
ref: char:lin-feng          # 身份主键（EntityRef），一经引用冻结；文件名只是皮
name: 林枫                   # 规范显示名，可随时改；改名不回写 ref
aiContext: detected         # always | detected | detectedOff | never，默认 detected
aliases:                    # 数组顺序即优先级
  - { text: 林枫, kind: exact }        # 建卡时 name 自动入首位（作者可删）
  - { text: 枫儿, kind: exact }
  - { text: 林(小)?枫, kind: regex }   # caseSensitive 省略 = false
excludedPhrases: [枫叶林]    # 卡级排除词表：命中但不触发检测
brief: >-                   # AI 面；缺省回退 = 正文按 world_rule 截断 512
  青云宗外门弟子，身怀雷灵根……
tags: [主角, 雷系]           # 永不入包
```

字段表：

| 字段 | 类型 | 必填 | 语义 |
|------|------|------|------|
| `ref` | `EntityRef`（五前缀 slug） | ✅ | 身份主键，一经引用冻结；全书唯一，重复 = 结构校验失败 |
| `name` | `string` | ✅ | 规范显示名；改名只动此字段 + 别名表 |
| `aiContext` | `'always' \| 'detected' \| 'detectedOff' \| 'never'` | ⬜ 默认 `'detected'` | 装配策略四档（#7 决议③） |
| `aliases` | `{ text, kind: 'exact'\|'regex', caseSensitive? }[]` | ⬜ | 检测表，数组顺序即优先级；`caseSensitive` 默认 `false`（仅影响拉丁字母） |
| `excludedPhrases` | `string[]` | ⬜ | 卡级排除词表 |
| `brief` | `string` | ⬜ | 进 prompt 的压缩面；缺省回退正文 world_rule 截断 |
| `tags` | `string[]` | ⬜ | 作者组织用，永不入包 |

正文区：人读自由内容，**永不整体入包**（AI 面仅 `brief` 或其回退截断）。

类型面落点：`kernel-schema.draft.ts` §10 受控增补 `AiContextTier` / `AliasRule` / `EntityCardFrontmatter`（规划·宪法层工件接口，非九柱实体、不进追踪 jsonl、不扩 `EntityKind`）。

## 4. 身份与改名规则

1. **slug 冻结**：`ref` 一经任何追踪行或卡片引用即冻结；应用内不提供改 `ref` 入口。
2. **改名流程**：作者改 `name` ⇒ 旧显示名建议自动追加为 `exact` 别名（工具辅助）；外部改名走结构校验直接吸收（规划层工件，S2 不触发对账）。
3. **悬空引用清单**：外部改 `ref:` 或删卡后，结构校验生成「哪些追踪行指向不再存在的 slug」清单呈作者；不自动迁移、不改历史行。
4. **删卡**：物理删 + 悬空清单；追踪行原样保留（append-only）。
5. 文件名只是皮——重命名/移动文件不断链，watcher 按 `ref` 归并（Q13 身份规则延续）。

## 5. 检测与装配接线

| 关注点 | 裁决 |
|--------|------|
| keyword 通道 | 消费 `aliases`（exact/regex × caseSensitive）− `excludedPhrases`；命中 ⇒ 该实体入候选集（#7 决议②三通道之一） |
| graph_khop / embedding | 不消费别名表（实体 id 直引），无本票改动 |
| `aiContext: always` | 注入点 = structural.sections（决议③「常驻高优先」），受 `structuralCapTokens` 约束，**超出 = 配置错误**（#8 不变量延伸，见 Q10） |
| `aiContext: never` | 不入包；与门禁无关——门禁是中央强制，never 只是档位 |
| `manual_pin` | 运行期动作（AssemblyChannel 已冻结），不持久化 |
| Receipt tier | 目录卡条目归 `world_rule` 档（rank 2, defaultTrim truncated）；brief 本就紧凑，截断罕触发 |
| 检测扫描面/时机 | 出界（实现票）；本票只冻 Schema |

## 6. 不变量

| # | 不变量 |
|---|--------|
| D1 | 四档仅裁决激活与否；secret.* 授权行 + POV 切片中央强制，任何档位（含 always / never / manual_pin）不得绕过（#7 决议④落字） |
| D2 | `ref` 一经引用即冻结；全书唯一 |
| D3 | 正文区永不整体入包；只有 `brief`（或其 world_rule 回退截断）进包 |
| D4 | `tags` 永不入包 |
| D5 | Always 卡属结构层注入，受 structuralCapTokens 约束，超出 = 配置错误 |
| D6 | 无卡引用合法；检测只覆盖有卡实体 |
| D7 | 悬空引用只产清单警告，不自动迁移、不改历史追踪行 |
| D8 | 目录卡是 canon 文件：纳入 hash 基线、写前校验（S3）、确定性重建扫描（S5）；规划·宪法层保存即落盘（不进 commit 门控） |

## 7. 相对既有冻结的显式细化清单

1. **#6 dual-plane-sync-spec.md**：`设定/` 子目录从「人物/ 世界/ 地点/ 势力」四目改为「人物/ 物品/ 地点/ 势力/ 概念」五目对齐 EntityRef 五前缀（原「世界/」并入概念，物品目录新增）；「Codex 自由 md（可选 ref:）」升格为正式目录卡 Schema（ref: 由可选变必填身份字段）。树图已同步修订。
2. **#4 kernel-schema.draft.ts**：**零触碰**——不扩 `EntityKind`、不改 `EntityRef` 类型（模板字面量内部格式本就未冻结，本票只定其内容约定）；增补为文件末尾 §10 独立节。
3. **#8 token-budget-assembly-spec.md**：无字段改动；D5 是既有「超出=配置错误」不变量对 Always 注入点的显式重申。

## 8. 出界清单

- **series 级作用域**（多书同宇宙）：kernel 无 series 实体，判出界记地图 Not yet specified；受控增补先例已备。
- **检测算法实现**（正则方言、扫描面与时机、性能）：实现票。
- **Mentions 反向索引**（Codex 五域提及热力条对应物）：运行时投影（`.mozhou/indexes/`），非正典 Schema。
- **建卡来源**（手动向导 / 提取管线自动建草稿卡）：数据飞轮阶段。
- **超限预警 UI**：实现票（纪律已在 D5 冻结）。

## 9. 验收对照（地图 Destination 判据）

- [x] 目录卡 frontmatter 字段集冻结（§3，Q11）
- [x] EntityRef 内容约定冻结（§1 Q2 + §4）
- [x] 别名表/排除词表 Schema 冻结（§3，Q3）
- [x] 四档字段名、默认值、门禁隔离冻结（§1 Q4 + §6 D1）
- [x] book/series 裁决（§1 Q5 + §8）
- [x] AI 面内容面冻结（§1 Q6 + §6 D3）
- [x] 引用完整性双向规则冻结（§2 Q9 + §6 D6/D7）
- [x] Always 超限纪律冻结（§2 Q10 + §6 D5）
- [x] `kernel-schema.draft.ts` §10 受控增补，tsc strict 零错误
- [x] #6 目录树细化落字（§7.1）
- [x] CONTEXT.md 词条补齐（实体目录卡 / 实体引用 / 装配策略四档）
