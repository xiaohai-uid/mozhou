---
date: 2026-08-24
description: '工单 #31 产出：执行基底规格——内核线吸收应用线可恢复任务语义，单一账本+状态投影，CapabilityRegistry 调用期解析 fail-fast，四态结局词表，tier 路由两级配置，伪代码级'
tags:
  - project-note
  - mozhou
---

# Runtime 执行基底规格（工单 #31 产出）

> 相关笔记：[[t30-runtime-substrate-evidence]] · [[kernel-schema-draft]] · [[dual-plane-sync-spec]] · [[token-budget-assembly-spec]] · [[2026-08-24-wayfinder-phase-3-map]]
> 工单 [#31](https://github.com/xiaohai-uid/mozhou/issues/31) · 决策记录见 [ADR-0023](../adr/0023-runtime-substrate-absorption.md) · 消费冻结 schema `kernel-schema.draft.ts`
> 边界：本票裁 NovelRuntime / CapabilityRegistry / Provider Adapter V1 / 分级模型路由的形态；Capability Recipe Schema 归 [#33](https://github.com/xiaohai-uid/mozhou/issues/33)；十步编排协议归 [#32](https://github.com/xiaohai-uid/mozhou/issues/32)
> 决策过程：grilling 四批共十二问（Q0-Q11），全部由作者拍板（Q9-Q11 按「按推荐来」采纳主会话代拟选项）

## 0. 一句话

**内核线 Execution Seam 为唯一主干收编应用线可恢复任务语义：任务生命周期 = Ledger 任务事件流、当前态全是可重建投影；能力经 CapabilityRegistry 调用期解析为 provider 绑定（fail-fast），失败只有四态结局词表，账本只认 publishEvent 单口。**

## 1. Execution Seam 四方法契约（冻结）

```ts
// @mozhou/runtime 公开面（V1）
registerCapability(cap: CapabilityRegistration): void;
execute(taskType: TaskType, payload: unknown): Promise<TaskResult>;
publishEvent(event: DomainEvent): void;            // 唯一账本写入口
replaySession(filter: ReplayFilter): ExecutionTrace;

interface CapabilityRegistration {
  taskType: TaskType;                              // 与事件 schema taskType 同词表
  providerId: ProviderId;
  providerVersion: `${number}.${number}.${number}`;// 必填 semver
  failurePolicy: { timeoutMs: number; fallbackProviderIds: ProviderId[] };
  outputSchema?: JsonSchema;                       // 声明即获得 structuredOutput 包装（§5）
}

interface TaskResult {
  outcome: Outcome;                                // §2 四态词表
  value?: unknown;                                 // succeeded 时承载产物
  repairHint?: unknown;                            // failed_recoverable 时供二级定向重生（§5）
  snapshot: ResolutionSnapshot;                    // 本次解析快照（§4）
}
```

- **R1** 四方法签名冻结；新增参数走受控增补。
- **R2** `state_degraded` 只入词表不接行为，Phase 2 Canon 结算启用（沿应用线吸收先例）。

## 2. 任务运行时吸收语义（Q0/Q3/Q4）

| 应用线资产 | 吸收后形态 |
|---|---|
| generation_jobs/steps/attempts 状态机 | Ledger 任务事件流（TaskStarted / TaskStepTransitioned / TaskAttemptRegistered / TaskFinished…）；当前态 = SQLite 投影表 |
| Postgres 条件更新 CAS | 投影行带 seq 对齐账本；CAS = 投影上乐观并发（expected_seq 不符即拒绝） |
| SSE Last-Event-ID 补发 | 按 seq 读账本续传；client_key 幂等 |
| attempt 重试仅「未产生结果」 | 任务层语义：attempt 登记是否已产生部分产物；有产物 ⇒ 重试通道关闭 |
| stopped 防迟到完成 | 取消登记后到达的完成事件在投影合并时丢弃并标 late_arrival |
| usage_ledger | usage 投影表（attempt 级 provider/model/cost_status），Phase 4 飞轮消费 |

不变量：
- **T1 状态≠事件**：任何当前态可由账本全量重建（删库重建幂等，沿 T10b 台架纪律）
- **T2 单一账本**：`.mozhou/events.jsonl` 是任务与领域事件的唯一 append 真源；SSE 补发、投影、回放共享同一 seq 口径
- **T3 结局四态唯一**：`succeeded | failed_recoverable | failed_terminal | state_degraded`；正交原因维度归 failurePolicy 与事件字段，不进 outcome

## 3. EventLedger 写入纪律（Q5）

- `publishEvent` 是唯一 append 入口；能力代码直写 events.jsonl = lint error 级违规
- 事件词表与成对约束由 runtime 类型库统一持有：GenerationStarted↔GenerationFinished、CanonProposalCreated↔CanonCommitted 等；悬挂配对在投影合并时标记
- 事件 schema 变更 = runtime 类型库受控增补，禁止各模块散写

## 4. CapabilityRegistry 解析协议（Q6/Q7）

```
execute(taskType):
  1. 读配置快照（内存缓存 + mtime 失效）→ 全局覆盖层查 taskType → 无则包内默认注册项
  2. 解析 {providerId, providerVersion, model?}；失败 ⇒ 抛 NO_PROVIDER_TASK_TYPE /
     NO_PROVIDER_TIER，错误文本含具体配置键路径（ANWA #28 教训兑现）
  3. 组装 ResolutionSnapshot{taskType,capability,providerId,providerVersion,tier,provider,model}
     写入 GenerationStarted 事件 —— M14 双向钉死的事件侧落点
  4. 执行；failurePolicy.timeoutMs 到时按 fallbackProviderIds 依序降级（每次降级=新 attempt）
```

- V1 仅代码内 `registerCapability` 单级扩展位；bundle 清单/patch/热注入留生态期（ADR-0009 三级位设计保留，V1 不实现）
- 熔断不进 V1；重试归任务层 attempts（仅未产生结果开放）

## 5. Provider Adapter V1 与 M17 分层协作（Q8/M18）

**adapter 职责（传输知识）**：
- 协议档位选择：Claude=json_schema+strict tools；DeepSeek/GLM=json_object+prompt 引导（#30 B 路：三家结构化输出两档分化）
- 响应校验与错误归一化：三家错误分类学 → 统一错误码
- M18 四要素：自定义 provider / baseURL 相对化 / 连接测试 / 缓存前缀策略按家参数化 + 统一命中计量接口（prompt_cache_hit_tokens ∥ cached_tokens ∥ cache_read_input_tokens → cacheHitTokens）

**runtime structuredOutput 包装器（编排知识）**：
```
structuredOutput(cap, payload):
  1. adapter 按其协议档位发起调用
  2. 校验响应 against cap.outputSchema
  3. 失败 ⇒ 二级定向重生：标准 attempt 携带 repairHint（坏字段定位）
  4. 再失败 ⇒ 三级人工模板兜底：outcome=failed_recoverable + 模板路径
```
能力侧零重复：能力只声明 outputSchema。

## 6. 分级模型路由（Q1/Q2/Q9/Q10）

**代码接受的形态（冻结实现 = `packages/runtime/src/tierConfig.ts`）**：

```yaml
# ~/.mozhou/settings.yaml（V1 两级：包内默认 ← 本文件全局覆盖）
# 形态：task_type → tier 名 → 路由叶子；叶子字段白名单 providerId / model / api_key_ref
CHAPTER_DRAFTING:
  quality:
    providerId: deepseek
    model: deepseek-chat
    # api_key_ref: MOZHOU_DEEPSEEK_KEY   # 可选；引用名而非密钥本体（见下方 §6.1）
LONGFORM_PLANNING:
  quality:
    providerId: deepseek
    model: deepseek-reasoner
STYLE_REWRITE:
  fast:
    providerId: deepseek
    model: deepseek-chat
```

- 叶子字段白名单只有 `providerId` / `model` / `api_key_ref` 三个；未知字段、缺 `providerId`、缺 `model`、任意层级的明文 `apiKey` 一律解析期 fail fast，报错指向具体键路径（`tierConfig.ts:63,86-103,105-183`）。**`model` 为必填**：不存在「只声明 providerId」的叶子。
- **tier 间接层**：task_type→tier 名→(providerId, model) 复合键；裸模型 id 不直接出现在 task_type 绑定里（隔离市场漂移：`:free` 后缀、日期快照号）
- 一个 task_type 下可以有多个 tier 叶子（飞轮评测按叶子逐条判 incumbent，`packages/flywheel/src/evaluator/run.ts:184-189`）。运行时选哪个叶子必须显式：`selectTierRoute` 只在单叶子时自动采用，多叶子一律 `NO_PROVIDER_TIER` 并列出候选，不静默挑一个（`packages/runtime/src/tierRouting.ts`）。
- 书内覆盖层 `<book>/.mozhou/routing.yaml` 推迟 V1.5（同格式复制即可）
- **热加载**：配置 mtime 失效内存快照，下一次 execute 生效；运行中调用不受影响（调用期解析使热加载近乎免费）
- 加载时机械校验：缺档、缺模型 id 等 fail fast 并指向键路径；UI 连接测试留 Phase 6 接口预留位
- **生成入口接线**（T14 后续接线票）：web 正文生成入口 `POST /api/draft.stream` 在真实 provider 分支读本文件——落点缺省 `~/.mozhou/settings.yaml`，`MOZHOU_TIER_CONFIG` 仅作测试/运维覆盖；**文件不存在 ⇒ 不覆盖、完全保持既有行为**；多叶子歧义时的操作位是环境变量 `MOZHOU_DRAFT_TIER`（未设且多叶子 ⇒ fail fast，报错里给出该名字）。

### 6.1 `providers:` 供应商注册表（已实现）

形态（与 `tierConfig.ts` 的校验器一致，与 §6 的路由表同文件）：

```yaml
# ~/.mozhou/settings.yaml
providers:
  deepseek:
    apiKeyEnv: MOZHOU_DEEPSEEK_KEY      # 密钥本体永不入此文件（credentials refs 模式）
    baseURL: https://api.deepseek.com
    models:                             # 可选；声明性清单，不改写出站 model
      - { id: deepseek-chat, contextWindow: 131072, maxTokens: 8192 }
CHAPTER_DRAFTING:
  quality:
    providerId: deepseek
    model: deepseek-chat
```

- 字段白名单：`baseURL` / `apiKeyEnv` / `models?`；未知字段、缺 `baseURL`、缺 `apiKeyEnv`、任意层级的明文 `apiKey` 一律解析期 fail fast 并指向键路径（`tierConfig.ts`）。`providers` 是顶层保留键，绝不被当作 `task_type`。
- **`providerId` 真正选端点**：tier 叶子的 `providerId` 必须在该注册表登记；出站 `baseURL` 与密钥（`apiKeyEnv` 指向的环境变量）由注册表解析（`apps/web/server/llm/tierRouting.ts` 的 `resolveTierEndpoint`）。账本 `GenerationStarted.snapshot.providerId` 与绑定键用的是**同一个** `providerId`，因此账本记录的 provider 必然就是实际服务的那一个。
- **未登记 ⇒ 显式拒绝**（`TIER_ROUTE_PROVIDER_NOT_REGISTERED`，报错含 providerId、叶子键路径与应登记的 `providers.<id>` 键路径），**不静默回落 BYOK 端点**；`baseURL` 未过 SSRF 门禁 ⇒ `TIER_ROUTE_PROVIDER_ENDPOINT_REJECTED`；`apiKeyEnv` 指向的环境变量缺失/空白 ⇒ `TIER_ROUTE_PROVIDER_KEY_MISSING`。
- 无覆盖层文件 ⇒ 仍走 BYOK 解析（行为与接线前一致）；叶子声明了 providerId 的配置一律以注册表为准。
- `api_key_ref` 仍显式拒绝（`TIER_ROUTE_API_KEY_REF_UNSUPPORTED`）：密钥的唯一来源是注册表 `apiKeyEnv`，叶子再声明一层引用名会让「这份叶子用哪把密钥」出现两个互相矛盾的来源。
- 出站 `baseURL` 的 SSRF 校验复用 `apps/web/server/llm/openaiStream.ts` 的 `assertSafeEndpointUrl`（BYOK 与注册表同一个函数；真正发请求前 `streamOpenAiChat` 再用 `assertSafeRemoteTarget` 补 DNS 解析结果那一半）。私有地址只在部署者显式 `MOZHOU_ALLOW_PRIVATE_LLM=1` 时放行，配置文件本身无权设置该开关。

## 7. 工程骨架（Q11）

- 新包 `packages/runtime`：依赖方向 runtime→kernel（类型/实体）+ runtime→data-plane（EventLedger append 委托 data-plane 既有 IO；**runtime 不自持文件写入**，守 kernel/data-plane 边界既有裁决精神）
- tsc -b project references 接入根构建链；N9 lint 四禁令原样沿用（error 级）；vitest；测试零时钟零外部服务（L1 确定性纪律）

## 8. 裁决日志全录

| Q# | 议题 | 作者拍板 | 理由 |
|---|---|---|---|
| Q0 | 双线裁决 | A 吸收：内核线为主干收编应用线可恢复任务语义，Postgres→SQLite 同构，单一基底单一账本 | local-first 红线+互补性 |
| Q1 | tier 间接层 | A 采纳 task_type→tier 名→(provider,model) 复合键 | 隔离模型市场漂移 |
| Q2 | 书内覆盖层 | B 推迟 V1.5；V1 仅「包内默认←全局覆盖」两级 | 产品侧判断 |
| Q3 | 记账形态 | A 单一账本+状态投影（seq 对齐/CAS 乐观并发/可重建/SSE 补发按 seq） | 符合 Q0+投影可重建冻结方向 |
| Q4 | 失败词表 | A 四态结局唯一词表（state_degraded 只入词表）；取消走 stopped 防迟到；正交维度归 failurePolicy | 两线共认词表不污染 Result |
| Q5 | 账本写入权 | A publishEvent 单口+类型库持有词表与成对约束 | DSH 库强制先例+replay 依赖词表稳定 |
| Q6 | 解析时机/失败面/扩展位 | A 调用期解析+NO_PROVIDER_* fail fast 指向配置键+V1 仅代码内注册单级 | 两级覆盖唯有调用期解析有意义+#28 教训 |
| Q7 | 注册契约冻结面 | A {timeoutMs, fallbackProviderIds[]} 最小面+providerVersion semver+解析快照落 GenerationStarted | 恰覆盖三路先例 |
| Q8 | M17 归属 | A 分层协作（adapter 档位/校验/归一化；runtime 包装器；二级走 attempt 带 repairHint；三级 failed_recoverable） | 按知识边界切分、能力侧零重复 |
| Q9 | 配置格式与存放位 | A YAML 单文件 ~/.mozhou/settings.yaml+密钥间接引用；书内层同格式推迟 V1.5 | DSH 八家实证+脏数据需校验兜底 |
| Q10 | 热更新边界 | A 热加载（mtime 失效快照），运行中调用不受影响 | 与 Q6 调用期解析互为前提 |
| Q11 | 工程骨架 | A packages/runtime 独立包；runtime→kernel+data-plane；N9/tsc-b/vitest 沿用 | kernel 零 IO 边界不可破 |

## 9. 对既有规格的受控增补清单

1. ADR-0007(novel) 事件词表增补任务族事件（TaskStarted 族）与成对约束 —— 随实现票落
2. master spec §Implementation Decisions Execution Seam 补「账本写入权 = publishEvent 单口」一句
3. dual-plane 目录树无需改动：任务投影入 runtime.sqlite 既有库（记录判定，防实现票误开新文件）

## 10. 验收对照（地图 Destination 判据）

- [x] Draft/Review/User Edit/Final Extract 实现票可对本 spec 直接写调用代码（§1/§4/§5 契约齐备）
- [x] 十二问裁决逐条体现正文（§2-§7 ↔ Q0-Q11）
- [x] 双线裁决落地：吸收翻译表（§2）+ 应用线 FROZEN 契约处置纪律（ADR-0023）
