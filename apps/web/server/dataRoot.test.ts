/**
 * 数据根解析契约：`MOZHOU_DATA_ROOT` 必须被真正读取。
 *
 * 回归防护：此前两个仓储类各自硬编码 `resolve(process.cwd(), '.mozhou_data')`，
 * 而 `docker-compose.yml` 与 `deploy/README.md` 都按该环境变量约定配置数据卷——
 * 变量无人读取时容器内数据落在镜像层，`docker compose down` 或换镜像即销毁全部
 * 书稿，且不报任何错。故此处断言的是「变量生效」，而非仅「函数返回一个路径」。
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { AccountStore } from './account/store.js'
import { BookAccessManager } from './bookAccess.js'
import { DEFAULT_DATA_ROOT_DIRNAME, dataRootSource, resolveDefaultDataRoot } from './dataRoot.js'

const ORIGINAL = process.env['MOZHOU_DATA_ROOT']
const tempRoots: string[] = []

function freshTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), `mozhou-dataroot-${process.pid}-`))
  tempRoots.push(root)
  return root
}

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env['MOZHOU_DATA_ROOT']
  } else {
    process.env['MOZHOU_DATA_ROOT'] = ORIGINAL
  }
})

afterAll(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('resolveDefaultDataRoot · 环境变量覆盖', () => {
  it('未设置时回落到 <cwd>/.mozhou_data（源码直跑路径）', () => {
    delete process.env['MOZHOU_DATA_ROOT']

    expect(resolveDefaultDataRoot()).toBe(resolve(process.cwd(), DEFAULT_DATA_ROOT_DIRNAME))
  })

  it('绝对路径按原样采用（容器挂载卷场景）', () => {
    process.env['MOZHOU_DATA_ROOT'] = '/data'

    expect(resolveDefaultDataRoot()).toBe(resolve('/data'))
  })

  it('相对路径相对 cwd 解析', () => {
    process.env['MOZHOU_DATA_ROOT'] = 'var/mozhou_data'

    expect(resolveDefaultDataRoot()).toBe(resolve(process.cwd(), 'var/mozhou_data'))
  })

  it('空串与纯空白视为未设置，而不是解析成 cwd', () => {
    process.env['MOZHOU_DATA_ROOT'] = ''
    expect(resolveDefaultDataRoot()).toBe(resolve(process.cwd(), DEFAULT_DATA_ROOT_DIRNAME))

    process.env['MOZHOU_DATA_ROOT'] = '   '
    expect(resolveDefaultDataRoot()).toBe(resolve(process.cwd(), DEFAULT_DATA_ROOT_DIRNAME))
  })
})

describe('dataRootSource · 部署是否被显式钉到卷上', () => {
  it('配置了环境变量报 env', () => {
    process.env['MOZHOU_DATA_ROOT'] = '/data'

    expect(dataRootSource()).toBe('env')
  })

  it('未配置或仅空白报 default —— 容器里出现该值即说明卷没接上', () => {
    delete process.env['MOZHOU_DATA_ROOT']
    expect(dataRootSource()).toBe('default')

    process.env['MOZHOU_DATA_ROOT'] = '   '
    expect(dataRootSource()).toBe('default')
  })
})

describe('仓储类默认数据根 · 构造时读取环境变量', () => {
  it('BookAccessManager 构造时采用 MOZHOU_DATA_ROOT', () => {
    const root = freshTempRoot()
    process.env['MOZHOU_DATA_ROOT'] = root

    expect(new BookAccessManager().getDataRoot()).toBe(resolve(root))
  })

  it('AccountStore 把 profile 真正落进 MOZHOU_DATA_ROOT 指向的目录', () => {
    const root = freshTempRoot()
    process.env['MOZHOU_DATA_ROOT'] = root

    new AccountStore().saveProfile({
      id: 'u_env_probe',
      email: 'probe@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      plan: 'free',
      bookIds: [],
    })

    expect(existsSync(join(root, 'users', 'u_env_probe', 'profile.json'))).toBe(true)
  })
})
