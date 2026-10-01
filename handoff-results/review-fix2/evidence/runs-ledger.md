# 运行账目（自动生成，勿手改）

- 生成时间：2026-09-30T13:08:45.104Z
- 生成器：harness/make-ledger.mjs（计数单位=attemptId；帧仅作内容证据）
- 工单：mozhou-stage4-audit-fix　额度=0　已用=0　剩余=0

## 计数口径

| 口径 | 数量 |
|---|---|
| 本装置记录的尝试（含受控替身） | 19 |
| 其中真实通道 | 0 |
| 历史请求尝试（LEGACY） | 10 |
| **请求尝试总计** | **29** |

> 「请求尝试」≠「已核实的真实供应商调用」。只有带供应商自身错误体的条目能核实端点，见 legacy 中 endpointProvenance=KNOWN_REAL 的条数。

## 对账

```json
{
  "spendRows": 0,
  "startedEvents": 19,
  "attemptsCounted": 19,
  "spendWithoutStarted": [],
  "startedWithoutSpend": [],
  "unknownResults": [],
  "frameFilesSeen": 24,
  "frameFilesUnique": 23,
  "duplicateFrameFiles": 1,
  "frameFilesUnmatchedToAttempt": [
    {
      "run": "b-controlled-2026-09-30T11-35-08-734Z-8ca752",
      "file": "context-chapter2.frames.ndjson",
      "candidateId": "581f787e-cdf2-4b25-9dd2-4ef47dfe9743",
      "duplicateOf": []
    },
    {
      "run": "b-controlled-2026-09-30T11-35-08-734Z-8ca752",
      "file": "frames-01-controlled-B_1_.ndjson",
      "candidateId": "581f787e-cdf2-4b25-9dd2-4ef47dfe9743",
      "duplicateOf": [
        "context-chapter2.frames.ndjson"
      ]
    },
    {
      "run": "c-control-controlled-2026-09-30T11-35-09-825Z-e432c7",
      "file": "frames-01-controlled-undefined.ndjson",
      "candidateId": "93731d5c-c038-4d0f-be0c-2f1027ebc1e5",
      "duplicateOf": []
    },
    {
      "run": "c-control-controlled-2026-09-30T11-35-09-825Z-e432c7",
      "file": "frames-02-controlled-C-control_.ndjson",
      "candidateId": "0d1a1ad6-fbca-4d83-a043-18e2c5da44f1",
      "duplicateOf": []
    },
    {
      "run": "c-disc-controlled-2026-09-30T11-35-13-471Z-ecec5b",
      "file": "frames-01-controlled-C-disc_.ndjson",
      "candidateId": "3ebc4a47-0cb6-4b93-956b-ffcda9616fe2",
      "duplicateOf": []
    }
  ]
}
```

## 本装置的尝试（按 attemptId 计数）

- `at_ctl_21156_muo4fjkw_mawbho` seq=null channel=controlled terminal=**ok** 帧文件=1（重复副本 0）
- `at_ctl_21156_muo4flmm_d2nkq7` seq=null channel=controlled terminal=**ok** 帧文件=1（重复副本 0）
- `at_ctl_25548_muo4a816_bj2bb4` seq=null channel=controlled terminal=**ok** 帧文件=1（重复副本 0）
- `at_ctl_30752_muo44lln_gwek2n` seq=null channel=controlled terminal=**ok** 帧文件=1（重复副本 0）
- `at_ctl_30752_muo44ng6_d0z443` seq=null channel=controlled terminal=**ok** 帧文件=1（重复副本 0）
- `at_ctl_33452_muo4a9ak_gomd6y` seq=null channel=controlled terminal=**ok** 帧文件=1（重复副本 0）
- `at_ctl_33452_muo4abbw_9yw0ly` seq=null channel=controlled terminal=**ok** 帧文件=1（重复副本 0）
- `at_ctl_37668_muo4achs_p6hbga` seq=null channel=controlled terminal=**ok** 帧文件=1（重复副本 0）
- `at_ctl_40008_muo4fibh_mzralh` seq=null channel=controlled terminal=**ok** 帧文件=1（重复副本 0）
- `at_ctl_50128_muo42v8h_1o0660` seq=null channel=controlled terminal=**ok** 帧文件=1（重复副本 0）
- `at_ctl_51356_muo49cz5_mab3sv` seq=null channel=controlled terminal=**ok** 帧文件=1（重复副本 0）
- `at_ctl_55444_muo44oep_85d1ta` seq=null channel=controlled terminal=**ok** 帧文件=1（重复副本 0）
- `at_ctl_56388_muo4fms3_n4q0n5` seq=null channel=controlled terminal=**ok** 帧文件=1（重复副本 0）
- `at_ctl_57204_muo48wsm_bknwzb` seq=null channel=controlled terminal=**ok** 帧文件=1（重复副本 0）
- `at_ctl_57320_muo49e24_uiufla` seq=null channel=controlled terminal=**ok** 帧文件=1（重复副本 0）
- `at_ctl_57320_muo49fwj_r12g4n` seq=null channel=controlled terminal=**ok** 帧文件=1（重复副本 0）
- `at_ctl_59156_muo49guu_amytyl` seq=null channel=controlled terminal=**ok** 帧文件=1（重复副本 0）
- `at_ctl_59764_muo44kid_9n7l2x` seq=null channel=controlled terminal=**ok** 帧文件=1（重复副本 0）
- `at_ctl_60092_muo42pzf_8gpwdj` seq=null channel=controlled terminal=**ok** 帧文件=1（重复副本 0）

## 历史请求尝试（LEGACY，单列，不与上面混算）

| seq | 时间 | 阶段 | 用途 | 终态 | 耗时 | delta | 候选 | 端点身份 | 现存证据 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 2026-09-30T10:15:20Z | B | 第二章上下文生成（首次尝试） | error | 530ms | 0 | — | **KNOWN_REAL** | handoff-results/calls.json seq1（原始行仍在旧包，未被覆盖） |
| 2 | 2026-09-30T10:16:06Z | B | 第二章上下文生成（成功） | done | 19480ms | 302 | a60d02ba… | **UNKNOWN** | handoff-results/calls.json seq2 + handoff-results/test-logs/phase-b.log 的 10:16:29 done 帧行 |
| 3 | 2026-09-30T10:18:56Z | C-control（上一版误配真实通道） | 取消后再生成——本应走本地替身，实际被起成了真实通道 | error | 60166ms | 0 | — | **UNKNOWN** | handoff-results/calls.json seq3 |
| 4 | 2026-09-30T10:19:41Z | C-real | 真实取消：收到首个 delta 即断开 | aborted_by_client | 9696ms | 1 | — | **UNKNOWN** | handoff-results/calls.json seq4 |
| 5 | 2026-09-30T10:19:57Z | C-real | 取消之后重新生成 | done | 15521ms | 230 | — | **UNKNOWN** | handoff-results/calls.json seq5 |
| 6 | 2026-09-30T10:23:54Z | B | 第二章上下文生成（第二轮尝试）—— **旧 calls.json 漏记的正是这一条** | done | 38972ms | 224 | 1bb7d37b… | **UNKNOWN** | handoff-results/artifacts/context-chapter2.frames.ndjson（172 帧：1 start + 170 delta + 1 done，累计 224 字）+ artifacts/phase-b.json + 外部 run-b.log |
| 7 | 2026-09-30T10:28:46Z | C-real（重跑尝试） | 真实取消（重跑尝试 1） | error | 120ms | 0 | — | **UNKNOWN** | handoff-results/calls.json seq6 |
| 8 | 2026-09-30T10:28:46Z | C-real（重跑尝试） | 取消之后重新生成（重跑尝试 1） | error | 223ms | 0 | — | **KNOWN_REAL** | handoff-results/calls.json seq7 |
| 9 | 2026-09-30T10:30:37Z | C-real（最终留档前一次） | 真实取消：收到首个 delta 即断开 | aborted_by_client | 33059ms | 1 | — | **UNKNOWN** | handoff-results/calls.json seq8 + 第四轮之前的 artifacts/phase-c-real.json |
| 10 | 2026-09-30T10:31:10Z | C-real（最终留档） | 取消之后重新生成并采纳 | done | 27100ms | 230 | — | **UNKNOWN** | handoff-results/calls.json seq9 + 第四轮之前的 artifacts/phase-c-real.json |

### 端点判据（统一）

- `KNOWN_REAL`：存在只有公网上游才会产生的证据（供应商自身错误体 429003）。共 **2** 条。
- `UNKNOWN`：证据只有耗时、start 帧 provider 字符串、或旧 harness 自报行 —— 这三者对本地替身同样成立。共 **8** 条。

