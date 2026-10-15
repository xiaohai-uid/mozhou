/**
 * 策略飞轮与模型评估路由（CHG-20261006-06）。
 *
 * 职责：
 * 1. 作者偏好画像读取与重建：/api/flywheel.preference, /api/flywheel.preference.rebuild；
 * 2. 模型路由建议读取与评估运行：/api/flywheel.suggestions, /api/flywheel.evaluator.status, /api/flywheel.evaluator.run；
 * 3. 严格不变量（C6）：只建议，不自动改变模型路由（绝不自动写 settings.yaml）。
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { RouteHandler } from '../router.js'
import { decodeBookRequest } from '../bookRequest.js'
import {
  EVAL_MIN_CHAPTER_WINDOWS,
  EVAL_MIN_DECISIONS,
  PREFERENCE_DIMS,
  hasMaterializedProfile,
  loadProfileOrColdStart,
  posteriorMean,
  readPersistedObservations,
  readSuggestions,
  rebuildPreference,
  runTaskModelEvaluation,
} from '@mozhou/flywheel'
import type { PreferenceProfileState } from '@mozhou/flywheel'
import { readPipelineLedger } from '@mozhou/pipeline'
import { atomicWriteFileSync } from '@mozhou/data-plane'
import { tierConfigPath as defaultTierConfigPath } from '../llm/tierRouting.js'

/** 最小合法 Tier 配置模板（用于冷启动或未配置 settings.yaml 时的自愈回退）。 */
const DEFAULT_FALLBACK_TIER_YAML = `
providers:
  deepseek:
    baseURL: "https://api.deepseek.com"
    apiKeyEnv: "DEEPSEEK_API_KEY"
routes:
  CHAPTER_DRAFTING:
    default:
      providerId: "deepseek"
      model: "deepseek-chat"
`

/** 确保存在可供 Evaluator 解析的合法 tier 配置文件路径。 */
function ensureEffectiveTierConfigPath(bookRoot: string, customPath?: string): string {
  if (typeof customPath === 'string' && customPath.trim().length > 0 && existsSync(customPath.trim())) {
    return customPath.trim()
  }
  const defaultPath = defaultTierConfigPath(process.env)
  if (existsSync(defaultPath)) {
    return defaultPath
  }
  const fallbackPath = join(bookRoot, '.mozhou', 'tier-config-fallback.yaml')
  if (!existsSync(fallbackPath)) {
    const dir = join(bookRoot, '.mozhou')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    atomicWriteFileSync(fallbackPath, DEFAULT_FALLBACK_TIER_YAML)
  }
  return fallbackPath
}

/**
 * 偏好画像响应 DTO（服务端就地声明）。
 *
 * 与 `apps/web/shared/api.ts` 的 PreferenceDimensionData / PreferenceProfileData 同口径，
 * 改动必须同步。此处不静态 import shared/：`tsconfig.server.json` 有独立 rootDir
 * （见 boundaryHardening.test.ts 的说明），静态引用会把 shared 拉进服务端编译程序并触发 TS6059。
 */
interface PreferenceDimensionData {
  readonly S: number
  readonly W: number
  readonly M: number
  readonly emVar: number
  readonly kappaEff: number
  readonly driftStreak: number
  /** 后验均值，不是短窗均值 M。 */
  readonly mean: number
  /** 兼容展示字段名：值为 emVar，语义是短窗方差，不是后验方差。 */
  readonly variance: number
  /** 兼容展示字段名：值为累计观测权 W，不含冷启动伪计数。 */
  readonly nEffective: number
  readonly streak: number
}

interface PreferenceProfileData {
  readonly version: 1
  readonly cursor: number
  readonly obsCount: number
  readonly degradedWindows: number
  readonly dims: Readonly<Record<string, PreferenceDimensionData>>
  readonly driftLog: readonly {
    readonly dim: string
    readonly sourcePosition: number
    readonly shortMean: number
    readonly mean: number
    readonly sigma: number
  }[]
}

/** 累积态不是 UI 读数：只在 BFF 投影，持久模型与原响应字段都保持原样。 */
function preferenceProfileView(profile: PreferenceProfileState): PreferenceProfileData {
  const dims = Object.fromEntries<PreferenceDimensionData>(PREFERENCE_DIMS.map((dim): readonly [string, PreferenceDimensionData] => {
    const state = profile.dims[dim]
    const view = {
      mean: posteriorMean(dim, state),
      variance: state.emVar,
      nEffective: state.W,
      streak: state.driftStreak,
    }
    if (!Object.values(view).every(Number.isFinite)) {
      throw new Error(`偏好画像维度 ${dim} 包含非有限读数，无法展示`)
    }
    return [dim, { ...state, ...view }]
  }))
  return { ...profile, dims }
}

export const flywheelRoutes: RouteHandler = async (req, res, { path, body, json, bookRoot, principal }) => {
  if (req.method !== 'POST') return false

  const resolvedRoot = bookRoot ?? null

  // 1. 读取作者偏好画像（只读）
  if (path === '/api/flywheel.preference') {
    const decoded = decodeBookRequest(body, resolvedRoot, { chapter: 'optional', principal })
    if (!decoded.ok) {
      json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
      return true
    }
    const { root } = decoded.value

    try {
      const materialized = hasMaterializedProfile(root)
      const profile = loadProfileOrColdStart(root)
      const observations = readPersistedObservations(root)

      json(200, {
        ok: true,
        materialized,
        profile: preferenceProfileView(profile),
        observationCount: observations.length,
      })
    } catch (cause) {
      json(500, { ok: false, error: (cause as Error).message })
    }
    return true
  }

  // 2. 显式全量重建偏好画像
  if (path === '/api/flywheel.preference.rebuild') {
    const decoded = decodeBookRequest(body, resolvedRoot, { chapter: 'optional', principal })
    if (!decoded.ok) {
      json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
      return true
    }
    const { root } = decoded.value

    try {
      const outcome = rebuildPreference(root)
      json(200, {
        ok: true,
        observationCount: outcome.observationCount,
        profile: preferenceProfileView(outcome.profile),
      })
    } catch (cause) {
      json(500, { ok: false, error: (cause as Error).message })
    }
    return true
  }

  // 3. 读取当前模型建议列表（只读）
  if (path === '/api/flywheel.suggestions') {
    const decoded = decodeBookRequest(body, resolvedRoot, { chapter: 'optional', principal })
    if (!decoded.ok) {
      json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
      return true
    }
    const { root } = decoded.value

    try {
      const suggestions = readSuggestions(root)
      json(200, {
        ok: true,
        suggestions,
        count: suggestions.length,
      })
    } catch (cause) {
      json(500, { ok: false, error: (cause as Error).message })
    }
    return true
  }

  // 4. 查询评估器状态与样本量门槛
  if (path === '/api/flywheel.evaluator.status') {
    const decoded = decodeBookRequest(body, resolvedRoot, { chapter: 'optional', principal })
    if (!decoded.ok) {
      json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
      return true
    }
    const { root } = decoded.value

    try {
      const ledger = readPipelineLedger(root)
      let decisions = 0
      const chapterSet = new Set<number>()
      for (const row of ledger) {
        if (row.kind === 'task') {
          if (typeof row.event.chapterIndex === 'number') {
            chapterSet.add(row.event.chapterIndex)
          }
          if (row.event.type === 'UserEditRecorded' && row.event.payload?.['action'] === 'candidate_decision') {
            decisions++
          }
        }
      }
      const chapterWindows = chapterSet.size
      const eligible = decisions >= EVAL_MIN_DECISIONS && chapterWindows >= EVAL_MIN_CHAPTER_WINDOWS

      json(200, {
        ok: true,
        eligible,
        sampleSize: {
          decisions,
          chapterWindows,
        },
        thresholds: {
          minDecisions: EVAL_MIN_DECISIONS,
          minChapterWindows: EVAL_MIN_CHAPTER_WINDOWS,
        },
      })
    } catch (cause) {
      json(500, { ok: false, error: (cause as Error).message })
    }
    return true
  }

  // 5. 显式触发模型评估（不自动改变模型路由）
  if (path === '/api/flywheel.evaluator.run') {
    const decoded = decodeBookRequest(body, resolvedRoot, { chapter: 'optional', principal })
    if (!decoded.ok) {
      json(decoded.error.status, { ok: false, code: decoded.error.code, error: decoded.error.error })
      return true
    }
    const { root } = decoded.value
    const customConfigPath = typeof body['tierConfigPath'] === 'string' ? body['tierConfigPath'] : undefined

    try {
      const configPath = ensureEffectiveTierConfigPath(root, customConfigPath)
      const outcome = await runTaskModelEvaluation({
        bookRoot: root,
        tierConfigPath: configPath,
        nowUtc: () => new Date().toISOString(),
      })

      // 不变量：只返回计算出的建议列表，不自动改动路由设置
      json(200, {
        ok: true,
        mode: outcome.mode,
        bridgePresent: outcome.bridgePresent,
        appendedCount: outcome.appendedCount,
        suggestions: outcome.suggestions,
        notice: '建议已生成并落入建议表；墨舟遵守不变量约定，不自动改动当前模型路由配置。',
      })
    } catch (cause) {
      json(500, { ok: false, error: (cause as Error).message })
    }
    return true
  }

  return false
}
