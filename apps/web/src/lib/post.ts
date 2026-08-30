/**
 * /api 调用助手（apps/web 中间件直出 JSON 契约，t76 R1：
 * 浏览器不引 node:fs 包，一律走 HTTP）。失败显式抛错并携带
 * 服务端错误码（QualityReworkLimitExceeded 等）。
 */
export async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as { ok?: boolean; error?: string; code?: string } & T
  if (!res.ok || data.ok === false) {
    const error = new Error(data.error ?? '请求失败 (HTTP ' + res.status + ')')
    error.name = data.code ?? 'RequestError'
    throw error
  }
  return data
}
