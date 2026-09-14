/**
 * 漫剧分镜 V1 契约（真源）：类型 + 运行时校验器 + 上限。
 * 来源：交接包 storyboard.contract.ts（T02 冻结：类型/校验器/路由/客户端同票交付）。
 *
 * 安全纪律：
 * - 模型输出按不可信 JSON 校验（本文件校验器是唯一入口），不信任任何客户端/模型
 *   声明的 root、路径、书身份、revision 或总时长；
 * - 服务端决定书身份（bookId）、源 hash、文件路径、id、revision 与总时长求和；
 * - 结构校验通过 ≠ 改编内容忠实；内容仍需作者审阅，不自动写入正典。
 * - 改编是独立衍生作品：不修改小说正文、Canon、质量门或 Chapter Commit。
 */

export const STORYBOARD_SCHEMA_VERSION = 1

/** V1 上限（brief.storyboard.generation）：超限明确拒绝，禁止静默截断。 */
export const STORYBOARD_LIMITS = {
  maxSourceCharacters: 12000,
  maxShots: 60,
  maxResponseBytes: 262144,
  maxCharacters: 50,
  maxDialoguePerShot: 20,
  maxExcerptCharacters: 400,
} as const

export type AspectRatio = '9:16' | '16:9' | '1:1'
export type ShotFraming = 'wide' | 'medium' | 'close' | 'detail'
export type AdaptationOrigin = 'source' | 'adaptation'

export interface SourceSnapshot {
  readonly bookId: string
  readonly chapterIndex: number
  readonly revision: number
  readonly phase: 'draft' | 'committed'
  /** 服务端从磁盘原文字节计算，不信任模型或客户端声明。 */
  readonly sha256: string
}

export interface AdaptationOptions {
  readonly aspectRatio: AspectRatio
  /** 目标而非实际生成视频时长；成片时长尚不存在。 */
  readonly targetDurationSeconds: number
  readonly visualStyle: string
  readonly language: 'zh-CN'
}

export interface CharacterReference {
  readonly id: string
  readonly name: string
  readonly appearance: string
  readonly sourceEntityRef?: string
  /** 改编补充的人物须标记 origin=adaptation。 */
  readonly origin: AdaptationOrigin
}

export interface ShotDialogueLine {
  readonly speakerId: string
  readonly text: string
}

export interface Shot {
  readonly id: string
  readonly sceneId: string
  readonly order: number
  readonly location: string
  readonly timeOfDay: string
  readonly framing: ShotFraming
  readonly cameraMovement: string
  /** 可拍摄画面与动作，不能只复制心理描写。 */
  readonly visual: string
  readonly characterIds: readonly string[]
  readonly dialogue: readonly ShotDialogueLine[]
  readonly narration: string
  readonly sound: string
  /** 校验有限且>0；最终成片时长尚不存在。 */
  readonly estimatedDurationSeconds: number
  readonly imagePrompt: string
  readonly videoPrompt: string
  readonly negativePrompt: string
  /** origin=source 时必须能在对应 source 快照原文中找到（新鲜时强校验）。 */
  readonly sourceQuote: string
  readonly origin: AdaptationOrigin
  /** 新增/合并/省略及心理描写外化的解释。 */
  readonly adaptationNote: string
}

export interface StoryboardContent {
  readonly title: string
  readonly characters: readonly CharacterReference[]
  readonly shots: readonly Shot[]
  readonly warnings: readonly string[]
}

export interface StoryboardDocument extends StoryboardContent {
  readonly schemaVersion: typeof STORYBOARD_SCHEMA_VERSION
  /** 服务端生成，绝不作为任意路径使用（存盘前按 sb_<ULID> 严格校验）。 */
  readonly id: string
  readonly revision: number
  readonly source: SourceSnapshot
  readonly options: AdaptationOptions
  /** 服务端求和，不采用模型自报。 */
  readonly totalEstimatedDurationSeconds: number
  readonly createdAt: string
  readonly updatedAt: string
  /** 不含密钥/完整请求头。 */
  readonly generation: { readonly provider: string; readonly model: string }
}

/** 服务端铸造的分镜文档 id：sb_ + 单调 ULID（Crockford Base32，无 I/L/O/U）。 */
export const STORYBOARD_ID_PATTERN = /^sb_[0-9A-HJKMNP-TV-Z]{26}$/

const SHA256_PATTERN = /^[0-9a-f]{64}$/
const LOCAL_ID_PATTERN = /^[a-z0-9_]{1,64}$/

export class StoryboardValidationError extends Error {
  override readonly name = 'StoryboardValidationError'
  constructor(readonly issues: readonly string[]) {
    super(`storyboard document invalid: ${issues.length} issue(s)`)
  }
}

/* ---------------------------------------------------------------------------
 * 不可信输入校验（唯一入口）。逐字段白名单式检查；不做隐式类型矫正。
 * ------------------------------------------------------------------------- */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown, max: number, label: string, issues: string[], opts: { optional?: boolean; allowEmpty?: boolean } = {}): string | undefined {
  if (value === undefined) {
    if (opts.optional) return undefined
    issues.push(`${label} missing`)
    return undefined
  }
  if (typeof value !== 'string') {
    issues.push(`${label} must be string`)
    return undefined
  }
  if (!opts.allowEmpty && value.trim() === '') {
    if (opts.optional) return undefined
    issues.push(`${label} must be non-empty`)
    return undefined
  }
  if (value.length > max) {
    issues.push(`${label} exceeds ${max} chars`)
    return undefined
  }
  return value
}

function int(value: unknown, min: number, max: number, label: string, issues: string[]): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    issues.push(`${label} must be integer in [${min}, ${max}]`)
    return undefined
  }
  return value
}

function finite(value: unknown, min: number, max: number, label: string, issues: string[]): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    issues.push(`${label} must be finite number in [${min}, ${max}]`)
    return undefined
  }
  return value
}

function enumOf<T extends string>(value: unknown, allowed: readonly T[], label: string, issues: string[]): T | undefined {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    issues.push(`${label} must be one of ${allowed.join('|')}`)
    return undefined
  }
  return value as T
}

/** 校验完整分镜文档（结构 + 上限 + 引用完整性）。非法即抛，绝不矫正。 */
export function validateStoryboardDocument(value: unknown): StoryboardDocument {
  const issues: string[] = []
  if (!isPlainObject(value)) {
    throw new StoryboardValidationError(['document must be a JSON object'])
  }

  const schemaVersion = int(value['schemaVersion'], STORYBOARD_SCHEMA_VERSION, STORYBOARD_SCHEMA_VERSION, 'schemaVersion', issues)
  const id = str(value['id'], 64, 'id', issues)
  if (id !== undefined && !STORYBOARD_ID_PATTERN.test(id)) {
    issues.push('id must match sb_<ULID>')
  }
  const revision = int(value['revision'], 0, 1_000_000, 'revision', issues)

  const sourceRaw = value['source']
  let source: SourceSnapshot | undefined
  if (!isPlainObject(sourceRaw)) {
    issues.push('source must be object')
  } else {
    const bookId = str(sourceRaw['bookId'], 200, 'source.bookId', issues)
    const chapterIndex = int(sourceRaw['chapterIndex'], 1, 100_000, 'source.chapterIndex', issues)
    const srcRevision = int(sourceRaw['revision'], 0, 1_000_000, 'source.revision', issues)
    const phase = enumOf(sourceRaw['phase'], ['draft', 'committed'] as const, 'source.phase', issues)
    const sha = str(sourceRaw['sha256'], 64, 'source.sha256', issues)
    if (sha !== undefined && !SHA256_PATTERN.test(sha)) {
      issues.push('source.sha256 must be lowercase hex64')
    }
    if (bookId !== undefined && chapterIndex !== undefined && srcRevision !== undefined && phase !== undefined && sha !== undefined) {
      source = { bookId, chapterIndex, revision: srcRevision, phase, sha256: sha }
    }
  }

  const optionsRaw = value['options']
  let options: AdaptationOptions | undefined
  if (!isPlainObject(optionsRaw)) {
    issues.push('options must be object')
  } else {
    const aspectRatio = enumOf(optionsRaw['aspectRatio'], ['9:16', '16:9', '1:1'] as const, 'options.aspectRatio', issues)
    const targetDuration = finite(optionsRaw['targetDurationSeconds'], 1, 3600, 'options.targetDurationSeconds', issues)
    const visualStyle = str(optionsRaw['visualStyle'], 200, 'options.visualStyle', issues)
    const language = enumOf(optionsRaw['language'], ['zh-CN'] as const, 'options.language', issues)
    if (aspectRatio !== undefined && targetDuration !== undefined && visualStyle !== undefined && language !== undefined) {
      options = { aspectRatio, targetDurationSeconds: targetDuration, visualStyle, language }
    }
  }

  const title = str(value['title'], 200, 'title', issues)

  const characters: CharacterReference[] = []
  const charIds = new Set<string>()
  const charactersRaw = value['characters']
  if (!Array.isArray(charactersRaw)) {
    issues.push('characters must be array')
  } else {
    if (charactersRaw.length > STORYBOARD_LIMITS.maxCharacters) {
      issues.push(`characters exceeds ${STORYBOARD_LIMITS.maxCharacters}`)
    }
    for (const [i, raw] of charactersRaw.entries()) {
      if (!isPlainObject(raw)) { issues.push(`characters[${i}] must be object`); continue }
      const cid = str(raw['id'], 64, `characters[${i}].id`, issues)
      const name = str(raw['name'], 100, `characters[${i}].name`, issues)
      const appearance = str(raw['appearance'], 2000, `characters[${i}].appearance`, issues)
      const sourceEntityRef = str(raw['sourceEntityRef'], 200, `characters[${i}].sourceEntityRef`, issues, { optional: true })
      const origin = enumOf(raw['origin'], ['source', 'adaptation'] as const, `characters[${i}].origin`, issues)
      if (cid === undefined || name === undefined || appearance === undefined || origin === undefined) continue
      if (charIds.has(cid)) { issues.push(`characters[${i}].id duplicated: ${cid}`); continue }
      charIds.add(cid)
      characters.push(sourceEntityRef !== undefined
        ? { id: cid, name, appearance, sourceEntityRef, origin }
        : { id: cid, name, appearance, origin })
    }
  }

  const shots: Shot[] = []
  const shotIds = new Set<string>()
  const shotsRaw = value['shots']
  if (!Array.isArray(shotsRaw)) {
    issues.push('shots must be array')
  } else {
    if (shotsRaw.length > STORYBOARD_LIMITS.maxShots) {
      issues.push(`shots exceeds ${STORYBOARD_LIMITS.maxShots}`)
    }
    for (const [i, raw] of shotsRaw.entries()) {
      const shot = validateShot(raw, i, charIds, shotIds, issues)
      if (shot !== undefined) {
        shotIds.add(shot.id)
        shots.push(shot)
      }
    }
    // 镜头序必须恰为 1..N 连续唯一（人工编辑与导出都依赖稳定顺序）。
    const orders = shots.map((s) => s.order)
    const expected = shots.map((_, idx) => idx + 1)
    if (!(orders.length === expected.length && orders.every((o, idx) => o === expected[idx]))) {
      issues.push('shots order must be contiguous 1..N without duplicates')
    }
  }

  const warningsRaw = value['warnings']
  const warnings: string[] = []
  if (!Array.isArray(warningsRaw)) {
    issues.push('warnings must be array')
  } else {
    for (const [i, w] of warningsRaw.entries()) {
      const item = str(w, 500, `warnings[${i}]`, issues)
      if (item !== undefined) warnings.push(item)
    }
  }

  const generationRaw = value['generation']
  let generation: StoryboardDocument['generation'] | undefined
  if (!isPlainObject(generationRaw)) {
    issues.push('generation must be object')
  } else {
    const provider = str(generationRaw['provider'], 100, 'generation.provider', issues)
    const model = str(generationRaw['model'], 200, 'generation.model', issues)
    if (provider !== undefined && model !== undefined) generation = { provider, model }
  }

  const createdAt = str(value['createdAt'], 40, 'createdAt', issues)
  const updatedAt = str(value['updatedAt'], 40, 'updatedAt', issues)
  // totalEstimatedDurationSeconds 只作占位校验；真值由服务端按镜头求和重算（可为小数）。
  finite(value['totalEstimatedDurationSeconds'], 0, 2_147_483, 'totalEstimatedDurationSeconds', issues)

  if (issues.length > 0 || source === undefined || options === undefined || generation === undefined
    || title === undefined || id === undefined || revision === undefined
    || schemaVersion === undefined || createdAt === undefined || updatedAt === undefined) {
    throw new StoryboardValidationError(issues.length > 0 ? issues : ['document incomplete'])
  }

  return {
    schemaVersion: STORYBOARD_SCHEMA_VERSION,
    id, revision, title,
    characters, shots, warnings,
    source, options, generation,
    totalEstimatedDurationSeconds: value['totalEstimatedDurationSeconds'] as number,
    createdAt, updatedAt,
  }
}

function validateShot(
  raw: unknown,
  index: number,
  charIds: ReadonlySet<string>,
  shotIds: ReadonlySet<string>,
  issues: string[],
): Shot | undefined {
  const label = `shots[${index}]`
  if (!isPlainObject(raw)) { issues.push(`${label} must be object`); return undefined }

  const id = str(raw['id'], 64, `${label}.id`, issues)
  if (id !== undefined) {
    if (!LOCAL_ID_PATTERN.test(id)) issues.push(`${label}.id must match ${LOCAL_ID_PATTERN}`)
    if (shotIds.has(id)) issues.push(`${label}.id duplicated: ${id}`)
  }
  const sceneId = str(raw['sceneId'], 64, `${label}.sceneId`, issues)
  const order = int(raw['order'], 1, STORYBOARD_LIMITS.maxShots, `${label}.order`, issues)
  const location = str(raw['location'], 200, `${label}.location`, issues)
  const timeOfDay = str(raw['timeOfDay'], 50, `${label}.timeOfDay`, issues)
  const framing = enumOf(raw['framing'], ['wide', 'medium', 'close', 'detail'] as const, `${label}.framing`, issues)
  const cameraMovement = str(raw['cameraMovement'], 200, `${label}.cameraMovement`, issues)
  const visual = str(raw['visual'], 2000, `${label}.visual`, issues)
  const narration = str(raw['narration'], 2000, `${label}.narration`, issues, { allowEmpty: true })
  const sound = str(raw['sound'], 200, `${label}.sound`, issues, { allowEmpty: true })
  const duration = finite(raw['estimatedDurationSeconds'], Number.EPSILON, 600, `${label}.estimatedDurationSeconds`, issues)
  const imagePrompt = str(raw['imagePrompt'], 2000, `${label}.imagePrompt`, issues, { allowEmpty: true })
  const videoPrompt = str(raw['videoPrompt'], 2000, `${label}.videoPrompt`, issues, { allowEmpty: true })
  const negativePrompt = str(raw['negativePrompt'], 1000, `${label}.negativePrompt`, issues, { allowEmpty: true })
  const sourceQuote = str(raw['sourceQuote'], 500, `${label}.sourceQuote`, issues, { allowEmpty: true })
  const adaptationNote = str(raw['adaptationNote'], 1000, `${label}.adaptationNote`, issues, { allowEmpty: true })
  const origin = enumOf(raw['origin'], ['source', 'adaptation'] as const, `${label}.origin`, issues)

  const characterIds: string[] = []
  const characterIdsRaw = raw['characterIds']
  if (!Array.isArray(characterIdsRaw)) {
    issues.push(`${label}.characterIds must be array`)
  } else {
    for (const [j, ref] of characterIdsRaw.entries()) {
      if (typeof ref !== 'string' || !charIds.has(ref)) {
        issues.push(`${label}.characterIds[${j}] not a known character id`)
      } else if (!characterIds.includes(ref)) {
        characterIds.push(ref)
      }
    }
  }

  const dialogue: ShotDialogueLine[] = []
  const dialogueRaw = raw['dialogue']
  if (!Array.isArray(dialogueRaw)) {
    issues.push(`${label}.dialogue must be array`)
  } else {
    if (dialogueRaw.length > STORYBOARD_LIMITS.maxDialoguePerShot) {
      issues.push(`${label}.dialogue exceeds ${STORYBOARD_LIMITS.maxDialoguePerShot}`)
    }
    for (const [j, line] of dialogueRaw.entries()) {
      if (!isPlainObject(line)) { issues.push(`${label}.dialogue[${j}] must be object`); continue }
      const speakerId = str(line['speakerId'], 64, `${label}.dialogue[${j}].speakerId`, issues)
      const text = str(line['text'], 1000, `${label}.dialogue[${j}].text`, issues)
      if (speakerId === undefined || text === undefined) continue
      if (!charIds.has(speakerId)) {
        issues.push(`${label}.dialogue[${j}].speakerId not a known character id`)
        continue
      }
      dialogue.push({ speakerId, text })
    }
  }

  if (origin === 'source' && (sourceQuote === undefined || sourceQuote.trim() === '')) {
    issues.push(`${label}.sourceQuote required when origin=source`)
  }

  if (id === undefined || sceneId === undefined || order === undefined || location === undefined
    || timeOfDay === undefined || framing === undefined || cameraMovement === undefined
    || visual === undefined || narration === undefined || sound === undefined || duration === undefined
    || imagePrompt === undefined || videoPrompt === undefined || negativePrompt === undefined
    || sourceQuote === undefined || adaptationNote === undefined || origin === undefined
    || characterIdsRaw === undefined || dialogueRaw === undefined) {
    return undefined
  }
  return {
    id, sceneId, order, location, timeOfDay, framing, cameraMovement, visual,
    characterIds, dialogue, narration, sound,
    estimatedDurationSeconds: duration,
    imagePrompt, videoPrompt, negativePrompt,
    sourceQuote, origin, adaptationNote,
  }
}

/** 服务端真值：总时长 = 各镜头估计时长的和（2 位小数），绝不采信模型/客户端自报。 */
export function sumEstimatedDuration(shots: readonly Shot[]): number {
  const total = shots.reduce((acc, shot) => acc + shot.estimatedDurationSeconds, 0)
  return Math.round(total * 100) / 100
}
