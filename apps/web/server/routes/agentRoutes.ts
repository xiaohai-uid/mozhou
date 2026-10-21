/**
 * apps/web/server/routes/agentRoutes.ts
 *
 * 智能体工具层 HTTP 路由（对标 OpenWrite 议题 #103）：
 *   - POST /api/tools.list     获取当前启用的工具定义清单（默认排除未开启的 web_search）
 *   - POST /api/tools.execute  分发并执行工具调用，带路径三档授权与安全沙箱防护
 */
import { join } from 'node:path'
import type { RouteHandler } from '../router.js'
import { defaultBookAccessManager } from '../bookAccess.js'
import { RequestBoundaryError } from '../security.js'
import { createDefaultToolRegistry } from '../agent/registry.js'
import { SkillStore } from '../agent/skills.js'
import { RecycleStore } from '../recycle/recycleStore.js'
import type { ToolDefinition, ToolHost, ToolResult } from '../agent/toolHost.js'

export interface ToolsListResponse {
  readonly ok: true
  readonly tools: readonly ToolDefinition[]
}

export type ToolsExecuteResponse = ToolResult

export const agentRoutes: RouteHandler = async (req, res, { path, body, json, bookRoot: contextBookRoot, principal, authorizedBook: contextAuthorizedBook }) => {
  if (req.method !== 'POST') return false

  if (path === '/api/tools.list') {
    const registry = createDefaultToolRegistry()
    const enabledOverrides = body['enabledTools']
    if (typeof enabledOverrides === 'object' && enabledOverrides !== null) {
      for (const [name, enabled] of Object.entries(enabledOverrides as Record<string, unknown>)) {
        if (typeof enabled === 'boolean') {
          if (enabled) registry.enable(name)
          else registry.disable(name)
        }
      }
    }

    const tools = registry.listDefinitions()
    json(200, { ok: true, tools })
    return true
  }

  if (path === '/api/tools.execute') {
    const rawName = body['name']
    if (typeof rawName !== 'string' || rawName.trim() === '') {
      json(400, { ok: false, code: 'INVALID_TOOL_REQUEST', error: '缺少工具名称 name' })
      return true
    }
    const name = rawName.trim()

    const rawArgs = body['args']
    const args: Readonly<Record<string, unknown>> =
      typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : {}

    let bookRoot: string | null = contextAuthorizedBook?.root ?? contextBookRoot ?? null
    const hasBookSpecifier =
      (typeof body['root'] === 'string' && body['root'].trim() !== '') ||
      (typeof body['bookId'] === 'string' && body['bookId'].trim() !== '')

    if (body['root'] !== undefined && (typeof body['root'] !== 'string' || body['root'].trim() === '')) {
      json(400, { ok: false, code: 'INVALID_PATH', error: 'book root must be a non-empty string' })
      return true
    }

    if (hasBookSpecifier) {
      try {
        const authorizedBook = defaultBookAccessManager.resolveAuthorizedBook(principal ?? null, body)
        bookRoot = authorizedBook.root
      } catch (err) {
        if (err instanceof RequestBoundaryError) {
          json(err.status, {
            ok: false,
            code: err.code,
            error: err.message,
          })
          return true
        }
        json(400, {
          ok: false,
          code: 'INVALID_BOOK_ROOT',
          error: (err as Error).message,
        })
        return true
      }
    }

    const registry = createDefaultToolRegistry()
    const enabledOverrides = body['enabledTools']
    if (typeof enabledOverrides === 'object' && enabledOverrides !== null) {
      for (const [toolName, enabled] of Object.entries(enabledOverrides as Record<string, unknown>)) {
        if (typeof enabled === 'boolean') {
          if (enabled) registry.enable(toolName)
          else registry.disable(toolName)
        }
      }
    }

    const rawConfirmed = body['confirmedPaths']
    const confirmedSet = new Set(
      Array.isArray(rawConfirmed)
        ? rawConfirmed.filter((p): p is string => typeof p === 'string')
        : [],
    )

    const skillRootDir = bookRoot ? join(bookRoot, '..', 'skills') : join(process.cwd(), '.mozhou-skills')
    const trashRootDir = bookRoot ? join(bookRoot, '..', 'trash') : join(process.cwd(), '.mozhou-trash')
    const recycleStore = new RecycleStore({ root: trashRootDir })

    const host: ToolHost = {
      bookRoot,
      skills: new SkillStore({ root: skillRootDir }),
      confirmExternalPath: (resolvedPath) => confirmedSet.has(resolvedPath),
      trash: (resolvedPath) => recycleStore.trash(resolvedPath),
    }

    const result = await registry.dispatch(name, args, host)
    json(200, result)
    return true
  }

  return false
}
