#!/usr/bin/env node
/**
 * check-generated-freshness.mjs —— 按**索引**判定生成物（docs/architecture.md、
 * docs/term-map.md）是否与即将提交的内容一致。
 *
 * 为什么不是直接在工作区跑 `gen-*.mjs --check`：工作区可能含**他人未提交的改动**，那会把
 * 别人的在制工作算成「生成物陈旧」，于是只能退化成告警——而告警挡不住「**自己的提交**把生成物
 * 改陈旧」这一类。2026-10-10 的会话里同类漂移出现 4 次（每次都靠 CI 或人工才发现），其中一次
 * 就是提交时加了 1 行注释让 data-plane 的行数变了 1。
 *
 * 本脚本把**索引**（git write-tree 得到的那棵树）导出到临时目录，在其中重跑两个生成器
 * `--check`。索引语义没有上面的问题：它只看即将提交的内容，别人未提交的改动不参与。
 *
 * 退出码：0 一致；1 陈旧（并打印刷新命令）；2 环境错误。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// 转成正斜杠：Windows 反斜杠路径传给 `sh -c` 里的 git/tar 会被 MSYS 解释坏
const rootPosix = root.replace(/\\/g, '/')
const sh = (cmd, cwd) => execFileSync('sh', ['-c', cmd], { cwd, encoding: 'utf8' })

let tmp
try {
  const tree = execFileSync('git', ['-C', root, 'write-tree'], { encoding: 'utf8' }).trim()
  tmp = mkdtempSync(join(tmpdir(), 'mozhou-fresh-'))
  // 把索引那棵树导出到临时目录（不含未提交改动）。tar 解到 cwd，不传 -C——
  // Windows 临时目录路径经 `sh -c` 传给 MSYS tar 的 -C 会被反斜杠转义弄坏。
  sh(`git -C "${rootPosix}" archive ${tree} | tar -x`, tmp)

  const checks = [
    { name: 'docs/architecture.md', cmd: 'node scripts/gen-architecture.mjs --check', fix: 'node scripts/gen-architecture.mjs' },
    { name: 'docs/term-map.md', cmd: 'node scripts/gen-term-map.mjs --check', fix: 'node scripts/gen-term-map.mjs' },
  ]
  const stale = []
  for (const c of checks) {
    try {
      sh(c.cmd, tmp)
    } catch (err) {
      stale.push({ ...c, detail: String(err.stdout ?? '').trim() || String(err.message).split('\n')[0] })
    }
  }

  if (stale.length === 0) {
    console.log('PASS 生成物与索引一致（按即将提交的内容判定）')
    process.exit(0)
  }
  console.error('FAIL 生成物与即将提交的内容不一致（索引语义，与他人未提交改动无关）：')
  for (const s of stale) {
    console.error(`  - ${s.name}：${s.detail}`)
    console.error(`    刷新：${s.fix}`)
  }
  process.exit(1)
} catch (err) {
  console.error('FAIL 生成物新鲜度检查无法执行：' + String(err.message).split('\n')[0])
  process.exit(2)
} finally {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
}
