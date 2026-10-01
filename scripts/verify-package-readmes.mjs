#!/usr/bin/env node
// verify-package-readmes.mjs — 校验每个 workspace 包都有 README，且 DSH 要求的四段齐备。
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REQUIRED = ["## Owns", "## Depends on", "## Extension points", "## Known limitations"];

function pkgDirs() {
  const out = [];
  for (const root of ["packages", "apps"]) {
    for (const e of readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const d = join(root, e.name);
      if (existsSync(join(d, "package.json"))) out.push(d);
    }
  }
  return out;
}

const problems = [];
let okCount = 0;
const dirs = pkgDirs();
for (const d of dirs) {
  const name = JSON.parse(readFileSync(join(d, "package.json"), "utf8")).name;
  const rd = join(d, "README.md");
  if (!existsSync(rd)) {
    problems.push(name + " 没有 README.md（DSH 4.1：包 README 是硬契约，不是可选文档）。");
    continue;
  }
  const md = readFileSync(rd, "utf8");
  const missing = REQUIRED.filter((h) => !md.includes(h));
  if (missing.length) {
    problems.push(name + " 的 README 缺少段落：" + missing.join("、"));
    continue;
  }
  if (md.length < 400) {
    problems.push(name + " 的 README 过短（" + md.length + " 字符），很可能只是占位。");
    continue;
  }
  okCount++;
}

if (problems.length === 0) {
  console.log("PASS: " + okCount + "/" + dirs.length + " 个包 README 四段齐备");
  process.exit(0);
}
problems.forEach((p) => console.log("  FAIL " + p));
console.log("");
console.log("FAIL: " + problems.length + " 项");
process.exit(1);
