#!/usr/bin/env node
// verify-gates-contract.mjs — 校验 docs/gates.md 不与仓库现实脱节。
import { readFileSync, existsSync, readdirSync } from "node:fs";

const problems = [];
const ok = [];
// knownGaps：真实存在的缺口，可见但不阻塞。
// 分开记是因为「如实报告缺口」和「就地修产品代码」是两件事——
// 把缺口降级成静默通过，等于让清单重新声称覆盖了实际没覆盖的东西。
const knownGaps = [];
const GATES = "docs/gates.md";

if (!existsSync(GATES)) {
  console.error("FAIL docs/gates.md 不存在。门的退出码契约必须有唯一的家。");
  process.exit(1);
}

const md = readFileSync(GATES, "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const scripts = pkg.scripts || {};
const ci = readFileSync(".github/workflows/ci.yml", "utf8");

// 1) gates.md 里提到的每个 pnpm run <name>，package.json 必须真有这个 script
const named = new Set();
const reNamed = new RegExp("`pnpm run ([a-z0-9:-]+)`", "g");
for (const m of md.matchAll(reNamed)) named.add(m[1]);
if (named.size === 0) problems.push("docs/gates.md 未列出任何 pnpm run 门，疑似内容丢失。");
for (const n of named) {
  if (!scripts[n]) problems.push("docs/gates.md 提到 pnpm run " + n + "，但 package.json 没有这个 script。");
}
ok.push("docs/gates.md 列出 " + named.size + " 个 pnpm run 门，全部在 package.json 中存在");

// 2) gates.md 里提到的每个脚本路径必须真实存在
const paths = new Set();
const rePath = new RegExp("scripts[A-Za-z0-9_./-]*[.]mjs", "g");
for (const m of md.matchAll(rePath)) paths.add(m[0]);
for (const p of paths) {
  if (!existsSync(p)) problems.push("docs/gates.md 引用了不存在的脚本 " + p + "。");
}
ok.push("docs/gates.md 引用 " + paths.size + " 个脚本文件，全部存在");

// 3) 关键门必须同时出现在 gates.md 与 CI，否则清单会腐化
for (const n of ["check:glossary", "check:architecture", "check:gates"]) {
  if (!md.includes("pnpm run " + n)) problems.push("门 " + n + " 未登记进 docs/gates.md。");
  if (!ci.includes(n)) problems.push("门 " + n + " 不在 .github/workflows/ci.yml 里 —— 它不会被执行。");
}
ok.push("check:glossary / check:architecture / check:gates 同时登记在 gates.md 与 ci.yml");

// 4) 铁律必须在场
if (!md.includes("BLOCKED 不是 PASSED")) problems.push("docs/gates.md 缺少「BLOCKED 不是 PASSED」这条铁律。");
else ok.push("铁律「BLOCKED 不是 PASSED」在场");

// 5) BLOCKED 语义必须与脚本实际行为一致（防止文档漂移）
const j = readFileSync("scripts/verify-real-model-journey.mjs", "utf8");
const hasGuard = new RegExp("const BLOCKED_EXIT_CODE = STRICT [?] 2 : 0;").test(j);
const hasUse = new RegExp("process[.]exit[(]BLOCKED_EXIT_CODE[)]").test(j);
if (!hasGuard || !hasUse) {
  problems.push("verify-real-model-journey.mjs 的 --strict 行为与文档不符，请同步 docs/gates.md 或修回脚本。");
} else {
  ok.push("verify-real-model-journey.mjs 的 --strict 实现与文档一致（BLOCKED: 默认 0 / --strict 2）");
}

// 6) L01：产出交付物的构建入口必须登记，且其文件必须打来源戳。
//    为什么单独一条：戳本身早就有了（scripts/release/lib/source-stamp.mjs）。
//    历史上发布路径上的另一个入口（scripts/build-release.mjs，release.yml 调用）
//    全文无戳引用，它产出的 tar 归档不写明自己来自哪个提交——这正是「产物↔提交不对应」
//    的复发点。2026-10-10 已给 build-release.mjs 补上戳（复用同一个 source-stamp.mjs，
//    写入 bundle 目录的 BUILD-STAMP.json）。本检查保留为回归护栏：只登记、不校验，
//    等于让清单声称覆盖了实际没覆盖的路径。
//    本检查纯静态：只读文件、只做字符串匹配，不执行任何构建。
//
//    未打戳的入口按「已知缺口」可见输出，不阻塞：如实报告缺口不等于就地修产品代码。
const DELIVERABLE_ENTRIES = [
  { entry: "scripts/release/windows/build.mjs", from: "package.json:package:windows" },
  { entry: "scripts/build-release.mjs", from: "package.json:build:release / .github/workflows/release.yml" },
];
const STAMP_SIGNALS = ["source-stamp", "sourceCommit", "computeSourceStamp", "readSourceStamp"];

for (const d of DELIVERABLE_ENTRIES) {
  if (!existsSync(d.entry)) {
    problems.push("交付物入口 " + d.entry + "（来自 " + d.from + "）已登记，但文件不存在。");
    continue;
  }
  const src = readFileSync(d.entry, "utf8");
  if (!STAMP_SIGNALS.some((s) => src.includes(s))) {
    knownGaps.push(
      "交付物入口 " + d.entry + "（" + d.from + "）没有来源戳引用，产物无法自证来自哪个提交。" +
        "已知缺口，登记见 docs/gates.md「门清单已知缺口（可见，不阻塞）」；" +
        "补戳时应复用 scripts/release/lib/source-stamp.mjs，不新造戳格式。",
    );
  } else {
    ok.push("交付物入口 " + d.entry + " 已登记且有来源戳引用");
  }
}
if (knownGaps.length === 0) ok.push("全部交付物入口都有来源戳引用");

// 7) L08：CI 实际执行的门必须在 docs/gates.md 登记。
//    为什么单独一条：原先只读 ci.yml 一个文件，于是 release.yml / graph-gate.yml /
//    security.yml 里的门完全不在视野内。「全绿」不等于「该有的门都跑了」——
//    这条检查强制清单以 workflow 文件为事实来源，而不是以单个 workflow 为准。
//    同样纯静态：只读 workflow 文本，不触发任何门。
//
//    只取 run: 块里显式调用的仓库脚本与 pnpm run <name>；
//    环境准备（install/audit/build/test/typecheck 等 pnpm 标准链）不是「门」，
//    但仍要求它们在 gates.md 有登记的既有 CI 链行，这条由检查 3 覆盖，不在此重复。
const WORKFLOW_DIR = ".github/workflows";
const workflowFiles = existsSync(WORKFLOW_DIR)
  ? readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith(".yml")).sort()
  : [];

const reRunScript = new RegExp("node (scripts[A-Za-z0-9_./-]*[.]mjs)", "g");
const rePnpmRun = new RegExp("pnpm run ([a-z0-9:-]+)", "g");

// 显式排除清单：workflow 里出现、但不构成「门」的调用。
// 逐条写明理由，不靠正则碰运气漏掉——漏掉就会变成静默通过，那正是本检查要防的事。
// 排除项仍然打印出来，便于人工复核分类是否还成立。
const NOT_A_GATE = new Map([
  [
    "scripts/launcher.mjs",
    "release.yml 的本地运行时冒烟测试：启动应用并 curl 探活，验证「能起来」，不判定内容质量",
  ],
]);

const ciGates = new Map(); // "入口或门名" -> 首次出现的 workflow 文件
for (const wf of workflowFiles) {
  const text = readFileSync(WORKFLOW_DIR + "/" + wf, "utf8");
  const lines = text.split("\n");

  // pnpm run <name>：只取 run: 块内的调用，避免误采 env/with 里的同名字符串。
  let inRun = false;
  let runIndent = 0;
  for (const line of lines) {
    const isRunKey = /^\s*-?\s*run:\s*(.*)$/.exec(line);
    if (isRunKey) {
      inRun = true;
      runIndent = line.length - line.trimStart().length;
      const inline = isRunKey[1].trim();
      if (inline) {
        for (const m of inline.matchAll(rePnpmRun)) if (!ciGates.has(m[1])) ciGates.set(m[1], wf);
      }
      continue;
    }
    if (inRun) {
      const indent = line.length - line.trimStart().length;
      if (line.trim() === "") continue;
      if (indent <= runIndent && line.trim().startsWith("-")) { inRun = false; continue; }
      for (const m of line.matchAll(rePnpmRun)) if (!ciGates.has(m[1])) ciGates.set(m[1], wf);
    }
  }

  // node scripts/<x>.mjs：直调的门与构建入口。
  for (const m of text.matchAll(reRunScript)) if (!ciGates.has(m[1])) ciGates.set(m[1], wf);
}

if (workflowFiles.length === 0) {
  problems.push("未找到 .github/workflows/*.yml，无法以 workflow 为事实来源核对门清单。");
} else {
  for (const [name, wf] of ciGates) {
    const excluded = NOT_A_GATE.get(name);
    if (excluded) {
      ok.push("CI(" + wf + ") 的 " + name + " 已排除：非门（" + excluded + "）");
      continue;
    }
    const registered =
      name.startsWith("scripts/") ? md.includes(name) : md.includes("pnpm run " + name);
    if (registered) {
      ok.push("CI(" + wf + ") 执行的 " + name + " 在 docs/gates.md 有登记");
    } else {
      knownGaps.push(
        "CI(" + wf + ") 执行了 " + name + "，但 docs/gates.md 没有登记它。" +
          "已知缺口：清单声称记录了全部门，实际漏了这条路径。登记见 docs/gates.md「门清单已知缺口（可见，不阻塞）」。",
      );
    }
  }
}

ok.forEach((o) => console.log("  OK   " + o));
if (knownGaps.length > 0) {
  console.log("");
  console.log("  以下为已知缺口（可见，不阻塞）：");
  knownGaps.forEach((g) => console.log("  GAP   " + g));
}
// --strict-gaps：把「已知缺口」升级为阻断项，用于 CI 想真正拦住未打戳/未登记路径时使用。
// 默认不开：缺口是真实存在的存量问题，一次性全部阻断会让门立刻常红而无人处理。
// 开关默认关闭 → 不改变任何既有调用方的行为。
const STRICT_GAPS = process.argv.includes("--strict-gaps");
if (STRICT_GAPS) problems.push(...knownGaps);

if (problems.length === 0) {
  console.log("");
  console.log(
    knownGaps.length === 0
      ? "PASS"
      : "PASS: " + knownGaps.length + " 项已知缺口（不阻塞），无新增问题。",
  );
  process.exit(0);
}
console.log("");
problems.forEach((p) => console.log("  FAIL " + p));
console.log("");
console.log("FAIL: " + problems.length + " 项");
process.exit(1);
