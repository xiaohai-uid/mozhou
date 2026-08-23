/**
 * LocalDataPlane——双平面数据面的测试接缝（Testing Decisions 三接缝之一）：
 * 打开书（投影版本守卫）/ 基线核对 / 全量吸收重建。
 * 同步触发与 write-through 的完整语义归 T5 对账票，本文件只立骨架。
 */
import { existsSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { BookRecord } from '@mozhou/kernel'
import Database from 'better-sqlite3'
import { readCanonState, readBookRecord } from './canon-read.js'
import { assertProjectionVersion, openDatabase } from './database.js'
import {
  isCanonRelPath,
  RUNTIME_DB_PATH,
} from './layout.js'
import { buildManifest, listAllFiles, readManifest, writeManifest, type HashManifest } from './manifest.js'
import { initProjection, populateProjection } from './projection.js'
import { sha256FileHex } from './sha256.js'

export class ProjectionMissingError extends Error {
  override readonly name = 'ProjectionMissingError'

  constructor(readonly dbPath: string) {
    super(`projection database missing: ${dbPath} — run rebuildProjectionFromCanon()`)
  }
}

/** 基线核对报告：modified/missing = 基线有而盘上变了/没了；untracked = 盘上多出的 canon 文件。 */
export interface BaselineReport {
  readonly modified: string[]
  readonly missing: string[]
  readonly untracked: string[]
}

function removeProjectionFiles(root: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${join(root, RUNTIME_DB_PATH)}${suffix}`, { force: true })
  }
}

export class LocalDataPlane {
  private constructor(
    readonly root: string,
    private readonly _db: Database.Database,
    private readonly _book: BookRecord,
    private readonly _manifest: HashManifest,
  ) {}

  /**
   * 打开一本书：manifest 基线必须就位，投影打开即过 assertProjectionVersion
   * （不符即抛 ProjectionVersionMismatchError，由上层触发全量重建）；
   * 投影文件缺失抛 ProjectionMissingError。
   */
  static open(root: string): LocalDataPlane {
    const manifest = readManifest(root)
    const dbPath = join(root, RUNTIME_DB_PATH)
    if (!existsSync(dbPath)) {
      throw new ProjectionMissingError(dbPath)
    }
    const db = openDatabase({ path: dbPath })
    try {
      assertProjectionVersion(db)
      return new LocalDataPlane(root, db, readBookRecord(root), manifest)
    } catch (error) {
      db.close()
      throw error
    }
  }

  get book(): BookRecord {
    return this._book
  }

  get db(): Database.Database {
    return this._db
  }

  get manifest(): HashManifest {
    return this._manifest
  }

  /** 启动必检的确定性内核（watcher/对账接线归 T5）：盘上现状 vs 基线。 */
  verifyBaseline(): BaselineReport {
    const modified: string[] = []
    const missing: string[] = []
    for (const [rel, entry] of Object.entries(this._manifest.files)) {
      const absolutePath = join(this.root, rel)
      let stat: ReturnType<typeof statSync>
      try {
        stat = statSync(absolutePath)
      } catch {
        missing.push(rel)
        continue
      }
      if (stat.size !== entry.bytes || sha256FileHex(absolutePath) !== entry.sha256) {
        modified.push(rel)
      }
    }

    const untracked = listAllFiles(this.root).filter((rel) => isCanonRelPath(rel) && !(rel in this._manifest.files))

    return {
      modified: modified.sort(),
      missing: missing.sort(),
      untracked,
    }
  }

  close(): void {
    this._db.close()
  }
}

/**
 * Full-Absorption Rebuild（Q14 恢复三权分立之一）：
 * 纯确定性扫描 MD/JSONL → 从零重造投影 → 重立 hash 基线。
 * 零 LLM、零触碰 canon 文件；结构违例宁败不脏（readCanonState 抛错）。
 */
export function rebuildProjectionFromCanon(root: string): void {
  const state = readCanonState(root)

  removeProjectionFiles(root)
  const db = openDatabase({ path: join(root, RUNTIME_DB_PATH) })
  try {
    initProjection(db)
    populateProjection(db, state)
  } finally {
    db.close()
  }

  // 重立基线（S4：基线只记应用自己的写入；canon 未变则与旧基线逐字节相同）
  writeManifest(root, buildManifest(root, state.book.id))
}
