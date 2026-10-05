/**
 * W7-2 性能基线测算脚本（50 章大书隔离夹具、10KB 保存 p95、事件循环延迟、冷热启动）。
 *
 * 依据：docs/plans/2026-10-03-gitnexus-plan-mozhou-architecture-release.md §8 预算：
 * - 10KB 正文保存端到端延迟：p95 <= 300ms；
 * - 事件循环延迟 (Event Loop Lag)：p95 <= 50ms；
 * - 真实记录冷启动与热启动数据，如实记录，绝不制造虚假通过。
 */
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'
import { createBook, LocalDataPlane } from '../packages/data-plane/dist/index.js'
import { apiMiddleware } from '../apps/web/dist-server/api.js'

function generateChapterParagraph(ch, p) {
  return `第${ch}章第${p}段：夜幕深沉，窗外雨声如织。桌上的墨舟终端指示灯幽微闪烁，屏幕上正文光标稳定跳动。这是第五十卷故事中关键的一折，所有草稿、事实凭证与修订记录在此交汇成河。作者停下键击，审视着最新生成的行段，心中盘算着下一幕起承转合的节奏与意图。`.repeat(3) + '\n\n'
}

function generate10KbBody() {
  const baseBlock = '在十一步事务管线的稳健护航下，墨舟本地架构实现了版本严格可控与数据零丢失保护。'
  let out = ''
  while (Buffer.byteLength(out, 'utf8') < 10240) {
    out += baseBlock + '当前正文已达标定长度，正处于受控事务隔离校验中。\n'
  }
  return out
}

async function listenServer(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolve(`http://127.0.0.1:${addr.port}`)
    })
  })
}

async function post(base, path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return { status: res.status, data }
}

function percentile(arr, p) {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1)
  return sorted[idx]
}

async function main() {
  console.log('=== [W7-2 性能测算] 开始 50 章隔离大书夹具生成与基线测算 ===')

  // 1. 冷启动测算
  const coldStartBegin = performance.now()
  const coldServer = createServer((req, res) => apiMiddleware()(req, res, () => { res.statusCode = 404; res.end() }))
  const coldUrl = await listenServer(coldServer)
  const coldHealthRes = await fetch(`${coldUrl}/api/health`)
  const coldStartMs = performance.now() - coldStartBegin
  coldServer.close()
  console.log(`[启动测算] 冷启动就绪延迟: ${coldStartMs.toFixed(2)} ms (HTTP ${coldHealthRes.status})`)

  // 2. 热启动测算
  const hotStartBegin = performance.now()
  const server = createServer((req, res) => apiMiddleware()(req, res, () => { res.statusCode = 404; res.end() }))
  const baseUrl = await listenServer(server)
  const hotHealthRes = await fetch(`${baseUrl}/api/health`)
  const hotStartMs = performance.now() - hotStartBegin
  console.log(`[启动测算] 热启动就绪延迟: ${hotStartMs.toFixed(2)} ms (HTTP ${hotHealthRes.status})`)

  // 3. 构建 50 章大书隔离夹具
  const tempDir = mkdtempSync(join(tmpdir(), 'mozhou-perf-50ch-'))
  const bookRoot = join(tempDir, 'perf-book')
  mkdirSync(bookRoot, { recursive: true })
  console.log(`[夹具构建] 隔离书稿目录: ${bookRoot}`)

  const fixtureStart = performance.now()
  createBook({ dir: bookRoot, title: '50章性能基准测算书' })
  const plane = LocalDataPlane.open(bookRoot)

  let totalChars = 0
  for (let ch = 1; ch <= 50; ch++) {
    plane.createChapterDraft({ chapterIndex: ch, title: `第${ch}章 风雨交加之夜` })
    let chapterBody = ''
    for (let p = 1; p <= 12; p++) {
      chapterBody += generateChapterParagraph(ch, p)
    }
    plane.saveProseDraft({ chapterIndex: ch, body: chapterBody, expectedRevision: 0 })
    totalChars += chapterBody.length
  }
  plane.close()
  const fixtureElapsed = performance.now() - fixtureStart
  console.log(`[夹具构建] 50 章生成完毕：累计 ${totalChars} 字，耗时 ${fixtureElapsed.toFixed(2)} ms`)

  // 4. 事件循环延迟监控
  const eld = monitorEventLoopDelay({ resolution: 20 })
  eld.enable()

  // 5. 10KB 保存端到端延迟测算 (40 轮)
  const rounds = 40
  const latencies = []
  const targetChapter = 25
  let currentRev = 1
  const body10K = generate10KbBody()
  console.log(`[延迟测算] 启动 10KB 正文保存测算 (共 ${rounds} 轮，针对第 ${targetChapter} 章)... `)

  for (let i = 1; i <= rounds; i++) {
    const opId = `op_perf_save_${i}_${randomUUID().slice(0, 8)}`
    const t0 = performance.now()
    const res = await post(baseUrl, '/api/chapter.prose.save', {
      root: bookRoot,
      chapterIndex: targetChapter,
      expectedRevision: currentRev,
      body: body10K + `\n// Round ${i} - ${new Date().toISOString()}`,
      operationId: opId,
      schemaVersion: 1,
    })
    const dt = performance.now() - t0
    if (res.status !== 200 || res.data.ok !== true) {
      throw new Error(`Round ${i} failed with HTTP ${res.status}: ${JSON.stringify(res.data)}`)
    }
    currentRev = res.data.revision
    latencies.push(dt)
  }

  eld.disable()
  server.close()

  const p50 = percentile(latencies, 50)
  const p90 = percentile(latencies, 90)
  const p95 = percentile(latencies, 95)
  const max = Math.max(...latencies)
  const min = Math.min(...latencies)
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length
  const lagP95Ms = eld.percentile(95) / 1e6
  const lagMaxMs = eld.max / 1e6

  console.log(`[测算结果] 10KB 保存: min=${min.toFixed(1)}ms, avg=${avg.toFixed(1)}ms, p50=${p50.toFixed(1)}ms, p90=${p90.toFixed(1)}ms, p95=${p95.toFixed(1)}ms, max=${max.toFixed(1)}ms`)
  console.log(`[测算结果] 事件循环延迟: p95=${lagP95Ms.toFixed(2)}ms, max=${lagMaxMs.toFixed(2)}ms`)

  // 6. 清理夹具目录
  try {
    rmSync(tempDir, { recursive: true, force: true })
    console.log(`[夹具回收] 临时测试书稿已彻底清理完毕`)
  } catch (err) {
    console.warn('Cleanup warning:', err)
  }

  // 7. 写入报告 evidence/w7-release/perf-measurement.txt
  const budgetPassSave = p95 <= 300
  const budgetPassLag = lagP95Ms <= 50

  const reportText = `================================================================================
墨舟 NOVEL OS - W7 性能基线测算报告 (50 章大书隔离夹具)
测算时间: ${new Date().toISOString()}
Node 版本: ${process.version}
操作系统: ${process.platform} ${process.arch}
================================================================================

1. 50 章隔离大书夹具规格
--------------------------------------------------------------------------------
- 章节总数: 50 章
- 全书总字数: ${totalChars} 字符 (约 20-30 万字真实规模)
- 夹具构建耗时: ${fixtureElapsed.toFixed(2)} ms
- 隔离目录形态: 操作系统临时目录 (测算后全量销毁，零污染)

2. 10KB 正文保存端到端延迟测算 (POST /api/chapter.prose.save, 共 ${rounds} 轮)
--------------------------------------------------------------------------------
- 采样轮数: ${rounds} 次 (包含 CAS expectedRevision + W3 operationId 结果记录落盘)
- 最小延迟 (Min): ${min.toFixed(2)} ms
- 平均延迟 (Avg): ${avg.toFixed(2)} ms
- 50 分位 (p50): ${p50.toFixed(2)} ms
- 90 分位 (p90): ${p90.toFixed(2)} ms
- 95 分位 (p95): ${p95.toFixed(2)} ms  [预算目标: <= 300.00 ms] -> ${budgetPassSave ? '【PASS 达成】' : '【FAIL 超预算】'}
- 最大延迟 (Max): ${max.toFixed(2)} ms

3. 事件循环延迟监控 (perf_hooks.monitorEventLoopDelay)
--------------------------------------------------------------------------------
- 采样粒度: 20 ms
- 事件循环延迟 p95: ${lagP95Ms.toFixed(2)} ms  [预算目标: <= 50.00 ms] -> ${budgetPassLag ? '【PASS 达成】' : '【FAIL 超预算】'}
- 事件循环延迟 Max: ${lagMaxMs.toFixed(2)} ms

4. 服务进程启动延迟测算
--------------------------------------------------------------------------------
- 冷启动延迟 (首次加载路由/模块与探测 /api/health): ${coldStartMs.toFixed(2)} ms
- 热启动延迟 (二次就绪 /api/health): ${hotStartMs.toFixed(2)} ms

5. 综合预算判定结论
--------------------------------------------------------------------------------
- 10KB 保存 p95 (<= 300ms): ${budgetPassSave ? 'PASS (' + p95.toFixed(2) + 'ms)' : 'FAIL (' + p95.toFixed(2) + 'ms)'}
- 事件循环 p95 (<= 50ms): ${budgetPassLag ? 'PASS (' + lagP95Ms.toFixed(2) + 'ms)' : 'FAIL (' + lagP95Ms.toFixed(2) + 'ms)'}
- 总体判定: ${budgetPassSave && budgetPassLag ? '全部达标 (METRICS_PASSED)' : '存在超预算项 (METRICS_ALERT)'}
================================================================================
`

  const outPath = 'evidence/w7-release/perf-measurement.txt'
  mkdirSync('evidence/w7-release', { recursive: true })
  writeFileSync(outPath, reportText, 'utf8')
  console.log(`[报告输出] 性能测算原始记录已保存至 ${outPath}`)
}

main().catch((err) => {
  console.error('Performance measurement failed:', err)
  process.exit(1)
})
