import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = process.cwd();
const metaPath = resolve(root, '.gitnexus/meta.json');
const outputPath = resolve(root, 'apps/web/src/code-graph/codeGraphSnapshot.ts');

/**
 * 统一走仓库自带的 .gitnexus/run.cjs 包装器（整改 T05）。
 *
 * 整改前这里硬编码 %APPDATA%
pm
ode_modulesgitnexusdistcliindex.js 并**直连底层 CLI**：
 * 换机器 / 换包管理器 / 用 pnpm dlx 装的 gitnexus 一律 ENOENT，而且它和 AGENTS.md、
 * hooks、其余 graph:* 脚本各自选用的调用路径可能不是同一份安装。本文件因此改为与
 * 仓库其余部分共用同一个包装器：它按 全局 gitnexus → pnpm dlx → npx 自选可用入口。
 *
 * 包装器由 gitnexus analyze 在 analyze 运行时写入 .gitnexus/run.cjs（该目录不入库）。
 * 缺失 = 索引没建立过，此时**明确失败**并给出可执行的下一步，绝不产出半新不旧的文件。
 */
const runCjs = resolve(root, '.gitnexus/run.cjs');
if (!existsSync(runCjs)) {
  // 注意引导命令不能是 pnpm run graph:analyze —— 那条脚本正是 node .gitnexus/run.cjs analyze，
  // 它依赖的就是这里缺失的文件，属于循环引导。run.cjs 由分析器自身在 analyze 时写入
  // （见 .gitnexus/run.cjs:23-26 的自述），所以只能先用分析器 CLI 直接把它生成出来。
  throw new Error(
    'Missing .gitnexus/run.cjs (the repo GitNexus runner). ' +
      'It is written BY the analyzer, so "pnpm run graph:analyze" cannot create it ' +
      '(that script runs this very wrapper). Bootstrap it once with the analyzer CLI directly: ' +
      '"npx gitnexus@latest analyze" (or "pnpm dlx gitnexus@latest analyze"), then re-run ' +
      '"pnpm run graph:snapshot". Refusing to write a partial snapshot.',
  );
}

/**
 * run.cjs 是否经过 shell **随平台而变**（.gitnexus/run.cjs:313：
 * shell: process.platform === 'win32'）：
 *   - Windows: shell:true  → cmd.exe 把 program 与实参拼成一条命令行，按空白**二次切分**；
 *   - POSIX:   shell:false → argv 原样透传，shell **不会**剥引号。
 *
 * 由此得出两条必须同时满足的规则：
 *   1. 加引号只在 Windows 路径上成立。POSIX 上多出来的双引号会原样成为 Cypher 查询的一部分
 *      （实测收到 \"MATCH (c:Community) ... DESC\"），直接改变查询语义。
 *   2. Windows 上必须**按实参各自判断**，不能只保护查询：仓库路径含空格时 -r 的取值
 *      同样会被切成两段（实测 C:\zcode\novel ai → "C:\zcode\novel" + "ai"）。
 *
 * 两条结论均由 R01 判别实验在真实 Windows 与 WSL Ubuntu 上双向实测确认，
 * 日志见 .dsh-audit/repair-20260930/R01-argv/probe-{windows,posix}.log。
 */
const isWindows = process.platform === 'win32';

function shellArg(value) {
  if (!isWindows) return value;
  return /\s/.test(value) ? '"' + value + '"' : value;
}

function runCypher(query, limit = 1000) {
  // run.cjs 是透传 exec：它把 gitnexus 子进程的 stdio 设为 inherit，而本进程给 run.cjs
  // 的 stdout 是一根管道，所以 JSON 仍会回到这里（已在真实运行中验证）。
  const raw = execFileSync(
    process.execPath,
    [runCjs, 'cypher', '-r', shellArg(root), '-l', String(limit), shellArg(query)],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true },
  );
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    // 只回显开头一小段用于定位，不整段刷屏（stdout 里是图谱数据，不是凭据）。
    throw new Error(
      'GitNexus cypher did not return JSON: ' + error.message +
        ' | stdout head: ' + JSON.stringify(String(raw).slice(0, 200)),
    );
  }
  if (payload.error) throw new Error(payload.error);
  if (payload.row_count >= limit) {
    throw new Error('Graph export reached row limit ' + limit + '; refusing a truncated snapshot');
  }
  return parseMarkdownTable(payload.markdown ?? '');
}

function parseMarkdownTable(markdown) {
  const lines = markdown.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const cells = (line) => line
    .replace(/^\|\s*/, '')
    .replace(/\s*\|$/, '')
    .split(/(?<!\\)\|/)
    .map((value) => value.trim().replace(/\\\|/g, '|'));
  const headers = cells(lines[0]);
  return lines.slice(2).map((line) => {
    const values = cells(line);
    if (values.length !== headers.length) throw new Error('Unexpected GitNexus table row; refusing to corrupt graph data');
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nodeKind(raw) {
  if (Array.isArray(raw)) return raw.length > 0 ? String(raw[0]) : '';
  if (raw === null || raw === undefined) return '';
  return String(raw);
}

// GitNexus returns an empty id for many Function nodes and a truncated id for
// 178 more, so Function ids are never trusted: they are always derived from
// the legacy `Kind:filePath:name` shape.
function isFunctionKind(kind) {
  return kind === 'Function';
}

function baseNodeId(kind, filePath, name) {
  return `${kind}:${filePath}:${name}`;
}

// Relation endpoints are matched on node coordinates, never on native ids.
function nodeSignature(kind, filePath, name, line) {
  return [kind, filePath, name, number(line)].join('\u0000');
}

function communityIds(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => typeof item === 'string')
      .map((item) => item.replace(/^'+|'+$/g, ''));
  } catch {
    return [];
  }
}

const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
const worktreeDirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0;
const communities = runCypher(
  'MATCH (c:Community) RETURN c.id AS id, c.label AS label, c.heuristicLabel AS heuristicLabel, c.symbolCount AS symbolCount, round(c.cohesion,3) AS cohesion, c.description AS description ORDER BY c.symbolCount DESC',
  600,
).map((row) => ({
  id: row.id,
  label: row.label || row.heuristicLabel || row.id,
  heuristicLabel: row.heuristicLabel || '',
  symbolCount: number(row.symbolCount),
  cohesion: number(row.cohesion),
  description: row.description || '',
}));

const processes = runCypher(
  'MATCH (p:Process) RETURN p.id AS id, p.label AS label, p.heuristicLabel AS heuristicLabel, p.processType AS processType, p.stepCount AS stepCount, p.communities AS communities ORDER BY p.stepCount DESC',
  1000,
).map((row) => ({
  id: row.id,
  label: row.label || row.heuristicLabel || row.id,
  heuristicLabel: row.heuristicLabel || '',
  processType: row.processType || 'unknown',
  stepCount: number(row.stepCount),
  communities: communityIds(row.communities),
}));

const nodeKinds = runCypher(
  'MATCH (n) RETURN labels(n) AS labels, count(*) AS count ORDER BY count DESC',
  100,
).map((row) => ({
  label: row.labels,
  count: number(row.count),
}));

// Pass 1: read every filePath-scoped node and derive its candidate id. A
// non-Function node keeps a non-empty native id; Function nodes (empty or
// truncated native id) and id-less nodes fall back to `Kind:filePath:name`.
const nodeRows = runCypher(
  'MATCH (n) WHERE n.filePath IS NOT NULL RETURN n.id AS id, n.name AS name, n.filePath AS filePath, n.startLine AS line, labels(n) AS kind ORDER BY n.id',
  30000,
).map((row) => {
  const kind = nodeKind(row.kind);
  const nativeId = (row.id ?? '').trim();
  const filePath = row.filePath ?? '';
  const name = row.name ?? '';
  const rawLine = number(row.line);
  const derived = isFunctionKind(kind) || nativeId.length === 0;
  return {
    kind, name, filePath,
    line: rawLine + 1, rawLine, derived,
    candidate: derived ? baseNodeId(kind, filePath, name) : nativeId,
  };
});

// Pass 2: emit unique ids. A candidate id that is not unique in the exported
// node set (e.g. two `timer` functions in one file) gains a source-line suffix.
const candidateCounts = new Map();
for (const row of nodeRows) {
  candidateCounts.set(row.candidate, (candidateCounts.get(row.candidate) ?? 0) + 1);
}

const nodes = [];
const nodeIds = new Set();
const nodeIdBySignature = new Map();
for (const row of nodeRows) {
  const id = row.derived && (candidateCounts.get(row.candidate) ?? 0) > 1
    ? `${row.candidate}:${row.line}`
    : row.candidate;
  if (id.length === 0) throw new Error('GitNexus returned a node without a usable id; refusing to export an unstable graph');
  if (nodeIds.has(id)) throw new Error(`Duplicate node id ${id} in the GitNexus export; refusing to write ambiguous graph data`);
  nodeIds.add(id);
  nodeIdBySignature.set(nodeSignature(row.kind, row.filePath, row.name, row.rawLine), id);
  nodes.push({ id, name: row.name, filePath: row.filePath, line: row.line, kind: row.kind });
}

const relationRows = runCypher(
  'MATCH (a)-[r:CodeRelation]->(b) RETURN a.id AS sourceId, a.name AS sourceName, a.filePath AS sourceFilePath, a.startLine AS sourceLine, labels(a) AS sourceKind, b.id AS targetId, b.name AS targetName, b.filePath AS targetFilePath, b.startLine AS targetLine, labels(b) AS targetKind, r.type AS type ORDER BY a.id, b.id, r.type',
  50000,
);
const relations = [];
let outOfScopeRelations = 0;
for (const row of relationRows) {
  const sourceFilePath = (row.sourceFilePath ?? '').trim();
  const targetFilePath = (row.targetFilePath ?? '').trim();
  // Community/Process endpoints carry no filePath and are outside the
  // filePath-scoped node export; those edges are skipped explicitly.
  if (sourceFilePath.length === 0 || targetFilePath.length === 0) {
    outOfScopeRelations += 1;
    continue;
  }
  const source = nodeIdBySignature.get(
    nodeSignature(nodeKind(row.sourceKind), sourceFilePath, row.sourceName ?? '', row.sourceLine),
  );
  const target = nodeIdBySignature.get(
    nodeSignature(nodeKind(row.targetKind), targetFilePath, row.targetName ?? '', row.targetLine),
  );
  if (source === undefined || target === undefined) {
    throw new Error(`Relation endpoint could not be resolved to an exported node: ${sourceFilePath} -> ${targetFilePath} (${row.type})`);
  }
  relations.push({ source, target, type: row.type });
}

for (const relation of relations) {
  if (!relation.source || !relation.target) throw new Error('Relation endpoint is empty; refusing to write a dangling edge');
  if (!nodeIds.has(relation.source)) throw new Error(`Relation source ${relation.source} is not an exported node`);
  if (!nodeIds.has(relation.target)) throw new Error(`Relation target ${relation.target} is not an exported node`);
}

const graph = { nodes, relations };
writeFileSync(resolve(root, 'apps/web/src/code-graph/codeGraphData.json'), JSON.stringify(graph), 'utf8');

const snapshot = {
  source: 'GitNexus local index',
  generatedAt: new Date().toISOString(),
  indexedAt: meta.indexedAt,
  commit: String(meta.lastCommit ?? '').slice(0, 7),
  worktreeDirty,
  branch: meta.branch ?? '',
  repo: 'mozhou',
  remoteUrl: meta.remoteUrl ?? '',
  schemaVersion: meta.schemaVersion ?? null,
  stats: meta.stats,
  capabilities: meta.capabilities,
  nodeKinds,
  communities,
  processes,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(
  outputPath,
  [
    '/**',
    ' * Generated from the local GitNexus index by scripts/export-code-graph.mjs.',
    ' * Do not hand-edit graph facts. Re-run pnpm graph:snapshot after refreshing GitNexus.',
    ' */',
    `export const CODE_GRAPH_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)}\n`,
    '',
  ].join('\n'),
  'utf8',
);
console.log(`Wrote ${outputPath}`);
console.log(`${communities.length} communities, ${processes.length} processes, ${nodeKinds.length} node kinds`);
console.log(`${nodes.length} nodes, ${relations.length} relations, ${outOfScopeRelations} out-of-scope relations skipped`);
