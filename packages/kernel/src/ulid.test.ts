import { describe, expect, it } from 'vitest'
import { newBookId, newUlid } from './ulid.js'

/** Crockford Base32（ULID 规范字母表，无 I/L/O/U）。 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

describe('newUlid', () => {
  it('emits 26-char uppercase Crockford Base32', () => {
    const id = newUlid()
    expect(id).toHaveLength(26)
    for (const ch of id) {
      expect(CROCKFORD).toContain(ch)
    }
  })

  it('is unique across a large batch', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 10_000; i++) {
      seen.add(newUlid())
    }
    expect(seen.size).toBe(10_000)
  })

  it('sorts lexicographically in time order (48-bit timestamp high bits)', () => {
    let now = 1_700_000_000_000
    const a = newUlid(() => now)
    now += 5
    const b = newUlid(() => now)
    now += 5
    const c = newUlid(() => now)
    expect(a < b).toBe(true)
    expect(b < c).toBe(true)
  })

  it('stays monotonic within the same millisecond', () => {
    const fixed = () => 1_700_000_000_000
    const a = newUlid(fixed)
    const b = newUlid(fixed)
    const c = newUlid(fixed)
    expect(a < b).toBe(true)
    expect(b < c).toBe(true)
  })
})

describe('branded id factories', () => {
  it('mints prefixed ids that stay locally grep-able', () => {
    expect(newBookId()).toMatch(/^book_[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(newUlid()).not.toContain('_')
  })
})
