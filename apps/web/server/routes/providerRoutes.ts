/**
 * apps/web · 模型端点设置与连接测试路由控制器 (Provider Routes · T07)。
 * 
 * 依照 reference/01-core.md T07 规格：
 * - GET /api/llm/settings：返回当前端点脱敏配置（不外泄明文 Key）；
 * - POST /api/llm/settings：更新端点配置（SSRF 校验、版本递增、安全加密落盘）；
 * - POST /api/llm/test：发起实际最小探针测试连接（返回延迟、模型名与脱敏状态）；
 * - POST /api/llm/settings/reset：重置端点配置；
 * - 每次退出或切换用户隔离生效。
 */
import type { RouteHandler } from '../router.js'
import { defaultProviderSettingsManager } from '../llm/providerSettings.js'
import { testConnection } from '../llm/openaiStream.js'

export const providerRoutes: RouteHandler = async (req, res, { path, body, json, principal }) => {
  const userId = principal?.userId

  if (path === '/api/llm/settings') {
    if (req.method === 'GET') {
      const masked = defaultProviderSettingsManager.getMaskedSettings(userId)
      json(200, { ok: true, settings: masked })
      return true
    }

    if (req.method === 'POST') {
      const rawKey = typeof body['apiKey'] === 'string' ? body['apiKey'].trim() : ''
      if (!rawKey) {
        json(400, { ok: false, code: 'INVALID_API_KEY', error: 'apiKey required' })
        return true
      }
      const baseUrl = typeof body['baseUrl'] === 'string' ? body['baseUrl'].trim() : undefined
      const model = typeof body['model'] === 'string' ? body['model'].trim() : undefined
      const providerId = typeof body['providerId'] === 'string' ? body['providerId'].trim() : undefined

      try {
        const saved = defaultProviderSettingsManager.saveSettings(
          { apiKey: rawKey, baseUrl, model, providerId },
          userId,
        )
        json(200, {
          ok: true,
          configVersion: saved.configVersion,
          model: saved.model,
          updatedAt: saved.updatedAt,
        })
      } catch (err) {
        json(400, { ok: false, code: 'SAVE_FAILED', error: (err as Error).message })
      }
      return true
    }
  }

  if (path === '/api/llm/test' && req.method === 'POST') {
    // 优先使用请求体临时传入的测试端点，若未传入则使用当前用户已配置的端点
    let endpoint = defaultProviderSettingsManager.resolveEndpointForUser(userId, process.env)

    const rawKey = typeof body['apiKey'] === 'string' ? body['apiKey'].trim() : null
    if (rawKey) {
      const baseUrl = typeof body['baseUrl'] === 'string' ? body['baseUrl'].trim() : (endpoint?.baseUrl ?? 'https://api.deepseek.com')
      const model = typeof body['model'] === 'string' ? body['model'].trim() : (endpoint?.model ?? 'deepseek-chat')
      endpoint = {
        baseUrl,
        apiKey: rawKey,
        model,
        allowPrivateNetwork: process.env['MOZHOU_ALLOW_PRIVATE_LLM'] === '1',
      }
    }

    if (!endpoint || !endpoint.apiKey) {
      json(200, {
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        error: 'No API key configured for testing',
      })
      return true
    }

    const testResult = await testConnection(endpoint)
    json(200, testResult)
    return true
  }

  if (path === '/api/llm/settings/reset' && req.method === 'POST') {
    defaultProviderSettingsManager.resetSettings(userId)
    json(200, { ok: true, message: 'Settings reset successfully' })
    return true
  }

  return false
}
