import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = process.cwd();
const metaPath = resolve(root, '.gitnexus/meta.json');
const outputPath = resolve(root, 'apps/web/src/code-graph/codeGraphSnapshot.ts');
const gitnexusCli = join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'gitnexus', 'dist', 'cli', 'index.js');

function runCypher(query, limit = 1000) {
  const raw = execFileSync(
    process.execPath,
    [gitnexusCli, 'cypher', '-r', root, '-l', String(limit), query],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  const payload = JSON.parse(raw);
  if (payload.error) throw new Error(payload.error);
  if (payload.row_count >= limit) throw new Error(`Graph export reached row limit ${limit}; refusing a truncated snapshot`);
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
