/**
 * apps/web/server/analysis · 原文文风分析与画像版本化保存 (Style Analysis · T12)。
 * 
 * 依照 reference/02-features.md T12 规格：
 * - 结合 evaluateStyleMetrics 机械指标与样例片段依据；
 * - 生成结构化风格画像 (StyleProfile)；
 * - 提供版本化持久化到书根 (.mozhou/style-profile.json)；
 * - 下一次生成时，装配凭据 ContextReceipt 必须记录 appliedStyleVersion。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { evaluateStyleMetrics, type StyleMetrics } from '@mozhou/quality-engine'
import { RequestBoundaryError, assertSafeBookRoot } from '../security.js'

export interface StyleAnalysisResult {
  readonly metrics: StyleMetrics
  readonly recommendedProfile: {
    readonly scenarioType: string
    readonly dialogueRatio: number
    readonly sensoryDensity: number
    readonly actionPacing: number
    readonly summary: string
  }
  readonly sampleQuotes: readonly {
    readonly quote: string
    readonly type: 'dialogue' | 'action' | 'sensory'
  }[]
}

export interface BookStyleProfile {
  readonly version: number
  readonly updatedAt: string
  readonly scenarioType: string
  readonly dialogueRatio: number
  readonly sensoryDensity: number
  readonly actionPacing: number
  readonly summary: string
}

export function analyzeTextStyle(text: string): StyleAnalysisResult {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new RequestBoundaryError(400, 'EMPTY_TEXT', 'text must not be empty')
  }

  const metrics = evaluateStyleMetrics(text)
  const dialogueRatio = Math.round(metrics.dialogueRatio * 100) / 100
  const sensoryDensity = Math.round(metrics.sensoryDensity * 100) / 100
  const actionPacing = Math.round(metrics.actionPacing * 100) / 100

  // 依据指标提取特征片段
  const sampleQuotes: { quote: string; type: 'dialogue' | 'action' | 'sensory' }[] = []
  const quotes = text.match(/[“"”][^“”""]{4,50}[”"“]/g)
  if (quotes && quotes[0]) {
    sampleQuotes.push({ quote: quotes[0], type: 'dialogue' })
  }

  const sensoryWords = ['微风', '血腥', '寒冷', '炽热', '清脆', '漆黑', '沉重', '轰鸣']
  for (const w of sensoryWords) {
    const idx = text.indexOf(w)
    if (idx !== -1) {
      const slice = text.slice(Math.max(0, idx - 10), Math.min(text.length, idx + 20))
      sampleQuotes.push({ quote: slice.trim(), type: 'sensory' })
      break
    }
  }

  return {
    metrics,
    recommendedProfile: {
      scenarioType: dialogueRatio > 0.4 ? 'dialogue-heavy' : 'narrative-balanced',
      dialogueRatio,
      sensoryDensity,
      actionPacing,
      summary: `实测字数 ${metrics.charCount}，对话占比 ${(dialogueRatio * 100).toFixed(0)}%，动作流速 ${(actionPacing * 100).toFixed(0)}%`,
    },
    sampleQuotes,
  }
}

/**
 * 将风格画像持久化到指定书目录，支持版本自增。
 */
export function saveBookStyleProfile(
  bookRoot: string,
  profile: {
    readonly scenarioType?: string | undefined
    readonly dialogueRatio?: number | undefined
    readonly sensoryDensity?: number | undefined
    readonly actionPacing?: number | undefined
    readonly summary?: string | undefined
  },
): BookStyleProfile {
  const root = assertSafeBookRoot(bookRoot)
  const profilePath = resolve(root, '.mozhou', 'style-profile.json')

  let version = 1
  if (existsSync(profilePath)) {
    try {
      const old = JSON.parse(readFileSync(profilePath, 'utf8')) as { version?: number }
      version = (old.version ?? 0) + 1
    } catch {
      // ignore
    }
  }

  const saved: BookStyleProfile = {
    version,
    updatedAt: new Date().toISOString(),
    scenarioType: profile.scenarioType ?? 'narrative-balanced',
    dialogueRatio: profile.dialogueRatio ?? 0.35,
    sensoryDensity: profile.sensoryDensity ?? 0.25,
    actionPacing: profile.actionPacing ?? 0.3,
    summary: profile.summary ?? '用户确认的文风画像',
  }

  writeFileSync(profilePath, JSON.stringify(saved, null, 2) + '\n', 'utf8')
  return saved
}

export function loadBookStyleProfile(bookRoot: string): BookStyleProfile | null {
  const root = assertSafeBookRoot(bookRoot)
  const profilePath = resolve(root, '.mozhou', 'style-profile.json')
  if (!existsSync(profilePath)) return null
  try {
    return JSON.parse(readFileSync(profilePath, 'utf8')) as BookStyleProfile
  } catch {
    return null
  }
}
