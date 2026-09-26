/**
 * 原子落盘原语契约：同目录临时文件 → fsync → rename。
 *
 * 回归防护（两类都曾真实存在）：
 *  1. 多数写路径只有 `writeFileSync` + `renameSync`，缺 fsync —— rename 可能先于
 *     数据刷到介质，掉电后目标文件变零长度，即稿件内容丢失。故此处必须证明
 *     fsync 真的被调用，而不是只看「写完了能读回」（进程内读回永远成立）。
 *  2. `.mozhou-tmp` 后缀同时是备份排除与崩溃恢复清理的匹配依据，改名会静默
 *     破坏两者，故把它锁成可断言的字面量。
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const probes = vi.hoisted(() => ({ fsyncCount: 0 }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    fsyncSync: (fd: number): void => {
      probes.fsyncCount += 1
      actual.fsyncSync(fd)
    },
  }
})

const { ATOMIC_TMP_SUFFIX, atomicWriteFileSync } = await import('./atomic-write.js')

const roots: string[] = []

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), `mozhou-atomic-${process.pid}-`))
  roots.push(root)
  return root
}

afterAll(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('atomicWriteFileSync · 原子与耐久', () => {
  it('内容逐字节可读回，且不残留临时文件', () => {
    const root = freshRoot()
    const target = join(root, 'a.md')

    atomicWriteFileSync(target, '第一章\n')

    expect(readFileSync(target, 'utf8')).toBe('第一章\n')
    expect(readdirSync(root).filter((name) => name.includes(ATOMIC_TMP_SUFFIX))).toEqual([])
  })

  it('覆盖更长的旧内容时整份替换，不留旧尾巴', () => {
    const root = freshRoot()
    const target = join(root, 'c.md')
    writeFileSync(target, 'A'.repeat(4096), 'utf8')

    atomicWriteFileSync(target, '短')

    expect(readFileSync(target, 'utf8')).toBe('短')
  })

  it('写入过程确实调用 fsync：耐久屏障不可被静默移除', () => {
    const root = freshRoot()
    const before = probes.fsyncCount

    atomicWriteFileSync(join(root, 'd.md'), 'y')

    expect(probes.fsyncCount).toBe(before + 1)
  })

  it('临时后缀为 .mozhou-tmp：备份排除与崩溃恢复清理均依赖该字面量', () => {
    expect(ATOMIC_TMP_SUFFIX).toBe('.mozhou-tmp')
  })
})
