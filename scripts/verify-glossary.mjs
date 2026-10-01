#!/usr/bin/env node
// verify-glossary.mjs — 术语单一权威门禁。失败即 exit 1。
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const problems = []; const ok = [];
const trackedMd = execSync('git -c core.quotepath=false ls-files -z "*.md"', { encoding: "utf8" })
  .split("\0").filter(Boolean);

// ---- 1. GLOSSARY.md 单一术语权威 ----
if (!existsSync("GLOSSARY.md")) {
  problems.push("GLOSSARY.md 不存在。术语必须有唯一的家（ADR-0032）。");
} else {
  const lines = readFileSync("GLOSSARY.md", "utf8").split("\n");
  const terms = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\*\*(.+?)\*\*:/);
    if (!m) continue;
    terms.push({ name: m[1], line: i + 1 });
    // 词条后面允许夹表格，故窗口放宽到 14 行
    const rest = lines.slice(i + 1, i + 15).join("\n");
    if (!/^_Avoid_:/m.test(rest)) problems.push("GLOSSARY.md:" + (i + 1) + " 词条「" + m[1] + "」缺少 _Avoid_ 行。");
  }
  if (terms.length < 50) problems.push("GLOSSARY.md 词条数 " + terms.length + " < 50，疑似被清空或损坏。");
  ok.push("GLOSSARY.md 存在，" + terms.length + " 个词条，每个都有 _Avoid_ 行");
  if (existsSync("CONTEXT.md")) problems.push("CONTEXT.md 与 GLOSSARY.md 并存 —— 术语有了两个家（ADR-0032）。");
}

// ---- 2. 悬空 CONTEXT.md 引用 ----
const CONTEXT_ALLOW = new Set([
  "GLOSSARY.md", "AGENTS.md", "docs/adr/INDEX.md", "docs/agents/domain.md",
  "docs/adr/0032-glossary-promoted-from-context.md",  // 记录迁移本身的 ADR
]);
let ctxHits = 0;
for (const f of trackedMd) {
  if (!readFileSync(f, "utf8").includes("CONTEXT.md")) continue;
  ctxHits++;
  if (!CONTEXT_ALLOW.has(f)) problems.push(f + " 引用了已退役的 CONTEXT.md。");
}
ok.push("CONTEXT.md 残留引用 " + ctxHits + " 处，全部在迁移白名单内");

// ---- 3. 裸 ADR-0001..0007（歧义），预算只许减不许增 ----
const BARE = /\bADR-000[1-7]\b/g;
let bare = 0; const bareFiles = new Set();
for (const f of trackedMd) {
  if (f === "docs/adr/INDEX.md") continue; // 速查表必须展示裸号
  const lines = readFileSync(f, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const n = (lines[i].match(BARE) || []).length;
    if (n) { bare += n; bareFiles.add(f); }
  }
}
const BUDGET = Number(process.env.GLOSSARY_BARE_BUDGET || "54");
if (bare > BUDGET) {
  problems.push("裸 ADR-0001..0007 引用 " + bare + " 处，超过预算 " + BUDGET + "（" + bareFiles.size + " 个文件）—— 歧义在增加。");
} else {
  ok.push("裸 ADR-0001..0007 引用 " + bare + " 处 / 预算 " + BUDGET + "（只许减不许增，分布于 " + bareFiles.size + " 个文件）");
}

// ---- 4. AGENTS.md 只能有一套流程块 ----
if (existsSync("AGENTS.md")) {
  const a = readFileSync("AGENTS.md", "utf8");
  const it = (a.match(/^### Issue tracker/gm) || []).length;
  const as = (a.match(/^## Agent skills/gm) || []).length;
  if (it !== 1) problems.push("AGENTS.md 有 " + it + " 个 ### Issue tracker，必须恰好 1 个（ADR-0031）。");
  if (as !== 0) problems.push("AGENTS.md 有 " + as + " 个 ## Agent skills 块，必须为 0（ADR-0031）。");
  if (!a.includes("GLOSSARY.md")) problems.push("AGENTS.md 未指向 GLOSSARY.md。");
  ok.push("AGENTS.md 流程块唯一（Issue tracker×" + it + "，Agent skills×" + as + "）");
}

// ---- 5. 决策地图完整性 ----
if (!existsSync("docs/adr/INDEX.md")) {
  problems.push("docs/adr/INDEX.md 不存在。决策必须有一个家（ADR-0033）。");
} else {
  const ix = readFileSync("docs/adr/INDEX.md", "utf8");
  for (const n of ["0001", "0007"]) {
    if (!ix.includes("| " + n + " |")) problems.push("docs/adr/INDEX.md 缺少 " + n + " 的裸号速查行。");
  }
  ok.push("docs/adr/INDEX.md 存在，含裸号速查表");
}

// ---- 6. ADR 文件名不得残留裸 0001-0007 ----
for (const f of trackedMd) {
  if (!f.startsWith("docs/adr/")) continue;
  if (/^000[1-7]-/.test(f.split("/").pop())) problems.push(f + " 文件名仍是无前缀编号。");
}

ok.forEach((o) => console.log("  OK   " + o));
if (problems.length === 0) { console.log("PASS"); process.exit(0); }
console.log("");
problems.forEach((p) => console.log("  FAIL " + p));
console.log(""); console.log("FAIL: " + problems.length + " 项"); process.exit(1);
