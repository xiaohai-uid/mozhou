import { describe, expect, it } from 'vitest'
import { exportCleanTxt, type ChapterExportItem } from './txt-clean.js'
import { exportSubmissionDocx } from './docx-export.js'
import { exportSubmissionEpub } from './epub-export.js'
import { unpackZip } from './zip-util.js'

describe('物理全格式导出验证 (TXT / DOCX / EPUB)', () => {
  const sampleChapters: ChapterExportItem[] = [
    {
      title: '第一章 雾气弥漫的渡口',
      content: '天色将明未明，渡口的木栈桥在晨雾中若隐若现。\n少年紧了紧背后的青布包袱，踏上了微晃的跳板。',
    },
    {
      title: '第二章 舟行深水处',
      content: '老艄公摇动木橹，水声欸乃作响。\n江面苍茫，远山如黛，唯有一叶扁舟破浪而行。',
    },
  ]

  it('TXT 导出：生成纯净文本，含书名与各章节正文', () => {
    const txt = exportCleanTxt('雾渡行记', sampleChapters)
    expect(txt).toContain('雾渡行记')
    expect(txt).toContain('第一章 雾气弥漫的渡口')
    expect(txt).toContain('天色将明未明')
    expect(txt).toContain('第二章 舟行深水处')
    expect(txt).toContain('老艄公摇动木橹')
  })

  it('DOCX 导出：生成合规 OOXML ZIP，包含 document.xml、[Content_Types].xml、_rels', () => {
    const docxBuf = exportSubmissionDocx('雾渡行记', '这是一个关于离乡与远行的故事。', sampleChapters)
    expect(docxBuf.length).toBeGreaterThan(0)
    // PK\x03\x04 ZIP 魔数
    expect(docxBuf.readUInt32LE(0)).toBe(0x04034b50)

    const unpacked = unpackZip(docxBuf)
    const paths = unpacked.map((f) => f.path)
    expect(paths).toContain('[Content_Types].xml')
    expect(paths).toContain('_rels/.rels')
    expect(paths).toContain('word/document.xml')

    const docXmlFile = unpacked.find((f) => f.path === 'word/document.xml')
    expect(docXmlFile).toBeDefined()
    const docXml = docXmlFile!.data.toString('utf8')
    expect(docXml).toContain('雾渡行记')
    expect(docXml).toContain('这是一个关于离乡与远行的故事。')
    expect(docXml).toContain('第一章 雾气弥漫的渡口')
    expect(docXml).toContain('天色将明未明')
    expect(docXml).toContain('第二章 舟行深水处')
    expect(docXml).toContain('老艄公摇动木橹')
  })

  it('EPUB 导出：生成合规 EPUB 3 ZIP，首项为未压缩 mimetype，包含 container 与 content.opf', () => {
    const epubBuf = exportSubmissionEpub('雾渡行记', '江舟客', sampleChapters)
    expect(epubBuf.length).toBeGreaterThan(0)
    expect(epubBuf.readUInt32LE(0)).toBe(0x04034b50)

    // EPUB 标准：第 30 字节起为文件名 mimetype，内容为 application/epub+zip 且未压缩
    const unpacked = unpackZip(epubBuf)
    expect(unpacked[0]?.path).toBe('mimetype')
    expect(unpacked[0]?.data.toString('utf8')).toBe('application/epub+zip')

    const paths = unpacked.map((f) => f.path)
    expect(paths).toContain('META-INF/container.xml')
    expect(paths).toContain('OEBPS/content.opf')
    expect(paths).toContain('OEBPS/toc.ncx')
    expect(paths).toContain('OEBPS/nav.xhtml')
    expect(paths).toContain('OEBPS/chapter_1.xhtml')
    expect(paths).toContain('OEBPS/chapter_2.xhtml')

    const ch1 = unpacked.find((f) => f.path === 'OEBPS/chapter_1.xhtml')
    expect(ch1).toBeDefined()
    const ch1Text = ch1!.data.toString('utf8')
    expect(ch1Text).toContain('第一章 雾气弥漫的渡口')
    expect(ch1Text).toContain('天色将明未明')

    const opf = unpacked.find((f) => f.path === 'OEBPS/content.opf')
    expect(opf).toBeDefined()
    const opfText = opf!.data.toString('utf8')
    expect(opfText).toContain('雾渡行记')
    expect(opfText).toContain('江舟客')
  })
})
