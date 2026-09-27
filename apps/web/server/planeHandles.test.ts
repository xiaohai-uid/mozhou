// @vitest-environment node
/**
 * LocalDataPlane 句柄生命周期守卫。
 *
 * 这类缺陷的特征是**不报错、不崩、测试照样全绿**：忘记 close 的 SQLite 句柄
 * 只是让进程句柄单调增长，只有在长时间运行 / 高频路由下才显形。因此不能靠
 * 运行时断言，只能把不变式写成源码级守卫。
 *
 * 守卫规则：
 * 1. 禁止 `LocalDataPlane.open(...).xxx(` 这种「开完就丢」的写法——
 *    对象立刻被 GC，GC 绝不会关 SQLite。
 * 2. 其余裸 open 必须在**同一个处理块**内出现 plane.close()。
 *    （本文件曾有 5 处漏网：/api/works ×2、/api/change-matrix、/api/change-matrix.rerun、
 *      /api/story-brain.entities、/api/story-brain.facts。其中 /api/works 是
 *      移动端每次打开章节目录都打的热路径。）
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')

/** 允许直接持有句柄的模块：adapter 自身，以及 LocalDataPlane 类（openOrRebuild 内部委派）。 */
const HANDLE_OWNERS = new Set([
  'packages/data-plane/src/with-plane.ts',
  'packages/data-plane/src/local-data-plane.ts',
])

const SCAN_ROOTS = ['apps/web/server', 'apps/web/src', 'packages']

function collectTsFiles(dir: string, acc: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectTsFiles(full, acc)
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      if (entry.name.endsWith('.d.ts')) continue
      acc.push(full)
    }
  }
}

interface OpenSite {
  readonly file: string
  readonly line: number
  readonly text: string
}

/** 开始一个新处理块的行界：路由分派分支或顶层函数声明。 */
const BLOCK_BOUNDARY = /^(?:  if \(path === |(?:export )?(?:async )?function )/

function scanOpenSites(): OpenSite[] {
  const sites: OpenSite[] = []
  for (const root of SCAN_ROOTS) {
    const files: string[] = []
    collectTsFiles(join(REPO_ROOT, root), files)
    for (const file of files) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, '/')
      if (rel.includes('.test.') || rel.includes('/tests/') || rel.startsWith('apps/web/src/code-graph/')) continue
      const lines = readFileSync(file, 'utf8').split(/\r?\n/)
      lines.forEach((text, i) => {
        if (HANDLE_OWNERS.has(rel)) return
        if (!/LocalDataPlane\.open(OrRebuild)?\(/.test(text)) return
        sites.push({ file: rel, line: i + 1, text })
      })
    }
  }
  return sites
}

/** 该 open 所在处理块内是否出现了 plane.close()。 */
function closesInSameBlock(rel: string, lineNumber: number): boolean {
  const lines = readFileSync(join(REPO_ROOT, rel), 'utf8').split(/\r?\n/)
  for (let i = lineNumber; i < lines.length; i += 1) {
    const text = lines[i] ?? ''
    if (i > lineNumber - 1 && BLOCK_BOUNDARY.test(text)) return false
    if (/\bplane\??\.close\(\)/.test(text)) return true
  }
  return false
}

describe('LocalDataPlane 句柄生命周期守卫', () => {
  it('防空洞：扫描器确实找到了相当数量的生产 open 点', () => {
    const sites = scanOpenSites()
    expect(sites.length).toBeGreaterThanOrEqual(15)
    expect(new Set(sites.map((s) => s.file)).size).toBeGreaterThanOrEqual(5)
  })

  it('禁止「开完就丢」：LocalDataPlane.open(...).xxx(', () => {
    const offenders = scanOpenSites().filter((s) => /LocalDataPlane\.open(OrRebuild)?\([^)]*\)\s*\./.test(s.text))
    expect(offenders).toEqual([])
  })

  it('每个裸 open 都在同一处理块内 close（否则 SQLite 句柄泄漏）', () => {
    const offenders = scanOpenSites()
      .filter((s) => !/^\s*const plane = /.test(s.text))
      .filter((s) => !closesInSameBlock(s.file, s.line))
      .map((s) => s.file + ':' + s.line + '  ' + s.text.trim())
    expect(offenders).toEqual([])
  })
})
