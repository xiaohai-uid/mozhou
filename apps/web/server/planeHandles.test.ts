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
 * 2. 其余裸 open 必须在**它所在的块**内出现 plane.close()。
 *
 * 【前两版为什么作废】这段是这个守卫的血泪，别再走回头路：
 *   第一版有个过滤器豁免掉 `const plane = `（全仓 22 处生产 open 里占 19 处），
 *   实际只断言了 3 处。**它还「验证」过会对重引入的泄漏报红**——注入的恰好是
 *   过滤器不豁免的那种写法。拿一个守卫本来就在看的形态去证明它有效，等于没证明。
 *   第二版改成「同块内闭合」，靠花括号配对判块尾；它能抓住第一版漏的，
 *   却把 l1-lifecycle-bench.ts:1304 误报了（那里句柄跨块长活，本就关得对）。
 *   为迁就一个假阳性而放松判据，等于把刚堵上的漏报重新打开。
 *
 * 【自检】文件末尾的 meta 用例直接喂合成源码，锁住判据本身。
 * 没有它们，「守卫失灵」和「没有泄漏」在测试结果里长得一模一样——
 * 第一版就是这么悄悄空转的。
 *
 * base 树实际泄漏 6 处：worksRoutes 102/132/147、storyBrainRoutes 143/203、
 * watcher-checkpoint 42（最后一个最隐蔽：开完就丢给 GC，GC 不会关 SQLite）。
 * 另有 16 处本就正确 close 的存量站点，是本守卫的回归网。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')

/** 允许直接持有句柄的模块：生命周期 adapter 自身，以及 LocalDataPlane 类（openOrRebuild 内部委派）。 */
const HANDLE_OWNERS = new Set([
  'packages/data-plane/src/with-plane.ts',
  'packages/data-plane/src/local-data-plane.ts',
])

const SCAN_ROOTS = ['apps/web/server', 'apps/web/src', 'packages']

const OPEN = /LocalDataPlane\.open(OrRebuild)?\(/
const THROW_AWAY = /LocalDataPlane\.open(OrRebuild)?\([^)]*\)\s*\./

/**
 * 去掉字符串字面量与注释，让花括号配对不被 URL 里的 `//` 或模板串里的 `{` 带偏。
 * 顺序要紧：先剥字符串，再剥注释——否则 `'http://x'` 里的 `//` 会被当成行注释。
 */
function stripNoise(line: string): string {
  return line
    .replace(/'[^']*'/g, "")
    .replace(/"[^"]*"/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/\/\/.*$/, '')
    .replace(/\/\*.*?\*\//g, '')
}

const OPEN_ASSIGN = /^\s*(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*LocalDataPlane\.open(OrRebuild)?\(/
const CLOSE_ANY = /\b([A-Za-z_$][\w$]*)\??\.close\(\)/

/**
 * 纯函数：找出「开了不关」的行号。
 *
 * 模型是**栈配平**而非「同块内闭合」：按出现顺序扫，遇到 open 压栈、遇到 close 弹栈，
 * 扫到文件尾栈非空即为泄漏。
 *
 * 为什么不用「同块内闭合」：第二版用过，它把 l1-lifecycle-bench.ts:1304 误报了——
 * 那里 1137 开、1295 关、1304 重开、1355 再关，句柄跨块长活，判据却只看紧邻的块。
 * 为迁就一个假阳性把判据放松，等于把刚堵上的漏报又打开。栈配平既能放行合法长活，
 * 又能抓住「一个分支开、另一个分支才关」这种同块判据抓不到的真实泄漏。
 *
 * 已知抓不到：句柄跨函数传递后关闭（那需要真解析，不是正则能做的）。
 */
function findLeakLines(source: string): number[] {
  const lines = source.split(/\r?\n/)
  const pending: { line: number; name: string }[] = []
  lines.forEach((text, i) => {
    const bare = stripNoise(text)
    if (THROW_AWAY.test(text)) return
    const open = OPEN_ASSIGN.exec(bare)
    if (open !== null) {
      pending.push({ line: i + 1, name: open[1] ?? '' })
      return
    }
    const close = CLOSE_ANY.exec(bare)
    if (close === null) return
    const name = close[1] ?? ''
    let at = -1
    for (let k = pending.length - 1; k >= 0; k -= 1) {
      if (pending[k]?.name === name) { at = k; break }
    }
    if (at !== -1) pending.splice(at, 1)
  })
  return pending.map((p) => p.line)
}

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

function scanOpenSites(): OpenSite[] {
  const sites: OpenSite[] = []
  for (const root of SCAN_ROOTS) {
    const files: string[] = []
    collectTsFiles(join(REPO_ROOT, root), files)
    for (const file of files) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, '/')
      if (rel.includes('.test.') || rel.includes('/tests/') || rel.startsWith('apps/web/src/code-graph/')) continue
      if (HANDLE_OWNERS.has(rel)) continue
      const lines = readFileSync(file, 'utf8').split(/\r?\n/)
      lines.forEach((text, i) => {
        if (!OPEN.test(text)) return
        sites.push({ file: rel, line: i + 1, text })
      })
    }
  }
  return sites
}

describe('判据自检：直接喂合成源码（否则守卫失灵与无泄漏在结果里长得一样）', () => {
  it('报告原文那个形态必须被抓住：const plane 开了不关，块里还嵌套了 if', () => {
    const leak = [
      'export const storyBrainRoutes: RouteHandler = async (req, res, { path }) => {',
      "  if (path === '/api/story-brain/entities') {",
      '    const plane = LocalDataPlane.open(root)',
      '    if (entityIds.length === 0) {',
      '      return true',
      '    }',
      '    json(200, { ok: true, cards: plane.getEntityCards() })',
      '    return true',
      '  }',
      '  return false',
      '}',
    ].join('\n')
    expect(findLeakLines(leak)).toEqual([3])
  })

  it('正确写法不得误报：同块内 close 就放过', () => {
    const clean = [
      "  if (path === '/api/story-brain/entities') {",
      '    const plane = LocalDataPlane.open(root)',
      '    json(200, { ok: true, cards: plane.getEntityCards() })',
      '    plane.close()',
      '    return true',
      '  }',
      '  return false',
    ].join('\n')
    expect(findLeakLines(clean)).toEqual([])
  })

  it('长活句柄必须放行：开→关→重开→再关（第二版在这里误报了 bench）', () => {
    const clean = [
      '  let plane = LocalDataPlane.open(root)',
      '  const before = plane.db',
      '  plane.close()',
      '  plane = LocalDataPlane.open(root)',
      '  json(200, plane.listWorks())',
      '  plane.close()',
    ].join('\n')
    expect(findLeakLines(clean)).toEqual([])
  })

  it('只有一半配平必须报：开两次关一次（分支只开不关的典型形态）', () => {
    const leak = [
      '  if (a) {',
      '    const plane = LocalDataPlane.open(root)',
      '    plane.close()',
      '  } else {',
      '    const plane = LocalDataPlane.open(root)',
      '    json(200, plane.listWorks())',
      '  }',
    ].join('\n')
    expect(findLeakLines(leak)).toEqual([5])
  })

  it('close 在 open 之前不算配平', () => {
    const leak = [
      '  const dead = LocalDataPlane.open(root)',
      '  dead.close()',
      '  const plane = LocalDataPlane.open(root)',
    ].join('\n')
    expect(findLeakLines(leak)).toEqual([3])
  })

  it('别的块里的 close 不算数——这正是首版漏报的那条路', () => {
    const leak = [
      "  if (path === '/api/a') {",
      '    const plane = LocalDataPlane.open(root)',
      '    return true',
      '  }',
      "  if (path === '/api/b') {",
      '    const plane2 = LocalDataPlane.open(root)',
      '    plane2.close()',
      '  }',
    ].join('\n')
    expect(findLeakLines(leak)).toEqual([2])
  })

  it('字符串与注释里的花括号不得带偏配对', () => {
    const clean = [
      "  if (path === '/api/a') {",
      "    const url = 'https://example.com/{x}'",
      '    // 上面那行含 { 与 //',
      '    const plane = LocalDataPlane.open(root)',
      '    json(200, plane.listWorks())',
      '    plane.close()',
      '  }',
    ].join('\n')
    expect(findLeakLines(clean)).toEqual([])
  })
})

describe('生产代码句柄生命周期', () => {
  it('防空洞：扫描器确实找到了相当数量的生产 open 点', () => {
    const sites = scanOpenSites()
    expect(sites.length).toBeGreaterThanOrEqual(15)
    expect(new Set(sites.map((s) => s.file)).size).toBeGreaterThanOrEqual(5)
  })

  it('防空洞：所有 open 点都真的进入了 close 断言（首版豁免掉 19/22，等于空转）', () => {
    const sites = scanOpenSites()
    const inline = sites.filter((s) => THROW_AWAY.test(s.text))
    expect(sites.length - inline.length).toBeGreaterThanOrEqual(15)
  })

  it('禁止「开完就丢」：LocalDataPlane.open(...).xxx(', () => {
    const offenders = scanOpenSites().filter((s) => THROW_AWAY.test(s.text))
    expect(offenders).toEqual([])
  })

  it('每个裸 open 都配到一次 close（否则 SQLite 句柄泄漏）', () => {
    const offenders: string[] = []
    const byFile = new Map<string, string[]>()
    for (const site of scanOpenSites()) {
      if (THROW_AWAY.test(site.text)) continue
      const list = byFile.get(site.file) ?? []
      list.push(site.line + '  ' + site.text.trim())
      byFile.set(site.file, list)
    }
    for (const [file, lines] of byFile) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8')
      for (const line of findLeakLines(source)) {
        offenders.push(file + ':' + line + '  ' + (lines[line - 1] ?? ''))
      }
    }
    expect(offenders).toEqual([])
  })
})

