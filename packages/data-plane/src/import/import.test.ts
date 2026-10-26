import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packZip } from '../zip-util.js'
import { exportSubmissionDocx } from '../docx-export.js'
import { withStrictBook } from '../with-plane.js'
import { readProseChapter } from '../chapter.js'
import { proseChapterPath } from '../layout.js'
import { scanLibrary } from '../canon-read.js'
import { parseDocx, extractDocxParagraphs } from './docx-parser.js'
import {
  matchChapterHeading,
  splitByTitle,
  splitByBlankLines,
  splitByWordCount,
  splitDocument,
  parseDocumentToChapters,
} from './chapter-splitter.js'
import { importDocumentToBook } from './document-importer.js'
import { ImportParseError } from './types.js'

describe('分章解析与文档导入引擎 (Import Engine · S-03)', () => {
  describe('DOCX 零三方依赖解包与解析 (parseDocx)', () => {
    it('正常解析标准 DOCX：提取段落文本与多章节内容', () => {
      const docxBuf = exportSubmissionDocx('绝境求生', '末日生存硬核纪实。', [
        { title: '第一章 警报拉响', content: '警报声撕裂了深夜的死寂。\n陈平从行军床上翻身坐起。' },
        { title: '第二章 地下避难所', content: '重型合金防爆门在身后沉重锁死。\n应急照明灯泛着暗红色的微光。' },
      ])
      const paragraphs = parseDocx(docxBuf)
      expect(paragraphs.length).toBeGreaterThanOrEqual(4)
      expect(paragraphs).toContain('绝境求生')
      expect(paragraphs).toContain('第一章 警报拉响')
      expect(paragraphs).toContain('警报声撕裂了深夜的死寂。')
      expect(paragraphs).toContain('第二章 地下避难所')
      expect(paragraphs).toContain('重型合金防爆门在身后沉重锁死。')
    })

    it('实体转义字符正常解码 (&amp; &lt; &gt; &quot; &#x..;)', () => {
      const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>A &amp; B &lt;tag&gt; &quot;quote&quot; &#x4E2D;&#x6587;</w:t></w:r></w:p>
  </w:body>
</w:document>`
      const paragraphs = extractDocxParagraphs(docXml)
      expect(paragraphs).toEqual(['A & B <tag> "quote" 中文'])
    })

    it('格式损坏负例 1：空 Buffer 抛 EMPTY_CONTENT 异常', () => {
      expect(() => parseDocx(Buffer.alloc(0))).toThrow(ImportParseError)
      expect(() => parseDocx(Buffer.alloc(0))).toThrow(/EMPTY_CONTENT/)
    })

    it('格式损坏负例 2：非 ZIP 格式字节抛 CORRUPT_DOCX 异常', () => {
      const corruptBuf = Buffer.from('NOT_A_VALID_ZIP_HEADER_CONTENT')
      expect(() => parseDocx(corruptBuf)).toThrow(ImportParseError)
      expect(() => parseDocx(corruptBuf)).toThrow(/CORRUPT_DOCX/)
    })

    it('格式损坏负例 3：有效 ZIP 但缺失 word/document.xml 抛 CORRUPT_DOCX 异常', () => {
      const zipWithoutDoc = packZip([
        { path: 'hello.txt', data: 'just a normal text file' },
      ])
      expect(() => parseDocx(zipWithoutDoc)).toThrow(ImportParseError)
      expect(() => parseDocx(zipWithoutDoc)).toThrow(/missing word\/document\.xml/)
    })
  })

  describe('分章切分逻辑 (Chapter Splitter)', () => {
    it('标题正则识别：支持常见中文、英文与 Markdown 章节模式', () => {
      expect(matchChapterHeading('第一章 晨光破晓').isMatch).toBe(true)
      expect(matchChapterHeading('第100章 决战昆仑').isMatch).toBe(true)
      expect(matchChapterHeading('第二卷 龙争虎斗').isMatch).toBe(true)
      expect(matchChapterHeading('第十二回 假宝玉情迷金锁').isMatch).toBe(true)
      expect(matchChapterHeading('第一节 理论基础').isMatch).toBe(true)
      expect(matchChapterHeading('Chapter 1 The Journey Begins').isMatch).toBe(true)
      expect(matchChapterHeading('Chapter IV The Return').isMatch).toBe(true)
      expect(matchChapterHeading('# 序幕').isMatch).toBe(true)
      expect(matchChapterHeading('## 第二章 潜行').isMatch).toBe(true)
      expect(matchChapterHeading('【引子】万物有始').isMatch).toBe(true)
      expect(matchChapterHeading('楔子 梦醒时分').isMatch).toBe(true)
      expect(matchChapterHeading('尾声').isMatch).toBe(true)
      expect(matchChapterHeading('番外：年少时光').isMatch).toBe(true)

      // 普通正文不应被误判为标题
      expect(matchChapterHeading('今天早上的天气格外晴朗，阳光洒满了整个房间。').isMatch).toBe(false)
      expect(matchChapterHeading('第次尝试失败了').isMatch).toBe(false)
    })

    it('TXT/MD 标题分章：正常切分多章并过滤冗余书名', () => {
      const txt = `《大唐诡事》
作者：无名客

第一章 离奇命案
长安城西市，一具无名尸首斜倚在胡商酒肆的廊檐下。
仵作狄仁杰蹲下身子，仔细端详着死者颈项间的乌青印记。

第二章 追查线索
细雨如丝，顺着朱雀大街的青石板蜿蜒流淌。
探子送来了密信，上面只有寥寥数语。

第三章 破晓收网
更夫的梆子声刚刚停歇，金吾卫已将宅邸围得水泄不通。
真相终于大白。`

      const chapters = splitDocument(txt, { splitMode: 'title' }, '大唐诡事')
      expect(chapters.length).toBe(3)
      expect(chapters[0]?.title).toBe('第一章 离奇命案')
      expect(chapters[0]?.content).toContain('长安城西市')
      expect(chapters[1]?.title).toBe('第二章 追查线索')
      expect(chapters[1]?.content).toContain('朱雀大街')
      expect(chapters[2]?.title).toBe('第三章 破晓收网')
      expect(chapters[2]?.content).toContain('金吾卫')

      // 测试 splitByTitle 底层函数与 parseDocumentToChapters 顶层封装
      const lines = txt.split('\n')
      const byTitle = splitByTitle(lines, '大唐诡事')
      expect(byTitle.length).toBe(3)

      const parsed = parseDocumentToChapters({ content: txt, format: 'txt', bookTitle: '大唐诡事' })
      expect(parsed.length).toBe(3)
    })

    it('空行后备切分：当无明确章节名时，按连续空行将长文切分成章节', () => {
      const txt = `这里是开始的故事，一段简单的文字。


这里是中间的故事，继续前行。


这里是最后的故事，一切尘埃落定。`

      const chapters = splitByBlankLines(txt)
      expect(chapters.length).toBe(3)
      expect(chapters[0]?.content).toContain('开始的故事')
      expect(chapters[1]?.content).toContain('中间的故事')
      expect(chapters[2]?.content).toContain('最后的故事')
    })

    it('字数阈值后备切分：超长无章节文本按阈值在段落边界切分', () => {
      const p1 = '第一大段文字。'.repeat(100) // ~700 字
      const p2 = '第二大段文字。'.repeat(100) // ~700 字
      const p3 = '第三大段文字。'.repeat(100) // ~700 字
      const p4 = '第四大段文字。'.repeat(100) // ~700 字
      const fullText = [p1, p2, p3, p4].join('\n\n')

      // 设置阈值为 1000 字
      const chapters = splitByWordCount(fullText, 1000)
      expect(chapters.length).toBeGreaterThanOrEqual(2)
      for (const ch of chapters) {
        expect(ch.wordCount).toBeGreaterThan(0)
      }
    })

    it('auto 模式自动级联后备：长篇无标题文稿自动触发后备切分', () => {
      const p1 = '正文段落一。'.repeat(200) // ~1200 字
      const p2 = '正文段落二。'.repeat(200) // ~1200 字
      const p3 = '正文段落三。'.repeat(200) // ~1200 字
      const text = [p1, p2, p3].join('\n\n\n\n')

      const chapters = splitDocument(text, { splitMode: 'auto', wordCountThreshold: 1000 })
      expect(chapters.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('原子建书建章落盘与事务回滚保障 (importDocumentToBook)', () => {
    let parentDir: string

    const cleanDir = (dir: string) => {
      try {
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
      } catch {
        // Windows 文件锁宽容处理
      }
    }

    it('TXT 正向导入：原子创建书目录、章节大纲、正文与基线', () => {
      parentDir = mkdtempSync(join(tmpdir(), 'mozhou-import-txt-'))
      try {
        const txt = `第一章 初出茅庐
少年背着长剑走出山门。

第二章 江湖险恶
客栈里的灯火忽明忽暗。`

        const result = importDocumentToBook({
          parentDir,
          title: '少年行',
          content: txt,
          format: 'txt',
        })

        expect(result.title).toBe('少年行')
        expect(result.chapterCount).toBe(2)
        expect(existsSync(result.root)).toBe(true)

        // 验证正文与大纲文件真实落盘
        const ch1Scan = readProseChapter(result.root, proseChapterPath(1))
        expect(ch1Scan.phase).toBe('draft')
        expect(ch1Scan.body).toContain('初出茅庐')
        expect(ch1Scan.body).toContain('少年背着长剑走出山门')

        const ch2Scan = readProseChapter(result.root, proseChapterPath(2))
        expect(ch2Scan.phase).toBe('draft')
        expect(ch2Scan.body).toContain('江湖险恶')
        expect(ch2Scan.body).toContain('客栈里的灯火忽明忽暗')

        // 验证书库扫描可见且章节数正确
        const lib = scanLibrary(parentDir)
        expect(lib.books.length).toBe(1)
        expect(lib.books[0]?.book.title).toBe('少年行')
        expect(lib.books[0]?.chapterCount).toBe(2)
      } finally {
        cleanDir(parentDir)
      }
    })

    it('Markdown 正向导入：解析 # 与 ## 标题层级为对应章节', () => {
      parentDir = mkdtempSync(join(tmpdir(), 'mozhou-import-md-'))
      try {
        const md = `# 第一章 天启纪元
繁星在天幕中连成一片古老的图腾。

## 第二章 智械觉醒
中央处理器中掠过一道自我意识的电光。`

        const result = importDocumentToBook({
          parentDir,
          title: '星海编年史',
          content: md,
          format: 'md',
        })

        expect(result.chapterCount).toBe(2)
        const overview = withStrictBook(result.root, (plane) => plane.getWorksOverview())
        expect(overview.chapters.length).toBe(2)
        expect(overview.totalWordCount).toBeGreaterThan(0)
      } finally {
        cleanDir(parentDir)
      }
    })

    it('DOCX 正向导入：零三方依赖直接解包导入二进制 DOCX', () => {
      parentDir = mkdtempSync(join(tmpdir(), 'mozhou-import-docx-'))
      try {
        const docxBuf = exportSubmissionDocx('沧浪志', '江湖恩怨与庙堂兴衰。', [
          { title: '第一章 寒江独钓', content: '千山鸟飞绝，万径人踪灭。\n孤舟蓑笠翁，独钓寒江雪。' },
          { title: '第二章 古道西风', content: '枯藤老树昏鸦，小桥流水人家。\n古道西风瘦马，夕阳西下。' },
        ])

        const result = importDocumentToBook({
          parentDir,
          title: '沧浪志',
          buffer: docxBuf,
          format: 'docx',
        })

        expect(result.chapterCount).toBe(2)
        expect(existsSync(result.root)).toBe(true)

        const ch1 = readProseChapter(result.root, proseChapterPath(1))
        expect(ch1.body).toContain('寒江独钓')
        expect(ch1.body).toContain('孤舟蓑笠翁')

        const ch2 = readProseChapter(result.root, proseChapterPath(2))
        expect(ch2.body).toContain('古道西风')
        expect(ch2.body).toContain('夕阳西下')
      } finally {
        cleanDir(parentDir)
      }
    })

    it('原子性负例 1：内容为空或纯空白时拒绝建书，盘上零目录残留', () => {
      parentDir = mkdtempSync(join(tmpdir(), 'mozhou-import-empty-'))
      try {
        expect(() =>
          importDocumentToBook({
            parentDir,
            title: '空空如也',
            content: '   \n\n\t  ',
            format: 'txt',
          }),
        ).toThrow(ImportParseError)

        const targetDir = join(parentDir, '空空如也')
        expect(existsSync(targetDir)).toBe(false)
        expect(readdirSync(parentDir).length).toBe(0)
      } finally {
        cleanDir(parentDir)
      }
    })

    it('原子性负例 2：DOCX 损坏时拒绝建书，盘上零目录残留', () => {
      parentDir = mkdtempSync(join(tmpdir(), 'mozhou-import-corrupt-'))
      try {
        const corruptBuf = Buffer.from('FAKE_CORRUPTED_DOCX_BYTES')
        expect(() =>
          importDocumentToBook({
            parentDir,
            title: '损坏文档',
            buffer: corruptBuf,
            format: 'docx',
          }),
        ).toThrow(ImportParseError)

        const targetDir = join(parentDir, '损坏文档')
        expect(existsSync(targetDir)).toBe(false)
        expect(readdirSync(parentDir).length).toBe(0)
      } finally {
        cleanDir(parentDir)
      }
    })

    it('原子性负例 3 (硬核事务回滚)：中途发生写入异常时自动回滚，绝不残留半本书', () => {
      parentDir = mkdtempSync(join(tmpdir(), 'mozhou-import-rollback-'))
      try {
        const txt = `第一章 正常写入
这是第一章的正文。

第二章 崩溃注入
触发模拟系统故障。

第三章 未达之境
永远不应该被落盘。`

        const targetDir = join(parentDir, '半途而废之书')

        // 注入在写入第 2 章时的模拟异常
        expect(() =>
          importDocumentToBook({
            parentDir,
            title: '半途而废之书',
            content: txt,
            format: 'txt',
            _testHookBeforeChapterDraft: (chapterIndex) => {
              if (chapterIndex === 2) {
                throw new Error('SIMULATED_CRASH_DURING_CHAPTER_2')
              }
            },
          }),
        ).toThrow('SIMULATED_CRASH_DURING_CHAPTER_2')

        // 关键断言：事务完全回滚，创建的目录已被完整删除，盘上无半本书！
        expect(existsSync(targetDir)).toBe(false)
        expect(readdirSync(parentDir).length).toBe(0)
      } finally {
        cleanDir(parentDir)
      }
    })
  })
})
