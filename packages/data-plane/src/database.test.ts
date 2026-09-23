import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertProjectionVersion,
  openDatabase,
  ProjectionVersionMismatchError,
  PROJECTION_SCHEMA_VERSION,
  readProjectionVersion,
} from './database.js'

describe('openDatabase', () => {
  it('opens an in-memory database', () => {
    const db = openDatabase({ path: ':memory:' })
    expect(db.open).toBe(true)
    db.close()
  })

  it('starts at user_version=0 and fails the guard fast', () => {
    const db = openDatabase({ path: ':memory:' })
    expect(readProjectionVersion(db)).toBe(0)
    expect(() => assertProjectionVersion(db)).toThrow(ProjectionVersionMismatchError)
    db.pragma(`user_version = ${PROJECTION_SCHEMA_VERSION}`)
    expect(() => assertProjectionVersion(db)).not.toThrow()
    db.close()
  })

  it('releases the native handle when initialization rejects a corrupt database', () => {
    const root = mkdtempSync(join(tmpdir(), 'mozhou-db-corrupt-'))
    const dbPath = join(root, 'runtime.sqlite')
    try {
      writeFileSync(dbPath, 'not-a-sqlite-database', 'utf8')
      expect(() => openDatabase({ path: dbPath })).toThrow(/not a database/i)
      let removable = true
      try {
        rmSync(dbPath, { force: true })
      } catch {
        removable = false
      }
      expect(removable).toBe(true)
    } finally {
      try {
        rmSync(root, { recursive: true, force: true })
      } catch {
        // RED 路径下 native handle 仍锁定文件；Vitest 进程退出后由系统释放。
      }
    }
  })
})
