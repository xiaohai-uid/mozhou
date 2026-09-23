/**
 * YAML frontmatter 最小发射/解析器——服务 Q13 冻结字段集 + T2 实体目录卡
 * （entity-directory-spec §3：别名对象数组 / flow 序列排除词表）。
 *
 * 不引第三方 YAML 依赖：我们只处理自己发射的确定性子集，
 * 值保持人读可 grep（`ref: char:lin-feng` 不带引号）。
 * 发射形态（逐字节确定性，字段顺序 = 调用方插入顺序）：
 *   - 标量 / 块序列标量 / 空数组 flow：同 v1；
 *   - 对象数组：块序列 + 单行 flow 映射 `- {text: 林枫, kind: exact}`；
 * 解析额外接受外部编辑器常见形态（宁抛不猜之外的最小容忍）：
 *   - flow 序列 `key: [a, "b c"]`；
 *   - 块标量 `key: >-` / `|-`（折叠/字面，含 chomping 后缀）。
 * 解析对未知形态一律抛错——重建路径（S5）要求坏文件响亮失败。
 */

export type FrontmatterScalar = string | number | boolean | null

/** flow 映射内的记录（别名规则的落盘形态；键序由调用方冻结）。 */
export type FrontmatterRecord = Readonly<Record<string, FrontmatterScalar>>

export type FrontmatterFieldValue =
  | FrontmatterScalar
  | readonly FrontmatterScalar[]
  | readonly FrontmatterRecord[]

export interface FrontmatterDocument {
  readonly data: Readonly<Record<string, FrontmatterFieldValue>>
  /** frontmatter 结束符之后的正文区。 */
  readonly body: string
}

/** 需要双引号包裹的字符串：空串/首尾空白/YAML 特殊字符/会被误判为标量字面量。
 *  冒号按窄规则判定——仅「后随空白或行尾」才有歧义，
 *  `name` 位上的 `ref: char:lin-feng` 这类值内冒号保持裸文，保住冻结的可 grep 纪律。 */
function needsQuoting(value: string): boolean {
  if (value === '' || value !== value.trim()) {
    return true
  }
  if (/^(null|true|false|-?\d+(\.\d+)?([eE][+-]?\d+)?)$/.test(value)) {
    return true
  }
  if (/\n/.test(value)) {
    return true
  }
  if (/:\s|:$/.test(value)) {
    return true
  }
  if (/(^|\s)#/.test(value)) {
    return true
  }
  return /[{}[\],&*'!|>%@`"?]/.test(value) || /^-/.test(value)
}

function escapeQuoted(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', String.raw`\"`)
    .replaceAll('\n', String.raw`\n`)
}

function quoteIfNeeded(value: string): string {
  return needsQuoting(value) ? `"${escapeQuoted(value)}"` : value
}

function unescapeQuoted(body: string): string {
  let out = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '\\' && i + 1 < body.length) {
      const next = body[i + 1] as string
      if (next === 'n' || next === '"' || next === '\\') {
        out += next === 'n' ? '\n' : next
        i++
        continue
      }
    }
    out += ch
  }
  return out
}

function formatScalar(value: FrontmatterScalar): string {
  if (value === null) {
    return 'null'
  }
  switch (typeof value) {
    case 'string':
      return quoteIfNeeded(value)
    case 'number':
    case 'boolean':
      return String(value)
  }
  throw new Error(`unsupported frontmatter value: ${String(value)}`)
}

function isRecordArray(items: readonly unknown[]): items is readonly FrontmatterRecord[] {
  return items.length > 0 && typeof items[0] === 'object' && items[0] !== null
}

/**
 * 发射 `---\n…\n---\n` frontmatter 块。对象数组以块序列 + flow 映射发射，
 * 键序 = 各记录自身的插入顺序（调用方按冻结键序传入）。
 */
export function emitFrontmatter(fields: Readonly<Record<string, FrontmatterFieldValue>>): string {
  const lines: string[] = ['---']
  for (const [key, raw] of Object.entries(fields)) {
    // Array.isArray 不收窄 readonly 数组联合，显式归一
    const items = Array.isArray(raw) ? (raw as readonly unknown[]) : null
    if (items !== null) {
      if (items.length === 0) {
        lines.push(`${key}: []`)
        continue
      }
      if (isRecordArray(items)) {
        lines.push(`${key}:`)
        for (const record of items) {
          const inner = Object.entries(record)
            .map(([fieldKey, value]) => `${fieldKey}: ${formatScalar(value)}`)
            .join(', ')
          lines.push(`- {${inner}}`)
        }
        continue
      }
      lines.push(`${key}:`)
      for (const item of items as readonly FrontmatterScalar[]) {
        lines.push(`- ${formatScalar(item)}`)
      }
      continue
    }
    lines.push(`${key}: ${formatScalar(raw as FrontmatterScalar)}`)
  }
  lines.push('---')
  return `${lines.join('\n')}\n`
}

function coerceScalar(text: string): FrontmatterScalar {
  const trimmed = text.trim()
  if (trimmed === 'null' || trimmed === '~') {
    return null
  }
  if (trimmed === 'true') {
    return true
  }
  if (trimmed === 'false') {
    return false
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10)
  }
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) {
    return Number.parseFloat(trimmed)
  }
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return unescapeQuoted(trimmed.slice(1, -1))
  }
  return trimmed
}

// ---------------------------------------------------------------------------
// flow 集合解析（`[a, "b c"]` 与 `{text: 林枫, kind: exact}`）
// ---------------------------------------------------------------------------

class FlowParser {
  private pos = 0

  constructor(private readonly src: string) {}

  private skipSpaces(): void {
    while (this.pos < this.src.length && this.src[this.pos] === ' ') {
      this.pos++
    }
  }

  private fail(message: string): never {
    throw new Error(`malformed flow collection "${this.src}": ${message}`)
  }

  /** 流上下文标量：带引号读完整段；否则读到顶层分隔符（`,`/`}`/`]`）。 */
  private readScalar(terminators: string): FrontmatterScalar {
    this.skipSpaces()
    if (this.pos >= this.src.length) {
      this.fail('unexpected end')
    }
    if (this.src[this.pos] === '"') {
      let end = this.pos + 1
      while (end < this.src.length && this.src[end] !== '"') {
        if (this.src[end] === '\\') {
          end++
        }
        end++
      }
      if (end >= this.src.length) {
        this.fail('unterminated quoted scalar')
      }
      const value = unescapeQuoted(this.src.slice(this.pos + 1, end))
      this.pos = end + 1
      return value
    }
    let end = this.pos
    while (end < this.src.length && !terminators.includes(this.src[end] as string)) {
      end++
    }
    if (end === this.pos) {
      this.fail('empty scalar')
    }
    const value = coerceScalar(this.src.slice(this.pos, end))
    this.pos = end
    return value
  }

  private expect(ch: string): void {
    this.skipSpaces()
    if (this.src[this.pos] !== ch) {
      this.fail(`expected '${ch}'`)
    }
    this.pos++
  }

  parseSequence(): readonly FrontmatterScalar[] {
    this.expect('[')
    const items: FrontmatterScalar[] = []
    this.skipSpaces()
    if (this.src[this.pos] === ']') {
      this.pos++
      return items
    }
    for (;;) {
      items.push(this.readScalar(',]'))
      this.skipSpaces()
      const ch = this.src[this.pos]
      if (ch === ',') {
        this.pos++
        continue
      }
      if (ch === ']') {
        this.pos++
        return items
      }
      this.fail(`expected ',' or ']'`)
    }
  }

  parseMapping(): FrontmatterRecord {
    this.expect('{')
    const record: Record<string, FrontmatterScalar> = {}
    this.skipSpaces()
    if (this.src[this.pos] === '}') {
      this.pos++
      return record
    }
    for (;;) {
      this.skipSpaces()
      const colonAt = this.src.indexOf(':', this.pos)
      if (colonAt === -1) {
        this.fail("expected ':'")
      }
      const key = this.src.slice(this.pos, colonAt).trim()
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) {
        this.fail(`unsupported mapping key: ${key}`)
      }
      this.pos = colonAt + 1
      record[key] = this.readScalar(',}')
      this.skipSpaces()
      const ch = this.src[this.pos]
      if (ch === ',') {
        this.pos++
        continue
      }
      if (ch === '}') {
        this.pos++
        return record
      }
      this.fail(`expected ',' or '}'`)
    }
  }
}

function parseFlowValue(text: string): readonly FrontmatterScalar[] | FrontmatterRecord {
  const parser = new FlowParser(text)
  return text.trimStart().startsWith('{') ? parser.parseMapping() : parser.parseSequence()
}

// ---------------------------------------------------------------------------
// 块标量（`>-` / `|-` …）：只服务外部编辑器手写形态，本模块不发射
// ---------------------------------------------------------------------------

function parseBlockScalar(
  indicator: string,
  contentLines: readonly string[],
): string {
  const folded = indicator.startsWith('>')
  const chomping = indicator.slice(1) // '', '-', '+'

  let text: string
  if (folded) {
    // 折叠：相邻非空行折为空格；连续 k 个空行折为 k 个换行
    const parts: string[] = []
    let blankRun = 0
    for (const line of contentLines) {
      if (line === '') {
        blankRun++
        continue
      }
      if (parts.length > 0) {
        parts.push(blankRun > 0 ? '\n'.repeat(blankRun) : ' ')
      }
      blankRun = 0
      parts.push(line)
    }
    text = parts.join('')
  } else {
    text = contentLines.join('\n')
  }

  // 尾部空行数决定 chomping（strip=0、clip=1、keep=全部）
  let trailing = 0
  while (trailing < contentLines.length && contentLines[contentLines.length - 1 - trailing] === '') {
    trailing++
  }
  if (chomping === '-') {
    return text.replace(/\n$/, '')
  }
  if (chomping === '+') {
    return `${text}\n${'\n'.repeat(trailing)}`
  }
  return `${text.replace(/\n$/, '')}\n`
}

/** 去掉块内容行的公共缩进（发射器与常见编辑器都用固定两空格）。 */
function dedent(lines: readonly string[]): string[] {
  let indent: number | null = null
  for (const line of lines) {
    if (line === '') {
      continue
    }
    const width = line.length - line.trimStart().length
    indent = indent === null ? width : Math.min(indent, width)
  }
  if (indent === null || indent === 0) {
    return [...lines]
  }
  return lines.map((line) => (line === '' ? line : line.slice(indent)))
}

/**
 * 解析本模块发射的 frontmatter 子集（外加 flow 序列/块标量的最小容忍）。
 * 缺 frontmatter、分隔符残缺或出现不支持的行形即抛错——重建扫描宁可失败
 * 也不静默吸收脏结构。
 */
export function parseFrontmatter(raw: string): FrontmatterDocument {
  // 结束符必须独占一行（`\n----` 不是结束符），其后即正文区
  const match = /^---\n([\s\S]*?\n)---(?:\n|$)/.exec(raw)
  if (match === null) {
    throw new Error('malformed YAML frontmatter delimiters')
  }
  const blockLines = match[1]!.split('\n')
  // 尾随空串来自块末换行纪律，不是内容
  if (blockLines.at(-1) === '') {
    blockLines.pop()
  }
  const body = raw.slice(match[0].length)

  const data: Record<string, FrontmatterFieldValue> = {}
  let i = 0
  while (i < blockLines.length) {
    const line = blockLines[i] as string
    if (line === '') {
      i++
      continue
    }
    if (line.startsWith('- ')) {
      throw new Error(`sequence item outside a key: ${line}`)
    }
    const separator = line.indexOf(':')
    const key = separator > 0 ? line.slice(0, separator) : ''
    // 键限定 ASCII 标识符形态——Q13 冻结字段集与 T2 目录卡字段均为 ASCII
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) {
      throw new Error(`unsupported frontmatter line: ${line}`)
    }
    const rest = line.slice(separator + 1).trim()

    if (rest === '') {
      // `key:` —— 块序列或空值占位
      let j = i + 1
      while (j < blockLines.length && blockLines[j] === '') {
        j++
      }
      if (j < blockLines.length && blockLines[j]?.startsWith('- ')) {
        const scalars: FrontmatterScalar[] = []
        const records: FrontmatterRecord[] = []
        let sawRecord = false
        while (j < blockLines.length && blockLines[j]?.startsWith('- ')) {
          const itemText = (blockLines[j] as string).slice(2).trim()
          if (itemText.startsWith('{')) {
            const record = new FlowParser(itemText).parseMapping()
            if (!sawRecord && scalars.length > 0) {
              throw new Error(`mixed sequence item forms under key: ${key}`)
            }
            sawRecord = true
            records.push(record)
          } else if (itemText.startsWith('[')) {
            // 嵌套 flow 序列作序列项：不支持，宁抛不猜
            throw new Error(`unsupported sequence item: ${blockLines[j]}`)
          } else {
            const scalar = coerceScalar(itemText)
            if (sawRecord) {
              throw new Error(`mixed sequence item forms under key: ${key}`)
            }
            scalars.push(scalar)
          }
          j++
        }
        data[key] = sawRecord ? records : scalars
        i = j
        continue
      }
      data[key] = ''
      i++
      continue
    }

    if (/^[>|][+-]?$/.test(rest)) {
      // 块标量：吞并后续所有空行与缩进行
      const contentStart = i + 1
      let j = contentStart
      while (
        j < blockLines.length &&
        (blockLines[j] === '' || blockLines[j]?.startsWith(' '))
      ) {
        j++
      }
      const contentLines = dedent(blockLines.slice(contentStart, j))
      data[key] = parseBlockScalar(rest, contentLines)
      i = j
      continue
    }

    if (rest.startsWith('[')) {
      if (!rest.endsWith(']')) {
        throw new Error(`unsupported frontmatter value syntax: ${rest}`)
      }
      const parsed = parseFlowValue(rest)
      if (!Array.isArray(parsed)) {
        throw new Error(`unsupported frontmatter value syntax: ${rest}`)
      }
      data[key] = parsed
      i++
      continue
    }

    if (rest.startsWith('{')) {
      throw new Error(`unsupported frontmatter value syntax: ${rest}`)
    }

    data[key] = coerceScalar(rest)
    i++
  }
  return { data, body }
}
