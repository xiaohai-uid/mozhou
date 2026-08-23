import { describe, expect, it } from 'vitest'
import {
  assertProjectionVersion,
  openDatabase,
  ProjectionVersionMismatchError,
  PROJECTION_SCHEMA_VERSION,
  readProjectionVersion,
} from './database.js'

describe('openDatabase', () => {
  it('opens an in-memory database', () => {
    const db = openDatabase({ path: ':memory:' })
    expect(db.open).toBe(true)
    db.close()
  })

  it('starts at user_version=0 and fails the guard fast', () => {
    const db = openDatabase({ path: ':memory:' })
    expect(readProjectionVersion(db)).toBe(0)
    expect(() => assertProjectionVersion(db)).toThrow(ProjectionVersionMismatchError)
    db.pragma(`user_version = ${PROJECTION_SCHEMA_VERSION}`)
    expect(() => assertProjectionVersion(db)).not.toThrow()
    db.close()
  })
})
