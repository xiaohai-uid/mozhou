/**
 * apps/web/server/agent · 检索与人机交互工具。
 *
 * `web_search` **不自己抓网**：出站由宿主注入的实现承担（复用既有带 SSRF 防护的搜索路径）。
 * 工具层只做参数校验与结果整形，因此永远不会成为绕过出站防护的旁路。
 * `question` 是唯一的人机交互出口：确实需要作者决定时才用，宿主未注入即报告不可用。
 */
import { NovelTool, clip, intArg, str } from './toolHost.js'
import type { ToolHost, ToolJsonSchema, ToolResult } from './toolHost.js'

export class WebSearchTool extends NovelTool {
  readonly name = 'web_search'
  readonly description = '联网搜索。需要作者开启；出站由宿主既有防护路径承担，本工具不自行抓网。'
  readonly parameters: ToolJsonSchema = {
    type: 'object',
    properties: {
      keywords: { type: 'string', description: '检索词' },
      limit: { type: 'number', description: '返回条数（默认 5，上限 10）' },
    },
    required: ['keywords'],
  }

  async execute(args: Readonly<Record<string, unknown>>, host: ToolHost): Promise<ToolResult> {
    const keywords = str(args, 'keywords').trim()
    if (keywords === '') return { ok: false, content: '检索词不能为空' }
    if (host.search === undefined) return { ok: false, content: '联网搜索不可用：宿主未注入搜索实现' }
    const limit = Math.min(Math.max(intArg(args, 'limit', 5), 1), 10)
    try {
      const hits = await host.search(keywords, limit)
      if (hits.length === 0) return { ok: true, content: '没有检索到结果', meta: { hits: 0 } }
      const text = hits.map((h, i) => i + 1 + '. ' + h.title + '\n   ' + h.url + '\n   ' + h.snippet).join('\n')
      return { ok: true, content: clip(text), meta: { hits: hits.length } }
    } catch (error) {
      return { ok: false, content: '检索失败：' + (error as Error).message }
    }
  }
}

export class QuestionTool extends NovelTool {
  readonly name = 'question'
  readonly description = '向作者提问并等待回答（人机交互）。只在确实需要作者决定时使用。'
  readonly parameters: ToolJsonSchema = {
    type: 'object',
    properties: { question: { type: 'string', description: '要问作者的问题' } },
    required: ['question'],
  }

  async execute(args: Readonly<Record<string, unknown>>, host: ToolHost): Promise<ToolResult> {
    const question = str(args, 'question').trim()
    if (question === '') return { ok: false, content: '问题不能为空' }
    if (host.ask === undefined) return { ok: false, content: '提问不可用：宿主未注入提问回调' }
    try {
      return { ok: true, content: '作者回答：' + (await host.ask(question)) }
    } catch (error) {
      return { ok: false, content: '提问失败：' + (error as Error).message }
    }
  }
}
