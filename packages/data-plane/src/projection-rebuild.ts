/**
 * Full-Absorption Rebuild（Q14 恢复三权分立之一）：
 * 纯确定性扫描 MD/JSONL → 从零重造投影 → 重立 hash 基线。
 * 零 LLM、零触碰 canon 文件；结构违例宁败不脏（readCanonState 抛错）。
 *
 * 自 local-data-plane.ts 下沉至独立模块（依赖解环）：compaction.ts 的事务收尾
 * 与 LocalDataPlane 门面都要调用本重建入口，而下沉后两层即可共同依赖本模块，
 * 不再互相引用。
 */
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { readCanonState } from './canon-read.js'
import { openDatabase } from './database.js'
import { RUNTIME_DB_PATH } from './layout.js'
import { buildManifest, writeManifest } from './manifest.js'
import { initProjection, populateProjection } from './projection.js'

function removeProjectionFiles(root: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${join(root, RUNTIME_DB_PATH)}${suffix}`, { force: true })
  }
}

export function rebuildProjectionFromCanon(root: string, activeDb?: Database.Database): void {
  const state = readCanonState(root)

  if (activeDb !== undefined) {
    activeDb.transaction(() => {
      activeDb.prepare('DELETE FROM entity_excluded_phrases').run()
      activeDb.prepare('DELETE FROM entity_alias_rules').run()
      activeDb.prepare('DELETE FROM entity_cards').run()
      activeDb.prepare('DELETE FROM tracking_lines').run()
      activeDb.prepare('DELETE FROM planning_artifacts').run()
      activeDb.prepare('DELETE FROM outline_nodes').run()
      activeDb.prepare('DELETE FROM books').run()
      activeDb.prepare('DELETE FROM meta').run()
    })()
    populateProjection(activeDb, state)
  } else {
    try {
      removeProjectionFiles(root)
      const db = openDatabase({ path: join(root, RUNTIME_DB_PATH) })
      try {
        initProjection(db)
        populateProjection(db, state)
      } finally {
        db.close()
      }
    } catch (error) {
      if ((error as { code?: string }).code === 'EPERM' || (error as { code?: string }).code === 'EBUSY') {
        const db = openDatabase({ path: join(root, RUNTIME_DB_PATH) })
        try {
          db.transaction(() => {
            db.prepare('DELETE FROM entity_excluded_phrases').run()
            db.prepare('DELETE FROM entity_alias_rules').run()
            db.prepare('DELETE FROM entity_cards').run()
            db.prepare('DELETE FROM tracking_lines').run()
            db.prepare('DELETE FROM planning_artifacts').run()
            db.prepare('DELETE FROM outline_nodes').run()
            db.prepare('DELETE FROM books').run()
            db.prepare('DELETE FROM meta').run()
          })()
          populateProjection(db, state)
        } finally {
          db.close()
        }
      } else {
        throw error
      }
    }
  }

  // 重立基线（S4：基线只记应用自己的写入；canon 未变则与旧基线逐字节相同）
  writeManifest(root, buildManifest(root, state.book.id))
}
