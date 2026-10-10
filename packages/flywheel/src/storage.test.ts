/**
 * 偏好派生存储 · 原子整表重写（rewriteObservations）。
 *
 * 覆盖：整表重写后盘上是完整内容、逐行可读回；同目录不留 `.mozhou-tmp` 残留；
 * 空批零写语义不变（不创建文件）。
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  OBSERVATIONS_RELPATH,
  PREFERENCE_DIR,
  readPersistedObservations,
  rewriteObservations,
} from './storage.js'
import type { PreferenceObservation } from './types.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mozhou-flywheel-storage-'))
  roots.push(root)
  return root
}

function obs(obsId: string, sourcePosition: number): PreferenceObservation {
  return {
    obsId,
    sourcePosition,
    kind: 'candidate_decision',
    taskRef: `task_${sourcePosition}`,
    sceneType: null,
    features: { sent_len_mean: 0.5 },
    w: 1,
  }
}

describe('rewriteObservations · 原子整表重写', () => {
  it('整表重写后内容完整、逐行可读回，且不留 `.mozhou-tmp` 残留', () => {
    const root = freshRoot()
    const rows = [obs('1', 1), obs('2', 2), obs('3', 3)]

    rewriteObservations(root, rows)

    expect(readPersistedObservations(root)).toEqual(rows)
    const dir = join(root, PREFERENCE_DIR)
    expect(readdirSync(dir).filter((name) => name.includes('.mozhou-tmp'))).toEqual([])
    // 盘上字节 = 逐行 JSON + 换行（写全，未被截断）
    expect(readFileSync(join(root, OBSERVATIONS_RELPATH), 'utf8')).toBe(
      rows.map((row) => JSON.stringify(row) + '\n').join(''),
    )
  })

  it('覆盖已有更长的表：整份替换，不留旧尾行', () => {
    const root = freshRoot()
    rewriteObservations(root, [obs('1', 1), obs('2', 2), obs('3', 3)])

    rewriteObservations(root, [obs('9', 9)])

    expect(readPersistedObservations(root)).toEqual([obs('9', 9)])
  })

  it('空批零写：不创建文件（既有语义不变）', () => {
    const root = freshRoot()

    rewriteObservations(root, [])

    expect(existsSync(join(root, OBSERVATIONS_RELPATH))).toBe(false)
  })
})
