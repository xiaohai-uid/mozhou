/**
 * 流派资产包：非破坏性注入契约。
 *
 * 回归防护：本函数曾对四个正典文件无条件 `writeFileSync`，重复应用或作者手改后
 * 再应用会静默销毁作者内容；且这些文件不进基线，既无快照可恢复，又会被对账反复
 * 报成外部改动。此处冻结「已存在即跳过」与「写入即登记基线」两条性质。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createBook } from './create-book.js'
import { applyGenreKitToBook, GENRE_PRESETS } from './genre-kits.js'
import { readManifest } from './manifest.js'

const tmpRoots: string[] = []
let bookRoot = ''

const KIT_ID = GENRE_PRESETS[0]!.id
const GOLDEN_FINGER_REL = '设定/世界观/金手指预设.md'

beforeEach(() => {
  bookRoot = join(tmpdir(), `mozhou-genre-${process.pid}-${Math.random().toString(36).slice(2)}`)
  tmpRoots.push(bookRoot)
  mkdirSync(bookRoot, { recursive: true })
  createBook({ dir: bookRoot, title: '流派包测试书' })
})

afterAll(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('applyGenreKitToBook · 非破坏性注入', () => {
  it('首次应用写入 5 个脚手架文件，且全部登记进基线', () => {
    const result = applyGenreKitToBook(bookRoot, KIT_ID)

    expect(result.ok).toBe(true)
    expect(result.appliedFiles).toHaveLength(5)
    expect(result.skippedFiles).toEqual([])

    const manifest = readManifest(bookRoot)
    for (const rel of result.appliedFiles) {
      expect(manifest.files[rel]).toBeDefined()
    }
  })

  it('重复应用不覆盖作者已修改的内容，并将其列入 skippedFiles', () => {
    applyGenreKitToBook(bookRoot, KIT_ID)

    const authored = '# 我自己写的金手指\n\n这是作者手改后的内容。\n'
    writeFileSync(join(bookRoot, GOLDEN_FINGER_REL), authored, 'utf8')

    const second = applyGenreKitToBook(bookRoot, KIT_ID)

    expect(readFileSync(join(bookRoot, GOLDEN_FINGER_REL), 'utf8')).toBe(authored)
    expect(second.skippedFiles).toContain(GOLDEN_FINGER_REL)
    expect(second.appliedFiles).not.toContain(GOLDEN_FINGER_REL)
  })

  it('作者内容被保留时不被吸进基线（仍按外部内容对待）', () => {
    applyGenreKitToBook(bookRoot, KIT_ID)
    const baselineAfterFirst = readManifest(bookRoot).files[GOLDEN_FINGER_REL]

    writeFileSync(join(bookRoot, GOLDEN_FINGER_REL), '作者手改\n', 'utf8')
    applyGenreKitToBook(bookRoot, KIT_ID)

    expect(readManifest(bookRoot).files[GOLDEN_FINGER_REL]).toEqual(baselineAfterFirst)
  })

  it('未知流派包抛错', () => {
    expect(() => applyGenreKitToBook(bookRoot, 'no_such_kit')).toThrow(/unknown genre kit/)
  })
})
