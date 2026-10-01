# 运行账目（自动生成，勿手改）

- 生成时间：2026-09-30T12:29:21.944Z
- 生成器：harness/make-ledger.mjs（自动扫描 runs/，非手写数组）
- 工单账本：ticket=mozhou-stage4-audit-fix allowance=0 已记录占用=0 剩余=0
- 遗留真实调用（无法由 runs/ 重建）：**9** 条

## 遗留调用（上一版 harness 期间发生）

| seq | 时间 | 阶段 | 用途 | 终态 | 耗时 | delta | 端点身份 | 依据 |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-09-30T10:15:20Z | B（上一版 harness 首次尝试） | 第二章上下文生成（首次尝试） | error | 530ms | 0 | **KNOWN_REAL** | 该次构建由上一版 runner 的 B 分支默认启动真实通道（buildEnv(real=true) 且无受控端点注入）；且错误文本是真实供应商的 429 体。 |
| 2 | 2026-09-30T10:16:06Z | B（上一版 harness） | 第二章上下文生成（成功） | done | 19480ms | 302 | **UNKNOWN** | 仅有 start 帧自报的 provider 字符串（real-openai-compatible）与耗时，**没有**端点/环回覆盖值的独立留档；provider 字符串对受控替身与真实通道取值相同，无法据此排除替身（Codex 第四轮同判）。 |
| 3 | 2026-09-30T10:18:56Z | C-control（上一版 harness 配错通道） | 取消后再生成——本应走本地替身，实际被起成了真实通道 | error | 60166ms | 0 | **KNOWN_REAL** | 该次重启被显式配置为真实通道（上一版 runner 的 startServerWithEnv 走 buildEnv(true)），且 60s 无任何 delta 与真实上游行为一致。 |
| 4 | 2026-09-30T10:19:41Z | C-real（上一版 harness） | 真实取消：收到首个 delta 即断开 | aborted_by_client | 9696ms | 1 | **KNOWN_REAL** | 上一版 runner 的 --phase c-real 分支不注入受控端点，只从凭据解析；首 delta 9.7s 到达符合公网上游首字节特征。 |
| 5 | 2026-09-30T10:19:57Z | C-real（上一版 harness） | 取消之后重新生成 | done | 15521ms | 230 | **KNOWN_REAL** | 同上（同一进程内的第二条真实请求）。 |
| 6 | 2026-09-30T10:28:46Z | C-real（重跑尝试） | 真实取消（重跑尝试 1） | error | 120ms | 0 | **UNKNOWN** | 连接层失败发生在任何帧之前，没有 start 帧可以佐证端点；也没有当时的端点覆盖留档。 |
| 7 | 2026-09-30T10:28:46Z | C-real（重跑尝试） | 取消之后重新生成（重跑尝试 1） | error | 223ms | 0 | **KNOWN_REAL** | 429 体来自真实供应商。 |
| 8 | 2026-09-30T10:30:37Z | C-real（最终留档前一次尝试） | 真实取消：收到首个 delta 即断开 | aborted_by_client | 33059ms | 1 | **KNOWN_REAL** | 上一版 artifacts/phase-c-real.json 保留了该次运行的帧（含 provider 自报与 base.revision=1），端点由凭据解析路径产生。 |
| 9 | 2026-09-30T10:31:10Z | C-real（最终留档） | 取消之后重新生成并采纳 | done | 27100ms | 230 | **KNOWN_REAL** | 同上（上一版 artifacts/phase-c-real.json 的第二条记录）。 |

## 本次修复期间的运行（runs/，自动扫描）

### b-controlled-2026-09-30T11-35-08-734Z-8ca752
- phase=b channel=controlled 额度=0
- context-chapter2.frames.ndjson → terminal=done provider=real-openai-compatible contextMode=structural_fallback delta=41
- frames-01-controlled-B_1_.ndjson → terminal=done provider=real-openai-compatible contextMode=structural_fallback delta=41

### c-control-controlled-2026-09-30T11-35-09-825Z-e432c7
- phase=c-control channel=controlled 额度=0
- frames-01-controlled-undefined.ndjson → terminal=no_terminal_frame provider=real-openai-compatible contextMode=structural_fallback delta=14
- frames-02-controlled-C-control_.ndjson → terminal=done provider=real-openai-compatible contextMode=structural_fallback delta=41

### c-disc-controlled-2026-09-30T11-35-13-471Z-ecec5b
- phase=c-disc channel=controlled 额度=0
- frames-01-controlled-C-disc_.ndjson → terminal=no_terminal_frame provider=real-openai-compatible contextMode=structural_fallback delta=14

### c-real-real-2026-09-30T11-35-22-654Z-8cb9f2
- phase=c-real channel=real 额度=0
- （该运行没有生成调用）

### c-real-real-2026-09-30T11-35-38-637Z-ec80f6
- phase=c-real channel=real 额度=0
- （该运行没有生成调用）

### guard-controlled-2026-09-30T11-35-22-591Z-cce8e2
- phase=guard channel=controlled 额度=0
- （该运行没有生成调用）

### guard-controlled-2026-09-30T12-29-17-034Z-135d9e
- phase=guard channel=controlled 额度=0
- （该运行没有生成调用）

## 未知项（禁止猜测）

- seq2（10:16 的 B）端点身份 UNKNOWN：只有 provider 字符串与耗时，无端点覆盖留档。
- seq6（10:28 连接层失败）端点身份 UNKNOWN：失败在任何帧之前。
- 两次 B 的原始帧均已不可得（数据根已删除、旧 artifacts 被后续运行覆盖），只保留日志行的结构化引用。

