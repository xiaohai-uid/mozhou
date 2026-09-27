// @vitest-environment node
/**
 * mock provider 流的分块纪律测试。
 *
 * 曾经的缺陷：中间块写成 `base.slice(8, 18) === '' ? base : base.slice(8, 18)`，
 * 短提示词（不足 8 字）时回退成整段 base，首块与中间块都是全文——mock 生成的
 * 正文被原样吐了两遍。mock 路径没人读正文，所以没被发现。
 */
import { describe, expect, it } from 'vitest'
import { emptyDraftStream, mockDraftStream } from './draftStreamEmulation.js'

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let out = ''
  for await (const chunk of stream) out += chunk
  return out
}

describe('mockDraftStream', () => {
  it('长文本：各块拼回原文，不重不漏', async () => {
    const prompt = '夜幕低垂，狂风卷着黄沙掠过孤城，少年按剑伫立，眼神坚毅而不退。'
    expect(await collect(mockDraftStream(prompt))).toBe(prompt)
  })

  it('短文本（不足一个分块窗口）：只吐一次，绝不重复', async () => {
    const prompt = '起风了'
    expect(await collect(mockDraftStream(prompt))).toBe(prompt)
  })

  it('逐档长度都不重复（曾缺陷的回归钉子）', async () => {
    for (let n = 1; n <= 40; n += 1) {
      const prompt = '字'.repeat(n)
      const joined = await collect(mockDraftStream(prompt))
      expect({ n, joined }).toEqual({ n, joined: prompt })
    }
  })

  it('空提示词回落到默认种子串，且只出现一次', async () => {
    const joined = await collect(mockDraftStream('   '))
    expect(joined).toBe('夜雨敲窗，灯焰摇了三摇。')
  })

  it('onDelta 收到的内容与产出一致（不多不少）', async () => {
    const seen: string[] = []
    const joined = await collect(mockDraftStream('起风了', (t) => seen.push(t)))
    expect(seen.join('')).toBe(joined)
    expect(seen.length).toBe(1)
  })
})

describe('emptyDraftStream', () => {
  it('零帧即终帧，不产出任何正文', async () => {
    expect(await collect(emptyDraftStream())).toBe('')
  })
})
