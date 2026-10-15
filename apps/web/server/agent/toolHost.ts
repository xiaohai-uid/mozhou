/**
 * apps/web/server/agent · 工具层的契约与基类。
 *
 * 工具需要的一切外部能力都由 `ToolHost` 注入，工具自身不触网、不执行命令：
 * 搜索走宿主既有带出站防护的实现，删除走宿主回收站，提问走宿主回调。
 * 这样工具层永远不会成为绕过出站防护或提权的旁路。
 */
import type { SkillStore } from './skills.js'

export const MAX_READ_BYTES = 256 * 1024
export const MAX_LIST_ENTRIES = 200
export const MAX_RESULT_CHARS = 12_000
export const MAX_WRITE_BYTES = 1024 * 1024

export interface ToolJsonSchema {
  readonly type: 'object'
  readonly properties: Readonly<Record<string, unknown>>
  readonly required?: readonly string[]
}

export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: ToolJsonSchema
}

export interface ToolResult {
  readonly ok: boolean
  /** 回给模型的文本（已按上限截断）。 */
  readonly content: string
  readonly meta?: Readonly<Record<string, unknown>>
}

export interface SearchHit {
  readonly title: string
  readonly url: string
  readonly snippet: string
}

/** 宿主环境：外部能力注入点。未注入的能力由对应工具报告「不可用」，不静默降级。 */
export interface ToolHost {
  readonly bookRoot: string | null
  readonly skills: SkillStore
  /** 外部路径确认；返回 false 即拒绝本次访问。未注入时视为「未确认」。 */
  readonly confirmExternalPath?: (resolvedPath: string, reason: string) => boolean
  /** 软删除（回收站）；未注入时文件删除动作被拒绝。 */
  readonly trash?: (resolvedPath: string) => { readonly id: string }
  /** 联网搜索（宿主注入，带既有出站防护）。 */
  readonly search?: (keywords: string, limit: number) => Promise<readonly SearchHit[]>
  /** 向作者提问。 */
  readonly ask?: (question: string) => Promise<string>
}

export abstract class NovelTool {
  abstract readonly name: string
  abstract readonly description: string
  abstract readonly parameters: ToolJsonSchema
  abstract execute(args: Readonly<Record<string, unknown>>, host: ToolHost): Promise<ToolResult>

  toDefinition(): ToolDefinition {
    return { name: this.name, description: this.description, parameters: this.parameters }
  }
}

export function clip(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text
  return text.slice(0, MAX_RESULT_CHARS) + '\n…（已截断，共 ' + text.length + ' 字符）'
}

export function str(args: Readonly<Record<string, unknown>>, key: string): string {
  const v = args[key]
  return typeof v === 'string' ? v : ''
}

export function intArg(args: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = args[key]
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : fallback
}
