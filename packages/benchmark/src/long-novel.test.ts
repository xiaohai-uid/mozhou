import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ContextPacket } from '@mozhou/context-compiler'
import type { EntityRef, NarrativePromiseId, TemporalFact } from '@mozhou/kernel'
import { evaluateContinuityPacket } from './continuity-assertions.js'

interface LongNovelFixture {
  title: string
  chapters: number[]
  secret: { factId: string; keyword: string; introducedAt: number; revealedAt: number }
  expiredFact: { factId: string; value: string; validFrom: number; validUntil: number; probeAt: number }
  deadCharacter: { ref: string; diesAt: number; probeAt: number }
  promise: { id: string; introducedAt: number; dueAt: number; paidOffAt: number }
  retroactiveChange: { sourceChapter: number; changedFact: string; affectedChapters: number[] }
}

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/long-novel-50.json', import.meta.url), 'utf8'),
) as LongNovelFixture

function packet(chapterIndex: number, text: string, settings: ContextPacket['settings'] = []): ContextPacket {
  return {
    taskType: 'CHAPTER_DRAFTING',
    chapterIndex,
    structural: [{ section: 'outline', text: `第 ${chapterIndex} 章`, tokens: 4 }],
    settings,
    story: { text: '', tokens: 0, trimType: 'none' },
    text,
    totalTokens: text.length + 4,
  }
}

function expiredFact(): TemporalFact {
  return {
    id: fixture.expiredFact.factId as TemporalFact['id'],
    bookId: 'book_01JB00000000000000000000' as TemporalFact['bookId'],
    revision: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    subject: 'char:protagonist',
    predicate: 'state.arm',
    value: fixture.expiredFact.value,
    validFrom: fixture.expiredFact.validFrom,
    validUntil: fixture.expiredFact.validUntil,
    importance: 'notable',
    riskClass: 'low',
    source: { kind: 'chapter', chapterIndex: fixture.expiredFact.validFrom },
    status: 'confirmed',
    compactedIntoVolumeId: null,
    provenance: { origin: 'author', protectedUserContent: true },
  }
}

function deadCharacterRef(): EntityRef {
  return fixture.deadCharacter.ref as EntityRef
}

describe('50 章长篇连续性基准', () => {
  it('fixture 覆盖连续 1–50 章，并固定回溯修改的受影响章集合', () => {
    expect(fixture.chapters).toEqual(Array.from({ length: 50 }, (_, index) => index + 1))
    expect(fixture.secret.revealedAt).toBeGreaterThan(fixture.secret.introducedAt)
    expect(fixture.promise.paidOffAt).toBe(fixture.promise.dueAt)
    expect(fixture.retroactiveChange.affectedChapters).toEqual([17, 28, 43])
    expect(fixture.retroactiveChange.affectedChapters.every((chapter) => chapter > fixture.retroactiveChange.sourceChapter)).toBe(true)
  })

  it('第 27 章同时拦截未揭露秘密、过期伤势与死亡角色 active 三类长程漂移', () => {
    const report = evaluateContinuityPacket(
      packet(
        27,
        `错误上下文：${fixture.secret.keyword}；${fixture.expiredFact.value}`,
        [{
          identifier: deadCharacterRef(),
          tier: 'entity_card',
          text: '老船长：status: active',
          tokens: 8,
          trimType: 'none',
          desirabilityPosition: 0,
        }],
      ),
      {
        currentChapterIndex: 27,
        pov: 'protagonist',
        unrevealedSecrets: [{ factId: fixture.secret.factId, secretKeywords: [fixture.secret.keyword] }],
        expiredFacts: [expiredFact()],
        deadCharacters: [deadCharacterRef()],
      },
    )

    expect(report.passed).toBe(false)
    expect(new Set(report.violations.map((entry) => entry.ruleId))).toEqual(new Set([
      'L1-CONT-001-SECRET-LEAK',
      'L1-CONT-002-EXPIRED-FACT',
      'L1-CONT-003-DEAD-ACTIVE',
    ]))
  })

  it('第 40 章必须携带到期承诺；兑现后干净上下文可通过', () => {
    const due = fixture.promise.id as NarrativePromiseId
    const missing = evaluateContinuityPacket(packet(40, '本章结束但忘记了承诺。'), {
      currentChapterIndex: 40,
      pov: 'protagonist',
      duePromiseIds: [due],
      deadCharacters: [deadCharacterRef()],
    })
    expect(missing.passed).toBe(false)
    expect(missing.violations.some((entry) => entry.ruleId === 'L1-CONT-004-DUE-PROMISE-MISSING')).toBe(true)

    const paid = evaluateContinuityPacket(packet(40, `本章兑现待决承诺: ${fixture.promise.id}`), {
      currentChapterIndex: 40,
      pov: 'protagonist',
      duePromiseIds: [due],
      deadCharacters: [deadCharacterRef()],
    })
    expect(paid.passed).toBe(true)
  })
})
