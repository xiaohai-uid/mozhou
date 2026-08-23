/**
 * 本地 embedding 装载封装（实现票 #18 / T8b-1；T9 实测冻结组合）：
 * fastembed CUSTOM 模式 + 随仓内置 BAAI/bge-small-zh-v1.5 int8（约 24MB，512 维）。
 *
 * P0 红线：装载与推理全程零联网。模型文件随仓库资产分发，绝不走 fastembed
 * 内置的 cacheDir 远端下载路径（T9 R2）；断网冷启动由 embedding.test.ts 以
 * 封锁 globalThis.fetch 的方式硬断言。
 *
 * 引擎隔离（T9 §4 兜底逃生舱）：上游只见 LocalEmbeddingProvider 纯本地接口，
 * fastembed 细节不外泄。特别地，其内置 passageEmbed/queryEmbed 会强加
 * `passage: `/`query: ` 的 e5 式英文前缀（fastembed 2.1.0 源码），对 BAAI bge
 * 系属错误约定——本封装改用裸 embed()：passage 端永不加前缀；query 端按
 * 官方模型卡加中文指令前缀。
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUNDLED_MODEL_ID = 'bge-small-zh-v1.5-int8' as const

/** bge v1.5 官方 query 指令前缀（模型卡 FAQ §3；v1.5 不加仅轻微衰减）。 */
const BGE_QUERY_INSTRUCTION = '为这个句子生成表示以用于检索相关文章：'

const MODEL_DIR_NAME = 'bge-small-zh-v1.5'
const MAX_SEQUENCE_TOKENS = 512

interface AssetFileEntry {
  readonly path: string
  readonly sha256: string
  readonly bytes: number
}

/** 随模型目录分发的自校验清单（构建产物登记位；manifest 自身不入册）。 */
interface ModelManifest {
  readonly manifestVersion: 1
  readonly id: typeof BUNDLED_MODEL_ID
  readonly dimensions: 512
  readonly maxSequenceTokens: typeof MAX_SEQUENCE_TOKENS
  readonly license: 'MIT'
  readonly source: string
  readonly onnxFile: string
  readonly files: ReadonlyArray<AssetFileEntry>
}

export class ModelAssetsError extends Error {
  override readonly name = 'ModelAssetsError'

  constructor(message: string) {
    super(message)
  }
}

/** 对上游暴露的纯本地向量接口（无 fetch 路径；输出已 L2 归一化，可直接内积/余弦）。 */
export interface LocalEmbeddingProvider {
  readonly modelId: typeof BUNDLED_MODEL_ID
  readonly dimensions: 512
  /** 查询向量：自动带 bge 官方指令前缀。 */
  queryEmbed(query: string): Promise<number[]>
  /** 段落向量：永不加指令前缀（bge 约定）。 */
  passageEmbed(passages: string[]): Promise<number[][]>
}

export interface CreateLocalEmbeddingProviderOptions {
  /** 缺省解析为包内 assets/models/bge-small-zh-v1.5。 */
  readonly modelDir?: string
}

/**
 * 安装环境守卫（票面 AC）：onnxruntime-node 的 postinstall 会强拉 GPU 二进制，
 * 无 CUDA 工具链时解压失败并整体回滚安装（T9 R1）。运行期置默认值兜底；
 * 安装期硬门禁见 scripts/check-install-env.mjs 与 docs/install.md。
 */
export function ensureCudaSkipEnv(): void {
  process.env.ONNXRUNTIME_NODE_INSTALL_CUDA ??= 'skip'
}

interface FastembedEngine {
  embed(texts: string[]): AsyncGenerator<number[][], void, unknown>
}

function sha256FileHex(absolutePath: string): string {
  return createHash('sha256').update(readFileSync(absolutePath)).digest('hex')
}

/** 从模块位置向上找到包内内置模型目录（src/、dist/ 与打包布局均成立）。 */
function resolveBundledModelDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const candidate = join(dir, 'assets', 'models', MODEL_DIR_NAME)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) {
      throw new ModelAssetsError(
        `内置 embedding 模型资产缺失（期望 assets/models/${MODEL_DIR_NAME}）。` +
          '安装文档见 docs/install.md',
      )
    }
    dir = parent
  }
}

function readManifest(modelDir: string): ModelManifest {
  const manifestPath = join(modelDir, 'manifest.json')
  if (!existsSync(manifestPath)) {
    throw new ModelAssetsError(
      `内置 embedding 模型资产不完整：缺 ${manifestPath}。安装文档见 docs/install.md`,
    )
  }
  return JSON.parse(readFileSync(manifestPath, 'utf-8')) as ModelManifest
}

/** 装载前完整性复核：磁盘文件集 == 清单登记集，逐文件 hash/字节数一致。 */
function verifyAssets(modelDir: string, manifest: ModelManifest): void {
  const listed = new Map(manifest.files.map((f) => [f.path, f]))
  const disk = new Set(readdirSync(modelDir))
  disk.delete('manifest.json')

  for (const rel of disk) {
    if (!listed.has(rel)) {
      throw new ModelAssetsError(
        `模型资产含未登记文件：${join(modelDir, rel)}（构建产物清单是唯一信任根）。` +
          '安装文档见 docs/install.md',
      )
    }
  }
  for (const [rel, entry] of listed) {
    const abs = join(modelDir, rel)
    if (!existsSync(abs)) {
      throw new ModelAssetsError(
        `模型资产缺失登记文件：${abs}。安装文档见 docs/install.md`,
      )
    }
    if (statSync(abs).size !== entry.bytes || sha256FileHex(abs) !== entry.sha256) {
      throw new ModelAssetsError(
        `模型资产校验失败（hash 不符）：${abs}。安装文档见 docs/install.md`,
      )
    }
  }
}

async function embedAll(engine: FastembedEngine, texts: string[]): Promise<number[][]> {
  const out: number[][] = []
  for await (const batch of engine.embed(texts)) {
    out.push(...batch)
  }
  return out
}

/**
 * 从随仓内置资产创建本地 embedding provider。
 * 全程零联网；资产 hash 装载前复核；引擎细节不外泄（T9 兜底逃生舱端口）。
 */
export async function createLocalEmbeddingProvider(
  options: CreateLocalEmbeddingProviderOptions = {},
): Promise<LocalEmbeddingProvider> {
  const modelDir = options.modelDir ?? resolveBundledModelDir()
  const manifest = readManifest(modelDir)
  verifyAssets(modelDir, manifest)

  // 守卫先于动态 import——静态 import 会先于副作用代码求值 fastembed 模块图。
  ensureCudaSkipEnv()
  const fastembed = await import('fastembed')
  // InitCustomOptions 未从包入口导出；字面量内联传参，由 model: CUSTOM 收窄联合分支。
  const engine: FastembedEngine = await fastembed.FlagEmbedding.init({
    model: fastembed.EmbeddingModel.CUSTOM,
    modelAbsoluteDirPath: modelDir,
    modelName: manifest.onnxFile,
    executionProviders: [fastembed.ExecutionProvider.CPU],
    maxLength: MAX_SEQUENCE_TOKENS,
    showDownloadProgress: false,
  })

  return {
    modelId: manifest.id,
    dimensions: manifest.dimensions,

    async queryEmbed(query: string): Promise<number[]> {
      const vectors = await embedAll(engine, [`${BGE_QUERY_INSTRUCTION}${query}`])
      const first = vectors[0]
      if (!first) throw new ModelAssetsError('embedding 引擎未返回查询向量')
      return first
    },

    async passageEmbed(passages: string[]): Promise<number[][]> {
      if (passages.length === 0) return []
      return embedAll(engine, passages)
    },
  }
}
