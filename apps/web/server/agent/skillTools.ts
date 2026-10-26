/**
 * apps/web/server/agent · 技能类工具（按需加载 / 新建 / 更新）。
 *
 * 按需加载是控 token 的关键：系统提示只注入技能名与描述，正文由 `skill_lookup` 现取。
 * 技能内容只存不执行——本项目不提供命令执行工具，所以写入技能不构成提权路径。
 */
import { NovelTool, clip, str } from './toolHost.js'
import type { ToolHost, ToolJsonSchema, ToolResult } from './toolHost.js'
import { SkillError } from './skills.js'

export class SkillLookupTool extends NovelTool {
  readonly name = 'skill_lookup'
  readonly description =
    '按 id 取回某个技能的全文（含资源清单）。系统提示里只有技能名与描述，正文靠本工具按需取——这是控 token 的关键。'
  readonly parameters: ToolJsonSchema = {
    type: 'object',
    properties: { id: { type: 'string', description: '技能 id（小写连字符）' } },
    required: ['id'],
  }

  execute(args: Readonly<Record<string, unknown>>, host: ToolHost): Promise<ToolResult> {
    const id = str(args, 'id')
    const skill = host.skills.read(id)
    if (skill === null) return Promise.resolve({ ok: false, content: '技能不存在或格式非法：' + id })
    const res =
      'scripts ' + skill.resources.scripts + ' · references ' + skill.resources.references + ' · assets ' + skill.resources.assets
    const header = '# ' + skill.name + '（' + skill.id + ' v' + skill.version + '）\n资源：' + res + '\n\n'
    return Promise.resolve({ ok: true, content: clip(header + skill.body) })
  }
}

export class SkillCreateTool extends NovelTool {
  readonly name = 'skill_create'
  readonly description = '新建一个技能（SKILL.md + 可选 scripts/references/assets 资源）。技能只存不执行。'
  readonly parameters: ToolJsonSchema = {
    type: 'object',
    properties: {
      id: { type: 'string', description: '技能 id（小写字母数字与连字符）' },
      name: { type: 'string', description: '展示名' },
      description: { type: 'string', description: '一句话描述，含触发关键词' },
      body: { type: 'string', description: 'SKILL.md 正文' },
      resources: { type: 'object', description: '相对路径 → 文本内容，路径须在 scripts/references/assets 之下' },
    },
    required: ['id', 'name', 'description', 'body'],
  }

  execute(args: Readonly<Record<string, unknown>>, host: ToolHost): Promise<ToolResult> {
    const id = str(args, 'id')
    if (host.skills.read(id) !== null) return Promise.resolve({ ok: false, content: '技能已存在，请用 skill_update：' + id })
    return Promise.resolve(writeSkill(args, host, 'skill_create'))
  }
}

export class SkillUpdateTool extends NovelTool {
  readonly name = 'skill_update'
  readonly description = '更新一个既有技能（SKILL.md 与资源）。技能只存不执行。'
  readonly parameters: ToolJsonSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      body: { type: 'string' },
      resources: { type: 'object' },
    },
    required: ['id', 'name', 'description', 'body'],
  }

  execute(args: Readonly<Record<string, unknown>>, host: ToolHost): Promise<ToolResult> {
    const id = str(args, 'id')
    if (host.skills.read(id) === null) return Promise.resolve({ ok: false, content: '技能不存在，请用 skill_create：' + id })
    return Promise.resolve(writeSkill(args, host, 'skill_update'))
  }
}

function readResources(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value
    }
  }
  return out
}

function writeSkill(args: Readonly<Record<string, unknown>>, host: ToolHost, toolName: string): ToolResult {
  const resources = readResources(args['resources'])
  try {
    const record = host.skills.write({
      id: str(args, 'id'),
      name: str(args, 'name'),
      description: str(args, 'description'),
      body: str(args, 'body'),
      resources,
    })
    const count = Object.keys(resources).length
    return {
      ok: true,
      content: toolName + ' 完成：' + record.id + '（资源 ' + count + ' 项）。技能内容只存不执行。',
      meta: { skillId: record.id },
    }
  } catch (error) {
    if (error instanceof SkillError) return { ok: false, content: error.code + ': ' + error.message }
    return { ok: false, content: '技能写入失败：' + (error as Error).message }
  }
}
