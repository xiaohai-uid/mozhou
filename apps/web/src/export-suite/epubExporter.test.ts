/**
 * EPUB 3 导出器测试：
 * - mimetype 必须是 ZIP 首条目且 STORED（EPUB OCF 规范，违反则主流阅读器拒开）；
 * - container.xml / content.opf / nav.xhtml / toc.ncx 结构齐备；
 * - 正文与标题做 XML 转义（& < > 不转义会产出损坏 EPUB）；
 * - 中文段落切分与全角缩进清理与 txtCleanExporter 同口径。
 */
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildEpub, exportEpubBlob } from './epubExporter'

describe('buildEpub（真实 EPUB 3 打包）', () => {
  const chapters = [
    { title: '第一章 & 开端 <上>', content: '　　江水初涨，渡口无人。\n\n灯火尽灭。' },
    { title: '第二章 迷雾重重', content: '钟声骤响，"夜雨"落下。' },
  ]

  it('mimetype 为 ZIP 首条目、内容正确且未压缩（STORED）', async () => {
    const bytes = await buildEpub('夜雨江澜', '墨舟', chapters)
    // ZIP 本地文件头：偏移 8-9 为压缩方法（0 = STORED）
    expect(bytes[8]).toBe(0)
    expect(bytes[9]).toBe(0)
    const headerText = new TextDecoder().decode(bytes.slice(0, 4 + 8 + 2 + 30))
    expect(headerText).toContain('mimetype')

    const zip = await JSZip.loadAsync(bytes)
    expect(Object.keys(zip.files)[0]).toBe('mimetype')
    expect(await zip.file('mimetype')?.async('text')).toBe('application/epub+zip')
  })

  it('包含 container.xml、content.opf、nav.xhtml、toc.ncx 与全部章节', async () => {
    const bytes = await buildEpub('夜雨江澜', '墨舟', chapters)
    const zip = await JSZip.loadAsync(bytes)

    const container = await zip.file('META-INF/container.xml')?.async('text')
    expect(container).toContain('full-path="OEBPS/content.opf"')

    const opf = await zip.file('OEBPS/content.opf')?.async('text')
    expect(opf).toContain('<dc:title>夜雨江澜</dc:title>')
    expect(opf).toContain('<dc:creator>墨舟</dc:creator>')
    expect(opf).toContain('<dc:language>zh-CN</dc:language>')
    expect(opf).toContain('properties="nav"')
    expect((opf?.match(/<itemref idref="chapter_\d+"\/>/g) ?? []).length).toBe(2)

    const nav = await zip.file('OEBPS/nav.xhtml')?.async('text')
    expect(nav).toContain('epub:type="toc"')
    expect(nav).toContain('chapter_1.xhtml')
    expect(nav).toContain('chapter_2.xhtml')

    const ncx = await zip.file('OEBPS/toc.ncx')?.async('text')
    expect(ncx).toContain('<navLabel><text>第一章 &amp; 开端 &lt;上&gt;</text></navLabel>')
  })

  it('正文做 XML 转义并按空行分段、去首行全角缩进', async () => {
    const bytes = await buildEpub('夜雨江澜', '墨舟', chapters)
    const zip = await JSZip.loadAsync(bytes)

    const ch1 = await zip.file('OEBPS/chapter_1.xhtml')?.async('text')
    expect(ch1).toContain('<h2>第一章 &amp; 开端 &lt;上&gt;</h2>')
    expect(ch1).toContain('<p>江水初涨，渡口无人。</p>')
    expect(ch1).toContain('<p>灯火尽灭。</p>')
    // 原文中的裸 < 不应残留（已转义）
    expect(ch1).not.toContain('<上>')

    const ch2 = await zip.file('OEBPS/chapter_2.xhtml')?.async('text')
    expect(ch2).toContain('<p>钟声骤响，&quot;夜雨&quot;落下。</p>')
  })

  it('空章节列表拒绝导出', async () => {
    await expect(buildEpub('空书', '墨舟', [])).rejects.toThrow('无可导出章节')
  })

  it('exportEpubBlob 返回 application/epub+zip 类型 Blob', async () => {
    const blob = await exportEpubBlob('夜雨江澜', '墨舟', chapters)
    expect(blob.type).toBe('application/epub+zip')
    expect(blob.size).toBeGreaterThan(0)
  })
})
