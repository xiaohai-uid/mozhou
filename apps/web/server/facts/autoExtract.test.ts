// @vitest-environment node
/**
 * 章后事实提取自动触发单元测试（#119 ①）。
 * 断言外部行为：mock 模式自动提取 → Started/Finished 进度行 + 候选落账本；
 * 未配置 provider → 任务整体跳过（账本零行，零假候选）；真实 provider 失败 →
 * Failed 行携带原因；章节缺失 → Failed 行。绝不假成功、失败绝不静默。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBook, proseChapterPath, renderProseChapter } from '@mozhou/data-plane'
import { newUlid } from '@mozhou/kernel'

/** 只换 streamOpenAiChat（真实流失败缝）；resolveChatEndpoint 保持真实解析——BYOK env 缝可控。 */
vi.mock('../llm/openaiStream.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../llm/openaiStream.js')>()
  return {
    ...actual,
    streamOpenAiChat: () => {
      throw new Error('PROVIDER_STREAM_BLOWN_UP_BY_TEST')
    },
  }
})

import { defaultBookAccessManager } from '../bookAccess.js'
import {
  readFactExtractionStatus,
  scheduleAutoFactExtraction,
} from './autoExtract.js'

const PROSE_BODY = '萧炎走进坊市，与萧宁当街冲突。两人不欢而散，各自记恨。'

let root = ''
let dataRoot = ''

beforeEach(() => {
  delete process.env['MOZHOU_DRAFT_PROVIDER']
  delete process.env['MOZHOU_API_KEY']
  delete process.env['MOZHOU_API_BASE']
  delete process.env['DEEPSEEK_API_KEY']
  delete process.env['OPENAI_API_KEY']
  root = mkdtempSync(join(tmpdir(), 'mozhou-facts-auto-'))
  mkdirSync(root, { recursive: true })
  createBook({ dir: root, title: '自动提取验收书' })
  writeFileSync(
    join(root, proseChapterPath(1)),
    renderProseChapter({ mozhouId: `prose_${newUlid()}`, revision: 1, chapterIndex: 1, phase: 'draft', body: PROSE_BODY }),
    'utf8',
  )
  // provider 设置读面隔离到空临时数据根：本机真实产品配置不进测试（既有契约测试同款缝）。
  dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-facts-auto-data-'))
  defaultBookAccessManager.setHostedMode(false)
  defaultBookAccessManager.setDataRoot(dataRoot)
})

afterEach(() => {
  delete process.env['MOZHOU_DRAFT_PROVIDER']
  delete process.env['MOZHOU_API_KEY']
  delete process.env['MOZHOU_API_BASE']
  defaultBookAccessManager.clear()
  for (const dir of [root, dataRoot]) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows 文件锁容忍
    }
  }
})

function eventsDisk(): string {
  const path = join(root, '.mozhou', 'events.jsonl')
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

function extractionRows(): Array<Record<string, unknown>> {
  return eventsDisk()
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((row) => typeof row['type'] === 'string' && String(row['type']).startsWith('FactExtraction'))
}

describe('scheduleAutoFactExtraction（#119 ①提交链自动触发）', () => {
  it('mock 模式：Started → Finished 进度行落账本，候选落账本，runId 全链一致', async () => {
    process.env['MOZHOU_DRAFT_PROVIDER'] = 'mock'
    expect(extractionRows()).toEqual([])

    await scheduleAutoFactExtraction({ root, chapterIndex: 1 })

    const rows = extractionRows()
    expect(rows.map((row) => row['type'])).toEqual(['FactExtractionStarted', 'FactExtractionFinished'])
    const started = rows[0]!
    const finished = rows[1]!
    expect(started['chapterIndex']).toBe(1)
    expect(started['trigger']).toBe('auto_commit')
    expect(started['runId']).toBe(finished['runId'])
    expect(finished['inserted']).toBe(2)
    expect(finished['voided']).toBe(0)

    // 候选落账本且绑定本提取 runId（候选事实账本 §117 缝）
    const status = readFactExtractionStatus(root, 1)
    expect(status.latest?.type).toBe('FactExtractionFinished')
    expect(status.pendingCount).toBe(2)
  })

  it('未配置任何 provider：任务整体跳过——账本零行、零候选（绝不假启动）', async () => {
    expect(extractionRows()).toEqual([])

    await scheduleAutoFactExtraction({ root, chapterIndex: 1 })

    expect(extractionRows()).toEqual([])
    expect(readFactExtractionStatus(root, 1)).toEqual({ latest: null, pendingCount: 0 })
  })

  it('provider 可用但流式失败：Failed 行携带原因（失败绝不静默）', async () => {
    process.env['MOZHOU_API_KEY'] = 'sk-test-not-real'
    await scheduleAutoFactExtraction({ root, chapterIndex: 1 })

    const rows = extractionRows()
    expect(rows.map((row) => row['type'])).toEqual(['FactExtractionStarted', 'FactExtractionFailed'])
    const failed = rows[1]!
    expect(String(failed['reason'])).toContain('PROVIDER_STREAM_BLOWN_UP_BY_TEST')
    expect(readFactExtractionStatus(root, 1).pendingCount).toBe(0)
  })

  it('章节缺失（正文不可读）：Failed 行显式失败，不产空提取假现场', async () => {
    process.env['MOZHOU_DRAFT_PROVIDER'] = 'mock'
    await scheduleAutoFactExtraction({ root, chapterIndex: 42 })

    const rows = extractionRows()
    expect(rows.map((row) => row['type'])).toEqual(['FactExtractionStarted', 'FactExtractionFailed'])
    expect(String(rows[1]!['reason'])).toContain('CHAPTER_NOT_FOUND')
  })

  it('manual_retry 触发语义：进度行 trigger 如实携带', async () => {
    process.env['MOZHOU_DRAFT_PROVIDER'] = 'mock'
    await scheduleAutoFactExtraction({ root, chapterIndex: 1, trigger: 'manual_retry' })

    expect(extractionRows()[0]!['trigger']).toBe('manual_retry')
  })
})
