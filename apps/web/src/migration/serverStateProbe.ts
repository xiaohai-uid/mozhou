/**
 * 服务端现状探针（P1-probe · 冲突判定输入）。
 *
 * 复用既有 `post<T>` 与既有端点，**不新增接口、不改契约**：
 * - `/api/chapter.prose` → 当前章的 `exists / revision / phase / body`；
 * - `/api/book.state`    → 作品存在性（能否读出 Canon 状态）。
 *
 * 为什么需要 `reachable`：迁移不得凭「读不到」推断「服务端为空」。探针失败时
 * `reachable=false`，导入计划据此保守地把该章判为冲突（保留双份、不覆盖），
 * 而不是当作「服务端无此章」直接写入。
 *
 * E01 补强：**格式不合法的应答与请求失败同待遇**（都返回 `reachable=false`）。
 * 只认「明确应答」——`ok === true` 且 `exists` 是布尔。缺字段的应答（如裸 `{ok:true}`）
 * 曾被读成「服务端无此章」，于是直接放行覆盖；合同要求未知 / 格式不合法 / 请求失败
 * 三者都不得当作「服务端为空」。
 */
import { post } from '../lib/post'
import { computeSha256Hex } from '../workbench/lib/sha256'

export interface ServerChapterState {
  /** 探针是否成功到达服务端。false 时其余字段无意义，调用方应保守处理。 */
  readonly reachable: boolean
  readonly exists: boolean
  readonly revision: number | null
  readonly phase: string | null
  /** 服务端正文的 SHA-256（用于与迁移包的草稿基线比对）。 */
  readonly bodySha256: string | null
}

export interface ServerBookState {
  readonly reachable: boolean
  readonly exists: boolean
}

export interface ProbeBookRef {
  readonly root: string
  readonly bookId?: string
}

export interface ServerStateProbe {
  queryChapter(book: ProbeBookRef, chapterIndex: number): Promise<ServerChapterState>
  queryBook(book: ProbeBookRef): Promise<ServerBookState>
}

export interface ServerStateProbeDeps {
  /** 注入 post（测试用）；默认使用既有 `../lib/post`。 */
  readonly postFn?: typeof post
  /** 注入正文哈希（测试用）；默认使用 Web Crypto 版 SHA-256。 */
  readonly hashFn?: (text: string) => Promise<string>
}

const UNREACHABLE_CHAPTER: ServerChapterState = {
  reachable: false,
  exists: false,
  revision: null,
  phase: null,
  bodySha256: null,
}

interface ChapterProseResponse {
  readonly ok?: boolean
  readonly exists?: boolean
  readonly chapterIndex?: number
  readonly revision?: number
  readonly phase?: string
  readonly body?: string
}

interface BookStateResponse {
  readonly ok?: boolean
  readonly state?: unknown
}

/** 构造探针。依赖可注入，便于测试不触网。 */
export function createServerStateProbe(deps: ServerStateProbeDeps = {}): ServerStateProbe {
  const postFn = deps.postFn ?? post
  const hashFn = deps.hashFn ?? computeSha256Hex

  return {
    async queryChapter(book: ProbeBookRef, chapterIndex: number): Promise<ServerChapterState> {
      let data: ChapterProseResponse
      try {
        data = await postFn<ChapterProseResponse>('/api/chapter.prose', {
          root: book.root,
          chapterIndex,
        })
      } catch {
        return UNREACHABLE_CHAPTER
      }
      // 只认明确应答：ok 必须为 true，exists 必须是布尔。缺字段 / 类型不对一律按「未知」，
      // 与请求失败同待遇（reachable=false）——绝不推断「服务端为空」。
      if (data.ok !== true || typeof data.exists !== 'boolean') {
        return UNREACHABLE_CHAPTER
      }
      if (data.exists === false) {
        return { reachable: true, exists: false, revision: null, phase: null, bodySha256: null }
      }
      // 声称存在却给不出合法 revision：现场不可信，按未知处理（不拿 null 当「无冲突」）。
      if (typeof data.revision !== 'number' || !Number.isInteger(data.revision)) {
        return UNREACHABLE_CHAPTER
      }
      const phase = typeof data.phase === 'string' ? data.phase : null
      const bodySha256 = typeof data.body === 'string' ? await hashFn(data.body) : null
      return { reachable: true, exists: true, revision: data.revision, phase, bodySha256 }
    },

    async queryBook(book: ProbeBookRef): Promise<ServerBookState> {
      try {
        const data = await postFn<BookStateResponse>('/api/book.state', { root: book.root })
        if (data.ok !== true) return { reachable: false, exists: false }
        return { reachable: true, exists: data.state !== undefined && data.state !== null }
      } catch {
        return { reachable: false, exists: false }
      }
    },
  }
}
