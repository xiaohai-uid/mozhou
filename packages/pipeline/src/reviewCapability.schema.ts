/**
 * 章节审查能力计算边界（CHG-20261005-10 / ADR-0025）。
 * 宿主负责从书根加载 draft 正文快照、核验 compiledAnchor.receiptId 编译凭证、管理生命周期、落盘报告、金句收割、反例吸收及推进 session。
 * 执行端解析审查者配置；回调、路径和凭据绝不在此契约中传输。
 * 纯 TypeScript 运行时形状校验（无 node:* 依赖）。
 */

// --- TypeScript 领域与契约类型 ---

export interface ReviewCapabilityDraft {
  readonly chapterIndex: number
  readonly revision: number
  readonly body: string
  readonly contentHash: string
}

export interface ReviewCapabilityReviewer {
  readonly providerId: string
  readonly model: string
  readonly recipeVersion: string
}

export type ReviewCapabilityRuleScope = 'platform' | 'project'
export type ReviewCapabilityRuleKind = 'deterministic' | 'semantic'
export type ReviewCapabilityRuleSeverity = 'blocking' | 'advisory'

export interface ReviewCapabilityRule {
  readonly id: string
  readonly version: string
  readonly scope: ReviewCapabilityRuleScope
  readonly kind: ReviewCapabilityRuleKind
  readonly severity: ReviewCapabilityRuleSeverity
  readonly description: string
  readonly evidenceRequired: boolean
  readonly enabled: boolean
}

export interface ReviewCapabilityPolicy {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly rules: readonly ReviewCapabilityRule[]
  readonly maxAutomaticReworks: 2
}

export type ReviewCapabilityFailurePatternCode =
  | 'outline_expansion'
  | 'character_toolization'
  | 'knowledge_overreach'
  | 'payoff_zeroed'
  | 'information_only_reward'
  | 'repeated_solution_algorithm'
  | 'forced_golden_line'
  | 'memory_anchor_misuse'
  | 'style_drift'
  | 'other'

export interface ReviewCapabilityFailurePattern {
  readonly code: ReviewCapabilityFailurePatternCode
  readonly firstSeenChapter: number
  readonly lastSeenChapter: number
  readonly occurrences: number
  readonly active: boolean
  readonly authorNote?: string
}

export interface ReviewCapabilityMechanicalOptions {
  readonly minWords?: number
  readonly maxWords?: number
  readonly customRedlines?: readonly string[]
}

export interface ReviewCapabilityRequest {
  readonly schemaVersion: 1
  readonly requestId: string
  readonly draft: ReviewCapabilityDraft
  readonly receiptId: string
  readonly ruleSetDigest: string
  readonly reviewer: ReviewCapabilityReviewer
  readonly policy: ReviewCapabilityPolicy
  readonly failurePatterns: readonly ReviewCapabilityFailurePattern[]
  readonly actionBeatParagraphs?: readonly number[]
  readonly mechanicalOptions?: ReviewCapabilityMechanicalOptions
  readonly timeoutMs?: number
}

export interface ReviewCapabilityLocation {
  readonly start: number
  readonly end: number
}

export interface ReviewCapabilityEvidence {
  readonly ruleId: string
  readonly note: string
  readonly excerpt?: string
  readonly location?: ReviewCapabilityLocation
}

export type ReviewCapabilityEvaluationVerdict = 'pass' | 'fail' | 'na' | 'unknown'

export interface ReviewCapabilityEvaluation {
  readonly ruleId: string
  readonly ruleVersion: string
  readonly verdict: ReviewCapabilityEvaluationVerdict
  readonly severity: ReviewCapabilityRuleSeverity
  readonly evidence: readonly ReviewCapabilityEvidence[]
}

export interface ReviewCapabilityAnchor {
  readonly chapterIndex: number
  readonly draftRevision: number
  readonly draftContentHash: string
  readonly receiptId: string
  readonly ruleSetDigest: string
}

export type ReviewCapabilityReportVerdict = 'pass' | 'blocking_fail' | 'refused'

export interface ReviewCapabilityReport {
  readonly schemaVersion: 1
  readonly reportId: string
  readonly reviewer: ReviewCapabilityReviewer
  readonly anchor: ReviewCapabilityAnchor
  readonly evaluations: readonly ReviewCapabilityEvaluation[]
  readonly verdict: ReviewCapabilityReportVerdict
}

export interface ReviewCapabilityMechanicalCheck {
  readonly id: string
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}

export interface ReviewCapabilityMechanicalGate {
  readonly passed: boolean
  readonly checks: readonly ReviewCapabilityMechanicalCheck[]
  readonly fails: readonly string[]
  readonly oks: readonly string[]
}

export interface ReviewCapabilityError {
  readonly code: string
  readonly message: string
  readonly details?: string
}

export interface ReviewCapabilityCompletedResponse {
  readonly schemaVersion: 1
  readonly requestId: string
  readonly status: 'completed'
  readonly report: ReviewCapabilityReport
  readonly mechanicalGate: ReviewCapabilityMechanicalGate
}

export interface ReviewCapabilityFailedResponse {
  readonly schemaVersion: 1
  readonly requestId: string
  readonly status: 'failed'
  readonly error: ReviewCapabilityError
}

export interface ReviewCapabilityCancelledResponse {
  readonly schemaVersion: 1
  readonly requestId: string
  readonly status: 'cancelled'
  readonly reason?: string
  readonly error?: ReviewCapabilityError
}

export type ReviewCapabilityResponse =
  | ReviewCapabilityCompletedResponse
  | ReviewCapabilityFailedResponse
  | ReviewCapabilityCancelledResponse

export interface ReviewContractIssue {
  readonly path: string
  readonly message: string
}

export type ReviewContractResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ReviewContractIssue[] }

// --- 便携式 JSON Schema 常量 ---

const text = { type: 'string', minLength: 1 } as const
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' } as const
const count = { type: 'integer', minimum: 0 } as const
const chapter = { type: 'integer', minimum: 1 } as const
const timeoutMs = { type: 'integer', minimum: 1000, maximum: 300000 } as const

const reviewerSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['providerId', 'model', 'recipeVersion'],
  properties: {
    providerId: text,
    model: text,
    recipeVersion: text,
  },
} as const

const ruleSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'version', 'scope', 'kind', 'severity', 'description', 'evidenceRequired', 'enabled'],
  properties: {
    id: text,
    version: text,
    scope: { enum: ['platform', 'project'] },
    kind: { enum: ['deterministic', 'semantic'] },
    severity: { enum: ['blocking', 'advisory'] },
    description: text,
    evidenceRequired: { type: 'boolean' },
    enabled: { type: 'boolean' },
  },
} as const

const failurePatternSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'firstSeenChapter', 'lastSeenChapter', 'occurrences', 'active'],
  properties: {
    code: {
      enum: [
        'outline_expansion',
        'character_toolization',
        'knowledge_overreach',
        'payoff_zeroed',
        'information_only_reward',
        'repeated_solution_algorithm',
        'forced_golden_line',
        'memory_anchor_misuse',
        'style_drift',
        'other',
      ],
    },
    firstSeenChapter: chapter,
    lastSeenChapter: chapter,
    occurrences: count,
    active: { type: 'boolean' },
    authorNote: { type: 'string' },
  },
} as const

const evidenceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ruleId', 'note'],
  properties: {
    ruleId: text,
    note: { type: 'string' },
    excerpt: { type: 'string' },
    location: {
      type: 'object',
      additionalProperties: false,
      required: ['start', 'end'],
      properties: { start: count, end: count },
    },
  },
} as const

const evaluationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ruleId', 'ruleVersion', 'verdict', 'severity', 'evidence'],
  properties: {
    ruleId: text,
    ruleVersion: text,
    verdict: { enum: ['pass', 'fail', 'na', 'unknown'] },
    severity: { enum: ['blocking', 'advisory'] },
    evidence: { type: 'array', items: evidenceSchema },
  },
} as const

const errorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'message'],
  properties: {
    code: text,
    message: text,
    details: { type: 'string' },
  },
} as const

export const reviewCapabilityRequestSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'ReviewCapabilityRequest',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'requestId',
    'draft',
    'receiptId',
    'ruleSetDigest',
    'reviewer',
    'policy',
    'failurePatterns',
  ],
  properties: {
    schemaVersion: { const: 1 },
    requestId: text,
    draft: {
      type: 'object',
      additionalProperties: false,
      required: ['chapterIndex', 'revision', 'body', 'contentHash'],
      properties: {
        chapterIndex: chapter,
        revision: count,
        body: { type: 'string' },
        contentHash: hash,
      },
    },
    receiptId: text,
    ruleSetDigest: hash,
    reviewer: reviewerSchema,
    policy: {
      type: 'object',
      additionalProperties: false,
      required: ['schemaVersion', 'projectId', 'rules', 'maxAutomaticReworks'],
      properties: {
        schemaVersion: { const: 1 },
        projectId: text,
        rules: { type: 'array', items: ruleSchema },
        maxAutomaticReworks: { const: 2 },
      },
    },
    failurePatterns: { type: 'array', items: failurePatternSchema },
    actionBeatParagraphs: { type: 'array', items: count, uniqueItems: true },
    mechanicalOptions: {
      type: 'object',
      additionalProperties: false,
      properties: {
        minWords: count,
        maxWords: count,
        customRedlines: { type: 'array', items: text },
      },
    },
    timeoutMs,
  },
} as const

export const reviewCapabilityResponseSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'ReviewCapabilityResponse',
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['schemaVersion', 'requestId', 'status', 'report', 'mechanicalGate'],
      properties: {
        schemaVersion: { const: 1 },
        requestId: text,
        status: { const: 'completed' },
        report: {
          type: 'object',
          additionalProperties: false,
          required: ['schemaVersion', 'reportId', 'anchor', 'reviewer', 'evaluations', 'verdict'],
          properties: {
            schemaVersion: { const: 1 },
            reportId: text,
            reviewer: reviewerSchema,
            anchor: {
              type: 'object',
              additionalProperties: false,
              required: ['chapterIndex', 'draftRevision', 'draftContentHash', 'receiptId', 'ruleSetDigest'],
              properties: {
                chapterIndex: chapter,
                draftRevision: count,
                draftContentHash: hash,
                receiptId: text,
                ruleSetDigest: hash,
              },
            },
            evaluations: { type: 'array', items: evaluationSchema },
            verdict: { enum: ['pass', 'blocking_fail', 'refused'] },
          },
        },
        mechanicalGate: {
          type: 'object',
          additionalProperties: false,
          required: ['passed', 'checks', 'fails', 'oks'],
          properties: {
            passed: { type: 'boolean' },
            checks: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'name', 'ok', 'detail'],
                properties: {
                  id: text,
                  name: text,
                  ok: { type: 'boolean' },
                  detail: { type: 'string' },
                },
              },
            },
            fails: { type: 'array', items: { type: 'string' } },
            oks: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['schemaVersion', 'requestId', 'status', 'error'],
      properties: {
        schemaVersion: { const: 1 },
        requestId: text,
        status: { const: 'failed' },
        error: errorSchema,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['schemaVersion', 'requestId', 'status'],
      properties: {
        schemaVersion: { const: 1 },
        requestId: text,
        status: { const: 'cancelled' },
        reason: { type: 'string' },
        error: errorSchema,
      },
    },
  ],
} as const

// --- 运行时类型守卫与校验器（Browser-Safe） ---

function getPlainObject(
  value: unknown,
  path: string,
  issues: ReviewContractIssue[],
): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    issues.push({ path, message: '必须为 JSON 对象' })
    return null
  }
  const proto: unknown = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    issues.push({ path, message: '不可传内部实例' })
    return null
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    issues.push({ path, message: '不可传 Symbol 字段' })
    return null
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const result: Record<string, unknown> = {}
  for (const [key, desc] of Object.entries(descriptors)) {
    if (key === '__proto__') {
      issues.push({ path: `${path}.__proto__`, message: '不允许额外字段' })
      return null
    }
    if (!desc.enumerable || !('value' in desc)) {
      issues.push({ path: `${path}.${key}`, message: '不可传访问器或不可枚举字段' })
      return null
    }
    result[key] = desc.value
  }
  return result
}

function getPlainArray(
  value: unknown,
  path: string,
  issues: ReviewContractIssue[],
): unknown[] | null {
  if (!Array.isArray(value)) {
    issues.push({ path, message: '必须为数组' })
    return null
  }
  const arrayProto: unknown = Object.getPrototypeOf(value)
  if (arrayProto !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) {
    issues.push({ path, message: '必须为普通 JSON 数组' })
    return null
  }
  const names = Object.getOwnPropertyNames(value)
  for (const name of names) {
    if (name === 'length') continue
    const desc = Object.getOwnPropertyDescriptor(value, name)
    if (!/^(0|[1-9][0-9]*)$/.test(name) || !desc?.enumerable || !('value' in desc)) {
      issues.push({ path, message: '数组不能含额外字段或访问器' })
      return null
    }
  }
  for (let i = 0; i < value.length; i++) {
    if (!Object.hasOwn(value, i)) {
      issues.push({ path, message: '数组不能含空洞' })
      return null
    }
  }
  return value as unknown[]
}

function checkRequired(
  record: Record<string, unknown>,
  required: readonly string[],
  path: string,
  issues: ReviewContractIssue[],
): void {
  for (const key of required) {
    if (!Object.hasOwn(record, key)) {
      issues.push({ path: `${path}.${key}`, message: '缺少必填字段' })
    }
  }
}

function checkNoExtra(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: ReviewContractIssue[],
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      issues.push({ path: `${path}.${key}`, message: '不允许额外字段' })
    }
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function isCount(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0
}

function isChapterIndex(value: unknown): value is number {
  return isSafeInteger(value) && value >= 1
}

const reviewerKeys = new Set(['providerId', 'model', 'recipeVersion'])

function validateReviewer(
  value: unknown,
  path: string,
  issues: ReviewContractIssue[],
): ReviewCapabilityReviewer | null {
  const obj = getPlainObject(value, path, issues)
  if (!obj) return null
  checkRequired(obj, ['providerId', 'model', 'recipeVersion'], path, issues)
  checkNoExtra(obj, reviewerKeys, path, issues)
  if (!isNonEmptyString(obj['providerId'])) issues.push({ path: `${path}.providerId`, message: '必须为非空字符串' })
  if (!isNonEmptyString(obj['model'])) issues.push({ path: `${path}.model`, message: '必须为非空字符串' })
  if (!isNonEmptyString(obj['recipeVersion'])) issues.push({ path: `${path}.recipeVersion`, message: '必须为非空字符串' })
  return obj as unknown as ReviewCapabilityReviewer
}

const draftKeys = new Set(['chapterIndex', 'revision', 'body', 'contentHash'])

function validateDraft(
  value: unknown,
  path: string,
  issues: ReviewContractIssue[],
): ReviewCapabilityDraft | null {
  const obj = getPlainObject(value, path, issues)
  if (!obj) return null
  checkRequired(obj, ['chapterIndex', 'revision', 'body', 'contentHash'], path, issues)
  checkNoExtra(obj, draftKeys, path, issues)
  if (!isChapterIndex(obj['chapterIndex'])) issues.push({ path: `${path}.chapterIndex`, message: '必须为正整数' })
  if (!isCount(obj['revision'])) issues.push({ path: `${path}.revision`, message: '必须为非负安全整数' })
  if (typeof obj['body'] !== 'string') issues.push({ path: `${path}.body`, message: '必须为字符串' })
  if (!isHash(obj['contentHash'])) issues.push({ path: `${path}.contentHash`, message: '必须为有效 SHA-256 哈希' })
  return obj as unknown as ReviewCapabilityDraft
}

const ruleKeys = new Set(['id', 'version', 'scope', 'kind', 'severity', 'description', 'evidenceRequired', 'enabled'])

function validateRule(
  value: unknown,
  path: string,
  issues: ReviewContractIssue[],
): ReviewCapabilityRule | null {
  const obj = getPlainObject(value, path, issues)
  if (!obj) return null
  checkRequired(obj, ['id', 'version', 'scope', 'kind', 'severity', 'description', 'evidenceRequired', 'enabled'], path, issues)
  checkNoExtra(obj, ruleKeys, path, issues)
  if (!isNonEmptyString(obj['id'])) issues.push({ path: `${path}.id`, message: '必须为非空字符串' })
  if (!isNonEmptyString(obj['version'])) issues.push({ path: `${path}.version`, message: '必须为非空字符串' })
  if (obj['scope'] !== 'platform' && obj['scope'] !== 'project') issues.push({ path: `${path}.scope`, message: '作用域枚举不匹配' })
  if (obj['kind'] !== 'deterministic' && obj['kind'] !== 'semantic') issues.push({ path: `${path}.kind`, message: '类型枚举不匹配' })
  if (obj['severity'] !== 'blocking' && obj['severity'] !== 'advisory') issues.push({ path: `${path}.severity`, message: '严重度枚举不匹配' })
  if (!isNonEmptyString(obj['description'])) issues.push({ path: `${path}.description`, message: '必须为非空字符串' })
  if (typeof obj['evidenceRequired'] !== 'boolean') issues.push({ path: `${path}.evidenceRequired`, message: '必须为布尔值' })
  if (typeof obj['enabled'] !== 'boolean') issues.push({ path: `${path}.enabled`, message: '必须为布尔值' })
  return obj as unknown as ReviewCapabilityRule
}

const policyKeys = new Set(['schemaVersion', 'projectId', 'rules', 'maxAutomaticReworks'])

function validatePolicy(
  value: unknown,
  path: string,
  issues: ReviewContractIssue[],
): ReviewCapabilityPolicy | null {
  const obj = getPlainObject(value, path, issues)
  if (!obj) return null
  checkRequired(obj, ['schemaVersion', 'projectId', 'rules', 'maxAutomaticReworks'], path, issues)
  checkNoExtra(obj, policyKeys, path, issues)
  if (obj['schemaVersion'] !== 1) issues.push({ path: `${path}.schemaVersion`, message: '协议版本必须为 1' })
  if (!isNonEmptyString(obj['projectId'])) issues.push({ path: `${path}.projectId`, message: '必须为非空字符串' })
  if (obj['maxAutomaticReworks'] !== 2) issues.push({ path: `${path}.maxAutomaticReworks`, message: '最大自动重做次数必须为 2' })
  const rulesArr = getPlainArray(obj['rules'], `${path}.rules`, issues)
  if (rulesArr) {
    const seenIds = new Set<string>()
    for (let i = 0; i < rulesArr.length; i++) {
      const r = validateRule(rulesArr[i], `${path}.rules[${i}]`, issues)
      if (r && isNonEmptyString(r.id)) {
        if (seenIds.has(r.id)) {
          issues.push({ path: `${path}.rules`, message: '规则 id 重复' })
        }
        seenIds.add(r.id)
      }
    }
  }
  return obj as unknown as ReviewCapabilityPolicy
}

const failurePatternCodes = new Set([
  'outline_expansion',
  'character_toolization',
  'knowledge_overreach',
  'payoff_zeroed',
  'information_only_reward',
  'repeated_solution_algorithm',
  'forced_golden_line',
  'memory_anchor_misuse',
  'style_drift',
  'other',
])
const failurePatternKeys = new Set(['code', 'firstSeenChapter', 'lastSeenChapter', 'occurrences', 'active', 'authorNote'])

function validateFailurePattern(
  value: unknown,
  path: string,
  issues: ReviewContractIssue[],
): ReviewCapabilityFailurePattern | null {
  const obj = getPlainObject(value, path, issues)
  if (!obj) return null
  checkRequired(obj, ['code', 'firstSeenChapter', 'lastSeenChapter', 'occurrences', 'active'], path, issues)
  checkNoExtra(obj, failurePatternKeys, path, issues)
  if (typeof obj['code'] !== 'string' || !failurePatternCodes.has(obj['code'])) {
    issues.push({ path: `${path}.code`, message: '失败模式代码无效' })
  }
  const first = obj['firstSeenChapter']
  const last = obj['lastSeenChapter']
  if (!isChapterIndex(first)) issues.push({ path: `${path}.firstSeenChapter`, message: '必须为正整数' })
  if (!isChapterIndex(last)) issues.push({ path: `${path}.lastSeenChapter`, message: '必须为正整数' })
  if (isChapterIndex(first) && isChapterIndex(last) && first > last) {
    issues.push({ path, message: '失败模式章范围颠倒' })
  }
  if (!isCount(obj['occurrences'])) issues.push({ path: `${path}.occurrences`, message: '必须为非负安全整数' })
  if (typeof obj['active'] !== 'boolean') issues.push({ path: `${path}.active`, message: '必须为布尔值' })
  if (Object.hasOwn(obj, 'authorNote') && typeof obj['authorNote'] !== 'string') {
    issues.push({ path: `${path}.authorNote`, message: '必须为字符串' })
  }
  return obj as unknown as ReviewCapabilityFailurePattern
}

const mechanicalOptionKeys = new Set(['minWords', 'maxWords', 'customRedlines'])

function validateMechanicalOptions(
  value: unknown,
  path: string,
  issues: ReviewContractIssue[],
): ReviewCapabilityMechanicalOptions | null {
  const obj = getPlainObject(value, path, issues)
  if (!obj) return null
  checkNoExtra(obj, mechanicalOptionKeys, path, issues)
  const minWords = obj['minWords']
  const maxWords = obj['maxWords']
  if (Object.hasOwn(obj, 'minWords')) {
    if (!isCount(minWords)) issues.push({ path: `${path}.minWords`, message: '必须为非负整数' })
  }
  if (Object.hasOwn(obj, 'maxWords')) {
    if (!isCount(maxWords)) issues.push({ path: `${path}.maxWords`, message: '必须为非负整数' })
  }
  if (isCount(minWords) && isCount(maxWords) && minWords > maxWords) {
    issues.push({ path, message: '字数窗口顺序颠倒' })
  }
  if (Object.hasOwn(obj, 'customRedlines')) {
    const redlines = getPlainArray(obj['customRedlines'], `${path}.customRedlines`, issues)
    if (redlines) {
      for (let i = 0; i < redlines.length; i++) {
        if (!isNonEmptyString(redlines[i])) {
          issues.push({ path: `${path}.customRedlines[${i}]`, message: '必须为非空字符串' })
        }
      }
    }
  }
  return obj
}

const requestKeys = new Set([
  'schemaVersion',
  'requestId',
  'draft',
  'receiptId',
  'ruleSetDigest',
  'reviewer',
  'policy',
  'failurePatterns',
  'actionBeatParagraphs',
  'mechanicalOptions',
  'timeoutMs',
])

export function parseReviewCapabilityRequest(value: unknown): ReviewContractResult<ReviewCapabilityRequest> {
  const issues: ReviewContractIssue[] = []
  const obj = getPlainObject(value, '$', issues)
  if (!obj) return { ok: false, issues }

  checkRequired(
    obj,
    ['schemaVersion', 'requestId', 'draft', 'receiptId', 'ruleSetDigest', 'reviewer', 'policy', 'failurePatterns'],
    '$',
    issues,
  )
  checkNoExtra(obj, requestKeys, '$', issues)

  if (obj['schemaVersion'] !== 1) issues.push({ path: '$.schemaVersion', message: '协议版本必须为 1' })
  if (!isNonEmptyString(obj['requestId'])) issues.push({ path: '$.requestId', message: '必须为非空字符串' })
  if (!isNonEmptyString(obj['receiptId'])) issues.push({ path: '$.receiptId', message: '必须为非空字符串' })
  if (!isHash(obj['ruleSetDigest'])) issues.push({ path: '$.ruleSetDigest', message: '必须为有效 SHA-256 哈希' })

  if (Object.hasOwn(obj, 'draft')) validateDraft(obj['draft'], '$.draft', issues)
  if (Object.hasOwn(obj, 'reviewer')) validateReviewer(obj['reviewer'], '$.reviewer', issues)
  if (Object.hasOwn(obj, 'policy')) validatePolicy(obj['policy'], '$.policy', issues)

  if (Object.hasOwn(obj, 'failurePatterns')) {
    const patterns = getPlainArray(obj['failurePatterns'], '$.failurePatterns', issues)
    if (patterns) {
      for (let i = 0; i < patterns.length; i++) {
        validateFailurePattern(patterns[i], `$.failurePatterns[${i}]`, issues)
      }
    }
  }

  if (Object.hasOwn(obj, 'actionBeatParagraphs')) {
    const beats = getPlainArray(obj['actionBeatParagraphs'], '$.actionBeatParagraphs', issues)
    if (beats) {
      const seen = new Set<number>()
      for (let i = 0; i < beats.length; i++) {
        const beat = beats[i]
        if (!isCount(beat)) {
          issues.push({ path: `$.actionBeatParagraphs[${i}]`, message: '必须为非负整数' })
        } else {
          if (seen.has(beat)) {
            issues.push({ path: '$.actionBeatParagraphs', message: '数组项不可重复' })
          }
          seen.add(beat)
        }
      }
    }
  }

  if (Object.hasOwn(obj, 'mechanicalOptions')) {
    validateMechanicalOptions(obj['mechanicalOptions'], '$.mechanicalOptions', issues)
  }

  if (Object.hasOwn(obj, 'timeoutMs')) {
    const timeout = obj['timeoutMs']
    if (!isSafeInteger(timeout) || timeout < 1000 || timeout > 300000) {
      issues.push({ path: '$.timeoutMs', message: '超时时间超出允许范围 (1000~300000 毫秒)' })
    }
  }

  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, value: obj as unknown as ReviewCapabilityRequest }
}

const evidenceKeys = new Set(['ruleId', 'note', 'excerpt', 'location'])
const locationKeys = new Set(['start', 'end'])

function validateEvidence(
  value: unknown,
  path: string,
  issues: ReviewContractIssue[],
): ReviewCapabilityEvidence | null {
  const obj = getPlainObject(value, path, issues)
  if (!obj) return null
  checkRequired(obj, ['ruleId', 'note'], path, issues)
  checkNoExtra(obj, evidenceKeys, path, issues)
  if (!isNonEmptyString(obj['ruleId'])) issues.push({ path: `${path}.ruleId`, message: '必须为非空字符串' })
  if (typeof obj['note'] !== 'string') issues.push({ path: `${path}.note`, message: '必须为字符串' })
  if (Object.hasOwn(obj, 'excerpt') && typeof obj['excerpt'] !== 'string') {
    issues.push({ path: `${path}.excerpt`, message: '必须为字符串' })
  }
  if (Object.hasOwn(obj, 'location')) {
    const loc = getPlainObject(obj['location'], `${path}.location`, issues)
    if (loc) {
      checkRequired(loc, ['start', 'end'], `${path}.location`, issues)
      checkNoExtra(loc, locationKeys, `${path}.location`, issues)
      const start = loc['start']
      const end = loc['end']
      if (!isCount(start)) issues.push({ path: `${path}.location.start`, message: '必须为非负整数' })
      if (!isCount(end)) issues.push({ path: `${path}.location.end`, message: '必须为非负整数' })
      if (isCount(start) && isCount(end) && start > end) {
        issues.push({ path: `${path}.location`, message: '起止位置顺序颠倒' })
      }
    }
  }
  return obj as unknown as ReviewCapabilityEvidence
}

const evaluationKeys = new Set(['ruleId', 'ruleVersion', 'verdict', 'severity', 'evidence'])
const evaluationVerdicts = new Set(['pass', 'fail', 'na', 'unknown'])

function validateEvaluation(
  value: unknown,
  path: string,
  issues: ReviewContractIssue[],
): ReviewCapabilityEvaluation | null {
  const obj = getPlainObject(value, path, issues)
  if (!obj) return null
  checkRequired(obj, ['ruleId', 'ruleVersion', 'verdict', 'severity', 'evidence'], path, issues)
  checkNoExtra(obj, evaluationKeys, path, issues)
  if (!isNonEmptyString(obj['ruleId'])) issues.push({ path: `${path}.ruleId`, message: '必须为非空字符串' })
  if (!isNonEmptyString(obj['ruleVersion'])) issues.push({ path: `${path}.ruleVersion`, message: '必须为非空字符串' })
  if (typeof obj['verdict'] !== 'string' || !evaluationVerdicts.has(obj['verdict'])) {
    issues.push({ path: `${path}.verdict`, message: '结论枚举不匹配' })
  }
  if (obj['severity'] !== 'blocking' && obj['severity'] !== 'advisory') {
    issues.push({ path: `${path}.severity`, message: '严重度枚举不匹配' })
  }
  const evidenceArr = getPlainArray(obj['evidence'], `${path}.evidence`, issues)
  if (evidenceArr) {
    for (let i = 0; i < evidenceArr.length; i++) {
      validateEvidence(evidenceArr[i], `${path}.evidence[${i}]`, issues)
    }
  }
  return obj as unknown as ReviewCapabilityEvaluation
}

const anchorKeys = new Set(['chapterIndex', 'draftRevision', 'draftContentHash', 'receiptId', 'ruleSetDigest'])

function validateAnchor(
  value: unknown,
  path: string,
  issues: ReviewContractIssue[],
): ReviewCapabilityAnchor | null {
  const obj = getPlainObject(value, path, issues)
  if (!obj) return null
  checkRequired(obj, ['chapterIndex', 'draftRevision', 'draftContentHash', 'receiptId', 'ruleSetDigest'], path, issues)
  checkNoExtra(obj, anchorKeys, path, issues)
  if (!isChapterIndex(obj['chapterIndex'])) issues.push({ path: `${path}.chapterIndex`, message: '必须为正整数' })
  if (!isCount(obj['draftRevision'])) issues.push({ path: `${path}.draftRevision`, message: '必须为非负安全整数' })
  if (!isHash(obj['draftContentHash'])) issues.push({ path: `${path}.draftContentHash`, message: '必须为有效 SHA-256 哈希' })
  if (!isNonEmptyString(obj['receiptId'])) issues.push({ path: `${path}.receiptId`, message: '必须为非空字符串' })
  if (!isHash(obj['ruleSetDigest'])) issues.push({ path: `${path}.ruleSetDigest`, message: '必须为有效 SHA-256 哈希' })
  return obj as unknown as ReviewCapabilityAnchor
}

const reportKeys = new Set(['schemaVersion', 'reportId', 'reviewer', 'anchor', 'evaluations', 'verdict'])
const reportVerdicts = new Set(['pass', 'blocking_fail', 'refused'])

function validateReport(
  value: unknown,
  path: string,
  issues: ReviewContractIssue[],
): ReviewCapabilityReport | null {
  const obj = getPlainObject(value, path, issues)
  if (!obj) return null
  checkRequired(obj, ['schemaVersion', 'reportId', 'reviewer', 'anchor', 'evaluations', 'verdict'], path, issues)
  checkNoExtra(obj, reportKeys, path, issues)
  if (obj['schemaVersion'] !== 1) issues.push({ path: `${path}.schemaVersion`, message: '协议版本必须为 1' })
  if (!isNonEmptyString(obj['reportId'])) issues.push({ path: `${path}.reportId`, message: '必须为非空字符串' })
  if (Object.hasOwn(obj, 'reviewer')) validateReviewer(obj['reviewer'], `${path}.reviewer`, issues)
  if (Object.hasOwn(obj, 'anchor')) validateAnchor(obj['anchor'], `${path}.anchor`, issues)
  if (typeof obj['verdict'] !== 'string' || !reportVerdicts.has(obj['verdict'])) {
    issues.push({ path: `${path}.verdict`, message: '报告结论枚举不匹配' })
  }
  const evalArr = getPlainArray(obj['evaluations'], `${path}.evaluations`, issues)
  if (evalArr) {
    for (let i = 0; i < evalArr.length; i++) {
      validateEvaluation(evalArr[i], `${path}.evaluations[${i}]`, issues)
    }
  }
  return obj as unknown as ReviewCapabilityReport
}

const mechanicalGateKeys = new Set(['passed', 'checks', 'fails', 'oks'])
const mechanicalCheckKeys = new Set(['id', 'name', 'ok', 'detail'])

function validateMechanicalGate(
  value: unknown,
  path: string,
  issues: ReviewContractIssue[],
): ReviewCapabilityMechanicalGate | null {
  const obj = getPlainObject(value, path, issues)
  if (!obj) return null
  checkRequired(obj, ['passed', 'checks', 'fails', 'oks'], path, issues)
  checkNoExtra(obj, mechanicalGateKeys, path, issues)
  if (typeof obj['passed'] !== 'boolean') issues.push({ path: `${path}.passed`, message: '必须为布尔值' })
  const checksArr = getPlainArray(obj['checks'], `${path}.checks`, issues)
  if (checksArr) {
    for (let i = 0; i < checksArr.length; i++) {
      const checkObj = getPlainObject(checksArr[i], `${path}.checks[${i}]`, issues)
      if (checkObj) {
        checkRequired(checkObj, ['id', 'name', 'ok', 'detail'], `${path}.checks[${i}]`, issues)
        checkNoExtra(checkObj, mechanicalCheckKeys, `${path}.checks[${i}]`, issues)
        if (!isNonEmptyString(checkObj['id'])) issues.push({ path: `${path}.checks[${i}].id`, message: '必须为非空字符串' })
        if (!isNonEmptyString(checkObj['name'])) issues.push({ path: `${path}.checks[${i}].name`, message: '必须为非空字符串' })
        if (typeof checkObj['ok'] !== 'boolean') issues.push({ path: `${path}.checks[${i}].ok`, message: '必须为布尔值' })
        if (typeof checkObj['detail'] !== 'string') issues.push({ path: `${path}.checks[${i}].detail`, message: '必须为字符串' })
      }
    }
  }
  const failsArr = getPlainArray(obj['fails'], `${path}.fails`, issues)
  if (failsArr) {
    for (let i = 0; i < failsArr.length; i++) {
      if (typeof failsArr[i] !== 'string') issues.push({ path: `${path}.fails[${i}]`, message: '必须为字符串' })
    }
  }
  const oksArr = getPlainArray(obj['oks'], `${path}.oks`, issues)
  if (oksArr) {
    for (let i = 0; i < oksArr.length; i++) {
      if (typeof oksArr[i] !== 'string') issues.push({ path: `${path}.oks[${i}]`, message: '必须为字符串' })
    }
  }
  return obj as unknown as ReviewCapabilityMechanicalGate
}

const errorKeys = new Set(['code', 'message', 'details'])

function validateError(
  value: unknown,
  path: string,
  issues: ReviewContractIssue[],
): ReviewCapabilityError | null {
  const obj = getPlainObject(value, path, issues)
  if (!obj) return null
  checkRequired(obj, ['code', 'message'], path, issues)
  checkNoExtra(obj, errorKeys, path, issues)
  if (!isNonEmptyString(obj['code'])) issues.push({ path: `${path}.code`, message: '必须为非空字符串' })
  if (!isNonEmptyString(obj['message'])) issues.push({ path: `${path}.message`, message: '必须为非空字符串' })
  if (Object.hasOwn(obj, 'details') && typeof obj['details'] !== 'string') {
    issues.push({ path: `${path}.details`, message: '必须为字符串' })
  }
  return obj as unknown as ReviewCapabilityError
}

const completedResponseKeys = new Set(['schemaVersion', 'requestId', 'status', 'report', 'mechanicalGate'])
const failedResponseKeys = new Set(['schemaVersion', 'requestId', 'status', 'error'])
const cancelledResponseKeys = new Set(['schemaVersion', 'requestId', 'status', 'reason', 'error'])

export function parseReviewCapabilityResponse(
  value: unknown,
  request?: ReviewCapabilityRequest,
): ReviewContractResult<ReviewCapabilityResponse> {
  const issues: ReviewContractIssue[] = []
  const obj = getPlainObject(value, '$', issues)
  if (!obj) return { ok: false, issues }

  const status = obj['status']
  if (status !== 'completed' && status !== 'failed' && status !== 'cancelled') {
    issues.push({ path: '$.status', message: '状态必须为 completed / failed / cancelled' })
    return { ok: false, issues }
  }

  if (obj['schemaVersion'] !== 1) issues.push({ path: '$.schemaVersion', message: '协议版本必须为 1' })
  if (!isNonEmptyString(obj['requestId'])) issues.push({ path: '$.requestId', message: '必须为非空字符串' })

  if (request && isNonEmptyString(obj['requestId']) && obj['requestId'] !== request.requestId) {
    issues.push({ path: '$.requestId', message: '请求标识不匹配' })
  }

  if (status === 'completed') {
    checkRequired(obj, ['schemaVersion', 'requestId', 'status', 'report', 'mechanicalGate'], '$', issues)
    checkNoExtra(obj, completedResponseKeys, '$', issues)
    let report: ReviewCapabilityReport | null = null
    if (Object.hasOwn(obj, 'report')) {
      report = validateReport(obj['report'], '$.report', issues)
    }
    if (Object.hasOwn(obj, 'mechanicalGate')) {
      validateMechanicalGate(obj['mechanicalGate'], '$.mechanicalGate', issues)
    }

    if (request && report) {
      const anchor = report.anchor
      if (anchor) {
        if (anchor.chapterIndex !== request.draft.chapterIndex) {
          issues.push({ path: '$.report.anchor.chapterIndex', message: '版本锚点不匹配' })
        }
        if (anchor.draftRevision !== request.draft.revision) {
          issues.push({ path: '$.report.anchor.draftRevision', message: '版本锚点不匹配' })
        }
        if (anchor.draftContentHash !== request.draft.contentHash) {
          issues.push({ path: '$.report.anchor.draftContentHash', message: '版本锚点不匹配' })
        }
        if (anchor.receiptId !== request.receiptId) {
          issues.push({ path: '$.report.anchor.receiptId', message: '版本锚点不匹配' })
        }
        if (anchor.ruleSetDigest !== request.ruleSetDigest) {
          issues.push({ path: '$.report.anchor.ruleSetDigest', message: '版本锚点不匹配' })
        }
      }
      const reviewer = report.reviewer
      if (reviewer) {
        if (reviewer.providerId !== request.reviewer.providerId) {
          issues.push({ path: '$.report.reviewer.providerId', message: '审查者绑定不匹配' })
        }
        if (reviewer.model !== request.reviewer.model) {
          issues.push({ path: '$.report.reviewer.model', message: '审查者绑定不匹配' })
        }
        if (reviewer.recipeVersion !== request.reviewer.recipeVersion) {
          issues.push({ path: '$.report.reviewer.recipeVersion', message: '审查者绑定不匹配' })
        }
      }
    }
  } else if (status === 'failed') {
    checkRequired(obj, ['schemaVersion', 'requestId', 'status', 'error'], '$', issues)
    checkNoExtra(obj, failedResponseKeys, '$', issues)
    if (Object.hasOwn(obj, 'error')) {
      validateError(obj['error'], '$.error', issues)
    }
  } else if (status === 'cancelled') {
    checkRequired(obj, ['schemaVersion', 'requestId', 'status'], '$', issues)
    checkNoExtra(obj, cancelledResponseKeys, '$', issues)
    if (Object.hasOwn(obj, 'reason') && typeof obj['reason'] !== 'string') {
      issues.push({ path: '$.reason', message: '必须为字符串' })
    }
    if (Object.hasOwn(obj, 'error')) {
      validateError(obj['error'], '$.error', issues)
    }
  }

  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, value: obj as unknown as ReviewCapabilityResponse }
}
