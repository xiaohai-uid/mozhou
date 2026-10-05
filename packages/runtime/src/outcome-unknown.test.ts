/**
 * W4-2c-3 outcome_unknown 关闭自动重试链与显式新 attempt 路径测试。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createBook,
  createTaskRecord,
  beginTaskAttempt,
  finishTaskAttempt,
  readTaskRecord,
  isTaskOutcomeUnknown,
  canTaskAutoRetry,
  retryTaskWithExplicitConfirmation,
  TaskRecordError,
} from '@mozhou/data-plane'
import {
  PublishBus,
  RuntimeEngine,
  OutcomeUnknownError,
  RecoverableError,
  type ProviderBinding,
} from './index.js'

describe('W4-2c-3 outcome_unknown 契约与自动重试链关闭', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mozhou-unknown-test-'))
    createBook({ dir: root, title: '结果不明测试' })
  })

  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it('遇到 OutcomeUnknownError 时关闭自动重试链，不继续尝试 fallback provider', async () => {
    const bus = new PublishBus()
    const engine = new RuntimeEngine({ bus, ctx: { root } })

    let fallbackCalled = false

    engine.registerCapability({
      taskType: 'CHAPTER_DRAFTING',
      providerId: 'primary-provider',
      providerVersion: '1.0.0',
      failurePolicy: { timeoutMs: 1000, fallbackProviderIds: ['fallback-provider'] },
    })

    const primaryBinding: ProviderBinding = async () => {
      throw new OutcomeUnknownError('外部调用失联，结果不明')
    }
    const fallbackBinding: ProviderBinding = async () => {
      fallbackCalled = true
      return 'fallback text'
    }

    engine.registerProviderBinding('primary-provider', primaryBinding)
    engine.registerProviderBinding('fallback-provider', fallbackBinding)

    const result = await engine.execute('CHAPTER_DRAFTING', { prompt: 'test' })

    expect(result.outcome).toBe('failed_terminal')
    // 关键断言：自动重试链被阻断，备用 provider 绝不被隐式自动调用
    expect(fallbackCalled).toBe(false)
  })

  it('区分正常重生与结果不明：普通 RecoverableError 仍正常触发 fallback 重试，不被误伤', async () => {
    const bus = new PublishBus()
    const engine = new RuntimeEngine({ bus, ctx: { root } })

    let fallbackCalled = false

    engine.registerCapability({
      taskType: 'CHAPTER_DRAFTING',
      providerId: 'primary-recoverable',
      providerVersion: '1.0.0',
      failurePolicy: { timeoutMs: 1000, fallbackProviderIds: ['fallback-target'] },
    })

    const primaryBinding: ProviderBinding = async () => {
      throw new RecoverableError('正常可重试失败（如格式坏字段）')
    }
    const fallbackBinding: ProviderBinding = async () => {
      fallbackCalled = true
      return 'fallback success'
    }

    engine.registerProviderBinding('primary-recoverable', primaryBinding)
    engine.registerProviderBinding('fallback-target', fallbackBinding)

    const result = await engine.execute('CHAPTER_DRAFTING', { prompt: 'test' })

    expect(result.outcome).toBe('succeeded')
    expect(result.value).toBe('fallback success')
    expect(fallbackCalled).toBe(true)
  })

  it('任务记录 outcome_unknown 阻断自动重试，显式新 attempt 需确认重复计费风险', () => {
    createTaskRecord(root, {
      taskId: 'task_unknown_flow',
      bookId: 'b_test',
      taskKind: 'draft.generate',
    })

    beginTaskAttempt(root, 'task_unknown_flow', { attemptId: 'att_1', provider: 'deepseek' })
    finishTaskAttempt(root, 'task_unknown_flow', { attemptId: 'att_1', state: 'outcome_unknown' })

    const record = readTaskRecord(root, 'task_unknown_flow')!
    expect(isTaskOutcomeUnknown(record)).toBe(true)
    expect(canTaskAutoRetry(record)).toBe(false)

    // 未确认重复计费风险时发起新 attempt 被拒绝
    expect(() =>
      retryTaskWithExplicitConfirmation(root, 'task_unknown_flow', {
        newAttemptId: 'att_2',
        confirmDuplicateBilling: false,
      }),
    ).toThrow(TaskRecordError)

    // 显式确认重复计费风险后，分配全新 attemptId 成功发起
    const updated = retryTaskWithExplicitConfirmation(root, 'task_unknown_flow', {
      newAttemptId: 'att_2',
      newOperationId: 'op_retry_explicit',
      confirmDuplicateBilling: true,
      provider: 'deepseek',
    })

    expect(updated.attempts).toHaveLength(2)
    expect(updated.attempts[1]?.attemptId).toBe('att_2')
    expect(updated.attempts[1]?.state).toBe('running')
    expect(updated.operationIds).toContain('op_retry_explicit')

    // 严禁重放已有的 attemptId
    expect(() =>
      retryTaskWithExplicitConfirmation(root, 'task_unknown_flow', {
        newAttemptId: 'att_2',
        confirmDuplicateBilling: true,
      }),
    ).toThrow(/already exists/)
  })
})
