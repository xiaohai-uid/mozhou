/**
 * apps/web/server/agent · 工具注册表单元测试。
 * 覆盖：默认工具注册、开关过滤、toDefinition 下发、按名分发与未知/未启用报错。
 */
import { describe, expect, it } from 'vitest'
import { ToolRegistry, createDefaultToolRegistry } from './registry.js'
import { NovelTool } from './toolHost.js'
import type { ToolHost, ToolJsonSchema, ToolResult } from './toolHost.js'

class DummyTool extends NovelTool {
  readonly name = 'dummy'
  readonly description = '测试工具'
  readonly parameters: ToolJsonSchema = { type: 'object', properties: {} }

  execute(): Promise<ToolResult> {
    return Promise.resolve({ ok: true, content: 'dummy executed' })
  }
}

describe('ToolRegistry (工具注册表)', () => {
  it('支持注册、开关与按状态查询', () => {
    const reg = new ToolRegistry()
    const tool = new DummyTool()
    reg.register(tool, true)

    expect(reg.has('dummy')).toBe(true)
    expect(reg.isEnabled('dummy')).toBe(true)

    reg.disable('dummy')
    expect(reg.isEnabled('dummy')).toBe(false)

    reg.enable('dummy')
    expect(reg.isEnabled('dummy')).toBe(true)
  })

  it('listDefinitions 仅下发已启用的工具定义', () => {
    const reg = new ToolRegistry()
    reg.register(new DummyTool(), false)
    expect(reg.listDefinitions()).toHaveLength(0)

    reg.enable('dummy')
    const defs = reg.listDefinitions()
    expect(defs).toHaveLength(1)
    expect(defs[0]?.name).toBe('dummy')
  })

  it('dispatch 分发未知工具返回明确失败', async () => {
    const reg = new ToolRegistry()
    const res = await reg.dispatch('non_existent', {}, {} as ToolHost)
    expect(res.ok).toBe(false)
    expect(res.content).toContain('未知工具')
  })

  it('dispatch 分发未启用工具返回明确失败', async () => {
    const reg = new ToolRegistry()
    reg.register(new DummyTool(), false)
    const res = await reg.dispatch('dummy', {}, {} as ToolHost)
    expect(res.ok).toBe(false)
    expect(res.content).toContain('工具未启用')
  })

  it('dispatch 分发已启用工具正常执行', async () => {
    const reg = new ToolRegistry()
    reg.register(new DummyTool(), true)
    const res = await reg.dispatch('dummy', {}, {} as ToolHost)
    expect(res.ok).toBe(true)
    expect(res.content).toBe('dummy executed')
  })

  it('createDefaultToolRegistry 默认装配 8 类工具且 web_search 默认关闭', () => {
    const reg = createDefaultToolRegistry()
    expect(reg.has('file_read')).toBe(true)
    expect(reg.has('file_write')).toBe(true)
    expect(reg.has('file_manage')).toBe(true)
    expect(reg.has('skill_lookup')).toBe(true)
    expect(reg.has('skill_create')).toBe(true)
    expect(reg.has('skill_update')).toBe(true)
    expect(reg.has('question')).toBe(true)
    expect(reg.has('web_search')).toBe(true)

    // 关键契约：web_search 默认关闭且不下发定义
    expect(reg.isEnabled('web_search')).toBe(false)
    const defs = reg.listDefinitions()
    expect(defs.some((d) => d.name === 'web_search')).toBe(false)
    expect(defs).toHaveLength(7)
  })
})
