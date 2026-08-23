/**
 * SQLite 投影 v1（T3 裁决：better-sqlite3 直连薄仓储，禁 ORM、禁增量迁移；
 * `PRAGMA user_version` 守卫由 database.ts 承担）。
 *
 * T1 表面只承载建书骨架的可查询状态：
 *   - books / outline_nodes：book.json 与大纲节点 md 的结构化行
 *   - planning_artifacts：AuthorIntent / StyleProfile 的版本锚（内容摘要）
 *   - tracking_lines：追踪五族 jsonl 的原始行镜像（append-only）
 *   - meta：投影级簿记
 *
 * 投影内禁存墙钟时间——重建幂等断言要求同 canon ⇒ 同指纹。
 */
import type Database from 'better-sqlite3'
import { PROJECTION_SCHEMA_VERSION } from './database.js'
import type { CanonState } from './canon-read.js'

export const PROJECTION_DDL = `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE outline_nodes (
  id TEXT PRIMARY KEY,
  node_type TEXT NOT NULL CHECK (node_type IN ('book', 'volume', 'arc', 'chapter')),
  parent_id TEXT,
  order_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL
);
CREATE TABLE planning_artifacts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('authorIntent', 'styleProfile')),
  revision INTEGER NOT NULL,
  content_sha256 TEXT NOT NULL
);
CREATE TABLE tracking_lines (
  kind TEXT NOT NULL CHECK (kind IN ('temporalFact', 'knowledgeState', 'relationshipState', 'narrativePromise', 'timelineEvent')),
  seq INTEGER NOT NULL,
  line_sha256 TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (kind, seq)
);
`

/** 建表 + 写入 schema 版本。只在空库上调用（初始化与重建都从零开始）。 */
export function initProjection(db: Database.Database): void {
  db.exec(PROJECTION_DDL)
  db.pragma(`user_version = ${PROJECTION_SCHEMA_VERSION}`)
}

/** 单事务灌入扫描出的 canon 状态（无事务逐条仅 ~6 万行/秒）。 */
export function populateProjection(db: Database.Database, state: CanonState): void {
  const seed = db.transaction(() => {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('bookId', state.book.id)
    db.prepare('INSERT INTO books (id, title, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      state.book.id,
      state.book.title,
      state.book.revision,
      state.book.createdAt,
      state.book.updatedAt,
    )

    const insertNode = db.prepare(
      'INSERT INTO outline_nodes (id, node_type, parent_id, order_index, title, status, revision) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    for (const node of state.outlineNodes) {
      insertNode.run(node.id, node.nodeType, node.parentId, node.orderIndex, node.title, node.status, node.revision)
    }

    const insertArtifact = db.prepare(
      'INSERT INTO planning_artifacts (id, kind, revision, content_sha256) VALUES (?, ?, ?, ?)',
    )
    for (const artifact of state.planningArtifacts) {
      insertArtifact.run(artifact.id, artifact.kind, artifact.revision, artifact.contentSha256)
    }

    const insertLine = db.prepare(
      'INSERT INTO tracking_lines (kind, seq, line_sha256, payload) VALUES (?, ?, ?, ?)',
    )
    for (const [kind, lines] of Object.entries(state.trackingLines)) {
      for (const line of lines) {
        insertLine.run(kind, line.seq, line.lineSha256, line.payload)
      }
    }
  })
  seed()
}
