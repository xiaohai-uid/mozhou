/**
 * 世界书持久层测试：缺文件=空、upsert 幂等（同 id 覆盖/新 id 追加）、
 * 校验拒绝（id/关键词/内容/enabled）、删除存在性、tmp+rename 原子落盘。
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LOREBOOK_RELPATH,
  LorebookValidationError,
  deleteLorebookEntry,
  readLorebook,
  upsertLorebookEntry,
} from './lorebook.js'

const tmpRoots: string[] = []

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function freshRoot(): string {
  const root = join(tmpdir(), `mozhou-lorebook-${process.pid}-${Math.random().toString(36).slice(2)}`)
  tmpRoots.push(root)
  return root
}

const ENTRY = {
  id: 'lb_entry001',
  title: '玄灯教铁律',
  keywords: ['玄灯教', '灯律'],
  content: '玄灯教弟子夜行必提本命灯，灯灭即魂销。',
  enabled: true,
}

describe('世界书持久层（设定/世界书.json）', () => {
  it('缺文件读取 = 空世界书（不视为结构违例）', () => {
    const root = freshRoot()
    expect(readLorebook(root)).toEqual([])
  })

  it('upsert 新条目落盘并可读回', () => {
    const root = freshRoot()
    const entries = upsertLorebookEntry(root, ENTRY)
    expect(entries).toHaveLength(1)
    expect(existsSync(join(root, LOREBOOK_RELPATH))).toBe(true)
    expect(readLorebook(root)[0]).toMatchObject({ id: 'lb_entry001', title: '玄灯教铁律' })
  })

  it('同 id 覆盖（幂等），新 id 追加保持插入序', () => {
    const root = freshRoot()
    upsertLorebookEntry(root, ENTRY)
    upsertLorebookEntry(root, { ...ENTRY, title: '玄灯教铁律（修订）' })
    upsertLorebookEntry(root, { ...ENTRY, id: 'lb_entry002', title: '渡口旧约' })
    const entries = readLorebook(root)
    expect(entries).toHaveLength(2)
    expect(entries[0]?.title).toBe('玄灯教铁律（修订）')
    expect(entries[1]?.id).toBe('lb_entry002')
  })

  it('校验拒绝：非法 id / 空关键词 / 空内容 / 非布尔 enabled', () => {
    const root = freshRoot()
    expect(() => upsertLorebookEntry(root, { ...ENTRY, id: 'bad_id' })).toThrow(LorebookValidationError)
    expect(() => upsertLorebookEntry(root, { ...ENTRY, keywords: ['  ', ''] })).toThrow(LorebookValidationError)
    expect(() => upsertLorebookEntry(root, { ...ENTRY, content: '   ' })).toThrow(LorebookValidationError)
    expect(() => upsertLorebookEntry(root, { ...ENTRY, enabled: 1 as unknown as boolean })).toThrow(
      LorebookValidationError,
    )
  })

  it('删除存在条目；删除不存在 id 抛错', () => {
    const root = freshRoot()
    upsertLorebookEntry(root, ENTRY)
    const after = deleteLorebookEntry(root, 'lb_entry001')
    expect(after).toEqual([])
    expect(() => deleteLorebookEntry(root, 'lb_missing')).toThrow(LorebookValidationError)
  })

  it('落盘文件为美化 JSON（tmp+rename 原子写）且无 .tmp 残留', () => {
    const root = freshRoot()
    upsertLorebookEntry(root, ENTRY)
    const raw = readFileSync(join(root, LOREBOOK_RELPATH), 'utf8')
    expect(raw.startsWith('{\n  "version": 1')).toBe(true)
    expect(existsSync(join(root, LOREBOOK_RELPATH + '.tmp'))).toBe(false)
  })
})
