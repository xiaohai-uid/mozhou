/**
 * apps/web/server · 书级请求解码（工单07 ·「同一份请求被就地重写了 16 次」）。
 *
 * 为什么收口：截至本票，`typeof body['chapterIndex'] === 'number' ? … : null` 这条
 * 解析在 pipelineRoutes 9 处 / proseRoutes 5 处 / storyboardRoutes 2 处各写一份，
 * 校验条件却是**五种不同的写法**（有的只判 `typeof`，有的判 `< 1`，有的判
 * `Number.isInteger && >= 1`）。冻结规则其实只有一句——「chapterIndex 是 ≥ 1 的整数」，
 * 但每次加一个新端点，开发者都得重新猜一次该抄哪份，于是 `chapterIndex: 0` 与
 * `chapterIndex: 1.5` 在某些端点能穿过校验、落到数据平面上再炸。
 * 不变式留在每个调用方脑子里 = 不变式事实上不存在。
 *
 * 本模块把不变式提到**一处**：
 *   1. **root**：缺失 ⇒ 400；已授权书根 ⇒ 走 security.assertSafeBookRoot 的既有边界
 *      语义（400 NOT_A_MOZHOU_BOOK / 404 BOOK_ROOT_NOT_FOUND），不改其判定逻辑——
 *      本模块只保证调用方**不再各自写一遍**。
 *   2. **chapterIndex**：缺省 `required`（缺失 / 非整数 / < 1 ⇒ 400）；
 *      `/api/draft.accept` 传 `chapter: 'optional'`（候选自带章号时缺失合法）。
 *   3. **principal**：hosted 且无主体 ⇒ 401（凭据隔离的第一道闸，不等到真要调 LLM
 *      才由 generationTarget 报 hosted_no_principal）。
 *
 * 返回 `Result` 而非抛异常：路由在**任何动盘/调模型之前**就要能用 json() 回 4xx，
 * 抛出式 API 会把「这是普通的请求形状错误」和「这是内部故障」混在同一条 try 里。
 *
 * 收敛后的行为变化（显式记录，不隐瞒）：
 *   - session.open / session.advance / chapter.review / chapter.rework /
 *     chapter.corrections / chapter.quality 此前**只判 typeof**，因此 chapterIndex:0
 *     与 1.5 能穿过并进入管线；现在按冻结规则统一 400。
 *   - 400 的 error 文案从端点自选（'root and chapterIndex required' /
 *     'valid root and chapterIndex required' / 'root and integer chapterIndex >= 1
 *     required' 三种）收为按字段给出。客户端无任何按该文案分支的代码（已 grep 核对），
 *     OpenAPI 只描述「形状非法 400」，不断言字面量。
 */
import { assertSafeBookRoot, RequestBoundaryError } from './security.js'
import { INVALID_BOOK_REQUEST, NO_OPEN_PRODUCTION_SESSION, UNAUTHORIZED_PRINCIPAL } from './routeCodes.js'
import type { VerifiedPrincipal } from './auth/session.js'

/** 契约层错误：路由据此决定 HTTP 状态与 code，不把它当内部故障。 */
export interface ContractError {
  readonly status: number
  readonly code: string
  readonly error: string
}

/** 解码成功：已授权书根 + 规范化章号 + 请求主体。 */
export interface DecodedBookRequest<TChapter extends number | null = number> {
  /** 已过路径守卫与书权限的绝对书根。 */
  readonly root: string
  /** ≥ 1 的整数；`chapter: 'optional'` 且请求未带该字段时为 null。 */
  readonly chapterIndex: TChapter
  readonly principal: VerifiedPrincipal | null
}

export type DecodeBookRequestResult<TChapter extends number | null = number> =
  | { readonly ok: true; readonly value: DecodedBookRequest<TChapter> }
  | { readonly ok: false; readonly error: ContractError }

export interface DecodeBookRequestOptions {
  /** 缺省 'required'；'/api/draft.accept' 用 'optional'（候选自带章号）。 */
  readonly chapter?: 'required' | 'optional'
  /** 请求主体；hosted 模式下缺失 ⇒ 401（凭据隔离）。 */
  readonly principal?: VerifiedPrincipal | null | undefined
}

/** 400：书根缺失或类型非法。 */
export const ROOT_REQUIRED_MESSAGE = 'root required'

/** 400：章号缺失（required 模式）。 */
export const CHAPTER_INDEX_REQUIRED_MESSAGE = 'chapterIndex required'

/** 400：章号在场但不是 ≥ 1 的整数（0 / 负数 / 小数 / 字符串 / null 一律命中）。 */
export const CHAPTER_INDEX_INVALID_MESSAGE = 'chapterIndex must be an integer >= 1'

/** 401：hosted 且无主体。 */
export const PRINCIPAL_REQUIRED_MESSAGE =
  'authentication required: hosted 模式必须携带已认证主体（否则无法确定该用哪一档凭据）'

function fail(status: number, code: string, error: string): DecodeBookRequestResult<never> {
  return { ok: false, error: { status, code, error } }
}

/**
 * 解码一次书级请求。
 *
 * @param body 路由收到的已解析 JSON 体（router.ts 保证是 Record）
 * @param bookRoot 网关注入的书根（= authorizedBook.root ?? body.root）；null 表示未解析出
 * @param options 章号必选性与请求主体
 *
 * 重载把「章号必选/可选」映射到**不同的静态类型**：`'required'` ⇒ `number`（调用方不必
 * 重新判空），`'optional'` ⇒ `number | null`（/api/draft.accept 的候选自带章号）。
 * 这是本模块的实质收益之一——旧代码里 9 个调用点各自把 `number | null` 传进要求
 * `number` 的函数，全靠 `!Number.isInteger(...)` 的守卫在同一行把它窄化掉。
 */
export function decodeBookRequest(
  body: Record<string, unknown>,
  bookRoot: string | null | undefined,
  options?: DecodeBookRequestOptions & { readonly chapter?: 'required' },
): DecodeBookRequestResult<number>
export function decodeBookRequest(
  body: Record<string, unknown>,
  bookRoot: string | null | undefined,
  options: DecodeBookRequestOptions & { readonly chapter: 'optional' },
): DecodeBookRequestResult<number | null>
export function decodeBookRequest(
  body: Record<string, unknown>,
  bookRoot: string | null | undefined,
  options: DecodeBookRequestOptions = {},
): DecodeBookRequestResult<number | null> {
  const chapterMode = options.chapter ?? 'required'
  const principal = options.principal ?? null

  // 1. 主体（hosted 凭据隔离的第一道闸）。放在最前：没有主体时，后续任何对这本书的
  //    读写都无法确定归属，继续解码只是在为一次必然被拒的调用做准备。
  if (defaultHostedMode() && (principal === null || (principal.userId ?? '').length === 0)) {
    return fail(401, UNAUTHORIZED_PRINCIPAL, PRINCIPAL_REQUIRED_MESSAGE)
  }

  // 2. 书根：缺失是形状错误，已在场则交既有守卫判定授权/存在性。
  //    边界错误原样透出 status/code/message——本模块不重新解释「什么算一本书」。
  if (typeof bookRoot !== 'string' || bookRoot.trim().length === 0) {
    return fail(400, INVALID_BOOK_REQUEST, ROOT_REQUIRED_MESSAGE)
  }
  let root: string
  try {
    root = assertSafeBookRoot(bookRoot)
  } catch (cause) {
    if (cause instanceof RequestBoundaryError) {
      return fail(cause.status, cause.code, cause.message)
    }
    throw cause
  }

  // 3. 章号：冻结规则只有一条（≥ 1 的整数），各端点不再各写一份。
  const raw = body['chapterIndex']
  if (raw === undefined || raw === null) {
    if (chapterMode === 'optional') {
      return { ok: true, value: { root, chapterIndex: null, principal } }
    }
    return fail(400, INVALID_BOOK_REQUEST, CHAPTER_INDEX_REQUIRED_MESSAGE)
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    return fail(400, INVALID_BOOK_REQUEST, CHAPTER_INDEX_INVALID_MESSAGE)
  }

  return { ok: true, value: { root, chapterIndex: raw, principal } }
}

/**
 * 「本章没有开放的生产会话」——pipelineRoutes 三处逐字重复的 409（工单07 点名）。
 * 文案逐字保留（productionRoutes.test.ts 断言 'no open production session'），
 * 差别在于现在带上了契约 code，客户端可按码分支而不必匹配英文。
 */
export function noOpenProductionSessionError(chapterIndex: number): ContractError {
  return {
    status: 409,
    code: NO_OPEN_PRODUCTION_SESSION,
    error: 'chapter ' + chapterIndex + ' has no open production session',
  }
}

/** hosted 判据：进程内模式位 ∥ 注入 env（与 generationTarget.ts:isHosted 同款，便于测试注入）。 */
function defaultHostedMode(): boolean {
  return process.env['MOZHOU_HOSTED'] === 'true'
}
