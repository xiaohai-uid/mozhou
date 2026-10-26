import { afterEach, describe, expect, it, vi } from 'vitest'

type UlidModule = typeof import('./ulid.js')

/** Crockford Base32（ULID 规范字母表，无 I/L/O/U）。 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** 规范上限：80 bit 随机段的最大值。 */
const MAX_RANDOM = (1n << 80n) - 1n

/** 规范上限：48 bit 毫秒时间戳的最大值（2^48-1）。 */
const MAX_TIME_MS = 2 ** 48 - 1

/** 固定毫秒：1_700_000_000_000 的时间段为 01HF7YAT00（独立按规范 base32 大端计算）。 */
const T = 1_700_000_000_000

/** 模块持有 lastTime/lastRandom 状态，每个用例重新加载以隔离。 */
async function freshModule(): Promise<UlidModule> {
  vi.resetModules()
  return import('./ulid.js')
}

/**
 * 用确定的 80 bit 序列替换 crypto，并记录每次请求的字节数。
 * 只替换系统边界，不触碰被测模块内部。
 */
function stubRandom(values: readonly bigint[]): number[] {
  const requestedLengths: number[] = []
  let cursor = 0
  vi.stubGlobal('crypto', {
    getRandomValues(target: Uint8Array): Uint8Array {
      requestedLengths.push(target.length)
      const value = values[Math.min(cursor, values.length - 1)] ?? 0n
      cursor += 1
      for (let i = 0; i < target.length; i++) {
        target[i] = Number((value >> BigInt(8 * (target.length - 1 - i))) & 0xffn)
      }
      return target
    },
  })
  return requestedLengths
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('newUlid', () => {
  it('emits 26-char uppercase Crockford Base32', async () => {
    const { newUlid } = await freshModule()
    const id = newUlid()
    expect(id).toHaveLength(26)
    for (const ch of id) {
      expect(CROCKFORD).toContain(ch)
    }
  })

  it('is unique across a large batch', async () => {
    const { newUlid } = await freshModule()
    const seen = new Set<string>()
    for (let i = 0; i < 10_000; i++) {
      seen.add(newUlid())
    }
    expect(seen.size).toBe(10_000)
  })

  it('sorts lexicographically in time order (48-bit timestamp high bits)', async () => {
    const { newUlid } = await freshModule()
    let now = T
    const a = newUlid(() => now)
    now += 5
    const b = newUlid(() => now)
    now += 5
    const c = newUlid(() => now)
    expect(a < b).toBe(true)
    expect(b < c).toBe(true)
  })

  it('encodes a known millisecond as the spec-canonical timestamp prefix', async () => {
    stubRandom([0n])
    const { newUlid } = await freshModule()
    const id = newUlid(() => T)
    expect(id).toBe('01HF7YAT00' + '0000000000000000')
  })

  it('increments the random component by exactly one within the same millisecond', async () => {
    stubRandom([0n])
    const { newUlid } = await freshModule()
    const fixed = () => T
    const first = newUlid(fixed)
    const second = newUlid(fixed)
    const third = newUlid(fixed)
    expect(first).toBe('01HF7YAT00' + '0000000000000000')
    expect(second).toBe('01HF7YAT00' + '0000000000000001')
    expect(third).toBe('01HF7YAT00' + '0000000000000002')
    expect(first < second).toBe(true)
    expect(second < third).toBe(true)
  })

  it('keeps the previous timestamp and increments randomness when the clock goes backwards', async () => {
    stubRandom([0n])
    const { newUlid } = await freshModule()
    const first = newUlid(() => T)
    const second = newUlid(() => T - 10)
    expect(first).toBe('01HF7YAT00' + '0000000000000000')
    expect(second).toBe('01HF7YAT00' + '0000000000000001')
    expect(first < second).toBe(true)
  })

  it('draws exactly 80 bits (10 bytes) and packs them big-endian', async () => {
    const requested = stubRandom([1n << 72n])
    const { newUlid } = await freshModule()
    const id = newUlid(() => T)
    expect(requested).toEqual([10])
    // 0x01 后跟 9 个 0x00 = 2^72 -> 04 000000000000
    expect(id.slice(10)).toBe('0400000000000000')
  })

  it('accepts the full 80-bit random range', async () => {
    stubRandom([MAX_RANDOM])
    const { newUlid } = await freshModule()
    const id = newUlid(() => T)
    expect(id.slice(10)).toBe('ZZZZZZZZZZZZZZZZ')
  })

  it('does not carry while the incremented random stays within 80 bits', async () => {
    stubRandom([MAX_RANDOM - 1n])
    const { newUlid } = await freshModule()
    const first = newUlid(() => T)
    const second = newUlid(() => T)
    expect(first.slice(10)).toBe('ZZZZZZZZZZZZZZZY')
    expect(second.slice(0, 10)).toBe(first.slice(0, 10))
    expect(second.slice(10)).toBe('ZZZZZZZZZZZZZZZZ')
    expect(second > first).toBe(true)
  })

  it('carries into the next millisecond when the 80-bit random overflows', async () => {
    stubRandom([MAX_RANDOM])
    const { newUlid } = await freshModule()
    const first = newUlid(() => T)
    const second = newUlid(() => T)
    expect(first.slice(10)).toBe('ZZZZZZZZZZZZZZZZ')
    expect(second).toBe('01HF7YAT01' + '0000000000000000')
    expect(second > first).toBe(true)

    // 进位后必须继续停在新毫秒上：漏掉 lastTime 同步时第三枚会退回旧时间段，
    // 出现 second > third。这一条是溢出分支的判别断言，不能只测两枚。
    const third = newUlid(() => T)
    expect(third.slice(0, 10)).toBe('01HF7YAT01')
    expect(third > second).toBe(true)
  })

  it('uses fresh randomness for the first ULID at the epoch (timestamp 0)', async () => {
    stubRandom([MAX_RANDOM])
    const { newUlid } = await freshModule()
    const id = newUlid(() => 0)
    expect(id).toBe('0000000000' + 'ZZZZZZZZZZZZZZZZ')
  })

  it('accepts the maximum 48-bit timestamp and encodes it as 7ZZZZZZZZZ', async () => {
    stubRandom([0n])
    const { newUlid } = await freshModule()
    const id = newUlid(() => MAX_TIME_MS)
    expect(id.slice(0, 10)).toBe('7ZZZZZZZZZ')
  })

  it('rejects clock values outside the 48-bit unsigned millisecond range', async () => {
    const { newUlid } = await freshModule()
    const invalid = [Number.NaN, Number.POSITIVE_INFINITY, 1.5, -1, MAX_TIME_MS + 1]
    for (const value of invalid) {
      expect(() => newUlid(() => value), String(value)).toThrow(RangeError)
    }
  })

  it('leaves the generator untouched when it rejects a clock value', async () => {
    stubRandom([0n])
    const { newUlid } = await freshModule()
    const fixed = () => T
    // 先在 T 毫秒成功铸一枚（随机段 0），让 lastTime/lastRandom 有可观察的状态。
    expect(newUlid(fixed)).toBe('01HF7YAT00' + '0000000000000000')
    expect(() => newUlid(() => -1)).toThrow(RangeError)
    // 若被拒调用推进了状态，同毫秒续排会拿到随机段 2（...0002）而不是 1。
    expect(newUlid(fixed)).toBe('01HF7YAT00' + '0000000000000001')
  })
})

describe('branded id factories', () => {
  it('mints every family with its own prefix and a valid ULID body', async () => {
    const mod = await freshModule()
    const cases = [
      ['book_', mod.newBookId],
      ['book_', mod.newBookNodeId],
      ['volume_', mod.newVolumeNodeId],
      ['aint_', mod.newAuthorIntentId],
      ['style_', mod.newStyleProfileId],
      ['chapter_', mod.newChapterNodeId],
      ['cmit_', mod.newChapterCommitId],
      ['fact_', mod.newFactId],
      ['knst_', mod.newKnowledgeStateId],
      ['rels_', mod.newRelationshipStateId],
      ['tle_', mod.newTimelineEventId],
    ] as const
    for (const [prefix, mint] of cases) {
      const id = mint()
      expect(id.slice(0, prefix.length)).toBe(prefix)
      expect(id.slice(prefix.length)).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    }
  })

  it('keeps ids locally grep-able (no underscore in the ULID body)', async () => {
    const { newUlid } = await freshModule()
    expect(newUlid()).not.toContain('_')
  })
})
