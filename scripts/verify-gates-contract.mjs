#!/usr/bin/env node
// verify-gates-contract.mjs — 校验 docs/gates.md 不与仓库现实脱节。
import { readFileSync, existsSync } from "node:fs";

const problems = [];
const ok = [];
const GATES = "docs/gates.md";

if (!existsSync(GATES)) {
  console.error("FAIL docs/gates.md 不存在。门禁的退出码契约必须有唯一的家。");
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
if (named.size === 0) problems.push("docs/gates.md 未列出任何 pnpm run 门禁，疑似内容丢失。");
for (const n of named) {
  if (!scripts[n]) problems.push("docs/gates.md 提到 pnpm run " + n + "，但 package.json 没有这个 script。");
}
ok.push("docs/gates.md 列出 " + named.size + " 个 pnpm run 门禁，全部在 package.json 中存在");

// 2) gates.md 里提到的每个脚本路径必须真实存在
const paths = new Set();
const rePath = new RegExp("scripts[A-Za-z0-9_./-]*[.]mjs", "g");
for (const m of md.matchAll(rePath)) paths.add(m[0]);
for (const p of paths) {
  if (!existsSync(p)) problems.push("docs/gates.md 引用了不存在的脚本 " + p + "。");
}
ok.push("docs/gates.md 引用 " + paths.size + " 个脚本文件，全部存在");

// 3) 关键门禁必须同时出现在 gates.md 与 CI，否则清单会腐化
for (const n of ["check:glossary", "check:architecture", "check:gates"]) {
  if (!md.includes("pnpm run " + n)) problems.push("门禁 " + n + " 未登记进 docs/gates.md。");
  if (!ci.includes(n)) problems.push("门禁 " + n + " 不在 .github/workflows/ci.yml 里 —— 它不会被执行。");
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

ok.forEach((o) => console.log("  OK   " + o));
if (problems.length === 0) {
  console.log("PASS");
  process.exit(0);
}
console.log("");
problems.forEach((p) => console.log("  FAIL " + p));
console.log("");
console.log("FAIL: " + problems.length + " 项");
process.exit(1);
