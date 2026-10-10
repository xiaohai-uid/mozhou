{
  "record_type": "graph_gate_status",
  "id": "GRAPH-GATE-20261010",
  "captured_at": "2026-10-10T00:05:00+08:00",
  "captured_by": "captain",
  "head": "8fb9798ae4eb36ee07226bcb60f02be4e9a9cc0e",
  "branch": "feature/windows-local-release",
  "purpose": "t3 终验收第 4 项（代码改动须过图谱门）的实测输入。队长在成员动手前采集，避免把『未采集』误记为『已通过』。",
  "commands": [
    {
      "command": "node .gitnexus/run.cjs status",
      "key_output": [
        "Indexed commit: 8fb9798",
        "Current commit: 8fb9798",
        "Status: ⚠️ stale (re-run gitnexus analyze)"
      ],
      "observation": "索引提交与当前提交相同，但索引器仍判定 stale。已排除『未提交改动导致』这一猜测的前提不成立——刷新后 status 不变，说明 stale 由其它原因造成。原因未查明，记为未知，不推测。"
    },
    {
      "command": "node .gitnexus/run.cjs check --cycles --json -r .",
      "key_output": [
        "{ \"status\": \"clean\", \"cycleCount\": 0, \"cycles\": [] }"
      ],
      "exit_code": 0,
      "interpretation": "cycleCount=0 是基于当前索引得出的。由于索引被判定 stale，该结果只能表述为『截至索引时刻无环』，不得表述为『当前工作区已验证无环』。"
    },
    {
      "command": "node .gitnexus/run.cjs analyze --index-only --skip-agents-md --skip-skills --workers 2",
      "exit_code": 0,
      "observed_warning": "full-text/BM25 search is disabled — the search index build failed this run.",
      "result": "索引已重建，但 status 仍报 stale。"
    },
    {
      "command": "node .gitnexus/run.cjs analyze --repair-fts",
      "exit_code": 1,
      "error": "FTS repair failed - missing indexes after rebuild: Typedef.typedef_fts.",
      "tool_suggestion": "gitnexus doctor 可进一步诊断。"
    }
  ],
  "capability_gap": {
    "statement": "本次未过图谱门禁。",
    "missing_capability": "gitnexus analyze 无法完成有效的 FTS 重建（Typedef.typedef_fts 缺失），导致索引始终被判 stale。",
    "attempted": [
      "status 检查",
      "index-only 全量重建",
      "--repair-fts 修复"
    ],
    "impact": "cycleCount=0 的结论绑定在陈旧索引上。本轮绑定工作只改门禁脚本（scripts/ 下，不参与 packages/apps 的依赖图），受影响面理论上不进入图谱拓扑；但这是推断，未获工具验证。",
    "independent_work_continued": "是。门禁基线（gate-baseline-before.json）、绑定方案、正反例验证均不依赖图谱索引可继续推进。"
  },
  "downstream_rule_for_t3": [
    "不得把 graph:check 的 exit 0 写成『图谱门已通过』。",
    "必须写明『本次未过图谱门禁』并附本记录的原因。",
    "若 t2 之后 cycleCount 发生变化，必须先重建可用索引再下结论。",
    "不得因工具失败而声称已执行门禁——本次是失败/受阻，不是通过。"
  ],
  "note_for_captain_at_capture_time": "采集本记录时尚未对任何代码做出改动；scripts/ 下的 M 状态为并行会话既有的术语统一改动（见 captain-findings.md D 节），非本队所致。"
}