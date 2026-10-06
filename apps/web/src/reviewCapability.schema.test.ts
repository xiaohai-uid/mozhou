// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBook, LocalDataPlane, proseChapterPath } from '@mozhou/data-plane'
import { executeChapterReview, loadDraftForReview } from '@mozhou/pipeline'
import {
  defaultPlatformRules, evaluateMechanicalGates, hashProse, qualityRuleSetDigest, runQualityReview,
} from '@mozhou/quality-engine'
import type { SemanticQualityEvaluator } from '@mozhou/quality-engine'
import {
  parseReviewCapabilityRequest, parseReviewCapabilityResponse,
  reviewCapabilityRequestSchema, reviewCapabilityResponseSchema,
} from '@mozhou/pipeline/reviewCapability.schema'
import type { ReviewCapabilityRequest, ReviewCapabilityResponse } from '@mozhou/pipeline/reviewCapability.schema'

const body = '门外传来敲门声。他收起旧信，吹灭了灯。'
function requestFor(prose = body): ReviewCapabilityRequest {
  const policy = {
    schemaVersion: 1 as const, projectId: 'review-contract-fixture', maxAutomaticReworks: 2 as const,
    rules: defaultPlatformRules().filter((r) => r.id === 'REV-001' || r.id === 'NARR-001'),
  }
  return {
    schemaVersion: 1, requestId: 'review-fixture-1',
    draft: { chapterIndex: 3, revision: 1, body: prose, contentHash: hashProse(prose) },
    receiptId: 'receipt-fixture-1', ruleSetDigest: qualityRuleSetDigest(policy),
    reviewer: { providerId: 'fixture', model: 'async-review', recipeVersion: '1.0.0' },
    policy, failurePatterns: [{ code: 'outline_expansion', firstSeenChapter: 1, lastSeenChapter: 2, occurrences: 1, active: true }],
    actionBeatParagraphs: [0], mechanicalOptions: { minWords: 0, maxWords: 6000 },
  }
}

function passingEvaluator(): SemanticQualityEvaluator {
  return {
    async evaluate(input) {
      await Promise.resolve()
      expect(input.prose).toBe(body)
      expect(input.projectFailurePatterns[0]?.code).toBe('outline_expansion')
      return input.rules.map((rule) => ({
        ruleId: rule.id, ruleVersion: rule.version, verdict: 'pass', severity: rule.severity, evidence: [],
      }))
    },
  }
}

async function responseFor(
  request: ReviewCapabilityRequest, evaluator?: SemanticQualityEvaluator,
): Promise<Extract<ReviewCapabilityResponse, { status: 'completed' }>> {
  const report = await runQualityReview({
    prose: request.draft.body, policy: request.policy, reviewer: request.reviewer,
    anchor: { chapterIndex: request.draft.chapterIndex, draftRevision: request.draft.revision,
      draftContentHash: request.draft.contentHash, receiptId: request.receiptId, ruleSetDigest: request.ruleSetDigest },
    failurePatterns: request.failurePatterns,
    ...(evaluator ? { semanticEvaluator: evaluator } : {}),
    ...(request.actionBeatParagraphs ? { actionBeatParagraphs: new Set(request.actionBeatParagraphs) } : {}),
  })
  return { schemaVersion: 1, requestId: request.requestId, status: 'completed', report,
    mechanicalGate: evaluateMechanicalGates(request.draft.body, request.mechanicalOptions) }
}

const temporaryRoots: string[] = []
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('chapter review JSON boundary', () => {
  it('preserves all request data during JSON round trip and does not mutate it', () => {
    const request = requestFor()
    const before = JSON.stringify(request)
    const wire: unknown = JSON.parse(before)
    const result = parseReviewCapabilityRequest(wire)
    expect(result).toEqual({ ok: true, value: request })
    expect(JSON.stringify(request)).toBe(before)
    expect(result).toMatchSnapshot()
  })

  it.each<{ name: string; value: unknown }>([
    { name: 'unsupported protocol version', value: { ...requestFor(), schemaVersion: 2 } },
    { name: 'missing receipt', value: { ...requestFor(), receiptId: undefined } },
    { name: 'empty receipt', value: { ...requestFor(), receiptId: '' } },
    { name: 'session object', value: { ...requestFor(), session: {} } },
    { name: 'filesystem authority', value: { ...requestFor(), bookRoot: 'C:/manuscript' } },
    { name: 'callback evaluator', value: { ...requestFor(), semanticEvaluator: () => [] } },
    { name: 'Set loses JSON contents', value: { ...requestFor(), actionBeatParagraphs: new Set([0]) } },
    { name: 'negative paragraph', value: { ...requestFor(), actionBeatParagraphs: [-1] } },
    { name: 'repeated paragraph', value: { ...requestFor(), actionBeatParagraphs: [0, 0] } },
    { name: 'nonfinite revision', value: { ...requestFor(), draft: { ...requestFor().draft, revision: NaN } } },
    { name: 'unsafe integer', value: { ...requestFor(), draft: { ...requestFor().draft, revision: 2 ** 53 } } },
    { name: 'invalid content hash', value: { ...requestFor(), draft: { ...requestFor().draft, contentHash: 'fake' } } },
    { name: 'nested provider token', value: { ...requestFor(), reviewer: { ...requestFor().reviewer, apiKey: 'synthetic-token' } } },
    { name: 'relaxed rework limit', value: { ...requestFor(), policy: { ...requestFor().policy, maxAutomaticReworks: 3 } } },
    { name: 'duplicate policy rule', value: { ...requestFor(), policy: { ...requestFor().policy, rules: [...requestFor().policy.rules, requestFor().policy.rules[0]] } } },
    { name: 'inverted word window', value: { ...requestFor(), mechanicalOptions: { minWords: 10, maxWords: 1 } } },
    { name: 'undefined optional field', value: { ...requestFor(), actionBeatParagraphs: undefined } },
    { name: 'timeoutMs below minimum', value: { ...requestFor(), timeoutMs: 999 } },
    { name: 'timeoutMs above maximum', value: { ...requestFor(), timeoutMs: 300001 } },
    { name: 'negative timeoutMs', value: { ...requestFor(), timeoutMs: -1 } },
    { name: 'non-integer timeoutMs', value: { ...requestFor(), timeoutMs: 5000.5 } },
  ])('rejects $name before serialization', ({ value }) => {
    expect(parseReviewCapabilityRequest(value).ok).toBe(false)
  })

  it('rejects fields hidden from JSON and getters without invoking them', () => {
    const hidden = { ...requestFor() }
    Object.defineProperty(hidden, 'toJSON', { value: () => ({}), enumerable: false })
    expect(parseReviewCapabilityRequest(hidden).ok).toBe(false)
    let reads = 0
    const accessor = { ...requestFor() }
    Object.defineProperty(accessor, 'receiptId', { enumerable: true, get: () => { reads += 1; return 'receipt' } })
    expect(parseReviewCapabilityRequest(accessor).ok).toBe(false)
    expect(reads).toBe(0)
    const polluted: unknown = JSON.parse(JSON.stringify(requestFor()).replace('"schemaVersion":1', '"__proto__":{},"schemaVersion":1'))
    expect(parseReviewCapabilityRequest(polluted).ok).toBe(false)
    expect(parseReviewCapabilityRequest({ ...requestFor(), actionBeatParagraphs: new Array<unknown>(1) }).ok).toBe(false)
  })

  it('accepts the real asynchronous semantic and mechanical outputs', async () => {
    const request = requestFor()
    const response = await responseFor(request, passingEvaluator())
    const wire: unknown = JSON.parse(JSON.stringify(response))
    expect(parseReviewCapabilityResponse(wire, request)).toEqual({ ok: true, value: response })
    expect(response.report.verdict).toBe('pass')
    expect({ ...response, report: { ...response.report, reportId: '<generated-report-id>' } }).toMatchSnapshot()
  })

  it.each(['missing', 'disconnected'] as const)('keeps %s provider as refused, never pass', async (scenario) => {
    const request = requestFor()
    const evaluator = scenario === 'disconnected' ? {
      async evaluate() { await Promise.resolve(); throw new Error('fixture transport disconnected') },
    } : undefined
    const response = await responseFor(request, evaluator)
    expect(response.report.verdict).toBe('refused')
    expect(parseReviewCapabilityResponse(response, request).ok).toBe(true)
  })

  it('preserves blocking semantic failures with evidence', async () => {
    const original = requestFor()
    // NARR-001 is advisory by default. This case explicitly exercises project-level blocking policy.
    const policy = { ...original.policy, rules: original.policy.rules.map((rule) => ({
      ...rule, severity: 'blocking' as const,
    })) }
    const request = { ...original, policy, ruleSetDigest: qualityRuleSetDigest(policy) }
    const response = await responseFor(request, { async evaluate(input) {
      await Promise.resolve()
      return input.rules.map((rule) => ({ ruleId: rule.id, ruleVersion: rule.version,
        verdict: 'fail', severity: rule.severity,
        evidence: [{ ruleId: rule.id, note: 'fixture failure', excerpt: body.slice(0, 2), location: { start: 0, end: 2 } }] }))
    } })
    expect(response.report.verdict).toBe('blocking_fail')
    expect(parseReviewCapabilityResponse(response, request).ok).toBe(true)
  })

  it('rejects mismatched identity, all anchors and reviewer binding', async () => {
    const request = requestFor()
    const response = await responseFor(request, passingEvaluator())
    expect(parseReviewCapabilityResponse({ ...response, requestId: 'other' }, request).ok).toBe(false)
    for (const [field, value] of Object.entries({ chapterIndex: 4, draftRevision: 2,
      draftContentHash: '0'.repeat(64), receiptId: 'other', ruleSetDigest: '0'.repeat(64) })) {
      expect(parseReviewCapabilityResponse({ ...response, report: { ...response.report,
        anchor: { ...response.report.anchor, [field]: value } } }, request).ok, field).toBe(false)
    }
    for (const field of ['model', 'providerId', 'recipeVersion']) {
      expect(parseReviewCapabilityResponse({ ...response, report: { ...response.report,
        reviewer: { ...response.report.reviewer, [field]: 'other' } } }, request).ok, field).toBe(false)
    }
  })

  it('accepts requests with valid host-constrained timeoutMs', () => {
    expect(parseReviewCapabilityRequest({ ...requestFor(), timeoutMs: 1000 }).ok).toBe(true)
    expect(parseReviewCapabilityRequest({ ...requestFor(), timeoutMs: 60000 }).ok).toBe(true)
    expect(parseReviewCapabilityRequest({ ...requestFor(), timeoutMs: 300000 }).ok).toBe(true)
  })

  it('accepts cancelled responses with optional reason or structured error', () => {
    const request = requestFor()
    const cancelledPlain: ReviewCapabilityResponse = {
      schemaVersion: 1, requestId: request.requestId, status: 'cancelled',
    }
    expect(parseReviewCapabilityResponse(cancelledPlain, request)).toEqual({ ok: true, value: cancelledPlain })

    const cancelledWithReason: ReviewCapabilityResponse = {
      schemaVersion: 1, requestId: request.requestId, status: 'cancelled',
      reason: 'user requested cancellation',
    }
    expect(parseReviewCapabilityResponse(cancelledWithReason, request)).toEqual({ ok: true, value: cancelledWithReason })

    const cancelledWithError: ReviewCapabilityResponse = {
      schemaVersion: 1, requestId: request.requestId, status: 'cancelled',
      error: { code: 'EXECUTION_TIMEOUT', message: 'Chapter review timed out' },
    }
    expect(parseReviewCapabilityResponse(cancelledWithError, request)).toEqual({ ok: true, value: cancelledWithError })

    expect(parseReviewCapabilityResponse({ ...cancelledPlain, requestId: 'other' }, request).ok).toBe(false)
    expect(parseReviewCapabilityResponse({ ...cancelledPlain, extraField: 'invalid' }, request).ok).toBe(false)
  })

  it('accepts explicit failures without pretending a report exists', () => {
    const request = requestFor()
    const response: ReviewCapabilityResponse = { schemaVersion: 1, requestId: request.requestId,
      status: 'failed', error: { code: 'NO_COMPILED_RECEIPT', message: 'fixture receipt unavailable' } }
    expect(parseReviewCapabilityResponse(response, request)).toEqual({ ok: true, value: response })
    expect(parseReviewCapabilityResponse({ ...response, report: {} }, request).ok).toBe(false)
    expect(parseReviewCapabilityResponse({ ...response, error: { code: '', message: '' } }, request).ok).toBe(false)
  })

  it('covers the actual executeChapterReview path on an isolated synthetic book', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mozhou-review-contract-'))
    temporaryRoots.push(root)
    createBook({ dir: root, title: 'contract fixture' })
    const plane = LocalDataPlane.open(root)
    try {
      plane.createChapterDraft({ chapterIndex: 3, title: '第三章' })
      const current = plane.getProseChapter(3)
      plane.saveProseDraft({ chapterIndex: 3, expectedRevision: current.revision, body })
    } finally { plane.close() }
    const input = loadDraftForReview(root, 3)
    const request = { ...requestFor(), draft: { chapterIndex: input.chapterIndex, revision: input.revision,
      body: input.body, contentHash: hashProse(input.body) } }
    expect(parseReviewCapabilityRequest(request).ok).toBe(true)
    const before = readFileSync(join(root, proseChapterPath(3)))
    const outcome = await executeChapterReview({
      bookRoot: root, chapterIndex: 3, receiptId: request.receiptId, reviewer: request.reviewer,
      policy: request.policy, failurePatterns: request.failurePatterns, semanticEvaluator: passingEvaluator(),
      actionBeatParagraphs: new Set(request.actionBeatParagraphs), mechanicalOptions: request.mechanicalOptions,
      autoHarvestQuotes: false, autoAbsorbCounterexamples: false,
    })
    const response: ReviewCapabilityResponse = { schemaVersion: 1, requestId: request.requestId, status: 'completed',
      report: outcome.report, mechanicalGate: outcome.mechanicalGate }
    expect(parseReviewCapabilityResponse(response, request).ok).toBe(true)
    expect(readFileSync(join(root, proseChapterPath(3)))).toEqual(before)
    const persisted: unknown = JSON.parse(readFileSync(join(root, outcome.reportRelPath), 'utf8'))
    expect(persisted).toEqual(outcome.report)
    expect(outcome.harvestedQuotesCount).toBe(0)
    expect(outcome.absorbedCounterexamplesCount).toBe(0)
  })

  it('keeps the published schemas portable JSON with stable versions and closed fields', () => {
    expect(JSON.parse(JSON.stringify(reviewCapabilityRequestSchema))).toEqual(reviewCapabilityRequestSchema)
    expect(JSON.parse(JSON.stringify(reviewCapabilityResponseSchema))).toEqual(reviewCapabilityResponseSchema)
    expect(reviewCapabilityRequestSchema.additionalProperties).toBe(false)
    expect(reviewCapabilityResponseSchema.anyOf.map((entry) => entry.additionalProperties)).toEqual([false, false, false])
  })
})
