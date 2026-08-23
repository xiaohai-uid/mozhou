import Database from 'better-sqlite3'

/**
 * 投影 schema 版本（T3 裁决：PRAGMA user_version 守卫，不符即 fail-fast，
 * 由上层调用 rebuildProjectionFromCanon() 全量重建——禁增量迁移框架）。
 * v2（工单 #16/T2）：entity_cards / entity_alias_rules / entity_excluded_phrases。
 */
export const PROJECTION_SCHEMA_VERSION = 2

export interface OpenDatabaseOptions {
  readonly path: string
}

export function openDatabase(options: OpenDatabaseOptions): Database.Database {
  const db = new Database(options.path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

export class ProjectionVersionMismatchError extends Error {
  override readonly name = 'ProjectionVersionMismatchError'

  constructor(
    readonly actual: number,
    readonly expected: number,
  ) {
    super(`projection user_version=${actual}, expected ${expected} — rebuild projection from canon`)
  }
}

export function readProjectionVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number
}

/** 版本守卫：不符即抛错，调用方负责触发全量重建。 */
export function assertProjectionVersion(db: Database.Database): void {
  const actual = readProjectionVersion(db)
  if (actual !== PROJECTION_SCHEMA_VERSION) {
    throw new ProjectionVersionMismatchError(actual, PROJECTION_SCHEMA_VERSION)
  }
}

/**
 * 薄仓储层接缝（T3 裁决）：行映射保持显式手写，禁 ORM。
 * 批量写入必须包裹事务——无事务逐条仅 ~6 万行/秒，事务下 ~30-40 万行/秒。
 */
export interface RowMapper<TRow, TModel> {
  (row: TRow): TModel
}
