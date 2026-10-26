/**
 * packages/data-plane · 零三方依赖 DOCX 文本与段落抽取器 (S-03 · DOCX Parser)。
 * 复用 packages/data-plane/src/zip-util.ts 的 unpackZip 解包 word/document.xml，
 * 严格按照 OOXML 标准提取段落与文本。
 */
import { unpackZip, type UnpackedFile } from '../zip-util.js'
import { ImportParseError } from './types.js'

function unescapeXml(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}

function extractParagraphText(pXml: string): string {
  // 转换制表符与换行符
  const normalized = pXml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:(?:br|cr)\b[^>]*\/>/g, '\n')

  let result = ''
  const regex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|\n|\t/g
  let m: RegExpExecArray | null
  while ((m = regex.exec(normalized)) !== null) {
    if (m[0] === '\n') {
      result += '\n'
    } else if (m[0] === '\t') {
      result += '\t'
    } else if (m[1] !== undefined) {
      result += m[1]
    }
  }
  return unescapeXml(result)
}

/**
 * 从 word/document.xml 内容中提取所有段落文本列表。
 */
export function extractDocxParagraphs(docXml: string): string[] {
  const paragraphs: string[] = []
  const pRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g
  let pMatch: RegExpExecArray | null
  while ((pMatch = pRegex.exec(docXml)) !== null) {
    const pContent = pMatch[1] ?? ''
    const text = extractParagraphText(pContent).trim()
    if (text.length > 0) {
      paragraphs.push(text)
    }
  }
  return paragraphs
}

/**
 * 解包 DOCX Buffer 并提取全部段落。
 */
export function parseDocx(buf: Buffer): string[] {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    throw new ImportParseError('EMPTY_CONTENT', 'DOCX buffer is empty')
  }

  // 校验 ZIP PK 魔数 (0x04034b50)
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) {
    throw new ImportParseError('CORRUPT_DOCX', 'file is not a valid zip/docx archive (missing PK magic bytes)')
  }

  let files: UnpackedFile[]
  try {
    files = unpackZip(buf)
  } catch (err) {
    throw new ImportParseError('CORRUPT_DOCX', `failed to unpack docx archive: ${(err as Error).message}`)
  }

  const docFile = files.find((f) => f.path === 'word/document.xml')
  if (!docFile) {
    throw new ImportParseError('CORRUPT_DOCX', 'invalid docx archive: missing word/document.xml')
  }

  const docXml = docFile.data.toString('utf8')
  const paragraphs = extractDocxParagraphs(docXml)
  if (paragraphs.length === 0) {
    throw new ImportParseError('EMPTY_CONTENT', 'docx document contains no readable paragraph text')
  }

  return paragraphs
}
