---
date: 2026-08-24
description: '#30 终稿：Novel Runtime 执行基底四路取证合稿——DSH 实证分档/双线碰撞裁决清单/oh-story 17 字段 Recipe 参照系/BYOK 三家五问对照，供 #31 grilling 直接出题'
tags:
  - mozhou
---

# T30 · Novel Runtime 执行基底取证总报告（终稿）

> 对应票：[研究票 #30](https://github.com/xiaohai-uid/mozhou/issues/30) · 地图 [#29](https://github.com/xiaohai-uid/mozhou/issues/29)
> 相关笔记：[[2026-08-23-wayfinder-phase-12]] · [[2026-08-24-wayfinder-phase-3-map]] · [[reference-retrospective-vol2-20260823]]
> 生产方式：三路并行子会话取证（A/C 由子会话完成；B 路子会话超时后由主会话按预案接管；D 路为主会话直做）+ 主会话合稿。**验收声明**：主会话对每路做了抽查复核——A 路两处事实修正实证吻合、C 路三项抽查（完整 SHA / 1139 行 / frontmatter 字段）全部命中、B 路（接管）全部结论出自 ~/t30-probes/ 一手文档快照；各路局限如实随文标注。

## 分章导航

| 路 | 文件 | 一句话发现 |
|---|---|---|
| A | [t30-a-runtime-and-routing.md](./t30-a-runtime-and-routing.md) | DSH 七要素全实证 + 两处修正卷二；Execution Seam 四方法各有生产对应物；**DSH 没有分级模型路由，那是墨舟增量** |
| B | [t30-b-byok-providers.md](./t30-b-byok-providers.md) | BYOK 三家五问取证（主会话接管完成）：**三家缓存机制互不相同且结构化输出两档分化**——adapter 需双协议栈+按家参数化前缀策略 |
| C | [t30-c-recipe-anatomy.md](./t30-c-recipe-anatomy.md) | oh-story pin `9d0bd5f`(=v0.7.6-4) 解剖：CapabilityRecipe **17 候选字段**（14 实证/3 推断）；tracking_commit.py 与 ChapterCommit 最同构 |
| D | [t30-d-upstream-convergence.md](./t30-d-upstream-convergence.md) | **master 已无关历史合流应用线**：新 ADR 0001-0007 撞号，任务/技能运行时已 accepted——执行基底从 greenfield 变双线裁决 |

## 0. 给 #31 grilling 的五条硬输入

1. **第一问必须是双线裁决**（D 路）：内核线 Execution Seam vs 应用线 lib/tasks + SkillRuntime——吸收/并存/取代。此题不先答，Recipe Schema 与模型路由的出题框架都无法定。
2. **分级模型路由是墨舟自有增量**（A 路 F4/§3）：DSH 只有「providers 注册表 + 单点全局默认」，它的"router"是推理模式路由不是模型路由——两者不得混称；墨舟需自建 `task_type→tier→(provider,model)` 间接层。
3. **CapabilityRecipe 要比上游更结构化**（C 路结论 1）：上游把触发词/降级语义全嵌自然语言 description，机器不可校验；17 候选字段中 F3 扩展/F4 结构化/F5 taskType 三项是推断升格，grilling 需单独盘问是否值得冻结成硬 schema。
4. **事件配对纪律有现成范本**（A 路 publishEvent 行）：DSH hook-protocol 的「turn 封闭 + invoked/result 成对」可直接抄给十步事件链（GenerationStarted↔Finished、CanonProposalCreated↔CanonCommitted），防半截事务。
5. **追踪事务门不必从零设计**（C 路 §4）：tracking_commit.py 的 CAS + 章序不变量 + 失败三分法 + hook 强制层，与 ChapterCommit 原子提交同构，CapabilityRecipe 的 `trackingGate` 槽位按此抽象。

## 1. 跨路交叉发现（合成层）

- **元数据不可信是常态**：A 路实证模型注册表跨 provider 异参（glm-5.2 四处 cw/maxTok 不一致）+ 手编 YAML 脏数据（前导空格 baseURL）；C 路实证上游 skill 元数据四版冻结但语义全在正文。两条证据汇流指向同一设计判断：**运行时与 Recipe 层都必须容忍缺失字段并保守兜底，产品化配置必须 UI 校验 + 连接测试（M18 的实证支撑）**。
- **「锁版本」出现在每一路**：A 路 override 锁版思想、C 路 pin-SHA 纪律（Gate A 写 v0.7.6 应以 SHA 为准）、D 路应用线契约 FROZEN 制——M14/M20 的双向钉死在三家证据里都是用 SHA/版本字段落地的，不是口头纪律。
- **失败面三分法反复出现**：A 路失败策略随注册声明（timeout/retry/fallback）、C 路 tracking 失败三分法（校验失败≠写入失败≠漂移）、D 路应用线 failed_recoverable/failed_terminal/state_degraded——#31 设计 Capability 契约的 Result 失败分类时有三套先例可对照收敛。

## 2. 各路净贡献对既有规格的修正

1. 卷二 §H.1 两处细节修正（session_projcache 在 `~/.dsh/storages/` 全局单文件；super-injector registry 仅 1 条活跃）——A 路
2. H.3 映射表「settings.yaml providers → 分级模型路由」表述降级为「注册表+单点默认」，分级路由是墨舟侧增量——A 路
3. Gate A M20 的 pin 表述精确化：`9d0bd5f` = tag v0.7.6 后第 4 个 commit（条件化加载表就是 pin 本体），标注一律以全 SHA 为准——C 路 R1

## 3. BYOK 五问 × 三家 × M18 落点对照（B 路接管完成，详表见[分章](./t30-b-byok-providers.md)）

| 维度 | 一句话结论 |
|---|---|
| SSE | 两套解析器不可避免：DS/GLM 共用 OpenAI 兼容 data-only 制；Claude 独用命名事件制（`event:` + typed JSON） |
| 结构化输出 | **两档分化**：DS/GLM 仅宽松 json_object（无 schema 校验、依赖 prompt 引导）；Claude 有真 json_schema + strict tools——M17 降级链宿主侧责任落在 adapter，三家都保留 |
| 缓存 | 三家机制互不相同：DS 自动 KV（hit/miss 双字段计费）、GLM 自动识别（cached_tokens）、Claude cache_control 双模+显式断点——「缓存友好前缀」必须按 provider 参数化 |
| 错误分类 | GLM 双层业务码最细 / DS HTTP 直码表 / Claude named error_type（含特征性 529 overloaded）——连接测试与失败分类归一化是 adapter 必做项 |
| base_url | 三家均可自定义端点；A 路 settings.yaml 字段结构可直接沿用 |

**交叉判断**：M18 四要素全部拿到实证支撑；其中「缓存友好前缀」从口号升级为「按家参数化的前缀策略 + 统一命中计量接口」的设计约束。

## 4. 给 #31 出题的建议清单（从四路蒸馏，非决议）

1. 双线裁决 → 决定后续所有题的框架（§0-1）
2. tier 间接层采纳与否 + 书内覆盖层是否进 V1（A 路明示此判断需产品侧输入）
3. CapabilityRecipe 17 字段逐块取舍：F1-F2/F6-F14 高置信可直接过，F3/F4/F5 推断项重点盘
4. trackingGate 槽位粒度：整槽采纳 vs 只留 hookPoint
5. 事件配对纪律写入 NovelRuntime 契约的形式（类型库统一持有 vs 各模块散写）
6. 密钥间接引用（apiKeyEnv→credentials refs）模式沿用与否
7. （视双线裁决结果）ADR 编号空间收口：新 ADR 从 0023 起 + 应用线重编号待议

## 5. 取证局限（汇总）

- A 路：zstd 未解压（无二进制）、宿主内核源码不在范围、change-ledger 空目录无样本、静态取证六条——详见其 §4
- C 路：pin 为 detached HEAD 待主会话复核命令见其 §8；本地快照 CRLF 差异影响未来自动比对
- D 路：仅读 origin/master git 对象与 issue 列表，app/ 源码实现细节与应用线 .scratch spec（在来源仓 C:\zcode\novel-ai）不可达
- B 路：静态文档抓取未发真实请求（连接测试/实际命中率待实现票验证）；GLM 错误码仅录关键六条；定价限额未取（非本票范围）
- 合稿纪律：本文件不引入四路之外的新事实；跨路综合仅做归纳不做拍板
