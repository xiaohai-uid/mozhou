#!/usr/bin/env node
// gen-adr-refs.mjs — 按消歧标记把裸 ADR-00XX 引用改写为 K-/A- 前缀。
// 判不出的引用一律不动（宁可留歧义，也不制造错误引用）。
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const AMBIG = new Set(["0001","0002","0003","0004","0005","0006","0007"]);
const LINEAGE = {
  "0001": { K: ["Novel Kernel", "Skill Adapter"], A: ["写作上下文边界", "模型输入分层"] },
  "0002": { K: ["Temporal Canon", "Candidate-to-Canon"], A: ["写作上下文", "模型传输", "候选生命周期"] },
  "0003": { K: ["Dependency Manifest", "Change Impact", "变更影响"], A: ["候选生命周期", "隔离"] },
  "0004": { K: ["Context Compiler", "Context Receipt", "Story Bible", "Two-Stage Context"], A: ["semantic seam", "wire payload", "语义 seam", "传输 seam"] },
  "0005": { K: ["Policy Flywheel", "Privacy", "飞轮", "隐私"], A: ["扫榜", "趋势", "搜索通道"] },
  "0006": { K: ["Local Data Plane", "本地数据面", "双平面存储", "SQLite Projection"], A: ["Skill 运行时", "双栏", "Workbench A", "workbench-a"] },
  "0007": { K: ["Novel Runtime", "Event Architecture", "(novel)", "novel", "事件词表", "词表"], A: ["可恢复创作任务", "任务运行时", "generation_jobs"] },
};

// 匹配裸 ADR-0001..0007（ADR-K-0002 这类带前缀的不会命中，因为 ADR- 后必须是数字）
const RE = /\bADR-(000[1-7])\b/g;

const files = execSync('git -c core.quotepath=false ls-files -z "*.md"', { encoding: "utf8" })
  .split("\0").filter(Boolean);

let changedFiles = 0, resolved = 0, skipped = 0;
const unresolved = [];

for (const f of files) {
  let src;
  try { src = readFileSync(f, "utf8"); } catch { continue; }
  const lines = src.split("\n");
  let touched = false;

  for (let i = 0; i < lines.length; i++) {
    const bare = [...lines[i].matchAll(RE)].map((m) => m[1]);
    if (bare.length === 0) continue;

    const nums = [...new Set(bare)];
    const win = lines.slice(Math.max(0, i - 2), i + 3).join(" ");

    // 逐个编号独立判定：能判的判，判不了的单独留
    const decided = new Map();
    for (const n of nums) {
      const def = LINEAGE[n];
      const kHit = def.K.filter((k) => win.includes(k));
      const aHit = def.A.filter((k) => win.includes(k));
      if (kHit.length && !aHit.length) decided.set(n, "K");
      else if (aHit.length && !kHit.length) decided.set(n, "A");
    }

    if (decided.size === 0) {
      skipped += bare.length;
      unresolved.push(f + ":" + (i + 1) + "  " + lines[i].trim().slice(0, 95));
      continue;
    }

    const before = lines[i];
    lines[i] = lines[i].replace(RE, (m, n) => (decided.has(n) ? "ADR-" + decided.get(n) + "-" + n : m));
    const gained = [...lines[i].matchAll(/\bADR-[KA]-000[1-7]\b/g)].length;
    resolved += gained;
    skipped += bare.length - gained;
    if (lines[i] !== before) touched = true;
    if (bare.length > gained) unresolved.push(f + ":" + (i + 1) + "  [部分] " + lines[i].trim().slice(0, 95));
  }

  if (touched) { writeFileSync(f, lines.join("\n")); changedFiles++; }
}

console.log("changed files :", changedFiles);
console.log("resolved refs :", resolved);
console.log("UNRESOLVED    :", skipped, "(left untouched on purpose)");
console.log("");
unresolved.slice(0, 30).forEach((u) => console.log("  " + u));
if (unresolved.length > 30) console.log("  ... +" + (unresolved.length - 30) + " more");
