{
  "record_type": "t3_acceptance_checklist",
  "id": "ACCEPT-20261010",
  "captured_at": "2026-10-10T00:18:00+08:00",
  "captured_by": "captain",
  "purpose": "t3 终验收的逐项判据。队长独立实跑得出，非转述成员自报。t3 须逐项核对并在验收记录中给出 passed/failed/blocked/unverified，不得整体打勾。",

  "acceptance_items": [
    {
      "id": "A1",
      "item": "check:gates 仍 exit 0",
      "why": "gate-baseline-before.json 记录改动前 exit_code=0 / PASS。若变为非 0，即为本轮改坏既有门。",
      "command": "node scripts/verify-gates-contract.mjs",
      "captain_observed": "00:17 实跑 exit 0，末行 PASS: 4 项已知缺口（不阻塞），无新增问题。",
      "status_for_t3": "待重跑确认"
    },
    {
      "id": "A2",
      "item": "check:glossary / check:readmes 仍 exit 0",
      "why": "基线同为 exit 0。本轮绑定只应影响 check:gates，不应波及这两个门。",
      "command": "pnpm run check:glossary / pnpm run check:readmes",
      "captain_observed": "基线 exit 0 / 0",
      "status_for_t3": "待实跑"
    },
    {
      "id": "A3",
      "item": "check:term-map / check:architecture 的 STALE 归因本队之外",
      "why": "基线即为 exit 1 / STALE_BEFORE。",
      "captain_finding": "docs/term-map.md 的 13 处改动 mtime 为 10-07 23:21:48，**早于本队启动（23:50）**，内容为新增术语条目与『上下文收据→上下文凭证』统一，与经验绑定无关。docs/architecture.md 无未提交改动。**因此可确定归因本队之外。**",
      "status_for_t3": "已由队长核实，t3 复核即可"
    },
    {
      "id": "A4",
      "item": "四条已知缺口已持久登记进 docs/gates.md",
      "why": "**这是 L08 的核心检验点。** 队长 00:18 实测：check:gates 输出称『登记见 docs/gates.md』，但 gates.md mtime 仍为 10-07 22:37:55，build-release / check-import-cycles / real-model-gate 三者均未登记。缺口若只存在于门的运行时输出，门一关即消失，无持久痕迹——这与 L08 的失败机制同构，本轮不能重演。",
      "required": "gates.md 中存在一个『已知缺口』小节，逐条写明是什么、为什么暂不修、谁该来修。",
      "captain_observed": "00:18:12 未登记，已发指令要求 t2 补写",
      "status_for_t3": "**阻断项** — 未登记则 t3 不得判 pass"
    },
    {
      "id": "A5",
      "item": "并行会话的未提交改动被完整保留",
      "why": "t1 明确警告过此风险。两份文件含并行会话 2026-10-07 22:37-22:38 的术语统一改动（门禁→门、门禁契约→门清单）。",
      "method": "在 verify-gates-contract.mjs 中检索『门禁』，计数应为 0；gates.md 原有章节文字应保持。",
      "captain_observed": "00:17 实测 verify-gates-contract.mjs 中『门禁』出现 0 次、『门 』出现 2 次 → 5 处术语改动完整保留。gates.md 待 A4 写入后复核。",
      "status_for_t3": "待最终复核"
    },
    {
      "id": "A6",
      "item": "触发用例有实跑证据（会红）",
      "why": "目标判据①：绑定须证明在对应场景下会触发并拦截。",
      "requirement": "用**临时副本**制造缺登记场景，证明检查报红；不得修改真实文件制造失败。",
      "captain_observed": "未观测到 t2 的触发用例证据",
      "status_for_t3": "**阻断项** — binding-evidence.md 必须包含"
    },
    {
      "id": "A7",
      "item": "不误伤用例有实跑证据",
      "why": "目标判据②：在不适用场景下不误伤。",
      "captain_observed": "00:17 实跑显示 launcher.mjs 被正确排除并写明理由（『冒烟测试：启动应用并 curl 探活，不判定内容质量』）。这是不误伤的正面证据，但需 t2 明确记录。",
      "status_for_t3": "待 binding-evidence.md"
    },
    {
      "id": "A8",
      "item": "不改变产品行为",
      "why": "目标判据③。",
      "captain_finding": "本轮改动限于 scripts/verify-gates-contract.mjs（静态字符串判定，不执行构建、不写产物）与 docs/gates.md。**未触碰 packages/、apps/、任何 workflow。**",
      "method": "git status 对比基线 135 项，确认无新增产品代码改动。",
      "status_for_t3": "待实跑 git status"
    },
    {
      "id": "A9",
      "item": "图谱门状态如实记录",
      "why": "不得把 cycleCount=0 写成『图谱门已通过』。",
      "captain_finding": "gitnexus status 报 stale（索引提交与当前提交同为 8fb9798）；analyze --index-only 重建后仍 stale；--repair-fts 失败（Typedef.typedef_fts 缺失）。graph-gate.yml:43-44 执行的 check-import-cycles.mjs 恰是图谱环检查，而它不在 gates.md、不在 package.json。**本次未过图谱门禁。**",
      "authority": "契约已将图谱门列为本地自选加固（SHOULD），工具不可用时继续工作而非阻断交付；但状态必须如实披露。",
      "reference": "graph-gate-status.md",
      "status_for_t3": "已记录，t3 沿用"
    },
    {
      "id": "A10",
      "item": "变更记录与地图登记齐备且披露 AI 参与",
      "why": "完成判据之一；契约《AI 参与编码的责任边界》要求披露。",
      "assigned_id": "CHG-20261009-02（CHG-20261009-01 已用于经验库索引，其记录文件由队长补建于本轮早前）",
      "reference": "docs/changes/CHG-20261009-01-mozhou-experience-library.md 可作为格式范例",
      "status_for_t3": "t3 的主职责"
    }
  ],

  "hard_constraints_for_t3": [
    "不得以成员自报代替独立实跑。队长已就 A1/A5 独立实跑，其余项 t3 须自行复跑。",
    "不得为让门变绿而删除 A4 的缺口登记或任何检查。",
    "不得修改 check:term-map / check:architecture 的既有 STALE（未授权），也不得把它们算作本轮成果。",
    "全程零 git 写操作：不 commit、不 push、不 stash、不 reset。",
    "不得声称经验条目的预防效果已验证。回放 21/22 vs 22/22 是回放结果，不是预防效果证据。",
    "交付记录须区分 passed / failed / blocked / unverified 四态，不得笼统写『已验证』。"
  ],

  "known_non_blocking_findings": {
    "历史变更记录缺 AI 披露": "docs/changes/ 下 32 份记录中仅 11 份含 AI 参与披露，21 份为历史欠账。属独立范围，本队不追溯修改，仅登记为遗留。",
    "gates.md 实测基线陈旧": "第 104-108 行『实测基线（2026-10-02）』记 103 文件/910 测试，而 PROJECT-MAP.md:381（2026-10-07）记 117 文件/1048 用例，落后 138 个用例。修复属 CHG-20261009 之外的独立问题，本队不动。"
  }
}