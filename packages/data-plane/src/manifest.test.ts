/**
 * hash 基线落盘契约：原子写 + 损坏可识别、可恢复。
 *
 * 回归防护：`writeManifest` 曾直接 `writeFileSync`，崩溃/掉电截断会留下半份 JSON；
 * 而 `readManifest` 直接 `JSON.parse`，损坏即抛裸 SyntaxError，`openOrRebuild` 不认，
 * 结果是整本书经应用永久无法打开（稿件文件本身未损，但可用性中断）。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createBook } from './create-book.js'
import { MANIFEST_PATH } from './layout.js'
import { LocalDataPlane } from './local-data-plane.js'
import { CorruptManifestError, readManifest, writeManifest } from './manifest.js'

const tmpRoots: string[] = []
let bookRoot = ''

beforeEach(() => {
  bookRoot = join(tmpdir(), `mozhou-manifest-${process.pid}-${Math.random().toString(36).slice(2)}`)
  tmpRoots.push(bookRoot)
  mkdirSync(bookRoot, { recursive: true })
  createBook({ dir: bookRoot, title: '基线测试书' })
})

afterAll(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('writeManifest / readManifest · 原子与损坏识别', () => {
  it('写入后可原样读回，且不残留临时文件', () => {
    const manifest = readManifest(bookRoot)
    writeManifest(bookRoot, manifest)

    expect(readManifest(bookRoot)).toEqual(manifest)
    expect(() => readFileSync(join(bookRoot, `${MANIFEST_PATH}.mozhou-tmp`), 'utf8')).toThrow()
  })

  it('截断的 manifest 抛 CorruptManifestError 而非裸 SyntaxError', () => {
    writeFileSync(join(bookRoot, MANIFEST_PATH), '{"manifestVersion":1,"bookId":"x","fil', 'utf8')

    expect(() => readManifest(bookRoot)).toThrow(CorruptManifestError)
  })

  it('openOrRebuild 能从损坏的 manifest 恢复，并重立与 canon 一致的基线', () => {
    const expected = readManifest(bookRoot)
    writeFileSync(join(bookRoot, MANIFEST_PATH), 'not-json-at-all', 'utf8')

    const plane = LocalDataPlane.openOrRebuild(bookRoot)
    try {
      expect(plane.manifest.files).toEqual(expected.files)
    } finally {
      plane.close()
    }
  })
})
