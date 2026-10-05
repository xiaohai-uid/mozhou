/**
 * 漫剧分镜 V1 共享模型（T02 契约）。
 *
 * 移入 shared/：供 UI 与 server 共享引用，browser-safe。
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
  readonly generation: { readonly provider: string; readonly model: string }
}
