/**
 * 真实模型测试的**统一门控**（整改 T02）。
 *
 * ## 为什么需要它
 * 整改前，三份 *.realModel.test.ts 各自：
 *   1. 硬编码某台机器的绝对路径（C:/Users/<user>/cli-proxy-api/config.yaml）读 key；
 *   2. 硬编码本机代理端口与模型名；
 *   3. 没读到 key 时在 beforeAll 里提前 return、在每个 it() 里提前 return——
 *      vitest 把这两种都记为 passing，于是"CI 全绿"根本不能证明真实链路跑过；
 *   4. 自己写 MOZHOU_ALLOW_PRIVATE_LLM=1，等于测试替部署者放宽 SSRF 门禁。
 *
 * ## 本模块的门控契约
 * - 开关：只有 MOZHOU_RUN_REAL_MODEL_TESTS=1 才允许真实模型用例执行。
 * - 凭据：只认显式传入的 MOZHOU_API_KEY / MOZHOU_API_BASE / MOZHOU_MODEL。
 *   本模块不读任何本机配置文件、不猜端口、不回退到任何默认模型名。
 * - 未启用 => 调用方用 it.skipIf 显式 skip，零上游请求。
 * - 启用但三项配置任一缺失 => requireRealModelConfig() 抛错（在 beforeAll 里），
 *   该 suite 直接失败、进程退出码非零。不允许用提前 return 或 skip 伪装成通过。
 * - 启用且上游不可达 / 鉴权失败 => 由被测链路自身抛错 => 同样非零。
 * - 私网端点：门控不碰 MOZHOU_ALLOW_PRIVATE_LLM。是否授权环回端点由部署者
 *   在自己环境里决定；测试既不自动放开、也不自动关闭。
 *
 * 凭据值只在本进程内存活（注入 process.env 供 resolveEnvEndpoint 读取），
 * 本模块不会打印、不会落盘、不会写进任何错误消息。
 */

/** 唯一开关。取 1 才启用，其余取值（含未设置）一律视为未启用。 */
export const REAL_MODEL_ENABLE_VAR = 'MOZHOU_RUN_REAL_MODEL_TESTS'

/** 启用真实模型测试时必须由部署者显式提供的三项配置。 */
export const REAL_MODEL_CREDENTIAL_VARS = [
  'MOZHOU_API_KEY',
  'MOZHOU_API_BASE',
  'MOZHOU_MODEL',
] as const

export interface RealModelConfig {
  readonly apiKey: string
  readonly apiBase: string
  readonly model: string
}

/**
 * 门控结果。未启用时不携带任何凭据，调用方据此 skip，
 * 避免"虽然 skip 了但 key 已经被读进内存"这种半吊子状态。
 */
export type RealModelGate =
  | { readonly kind: 'disabled'; readonly reason: string }
  | {
      readonly kind: 'enabled'
      readonly config: RealModelConfig
      /** 启用但缺失的变量名。非空即表示配置不完整，必须让 suite 失败。 */
      readonly missing: readonly string[]
    }

/** 启用但配置不全时抛出；调用方在 beforeAll 里让它变成整份 suite 的失败。 */
export class RealModelConfigError extends Error {
  override readonly name = 'RealModelConfigError'
  readonly missing: readonly string[]

  constructor(missing: readonly string[]) {
    super(
      '真实模型测试已启用（' + REAL_MODEL_ENABLE_VAR + '=1），但缺少必需配置：' +
        missing.join('、') +
        '。请显式设置这三项后重跑；测试不会自动发现本机凭据，也不会回退到任何默认模型。',
    )
    this.missing = missing
  }
}

function readVar(env: NodeJS.ProcessEnv, name: string): string {
  return (env[name] ?? '').trim()
}

/** 只有 MOZHOU_RUN_REAL_MODEL_TESTS 严格等于 1 才算启用。 */
export function isRealModelEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return readVar(env, REAL_MODEL_ENABLE_VAR) === '1'
}

/**
 * 纯函数：不 spawn、不读文件、不打印。缺失项以**变量名**返回，绝不返回值本身。
 */
export function resolveRealModelGate(env: NodeJS.ProcessEnv = process.env): RealModelGate {
  if (!isRealModelEnabled(env)) {
    return {
      kind: 'disabled',
      reason:
        '未设置 ' + REAL_MODEL_ENABLE_VAR + '=1，真实模型用例显式 skip（零上游请求）。' +
        '需要验证真实链路时请显式启用并自行提供 ' + REAL_MODEL_CREDENTIAL_VARS.join(' / ') + '。',
    }
  }
  const missing = REAL_MODEL_CREDENTIAL_VARS.filter((name) => readVar(env, name).length === 0)
  return {
    kind: 'enabled',
    config: {
      apiKey: readVar(env, 'MOZHOU_API_KEY'),
      apiBase: readVar(env, 'MOZHOU_API_BASE'),
      model: readVar(env, 'MOZHOU_MODEL'),
    },
    missing,
  }
}

/**
 * 启用状态下取配置；**配置不全就抛错**，绝不返回半成品。
 * 未启用状态不会被调用（调用方先判 kind === 'disabled'），误调用同样抛错。
 */
export function requireRealModelConfig(gate: RealModelGate): RealModelConfig {
  if (gate.kind === 'disabled') {
    throw new Error(
      'requireRealModelConfig() 只在 ' + REAL_MODEL_ENABLE_VAR + '=1 时可用；' +
        '当前未启用。请先用 isRealModelEnabled() 判门控，或改用 it.skipIf。',
    )
  }
  if (gate.missing.length > 0) throw new RealModelConfigError(gate.missing)
  return gate.config
}

/**
 * 逐项写入 process.env，返回**逐项恢复**原值的函数。
 *
 * 为什么逐项而不是整体快照：整体快照会把别的测试/宿主进程在这期间写入的无关变量
 * 一起回滚；逐项记录"这一项改动前是什么"，恢复时精确还原（原先不存在 => 删除）。
 */
export function applyEnvOverrides(
  overrides: Readonly<Record<string, string | undefined>>,
  env: NodeJS.ProcessEnv = process.env,
): () => void {
  const previous = new Map<string, string | undefined>()
  for (const [name, value] of Object.entries(overrides)) {
    previous.set(name, Object.prototype.hasOwnProperty.call(env, name) ? env[name] : undefined)
    if (value === undefined) delete env[name]
    else env[name] = value
  }
  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete env[name]
      else env[name] = value
    }
    previous.clear()
  }
}