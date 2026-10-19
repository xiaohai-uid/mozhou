/**
 * apps/web/server/routes/skillRoutes.ts
 *
 * 技能存储 HTTP 路由（对标 OpenWrite 议题 #103 / S-02 切片）：
 *   - POST /api/skills.list   -> SkillStore.list()，列出摘要（不含 body）
 *   - POST /api/skills.read   -> 接收 { id }，SkillStore.read(id)
 *   - POST /api/skills.save   -> 接收 { id, name, description, body, resources }，SkillStore.write(...)
 *   - POST /api/skills.delete -> 接收 { id }，SkillStore.remove(id)
 *
 * 策略 'account'：跟随当前主体或书上下文，严格使用 atomicWriteFileSync。
 */
import { join } from 'node:path'
import type { RouteHandler } from '../router.js'
import { SkillError, SkillStore, type SkillRecord, type SkillSummary } from '../agent/skills.js'

export interface SkillsListResponse {
  readonly ok: true
  readonly skills: readonly SkillSummary[]
}

export interface SkillsReadResponse {
  readonly ok: true
  readonly skill: SkillRecord
}

export interface SkillsSaveResponse {
  readonly ok: true
  readonly skill: SkillRecord
}

export interface SkillsDeleteResponse {
  readonly ok: true
  readonly deleted: boolean
}

export interface SkillsErrorResponse {
  readonly ok: false
  readonly code: string
  readonly error: string
}

function resolveSkillsRoot(body: Record<string, unknown>, contextBookRoot?: string | null): string {
  if (typeof body['skillsRoot'] === 'string' && body['skillsRoot'].trim() !== '') {
    return body['skillsRoot'].trim()
  }
  const root =
    typeof body['root'] === 'string' && body['root'].trim() !== ''
      ? body['root'].trim()
      : contextBookRoot ?? null

  return root ? join(root, '..', 'skills') : join(process.cwd(), '.mozhou-skills')
}

export const skillRoutes: RouteHandler = (req, res, { path, body, json, bookRoot: contextBookRoot }) => {
  if (req.method !== 'POST') return false

  if (path === '/api/skills.list') {
    const store = new SkillStore({ root: resolveSkillsRoot(body, contextBookRoot) })
    try {
      const skills = store.list()
      json(200, { ok: true, skills })
    } catch (cause) {
      json(500, { ok: false, code: 'SKILL_LIST_FAILED', error: (cause as Error).message })
    }
    return true
  }

  if (path === '/api/skills.read') {
    const rawId = body['id']
    if (typeof rawId !== 'string' || rawId.trim() === '') {
      json(400, { ok: false, code: 'INVALID_SKILL_REQUEST', error: '缺少技能标识 id' })
      return true
    }
    const id = rawId.trim()
    const store = new SkillStore({ root: resolveSkillsRoot(body, contextBookRoot) })
    const skill = store.read(id)
    if (skill === null) {
      json(404, { ok: false, code: 'SKILL_NOT_FOUND', error: `技能不存在：${id}` })
      return true
    }
    json(200, { ok: true, skill })
    return true
  }

  if (path === '/api/skills.save') {
    const rawId = body['id']
    const rawName = body['name']
    const rawDescription = body['description']
    const rawBody = body['body']

    if (
      typeof rawId !== 'string' ||
      rawId.trim() === '' ||
      typeof rawName !== 'string' ||
      rawName.trim() === '' ||
      typeof rawDescription !== 'string' ||
      rawDescription.trim() === '' ||
      typeof rawBody !== 'string'
    ) {
      json(400, {
        ok: false,
        code: 'INVALID_SKILL_REQUEST',
        error: 'id, name, description 必须为非空字符串，且 body 必须为字符串',
      })
      return true
    }

    const version = typeof body['version'] === 'string' ? body['version'].trim() : undefined
    const license = typeof body['license'] === 'string' ? body['license'].trim() : undefined

    let resources: Record<string, string> | undefined
    const rawResources = body['resources']
    if (typeof rawResources === 'object' && rawResources !== null && !Array.isArray(rawResources)) {
      resources = {}
      for (const [k, v] of Object.entries(rawResources as Record<string, unknown>)) {
        if (typeof v === 'string') {
          resources[k] = v
        }
      }
    }

    const store = new SkillStore({ root: resolveSkillsRoot(body, contextBookRoot) })
    try {
      const writeInput = {
        id: rawId.trim(),
        name: rawName.trim(),
        description: rawDescription.trim(),
        body: rawBody,
        ...(version !== undefined ? { version } : {}),
        ...(license !== undefined ? { license } : {}),
        ...(resources !== undefined ? { resources } : {}),
      }
      const record = store.write(writeInput)
      json(200, { ok: true, skill: record })
    } catch (cause) {
      if (cause instanceof SkillError) {
        json(cause.status, { ok: false, code: cause.code, error: cause.message })
      } else {
        json(500, { ok: false, code: 'SKILL_WRITE_FAILED', error: (cause as Error).message })
      }
    }
    return true
  }

  if (path === '/api/skills.delete') {
    const rawId = body['id']
    if (typeof rawId !== 'string' || rawId.trim() === '') {
      json(400, { ok: false, code: 'INVALID_SKILL_REQUEST', error: '缺少技能标识 id' })
      return true
    }
    const id = rawId.trim()
    const store = new SkillStore({ root: resolveSkillsRoot(body, contextBookRoot) })
    const deleted = store.remove(id)
    if (!deleted) {
      json(404, { ok: false, code: 'SKILL_NOT_FOUND', error: `技能不存在或删除失败：${id}` })
      return true
    }
    json(200, { ok: true, deleted: true })
    return true
  }

  return false
}
