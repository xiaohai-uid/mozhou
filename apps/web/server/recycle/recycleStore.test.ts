/**
 * apps/web/server/recycle · 回收站行为测试。
 * 夹具全部建在系统临时目录，不读写真实书稿。
 * 判定：npx pnpm --filter @mozhou/web exec vitest run server/recycle
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { RecycleError, RecycleStore } from './recycleStore.js'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeStore(): { store: RecycleStore; bookRoot: string } {
  const base = makeTempDir('mozhou-recycle-')
  const bookRoot = join(base, 'book')
  mkdirSync(bookRoot, { recursive: true })
  return { store: new RecycleStore({ root: join(base, 'trash') }), bookRoot }
}

describe('回收站', () => {
  it('删除是移走而不是抹掉；列表记录原始路径', () => {
    const { store, bookRoot } = makeStore()
    const file = join(bookRoot, 'ch1.md')
    writeFileSync(file, '第一章正文', 'utf8')

    const entry = store.trash(file)
    expect(existsSync(file)).toBe(false)
    expect(entry.originalPath).toBe(file)
    expect(entry.isDirectory).toBe(false)
    const listed = store.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.id).toBe(entry.id)
  })

  it('恢复把内容放回原路径，条目随之消失', () => {
    const { store, bookRoot } = makeStore()
    const file = join(bookRoot, 'ch2.md')
    writeFileSync(file, '第二章正文', 'utf8')
    const entry = store.trash(file)

    const result = store.restore(entry.id)
    expect(result.ok).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('第二章正文')
    expect(store.list()).toHaveLength(0)
  })

  it('原路径被占用时拒绝恢复，绝不覆盖新内容', () => {
    const { store, bookRoot } = makeStore()
    const file = join(bookRoot, 'ch3.md')
    writeFileSync(file, '旧内容', 'utf8')
    const entry = store.trash(file)
    writeFileSync(file, '新内容', 'utf8')

    const result = store.restore(entry.id)
    expect(result.ok).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe('新内容')
    // 条目仍在，内容未丢
    expect(store.list()).toHaveLength(1)
  })

  it('目录同样可回收与恢复', () => {
    const { store, bookRoot } = makeStore()
    const dir = join(bookRoot, 'notes')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'a.md'), 'A', 'utf8')

    const entry = store.trash(dir)
    expect(entry.isDirectory).toBe(true)
    expect(existsSync(dir)).toBe(false)

    expect(store.restore(entry.id).ok).toBe(true)
    expect(readFileSync(join(dir, 'a.md'), 'utf8')).toBe('A')
  })

  it('删除不存在的路径显式失败；purge 彻底删除', () => {
    const { store, bookRoot } = makeStore()
    expect(() => store.trash(join(bookRoot, 'missing.md'))).toThrow(RecycleError)

    const file = join(bookRoot, 'ch4.md')
    writeFileSync(file, '内容', 'utf8')
    const entry = store.trash(file)
    expect(store.purge(entry.id)).toBe(true)
    expect(store.list()).toHaveLength(0)
    expect(store.restore(entry.id).ok).toBe(false)
  })
})
