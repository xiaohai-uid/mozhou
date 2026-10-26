/**
 * apps/web/server/agent · 路径权限、技能存储与文件工具的行为测试。
 *
 * 夹具全部建在系统临时目录，不读写真实书稿。
 * 判定：npx pnpm --filter @mozhou/web exec vitest run server/agent/agent.test.ts
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { decidePathAccess } from './pathPolicy.js'
import { SkillError, SkillStore, parseSkillMarkdown, renderSkillMarkdown } from './skills.js'
import { FileManageTool, FileReadTool, FileWriteTool } from './fileTools.js'
import type { ToolHost } from './toolHost.js'

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeHost(bookRoot: string, extra: Partial<ToolHost> = {}): ToolHost {
  return { bookRoot, skills: new SkillStore({ root: join(bookRoot, '..', 'skills') }), ...extra }
}

describe('路径权限模型', () => {
  const bookRoot = makeTempDir('mozhou-agent-')

  it('书根内为 allowed；书根外为 needs-confirmation', () => {
    expect(decidePathAccess(join(bookRoot, 'ch1.md'), { bookRoot }).access).toBe('allowed')
    expect(decidePathAccess(join(bookRoot, '..', 'outside.md'), { bookRoot }).access).toBe('needs-confirmation')
  })

  it('技能根与书根同为直读区', () => {
    const skillRoot = join(bookRoot, '..', 'skills')
    expect(decidePathAccess(join(skillRoot, 'a', 'SKILL.md'), { bookRoot, skillRoots: [skillRoot] }).access).toBe('allowed')
  })

  it('系统目录与空字节直接拒绝', () => {
    expect(decidePathAccess('C:\\Windows\\System32\\drivers\\etc\\hosts', { bookRoot }).access).toBe('denied')
    expect(decidePathAccess('/etc/passwd', { bookRoot }).access).toBe('denied')
    expect(decidePathAccess(join(bookRoot, 'a\u0000b.md'), { bookRoot }).access).toBe('denied')
  })

  it('Windows 盘符路径在非 Windows 平台直接拒绝（安全性质不随平台漂移）', () => {
    const decision = decidePathAccess('C:\\Users\\someone\\book\\ch1.md', { bookRoot })
    if (process.platform === 'win32') {
      // Windows 上这是绝对路径：不在书根内，交给作者确认。
      expect(decision.access).toBe('needs-confirmation')
    } else {
      // POSIX 上它不是绝对路径；旧实现会把它解析成书根内的怪文件名并放行（allowed），
      // 使「系统目录拒绝」只在 Windows 成立。这里锁死为 denied。
      expect(decision.access).toBe('denied')
    }
  })

  it('无书根时相对路径无法解析 → denied；空路径 → denied', () => {
    expect(decidePathAccess('ch1.md', { bookRoot: null }).access).toBe('denied')
    expect(decidePathAccess('   ', { bookRoot }).access).toBe('denied')
  })
})

describe('技能存储', () => {
  it('frontmatter 往返：解析与渲染互逆，缺 description 显式失败', () => {
    const text = renderSkillMarkdown({ name: '悬念钩子', description: '章末钩子', version: '1.2.0', license: 'MIT', extra: {} }, '正文')
    const parsed = parseSkillMarkdown(text)
    expect(parsed.meta.name).toBe('悬念钩子')
    expect(parsed.meta.version).toBe('1.2.0')
    expect(parsed.body.trim()).toBe('正文')
    expect(() => parseSkillMarkdown('---\nname: x\n---\n正文')).toThrow(SkillError)
    expect(() => parseSkillMarkdown('没有 frontmatter')).toThrow(SkillError)
  })

  it('写入后可读全文；list 只给摘要不给正文（按需加载）', () => {
    const root = makeTempDir('mozhou-skills-')
    const store = new SkillStore({ root })
    store.write({ id: 'hook-suspense', name: '悬念钩子', description: '章末钩子', body: '正文内容' })
    expect(store.read('hook-suspense')?.body).toBe('正文内容')
    const listed = store.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.name).toBe('悬念钩子')
    expect('body' in (listed[0] as object)).toBe(false)
  })

  it('id 非法与资源越界都拒绝', () => {
    const root = makeTempDir('mozhou-skills-bad-')
    const store = new SkillStore({ root })
    expect(() => store.write({ id: 'Bad Id', name: 'x', description: 'y', body: 'z' })).toThrow(SkillError)
    expect(() =>
      store.write({ id: 'ok-skill', name: 'x', description: 'y', body: 'z', resources: { '../escape.md': 'no' } }),
    ).toThrow(SkillError)
    // 合法资源落在 references/ 之下
    const record = store.write({
      id: 'ok-skill-2',
      name: 'x',
      description: 'y',
      body: 'z',
      resources: { 'references/guide.md': '资料' },
    })
    expect(record.resources.references).toBe(1)
    expect(readFileSync(join(root, 'ok-skill-2', 'references', 'guide.md'), 'utf8')).toBe('资料')
  })
})

describe('文件工具', () => {
  it('书根内读取成功；外部路径未确认时失败，确认后成功', async () => {
    const bookRoot = makeTempDir('mozhou-book-')
    writeFileSync(join(bookRoot, 'ch1.md'), '第一章\n第二章\n', 'utf8')
    const outside = makeTempDir('mozhou-outside-')
    writeFileSync(join(outside, 'note.md'), '外部笔记', 'utf8')

    const read = new FileReadTool()
    const inside = await read.execute({ path: join(bookRoot, 'ch1.md') }, makeHost(bookRoot))
    expect(inside.ok).toBe(true)
    expect(inside.content).toContain('第一章')

    const denied = await read.execute({ path: join(outside, 'note.md') }, makeHost(bookRoot))
    expect(denied.ok).toBe(false)
    expect(denied.content).toContain('需要作者确认')

    const confirmed = await read.execute(
      { path: join(outside, 'note.md') },
      makeHost(bookRoot, { confirmExternalPath: () => true }),
    )
    expect(confirmed.ok).toBe(true)
    expect(confirmed.content).toContain('外部笔记')
  })

  it('写入后回读确认；未注入回收站时删除被拒绝', async () => {
    const bookRoot = makeTempDir('mozhou-book-w-')
    const write = new FileWriteTool()
    const written = await write.execute({ path: join(bookRoot, 'draft.md'), content: '正文' }, makeHost(bookRoot))
    expect(written.ok).toBe(true)
    expect(readFileSync(join(bookRoot, 'draft.md'), 'utf8')).toBe('正文')

    const manage = new FileManageTool()
    const noTrash = await manage.execute({ action: 'move_to_trash', path: join(bookRoot, 'draft.md') }, makeHost(bookRoot))
    expect(noTrash.ok).toBe(false)
    expect(noTrash.content).toContain('回收站不可用')

    const withTrash = await manage.execute(
      { action: 'move_to_trash', path: join(bookRoot, 'draft.md') },
      makeHost(bookRoot, { trash: () => ({ id: 'trash-1' }) }),
    )
    expect(withTrash.ok).toBe(true)
    expect(withTrash.meta?.['trashId']).toBe('trash-1')
  })

  it('mkdir 与 copy 在书根内可用', async () => {
    const bookRoot = makeTempDir('mozhou-book-m-')
    mkdirSync(join(bookRoot, 'chapters'), { recursive: true })
    writeFileSync(join(bookRoot, 'chapters', 'a.md'), 'A', 'utf8')
    const manage = new FileManageTool()
    const copied = await manage.execute(
      { action: 'copy', path: join(bookRoot, 'chapters', 'a.md'), to: join(bookRoot, 'chapters', 'b.md') },
      makeHost(bookRoot),
    )
    expect(copied.ok).toBe(true)
    expect(readFileSync(join(bookRoot, 'chapters', 'b.md'), 'utf8')).toBe('A')
  })
})
