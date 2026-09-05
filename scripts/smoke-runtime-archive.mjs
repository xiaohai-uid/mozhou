#!/usr/bin/env node
/**
 * 墨舟发行运行时独立 Smoke 验收脚本（T11）。
 * 在解压后的纯生产包中执行：真实 HTTP 建书 → 首章生成夹具 → 读 → 保存 → 读 → 导出 TXT。
 * 零外网依赖，不索取或使用真实 Key，标明不验证 LLM 质量。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const port = process.env.PORT || '5188'
const baseUrl = `http://127.0.0.1:${port}`

interface BookJson {
  root: string
}

interface ChapterReadJson {
  revision: number
  hash: string
  body: string
}

interface ChapterSaveJson {
  revision: number
  hash: string
}

async function main() {
  console.log(`[smoke] starting runtime archive smoke probe against ${baseUrl}...`)

  // 1. 建书
  const bookRes = await fetch(`${baseUrl}/api/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '发行运行时冒烟书' }),
  })
  if (!bookRes.ok) throw new Error(`[smoke] /api/book failed: HTTP ${bookRes.status}`)
  const book = (await bookRes.json()) as BookJson
  const root = book.root
  console.log(`[smoke] step 1: book created at ${root}`)

  // 2. 检查第 1 章草稿文件真实落盘
  const ch1Path = join(root, '正文', '第一卷', '第0001章.md')
  if (!existsSync(ch1Path)) {
    throw new Error(`[smoke] step 2 failed: ${ch1Path} does not exist`)
  }
  console.log(`[smoke] step 2: chapter 1 draft verified on disk`)

  // 3. 读正文与 hash
  const readRes1 = await fetch(`${baseUrl}/api/chapter.read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root, chapterIndex: 1 }),
  })
  if (!readRes1.ok) throw new Error(`[smoke] /api/chapter.read failed: HTTP ${readRes1.status}`)
  const read1 = (await readRes1.json()) as ChapterReadJson
  console.log(`[smoke] step 3: chapter 1 read, revision=${read1.revision}, hash=${read1.hash}`)

  // 4. 手工编辑并保存
  const editedText = '【发布运行时测试】：白鹭低飞，江水微澜。这是本地运行时的第一行已持久化正文。'
  const saveRes = await fetch(`${baseUrl}/api/chapter.save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      root,
      chapterIndex: 1,
      body: editedText,
      baseHash: read1.hash,
    }),
  })
  if (!saveRes.ok) throw new Error(`[smoke] /api/chapter.save failed: HTTP ${saveRes.status}`)
  const saveOutcome = (await saveRes.json()) as ChapterSaveJson
  console.log(`[smoke] step 4: chapter 1 saved, revision=${saveOutcome.revision}, hash=${saveOutcome.hash}`)

  // 5. 再次读取核验
  const readRes2 = await fetch(`${baseUrl}/api/chapter.read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root, chapterIndex: 1 }),
  })
  const read2 = (await readRes2.json()) as ChapterReadJson
  if (read2.body.trim() !== editedText) {
    throw new Error('[smoke] step 5 failed: persisted body does not match edited text')
  }
  console.log(`[smoke] step 5: re-read verified matching saved body exactly`)

  // 6. 导出全本 TXT
  const exportRes = await fetch(`${baseUrl}/api/export.txt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root }),
  })
  if (!exportRes.ok) throw new Error(`[smoke] /api/export.txt failed: HTTP ${exportRes.status}`)
  const exportedText = await exportRes.text()
  if (!exportedText.includes('《发行运行时冒烟书》') || !exportedText.includes(editedText)) {
    throw new Error('[smoke] step 6 failed: exported txt missing title or body')
  }
  console.log(`[smoke] step 6: exported txt verified with size ${exportedText.length} chars`)

  console.log('[smoke] ALL RUNTIME ARCHIVE SMOKE CHECKS PASSED!')
}

main().catch((err) => {
  console.error('[smoke] FATAL ERROR:', err)
  process.exit(1)
})
