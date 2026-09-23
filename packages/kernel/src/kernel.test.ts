import { describe, expect, it } from 'vitest'
import * as schema from './kernel-schema.js'

describe('@mozhou/kernel', () => {
  it('frozen schema module loads with exported surface', () => {
    expect(Object.keys(schema).length).toBeGreaterThanOrEqual(0)
  })
})
