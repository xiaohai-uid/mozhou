// @vitest-environment node
/**
 * 分级模型路由接线集成测试（T14 · 真实 HTTP + 真实上游请求体回读）。
 *
 * 走的是生产入口 POST /api/draft.stream（apps/web/server/routes/pipelineRoutes.ts），
 * 上游换成记录请求体/Authorization 的本机 fake OpenAI-compatible 服务，于是「路由是否真的
 * 接通」可以被直接读出来：上游收到的 model 与密钥、账本 GenerationStarted 里的 providerId、
 * 覆盖留痕日志。
 *
 * 覆盖的失败路径与不变量：
 *   - 无覆盖层文件 ⇒ 与接线前逐字节一致（providerId 仍 'deepseek'，model/端点仍是 BYOK 值）；
 *   - **providerId 决定实际出站端点**：BYOK 指向诱饵上游、注册表指向真上游时，请求必须落在
 *     注册表那家，账本 providerId 与之一致（这是本票要消灭的「账本说 X、请求发 Y」的反例守卫）；
 *   - **注册表独立可用**：BYOK 环境变量全部清空、只配 providers 注册表时 /api/draft.stream
 *     也要成功出流，账本 providerId 是注册表那家（hasDraftProvider 判据认注册表）；
 *   - 反向守卫：覆盖层缺失且 BYOK 全缺 ⇒ 仍 200 JSON PROVIDER_UNAVAILABLE（判据放宽不等于放行）；
 *   - UI 声明一致：/api/capabilities 与 /api/capability-square 的 providerAvailable 与
 *     「能不能真的生成」同源（注册表可解析 ⇒ true；密钥缺失/覆盖层缺失 ⇒ false）；
 *   - 叶子声明 model ⇒ 上游收到该 model，且留痕日志出现；
 *   - providerId 未登记 ⇒ error 帧含码与键路径，上游零请求（绝不回落 BYOK 端点）；
 *   - baseURL 未过 SSRF 门禁（环回且未开逃生位）⇒ error 帧，上游零请求；
 *   - apiKeyEnv 指向的环境变量缺失 ⇒ error 帧含变量名，上游零请求；
 *   - 多叶子未指定 tier ⇒ 流以 error 帧收口、消息含键路径、候选与补救操作位，上游零请求；
 *   - 叶子声明 api_key_ref ⇒ 显式拒绝（密钥只来自注册表 apiKeyEnv），上游零请求；
 *   - 显式 tier 缺失 ⇒ 同上，消息含 CHAPTER_DRAFTING.<tier>；
 *   - 非法配置（明文 apiKey）⇒ 显式 TierConfigError 且消息含键路径、不回显密钥（防静默回落守卫）。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiMiddleware } from '../../server/api.js'
import { defaultBookAccessManager } from '../../server/bookAccess.js'
import { createBook, LocalDataPlane } from '@mozhou/data-plane'
import { readPipelineLedger } from '@mozhou/pipeline'
import { PRIVATE_NETWORK_ENV, TIER_CONFIG_ENV, TIER_NAME_ENV } from '../llm/tierRouting.js'

const BYOK_MODEL = 'byok-model-x'
/** 注册表 apiKeyEnv 指向的变量名（与 BYOK 的 MOZHOU_API_KEY 刻意分开，便于证明密钥来源）。 */
const TIER_KEY_ENV = 'MOZHOU_TIER_KEY'
const TIER_KEY_VALUE = 'sk-tier-registry-key'
const ENV_KEYS = [
  'MOZHOU_DRAFT_PROVIDER',
  'MOZHOU_API_KEY',
  'DEEPSEEK_API_KEY',
  'OPENAI_API_KEY',
  'MOZHOU_API_BASE',
  'MOZHOU_MODEL',
  PRIVATE_NETWORK_ENV,
  TIER_CONFIG_ENV,
  TIER_NAME_ENV,
  TIER_KEY_ENV,
] as const

let servers: ReturnType<typeof createServer>[] = []
let dirs: string[] = []
let savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  savedEnv = {}
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
})

afterEach(() => {
  for (const s of servers) s.close()
  servers = []
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // Windows 文件锁容忍
    }
  }
  dirs = []
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  vi.restoreAllMocks()
})

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

/** 记录每次上游 chat/completions 请求体与 Authorization 的 fake provider。 */
interface Upstream {
  readonly baseUrl: string
  readonly bodies: { model: string }[]
  readonly auth: string[]
}

async function startUpstream(): Promise<Upstream> {
  const bodies: { model: string }[] = []
  const auth: string[] = []
  const server = createServer((req, res) => {
    let raw = ''
    auth.push(req.headers.authorization ?? '')
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      bodies.push(JSON.parse(raw) as { model: string })
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'AI 生成的正文。' } }] }) + '\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { baseUrl: `http://127.0.0.1:${port}`, bodies, auth }
}

function startApi(): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      apiMiddleware()(req, res, () => {
        res.statusCode = 404
        res.end('nf')
      })
    })
    servers.push(server)
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    })
  })
}

function makeBook(): string {
  const dir = tmp('mozhou-tier-route-book-')
  const root = join(dir, '路由书')
  createBook({ dir: root, title: '路由书' })
  const plane = LocalDataPlane.open(root)
  plane.createChapterDraft({ chapterIndex: 1, title: '第一章' })
  plane.saveProseDraft({ chapterIndex: 1, body: '作者原文。\n', expectedRevision: 0 })
  plane.close()
  return root
}

function writeConfig(name: string, text: string): string {
  const file = join(tmp('mozhou-tier-route-cfg-'), name)
  writeFileSync(file, text, 'utf8')
  return file
}

async function runStream(
  base: string,
  root: string,
): Promise<{ status: number; frames: Record<string, unknown>[] }> {
  const res = await fetch(base + '/api/draft.stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root, chapterIndex: 1, prompt: '继续这一章' }),
  })
  const text = (await res.text()).trim()
  const frames =
    text.length === 0 ? [] : text.split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
  return { status: res.status, frames }
}

/** 账本里本窗口 GenerationStarted 快照的 providerId（覆盖后即配置值）。 */
function ledgerProviderIds(root: string): string[] {
  return readPipelineLedger(root)
    .filter((row) => row.kind === 'task' && row.event.type === 'GenerationStarted')
    .map((row) => {
      const payload = (row as { event: { payload?: { snapshot?: { providerId?: string } } } }).event.payload
      return payload?.snapshot?.providerId ?? ''
    })
}

/** 真实 provider 分支的公共前置：BYOK 端点 + 指向本机 fake 上游（纯环境变量装配，无异步）。 */
function armRealProvider(upstream: Upstream): void {
  defaultBookAccessManager.setDataRoot(tmp('mozhou-tier-route-data-'))
  delete process.env['MOZHOU_DRAFT_PROVIDER']
  process.env['MOZHOU_API_KEY'] = 'sk-tier-route-test'
  process.env['MOZHOU_API_BASE'] = upstream.baseUrl
  process.env['MOZHOU_MODEL'] = BYOK_MODEL
  // SSRF 门禁的既有显式逃生位（部署者授权本机私有 LLM）；仅本测试内使用。
  process.env[PRIVATE_NETWORK_ENV] = '1'
  process.env[TIER_KEY_ENV] = TIER_KEY_VALUE
  delete process.env[TIER_NAME_ENV]
}

/**
 * 清掉全部 BYOK 凭据/端点变量 = 「只用 providers 注册表、完全不配 BYOK」的部署形态。
 * hasDraftProvider() 的判据必须在这种部署下仍然认注册表（否则注册表能力独立不可用）。
 */
function clearByokEnv(): void {
  for (const key of [
    'MOZHOU_DRAFT_PROVIDER',
    'MOZHOU_API_KEY',
    'DEEPSEEK_API_KEY',
    'OPENAI_API_KEY',
    'MOZHOU_API_BASE',
    'MOZHOU_MODEL',
  ]) {
    delete process.env[key]
  }
}

/** 注册表独立部署的前置：BYOK 全清 + 注册表密钥就位（覆盖层文件由各用例自行指定）。 */
function armRegistryOnly(): void {
  defaultBookAccessManager.setDataRoot(tmp('mozhou-tier-route-data-'))
  clearByokEnv()
  process.env[PRIVATE_NETWORK_ENV] = '1'
  process.env[TIER_KEY_ENV] = TIER_KEY_VALUE
  delete process.env[TIER_NAME_ENV]
}

/** POST 一个 JSON 端点并读回 JSON（UI 可用性读面用）。 */
async function postJson(base: string, path: string): Promise<Record<string, unknown>> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  return (await res.json()) as Record<string, unknown>
}

/**
 * 覆盖层配置：providers 注册表 + 单叶子。baseURL 决定**实际出站端点**（与 BYOK 的
 * MOZHOU_API_BASE 无关），apiKeyEnv 决定**实际使用的密钥**（与 BYOK 的 MOZHOU_API_KEY 无关）。
 */
function registryConfig(options: {
  readonly baseURL: string
  readonly apiKeyEnv?: string
  readonly providerId?: string
  readonly model?: string
  readonly leafApiKeyRef?: string
}): string {
  const providerId = options.providerId ?? 'deepseek'
  const lines = [
    'providers:',
    `  ${providerId}:`,
    `    baseURL: ${options.baseURL}`,
    `    apiKeyEnv: ${options.apiKeyEnv ?? TIER_KEY_ENV}`,
    'CHAPTER_DRAFTING:',
    '  quality:',
    `    providerId: ${providerId}`,
    `    model: ${options.model ?? 'tier-model'}`,
  ]
  if (options.leafApiKeyRef !== undefined) lines.push(`    api_key_ref: ${options.leafApiKeyRef}`)
  lines.push('')
  return lines.join('\n')
}

/** 只有路由叶子、没有 providers 注册表的（旧的）配置形态——现在必须显式失败。 */
function leafOnlyConfig(providerId: string, model = 'tier-model'): string {
  return ['CHAPTER_DRAFTING:', '  quality:', `    providerId: ${providerId}`, `    model: ${model}`, ''].join('\n')
}

describe('分级模型路由 · 无覆盖层文件', () => {
  it('保持现状：上游收到 BYOK model，账本 providerId 仍是包内默认 deepseek', async () => {
    const upstream = await startUpstream()
    armRealProvider(upstream)
    // 明确指向不存在的覆盖层文件 = 「没有配置文件」的确定形态
    process.env[TIER_CONFIG_ENV] = join(tmp('mozhou-tier-route-none-'), 'absent.yaml')
    const base = await startApi()
    const root = makeBook()

    const { status, frames } = await runStream(base, root)
    expect(status).toBe(200)
    expect(frames[0]).toMatchObject({ ok: true, event: 'start', provider: 'real-openai-compatible' })
    expect(frames.at(-1)).toMatchObject({ ok: true, event: 'done', outcome: 'succeeded' })
    expect(upstream.bodies.map((b) => b.model)).toEqual([BYOK_MODEL])
    expect(ledgerProviderIds(root)).toEqual(['deepseek'])
  })
})

describe('分级模型路由 · 覆盖生效（端点由 providers 注册表决定）', () => {
  it('注册表命中：上游收到叶子 model 与注册表密钥，留痕把 providerId 与实际端点并排写出', async () => {
    const upstream = await startUpstream()
    armRealProvider(upstream)
    process.env[TIER_CONFIG_ENV] = writeConfig(
      'settings.yaml',
      registryConfig({ baseURL: upstream.baseUrl }),
    )
    const logged: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '))
    })
    const base = await startApi()
    const root = makeBook()

    const { frames } = await runStream(base, root)
    expect(frames.at(-1)).toMatchObject({ ok: true, event: 'done', outcome: 'succeeded' })
    expect(upstream.bodies.map((b) => b.model)).toEqual(['tier-model'])
    // 密钥来自注册表的 apiKeyEnv（MOZHOU_TIER_KEY），不是 BYOK 的 MOZHOU_API_KEY
    expect(upstream.auth).toEqual([`Bearer ${TIER_KEY_VALUE}`])
    expect(ledgerProviderIds(root)).toEqual(['deepseek'])

    const trace = logged.find((line) => line.includes('[mozhou-tier-route]'))
    expect(trace).toBeDefined()
    expect(trace).toContain('task_type=CHAPTER_DRAFTING')
    expect(trace).toContain('tier=quality')
    expect(trace).toContain('providerId=deepseek→deepseek')
    expect(trace).toContain('model=tier-model')
    // 端点即 providerId 的落点：注册表给的 baseURL（不再是 BYOK 的）
    expect(trace).toContain(`endpoint=${upstream.baseUrl}`)
  })

  it('★ providerId 决定实际出站端点：BYOK 指向诱饵上游时，请求仍落在注册表那家，账本与之一致', async () => {
    const decoy = await startUpstream()
    const real = await startUpstream()
    // BYOK 故意指向诱饵：若实现仍从 BYOK 取端点，请求会落在 decoy 上
    armRealProvider(decoy)
    process.env[TIER_CONFIG_ENV] = writeConfig(
      'settings.yaml',
      registryConfig({ baseURL: real.baseUrl, providerId: 'glm' }),
    )
    const base = await startApi()
    const root = makeBook()

    const { frames } = await runStream(base, root)
    expect(frames.at(-1)).toMatchObject({ ok: true, event: 'done', outcome: 'succeeded' })

    // 账本 providerId = glm，实际服务端点是 glm 在注册表里的 baseURL = real（不是 BYOK 的 decoy）
    expect(ledgerProviderIds(root)).toEqual(['glm'])
    expect(real.bodies.map((b) => b.model)).toEqual(['tier-model'])
    expect(decoy.bodies).toHaveLength(0)
    expect(decoy.auth).toHaveLength(0)
  })
})

describe('分级模型路由 · 注册表 fail-fast（绝不回落 BYOK 端点）', () => {
  it('providerId 未登记：error 帧含码与键路径，上游零请求（BYOK 配好了也不许回落）', async () => {
    const upstream = await startUpstream()
    armRealProvider(upstream)
    // 注册表里登记 deepseek，叶子却声明 glm —— 旧形态配置现在必须显式失败
    process.env[TIER_CONFIG_ENV] = writeConfig(
      'unregistered.yaml',
      [
        'providers:',
        '  deepseek:',
        `    baseURL: ${upstream.baseUrl}`,
        `    apiKeyEnv: ${TIER_KEY_ENV}`,
        'CHAPTER_DRAFTING:',
        '  quality:',
        '    providerId: glm',
        '    model: tier-model',
        '',
      ].join('\n'),
    )
    const base = await startApi()
    const root = makeBook()

    const { frames } = await runStream(base, root)
    const error = frames.find((f) => f['event'] === 'error')
    expect(String(error?.['error'])).toContain('TIER_ROUTE_PROVIDER_NOT_REGISTERED')
    expect(String(error?.['error'])).toContain('glm')
    expect(String(error?.['error'])).toContain('CHAPTER_DRAFTING.quality.providerId')
    expect(String(error?.['error'])).toContain('providers.glm')
    expect(upstream.bodies).toHaveLength(0)
    expect(ledgerProviderIds(root)).toEqual([])
  })

  it('只有路由叶子、没有 providers 注册表：显式失败（旧形态不再静默走 BYOK）', async () => {
    const upstream = await startUpstream()
    armRealProvider(upstream)
    process.env[TIER_CONFIG_ENV] = writeConfig('leaf-only.yaml', leafOnlyConfig('deepseek'))
    const base = await startApi()
    const root = makeBook()

    const { frames } = await runStream(base, root)
    const error = frames.find((f) => f['event'] === 'error')
    expect(String(error?.['error'])).toContain('TIER_ROUTE_PROVIDER_NOT_REGISTERED')
    expect(upstream.bodies).toHaveLength(0)
  })

  it('注册表 baseURL 是环回地址且未开逃生位：error 帧含 SSRF 拒绝与键路径，上游零请求', async () => {
    const upstream = await startUpstream()
    armRealProvider(upstream)
    // 关掉部署者逃生位 ⇒ 环回端点必须被 SSRF 门禁拒绝
    delete process.env[PRIVATE_NETWORK_ENV]
    process.env[TIER_CONFIG_ENV] = writeConfig(
      'private.yaml',
      registryConfig({ baseURL: upstream.baseUrl }),
    )
    const base = await startApi()
    const root = makeBook()

    const { frames } = await runStream(base, root)
    const error = frames.find((f) => f['event'] === 'error')
    expect(String(error?.['error'])).toContain('TIER_ROUTE_PROVIDER_ENDPOINT_REJECTED')
    expect(String(error?.['error'])).toContain('providers.deepseek.baseURL')
    expect(String(error?.['error'])).toContain('SSRF')
    expect(upstream.bodies).toHaveLength(0)
  })

  it('注册表 apiKeyEnv 指向的环境变量缺失：error 帧含变量名与键路径，上游零请求', async () => {
    const upstream = await startUpstream()
    armRealProvider(upstream)
    delete process.env[TIER_KEY_ENV]
    process.env[TIER_CONFIG_ENV] = writeConfig(
      'no-key.yaml',
      registryConfig({ baseURL: upstream.baseUrl }),
    )
    const base = await startApi()
    const root = makeBook()

    const { frames } = await runStream(base, root)
    const error = frames.find((f) => f['event'] === 'error')
    expect(String(error?.['error'])).toContain('TIER_ROUTE_PROVIDER_KEY_MISSING')
    expect(String(error?.['error'])).toContain(TIER_KEY_ENV)
    expect(String(error?.['error'])).toContain('providers.deepseek.apiKeyEnv')
    expect(upstream.bodies).toHaveLength(0)
  })
})

describe('分级模型路由 · 注册表独立可用（不配 BYOK 也能生成）', () => {
  it('★ 注册表配好 + BYOK 环境变量全部清空 ⇒ /api/draft.stream 成功出流，账本 providerId 是注册表那家', async () => {
    const upstream = await startUpstream()
    armRegistryOnly()
    process.env[TIER_CONFIG_ENV] = writeConfig(
      'registry-only.yaml',
      registryConfig({ baseURL: upstream.baseUrl, providerId: 'glm' }),
    )
    const base = await startApi()
    const root = makeBook()

    const { status, frames } = await runStream(base, root)
    expect(status).toBe(200)
    expect(frames[0]).toMatchObject({ ok: true, event: 'start', provider: 'real-openai-compatible' })
    expect(frames.at(-1)).toMatchObject({ ok: true, event: 'done', outcome: 'succeeded' })
    // 端点/密钥/账本三者同源：都来自注册表的 glm 条目
    expect(upstream.bodies.map((b) => b.model)).toEqual(['tier-model'])
    expect(upstream.auth).toEqual([`Bearer ${TIER_KEY_VALUE}`])
    expect(ledgerProviderIds(root)).toEqual(['glm'])
  })

  it('反向守卫：覆盖层缺失且 BYOK 全缺 ⇒ 仍 200 JSON PROVIDER_UNAVAILABLE（非流式），账本零事件', async () => {
    armRegistryOnly()
    process.env[TIER_CONFIG_ENV] = join(tmp('mozhou-tier-route-none-'), 'absent.yaml')
    const base = await startApi()
    const root = makeBook()

    const res = await fetch(base + '/api/draft.stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, chapterIndex: 1, prompt: '继续这一章' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(res.headers.get('Content-Type')).not.toContain('ndjson')
    const data = (await res.json()) as { ok: boolean; code: string; error: string }
    expect(data.ok).toBe(false)
    expect(data.code).toBe('PROVIDER_UNAVAILABLE')
    expect(data.error).toContain('provider')
    expect(ledgerProviderIds(root)).toEqual([])
  })

  it('覆盖层存在但解析不出来（providerId 未登记）+ BYOK 全缺 ⇒ 精确错误帧，不被笼统 PROVIDER_UNAVAILABLE 掩盖', async () => {
    armRegistryOnly()
    process.env[TIER_CONFIG_ENV] = writeConfig(
      'unresolvable.yaml',
      [
        'providers:',
        '  deepseek:',
        '    baseURL: https://api.deepseek.com',
        `    apiKeyEnv: ${TIER_KEY_ENV}`,
        'CHAPTER_DRAFTING:',
        '  quality:',
        '    providerId: glm',
        '    model: tier-model',
        '',
      ].join('\n'),
    )
    const base = await startApi()
    const root = makeBook()

    const { status, frames } = await runStream(base, root)
    expect(status).toBe(200)
    const error = frames.find((f) => f['event'] === 'error')
    expect(String(error?.['error'])).toContain('TIER_ROUTE_PROVIDER_NOT_REGISTERED')
    expect(String(error?.['error'])).toContain('providers.glm')
  })

  it('UI 声明与真实能力同源：/api/capabilities 随注册表可解析性翻转，不报假可用', async () => {
    const upstream = await startUpstream()
    armRegistryOnly()
    process.env[TIER_CONFIG_ENV] = writeConfig(
      'registry-only.yaml',
      registryConfig({ baseURL: upstream.baseUrl }),
    )
    const base = await startApi()

    // 注册表可解析 ⇒ 真可用
    expect((await postJson(base, '/api/capabilities')).providerAvailable).toBe(true)

    // 注册表在、但 apiKeyEnv 指向的环境变量缺失 ⇒ 生成必然失败 ⇒ 不能报 true
    delete process.env[TIER_KEY_ENV]
    expect((await postJson(base, '/api/capabilities')).providerAvailable).toBe(false)

    // 覆盖层缺失 + BYOK 缺失 ⇒ false（与流式闸同源的反向守卫）
    process.env[TIER_KEY_ENV] = TIER_KEY_VALUE
    process.env[TIER_CONFIG_ENV] = join(tmp('mozhou-tier-route-none-'), 'absent.yaml')
    expect((await postJson(base, '/api/capabilities')).providerAvailable).toBe(false)
  })

  it('systemRoutes 的 /api/capability-square 同源（handler 已异步化，结论必须一致）', async () => {
    const upstream = await startUpstream()
    armRegistryOnly()
    process.env[TIER_CONFIG_ENV] = writeConfig(
      'registry-only.yaml',
      registryConfig({ baseURL: upstream.baseUrl }),
    )
    const base = await startApi()

    const available = await postJson(base, '/api/capability-square')
    expect(available.providerAvailable).toBe(true)
    expect(Array.isArray(available.groups)).toBe(true)

    delete process.env[TIER_KEY_ENV]
    expect((await postJson(base, '/api/capability-square')).providerAvailable).toBe(false)
  })
})

describe('分级模型路由 · 歧义与非法配置 fail-fast', () => {
  it('多叶子未指定 tier：error 帧含键路径、候选与补救操作位，且上游零请求', async () => {
    const upstream = await startUpstream()
    armRealProvider(upstream)
    process.env[TIER_CONFIG_ENV] = writeConfig(
      'multi.yaml',
      [
        'CHAPTER_DRAFTING:',
        '  quality:',
        '    providerId: deepseek',
        '    model: tier-model',
        '  fast:',
        '    providerId: deepseek',
        '    model: fast-model',
        '',
      ].join('\n'),
    )
    const base = await startApi()
    const root = makeBook()

    const { frames } = await runStream(base, root)
    const error = frames.find((f) => f['event'] === 'error')
    expect(error).toMatchObject({ ok: false })
    expect(String(error?.['error'])).toContain('NO_PROVIDER_TIER')
    expect(String(error?.['error'])).toContain('CHAPTER_DRAFTING')
    expect(String(error?.['error'])).toContain('quality / fast')
    // 补救路径可发现：作者照报错就能找到 MOZHOU_DRAFT_TIER
    expect(String(error?.['error'])).toContain(TIER_NAME_ENV)
    expect(upstream.bodies).toHaveLength(0)
    expect(ledgerProviderIds(root)).toEqual([])
  })

  it('叶子声明 api_key_ref：显式拒绝（error 帧含码与键路径），上游零请求', async () => {
    const upstream = await startUpstream()
    armRealProvider(upstream)
    // api_key_ref 过得了 loadTierConfig 校验，但本入口的密钥只来自注册表 apiKeyEnv——必须显式
    // 拒绝，不能静默忽略（否则作者以为这层声明已生效，实际用的是注册表那把密钥）。
    process.env[TIER_CONFIG_ENV] = writeConfig(
      'keyref.yaml',
      [
        'providers:',
        '  glm:',
        `    baseURL: ${upstream.baseUrl}`,
        `    apiKeyEnv: ${TIER_KEY_ENV}`,
        'CHAPTER_DRAFTING:',
        '  quality:',
        '    providerId: glm',
        '    model: tier-model',
        '    api_key_ref: MOZHOU_GLM_KEY',
        '',
      ].join('\n'),
    )
    const base = await startApi()
    const root = makeBook()

    const { frames } = await runStream(base, root)
    const error = frames.find((f) => f['event'] === 'error')
    expect(String(error?.['error'])).toContain('TIER_ROUTE_API_KEY_REF_UNSUPPORTED')
    expect(String(error?.['error'])).toContain('CHAPTER_DRAFTING.quality.api_key_ref')
    expect(String(error?.['error'])).toContain('apiKeyEnv')
    expect(upstream.bodies).toHaveLength(0)
    expect(ledgerProviderIds(root)).toEqual([])
  })

  it('显式 tier 缺失：error 帧指向 CHAPTER_DRAFTING.<tier> 并列出可用 tier', async () => {
    const upstream = await startUpstream()
    armRealProvider(upstream)
    process.env[TIER_CONFIG_ENV] = writeConfig(
      'single.yaml',
      ['CHAPTER_DRAFTING:', '  quality:', '    providerId: deepseek', '    model: tier-model', ''].join('\n'),
    )
    process.env[TIER_NAME_ENV] = 'turbo'
    const base = await startApi()
    const root = makeBook()

    const { frames } = await runStream(base, root)
    const error = frames.find((f) => f['event'] === 'error')
    expect(String(error?.['error'])).toContain('NO_PROVIDER_TIER')
    expect(String(error?.['error'])).toContain('CHAPTER_DRAFTING.turbo')
    expect(String(error?.['error'])).toContain('quality')
    expect(upstream.bodies).toHaveLength(0)
  })

  it('叶子缺 model：冻结校验器判结构非法（error 帧含码与键路径），上游零请求', async () => {
    const upstream = await startUpstream()
    armRealProvider(upstream)
    // 「只声明 providerId」在冻结形态下不可加载（tierConfig.ts:160-167：model 必填非空串）——
    // 该形态被机械拒绝而不是被运行时静默补默认值，这正是「宁败不猜」的落点。
    process.env[TIER_CONFIG_ENV] = writeConfig(
      'bad.yaml',
      ['CHAPTER_DRAFTING:', '  quality:', '    providerId: deepseek', ''].join('\n'),
    )
    const base = await startApi()
    const root = makeBook()

    const { frames } = await runStream(base, root)
    const error = frames.find((f) => f['event'] === 'error')
    expect(String(error?.['error'])).toContain('TIER_CONFIG_STRUCTURE_INVALID')
    expect(String(error?.['error'])).toContain('CHAPTER_DRAFTING.quality.model')
    expect(upstream.bodies).toHaveLength(0)
  })

  it('非法配置防静默回归：明文 apiKey ⇒ 显式 TierConfigError + 键路径，不回显密钥，上游零请求', async () => {
    const upstream = await startUpstream()
    armRealProvider(upstream)
    // 生产入口读配置后，非法配置必须显式失败而不是静默回落到旧行为。选「明文密钥」这条
    // 做守卫：它同时证明密钥扫描在生成路径上生效、且报错不回显密钥本体。
    const secret = 'sk-tier-route-leak'
    process.env[TIER_CONFIG_ENV] = writeConfig(
      'leak.yaml',
      [
        'CHAPTER_DRAFTING:',
        '  quality:',
        '    providerId: deepseek',
        '    model: tier-model',
        `    apiKey: ${secret}`,
        '',
      ].join('\n'),
    )
    const base = await startApi()
    const root = makeBook()

    const { frames } = await runStream(base, root)
    const error = frames.find((f) => f['event'] === 'error')
    expect(String(error?.['error'])).toContain('TIER_CONFIG_PLAINTEXT_KEY')
    expect(String(error?.['error'])).toContain('CHAPTER_DRAFTING.quality.apiKey')
    expect(JSON.stringify(frames)).not.toContain(secret)
    expect(upstream.bodies).toHaveLength(0)
    expect(ledgerProviderIds(root)).toEqual([])
  })
})
