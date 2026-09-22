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

const nodes = runCypher(
  'MATCH (n) WHERE n.filePath IS NOT NULL RETURN n.id AS id, n.name AS name, n.filePath AS filePath, n.startLine AS line, labels(n) AS kind ORDER BY n.id',
  30000,
).map((row) => ({
  id: row.id, name: row.name, filePath: row.filePath,
  line: number(row.line) + 1, kind: row.kind,
}));
const relations = runCypher(
  'MATCH (a)-[r:CodeRelation]->(b) RETURN a.id AS source, b.id AS target, r.type AS type ORDER BY a.id, b.id, r.type',
  50000,
);
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
