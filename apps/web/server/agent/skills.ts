/**
 * apps/web/server/agent · 技能存储（SKILL.md 约定）。
 *
 * 按 OpenWrite 的技能形态实现同一套约定：
 * - 一个技能 = 一个目录，内含 `SKILL.md`（YAML frontmatter + 正文）；
 * - 资源三分：`scripts/`（脚本）、`references/`（按需文档）、`assets/`（模板素材）；
 * - **按需加载**：系统提示只注入「技能名 + 描述」，正文与资源靠 `skill_lookup` 现取。
 *   这是控 token 的关键——技能全文不进提示。
 * - 命名约定：英文小写连字符，避开跨平台路径编码问题。
 *
 * 与既有 `skills/catalog.ts` 的关系：那个是**纯数据提示词配方**（内置、不可写盘、
 * 明确禁止任何代码执行）。本模块是**可写盘的技能目录**，形态不同、职责不重叠，
 * 故并存而不是改写既有目录。
 *
 * 安全边界（重要）：本模块**只把 scripts/ 当文本资源存**，从不执行其中任何内容。
 * 没有 `terminal` 工具，技能也无法自己跑起来——写入技能不构成提权路径。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { atomicWriteFileSync } from '@mozhou/data-plane'

/** 技能标识：英文小写连字符（与跨平台路径约定一致）。 */
const SKILL_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SKILL_FILE = 'SKILL.md'
const RESOURCE_DIRS = ['scripts', 'references', 'assets'] as const
export type SkillResourceKind = (typeof RESOURCE_DIRS)[number]

export interface SkillFrontMatter {
  readonly name: string
  readonly description: string
  readonly version: string
  readonly license: string
  /** frontmatter 里除保留键外的其余键（原样保留，不解释语义）。 */
  readonly extra: Readonly<Record<string, string>>
}

export interface SkillSummary {
  readonly id: string
  /** frontmatter 的 name（展示名）。 */
  readonly name: string
  readonly description: string
  readonly version: string
  readonly license: string
  readonly resources: Readonly<Record<SkillResourceKind, number>>
}

export interface SkillRecord extends SkillSummary {
  /** SKILL.md 的正文（frontmatter 之后的部分）。按需加载时才返回。 */
  readonly body: string
  readonly dir: string
}

export class SkillError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'SkillError'
  }
}

/**
 * 解析 SKILL.md：`---` 包住的 frontmatter + 正文。
 *
 * 手写解析而不是引三方 YAML：本约定只用「`key: value` 与 `[a, b]` 列表」两种形态，
 * 手写可精确控制拒绝行为（缺 name/description 必须显式失败，不能静默给默认值）。
 */
export function parseSkillMarkdown(text: string): { readonly meta: SkillFrontMatter; readonly body: string } {
  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) {
    throw new SkillError(400, 'SKILL_FRONTMATTER_MISSING', 'SKILL.md 必须以 --- 开头的 frontmatter 开始')
  }
  const end = normalized.indexOf('\n---', 3)
  if (end < 0) {
    throw new SkillError(400, 'SKILL_FRONTMATTER_UNTERMINATED', 'SKILL.md 的 frontmatter 没有结束的 ---')
  }
  const rawFront = normalized.slice(4, end)
  // frontmatter 与正文之间习惯留一个空行：剥掉正文开头的空行，避免正文凭空多出前导换行。
  const body = normalized.slice(end + 4).replace(/^\n+/, '')

  const fields: Record<string, string> = {}
  for (const line of rawFront.split('\n')) {
    const trimmedLine = line.trim()
    if (trimmedLine === '' || trimmedLine.startsWith('#')) continue
    const colon = trimmedLine.indexOf(':')
    if (colon <= 0) {
      throw new SkillError(400, 'SKILL_FRONTMATTER_INVALID', `frontmatter 行无法解析：${trimmedLine}`)
    }
    const key = trimmedLine.slice(0, colon).trim()
    let value = trimmedLine.slice(colon + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    fields[key] = value
  }

  const name = (fields['name'] ?? '').trim()
  const description = (fields['description'] ?? '').trim()
  if (name === '') throw new SkillError(400, 'SKILL_NAME_REQUIRED', 'frontmatter 缺少 name')
  if (description === '') {
    throw new SkillError(400, 'SKILL_DESCRIPTION_REQUIRED', 'frontmatter 缺少 description（触发关键词靠它命中）')
  }
  const version = fields['version']
  const license = fields['license']
  const extra = { ...fields }
  delete extra['name']
  delete extra['description']
  delete extra['version']
  delete extra['license']
  return {
    meta: {
      name,
      description,
      version: (version ?? '1.0.0').trim() || '1.0.0',
      license: (license ?? '').trim(),
      extra,
    },
    body,
  }
}

/** 组装 SKILL.md 文本（写入用；与解析器互为逆操作）。 */
export function renderSkillMarkdown(meta: SkillFrontMatter, body: string): string {
  const lines = ['---', `name: ${meta.name}`, `description: ${meta.description}`, `version: ${meta.version}`]
  if (meta.license !== '') lines.push(`license: ${meta.license}`)
  for (const [k, v] of Object.entries(meta.extra)) lines.push(`${k}: ${v}`)
  lines.push('---', '')
  return `${lines.join('\n')}\n${body.replace(/^\n+/, '')}`
}

export interface SkillStoreOptions {
  /** 技能根目录；不存在时按需创建。 */
  readonly root: string
}

export interface SkillWriteInput {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly version?: string
  readonly license?: string
  readonly body: string
  /** 可选资源：相对路径 → 文本内容。只允许落在 scripts/references/assets 之下。 */
  readonly resources?: Readonly<Record<string, string>>
}

function countResources(dir: string): Record<SkillResourceKind, number> {
  const out: Record<SkillResourceKind, number> = { scripts: 0, references: 0, assets: 0 }
  for (const kind of RESOURCE_DIRS) {
    const sub = join(dir, kind)
    if (!existsSync(sub)) continue
    try {
      out[kind] = readdirSync(sub).filter((name) => {
        const p = join(sub, name)
        return existsSync(p) && statSync(p).isFile()
      }).length
    } catch {
      out[kind] = 0
    }
  }
  return out
}

export class SkillStore {
  private readonly root: string

  constructor(options: SkillStoreOptions) {
    this.root = resolve(options.root)
  }

  get skillsRoot(): string {
    return this.root
  }

  /** 列出全部技能摘要。**只给 name + description**，正文不返回（按需加载）。 */
  list(): readonly SkillSummary[] {
    if (!existsSync(this.root)) return []
    const out: SkillSummary[] = []
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const skill = this.read(entry.name)
      if (skill !== null) {
        out.push({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          version: skill.version,
          license: skill.license,
          resources: skill.resources,
        })
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id))
  }

  /** 读取单个技能全文（正文 + 资源计数）。不存在或格式非法返回 null。 */
  read(id: string): SkillRecord | null {
    if (!SKILL_ID_RE.test(id)) return null
    const dir = join(this.root, id)
    const file = join(dir, SKILL_FILE)
    if (!existsSync(file)) return null
    let parsed: { meta: SkillFrontMatter; body: string }
    try {
      parsed = parseSkillMarkdown(readFileSync(file, 'utf8'))
    } catch {
      return null
    }
    return {
      id,
      name: parsed.meta.name,
      description: parsed.meta.description,
      version: parsed.meta.version,
      license: parsed.meta.license,
      resources: countResources(dir),
      body: parsed.body,
      dir,
    }
  }

  /** 新建或覆盖一个技能。资源路径越界即拒绝（不允许写到三类资源目录之外）。 */
  write(input: SkillWriteInput): SkillRecord {
    if (!SKILL_ID_RE.test(input.id)) {
      throw new SkillError(400, 'SKILL_ID_INVALID', '技能 id 必须是小写字母数字与连字符（如 my-skill）')
    }
    const dir = join(this.root, input.id)
    mkdirSync(dir, { recursive: true })
    atomicWriteFileSync(
      join(dir, SKILL_FILE),
      renderSkillMarkdown(
        {
          name: input.name.trim(),
          description: input.description.trim(),
          version: (input.version ?? '1.0.0').trim() || '1.0.0',
          license: (input.license ?? '').trim(),
          extra: {},
        },
        input.body,
      ),
    )
    for (const [relPath, content] of Object.entries(input.resources ?? {})) {
      const target = resolve(dir, relPath)
      const insideResourceDir = RESOURCE_DIRS.some((kind) => target.startsWith(join(dir, kind) + sep))
      if (!insideResourceDir) {
        throw new SkillError(400, 'SKILL_RESOURCE_OUTSIDE', `资源路径必须位于 scripts/ references/ assets/ 之下：${relPath}`)
      }
      mkdirSync(resolve(target, '..'), { recursive: true })
      atomicWriteFileSync(target, content)
    }
    const record = this.read(input.id)
    if (record === null) throw new SkillError(500, 'SKILL_WRITE_UNCONFIRMED', '技能写入后回读失败')
    return record
  }

  remove(id: string): boolean {
    if (!SKILL_ID_RE.test(id)) return false
    const dir = join(this.root, id)
    if (!existsSync(dir)) return false
    rmSync(dir, { recursive: true, force: true })
    return !existsSync(dir)
  }
}
