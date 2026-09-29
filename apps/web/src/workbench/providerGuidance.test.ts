/**
 * provider 指引分流的回归测试（P2 缺陷「本机模型接入指引误导」）。
 *
 * 断言目标是**判据 → 文案**的对应关系，逐条钉死：
 *   1. 本机端点被 SSRF 门禁拦下 ⇒ 提示必须讲 MOZHOU_ALLOW_PRIVATE_LLM，且**不得**
 *      叫用户去填 BYOK 密钥（这正是缺陷本体：那句话让本机部署走了一条走不通的路）。
 *   2. 真没配 provider ⇒ 仍然指向「账户 → 模型设置」填密钥（原文案必须不变，
 *      否则是把修复做成了对云端用户的回归）。
 *   3. 分类之间互不串味：云端用户**永远看不到**本机放行提示（否则是给无关用户塞
 *      无关提示——本票明令禁止的解法）。
 *   4. 缺省（老服务端不带 reason 字段）⇒ 退到 BYOK 指引，行为与修复前一致。
 *
 * 纯函数、零网络、零组件、零服务。
 */
import { describe, expect, it } from 'vitest'
import { providerGuidance } from './providerGuidance'

describe('providerGuidance（P2 · 本机模型接入指引）', () => {
  it('provider_endpoint_blocked：讲放行开关，且绝不把用户指引去填 BYOK 密钥', () => {
    const g = providerGuidance({ reason: 'provider_endpoint_blocked', blockedHost: '127.0.0.1' })

    // 必须点名真正的下一步
    expect(g.body).toContain('MOZHOU_ALLOW_PRIVATE_LLM=1')
    // 必须点名被拒的端点，让用户知道是哪个
    expect(g.body).toContain('127.0.0.1')
    // 缺陷本体的反面：这一句不能出现
    expect(g.body).not.toContain('账户 → 模型设置')
    expect(g.body).not.toContain('填入你的 API 密钥')
    // 并且要如实说明「填密钥也接不上」，避免用户继续在错的方向上试
    expect(g.body).toContain('改填 API 密钥也接不上')
    expect(g.reason).toBe('provider_endpoint_blocked')
  })

  it('provider_endpoint_blocked 且没有 blockedHost：仍给放行指引，不崩、不空文案', () => {
    const g = providerGuidance({ reason: 'provider_endpoint_blocked', blockedHost: null })
    expect(g.body).toContain('MOZHOU_ALLOW_PRIVATE_LLM=1')
    expect(g.body).toContain('已配置的端点')
    expect(g.body).not.toContain('账户 → 模型设置')
  })

  it('no_provider_configured：仍指向模型设置页填密钥（云端路径的原文案不得被改动）', () => {
    const g = providerGuidance({ reason: 'no_provider_configured' })
    expect(g.headline).toBe('尚未接入大模型')
    expect(g.body).toContain('账户 → 模型设置')
    expect(g.body).toContain('API 密钥')
    // 云端用户不得看到本机放行提示
    expect(g.body).not.toContain('MOZHOU_ALLOW_PRIVATE_LLM')
  })

  it('缺省 / null（老服务端只给 providerAvailable）⇒ 等同 no_provider_configured，向后兼容', () => {
    for (const reason of [undefined, null] as const) {
      const g = providerGuidance({ reason })
      expect(g.headline).toBe('尚未接入大模型')
      expect(g.body).toContain('账户 → 模型设置')
      expect(g.reason).toBe('no_provider_configured')
    }
  })

  it('provider_config_invalid：说「重新填密钥没用、去查配置」，且不提放行开关', () => {
    const g = providerGuidance({ reason: 'provider_config_invalid' })
    expect(g.headline).toBe('大模型配置已填写但不可用')
    expect(g.body).toContain('重新填一遍密钥不会改变结果')
    expect(g.body).not.toContain('MOZHOU_ALLOW_PRIVATE_LLM')
  })

  it('hosted_no_principal：说凭据隔离，不提模型设置也不提放行开关', () => {
    const g = providerGuidance({ reason: 'hosted_no_principal' })
    expect(g.body).toContain('登录')
    expect(g.body).not.toContain('MOZHOU_ALLOW_PRIVATE_LLM')
    expect(g.body).not.toContain('账户 → 模型设置')
  })

  it('任何非 endpoint_blocked 的分类都不得出现本机放行提示（防止无关用户被塞无关提示）', () => {
    const others = ['no_provider_configured', 'provider_config_invalid', 'hosted_no_principal', 'available', 'mock'] as const
    for (const reason of others) {
      const g = providerGuidance({ reason })
      // 「available/mock」是可达态（横幅不渲染），但仍不得声称要放行本机网络
      expect(`${g.headline}${g.body}`).not.toContain('MOZHOU_ALLOW_PRIVATE_LLM')
    }
  })

  it('detail 默认不展示（它是排查看的，不该占主视线）；showDetail 才带出', () => {
    const hidden = providerGuidance({ reason: 'provider_endpoint_blocked', detail: 'TIER_ROUTE_...@providers.x.baseURL' })
    expect(hidden.detail).toBe('')

    const shown = providerGuidance({
      reason: 'provider_endpoint_blocked',
      detail: 'TIER_ROUTE_...@providers.x.baseURL',
      showDetail: true,
    })
    expect(shown.detail).toContain('providers.x.baseURL')
  })
})
