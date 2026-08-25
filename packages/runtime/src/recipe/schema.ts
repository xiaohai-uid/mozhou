/**
 * Capability Recipe JSON Schema（T15 · #39，draft-07）。
 * 规格真源：docs/specs/capability-recipe-schema-v1.md §1——类型化字段全集（F1-F17 裁剪集）
 * 全部入 Schema；词表值取自 ./types.ts 常量（单一事实源）。
 * 校验引擎沿 structuredOutput 先例：ajv 实例由调用方注入（NodeNext+verbatimModuleSyntax
 * 下 ajv@8 默认导出类型互操作歧义，见 structuredOutput.test.ts 同源注释）。
 */
import {
  FAILURE_POLICIES,
  LOAD_CONDITION_TYPES,
  PRECHECK_SEVERITY_POLICIES,
  RECIPE_SCHEMA_VERSION,
  SOURCE_LICENSES,
  TRACKING_FAILURE_TAXONOMIES,
  TRACKING_HOOK_POINTS,
} from './types.js';

/**
 * 文档根 Schema。要点：
 * - additionalProperties:false 全量冻结（机器可校验正是墨舟相对上游的价值位，R2=A）；
 * - schemaVersion/compatibilityPolicy 用 const 钉死：不认识即拒（R7/R8=A）；
 * - loadCondition 四型枚举：phase/input/fallback 必须给非空 value，always 型用空串哨兵
 *   （规格 §1 value 注释只覆盖前三型的语义位，always 无条件可给，空串即显式「无条件」）；
 * - failure.repairAction 条件必填：policy=repair|failFast 时 schema if/then 强制；
 * - sizeBudget 的 target<=max 跨字段不变量 draft-07 表达不了，归 loader 语义层校验。
 */
export const CAPABILITY_RECIPE_JSON_SCHEMA: Readonly<Record<string, unknown>> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'CapabilityRecipeDocument',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'recipe', 'versioning', 'compatibilityPolicy'],
  properties: {
    schemaVersion: { const: RECIPE_SCHEMA_VERSION },
    compatibilityPolicy: { const: 'none' },
    versioning: {
      type: 'object',
      additionalProperties: false,
      required: ['schemaVersionRule', 'retiredPaths'],
      properties: {
        schemaVersionRule: { const: 'incompatible-change-requires-major-reject' },
        retiredPaths: { type: 'array', items: { $ref: '#/definitions/relPath' } },
      },
    },
    recipe: { $ref: '#/definitions/recipe' },
  },
  definitions: {
    // 相对路径：非空且不以 / 开头（允许非 ASCII 段，书内中文路径是常态）
    relPath: { type: 'string', minLength: 1, pattern: '^[^/]' },
    // F1 kebab-case
    kebabId: { type: 'string', pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$' },
    // F2 semver x.y.z（与 runtime isSemver 同形）
    semverStr: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
    // F3 commit 全 SHA 落库（短 SHA 仅展示，schema 层直接拒短串）
    fullSha: { type: 'string', pattern: '^[0-9a-f]{40}$' },
    isoDate: {
      type: 'string',
      pattern: '^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])$',
    },
    repoRef: { type: 'string', pattern: '^(?:original|[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)$' },
    identifier: { type: 'string', minLength: 1 },
    stringList: { type: 'array', items: { type: 'string', minLength: 1 } },
    failureEntry: {
      type: 'object',
      additionalProperties: false,
      required: ['policy'],
      properties: {
        policy: { enum: [...FAILURE_POLICIES] },
        repairAction: { type: 'string', minLength: 1 },
      },
      if: { properties: { policy: { enum: ['repair', 'failFast'] } }, required: ['policy'] },
      then: { required: ['repairAction'] },
    },
    loadCondition: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'value'],
      properties: {
        type: { enum: [...LOAD_CONDITION_TYPES] },
        value: { type: 'string' },
      },
      if: { properties: { type: { const: 'always' } }, required: ['type'] },
      then: { properties: { value: { type: 'string', maxLength: 0 } } },
      else: { properties: { value: { type: 'string', minLength: 1 } } },
    },
    referenceEntry: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'loadCondition', 'failure'],
      properties: {
        path: { $ref: '#/definitions/relPath' },
        loadCondition: { $ref: '#/definitions/loadCondition' },
        failure: { $ref: '#/definitions/failureEntry' },
      },
    },
    sizeBudget: {
      type: 'object',
      additionalProperties: false,
      required: ['target', 'max'],
      properties: {
        target: { type: 'integer', minimum: 1 },
        max: { type: 'integer', minimum: 1 },
      },
    },
    artifactEntry: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'granularity', 'createdPhase', 'readTiming', 'sizeBudget', 'failure'],
      properties: {
        path: { $ref: '#/definitions/relPath' },
        granularity: { $ref: '#/definitions/identifier' },
        createdPhase: { $ref: '#/definitions/identifier' },
        readTiming: { $ref: '#/definitions/identifier' },
        sizeBudget: { $ref: '#/definitions/sizeBudget' },
        failure: { $ref: '#/definitions/failureEntry' },
      },
    },
    precheckEntry: {
      type: 'object',
      additionalProperties: false,
      required: ['script', 'severityPolicy', 'retryPolicy'],
      properties: {
        script: { $ref: '#/definitions/relPath' },
        severityPolicy: { enum: [...PRECHECK_SEVERITY_POLICIES] },
        retryPolicy: {
          type: 'object',
          additionalProperties: false,
          required: ['maxBlockingRetries'],
          properties: { maxBlockingRetries: { type: 'integer', minimum: 0 } },
        },
      },
    },
    trackingGate: {
      type: 'object',
      additionalProperties: false,
      required: [
        'authorityState',
        'casField',
        'transactionModes',
        'derivedViews',
        'budgets',
        'failureTaxonomy',
        'hookPoint',
      ],
      properties: {
        authorityState: { $ref: '#/definitions/relPath' },
        casField: { $ref: '#/definitions/identifier' },
        transactionModes: {
          type: 'array',
          items: { $ref: '#/definitions/identifier' },
          minItems: 1,
        },
        derivedViews: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'path'],
            properties: {
              name: { $ref: '#/definitions/identifier' },
              path: { $ref: '#/definitions/relPath' },
            },
          },
        },
        budgets: {
          type: 'object',
          additionalProperties: false,
          required: ['hotContextBytes', 'perChapterReads'],
          properties: {
            hotContextBytes: { type: 'integer', minimum: 1 },
            perChapterReads: { $ref: '#/definitions/stringList' },
          },
        },
        failureTaxonomy: { enum: [...TRACKING_FAILURE_TAXONOMIES] },
        hookPoint: { enum: [...TRACKING_HOOK_POINTS] },
      },
    },
    contextBudget: {
      type: 'object',
      additionalProperties: false,
      required: ['hotContextBytes', 'fixedSections', 'perChapterReads'],
      properties: {
        hotContextBytes: { type: 'integer', minimum: 1 },
        fixedSections: { $ref: '#/definitions/stringList' },
        perChapterReads: { $ref: '#/definitions/stringList' },
      },
    },
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['repo', 'commit', 'license', 'refinedAt', 'refineNote'],
      properties: {
        repo: { $ref: '#/definitions/repoRef' },
        commit: { $ref: '#/definitions/fullSha' },
        license: { enum: [...SOURCE_LICENSES] },
        refinedAt: { $ref: '#/definitions/isoDate' },
        refineNote: { $ref: '#/definitions/identifier' },
      },
    },
    brief: {
      type: 'object',
      additionalProperties: false,
      required: ['capability', 'runtimeSemantics', 'triggers'],
      properties: {
        capability: { $ref: '#/definitions/identifier' },
        runtimeSemantics: { $ref: '#/definitions/identifier' },
        triggers: { $ref: '#/definitions/stringList' },
      },
    },
    entryBlock: {
      type: 'object',
      additionalProperties: false,
      required: ['routerDoc', 'phases', 'stopPoints'],
      properties: {
        routerDoc: { $ref: '#/definitions/relPath' },
        phases: { $ref: '#/definitions/stringList' },
        stopPoints: { $ref: '#/definitions/stringList' },
      },
    },
    recipe: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'recipeVersion',
        'source',
        'brief',
        'taskType',
        'entry',
        'references',
        'artifacts',
        'prechecks',
        'trackingGate',
        'contextBudget',
      ],
      properties: {
        id: { $ref: '#/definitions/kebabId' },
        recipeVersion: { $ref: '#/definitions/semverStr' },
        source: { $ref: '#/definitions/source' },
        brief: { $ref: '#/definitions/brief' },
        taskType: { $ref: '#/definitions/identifier' },
        entry: { $ref: '#/definitions/entryBlock' },
        references: { type: 'array', items: { $ref: '#/definitions/referenceEntry' } },
        artifacts: { type: 'array', items: { $ref: '#/definitions/artifactEntry' } },
        prechecks: { type: 'array', items: { $ref: '#/definitions/precheckEntry' } },
        trackingGate: { $ref: '#/definitions/trackingGate' },
        contextBudget: { $ref: '#/definitions/contextBudget' },
      },
    },
  },
};
