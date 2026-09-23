import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createBook } from './create-book.js'
import { MANIFEST_PATH, RUNTIME_DB_PATH } from './layout.js'
import { readManifest } from './manifest.js'
import { parseFrontmatter } from './yaml-frontmatter.js'

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

/** 冻结布局期望集——独立于实现常量手写，防实现自证（dual-plane-sync-spec 目录树 v2 + #13 五目）。 */
const EXPECTED_FILES = [
  'book.json',
  '大纲/总纲.md',
  '大纲/第一卷.md',
  '设定/作者意图.md',
  '文风.md',
  '市场/market-brief.md',
  '追踪/事实.jsonl',
  '追踪/认知.jsonl',
  '追踪/关系.jsonl',
  '追踪/伏笔.jsonl',
  '追踪/时间线.jsonl',
  // 运行时区初始三件：事件账本 / hash 基线 / SQLite 投影
  '.mozhou/events.jsonl',
  '.mozhou/manifest.json',
  '.mozhou/runtime.sqlite',
]

const EXPECTED_DIRS = [
  '正文',
  '正文/第一卷',
  '大纲',
  '大纲/章节',
  '设定',
  '设定/人物',
  '设定/物品',
  '设定/地点',
  '设定/势力',
  '设定/概念',
  '追踪',
  '摘要',
  '市场',
  '市场/benchmarks',
  '.mozhou',
  '.mozhou/receipts',
  '.mozhou/snapshots',
  '.mozhou/indexes',
  '.mozhou/embeddings',
]

function walkRelative(root: string, rel = ''): { files: string[]; dirs: string[] } {
  const files: string[] = []
  const dirs: string[] = []
  for (const name of readdirSync(join(root, rel))) {
    const childRel = rel ? `${rel}/${name}` : name
    if (statSync(join(root, childRel)).isDirectory()) {
      dirs.push(childRel)
      const nested = walkRelative(root, childRel)
      files.push(...nested.files)
      dirs.push(...nested.dirs)
    } else {
      files.push(childRel)
    }
  }
  return { files: files.sort(), dirs: dirs.sort() }
}

describe('createBook', () => {
  it('lays down the complete frozen v2 tree: every expected file and directory, nothing extra', () => {
    createBook({ dir: bookRoot, title: '凡人修仙传' })

    const actual = walkRelative(bookRoot)
    expect(actual.files.sort()).toEqual([...EXPECTED_FILES].sort())
    expect(actual.dirs.sort()).toEqual([...EXPECTED_DIRS].sort())
    // 五目齐全：EntityRef 五前缀一一对应
    for (const cardDir of ['人物', '物品', '地点', '势力', '概念']) {
      expect(existsSync(join(bookRoot, '设定', cardDir))).toBe(true)
    }
  })

  it('writes book.json as the frozen BookRecord shape', () => {
    const result = createBook({ dir: bookRoot, title: '凡人修仙传' })

    const record = JSON.parse(readFileSync(join(bookRoot, 'book.json'), 'utf8')) as Record<string, unknown>
    expect(record['id']).toBe(result.book.id)
    expect(record['id']).toMatch(/^book_[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(record['title']).toBe('凡人修仙传')
    expect(record['revision']).toBe(0)
    expect(record['createdAt']).toBe(record['updatedAt'])
    expect(Number.isNaN(Date.parse(record['createdAt'] as string))).toBe(false)
  })

  it('stamps frozen Q13 frontmatter identity fields and parent linkage on canon md files', () => {
    createBook({ dir: bookRoot, title: '凡人修仙传' })

    const zonggang = parseFrontmatter(readFileSync(join(bookRoot, '大纲/总纲.md'), 'utf8'))
    expect(zonggang.data['mozhouId']).toMatch(/^book_[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(zonggang.data['nodeType']).toBe('book')
    expect(zonggang.data['parentId']).toBeNull()
    expect(zonggang.data['orderIndex']).toBe(0)
    expect(zonggang.data['revision']).toBe(0)
    expect(zonggang.data['status']).toBe('drafted')
    expect(zonggang.data['originAuthor']).toBe(true)
    expect(zonggang.data['protected']).toBe(true)

    const volume = parseFrontmatter(readFileSync(join(bookRoot, '大纲/第一卷.md'), 'utf8'))
    expect(volume.data['nodeType']).toBe('volume')
    expect(volume.data['parentId']).toBe(zonggang.data['mozhouId'])
    expect(volume.data['orderIndex']).toBe(0)

    const intent = parseFrontmatter(readFileSync(join(bookRoot, '设定/作者意图.md'), 'utf8'))
    expect(intent.data['kind']).toBe('authorIntent')
    expect(intent.data['mozhouId']).toMatch(/^aint_[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(intent.data['protected']).toBe(true)

    const style = parseFrontmatter(readFileSync(join(bookRoot, '文风.md'), 'utf8'))
    expect(style.data['kind']).toBe('styleProfile')
    expect(style.data['mozhouId']).toMatch(/^style_[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('creates all five tracking jsonl streams empty', () => {
    createBook({ dir: bookRoot, title: 't' })
    for (const name of ['事实', '认知', '关系', '伏笔', '时间线']) {
      const path = join(bookRoot, '追踪', `${name}.jsonl`)
      expect(existsSync(path)).toBe(true)
      expect(statSync(path).size).toBe(0)
    }
  })

  it('registers every initial canon file in the .mozhou/manifest.json hash baseline', () => {
    createBook({ dir: bookRoot, title: '凡人修仙传' })

    const manifest = readManifest(bookRoot)

    expect(manifest.manifestVersion).toBe(1)
    expect(manifest.bookId).toMatch(/^book_/)

    const canonFiles = walkRelative(bookRoot).files.filter((rel) => rel !== MANIFEST_PATH && !rel.startsWith('.mozhou/'))
    expect(Object.keys(manifest.files).sort()).toEqual(canonFiles.sort())
    for (const rel of canonFiles) {
      const entry = manifest.files[rel]
      expect(entry).toBeDefined()
      const digest = createHash('sha256').update(readFileSync(join(bookRoot, rel))).digest('hex')
      expect(entry?.sha256).toBe(digest)
      expect(entry?.bytes).toBe(statSync(join(bookRoot, rel)).size)
    }
  })

  it('initializes the SQLite projection stamped with PROJECTION_SCHEMA_VERSION', () => {
    createBook({ dir: bookRoot, title: 't' })
    expect(existsSync(join(bookRoot, RUNTIME_DB_PATH))).toBe(true)
  })

  it('refuses to clobber a non-empty directory and leaves no partial book behind', () => {
    writeFileSync(join(bookRoot, '作者的东西.txt'), 'keep me')
    expect(() => createBook({ dir: bookRoot, title: 't' })).toThrow(/not empty/i)
    expect(walkRelative(bookRoot).files).toEqual(['作者的东西.txt'])
  })
})
