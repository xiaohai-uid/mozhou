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
 * T2 表面（工单 #16；entity-directory-spec D8——目录卡入投影）：
 *   - entity_cards / entity_alias_rules / entity_excluded_phrases：
 *     设定/<五目>/ 目录卡的结构化行。tags 刻意不入投影（D4 永不入包）。
 *
 * 投影内禁存墙钟时间——重建幂等断言要求同 canon ⇒ 同指纹。
 */
import type Database from 'better-sqlite3'
import { PROJECTION_SCHEMA_VERSION } from './database.js'
import type { CanonState, EntityCardScan } from './canon-read.js'

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
CREATE TABLE entity_cards (
  ref TEXT PRIMARY KEY,
  card_type TEXT NOT NULL CHECK (card_type IN ('char', 'item', 'location', 'faction', 'concept')),
  name TEXT NOT NULL,
  ai_context TEXT NOT NULL CHECK (ai_context IN ('always', 'detected', 'detectedOff', 'never')),
  brief TEXT,
  file_rel TEXT NOT NULL
);
CREATE TABLE entity_alias_rules (
  ref TEXT NOT NULL REFERENCES entity_cards(ref),
  ord INTEGER NOT NULL,
  text TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('exact', 'regex')),
  case_sensitive INTEGER NOT NULL,
  PRIMARY KEY (ref, ord)
);
CREATE TABLE entity_excluded_phrases (
  ref TEXT NOT NULL REFERENCES entity_cards(ref),
  ord INTEGER NOT NULL,
  phrase TEXT NOT NULL,
  PRIMARY KEY (ref, ord)
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

    const insertCard = db.prepare(
      'INSERT INTO entity_cards (ref, card_type, name, ai_context, brief, file_rel) VALUES (?, ?, ?, ?, ?, ?)',
    )
    const insertAlias = db.prepare(
      'INSERT INTO entity_alias_rules (ref, ord, text, kind, case_sensitive) VALUES (?, ?, ?, ?, ?)',
    )
    const insertExcluded = db.prepare(
      'INSERT INTO entity_excluded_phrases (ref, ord, phrase) VALUES (?, ?, ?)',
    )
    for (const card of state.entityCards) {
      insertCard.run(card.ref, card.cardType, card.name, card.aiContext, card.brief, card.fileRel)
      card.aliases.forEach((alias, ord) => {
        insertAlias.run(card.ref, ord, alias.text, alias.kind, alias.caseSensitive ?? false ? 1 : 0)
      })
      card.excludedPhrases.forEach((phrase, ord) => {
        insertExcluded.run(card.ref, ord, phrase)
      })
    }
  })
  seed()
}

/** write-through 单卡行同步：行形与 populateProjection 严格一致（S1 投影=文件投影）。 */
export function syncEntityCardRows(db: Database.Database, card: EntityCardScan): void {
  db.transaction(() => {
    deleteEntityCardRows(db, card.ref)
    db.prepare(
      'INSERT INTO entity_cards (ref, card_type, name, ai_context, brief, file_rel) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(card.ref, card.cardType, card.name, card.aiContext, card.brief, card.fileRel)
    const insertAlias = db.prepare(
      'INSERT INTO entity_alias_rules (ref, ord, text, kind, case_sensitive) VALUES (?, ?, ?, ?, ?)',
    )
    card.aliases.forEach((alias, ord) => {
      insertAlias.run(card.ref, ord, alias.text, alias.kind, alias.caseSensitive ?? false ? 1 : 0)
    })
    const insertExcluded = db.prepare(
      'INSERT INTO entity_excluded_phrases (ref, ord, phrase) VALUES (?, ?, ?)',
    )
    card.excludedPhrases.forEach((phrase, ord) => {
      insertExcluded.run(card.ref, ord, phrase)
    })
  })()
}

/** write-through 删卡：先子表后主表（外键无级联）。 */
export function deleteEntityCardRows(db: Database.Database, ref: string): void {
  db.transaction(() => {
    db.prepare('DELETE FROM entity_alias_rules WHERE ref = ?').run(ref)
    db.prepare('DELETE FROM entity_excluded_phrases WHERE ref = ?').run(ref)
    db.prepare('DELETE FROM entity_cards WHERE ref = ?').run(ref)
  })()
}
