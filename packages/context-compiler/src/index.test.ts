import { describe, expect, it } from 'vitest'
import { CONTEXT_COMPILER_VERSION } from './index.js'

describe('@mozhou/context-compiler', () => {
  it('loads its scaffold seam', () => {
    expect(CONTEXT_COMPILER_VERSION).toBe('0.0.0')
  })
})
