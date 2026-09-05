// @vitest-environment node
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import {
  PrematureStreamTerminationError,
  resolveChatEndpoint,
  streamOpenAiChat,
} from '../server/llm/openaiStream'

const DUMMY_MOZ = ['dummy', 'moz', 'token'].join('_')
const DUMMY_DS = ['dummy', 'ds', 'token'].join('_')
const DUMMY_OA = ['dummy', 'oa', 'token'].join('_')

describe('BYOK 路由配置解析（T07）', () => {
  it('1. MOZHOU_* 通用配置最高优先级', () => {
    const ep = resolveChatEndpoint({
      MOZHOU_API_KEY: DUMMY_MOZ,
      MOZHOU_API_BASE: 'https://gateway.ai.com/v1',
      MOZHOU_MODEL: 'claude-3-5-sonnet',
      DEEPSEEK_API_KEY: DUMMY_DS,
      OPENAI_API_KEY: DUMMY_OA,
    })
    expect(ep).not.toBeNull()
    expect(ep?.apiKey).toBe(DUMMY_MOZ)
    expect(ep?.baseUrl).toBe('https://gateway.ai.com/v1')
    expect(ep?.model).toBe('claude-3-5-sonnet')
  })

  it('2. 仅配 DEEPSEEK_API_KEY：默认 api.deepseek.com 与 deepseek-chat', () => {
    const ep = resolveChatEndpoint({
      DEEPSEEK_API_KEY: DUMMY_DS,
    })
    expect(ep).not.toBeNull()
    expect(ep?.apiKey).toBe(DUMMY_DS)
    expect(ep?.baseUrl).toBe('https://api.deepseek.com')
    expect(ep?.model).toBe('deepseek-chat')
  })

  it('3. 仅配 OPENAI_API_KEY：必须默认 api.openai.com/v1 与 gpt-4o-mini，绝不能落到 deepseek', () => {
    const ep = resolveChatEndpoint({
      OPENAI_API_KEY: DUMMY_OA,
    })
    expect(ep).not.toBeNull()
    expect(ep?.apiKey).toBe(DUMMY_OA)
    expect(ep?.baseUrl).toBe('https://api.openai.com/v1')
    expect(ep?.model).toBe('gpt-4o-mini')
    expect(ep?.baseUrl).not.toContain('deepseek')
    expect(ep?.model).not.toContain('deepseek')
  })

  it('4. 两者皆有时：未指定 MOZHOU_PROVIDER 报错，指定后正确切换', () => {
    expect(() =>
      resolveChatEndpoint({
        DEEPSEEK_API_KEY: DUMMY_DS,
        OPENAI_API_KEY: DUMMY_OA,
      }),
    ).toThrow(/MOZHOU_PROVIDER/i)

    const epDs = resolveChatEndpoint({
      DEEPSEEK_API_KEY: DUMMY_DS,
      OPENAI_API_KEY: DUMMY_OA,
      MOZHOU_PROVIDER: 'deepseek',
    })
    expect(epDs?.baseUrl).toBe('https://api.deepseek.com')
    expect(epDs?.model).toBe('deepseek-chat')

    const epOa = resolveChatEndpoint({
      DEEPSEEK_API_KEY: DUMMY_DS,
      OPENAI_API_KEY: DUMMY_OA,
      MOZHOU_PROVIDER: 'openai',
    })
    expect(epOa?.baseUrl).toBe('https://api.openai.com/v1')
    expect(epOa?.model).toBe('gpt-4o-mini')
  })

  it('5. 无任何 Key 时返回 null', () => {
    expect(resolveChatEndpoint({})).toBeNull()
  })

  it('6. 上游在未发送 [DONE] 情况下提前断开连接，抛出 PrematureStreamTerminationError', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"第一段"}}]}\n\n')
      res.write('data: {"choices":[{"delta":{"content":"第二段"}}]}\n\n')
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as AddressInfo).port
    const endpoint = {
      apiKey: DUMMY_MOZ,
      baseUrl: `http://127.0.0.1:${port}`,
      model: 'test-model',
      allowPrivateNetwork: true,
    }

    const chunks: string[] = []
    await expect(async () => {
      for await (const chunk of streamOpenAiChat(endpoint, '测试指令', '系统提示')) {
        chunks.push(chunk.delta)
      }
    }).rejects.toThrow(PrematureStreamTerminationError)

    expect(chunks).toEqual(['第一段', '第二段'])
    server.close()
  })
})
