/**
 * YAML frontmatter 最小发射/解析器——只服务 Q13 冻结字段集
 * （标量 + 字符串数组；实体目录卡的别名对象数组归工单 T2 再扩）。
 *
 * 不引第三方 YAML 依赖：我们只处理自己发射的确定性子集，
 * 值保持人读可 grep（`mozhouId: book_01J9X…` 不带引号）。
 * 解析对未知形态宁抛不猜——重建路径（S5）要求坏文件响亮失败。
 */

export type FrontmatterScalar = string | number | boolean | null

export type FrontmatterFieldValue = FrontmatterScalar | readonly FrontmatterScalar[]

export interface FrontmatterDocument {
  readonly data: Readonly<Record<string, FrontmatterFieldValue>>
  /** frontmatter 结束符之后的正文区。 */
  readonly body: string
}

/** 需要双引号包裹的字符串：空串/首尾空白/YAML 特殊字符/会被误判为标量字面量。 */
function needsQuoting(value: string): boolean {
  if (value === '' || value !== value.trim()) {
    return true
  }
  if (/^(null|true|false|-?\d+(\.\d+)?([eE][+-]?\d+)?)$/.test(value)) {
    return true
  }
  // YAML 指示符与流集合字符一律引起来，保证 plain scalar 无歧义
  return /[:#{}[\],&*'!|>%@`"?\n]/.test(value)
}

function quoteIfNeeded(value: string): string {
  return needsQuoting(value)
    ? `"${value.replaceAll('\\', '\\\\').replaceAll('"', String.raw`\"`)}"`
    : value
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

/**
 * 发射 `---\n…\n---\n` frontmatter 块。字段顺序 = 对象插入顺序
 * （调用方按冻结字段集顺序传入），保证同状态产出逐字节一致。
 * 数组值以块序列发射；空数组发 flow 形式 `key: []`。
 */
export function emitFrontmatter(fields: Readonly<Record<string, FrontmatterFieldValue>>): string {
  const lines: string[] = ['---']
  for (const [key, raw] of Object.entries(fields)) {
    // Array.isArray 不收窄 readonly 数组联合，显式归一
    const items = Array.isArray(raw) ? (raw as readonly FrontmatterScalar[]) : null
    if (items !== null) {
      if (items.length === 0) {
        lines.push(`${key}: []`)
        continue
      }
      lines.push(`${key}:`)
      for (const item of items) {
        lines.push(`- ${formatScalar(item)}`)
      }
      continue
    }
    lines.push(`${key}: ${formatScalar(raw as FrontmatterScalar)}`)
  }
  lines.push('---')
  return `${lines.join('\n')}\n`
}

function coerceScalar(text: string): FrontmatterFieldValue {
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
    return trimmed.slice(1, -1).replaceAll(String.raw`\"`, '"').replaceAll('\\\\', '\\')
  }
  if (trimmed === '[]') {
    return []
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('&') || trimmed.startsWith('*')) {
    throw new Error(`unsupported frontmatter value syntax: ${trimmed}`)
  }
  return trimmed
}

/**
 * 解析本模块发射的 frontmatter 子集。缺 frontmatter、分隔符残缺或
 * 出现不支持的行形即抛错——重建扫描宁可失败也不静默吸收脏结构。
 */
export function parseFrontmatter(raw: string): FrontmatterDocument {
  // 结束符必须独占一行（`\n----` 不是结束符），其后即正文区
  const match = /^---\n([\s\S]*?\n)---(?:\n|$)/.exec(raw)
  if (match === null) {
    throw new Error('malformed YAML frontmatter delimiters')
  }
  const block = match[1]!
  const body = raw.slice(match[0].length)

  const data: Record<string, FrontmatterFieldValue> = {}
  let currentKey: string | null = null
  let currentItems: FrontmatterScalar[] | null = null
  for (const line of block.split('\n')) {
    if (line === '') {
      continue
    }
    if (line.startsWith('- ')) {
      if (currentKey === null || currentItems === null) {
        throw new Error(`sequence item outside a key: ${line}`)
      }
      const item = coerceScalar(line.slice(2))
      // 序列项只允许标量（对象数组归 T2 目录卡再扩）
      if (Array.isArray(item)) {
        throw new Error(`unsupported sequence item: ${line}`)
      }
      // Array.isArray 无法收窄 readonly 数组联合，守卫后显式断言
      currentItems.push(item as FrontmatterScalar)
      continue
    }
    const separator = line.indexOf(':')
    const key = separator > 0 ? line.slice(0, separator) : ''
    // 键限定 ASCII 标识符形态——Q13 冻结字段集与 T2 目录卡字段均为 ASCII
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) {
      throw new Error(`unsupported frontmatter line: ${line}`)
    }
    currentKey = key
    currentItems = null
    data[currentKey] = coerceScalar(line.slice(separator + 1))
    // 块序列以空值占位开始：`key:` 后跟 `- item`
    if (data[currentKey] === '' && line.endsWith(':')) {
      currentItems = []
      data[currentKey] = currentItems
    }
  }
  return { data, body }
}
