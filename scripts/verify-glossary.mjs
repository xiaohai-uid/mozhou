#!/usr/bin/env node
// verify-glossary.mjs — 术语单一权威门。失败即 exit 1。
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

// ---- 7. Part 3 禁用词，只扫活跃层 ----
// 规范词见 GLOSSARY.md Part 3。冻结的历史档案与生成物不改写（GLOSSARY §0 规则 6），
// 故本段只扫「还在被引用、改了不篡改历史」的那一层。范围是显式白名单，不是全仓。
const BANNED = [
  // 负向先行断言防跨词边界误报：「门」+「禁止/禁区」会拼出禁用词的字面序列
  // （2026-10-07 实测：`SSRF 门禁止私网目标`）。中文无词边界，机械扫描无法消除
  // 全部此类误报，故对已知碰撞加窄豁免；新增误报时按同一方式收窄，不放宽整条规则。
  { word: "门禁", re: /门禁(?!止)/g, fix: "门 + 限定词" },
  { word: "闸门", re: /闸门/g, fix: "门（确定性阻断）/ 检查点（人工介入点）" },
  { word: "工单", re: /工单/g, fix: "议题 Issue" },
  { word: "数据平面", re: /数据平面/g, fix: "数据面 Data Plane" },
  { word: "熔核", re: /熔核/g, fix: "内核 Kernel" },
  { word: "遗留切片", re: /遗留切片/g, fix: "挂账项 Deferred Item" },
  { word: "任务简报", re: /任务简报/g, fix: "议题 Issue" },
  // 「收据」是 Context Receipt 的已废弃中文名；规范词是「上下文凭证」。
  { word: "收据", re: /收据/g, fix: "上下文凭证 Context Receipt" },
];
const ACTIVE_PREFIX = ["apps/web/", "packages/", "scripts/", ".github/", "specs/", "src-tauri/", "docs/agents/", "docker/"];
const ACTIVE_FILE = new Set(["README.md", "AGENTS.md", "CLAUDE.md", "eslint.config.js", "docs/gates.md"]);
const SCAN_EXT = /[.](md|ts|tsx|mjs|js|jsx|yml|yaml|json|html|css|rs)$/;
// 生成物与小说语料：前者随生成器刷新，后者的「工单」是作品内容，不是术语。
const EXEMPT_PREFIX = ["apps/web/src/code-graph/", "scripts/corpus/"];
const EXEMPT_FILE = new Set(["GLOSSARY.md", "docs/term-map.md", "scripts/verify-glossary.mjs"]);
// 显式豁免：引用已废止名称做更正说明，不是使用它。
const ALLOWED = new Set(["AGENTS.md|遗留切片"]);

const trackedAll = execSync('git -c core.quotepath=false ls-files -z', { encoding: "utf8" })
  .split("\0").filter(Boolean);
let bannedHits = 0; const bannedFiles = new Set();
for (const f of trackedAll) {
  const inScope = ACTIVE_FILE.has(f) || ACTIVE_PREFIX.some((p) => f.startsWith(p));
  if (!inScope || EXEMPT_FILE.has(f) || EXEMPT_PREFIX.some((p) => f.startsWith(p))) continue;
  if (!SCAN_EXT.test(f)) continue;
  const lines = readFileSync(f, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const b of BANNED) {
      if (ALLOWED.has(f + "|" + b.word)) continue;
      const n = (lines[i].match(b.re) || []).length;
      if (!n) continue;
      bannedHits += n; bannedFiles.add(f);
      problems.push(f + ":" + (i + 1) + " 使用禁用词「" + b.word + "」→ 改写为「" + b.fix + "」（GLOSSARY Part 3）");
    }
  }
}
if (bannedHits === 0) ok.push("活跃层无 Part 3 禁用词（" + ACTIVE_PREFIX.length + " 个目录前缀 + " + ACTIVE_FILE.size + " 个单文件）");
else ok.push("活跃层禁用词 " + bannedHits + " 处，分布于 " + bannedFiles.size + " 个文件（见下方 FAIL）");

ok.forEach((o) => console.log("  OK   " + o));
if (problems.length === 0) { console.log("PASS"); process.exit(0); }
console.log("");
problems.forEach((p) => console.log("  FAIL " + p));
console.log(""); console.log("FAIL: " + problems.length + " 项"); process.exit(1);
