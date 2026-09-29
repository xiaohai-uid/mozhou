/**
 * 跨路由文件复用的错误码——客户端据此分支处理，所以它是一条**契约**，
 * 不是各文件自选的措辞。
 *
 * 为什么收口：'PROVIDER_UNAVAILABLE' 此前在 4 个路由文件各写一份字面量。
 * 四份拷贝里只要有一处改名或打错，界面就只在那一条路径上失去「AI 未配置」
 * 的正确呈现（多半退化成通用报错）。这种漂移不报错、测试也未必覆盖，
 * 恰恰是最贵的一类。
 *
 * 约定：只在**跨文件**重复且被客户端依赖的码登记于此；单文件内多次使用
 * 仍由该文件自持局部常量。
 */

/** 草稿 provider 未配置 / 不可用。客户端据此引导作者去设置页配 Key。 */
export const PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE'

/** 契约 404：盘上无此章。proseRoutes 与 storyboardRoutes 共用同一语义。 */
export const CHAPTER_MISSING = 'CHAPTER_MISSING'

/**
 * 401：hosted 模式下无已认证主体。此前这一判定只存在于 router.ts 的会话解析里；
 * 书级请求解码（bookRequest.ts）把它前置为显式拒答，因为「没有主体时该用哪一档
 * 凭据」在解码那一刻就已经是确定的，拖到生成端点才由 generationTarget 报
 * hosted_no_principal 属于事后补救。
 */
export const UNAUTHORIZED_PRINCIPAL = 'UNAUTHORIZED_PRINCIPAL'

/**
 * 400：书级请求形状非法（root 缺失 / chapterIndex 缺失或不是 ≥ 1 的整数）。
 * 此前 proseRoutes / pipelineRoutes / storyboardRoutes 各自的 400 连 code 字段都没有，
 * 只有一句自选英文；客户端无法区分「你少传了字段」与「盘上没这本书」。
 */
export const INVALID_BOOK_REQUEST = 'INVALID_BOOK_REQUEST'

/** 409：本章没有开放的生产会话（未开卷 / 已完成 / 已收卷）。pipelineRoutes 三处共用。 */
export const NO_OPEN_PRODUCTION_SESSION = 'NO_OPEN_PRODUCTION_SESSION'

/** 409：committed 章没有可重开/重提交的定稿。 */
export const CHAPTER_NOT_COMMITTED = 'CHAPTER_NOT_COMMITTED'

/** 409：定稿文件被外部改盘，写前哈希失配（proseRoutes 四处）。 */
export const PROSE_EXTERNAL_CHANGE = 'PROSE_EXTERNAL_CHANGE'

/** 409：作者所读 revision 已过期。响应另带 expectedRevision / currentRevision。 */
export const PROSE_REVISION_CONFLICT = 'PROSE_REVISION_CONFLICT'

/** 409：409 CHAPTER_EXISTS——并发新建同一章。 */
export const CHAPTER_EXISTS = 'CHAPTER_EXISTS'

/** 409：409 CHAPTER_COMMITTED——已定稿章拒绝普通保存。响应另带 commitId。 */
export const CHAPTER_COMMITTED = 'CHAPTER_COMMITTED'

/** 409：409 CANON_PROPOSAL_STALE——存在描述旧正文的未决提案，正典零写入。 */
export const CANON_PROPOSAL_STALE = 'CANON_PROPOSAL_STALE'

/** 409：409 CANON_PROPOSAL_PENDING——正典提案仍有未决项。 */
export const CANON_PROPOSAL_PENDING = 'CANON_PROPOSAL_PENDING'

/** 409：409 CONTINUITY_HARD_CONFLICT——连续性门禁硬冲突。 */
export const CONTINUITY_HARD_CONFLICT = 'CONTINUITY_HARD_CONFLICT'

/** 409：409 CHAPTER_ALREADY_COMMITTED——重复提交 / 成功响应丢失后重试（工单05 契约）。 */
export const CHAPTER_ALREADY_COMMITTED = 'CHAPTER_ALREADY_COMMITTED'

/** 409：409 RESUBMIT_SESSION_CONFLICT——重提交被单飞/已有活动会话拒绝。 */
export const RESUBMIT_SESSION_CONFLICT = 'RESUBMIT_SESSION_CONFLICT'

/** 409：409 PROPOSAL_DECISION_REJECTED——ProposalPort 拒绝该条决策。 */
export const PROPOSAL_DECISION_REJECTED = 'PROPOSAL_DECISION_REJECTED'

/** 409：409 PROPOSAL_DISCARD_REJECTED——放弃整份提案时被 Port 拒绝。 */
export const PROPOSAL_DISCARD_REJECTED = 'PROPOSAL_DISCARD_REJECTED'

/** 404：404 CANDIDATE_NOT_FOUND——候选不存在（或已过期）。 */
export const CANDIDATE_NOT_FOUND = 'CANDIDATE_NOT_FOUND'

/** 409：409 NO_COMPILED_RECEIPT——该章无 Context 编译凭证，拒绝编造评估锚点。 */
export const NO_COMPILED_RECEIPT = 'NO_COMPILED_RECEIPT'

/** 422：自动回炉次数超限（pipelineRoutes）。 */
export const QUALITY_REWORK_LIMIT_EXCEEDED = 'QualityReworkLimitExceeded'

/**
 * 500：按需补齐章脚手架失败（`/api/draft.stream` 首章生成路径）。
 * 存在它是因为**裸 ENOENT 不可行动**：作者看到「open …第0001章.md」无从下手。
 * 本码的含义是「服务端没能为这一章准备出章大纲节点 + 正文载体」——是作者该
 * 重试/上报的，而不是作者该自己去新建文件的。
 * 它**不替代** CHAPTER_MISSING：盘上完全没有这一章是正常首章态（服务端自己补齐），
 * 只有补齐本身失败才落到这里。
 */
export const CHAPTER_SCAFFOLD_FAILED = 'CHAPTER_SCAFFOLD_FAILED'
