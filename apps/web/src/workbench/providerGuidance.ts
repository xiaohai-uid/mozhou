/**
 * 「provider 不可用」时的**行动指引**（P2 缺陷「本机模型接入指引误导」）。
 *
 * 缺陷本体：/api/capabilities 只回一个布尔 providerAvailable，UI 对所有失败原因
 * 共用一句「请到『账户 → 模型设置』填入你的 API 密钥」。但本机部署
 * （MOZHOU_API_BASE=http://127.0.0.1:8317）失败的原因根本不是「没填密钥」——
 * 是 SSRF 门禁按设计拒绝了环回地址，要部署者显式设 MOZHOU_ALLOW_PRIVATE_LLM=1。
 * 把本机用户指引去填 BYOK 密钥，是让一个本机部署走它不该走的路；照着做也接不上本地模型。
 *
 * 为什么是纯函数而不是组件里的三元：这是**判据 → 文案**的映射，只有它可被单测
 * 直接断言（不必渲染、不必起服务、不碰网络）。文案一旦退化成散落在 JSX 里的分支，
 * 就没有任何测试能保证「本机用户看到的是放行指引」——而那正是本缺陷的全部要害。
 *
 * 纪律：**不得**据此给普通云端用户塞本机放行提示。云端用户（没配 provider、配置非法）
 * 只看到与自己相关的指引；本机放行提示只出现在 reason='provider_endpoint_blocked'
 * 这一条已被服务端门禁确认的路径上。
 */

/** 服务端给出的病因分类（与 server/llm/generationTarget.ts 同源；此处按值枚举，零运行时依赖）。 */
export type ProviderUnavailableReason =
  | 'hosted_no_principal'
  | 'no_provider_configured'
  | 'provider_config_invalid'
  | 'provider_endpoint_blocked'
  | 'mock'
  | 'available'

export interface ProviderGuidanceInput {
  /** 病因分类；缺省（老服务端未带该字段）按 no_provider_configured 处理。 */
  readonly reason?: ProviderUnavailableReason | null | undefined
  /** 病因原文。默认不展示——它是给排查看的，不该占据作者的主视线。 */
  readonly detail?: string | undefined
  /** 被拒的上游主机（仅 endpoint_blocked 有）。 */
  readonly blockedHost?: string | null | undefined
  /** 是否附上原文细节（排查时开；默认关）。 */
  readonly showDetail?: boolean | undefined
}

export interface ProviderGuidance {
  /** 短标题：一眼看出卡在哪一步。 */
  readonly headline: string
  /** 主体：唯一可行的下一步。 */
  readonly body: string
  /** 病因原文（仅 showDetail 且服务端给了 detail 时非空）。 */
  readonly detail: string
  /** 供测试与后续埋点用的稳定分类（与输入 reason 同值，缺省补 no_provider_configured）。 */
  readonly reason: ProviderUnavailableReason
}

/** 部署者放行本机私有 LLM 的既有开关名（apps/web/server/llm/tierRouting.ts PRIVATE_NETWORK_ENV）。 */
const ALLOW_PRIVATE_ENV = 'MOZHOU_ALLOW_PRIVATE_LLM'

const BYOK_HEADLINE = '尚未接入大模型'
const BYOK_BODY =
  '写作对话暂不可用。请到「账户 → 模型设置」填入你的 API 密钥，保存后回到这里重新生成即可。'

const BLOCKED_HEADLINE = '本机模型端点被安全门禁拦下'

/**
 * 按病因分类给出**与真实可行的下一步一致**的指引。
 *
 * 分支语义（每条都对应服务端一次真实的判定，不是文案口味）：
 *   - `provider_endpoint_blocked`：门禁已拒绝，配置本身没写错。要部署者显式放行。
 *     这是本缺陷的核心分支——它必须与 BYOK 指引**逐字不同**，否则本机用户仍被误导。
 *   - `provider_config_invalid`：配了但解析不出来（注册表结构非法/未登记/密钥缺失等）。
 *     下一步是查配置，不是去设置页重新填一遍。
 *   - `hosted_no_principal`：凭据隔离拒答，与「作者没配」无关，如实说明。
 *   - `no_provider_configured` 及缺省：真没配 provider ⇒ 指向 BYOK 设置页（原文案，成立）。
 *   - `available` / `mock`：不该走到这里（providerAvailable=true 时横幅根本不渲染），
 *     但返回中性文案而不是抛错，避免空横幅或崩溃。
 */
export function providerGuidance(input: ProviderGuidanceInput): ProviderGuidance {
  const reason: ProviderUnavailableReason = input.reason ?? 'no_provider_configured'
  const detail = input.showDetail === true && input.detail !== undefined ? input.detail : ''

  if (reason === 'provider_endpoint_blocked') {
    const host = input.blockedHost !== undefined && input.blockedHost !== null ? input.blockedHost : ''
    const hostClause = host === '' ? '已配置的端点' : `端点 ${host}`
    return {
      headline: BLOCKED_HEADLINE,
      body:
        `${hostClause} 位于本机/私有网络，出站安全门禁默认拒绝——这不是密钥问题，改填 API 密钥也接不上。` +
        `接本机模型请在启动墨舟的环境里设 ${ALLOW_PRIVATE_ENV}=1（与 MOZHOU_API_BASE 一起），重启后生效。` +
        `该开关只放宽到 http/https 且仍需显式开启；不确定就不设，门禁会继续拦下。`,
      detail,
      reason,
    }
  }

  if (reason === 'provider_config_invalid') {
    return {
      headline: '大模型配置已填写但不可用',
      body:
        '端点或密钥没能通过校验/解析（配置非法、provider 未登记、密钥环境变量缺失等）。' +
        '重新填一遍密钥不会改变结果——请按下方病因核对端点配置与对应环境变量。',
      detail,
      reason,
    }
  }

  if (reason === 'hosted_no_principal') {
    return {
      headline: '无法确定使用哪一份模型凭据',
      body: '当前部署需要登录身份才能取到属于你的模型凭据，本次请求被显式拒绝（避免跨账号串用密钥）。请登录后重试。',
      detail,
      reason,
    }
  }

  if (reason === 'available' || reason === 'mock') {
    return { headline: '大模型可用', body: '', detail, reason }
  }

  return { headline: BYOK_HEADLINE, body: BYOK_BODY, detail, reason }
}
