import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { detectEntityMentions } from '@mozhou/kernel'
import type { EntityRef } from '@mozhou/kernel'
import { createBook } from './create-book.js'
import { LocalDataPlane, rebuildProjectionFromCanon, type BaselineReport } from './local-data-plane.js'
import { openDatabase, PROJECTION_SCHEMA_VERSION, readProjectionVersion } from './database.js'
import {
  CardPreWriteMismatchError,
  createEntityCard,
  deleteEntityCard,
  DuplicateEntityRefError,
  EntityCardNotFoundError,
  EntityCardValidationError,
  entityCardFileRel,
  updateEntityCard,
  type EntityCardWriteContext,
} from './entity-cards.js'
import { RUNTIME_DB_PATH } from './layout.js'

const tmpRoots: string[] = []
const openDbs: Database.Database[] = []
let bookRoot = ''

beforeEach(() => {
  bookRoot = join(tmpdir(), `mozhou-t2-${process.pid}-${Math.random().toString(36).slice(2)}`)
  tmpRoots.push(bookRoot)
  mkdirSync(bookRoot, { recursive: true })
  createBook({ dir: bookRoot, title: '墨舟试炼' })
})

afterEach(() => {
  for (const db of openDbs.splice(0)) {
    if (db.open) {
      db.close()
    }
  }
})

afterAll(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function makeCtx(): EntityCardWriteContext {
  const db = openDatabase({ path: join(bookRoot, RUNTIME_DB_PATH) })
  openDbs.push(db)
  return { root: bookRoot, db, manifest: structuredClone(readManifestSnapshot()) }
}

function readManifestSnapshot(): EntityCardWriteContext['manifest'] {
  return JSON.parse(readFileSync(join(bookRoot, '.mozhou/manifest.json'), 'utf8')) as EntityCardWriteContext['manifest']
}

/** 投影内容指纹：全部用户表按 rowid 序 dump 后哈希——重建前后必须逐字节一致。 */
function fingerprint(db: Database.Database): string {
  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {
      name: string
    }[]
  ).map((row) => row.name)
  const dump = tables.map((table) => JSON.stringify(db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()))
  return createHash('sha256').update(dump.join('\n')).digest('hex')
}

function baseline(): BaselineReport {
  const plane = LocalDataPlane.open(bookRoot)
  try {
    return plane.verifyBaseline()
  } finally {
    plane.close()
  }
}

function cardRows(): { ref: string; card_type: string; ai_context: string; brief: string | null }[] {
  const ctx = makeCtx()
  try {
    return ctx.db.prepare('SELECT ref, card_type, ai_context, brief FROM entity_cards ORDER BY ref').all() as {
      ref: string
      card_type: string
      ai_context: string
      brief: string | null
    }[]
  } finally {
    ctx.db.close()
  }
}

const LIN_WAN = {
  name: '林晚',
  aliases: [{ text: '晚姐', kind: 'exact' as const }],
  brief: '云澜宗内门大师姐，剑修。',
}

describe('T2 演示：建角色卡带中文别名「晚姐」并被检测器命中', () => {
  it('canon 文件可 grep、投影同步、检测器经别名命中', () => {
    const ctx = makeCtx()
    const card = createEntityCard(ctx, 'char:lin-wan', LIN_WAN)

    // canon 真源：文件就位、ref 与中文别名裸文可 grep（spec §3 形态）
    const fileRel = entityCardFileRel('char:lin-wan')
    expect(fileRel).toBe('设定/人物/lin-wan.md')
    const raw = readFileSync(join(bookRoot, fileRel), 'utf8')
    expect(raw).toContain('ref: char:lin-wan')
    expect(raw).toContain('name: 林晚')
    expect(raw).toContain('- {text: 林晚, kind: exact}')
    expect(raw).toContain('- {text: 晚姐, kind: exact}')

    // 建卡时 name 自动入 aliases 首位（Q11）
    expect(card.aliases[0]).toEqual({ text: '林晚', kind: 'exact' })

    // write-through：投影行即时可查（S1）
    expect(cardRows()).toEqual([
      { ref: 'char:lin-wan', card_type: 'char', ai_context: 'detected', brief: '云澜宗内门大师姐，剑修。' },
    ])
    const aliases = ctx.db
      .prepare('SELECT ord, text, kind, case_sensitive FROM entity_alias_rules WHERE ref = ? ORDER BY ord')
      .all('char:lin-wan') as { ord: number; text: string; kind: string; case_sensitive: number }[]
    expect(aliases.map((row) => row.text)).toEqual(['林晚', '晚姐'])

    // 检测器命中（entity-directory-spec Q3 冻结语义）
    const hits = detectEntityMentions([card], '夜色里，晚姐把伞递给了林晚。')
    expect(hits).toEqual([{ ref: 'char:lin-wan', matchedText: '林晚', aliasIndex: 0, kind: 'exact' }])

    // 基线自洽：应用自己的写入已登记，无漂移
    expect(baseline().modified).toEqual([])
    expect(baseline().untracked).toEqual([])
  })

  it('外部手写形态（>- 块标量 brief + flow 排除词表）被扫描吸收并可重建', () => {
    writeFileSync(
      join(bookRoot, '设定/人物/lin-feng.md'),
      [
        '---',
        'ref: char:lin-feng',
        'name: 林枫',
        'aliases:',
        '- {text: 枫儿, kind: exact}',
        '- {text: 林(小)?枫, kind: regex}',
        'excludedPhrases: [枫叶林]',
        'brief: >-',
        '  青云宗外门弟子，',
        '  身怀雷灵根……',
        'tags: [主角]',
        '---',
        '# 林枫\n\n人读自由内容。\n',
      ].join('\n'),
    )

    rebuildProjectionFromCanon(bookRoot) // S5 全量吸收：坏形宁抛，好形入投影

    expect(cardRows()).toEqual([
      { ref: 'char:lin-feng', card_type: 'char', ai_context: 'detected', brief: '青云宗外门弟子， 身怀雷灵根……' },
    ])

    const ctx = makeCtx()
    const cards = ctx.db
      .prepare('SELECT ref, name, ai_context, brief, file_rel FROM entity_cards WHERE ref = ?')
      .all('char:lin-feng') as { ref: string; name: string; ai_context: string; brief: string; file_rel: string }[]
    expect(cards).toEqual([
      {
        ref: 'char:lin-feng',
        name: '林枫',
        ai_context: 'detected',
        brief: '青云宗外门弟子， 身怀雷灵根……',
        file_rel: '设定/人物/lin-feng.md',
      },
    ])

    // 重建后基线重立 → 无 untracked；tags 只留 canon 不入投影（D4）
    expect(baseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
  })
})

describe('实体卡 CRUD 走 canon 真源 + 投影同步', () => {
  it('duplicate ref rejected; slug collision is per-type-dir (文件名只是皮)', () => {
    const ctx = makeCtx()
    createEntityCard(ctx, 'item:qingyun-jian', { name: '青云剑' })
    expect(() => createEntityCard(ctx, 'item:qingyun-jian', { name: '青云剑' })).toThrow(DuplicateEntityRefError)

    // 孤儿文件占用同型目录的文件名 ⇒ 同样按重复身份拒绝（不静默覆盖）
    writeFileSync(join(bookRoot, '设定/物品/orphan.md'), '---\nref: item:x\nname: x\n---\n')
    expect(() => createEntityCard(ctx, 'item:orphan', { name: '占位' })).toThrow(DuplicateEntityRefError)
    // 不同型目录同名 slug 合法：目录即命名空间
    expect(() => createEntityCard(ctx, 'concept:orphan', { name: '孤儿概念' })).not.toThrow()
  })

  it('invalid inputs rejected loudly', () => {
    const ctx = makeCtx()
    expect(() => createEntityCard(ctx, 'char:有/斜杠', { name: 'x' })).toThrow(EntityCardValidationError)
    expect(() => createEntityCard(ctx, 'char:ok', { name: '' })).toThrow(EntityCardValidationError)
    expect(() => createEntityCard(ctx, 'char:ok', { name: 'x', aiContext: 'sometimes' as never })).toThrow(
      EntityCardValidationError,
    )
    expect(() =>
      createEntityCard(ctx, 'char:ok', { name: 'x', aliases: [{ text: '(', kind: 'regex' }] }),
    ).toThrow(EntityCardValidationError)
    // ref 一经引用即冻结（D2）：更新面根本没有改 ref 的入口——按 ref 寻址即身份
    expect(() => updateEntityCard(ctx, 'char:none', { name: 'x' })).toThrow(EntityCardNotFoundError)
  })

  it('update merges patches, migrates aliases on rename and keeps bytes deterministic', () => {
    const ctx = makeCtx()
    createEntityCard(ctx, 'char:lin-wan', LIN_WAN)
    const fileRel = entityCardFileRel('char:lin-wan')

    const updated = updateEntityCard(ctx, 'char:lin-wan', {
      name: '晚娘',
      aiContext: 'always',
      brief: null,
      excludedPhrases: ['晚娘词牌'],
    })

    expect(updated.name).toBe('晚娘')
    expect(updated.aiContext).toBe('always')
    expect(updated.brief).toBeNull()
    // 改名迁移（§4.2）：新名确保在检测表首位，旧显示名追加为 exact 别名
    expect(updated.aliases.map((alias) => alias.text)).toEqual(['晚娘', '晚姐', '林晚'])

    const rows = cardRows()
    expect(rows).toEqual([{ ref: 'char:lin-wan', card_type: 'char', ai_context: 'always', brief: null }])

    // 同状态重复渲染逐字节一致（parse→emit 幂等）：无操作更新不改文件字节
    const before = readFileSync(join(bookRoot, fileRel), 'utf8')
    updateEntityCard(ctx, 'char:lin-wan', {})
    expect(readFileSync(join(bookRoot, fileRel), 'utf8')).toBe(before)
    expect(baseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
  })

  it('delete removes canon file, projection rows and manifest entry together', () => {
    const ctx = makeCtx()
    createEntityCard(ctx, 'location:tian-yan', { name: '天衍城', excludedPhrases: ['天衍诀'] })
    const fileRel = entityCardFileRel('location:tian-yan')

    deleteEntityCard(ctx, 'location:tian-yan')

    expect(statSyncSafe(join(bookRoot, fileRel))).toBe(false)
    expect(cardRows()).toEqual([])
    expect(baseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
    expect(() => deleteEntityCard(ctx, 'location:tian-yan')).toThrow(EntityCardNotFoundError)
  })

  function statSyncSafe(path: string): boolean {
    try {
      return statSync(path).isFile()
    } catch {
      return false
    }
  }

  it('S3 写前校验：盘上 ≠ 基线时改/删一律挂起', () => {
    const ctx = makeCtx()
    createEntityCard(ctx, 'char:lin-wan', LIN_WAN)
    appendJunk()

    expect(() => updateEntityCard(ctx, 'char:lin-wan', { name: '晚娘' })).toThrow(CardPreWriteMismatchError)
    expect(() => deleteEntityCard(ctx, 'char:lin-wan')).toThrow(CardPreWriteMismatchError)
    // 挂起 ≠ 回滚：文件保持外部改后的样子（对账取舍归 T5）
    expect(readFileSync(join(bookRoot, entityCardFileRel('char:lin-wan')), 'utf8')).toContain('<!-- 外部改动 -->')

    function appendJunk(): void {
      writeFileSync(
        join(bookRoot, entityCardFileRel('char:lin-wan')),
        `${readFileSync(join(bookRoot, entityCardFileRel('char:lin-wan')), 'utf8')}<!-- 外部改动 -->\n`,
      )
    }
  })
})

describe('Research 区硬隔离（#14 US17 / D6）', () => {
  it('市场/ 下的 ref 形态资料永不成为目录卡或候选，只作 untracked 对账信号', () => {
    const ctx = makeCtx()
    createEntityCard(ctx, 'char:lin-wan', LIN_WAN)

    const researchDir = join(bookRoot, '市场/benchmarks')
    mkdirSync(researchDir, { recursive: true })
    writeFileSync(
      join(researchDir, '晚姐设定参考.md'),
      ['---', 'ref: char:wan-jie-ref', 'name: 晚姐(参考资料)', 'aliases:', '- {text: 晚姐, kind: exact}', '---', '研究用资料'].join('\n'),
    )

    // 扫描面只认 设定/<五目>/ —— Research 文件不产卡、不入投影
    const ctx2 = makeCtx()
    const cards = ctx2.db.prepare('SELECT ref FROM entity_cards ORDER BY ref').all() as { ref: string }[]
    expect(cards.map((row) => row.ref)).toEqual(['char:lin-wan'])
    // 即便文本相同，候选只能来自真卡：晚姐命中归属 lin-wan 而非 research 条目
    const hits = detectEntityMentions(
      cards.map((row) => ({ ref: row.ref as EntityRef, aliases: [{ text: '晚姐', kind: 'exact' as const }] })),
      '晚姐登场',
    )
    expect(hits.map((hit) => hit.ref)).toEqual(['char:lin-wan'])

    const report = baseline()
    expect(report.untracked).toContain('市场/benchmarks/晚姐设定参考.md')
  })
})

describe('投影 v2：版本守卫与重建幂等（含目录卡）', () => {
  it('user_version=2；删库后两次重建指纹与基线逐字节复原', () => {
    const ctx = makeCtx()
    createEntityCard(ctx, 'char:lin-wan', LIN_WAN)
    createEntityCard(ctx, 'faction:yun-lan', { name: '云澜宗', aiContext: 'never' })
    const dbPath = join(bookRoot, RUNTIME_DB_PATH)

    const opened = openDatabase({ path: dbPath })
    expect(readProjectionVersion(opened)).toBe(PROJECTION_SCHEMA_VERSION)
    const fingerprintBefore = fingerprint(opened)
    opened.close()

    const manifestBefore = readFileSync(join(bookRoot, '.mozhou/manifest.json'))

    for (let round = 0; round < 2; round++) {
      for (const suffix of ['', '-wal', '-shm']) {
        rmSync(`${dbPath}${suffix}`, { force: true })
      }
      rebuildProjectionFromCanon(bookRoot)



      expect(readFileSync(join(bookRoot, '.mozhou/manifest.json'))).toEqual(manifestBefore)
      const reopened = openDatabase({ path: dbPath })
      expect(fingerprint(reopened)).toBe(fingerprintBefore)
      reopened.close()
    }
  })

  it('CRUD 后的投影与从 canon 全量重建的投影行形一致', () => {
    const ctx = makeCtx()
    createEntityCard(ctx, 'char:lin-wan', LIN_WAN)
    updateEntityCard(ctx, 'char:lin-wan', { aiContext: 'detectedOff' })

    const throughFingerprint = fingerprint(ctx.db)

    const rebuiltDbPath = join(tmpdir(), `mozhou-t2-rebuild-${process.pid}`)
    rmSync(rebuiltDbPath, { recursive: true, force: true })
    cpBook(bookRoot, rebuiltDbPath)
    rebuildProjectionFromCanon(rebuiltDbPath)
    const rebuilt = openDatabase({ path: join(rebuiltDbPath, RUNTIME_DB_PATH) })
    try {
      expect(fingerprint(rebuilt)).toBe(throughFingerprint)
    } finally {
      rebuilt.close()
    }
    rmSync(rebuiltDbPath, { recursive: true, force: true })
  })

  function cpBook(from: string, to: string): void {
    mkdirSync(to, { recursive: true })
    // 运行时区目录本体保留（投影落点），内容弃置——重建从 canon 出发
    mkdirSync(join(to, '.mozhou'), { recursive: true })
    const walk = (rel: string): void => {
      for (const name of readdirSync(join(from, rel))) {
        if ((rel === '' && name === '.mozhou')) {
          continue
        }
        const child = `${rel}/${name}`
        if (statSync(join(from, child)).isDirectory()) {
          mkdirSync(join(to, child), { recursive: true })
          walk(child)
        } else {
          writeFileSync(join(to, child), readFileSync(join(from, child)))
        }
      }
    }
    walk('')
  }
})
