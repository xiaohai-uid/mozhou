---
date: 2026-08-24
description: "#30 A 路：~/.dsh 只读取证——@mozhou/runtime 最小形态分档与分级模型路由三落点对比"
tags: [mozhou]
---

# T30-A · Runtime 执行基底与模型路由取证（DSH 本机深钻）

> 对应 issue：xiaohai-uid/mozhou#30「Phase 3 Wayfinder 图研究」三路取证之 **A 路**｜上游基础：卷二 §H（[[reference-retrospective-vol2-20260823]]）
> 关联决策记录：[[0007-novel-runtime-event-architecture]] · [[0009-capability-registry-inspired-by-harness-architecture]] · 规格：[[spec-mozhou-novel-os-2.0]] · 体例范本：[[t9-local-embedding-feasibility]]
> 调查方式：**纯本地只读取证**（`~/.dsh/` DeepSeek Harness 本机安装，0.1.0-rc.6 web profile），不改 specs/ADRs、不拍板。
> 调查日期：2026-08-24。目标：在[[reference-retrospective-vol2-20260823]] §H.1 盘点基础上往深钻一层——逐要素给机制证据 + 墨舟 V1 分档建议，并解剖 `settings.yaml` 模型注册表以支撑 task_type→model 路由落点对比。

---

## 0. 结论速览

| # | 发现 | 对墨舟的含义 |
|---|---|---|
| F1 | 卷二 §H.1 七要素**全部实证存在**，且新增两处修正：`session_projcache.json` 实际在 `~/.dsh/storages/`（全局单文件），不在 session 目录内；super-injector 当前 registry 仅 1 条活跃注入 | §H.1 可作为已验证基线引用，两处细节按本报告修正 |
| F2 | Execution Seam 四方法在 DSH 各有真实对应物：registerCapability↔三级扩展位+插件 `inject[]` 声明、execute↔统一工具协议+失败策略声明、publishEvent↔`hook/*` 类型化事件 append API、replaySession↔投影(seq 对齐账本)+turn-rewind | ADR-0007/0009 的四方法不是抽象发明，每一个都有 DSH 生产先例可对照实现 |
| F3 | **DSH 没有 task_type→model 分级路由**。模型选择=`agent-default-model` 单点全局默认；所谓"路由"（router-standard 预设）是推理**模式**路由（spec/react/weak/mixed 行为带），不切模型 | 卷二 H.3「settings.yaml providers→分级模型路由」一行是**映射愿景而非 DSH 现状**；分级层是墨舟要自建的增量 |
| F4 | 注册表结构事实：model id 是 provider-scoped 复合键，同一模型跨 provider 元数据不一致（contextWindow 1000000 vs 1048576）；元数据可选性呈梯度（全字段→无 maxTokens→裸 id） | 墨舟路由解析必须用 `(provider, modelId)` 复合键 + 缺字段兜底；直接引用裸 model id 会脆 |
| F5 | 三落点对比的证据分布偏向**方案丙（包内默认+全局覆盖+书内覆盖）为骨架**：DSH 的 `agent-default-model` 即其二层简化版；但书内层是否进 V1 存在真实取舍，留给 grilling | 见 §3.3 |

---

## 1. Q1：@mozhou/runtime 最小形态——逐要素证据与分档

### 1.1 要素盘点（对卷二 §H.1 的验证与细化）

#### ① `~/.dsh/AGENTS.md` —— 指令与代码分离

- **机制**（证据：`~/.dsh/AGENTS.md`，4743 B）：会话基线自动加载的全局指令文件，内容为纯文本规则（vault-first 流程、工程原则七条、联网策略、WSL 环境说明），并显式声明优先级链（`CLAUDE.md > 本文件`）与生效范围。旁边有 `.bak-20260817-*` 两份备份——指令文件也走备份链演化。
- **分档建议：必要（机制）**。墨舟必然需要"作者偏好/书内宪法"这类指令注入层，且指令与代码分离是零成本高收益的形态。差异点：墨舟的作用域单位是"书"而非 workspace，指令层应下沉到书内文件。

#### ② `~/.dsh/settings.yaml` —— 声明式模型注册表

- **机制**（详见 §2）：顶层六键中 `llm-pi-ai.providers.*` 是完整的供应商/模型注册表（8 providers / 约 94 条模型目），`agent-default-model` 是唯一的模型路由点，`agent-presets.default` 指向推理模式预设。LLM 能力全部是配置声明，代码里没有模型名。
- **分档建议：必要**。BYOK 多供应商是 M18 冻结条目；注册表字段结构（§2.1）可直接作为 `@mozhou/runtime` 供应商适配层的参照系。

#### ③ `~/.dsh/profiles/web/package.json` —— 双清单装配制

- **机制**（证据：`profiles/web/package.json`，程序计数复核）：
  - `pnpm.overrides`：**28 个内核包**全部 pin 到 `0.1.0-rc.6`（含 `@deepseek-ai/cordis@4.0.1`）——内核稳定靠锁版本，不靠冻结代码；
  - `dsh.profile.bundles`：**23 个外挂插件**数组（UI 面板 ×6、通知/统计/宠物、automation、share、turn-rewind、super-injector、mode-boost、om-commands 等）；
  - `dependencies` 中 3 个 `link:` 本地 junction 依赖（mode-boost / super-injector / om-commands，已在 `node_modules/@dsh-external/` 验证为符号链接）、7 个 GitHub tarball 依赖——"装能力 = 加一行依赖 + bundles 加一项"。
- **分档建议：override 锁版思想必要，bundles 清单后置**。墨舟章节事务管线内核应从第一版就锁版本语义（monorepo 内 workspace 协议即可起步）；而"能力作为独立包进装配清单"依赖能力生态规模，V1 能力个位数时用代码内 `registerCapability` 更简单——这正是 H.5 建议一的正确读取方式：**双清单制是稳态形态，不是 V1 形态**。

#### ④ `cordis.patch.yml`（profile 级）—— 配置期补丁

- **机制**（证据：`profiles/web/cordis.patch.yml`，12508 B；根 `~/.dsh/cordis.patch.yml`）：YAML 数组形式的补丁链——`- insert:` 行向装配树追加条目（16 个 MCP 桥 + 1 个 hooks 注册），`- id: X / disabled: true` 行停用既有条目（3 个 Windows-only server），根补丁含 `# --- dsh-skin managed (auto-generated; do not edit) ---` 托管块；`.bak` 备份链 ×4（20260815/16/22 及 om 专用）。
- **关键结构事实**：每个 MCP insert 条目都声明 `transport`(stdio/streamable-http)、`command/args/env`、`toolCallTimeoutMs`（120s–600s 按能力定制）、`failOnStartupError: false`、`reconnect{enabled, initialDelayMs:1000, maxDelayMs:30000, maxAttempts:20}`——**外部能力的超时/重连/失败策略随注册声明，失败不拖垮宿主**。
- **分档建议：后置**。H.4 已判定手工 patch 文件是开发者运维产物，产品必须 UI 化为 Registry 管理。墨舟的对应物（风格包/题材包按 id 启停）V1 用 Registry 数据表 + UI 开关即可，不需要暴露文件级补丁层。

#### ⑤ `hooks.json` + `hooks/*.mjs` —— 外部进程钩子桥

- **机制**（证据：`~/.dsh/hooks.json`；`hooks/` 目录）：四个生命周期面（SessionStart/UserPromptSubmit/PostToolUse/Stop），每条 `{matcher, command}`。PostToolUse 用 matcher 精确圈工具（`web_search`、`write|edit|str_replace_editor`→vault 写校验）。钩子本体是外部进程，协议为 **stdin JSON → stdout JSON**（`om-classify-message.mjs` 头注与实现：读 fd 0、解析 `{prompt}`、命中信号才输出 `{"additionalContext": ...}`，否则静默退出）。
- **协议库佐证**（证据：`node_modules/@deepseek-ai/dsh-hook-protocol/lib/types/events.d.ts`，rc.6 物理存在的两个内核包之一）：包描述自称 "Shared Claude Code / Codex hook wire protocol: matcher engine, stdin/exit-code/stdout codec, multi-hook merge"；钩子调用被记为成对的 `hook/invoked` / `hook/result` 事件，类型注释明文约束 "must remain turn-enclosed and invoked/result paired"，结果记录携带 `decision/exitCode/stderrSummary(截断上限 500 字)/durationMs`——**钩子执行本身就是审计事件**。
- **分档建议：机制可选偏后置，思想必要**。V1 的一致性校验（Continuity Gate、canon-write 校验）应作为十步管线的**内联步骤**实现，不必引入"spawn 外部进程"这层间接；但两条 DSH 经验必须吸收：(a) 校验点挂在写动作之后且按工具/动作 matcher 圈定；(b) 校验行为本身落事件账本（成对、turn 封闭）。第三方扩展钩子协议留到生态期。

#### ⑥ `super-injector/` —— 运行期热注入

- **机制**（证据：目录三件套）：`registry.json`（当前 1 条活跃注入：`@dsh-external/dsh-om-commands`，带 ISO 时间戳）、`self-heal.log`（purge-stale-tools 自愈记录，2026-08-17 起 10+ 次）、`stats.json`（inject ok=31/fail=0 等分类计数 + lastFailures 数组）。
- **分档建议：后置**。免重启注入是开发者高频迭代工具，消费级写作产品无此需求（H.4 第④条的同类判断）。墨舟若做插件市场，热装载属于平台运营期特性。

#### ⑦ `sessions/<workspace-slug>/<session-uuid>/session.jsonl.zstd` —— 事件溯源单文件

- **机制**（证据：目录树实测）：按 workspace 路径转义分桶（如 `--home-a1691-mouzhou--/`、`--mnt-c-Users-a1691-Documents-codex~2014~2014test--/`），桶内每会话一目录一文件，append-only jsonl 经 zstd 压缩。
- **分档建议：必要**。这就是 ADR-0007 Event Ledger 的同构物。墨舟差异点（证据支持的）：按书分桶；压缩与否需权衡——DSH 选 zstd 换体积，代价是本机取证都无法直接 grep（见 §4 局限 1）；结合 ADR-0021 receipt-pointer 思想，Ledger 里正文只存指针不存全文，体积压力小于 DSH，**V1 不压缩换取可 grep/diff 可能更划算**（此点留给 grilling）。

#### ⑧ `storages/session_projcache.json` —— 投影缓存（卷二修正项）

- **机制**（证据：文件头 800 B 实读）：`{unit:{name:"session_projcache", version:3}, tables:{sessions:{<sessionId>:{identity:{createdAt,cwd}, rows:{sessionStats:{ver,seq,val:{turns,steps,llmMs,toolMs,ttftMs,decodeTokens,...}}}}}}}`——CQRS 读模型，行携带 `seq` 与账本序列对齐；**全局单文件**（不在 session 目录旁，修正卷二 §H.1 表述）；投影损坏可整体删除重建。
- **分档建议：必要**。"状态≠事件、投影可重建"是 ADR-0007/0006 已冻结的方向，DSH 证明其在生产可行。墨舟一致性投影（人物关系/伏笔账本/字数统计）照此模式：Ledger 是唯一真相，投影是 disposable 索引。

#### ⑨ `change-ledger/v1/workspaces/` —— 变更审计台账

- **机制**：目录骨架存在（v1/workspaces 两级），但**本机该目录为空**——机制位预留而无数据样本（见 §4 局限 3）。
- **分档建议：可选**。canon-write 强制落审计台账是 H.5-3 冻结方向，但 V1 可先让写作变更走 Event Ledger 单流，待"变更审计"与"生成事件"的消费方分化后再拆第二本账。

### 1.2 Execution Seam 四方法 ↔ DSH 真实机制映射

spec §Implementation Decisions 定义 Execution Seam 四方法。逐一对照：

| Seam 方法 | DSH 真实机制 | 证据路径 | 墨舟实现要点（建议，非拍板） |
|---|---|---|---|
| `registerCapability(type, provider)` | **三级扩展位**：①装配期 bundle（package.json `dsh.profile.bundles` + overrides 锁版）②配置期 patch（`- insert:` 行，id/name/config）③运行期热注入（super-injector/registry.json）。插件契约 = `apply(ctx, config)` 导出 + **`inject: ['systemPrompt','tools','llm']` 依赖声明**（router-bootstrap-v1.mjs L44，明文 "Prompt assembly, the tools registry, and the LLM route must exist"）；外部能力以 `@deepseek-ai/dsh-mcp-client` insert 行注册并自带失败策略 | `profiles/web/package.json`; `cordis.patch.yml`; `super-injector/registry.json`; `.agent-presets/router-standard/router-bootstrap-v1.mjs` | CapabilityRegistry 的最小 V1 形态 = 类型化契约 + 内存注册表 + 版本号字段；"多 provider 挂同一 capability"（ADR-0009）对应 DSH 的"一个能力多个 provider 行"，失败策略（timeout/retry/fallback）**随注册声明**是 DSH 已验证的形态，直接采纳 |
| `execute(taskType, payload) -> Result` | **统一工具调用协议**：原生工具 schema 化 + MCP 桥标准化外部执行（stdio/streamable-http 双传输）；失败隔离三件套：`failOnStartupError:false`（死 server 不拖垮宿主）+ 重连指数退避（1s→30s×20）+ 每能力独立 `toolCallTimeoutMs`；执行后拦截 = PostToolUse matcher（`write\|edit\|str_replace_editor` → validate-write.ts 机械校验） | `cordis.patch.yml` 全部 mcp-* 条目; `hooks.json` PostToolUse | `execute` 的 Result 必须携带失败分类（喂 M17 三级降级的入口）；"每个能力自带超时/重试策略"写进 Capability 契约；写类动作后置机械校验的思想转为管线内 Continuity Gate 步骤 |
| `publishEvent(event)` | **类型化事件 append API**：hook-protocol 库导出 `appendHookInvoked(session, ...)` / `appendHookResult(session, ...)`，把钩子生命周期写成 `hook/invoked`、`hook/result` 命名空间事件追加进 session 账本；纪律由库强制："log-only、turn-enclosed、invoked/result paired"，SessionStart 类会话外事件禁止出 turn | `node_modules/@deepseek-ai/dsh-hook-protocol/lib/types/events.d.ts` | NovelRuntime.publishEvent 与之同构：ADR-0007 八类领域事件 append-only 落 `.mozhou/events.jsonl`；**"成对 + turn 封闭"纪律值得直接抄**（如 GenerationStarted↔GenerationFinished、CanonProposalCreated↔CanonCommitted 必须配对，防半截事务）；事件 schema 由 runtime 层的类型库统一持有而非各模块散写 |
| `replaySession(sessionId) -> ExecutionTrace` | **投影重建 + 回合回滚**：projcache 读模型行带 `seq` 对齐账本序号、可整体重建；`@anionex/dsh-turn-rewind` 作为 bundle 提供回合级回滚；router-bootstrap 文档串明文 "the mode derives from durable session events, so resume/reload keeps it"——派生状态一律从账本事件重算，重启/恢复不丢 | `storages/session_projcache.json`; `package.json` bundles 数组; `router-bootstrap-v1.mjs` 头注 | ExecutionTrace = 重放 Ledger 的产物而非独立存储；墨舟"回放即回归"（M14/卷二 §K.2）复用同一机制：固定输入事件流重放对比指标漂移；派生状态（风格 EMA、伏笔账本）只允许从 Ledger 计算 |

---

## 2. Q2：分级模型路由配置形态

### 2.1 `settings.yaml` 注册表逐字段解剖

顶层六键：`ui-onboarding` / `llm-pi-ai` / `agent-default-model` / `agent-presets` / `permission` / `pet`。

**Provider 对象字段**（8 个实例归纳）：

| 字段 | 出现于 | 语义 |
|---|---|---|
| `apiKeyEnv` | 全部 8 家 | **密钥间接引用**：值为环境变量名，实际密钥在 `~/.dsh/.credentials.yaml` 的 `refs:` 表下（8 个名字一一对应实查）。密钥永不内联进 settings.yaml |
| `models[]` | 全部 | 模型条目数组 |
| `displayName` | st（商汤）、a（基元律动）、opencode-1 | UI 显示名，可选 |
| `api` | st=`openai-completions`、a=`openai-responses`、opencode-1=`openai-completions` | 协议适配器名；**缺省 = 内置原生协议**（google/openrouter/opencode-go 等无此字段） |
| `baseURL` | st/a/opencode-1 | 自定义端点；其余走内置端点 |

**Model 对象字段**：`id`（必有）、`name`（可选显示名）、`contextWindow`（可选，tokens）、`maxTokens`（可选，tokens）。全文件共 84 处 `contextWindow`。

**路由相关键**：

```yaml
agent-default-model:
  provider: openrouter        # 复合键的一半
  model: stealth/ox-alpha     # 另一半 —— 唯一的模型路由点
agent-presets:
  default: router-standard    # 指向 ~/.dsh/.agent-presets/router-standard/
```

### 2.2 四个改变设计判断的结构事实

1. **model id 是 provider-scoped 复合键，且跨 provider 元数据不一致**。`glm-5.2` 同时出现在 opencode-go（cw=1000000/maxTok=131072）、qwen-token-plan-cn（同左）、st（cw=1048576/无 maxTok）、a（cw=1000000/无 maxTok）；`glm-5.1` 在两家 maxTok 分别为 32768 和 128000。→ 解析模型必须 `(provider, id)` 二元组，`agent-default-model` 正是复合键格式；**不存在全局规范的模型元数据中心**。
2. **元数据完整性呈梯度**：opencode-go 全字段 → openrouter 多数无 maxTokens → opencode-1 整组 8 条只有裸 id。→ 运行时对缺失字段必须容忍并兜底（contextWindow 未知时按保守值预算），不能假设注册表完备。
3. **现实配置有脏数据**：provider `a` 的 `baseURL: " https://tokenrhythm.studio/v1"` 带前导空格。手编 YAML 必然积累此类错误 → 产品化的供应商配置需要 UI 校验 + 连接测试（M18 已冻结该方向，此处是实证）。
4. **DSH 的"路由"不是模型路由**。`.agent-presets/router-standard/` 五文件的实体是**推理模式路由**：`router-core.mjs` 把 react↔spec 轴量化为四个实测行为带（`MODE_SPEC=0 / MODE_MIXED=0.3(过渡陷阱) / MODE_REACT=1 / MODE_WEAK='weak'`），按首条用户消息分类注入 persona + 首轮核心工具集，首轮 durable 工具调用后放开完整目录。它**切换思维模式和工具面，不切换模型**。唯一的模型耦合点是 `isFlashModel(modelId)`（flash/pro 族用不同 weak persona），且 `agent.cordis.yml` 明文划界：*"The host composition keeps everything a preset must not own: … and **the model route**"*——模型路由属宿主层配置，预设层不得染指。

### 2.3 task_type→model 三种候选落点对比

墨舟需要的路由形如：`LONGFORM_PLANNING→强模型`、`STYLE_REWRITE→快模型`、`STATE_EXTRACTION→本地小模型`（ADR-0009 CapabilityType 已给出 task_type 词表）。

| | 方案甲：书内文件 | 方案乙：全局配置 | 方案丙：包内默认 + 覆盖 |
|---|---|---|---|
| 形态 | `<book>/.mozhou/routing.yaml` 随书走 | `~/.mozhou/settings.yaml` 单点 | runtime 内置 `task_type→tier` 默认表 ← 全局覆盖 ← 书内覆盖，三级 fallback |
| DSH 直接证据 | 指令层的双层作用域先例（`~/.dsh/AGENTS.md` 全局 + repo `AGENTS.md` 项目级，本会话同时受两层约束）；Novelcrafter book/series 双作用域（卷二 §E.1） | DSH 本体即 home 单点 settings.yaml；`agent-default-model` 单点全局默认 | **`agent-default-model` 本质就是丙的二层简化版**（内置缺省 + 全局覆盖）；opencode-1 裸 id 组证明运行时靠默认值兜底缺失 |
| 反向证据 | 新书冷启动零配置即不可用；每书重复维护；P0 红线下密钥绝不能入书内文件 | 无法按书差异化（A 书用 Claude 写大纲 / B 书全 DeepSeek 的诉求无处安放）；换机迁移需单独搬运 | 三级解析顺序自身是复杂度；默认表会随模型市场漂移，需要更新机制 |
| 关键风险对策 | — | ANWA #28 教训（配了 Gemini 却提示"未配置 DeepSeek"）：默认值必须可见可改、报错指向配置项 | **建议引入 tier 间接层**（task_type→tier 名→(provider,model) 复合键）：F4 已证明裸 model id 跨 provider 异参与改名频繁（`:free` 后缀、`-0731` 快照号），间接层把市场漂移隔离在一处 |
| 密钥处理 | 只放引用（apiKeyEnv 同款间接） | 同 DSH credentials refs 模式，天然同域 | 同左，三层均不触密钥 |
| 与飞轮的接口 | 书内文件可被 Recipe 版本钉死（M14） | 全局改动影响所有进行中评测 | 第四覆盖层留位：飞轮实证指标未来可作为动态 tier→provider 选择器（ADR-0009 动态路由四因子的落点） |

**证据倾向（供 grilling 消费，非结论）**：丙作骨架、甲乙作覆盖层的组合在证据上最顺——它同时满足 M18（开箱即用的供应商适配）、ANWA #28（默认可覆盖）、M14（Recipe 可钉死书内层）。真正的争议点是**书内覆盖层是否进 V1**：若 V1 以单书用户为主，甲层可推迟到 V1.5 而不伤架构；若"不同书不同模型组合"是早期核心场景，则甲层必须 V1 就位。此判断需要产品侧输入，A 路证据不足以单方面裁决。

---

## 3. 对卷二 §H 的增补清单（本报告净贡献）

1. **修正**：`session_projcache.json` 位于 `~/.dsh/storages/`（全局单文件，unit.version=3），非 session 目录旁。
2. **补充**：super-injector 三件套实态（registry 1 条活跃 / self-heal.log purge 记录 / stats 分类计数）。
3. **补充**：hook-protocol 包是 rc.6 中唯二物理落盘的内核包之一，其 `events.d.ts` 给出了事件 append API 与 "turn-enclosed + invoked/result paired" 纪律的原文——Execution Seam `publishEvent` 的最硬证据。
4. **修正**：H.3「settings.yaml providers → 分级模型路由」应表述为"providers 注册表 + 单点全局默认"；**分级路由层 DSH 并未实现**，是墨舟侧增量。DSH 实际实现的"路由"是推理模式路由（spec/react/weak/mixed），两者不应混称。
5. **新证据**：模型元数据跨 provider 不一致（F4）与配置脏数据（§2.2-3），支撑 M18 的 UI 校验/连接测试要求与 tier 间接层设计。

## 4. 取证局限（如实标注）

1. **session.jsonl.zstd 未能解压**：本机无 `zstd` 二进制、Python `zstandard` 模块未安装；只读纪律下不安装依赖。事件流的逐行 schema 未验证，事件词表证据来自 hook-protocol 类型定义 + projcache 的 seq 结构 + 插件文档字符串的三角印证。
2. **宿主内核源码不在取证范围**：`profiles/web/node_modules` 仅 2 个物理包（dsh-hook-protocol / dsh-hooks-claude-code），28 个 override 指向的宿主包体在全局安装处，`loader.create` 与 llm route 的实现未读到源码级——相关结论基于配置面、类型面与插件面证据。
3. **change-ledger/v1/workspaces/ 为空目录**：台账记录格式无样本可验，仅确认机制位存在。
4. **静态取证**：未观察运行时行为（loader 装配日志、钩子触发时序、zstd 流写入节奏）。
5. **活配置时点性**：`settings.yaml` 最后修改 2026-08-24（取证当日），模型清单/数量仅为时点快照。
6. **分档为建议非决议**：§1.1 各"分档建议"与 §2.3"证据倾向"均为 A 路单路证据下的建议，须经 #30 grilling 票对抗后才能进入决策。
