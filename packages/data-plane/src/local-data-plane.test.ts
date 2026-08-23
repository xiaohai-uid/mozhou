import { createHash } from 'node:crypto'
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { assertProjectionVersion, openDatabase } from './database.js'
import { createBook } from './create-book.js'
import { LocalDataPlane, ProjectionMissingError, rebuildProjectionFromCanon } from './local-data-plane.js'
import { MANIFEST_PATH, RUNTIME_DB_PATH } from './layout.js'

const tmpRoots: string[] = []
let bookRoot = ''

beforeEach(() => {
  bookRoot = join(tmpdir(), `mozhou-t1-${process.pid}-${Math.random().toString(36).slice(2)}`)
  tmpRoots.push(bookRoot)
  mkdirSync(bookRoot, { recursive: true })
})

afterAll(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function makeBook(): void {
  createBook({ dir: bookRoot, title: '凡人修仙传' })
}

/** 投影内容指纹：全部用户表按 rowid 序 dump 后哈希——重建前后必须逐字节一致。 */
function fingerprint(db: Database.Database): string {
  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {
      name: string
    }[]
  ).map((row) => row.name)
  const dump = tables.map((table) => JSON.stringify(db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()))
  return createHash('sha256').update(dump.join('\n')).digest('hex')
}

/** canon 快照：.mozhou/ 之外所有文件的 rel path → sha256。 */
function canonSnapshot(): Map<string, string> {
  const snapshot = new Map<string, string>()
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(bookRoot, rel))) {
      const childRel = rel ? `${rel}/${name}` : name
      if (childRel === '.mozhou') {
        continue
      }
      if (statSync(join(bookRoot, childRel)).isDirectory()) {
        walk(childRel)
      } else {
        snapshot.set(childRel, createHash('sha256').update(readFileSync(join(bookRoot, childRel))).digest('hex'))
      }
    }
  }
  walk('')
  return snapshot
}

function removeProjectionFiles(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${join(bookRoot, RUNTIME_DB_PATH)}${suffix}`, { force: true })
  }
}

describe('LocalDataPlane.open', () => {
  it('opens a freshly created book straight through assertProjectionVersion', () => {
    makeBook()
    const plane = LocalDataPlane.open(bookRoot)
    expect(() => assertProjectionVersion(plane.db)).not.toThrow()
    expect(plane.book.title).toBe('凡人修仙传')
    plane.close()
  })

  it('seeds the projection with the book record and the two outline nodes', () => {
    makeBook()
    const plane = LocalDataPlane.open(bookRoot)
    const books = plane.db.prepare('SELECT id, title, revision FROM books').all() as {
      id: string
      title: string
      revision: number
    }[]
    expect(books).toEqual([{ id: plane.book.id, title: '凡人修仙传', revision: 0 }])

    const nodes = plane.db.prepare('SELECT node_type, order_index FROM outline_nodes ORDER BY node_type').all() as {
      node_type: string
      order_index: number
    }[]
    expect(nodes).toEqual([
      { node_type: 'book', order_index: 0 },
      { node_type: 'volume', order_index: 0 },
    ])
    plane.close()
  })

  it('throws ProjectionMissingError when runtime.sqlite is gone (caller rebuilds)', () => {
    makeBook()
    removeProjectionFiles()
    expect(() => LocalDataPlane.open(bookRoot)).toThrow(ProjectionMissingError)
  })
})

describe('verifyBaseline', () => {
  it('reports clean on a fresh book', () => {
    makeBook()
    const plane = LocalDataPlane.open(bookRoot)
    const report = plane.verifyBaseline()
    // T3 起报告含 S2 分面：reconcileSurface（对账检测面）与 draftFreeEdits（草稿豁免）
    expect(report).toEqual({
      modified: [],
      missing: [],
      untracked: [],
      reconcileSurface: [],
      draftFreeEdits: [],
    })
    plane.close()
  })

  it('detects external modification, deletion and stray new files', () => {
    makeBook()
    appendFileSync(join(bookRoot, '文风.md'), '<!-- 外部改动 -->\n')
    rmSync(join(bookRoot, '追踪/事实.jsonl'))
    writeFileSync(join(bookRoot, '设定/人物/林枫.md'), '---\nref: char:lin-feng\n---\n')
    writeFileSync(join(bookRoot, '.mozhou/receipts/rcpt_x.json'), '{}') // 运行时区不参与对账

    const plane = LocalDataPlane.open(bookRoot)
    const report = plane.verifyBaseline()
    plane.close()

    expect(report.modified).toEqual(['文风.md'])
    expect(report.missing).toEqual(['追踪/事实.jsonl'])
    expect(report.untracked).toEqual(['设定/人物/林枫.md'])
    // 规划层修改入面；缺失保守入面
    expect(report.reconcileSurface).toEqual(['文风.md', '追踪/事实.jsonl'])
    expect(report.draftFreeEdits).toEqual([])
  })
})

describe('rebuildProjectionFromCanon（幂等硬断言）', () => {
  it('rebuilds a deleted projection byte-stable: canon hashes, manifest bytes and db fingerprint all unchanged, twice', () => {
    makeBook()
    let plane = LocalDataPlane.open(bookRoot)
    const fingerprintBefore = fingerprint(plane.db)
    plane.close()

    const canonBefore = canonSnapshot()
    const manifestBefore = readFileSync(join(bookRoot, MANIFEST_PATH))

    for (let round = 0; round < 2; round++) {
      removeProjectionFiles()
      rebuildProjectionFromCanon(bookRoot)

      expect(canonSnapshot()).toEqual(canonBefore) // 重建零触碰 canon
      expect(readFileSync(join(bookRoot, MANIFEST_PATH))).toEqual(manifestBefore) // 基线幂等

      plane = LocalDataPlane.open(bookRoot)
      expect(fingerprint(plane.db)).toBe(fingerprintBefore) // 投影完整复原
      plane.close()
      expect(round).toBeLessThan(2)
    }
  })

  it('heals a version-mismatched projection after ProjectionVersionMismatchError', () => {
    makeBook()
    const db = openDatabase({ path: join(bookRoot, RUNTIME_DB_PATH) })
    db.pragma('user_version = 0')
    db.close()

    expect(() => LocalDataPlane.open(bookRoot)).toThrow(/user_version/)
    rebuildProjectionFromCanon(bookRoot)

    const plane = LocalDataPlane.open(bookRoot)
    expect(() => assertProjectionVersion(plane.db)).not.toThrow()
    plane.close()
  })
})
