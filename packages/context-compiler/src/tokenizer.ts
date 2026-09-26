/**
 * 精确 Token 计量（token-budget-assembly-spec §3）。
 *
 * 规格明令：估算器严禁进入预算核算路径；计量必须来自注入的 ExactTokenizer。
 * 此前生产用的是「1 码点 ≈ 1 token」估算器（apps/web/server/draftContext.ts 的
 * previewCodepointTokenizer），它直接驱动正文保底配额与结构层截断——估算偏差会让
 * 「零 token 溢出」的承诺不成立，也让 Receipt 的预算可复算性失去意义。
 *
 * 本模块用**随仓内置**的 bge-small-zh-v1.5 WordPiece 词表（21128 词条，与 embedding
 * 共用同一份资产、同一个 sha256 清单）做真实分词计数，全程零联网：
 *   BertNormalizer(clean_text, handle_chinese_chars, lowercase=false)
 *   → BertPreTokenizer（空白切分 + 标点独立）
 *   → WordPiece 贪心最长匹配（continuing prefix "##"，超长词落 [UNK]）
 *
 * 与 HuggingFace `BertWordPieceTokenizer` 对齐。**已知偏差**（如实列出，未逐条对参考实现
 * 逐例验证过）：
 *   - Cf/格式字符：HF 的 `clean_text` 会删除 U+200B/200D/200E/2060/FEFF/00AD 等；
 *     本实现把 U+FEFF 当空白归一为空格（多算 1），把 ZWJ 等当普通字符（少算）。
 *   - 特殊 token 字面量：HF 管线由 `added_tokens` 整词命中（`[UNK]` 算 1），
 *     本实现按普通文本切分（算 3）。这些字面量不会出现在正文预算里。
 * 已知偏差的方向**不保证**是保守的——预算路径的欠计会让真实上下文超出窗口，
 * 所以任何"我们只会多算"的推断都不成立，改动预分词/归一化逻辑必须重新对基准。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExactTokenizer } from './assemble.js'

const MODEL_DIR_NAME = 'bge-small-zh-v1.5'
const TOKENIZER_FILE = 'tokenizer.json'
const CONTINUING_PREFIX = '##'
const MAX_INPUT_CHARS_PER_WORD = 100
const UNK_TOKEN = '[UNK]'

/** 词表资产缺失/损坏（与 embedding 资产同一份清单，装载失败即响亮失败，不退化估算）。 */
export class TokenizerAssetsError extends Error {
  override readonly name = 'TokenizerAssetsError'
  constructor(detail: string) {
    super(`内置 tokenizer 资产不可用：${detail}。安装文档见 docs/install.md`)
  }
}

interface WordPieceDocument {
  readonly model?: {
    readonly type?: string
    readonly unk_token?: string
    readonly continuing_subword_prefix?: string
    readonly max_input_chars_per_word?: number
    readonly vocab?: Record<string, number>
  }
  readonly normalizer?: {
    readonly type?: string
    readonly clean_text?: boolean
    readonly handle_chinese_chars?: boolean
    readonly lowercase?: boolean
  } | null
  readonly pre_tokenizer?: { readonly type?: string } | null
}

/** 从本模块位置向上找 assets/models/<model>（与 embedding 同款解析）。 */
function resolveAssetDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const candidate = join(dir, 'assets', 'models', MODEL_DIR_NAME)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) {
      throw new TokenizerAssetsError(`资产目录缺失（期望 assets/models/${MODEL_DIR_NAME}）`)
    }
    dir = parent
  }
}

/** BERT clean_text 判据：\t \n \r 不算控制字符。 */
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/
/** BertPreTokenizer 的标点判据（ASCII 标点 + Unicode 标点类）。 */
const PUNCT_RE = /[!-/:-@[-`{-~]|\p{P}/u

function isChineseChar(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff)
    || (cp >= 0x3400 && cp <= 0x4dbf)
    || (cp >= 0x20000 && cp <= 0x2a6df)
    || (cp >= 0x2a700 && cp <= 0x2b73f)
    || (cp >= 0x2b740 && cp <= 0x2b81f)
    || (cp >= 0x2b820 && cp <= 0x2ceaf)
    || (cp >= 0xf900 && cp <= 0xfaff)
    || (cp >= 0x2f800 && cp <= 0x2fa1f)
  )
}

/** BertNormalizer：clean_text 丢控制字符并把空白归一为空格；CJK 两侧补空格；不改大小写。 */
function normalize(text: string, handleChinese: boolean): string {
  const out: string[] = []
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0
    if (cp === 0 || cp === 0xfffd || CONTROL_RE.test(char)) continue
    if (/\s/.test(char)) {
      out.push(' ')
      continue
    }
    if (handleChinese && isChineseChar(cp)) {
      out.push(' ', char, ' ')
      continue
    }
    out.push(char)
  }
  return out.join('')
}

/**
 * BertPreTokenizer：先按空白切，再把**每个标点字符各自**切成独立片段。
 *
 * 必须逐字符隔离，不能把连续标点合并成一个整词——HF 的 BertPreTokenizer 就是逐字符
 * 隔离的（`……` 是 2 个 token 不是 1 个）。合并会让标点密集的文本系统性少算，而
 * 预算路径的欠计是危险方向（真实上下文超出窗口）。
 */
function preTokenize(text: string): string[] {
  const words: string[] = []
  for (const chunk of text.split(/\s+/)) {
    if (chunk.length === 0) continue
    let current = ''
    for (const char of chunk) {
      if (PUNCT_RE.test(char)) {
        if (current.length > 0) {
          words.push(current)
          current = ''
        }
        words.push(char)
        continue
      }
      current += char
    }
    if (current.length > 0) words.push(current)
  }
  return words
}

function loadWordPiece(assetDir: string): {
  readonly vocab: ReadonlyMap<string, number>
  readonly unk: string
  readonly continuing: string
  readonly maxChars: number
  readonly handleChinese: boolean
} {
  const path = join(assetDir, TOKENIZER_FILE)
  if (!existsSync(path)) {
    throw new TokenizerAssetsError(`缺 ${TOKENIZER_FILE}`)
  }
  verifyTokenizerAsset(assetDir, path)
  let doc: WordPieceDocument
  try {
    doc = JSON.parse(readFileSync(path, 'utf-8')) as WordPieceDocument
  } catch (error) {
    throw new TokenizerAssetsError(`${TOKENIZER_FILE} 不是合法 JSON：${(error as Error).message}`)
  }
  if (doc.model?.type !== 'WordPiece') {
    throw new TokenizerAssetsError(`期望 WordPiece 模型，实际 ${String(doc.model?.type)}`)
  }
  const vocabRecord = doc.model.vocab ?? {}
  const vocab = new Map<string, number>(Object.entries(vocabRecord))
  if (vocab.size === 0) {
    throw new TokenizerAssetsError('词表为空')
  }
  return {
    vocab,
    unk: doc.model.unk_token ?? UNK_TOKEN,
    continuing: doc.model.continuing_subword_prefix ?? CONTINUING_PREFIX,
    maxChars: doc.model.max_input_chars_per_word ?? MAX_INPUT_CHARS_PER_WORD,
    // normalizer 显式给 false 时才是 false（BertNormalizer 缺省为 true）
    handleChinese: doc.normalizer?.handle_chinese_chars ?? true,
  }
}

function sha256FileHex(absolutePath: string): string {
  return createHash('sha256').update(readFileSync(absolutePath)).digest('hex')
}

interface AssetManifest {
  readonly files?: readonly { readonly path: string; readonly sha256: string; readonly bytes: number }[]
}

/**
 * 装载前按清单复核 tokenizer.json（与 embedding 同一份 manifest、同一套纪律）。
 * 清单缺失或未登记该文件即失败——词表是计量权威源，不能来自未校验的字节。
 */
function verifyTokenizerAsset(assetDir: string, path: string): void {
  const manifestPath = join(assetDir, 'manifest.json')
  if (!existsSync(manifestPath)) {
    throw new TokenizerAssetsError(`缺资产清单 ${manifestPath}`)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as AssetManifest
  const entry = manifest.files?.find((file) => file.path === TOKENIZER_FILE)
  if (entry === undefined) {
    throw new TokenizerAssetsError(`资产清单未登记 ${TOKENIZER_FILE}`)
  }
  if (statSync(path).size !== entry.bytes || sha256FileHex(path) !== entry.sha256) {
    throw new TokenizerAssetsError(`${TOKENIZER_FILE} 校验失败（字节数或 sha256 不符）`)
  }
}

/** WordPiece 贪心最长匹配：整词无法切分时作为一个 [UNK]。 */
function countWordPiece(word: string, w: ReturnType<typeof loadWordPiece>): number {
  if (word.length > w.maxChars) return 1
  let start = 0
  let count = 0
  while (start < word.length) {
    let end = word.length
    let matched: string | null = null
    while (start < end) {
      const piece = (start > 0 ? w.continuing : '') + word.slice(start, end)
      if (w.vocab.has(piece)) {
        matched = piece
        break
      }
      end -= 1
    }
    if (matched === null) return 1
    count += 1
    start = end
  }
  return count
}

/** 词表只装载一次：439KB JSON 的解析不该每请求重来。 */
let cached: ExactTokenizer | null = null

/**
 * 创建基于随仓 WordPiece 词表的精确计数器。
 * 装载失败即抛 TokenizerAssetsError——**不退化到估算器**（规格 §3 明令禁止）。
 */
export function createLocalTokenizer(options: { readonly assetDir?: string } = {}): ExactTokenizer {
  if (options.assetDir === undefined && cached !== null) return cached
  const assetDir = options.assetDir ?? resolveAssetDir()
  const w = loadWordPiece(assetDir)
  const tokenizer: ExactTokenizer = {
    version: `mozhou-bert-wordpiece-${MODEL_DIR_NAME}-v1`,
    count(text: string): number {
      if (text.length === 0) return 0
      let total = 0
      for (const word of preTokenize(normalize(text, w.handleChinese))) {
        total += countWordPiece(word, w)
      }
      return total
    },
  }
  if (options.assetDir === undefined) cached = tokenizer
  return tokenizer
}
