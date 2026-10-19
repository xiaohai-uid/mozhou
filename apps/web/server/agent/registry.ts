/**
 * apps/web/server/agent · 工具注册表（ToolRegistry）。
 *
 * 职责：
 *   1. 统一管理工具的注册、开关（enable / disable）与定义查询；
 *   2. 严格执行「联网检索默认关闭且不下发」的安全与隐私策略；
 *   3. 统一分发工具执行（dispatch），未知或未启用工具显式拒绝，不假装成功。
 */
import { FileManageTool, FileReadTool, FileWriteTool } from './fileTools.js'
import { QuestionTool, WebSearchTool } from './miscTools.js'
import { SkillCreateTool, SkillLookupTool, SkillUpdateTool } from './skillTools.js'
import { NovelTool } from './toolHost.js'
import type { ToolDefinition, ToolHost, ToolResult } from './toolHost.js'

export interface RegisteredToolEntry {
  readonly tool: NovelTool
  enabled: boolean
}

export class ToolRegistry {
  private readonly _entries = new Map<string, RegisteredToolEntry>()

  register(tool: NovelTool, enabled = true): this {
    this._entries.set(tool.name, { tool, enabled })
    return this
  }

  has(name: string): boolean {
    return this._entries.has(name)
  }

  enable(name: string): boolean {
    const entry = this._entries.get(name)
    if (entry === undefined) return false
    entry.enabled = true
    return true
  }

  disable(name: string): boolean {
    const entry = this._entries.get(name)
    if (entry === undefined) return false
    entry.enabled = false
    return true
  }

  isEnabled(name: string): boolean {
    return this._entries.get(name)?.enabled === true
  }

  listDefinitions(): readonly ToolDefinition[] {
    const out: ToolDefinition[] = []
    for (const entry of this._entries.values()) {
      if (entry.enabled) {
        out.push(entry.tool.toDefinition())
      }
    }
    return out
  }

  dispatch(
    name: string,
    args: Readonly<Record<string, unknown>>,
    host: ToolHost,
  ): Promise<ToolResult> {
    const entry = this._entries.get(name)
    if (entry === undefined) {
      return Promise.resolve({ ok: false, content: '未知工具：' + name })
    }
    if (!entry.enabled) {
      return Promise.resolve({ ok: false, content: '工具未启用：' + name })
    }
    return entry.tool.execute(args, host)
  }
}

/**
 * 创建包含全部 8 类默认工具的标准注册表。
 * 安全契约：web_search 默认关闭 (enabled = false)。
 */
export function createDefaultToolRegistry(): ToolRegistry {
  const reg = new ToolRegistry()
  reg.register(new FileReadTool(), true)
  reg.register(new FileWriteTool(), true)
  reg.register(new FileManageTool(), true)
  reg.register(new SkillLookupTool(), true)
  reg.register(new SkillCreateTool(), true)
  reg.register(new SkillUpdateTool(), true)
  reg.register(new QuestionTool(), true)
  // 联网搜索默认关闭，不主动下发给模型
  reg.register(new WebSearchTool(), false)
  return reg
}
