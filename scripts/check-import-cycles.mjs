#!/usr/bin/env node
// check-import-cycles.mjs — 不依赖 .gitnexus 索引的静态导入环检测。
//
// 为什么用自带的 typescript 而不是 madge / dependency-cruiser：
//   - madge 在仓库根运行时解析不了工作区包 @mozhou/*（实测 2030 条边里跨包 0 条，
//     符号链接只存在于各包自己的 node_modules），因此漏掉跨包依赖环；
//     给 madge 传 tsconfig paths 也不生效（实测仍为 0 条跨包边）。
//   - dependency-cruiser 本机无法联网取得，行为无法验证。
//   - typescript 已是本仓 devDependency，用它的 preProcessFile 解析导入，
//     既能处理 NodeNext 的 './x.js' → './x.ts'，也能把 @mozhou/<name> 映射回源码，
//     CI 无需联网下载额外工具，也不读 .gitnexus 索引。
//
// 用法：node scripts/check-import-cycles.mjs [dir...]
//   默认扫描 packages、apps/web/src、apps/web/server。
//   退出码：0 无环；1 发现依赖环；2 用法错误。
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, extname, relative, sep } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const DEFAULT_DIRS = ["packages", "apps/web/src", "apps/web/server"];
const SCAN_DIRS = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_DIRS;
const SOURCE_EXTS = [".ts", ".tsx", ".mts", ".cts"];
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "dist-server",
  "coverage",
  ".gitnexus",
  ".turbo",
  ".vite",
]);

const toPosix = (p) => p.split(sep).join("/");

function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (SOURCE_EXTS.includes(extname(name))) out.push(full);
  }
}

// 工作区包名 -> 源码入口（@mozhou/kernel -> packages/kernel/src/index.ts）
function buildPackageMap() {
  const map = new Map();
  for (const base of ["packages", "apps"]) {
    const baseDir = join(ROOT, base);
    if (!existsSync(baseDir)) continue;
    for (const name of readdirSync(baseDir)) {
      const pkgDir = join(baseDir, name);
      const pkgJson = join(pkgDir, "package.json");
      if (!existsSync(pkgJson)) continue;
      const pkg = JSON.parse(readFileSync(pkgJson, "utf8"));
      if (!pkg.name) continue;
      const entry = ["src/index.ts", "src/index.tsx", "index.ts"]
        .map((f) => join(pkgDir, f))
        .find(existsSync);
      if (entry) map.set(pkg.name, entry);
    }
  }
  return map;
}

function resolveRelative(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  const ext = extname(base);
  const candidates = [];
  if ([".js", ".mjs", ".cjs", ".jsx"].includes(ext)) {
    const stem = base.slice(0, -ext.length);
    for (const e of SOURCE_EXTS) candidates.push(stem + e);
  } else if (ext && SOURCE_EXTS.includes(ext)) {
    candidates.push(base);
  } else {
    for (const e of SOURCE_EXTS) candidates.push(base + e);
    for (const e of SOURCE_EXTS) candidates.push(join(base, "index" + e));
  }
  return candidates.find(existsSync) ?? null;
}

function resolveSpecifier(fromFile, spec, pkgMap) {
  if (spec.startsWith(".")) return resolveRelative(fromFile, spec);
  if (pkgMap.has(spec)) return pkgMap.get(spec);
  return null; // 第三方 / 内建模块，不参与环检测
}

function parseImports(file) {
  const text = readFileSync(file, "utf8");
  // detectJavaScriptImports=true 同时捕获 require() 与动态 import()
  const info = ts.preProcessFile(text, true, true);
  return info.importedFiles.map((f) => f.fileName);
}

function main() {
  const files = [];
  for (const d of SCAN_DIRS) walk(resolve(ROOT, d), files);
  if (files.length === 0) {
    console.error("FAIL 未找到任何源文件，扫描目录可能写错：" + SCAN_DIRS.join(", "));
    process.exit(2);
  }

  const nodeSet = new Set(files.map(toPosix));
  const pkgMap = buildPackageMap();
  const graph = new Map();
  for (const file of files) {
    const deps = new Set();
    for (const spec of parseImports(file)) {
      const target = resolveSpecifier(file, spec, pkgMap);
      if (target && nodeSet.has(toPosix(target))) deps.add(target);
    }
    graph.set(file, [...deps]);
  }

  // DFS 找环（灰=当前递归栈）
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map();
  const stack = [];
  const cycles = [];
  const seen = new Set();
  const visit = (n) => {
    color.set(n, GRAY);
    stack.push(n);
    for (const m of graph.get(n) ?? []) {
      const c = color.get(m) ?? WHITE;
      if (c === GRAY) {
        const chain = stack.slice(stack.indexOf(m));
        const key = [...chain].sort().join("|");
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(chain);
        }
      } else if (c === WHITE) {
        visit(m);
      }
    }
    stack.pop();
    color.set(n, BLACK);
  };
  for (const n of graph.keys()) if ((color.get(n) ?? WHITE) === WHITE) visit(n);

  const edgeCount = [...graph.values()].reduce((a, d) => a + d.length, 0);
  if (cycles.length === 0) {
    console.log(
      `PASS 静态导入环检测：${graph.size} 个模块 / ${edgeCount} 条内部边，0 个依赖环。`,
    );
    process.exit(0);
  }

  console.log(`FAIL 发现 ${cycles.length} 个依赖环：`);
  for (const c of cycles) {
    console.log("  " + c.map((p) => toPosix(relative(ROOT, p))).join(" -> "));
  }
  process.exit(1);
}

main();
