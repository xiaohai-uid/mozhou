/**
 * 策略飞轮与模型评估路由（CHG-20261006-06）。
 *
 * 职责：
 * 1. 作者偏好画像读取与重建：/api/flywheel.preference, /api/flywheel.preference.rebuild；
 * 2. 模型路由建议读取与评估运行：/api/flywheel.suggestions, /api/flywheel.evaluator.status, /api/flywheel.evaluator.run；
 * 3. 严格不变量（C6）：只建议，不自动改变模型路由（绝不自动写 settings.yaml）。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RouteHandler } from '../router.js'
import { decodeBookRequest } from '../bookRequest.js'
import {
  EVAL_MIN_CHAPTER_WINDOWS,
  EVAL_MIN_DECISIONS,
  hasMaterializedProfile,
  loadProfileOrColdStart,
  readPersistedObservations,
  readSuggestions,
  rebuildPreference,
  runTaskModelEvaluation,
} from '@mozhou/flywheel'
import { readPipelineLedger } from '@mozhou/pipeline'
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
    writeFileSync(fallbackPath, DEFAULT_FALLBACK_TIER_YAML, 'utf-8')
  }
  return fallbackPath
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
        profile,
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
        profile: outcome.profile,
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
