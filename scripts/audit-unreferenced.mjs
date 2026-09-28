#!/usr/bin/env node
// 零引用体检：图谱给候选，grep 给裁决。
//
// 为什么不用图谱直接下结论：codeGraphData.json 对「导出/引用」不可靠。
// 本工具开发期间实测三类误报，全部会导致死代码数被高估：
//   1) JSX 组件被引用不产生 CALLS 边（63 个组件被误报）；
//   2) 局部闭包只被父函数使用（52 个被误报）；
//   3) 按路径前缀过滤会漏掉 apps/web/server/api.ts 这类不在 src/ 下的装配点
//      （16 个路由工厂曾被误报）。
// 所以规则是：图谱只负责「列出候选」，是否真的零引用一律回源文件逐字节判断。

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const GRAPH = join(ROOT, 'apps/web/src/code-graph/codeGraphData.json');
const SEARCH_ROOTS = ['apps', 'packages'];
const EXTS = new Set(['.ts', '.tsx']);
const SKIP_DIR = new Set(['node_modules', 'dist', '.git', 'release-artifacts', 'code-graph']);

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIR.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTS.has(entry.slice(entry.lastIndexOf('.')))) out.push(full);
  }
  return out;
}

const files = SEARCH_ROOTS.filter((d) => existsSync(d)).flatMap((d) => walk(d, []));
const rel = (f) => relative(ROOT, f).split(sep).join('/');
const corpus = new Map(files.map((f) => [rel(f), readFileSync(f, 'utf8')]));
const isTest = (p) => /\.test\.tsx?$/.test(p);

// 词边界匹配。名字可能含 $（如 $n），故不强行 \b 包裹两端，一律用前后断言。
function occurrences(text, name) {
  const re = new RegExp(`(?<![\\w$])${name}(?![\\w$])`, 'g');
  return (text.match(re) ?? []).length;
}

// 纯文本分析：给定「文件 -> 出现次数」，判定某符号在其定义文件外是否还被用到。
export function classify(name, definingFile, counts) {
  const self = counts.get(definingFile) ?? 0;
  // 语料里找不到定义文件：图谱说有、磁盘上没有（文件被删/被移走）。
  // 不能静默归入 local-closure——那会被读成「没事，保留」。
  if (self === 0) return 'file-missing';
  if (self !== 1) return 'local-closure'; // 定义 + 同文件使用，图谱看不见局部闭包
  let inTests = 0;
  let inProd = 0;
  for (const [file, n] of counts) {
    if (file === definingFile) continue;
    if (n === 0) continue;
    if (isTest(file)) inTests += n;
    else inProd += n;
  }
  if (inProd > 0) return 'used-in-prod';
  if (inTests > 0) return 'test-only';
  return 'unreferenced';
}

function buildCounts(names) {
  const counts = new Map();
  for (const name of names) counts.set(name, new Map());
  for (const [file, text] of corpus) {
    for (const [name, perFile] of counts) {
      const n = occurrences(text, name);
      if (n > 0) perFile.set(file, n);
    }
  }
  return counts;
}

function candidates() {
  if (!existsSync(GRAPH)) return {
    nodes: [],
    note: '图谱缺失：直接跳过候选阶段，仅此脚本不可用。',
  };
  const graph = JSON.parse(readFileSync(GRAPH, 'utf8'));
  const BEHAVIOUR = new Set(['CALLS', 'ACCESSES', 'USES', 'IMPLEMENTS', 'METHOD_IMPLEMENTS']);
  // 只看「有没有东西指向它」。把自己当源的边（它去调用别人）不代表它被用过——
  // 一个只调不被人调的叶子函数正是我们要找的对象，不能因为它是源就放过。
  const referenced = new Set();
  for (const r of graph.relations ?? []) {
    if (!BEHAVIOUR.has(r.type)) continue;
    referenced.add(r.target);
  }
  // 只在「图谱完全没见过」且是生产函数时列为候选。测试文件与生成目录一律排除。
  return {
    nodes: (graph.nodes ?? []).filter(
      (n) =>
        n.kind === 'Function' &&
        n.name &&
        !referenced.has(n.id) &&
        !isTest(n.filePath) &&
        !n.filePath.startsWith('docs/') &&
        !n.filePath.startsWith('scripts/') &&
        !n.filePath.startsWith('release-artifacts/') &&
        !n.filePath.startsWith('evidence/') &&
        corpus.has(n.filePath),
    ),
    note: null,
  };
}

const { nodes, note } = candidates();
// 被 import 时（测试只取 classify）不得跑 CLI、不得 exit。
const isMain = Boolean(process.argv[1] && process.argv[1].endsWith('audit-unreferenced.mjs'));

if (isMain && note) {
  console.error(note);
  process.exit(2);
}

const names = [...new Set(nodes.map((n) => n.name))];
const counts = buildCounts(names);
const rows = nodes.map((n) => ({
  file: n.filePath,
  line: n.line,
  name: n.name,
  verdict: classify(n.name, n.filePath, counts.get(n.name)),
}));

const order = { unreferenced: 0, 'test-only': 1, 'file-missing': 2, 'used-in-prod': 3, 'local-closure': 4 };
rows.sort((a, b) => order[a.verdict] - order[b.verdict] || a.file.localeCompare(b.file) || a.line - b.line);

const groups = new Map();
for (const r of rows) {
  if (!groups.has(r.verdict)) groups.set(r.verdict, []);
  groups.get(r.verdict).push(r);
}

const LABEL = {
  unreferenced: '真零引用（生产 0 + 测试 0）—— 需处置',
  'test-only': '仅测试引用 —— 保留',
  'used-in-prod': '生产有引用 —— 图谱误报，保留',
  'local-closure': '局部闭包 —— 图谱误报，保留',
  'file-missing': '定义文件已不在语料 —— 需人工确认',
  'file-missing': '定义文件已不在语料 —— 需人工确认',
};

if (isMain) console.log(`源文件 ${files.length} 个 · 图谱候选 ${nodes.length} 个 · 唯一符号名 ${names.length} 个`);
if (isMain) console.log('');
if (isMain) for (const key of Object.keys(order)) {
  const g = groups.get(key) ?? [];
  console.log(`${LABEL[key]}: ${g.length}`);
}
if (isMain) console.log('');
if (isMain) for (const r of groups.get('unreferenced') ?? []) console.log(`  ${r.file}:${r.line}  ${r.name}`);
if (isMain) console.log('');
if (isMain) console.log('说明：used-in-prod / local-closure 两桶是图谱的结构性误报（JSX 不产生 CALLS 边、局部闭包不建节点），不是死代码。');