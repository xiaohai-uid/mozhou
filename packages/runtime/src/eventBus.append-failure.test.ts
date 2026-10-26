/**
 * 切片 2 回归锁：`PublishBus.publish` 的「先追加、后提交内存配对状态」顺序，
 * 以及追加失败后的**毒化**（I/O 抛错结果不明，不得按「完全没写」重试）。
 *
 * 通过 vi.mock 给 `node:fs.appendFileSync` 注入一次性 EIO（内存故障注入，不触真盘，
 * 与隔离复现证据同法：head 追加先抛 EIO、tail 追加先抛 EIO 两种输入）。
 */
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PublishBus, readLedger } from './eventBus.js'

const state = vi.hoisted(() => ({
  failNextAppend: null as Error | null,
  /** >0：抛错前先写入这么多字节（模拟「部分追加」）。 */
  partialAppendBytes: 0,
  failNextRead: null as Error | null,
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: ((...args: Parameters<typeof actual.readFileSync>) => {
      if (state.failNextRead !== null) {
        const error = state.failNextRead
        state.failNextRead = null
        throw error
      }
      return actual.readFileSync(...args)
    }) as typeof actual.readFileSync,
    appendFileSync: ((...args: Parameters<typeof actual.appendFileSync>) => {
      if (state.failNextAppend !== null) {
        const error = state.failNextAppend
        state.failNextAppend = null
        const partial = state.partialAppendBytes
        state.partialAppendBytes = 0
        if (partial > 0) {
          const [file, data] = args
          const full = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8')
          actual.appendFileSync(file, full.subarray(0, partial))
        }
        throw error
      }
      return actual.appendFileSync(...args)
    }) as typeof actual.appendFileSync,
  }
})

function hermeticRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mozhou-bus-eio-'))
  mkdirSync(join(root, '.mozhou'), { recursive: true })
  return root
}

const head = { type: 'GenerationStarted', taskRef: 't1' } as const
const tail = { type: 'GenerationFinished', taskRef: 't1' } as const

describe('PublishBus · 追加失败的内存/账本一致性（切片 2）', () => {
  it('head 追加失败：账本零行、内存配对状态不变，恢复后可安全重发', () => {
    const root = hermeticRoot()
    const bus = new PublishBus()
    state.failNextAppend = Object.assign(new Error('EIO: injected'), { code: 'EIO' })
    expect(() => bus.publish({ root }, head)).toThrow(/EIO/)

    expect(readLedger({ root })).toHaveLength(0)
    // 修复前：head 已写进内存 ⇒ 此处报 PAIRING_HEAD_UNCLOSED，重试永远失败
    expect(bus.openHeadKeys()).toEqual([])

    // 但实例已毒化：结果不明，必须先按账本核对再恢复
    expect(() => bus.publish({ root }, head)).toThrow(/停止发布/)
    expect(bus.poisoned).not.toBeNull()

    bus.adoptOpenHeads({ root }) // 恢复入口：按账本重建配对状态 + 清除毒化
    bus.publish({ root }, head)
    expect(readLedger({ root })).toHaveLength(1)
    expect(bus.openHeadKeys()).toEqual(['GenerationStarted#t1'])
  })

  it('tail 追加失败：原 head 仍待闭合，恢复后可安全闭合', () => {
    const root = hermeticRoot()
    const bus = new PublishBus()
    bus.publish({ root }, head)
    expect(bus.openHeadKeys()).toEqual(['GenerationStarted#t1'])

    state.failNextAppend = new Error('EIO: injected')
    expect(() => bus.publish({ root }, tail)).toThrow(/EIO/)

    expect(readLedger({ root })).toHaveLength(1) // 账本只有 head
    // 修复前：head 已被删 ⇒ 重试报 PAIRING_TAIL_WITHOUT_HEAD，head 永远闭合不了
    expect(bus.openHeadKeys()).toEqual(['GenerationStarted#t1'])

    bus.adoptOpenHeads({ root })
    bus.publish({ root }, tail)
    expect(readLedger({ root }).map((row) => row.event.type)).toEqual(['GenerationStarted', 'GenerationFinished'])
    expect(bus.openHeadKeys()).toEqual([])
  })

  it('毒化后拒绝一切发布（含配对无关事件），直到恢复入口清除标记', () => {
    const root = hermeticRoot()
    const bus = new PublishBus()
    state.failNextAppend = new Error('EIO: injected')
    expect(() => bus.publish({ root }, head)).toThrow(/EIO/)
    expect(bus.poisoned).toMatch(/EIO/)
    expect(() =>
      bus.publish({ root }, { type: 'StyleProfileUpdated', taskRef: 't9', chapterIndex: 1 }),
    ).toThrow(/停止发布/)

    bus.adoptOpenHeads({ root })
    expect(bus.poisoned).toBeNull()
    bus.publish({ root }, { type: 'StyleProfileUpdated', taskRef: 't9', chapterIndex: 1 })
    expect(readLedger({ root })).toHaveLength(1)
  })

  it('配对校验失败（写前拒绝）不毒化实例，也不改内存状态', () => {
    const root = hermeticRoot()
    const bus = new PublishBus()
    expect(() => bus.publish({ root }, tail)).toThrow(/PAIRING_TAIL_WITHOUT_HEAD/)
    expect(bus.poisoned).toBeNull()

    bus.publish({ root }, head)
    expect(() => bus.publish({ root }, head)).toThrow(/PAIRING_HEAD_UNCLOSED/)
    expect(bus.poisoned).toBeNull()
    expect(readLedger({ root })).toHaveLength(1)
  })
})

describe('PublishBus · 部分追加后的恢复必须 fail-closed（S1）', () => {
  it('部分追加留下半行：恢复拒绝且保持停止，原件保留', () => {
    const root = hermeticRoot()
    const bus = new PublishBus()
    bus.publish({ root }, head)

    // 写 25 字节 TaskFinished 后抛 EIO（隔离复现的输入）
    state.failNextAppend = new Error('EIO: injected')
    state.partialAppendBytes = 25
    expect(() => bus.publish({ root }, tail)).toThrow(/EIO/)
    expect(bus.poisoned).not.toBeNull()

    // 恢复必须拒绝：尾部是无法证明安全的半行
    expect(() => bus.adoptOpenHeads({ root })).toThrow(/not physically intact|partial append/)
    // 停止标记仍在，绝不「跳过坏行宣称恢复成功」
    expect(bus.poisoned).not.toBeNull()
    expect(() => bus.publish({ root }, tail)).toThrow(/停止发布/)

    // 原件保留：半行没有被删除或补齐
    const text = readFileSync(join(root, '.mozhou', 'events.jsonl'), 'utf8')
    expect(text.endsWith('\n')).toBe(false)
  })

  it('恢复读取失败（EACCES）时保持停止标记', () => {
    const root = hermeticRoot()
    const bus = new PublishBus()
    bus.publish({ root }, head)
    state.failNextAppend = new Error('EIO: injected')
    expect(() => bus.publish({ root }, tail)).toThrow(/EIO/)

    state.failNextRead = Object.assign(new Error('EACCES: denied'), { code: 'EACCES' })
    expect(() => bus.adoptOpenHeads({ root })).toThrow(/EACCES/)
    expect(bus.poisoned).not.toBeNull()
  })

  it('账本完整时恢复照常成功（fail-closed 不放宽正常路径）', () => {
    const root = hermeticRoot()
    const bus = new PublishBus()
    bus.publish({ root }, head)
    state.failNextAppend = new Error('EIO: injected')
    expect(() => bus.publish({ root }, tail)).toThrow(/EIO/)

    bus.adoptOpenHeads({ root }) // 账本只有一条完整行 ⇒ 核对通过
    expect(bus.poisoned).toBeNull()
    bus.publish({ root }, tail)
    expect(readLedger({ root }).map((row) => row.event.type)).toEqual(['GenerationStarted', 'GenerationFinished'])
  })
})
