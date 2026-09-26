/**
 * 实体卡目录层 CRUD（工单 #16 / T2；冻结语义见 entity-directory-spec）：
 *
 *   - canon 文件真源：设定/<五目>/<slug>.md，frontmatter 即目录卡 Schema（§3）；
 *     文件名只是皮——文件名取 ref 的 slug 段，重命名/移动不断链（§4.5）。
 *   - write-through 刷投影：canon 写成功 ⇒ 同一逻辑操作内同步 entity_cards 行，
 *     失败即报错不留脏窗口（S1/Q3）；行形与重建灌入严格一致。
 *   - S3 写前校验：改/删之前核对盘上 hash 是否等于基线；不等即挂起（转介对账归 T5）。
 *   - 身份纪律：ref 一经引用即冻结、全书唯一（D2）；改名只动 name/别名表（§4.2——
 *     新显示名自动入检测表、旧显示名追加为 exact 别名）。
 *   - tags 永不入投影（D4）；正文区人读自由、永不整体入包（D3）。
 */
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { AiContextTier, AliasRule, EntityRef } from '@mozhou/kernel'
import type { Database } from 'better-sqlite3'
import { atomicWriteFileSync } from './atomic-write.js'
import { CanonStructureError, parseEntityRef, scanEntityCards, type EntityCardScan } from './canon-read.js'
import {
  ENTITY_CARD_DIR_BY_PREFIX,
  type EntityRefPrefix,
} from './layout.js'
import { refreshManifestEntries, writeManifest, type HashManifest } from './manifest.js'
import { deleteEntityCardRows, syncEntityCardRows } from './projection.js'
import { emitFrontmatter, parseFrontmatter, type FrontmatterFieldValue } from './yaml-frontmatter.js'
import { sha256FileHex } from './sha256.js'

/** 与 chapter 相位机 PlaneContext 结构等价（manifest 由操作原地刷新）。 */
export interface EntityCardWriteContext {
  readonly root: string
  readonly db: Database
  manifest: HashManifest
}

export class EntityCardValidationError extends Error {
  override readonly name = 'EntityCardValidationError'

  constructor(detail: string) {
    super(`entity card validation failed: ${detail}`)
  }
}

export class DuplicateEntityRefError extends Error {
  override readonly name = 'DuplicateEntityRefError'

  constructor(readonly ref: string) {
    super(`entity ref already exists (frozen identity, D2): ${ref}`)
  }
}

export class EntityCardNotFoundError extends Error {
  override readonly name = 'EntityCardNotFoundError'

  constructor(readonly ref: string) {
    super(`no entity card for ref: ${ref}`)
  }
}

/** S3 写前校验失败：盘上内容 ≠ 应用基线，挂起本次写入转介对账（T5 接线）。 */
export class CardPreWriteMismatchError extends Error {
  override readonly name = 'CardPreWriteMismatchError'

  constructor(readonly relPath: string, detail: string) {
    super(`pre-write hash check failed for ${relPath}: ${detail}`)
  }
}

export interface EntityCardInput {
  /** 规范显示名（自动入 aliases 首位，作者可删）。 */
  readonly name: string
  readonly aiContext?: AiContextTier
  readonly aliases?: readonly AliasRule[]
  readonly excludedPhrases?: readonly string[]
  readonly brief?: string
  readonly tags?: readonly string[]
  /** 人读正文区；缺省播种 `# <name>` 标题。 */
  readonly body?: string
}

/** 更新补丁：字段缺省 = 不变；数组/brief 显式 `null` = 清除。ref 不可改（D2）。 */
export interface EntityCardPatch {
  readonly name?: string
  readonly aiContext?: AiContextTier
  readonly aliases?: readonly AliasRule[] | null
  readonly excludedPhrases?: readonly string[] | null
  readonly brief?: string | null
  readonly tags?: readonly string[] | null
  readonly body?: string
}

const AI_CONTEXT_TIERS: ReadonlySet<string> = new Set(['always', 'detected', 'detectedOff', 'never'])

/** 目录卡落盘相对路径（文件名只是皮：取 slug 段保证确定性与文件系统安全）。 */
export function entityCardFileRel(ref: EntityRef): string {
  const parsed = parseEntityRefOrThrow(ref)
  return `${ENTITY_CARD_DIR_BY_PREFIX[parsed.prefix]}/${parsed.slug}.md`
}

function parseEntityRefOrThrow(ref: string): { prefix: EntityRefPrefix; slug: string } {
  try {
    return parseEntityRef(ref)
  } catch (error) {
    throw error instanceof CanonStructureError ? new EntityCardValidationError((error as Error).message) : error
  }
}

/** 建卡时 name 自动入 aliases 首位（spec Q11；作者可删——更新整表替换时尊重作者）。 */
function withNameFirstAlias(name: string, aliases: readonly AliasRule[]): AliasRule[] {
  if (aliases.some((alias) => alias.text === name && alias.kind === 'exact')) {
    return [...aliases]
  }
  return [{ text: name, kind: 'exact' }, ...aliases]
}

function validateAliasRules(aliases: readonly AliasRule[]): void {
  for (const alias of aliases) {
    if (typeof alias.text !== 'string' || alias.text.length === 0) {
      throw new EntityCardValidationError('alias text must be a non-empty string')
    }
    if (alias.kind !== 'exact' && alias.kind !== 'regex') {
      throw new EntityCardValidationError(`alias kind must be 'exact'|'regex', got ${String(alias.kind)}`)
    }
    if (alias.caseSensitive !== undefined && typeof alias.caseSensitive !== 'boolean') {
      throw new EntityCardValidationError('alias caseSensitive must be boolean')
    }
    if (alias.kind === 'regex') {
      try {
        new RegExp(alias.text, alias.caseSensitive ? 'gu' : 'giu')
      } catch (error) {
        throw new EntityCardValidationError(`invalid alias regex "${alias.text}": ${(error as Error).message}`)
      }
    }
  }
}

function validateStrings(field: string, values: readonly string[]): void {
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new EntityCardValidationError(`${field} entries must be non-empty strings`)
    }
  }
}

/** 输入面校验 + 归一为扫描同构的 EntityCardScan（行形与 rebuild 灌入严格一致）。 */
function buildCardScan(ref: EntityRef, input: {
  readonly name: string
  readonly aiContext?: AiContextTier
  readonly aliases?: readonly AliasRule[]
  readonly excludedPhrases?: readonly string[]
  readonly brief?: string
  readonly tags?: readonly string[]
}, fileRel: string): EntityCardScan {
  const name = input.name
  if (typeof name !== 'string' || name.length === 0) {
    throw new EntityCardValidationError('name must be a non-empty string')
  }
  let aiContext: AiContextTier = 'detected'
  if (input.aiContext !== undefined) {
    if (!AI_CONTEXT_TIERS.has(input.aiContext)) {
      throw new EntityCardValidationError(`aiContext must be one of always|detected|detectedOff|never, got ${input.aiContext}`)
    }
    aiContext = input.aiContext
  }
  const aliases = input.aliases ?? []
  validateAliasRules(aliases)
  const excludedPhrases = input.excludedPhrases ?? []
  validateStrings('excludedPhrases', excludedPhrases)
  validateStrings('tags', input.tags ?? [])
  if (input.brief !== undefined && typeof input.brief !== 'string') {
    throw new EntityCardValidationError('brief must be a string')
  }

  return {
    ref,
    cardType: parseEntityRefOrThrow(ref).prefix,
    name,
    aiContext,
    aliases: withNameFirstAlias(name, aliases),
    excludedPhrases,
    brief: input.brief ?? null,
    tags: input.tags ?? [],
    fileRel,
  }
}

/** frontmatter 发射：冻结字段序 ref/name/aiContext/aliases/excludedPhrases/brief/tags。 */
function renderEntityCard(card: EntityCardScan, body: string): string {
  const fields: Record<string, FrontmatterFieldValue> = {
    ref: card.ref,
    name: card.name,
    aiContext: card.aiContext,
  }
  if (card.aliases.length > 0) {
    fields['aliases'] = card.aliases.map((alias) =>
      alias.caseSensitive === undefined
        ? { text: alias.text, kind: alias.kind }
        : { text: alias.text, kind: alias.kind, caseSensitive: alias.caseSensitive },
    )
  }
  if (card.excludedPhrases.length > 0) {
    fields['excludedPhrases'] = [...card.excludedPhrases]
  }
  if (card.brief !== null) {
    fields['brief'] = card.brief
  }
  if (card.tags.length > 0) {
    fields['tags'] = [...card.tags]
  }
  return `${emitFrontmatter(fields)}${body}`
}

/** S3 写前校验：目标文件必须同时在基线与盘上且 hash 一致。 */
function assertBaselineClean(manifest: HashManifest, root: string, relPath: string): void {
  const entry = manifest.files[relPath]
  const absolute = join(root, relPath)
  if (entry === undefined || !existsSync(absolute)) {
    throw new CardPreWriteMismatchError(relPath, 'target absent from baseline or disk')
  }
  if (statSync(absolute).size !== entry.bytes || sha256FileHex(absolute) !== entry.sha256) {
    throw new CardPreWriteMismatchError(relPath, 'disk content differs from app baseline')
  }
}

/**
 * 建 卡（规划·宪法层保存即落盘）：canon md 落盘 → 基线登记 → 投影行写入。
 * ref 全书唯一（含孤儿同名文件占用检测）；name 自动入 aliases 首位。
 */
export function createEntityCard(
  ctx: EntityCardWriteContext,
  ref: EntityRef,
  input: EntityCardInput,
): EntityCardScan {
  const fileRel = entityCardFileRel(ref)

  const existingRefs = new Set(scanEntityCards(ctx.root).map((card) => card.ref))
  if (existingRefs.has(ref) || existsSync(join(ctx.root, fileRel))) {
    throw new DuplicateEntityRefError(ref)
  }

  const card = buildCardScan(ref, input, fileRel)
  const body = input.body ?? `# ${card.name}\n`
  atomicWriteFileSync(join(ctx.root, fileRel), renderEntityCard(card, body))

  ctx.manifest = refreshManifestEntries(ctx.manifest, ctx.root, [fileRel])
  writeManifest(ctx.root, ctx.manifest)
  syncEntityCardRows(ctx.db, card)
  return card
}

/** 改卡：S3 校验 → 补丁合并（改名迁移别名表）→ 重写 canon → 基线/投影同步。 */
export function updateEntityCard(
  ctx: EntityCardWriteContext,
  ref: EntityRef,
  patch: EntityCardPatch,
): EntityCardScan {
  const current = scanEntityCards(ctx.root).find((card) => card.ref === ref)
  if (current === undefined) {
    throw new EntityCardNotFoundError(ref)
  }
  assertBaselineClean(ctx.manifest, ctx.root, current.fileRel)

  // 正文区人读自由（D3）：补丁未提及则原样保留
  const body = patch.body ?? parseFrontmatter(readFileSync(join(ctx.root, current.fileRel), 'utf8')).body

  const name = patch.name ?? current.name
  if (name.length === 0) {
    throw new EntityCardValidationError('name must be a non-empty string')
  }
  let aiContext = current.aiContext
  if (patch.aiContext !== undefined) {
    if (!AI_CONTEXT_TIERS.has(patch.aiContext)) {
      throw new EntityCardValidationError(`aiContext must be one of always|detected|detectedOff|never, got ${patch.aiContext}`)
    }
    aiContext = patch.aiContext
  }

  // 别名表：整表替换或清除；仅真实改名时做迁移辅助（新名确保可检测、旧名从原位
  // 摘出并追加为 exact 别名——spec §4.2。平时不自动回填，尊重作者把显示名移出检测集）
  let aliases: readonly AliasRule[] =
    patch.aliases === null ? [] : (patch.aliases ?? current.aliases)
  if (name !== current.name) {
    const withoutOld = aliases.filter((alias) => !(alias.text === current.name && alias.kind === 'exact'))
    aliases = withNameFirstAlias(name, withoutOld)
    if (!aliases.some((alias) => alias.text === current.name && alias.kind === 'exact')) {
      aliases = [...aliases, { text: current.name, kind: 'exact' }]
    }
  }
  validateAliasRules(aliases)

  const excludedPhrases =
    patch.excludedPhrases === null ? [] : (patch.excludedPhrases ?? current.excludedPhrases)
  validateStrings('excludedPhrases', excludedPhrases)
  const tags = patch.tags === null ? [] : (patch.tags ?? current.tags)
  validateStrings('tags', tags)
  const brief = patch.brief === null ? null : (patch.brief ?? current.brief)

  const merged: EntityCardScan = {
    ref,
    cardType: current.cardType,
    name,
    aiContext,
    aliases,
    excludedPhrases,
    brief,
    tags,
    fileRel: current.fileRel,
  }

  atomicWriteFileSync(join(ctx.root, merged.fileRel), renderEntityCard(merged, body))

  ctx.manifest = refreshManifestEntries(ctx.manifest, ctx.root, [merged.fileRel])
  writeManifest(ctx.root, ctx.manifest)
  syncEntityCardRows(ctx.db, merged)
  return merged
}

/** 删卡（§4.4 物理删）：S3 校验 → 删文件 → 基线摘除 → 投影行删除；追踪行原样保留。 */
export function deleteEntityCard(ctx: EntityCardWriteContext, ref: EntityRef): void {
  const current = scanEntityCards(ctx.root).find((card) => card.ref === ref)
  if (current === undefined) {
    throw new EntityCardNotFoundError(ref)
  }
  assertBaselineClean(ctx.manifest, ctx.root, current.fileRel)

  rmSync(join(ctx.root, current.fileRel))

  const files = { ...ctx.manifest.files }
  delete files[current.fileRel]
  ctx.manifest = { ...ctx.manifest, files }
  writeManifest(ctx.root, ctx.manifest)

  deleteEntityCardRows(ctx.db, ref)
}
