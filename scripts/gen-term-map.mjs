#!/usr/bin/env node
// gen-term-map.mjs — 由 GLOSSARY.md 生成 docs/term-map.md（中英标识符映射）。
//
// 证据分级（2026-10-02 修订）：
//   旧版只做字符串边界匹配，把「模板字符串里的英文词」「注释里的词」
//   「JS 内建方法名」都算成 verified。已确认两处误报：
//     · Scene -> chapter.ts 的 Markdown 模板字符串（真声明在 kernel-schema.ts）
//     · Slice -> prose.slice(0,20) 的内建字符串方法（无领域 slice 声明）
//   新版先剥离注释与字符串字面量，再区分「声明」与「引用」，并把测试文件降为辅助证据。
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const OUT = "docs/term-map.md";
const SEARCH_ROOTS = ["packages", "apps/web/src", "apps/web/server"];
const SKIP_DIR = /node_modules|dist|[.]next|coverage/;
const TEST_RE = /[.](test|spec)[.]tsx?$/;

// ---------- 收集源码文件 ----------
const files = [];
function walk(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) walk(p); continue; }
    if (/[.](ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts")) files.push(p);
  }
}
for (const r of SEARCH_ROOTS) walk(r);

// ---------- 剥离注释与字符串字面量 ----------
// 返回该行的「纯代码」视图；block 注释状态在行间传递。
function codeOnly(lines, startIdx) {
  let inBlock = startIdx.inBlock;
  const out = [];
  for (const raw of lines) {
    let res = "";
    let i = 0;
    let mode = inBlock ? "block" : "code";
    while (i < raw.length) {
      const c = raw[i], d = raw[i + 1];
      if (mode === "block") {
        if (c === "*" && d === "/") { mode = "code"; i += 2; } else i++;
        continue;
      }
      if (c === "/" && d === "/") break;                 // 行注释
      if (c === "/" && d === "*") { mode = "block"; i += 2; continue; }
      if (c === "'" || c === '"' || c === "`") {
        const q = c; i++;
        while (i < raw.length) {
          if (raw[i] === "\\") { i += 2; continue; }
          if (raw[i] === q) { i++; break; }
          i++;
        }
        res += " ";                                   // 字符串一律抹掉
        continue;
      }
      res += c; i++;
    }
    out.push(res);
    inBlock = mode === "block";
  }
  return { lines: out, inBlock };
}

// ---------- 标识符匹配（只在纯代码视图里找） ----------
function isWordChar(c) {
  const n = c.charCodeAt(0);
  return (n >= 97 && n <= 122) || (n >= 65 && n <= 90) || (n >= 48 && n <= 57) || c === "_" || c === "$";
}
function findAt(file, name) {
  let lines;
  try { lines = readFileSync(file, "utf8").split("\n"); } catch { return null; }
  const state = { inBlock: false };
  const pure = [];
  for (let i = 0; i < lines.length; i++) {
    const r = codeOnly([lines[i]], state);
    pure.push(r.lines[0]);
    state.inBlock = r.inBlock;
  }
  // 「声明」必须是**导出**的声明。非导出的同名声明只是局部变量，
  // 例如 assemble.ts:295 的 `const slice = text.slice(...)`，与领域概念无关。
  const declRe = new RegExp("export\\s+(declare\\s+)?(abstract\\s+)?(class|interface|type|enum|const|let|var|function)\\s+" + name + "\\b");
  const localRe = new RegExp("(?:^|[^.\\w])(declare\\s+)?(abstract\\s+)?(class|interface|type|enum|const|let|var|function)\\s+" + name + "\\b");
  for (let i = 0; i < pure.length; i++) {
    let idx = pure[i].indexOf(name);
    while (idx >= 0) {
      const before = idx > 0 ? pure[i][idx - 1] : "";
      const afterIdx = idx + name.length;
      const after = afterIdx < pure[i].length ? pure[i][afterIdx] : "";
      if ((!before || !isWordChar(before)) && (!after || !isWordChar(after))) {
        return {
          file, line: i + 1, name,
          kind: declRe.test(pure[i]) ? "declaration" : (localRe.test(pure[i]) ? "local" : "reference"),
          isTest: TEST_RE.test(file),
        };
      }
      idx = pure[i].indexOf(name, idx + 1);
    }
  }
  return null;
}

function findBest(name) {
  let decl = null, local = null, ref = null, testOnly = null;
  for (const f of files) {
    const r = findAt(f, name);
    if (!r) continue;
    if (r.isTest) { if (!testOnly) testOnly = r; continue; }
    if (r.kind === "declaration") { decl = r; break; }
    if (r.kind === "local") { if (!local) local = r; continue; }
    if (!ref) ref = r;
  }
  return decl || local || ref || testOnly;
}

// ---------- 解析词条 ----------
const gLines = readFileSync("GLOSSARY.md", "utf8").split("\n");
const terms = [];
for (const line of gLines) {
  const m = line.match(/^\*\*(.+?)\*\*:/);
  if (!m) continue;
  const full = m[1];
  const pm = full.match(/\(([^()]*)\)\s*$/);
  const cn = (pm ? full.slice(0, full.indexOf("(")) : full).trim();
  let en = pm ? pm[1].trim() : "";
  const asciiRun = en.match(/^[A-Za-z][A-Za-z0-9 _-]*/);
  if (asciiRun) en = asciiRun[0].trim();
  terms.push({ cn, en });
}

function variants(en) {
  if (!en) return [];
  const words = en.split(/[\s_-]+/).filter(Boolean);
  if (words.length === 0) return [];
  const pascal = words.map((w) => w[0].toUpperCase() + w.slice(1)).join("");
  const degraded = words.map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w[0].toUpperCase() + w.slice(1))).join("");
  const camel = pascal[0].toLowerCase() + pascal.slice(1);
  const camelDeg = degraded[0].toLowerCase() + degraded.slice(1);
  const snake = words.map((w) => w.toUpperCase()).join("_");
  const kebab = words.map((w) => w.toLowerCase()).join("-");
  return [...new Set([pascal, degraded, camel, camelDeg, snake, kebab])];
}

// ---------- 匹配 ----------
const rows = [];
const counts = { declaration: 0, local: 0, reference: 0, testOnly: 0, none: 0 };
for (const t of terms) {
  let hit = null;
  for (const v of variants(t.en)) {
    const r = findBest(v);
    if (r) { hit = r; break; }
  }
  if (!hit) counts.none++;
  else if (hit.isTest) counts.testOnly++;
  else if (hit.kind === "declaration") counts.declaration++;
  else if (hit.kind === "local") counts.local++;
  else counts.reference++;
  rows.push({ ...t, hit });
}

function selfTest() {
  const fails = [];
  const scene = findBest("Scene");
  if (!scene || scene.kind !== "declaration" || !scene.file.includes("kernel")) {
    fails.push("Scene must resolve to a kernel declaration, got " + JSON.stringify(scene));
  }
  const slice = findBest("slice");
  if (slice && !slice.isTest && (slice.kind === "declaration")) {
    fails.push("slice misjudged as domain declaration: " + slice.file + ":" + slice.line);
  }
  for (const bad of ["issue", "ticket", "contract"]) {
    const h = findBest(bad);
    if (h && !h.isTest && h.kind === "declaration") {
      fails.push(bad + " misjudged as exported domain declaration: " + h.file + ":" + h.line);
    }
  }
  if (!findBest("ContextReceipt")) fails.push("ContextReceipt should be found.");
  if (!findBest("ProposalPort")) fails.push("ProposalPort should be found.");
  return fails;
}

const L = [];
L.push("<!-- Generated by scripts/gen-term-map.mjs - DO NOT EDIT BY HAND. -->");
L.push("<!-- Self-test: pnpm gen:term-map --self-test -->");
L.push("");
L.push("# 中英标识符映射表");
L.push("");
L.push("> 2026-10-02 修订。初版只做字符串边界匹配，把模板字符串里的英文词、注释与 JS 内建方法名都算成了领域映射。独立复核确认两处误报并已修复。");
L.push("");
L.push("> - `Scene` 曾指向 chapter.ts 的 Markdown 模板字符串，真声明在 kernel-schema.ts");
L.push("> - `切片 Slice` 曾指向 prose.slice(0,20) 内建字符串方法，全仓无 slice 领域声明");
L.push("");
L.push("## 证据分级");
L.push("");
L.push("| 状态 | 含义 |");
L.push("|---|---|");
L.push("| 声明 | 生产代码里找到该标识符的**导出**声明（export class/interface/type/enum/const/function） |");
L.push("| 局部同名 | 找到**非导出**的同名声明。只是同名局部变量，不等于领域对象 |");
L.push("| 引用 | 只在生产代码里找到引用，没有声明 |");
L.push("| 仅测试 | 只在测试文件里出现 |");
L.push("| 未验证 | 六种大小写变体全试过，剥离注释与字符串后仍无 |");
L.push("");
L.push("匹配前先剥离行注释、块注释与所有字符串字面量（含模板字符串），因此模板里出现的英文词不会再被算作证据。");
L.push("");
L.push("## 统计");
L.push("");
L.push("- 词条总数: **" + terms.length + "**");
L.push("- 声明: **" + counts.declaration + "**");
L.push("- 局部同名: **" + counts.local + "**");
L.push("- 引用: **" + counts.reference + "**");
L.push("- 仅测试: **" + counts.testOnly + "**");
L.push("- 未验证: **" + counts.none + "**");
L.push("");
L.push("## 已确认的命名漂移");
L.push("");
L.push("| 术语 | 文档英文名 | 代码实际情况 |");
L.push("|---|---|---|");
L.push("| 上下文档位 | AI Context Tier | AiContextTier（TS 惯例把缩写 AI 降级为 Ai） |");
L.push("| 切片 | Slice | 无领域标识符（slice 是 JS 内建方法） |");
L.push("");
L.push("## 映射表");
L.push("");
L.push("| 规范中文名 | 英文名 | 代码标识符 | 出处 | 状态 |");
L.push("|---|---|---|---|---|");
for (const r of rows) {
  const f = r.hit ? r.hit.file.replace(/\\/g, "/") : "";
  const ln = r.hit ? r.hit.line : "";
  if (!r.hit) {
    L.push("| " + r.cn + " | " + (r.en || "-") + " | - | - | 未验证 |");
  } else if (r.hit.isTest) {
    L.push("| " + r.cn + " | " + r.en + " | `" + r.hit.name + "` | `" + f + ":" + ln + "` | 仅测试 |");
  } else if (r.hit.kind === "declaration") {
    L.push("| " + r.cn + " | " + r.en + " | `" + r.hit.name + "` | `" + f + ":" + ln + "` | 声明 |");
  } else if (r.hit.kind === "local") {
    L.push("| " + r.cn + " | " + r.en + " | `" + r.hit.name + "` | `" + f + ":" + ln + "` | 局部同名 |");
  } else {
    L.push("| " + r.cn + " | " + r.en + " | `" + r.hit.name + "` | `" + f + ":" + ln + "` | 引用 |");
  }
}
L.push("");

const out = L.join("\n");

if (process.argv.indexOf("--self-test") >= 0) {
  const fails = selfTest();
  if (fails.length) {
    console.error("SELF-TEST FAILED:");
    fails.forEach((x) => console.error("  " + x));
    process.exit(1);
  }
  console.log("SELF-TEST PASS: 2 positive + 4 negative cases OK");
  process.exit(0);
}

if (process.argv.indexOf("--check") >= 0) {
  const cur = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (cur !== out) {
    console.error("STALE: " + OUT + " differs from generator output. Run: pnpm gen:term-map");
    process.exit(1);
  }
  console.log("FRESH: " + OUT);
} else {
  writeFileSync(OUT, out);
  console.log("WROTE " + OUT + " terms=" + terms.length + " decl=" + counts.declaration +
    " local=" + counts.local + " ref=" + counts.reference + " test=" + counts.testOnly + " none=" + counts.none +
    " sum=" + (counts.declaration + counts.local + counts.reference + counts.testOnly + counts.none));
}
