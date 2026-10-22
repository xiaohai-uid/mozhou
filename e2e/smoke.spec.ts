import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

/** child 是否位于 parent 之内（跨盘时 relative 返回绝对路径，判为不在其内）。 */
function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * 跨浏览器冒烟：同一份用例在 chromium / firefox / webkit 三个 project 各跑一遍。
 *
 * 只断言「生产服务在真实浏览器里可用」的最小面：首页能加载并完成挂载、
 * 健康探针返回就绪且数据根确实被隔离。业务旅程不在此处——那是 verify:journey 的职责。
 */
test.describe('生产服务冒烟', () => {
  test('首页返回 200 并完成 React 挂载', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(String(error)))

    const response = await page.goto('/')
    expect(response?.status()).toBe(200)
    await expect(page).toHaveTitle('墨舟 MoZhou')
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')

    // 首页是 SPA：#root 由打包后的脚本填充。空容器说明 JS 没执行
    // （脚本 404、CSP 拦截或语法错误），这正是跨浏览器差异最容易暴露的地方。
    await expect
      .poll(() => page.locator('#root').evaluate((el) => el.childElementCount), {
        message: 'React 未挂载到 #root（打包脚本未执行）',
      })
      .toBeGreaterThan(0)

    expect(pageErrors).toEqual([])
  })

  test('/api/health 返回就绪状态，且数据根被隔离', async ({ request }) => {
    const response = await request.get('/api/health')
    expect(response.status()).toBe(200)

    const body = (await response.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      ok: true,
      status: 'ok',
      dataRootWritable: true,
      hostedMode: false,
      // 必须是 start-server.mjs 显式注入的临时根。若它的 cwd 与 MOZHOU_DATA_ROOT
      // 同时失效，服务会回退到 <cwd>/.mozhou_data 并照样返回 200、
      // dataRootWritable:true、hostedMode:false——用例全绿，数据却已写进开发者
      // 真实数据根。这条断言就是那次静默回归的拦截点。
      dataRootSource: 'env',
    })

    const dataRootRaw = body['dataRoot']
    expect(typeof dataRootRaw).toBe('string')
    if (typeof dataRootRaw !== 'string') throw new Error('dataRoot 不是字符串')

    const dataRoot = resolve(dataRootRaw)
    // 落在系统临时区，且父目录名是 launcher 用 mkdtemp 造的前缀。
    expect(isInside(tmpdir(), dataRoot)).toBe(true)
    expect(basename(dirname(dataRoot))).toMatch(/^mozhou-e2e-server-/)
    // 不得落在仓库内：隔离失败时最常见的结果就是回退到仓库根的 .mozhou_data。
    const repoRoot = fileURLToPath(new URL('..', import.meta.url))
    expect(isInside(repoRoot, dataRoot)).toBe(false)
  })

  test('安全响应头齐全（含 form-action 与 Permissions-Policy）', async ({ request }) => {
    const response = await request.get('/')
    const csp = response.headers()['content-security-policy'] ?? ''

    // form-action 不回退 default-src，缺省等于放行任意表单提交目标（ZAP 10055）。
    expect(csp).toContain("form-action 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    // 本地工作台不需要设备能力（ZAP 10063）。
    expect(response.headers()['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()')
    expect(response.headers()['x-content-type-options']).toBe('nosniff')
    expect(response.headers()['x-frame-options']).toBe('DENY')
    expect(response.headers()['referrer-policy']).toBe('no-referrer')
  })

  test('404 带 Content-Type，不靠浏览器嗅探', async ({ request }) => {
    const response = await request.get('/__mozhou_missing__.txt')
    expect(response.status()).toBe(404)
    expect(response.headers()['content-type']).toBe('text/plain; charset=utf-8')
  })
})
