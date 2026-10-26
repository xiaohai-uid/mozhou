/**
 * 文风.md 存储往返（style-profiles）：非空 tabooWords 的判别性用例。
 *
 * 缺口来源：style-learner.test.ts 的往返用例只覆盖 seed 空表（全部
 * `tabooWords: []`），于是「非空禁用词写入后读不回来」的结构缺陷长期未被发现。
 * 本用例把校验改回旧逻辑（fields.size !== 6）时必红。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  emitStyleProfilesYaml,
  readStyleProfiles,
  seedStyleProfileRows,
  serializeStyleProfiles,
} from './style-profiles.js'

const FRONTMATTER = '---\nmzhouId: style_test_0001\nkind: styleProfile\n---\n\n# 文风画像\n\n'

describe('文风.md 非空 tabooWords 往返', () => {
  let root = ''

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mozhou-style-taboo-'))
    mkdirSync(root, { recursive: true })
  })

  afterEach(() => {
    if (root !== '') rmSync(root, { recursive: true, force: true })
  })

  it('非空 tabooWords（含正则元字符词条）emit 后原样读回', () => {
    const rows = seedStyleProfileRows()
    const withTaboo = {
      ...rows,
      action: { ...rows.action, tabooWords: ['废柴', 'A+B'] },
      dialogue: { ...rows.dialogue, tabooWords: ['少侠'] },
    }

    writeFileSync(join(root, '文风.md'), FRONTMATTER + emitStyleProfilesYaml(withTaboo), 'utf8')

    expect(readStyleProfiles(root)).toEqual(withTaboo)
  })

  it('serialize 往返同样保留非空 tabooWords，且围栏外字节不变', () => {
    const rows = seedStyleProfileRows()
    const raw = FRONTMATTER + emitStyleProfilesYaml(rows)
    writeFileSync(join(root, '文风.md'), raw, 'utf8')

    const mutated = {
      ...rows,
      romance_emotion: { ...rows.romance_emotion, tabooWords: ['宝贝儿'] },
    }
    const rewritten = serializeStyleProfiles(raw, mutated)

    expect(rewritten.startsWith(FRONTMATTER)).toBe(true)
    writeFileSync(join(root, '文风.md'), rewritten, 'utf8')
    expect(readStyleProfiles(root).romance_emotion.tabooWords).toEqual(['宝贝儿'])
  })
})
