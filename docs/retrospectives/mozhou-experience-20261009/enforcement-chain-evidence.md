{
  "record_type": "enforcement_chain_evidence",
  "id": "CHAIN-EVIDENCE-20261010",
  "captured_at": "2026-10-10T00:10:00+08:00",
  "captured_by": "captain",
  "why_this_matters": "本记录是 L01 与 L24『经验绑定机械入口』生效的**真实实例**，也是本轮目标所需的模板：说明经验怎么才算真的绑上了。记录它可避免把『写了文档』当成『生效』。",
  "finding_summary": "CHG-20261008-21 不仅新增了产物戳，还把依赖环检查写进了**项目契约 AGENTS.md §79**。这是全仓唯一一处『经验→契约→可执行门』完整闭环的样本，也是 L01 复发四天才被真正堵住的机制性原因。",
  "the_chain": [
    {
      "layer": "1-失败现场",
      "evidence": "PROJECT-MAP.md:403 与 docs/changes/CHG-20261008-21-release-stamp-and-local-graph-gate.md:18",
      "content": "产物戳无条件取 HEAD（build.mjs:94 改前：`sourceCommit: execFileSync('git',['rev-parse','HEAD'])`），不看工作区状态。发布审计两次栽在此处：90b45a1、06a5069。"
    },
    {
      "layer": "2-机械防护",
      "evidence": "scripts/release/lib/source-stamp.mjs（26 行）+ scripts/release/windows/build.mjs:15-22",
      "content": "computeSourceStamp(headSha, porcelainOutput) 为纯函数；脏工作区时 sourceCommit 加 -dirty 后缀，并给出 sourceCommitSha/dirty/dirtyFiles。新增 --print-stamp 可秒级核验，不构建。"
    },
    {
      "layer": "3-契约写入",
      "evidence": "AGENTS.md:79",
      "content": "『推送前的自动化门（项目级额外项）』：本项目推送前还必须跑一次依赖环检查 `node scripts/ci-gate.mjs graph-check`，期望输出 clean / cycleCount: 0。并说明 ci.yml 与 release.yml 都没有图谱步骤、.gitnexus/ 索引也不入库，所以这条只在本地把得住；2026-10-07 发布审计的 1 个循环就是这样活到 HEAD 的。"
    },
    {
      "layer": "4-本次实跑验证",
      "command": "node scripts/ci-gate.mjs graph-check",
      "exit_code": 0,
      "output": [
        "{",
        "  \"status\": \"clean\",",
        "  \"cycleCount\": 0,",
        "  \"cycles\": []",
        "}"
      ],
      "interpretation": "契约规定的那条命令可跑通并返回期望值。这是本轮唯一一条『契约要求的门』被队长亲自实跑的证据。"
    }
  ],
  "why_L01_recurred_before_this": {
    "timeline_fact": "10-03 发现并记录 → 10-07 同类问题复发 → 10-08 才补上 -dirty 标记（提交 1957bd1）。",
    "mechanism": "10-03 到 10-07 之间，经验只以散文形式留在变更记录与地图里，没有任何检查点会触发。10-08 补的是代码层标记（层 2），而 AGENTS.md §79（层 3）补的是契约层强制——后者才是防复发的部分。",
    "lesson_alignment": "对应 lessons.md L24『经验写成散文，不会改变下一次操作』与 L01『发布证据必须对应实际构建输入』。",
    "caveat": "10-08 是否已彻底防复发**未验证**：本次只实跑了 graph-check 与 --print-stamp，未构造『脏工作区下交付脏产物』的拦截实验，也未验证该门是否被实际执行。属于未验证，不得表述为已解决。"
  },
  "caller_analysis_for_blocking_upgrade": {
    "purpose": "目标要求评估 L01 是否需要从提示型改为阻断型。此项为契约『部署、集成和工具包装的交付门禁 → 1. Callers』的落实。",
    "callers_of_release_build": [
      {
        "caller": "package.json:15 package:windows",
        "chain": "pnpm build && pnpm --filter @mozhou/web build && node scripts/release/windows/build.mjs",
        "entry_kind": "人工/代理显式命令",
        "note": "这是 build.mjs 的唯一 package.json 入口。"
      },
      {
        "caller": "docs/windows-local-install.md:18 与 README.md:62",
        "chain": "均记录 `pnpm package:windows` 作为安装包构建方式",
        "entry_kind": "文档指引",
        "note": "人工按文档执行，无自动化。"
      },
      {
        "caller": "audit-2026-10-03/inventory.json:401-404",
        "chain": "记录 path=scripts/release/windows/build.mjs, publicEntry=pnpm package:windows",
        "entry_kind": "审计登记",
        "note": "确认该路径是公开发布入口。"
      }
    ],
    "explicit_non_callers": [
      ".github/workflows/release.yml —— 不调用 build.mjs（据 CHG-20261008-28:15 与 CHG-20261006-14 记录）",
      "pnpm package（package.json:18 → scripts/build-release.mjs）—— 不经过 windows/build.mjs",
      "scripts/ci-gate.mjs —— 只有 build/lint/test/graph-check 四个任务，无发布任务"
    ],
    "data_consumer_check": {
      "claim": "windows-build-result.json 无代码消费者，代码爆炸半径为零",
      "source": "docs/changes/CHG-20261008-21:63",
      "authority_caveat": "该结论来自人工 grep，且 CHG-20261008-21:63 明确标注 GitNexus 索引不覆盖 scripts/，impact 返回 not found。属**能力缺口已披露**，不构成图谱门禁通过。本轮未重新核实，沿用时须保留此限定。"
    },
    "risk_of_blocking_upgrade": {
      "assessment": "阻断型（脏即 exit≠0）会改变 `pnpm package:windows` 的现有行为。当前工作区有 135 项未提交改动，若改为硬阻断，任何在并行会话期间需要重建安装包的操作都会立即失败。",
      "recommendation": "不要把默认行为改为硬阻断。若要提供阻断能力，采用显式开关（如 --require-clean），默认保持 warn，并在文档写明两种语义。",
      "not_verified": "上述风险评估基于调用者检索与当前脏工作区状态，**未实跑**任何改造后的行为；改造方案本身在本记录中未被实现或测试。"
    }
  },
  "downstream_rule": [
    "t2 若改动 scripts/release/ 下的文件，必须在本记录基础上追加实测证据，不得沿用本记录的未验证结论。",
    "任何人不得据此声称 L01 已完全解决：已实跑的是 --print-stamp 与 graph-check，不是拦截行为。"
  ]
}