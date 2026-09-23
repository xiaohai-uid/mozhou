import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { CodeNodeExplorer } from './CodeNodeExplorer'
import graph from './codeGraphData.json'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('CodeNodeExplorer', () => {
  it('exports editor-facing one-based source lines, not GitNexus zero-based offsets', () => {
    const node = graph.nodes.find((item) =>
      item.id === 'Function:apps/web/src/workbench/WorkbenchView.tsx:WorkbenchView',
    )!
    const source = readFileSync(resolve(process.cwd(), '../..', node.filePath), 'utf8')
    const actualLine = source.split(/\r?\n/).findIndex((line) =>
      line.startsWith('export function WorkbenchView('),
    ) + 1
    expect(actualLine).toBeGreaterThan(0)
    expect(node.line).toBe(actualLine)
  })

  it('browses a real symbol and follows its indexed relationship', async () => {
    const user = userEvent.setup()
    render(<CodeNodeExplorer />)
    await user.type(screen.getByLabelText('代码名称或路径'), 'WorkbenchView')
    await user.selectOptions(screen.getByLabelText('节点类型'), 'Function')
    const list = screen.getByLabelText('代码节点列表')
    await user.click(within(list).getByRole('button', { name: /^WorkbenchView / }))
    const detail = screen.getByLabelText('代码节点详情')
    expect(within(detail).getByRole('heading', { name: 'WorkbenchView' })).toBeInTheDocument()
    expect(detail.textContent).toContain('apps/web/src/workbench/WorkbenchView.tsx')
    await user.selectOptions(screen.getByLabelText('关系类型'), 'CALLS')
    expect(detail.textContent).toContain('CALLS')
    const target = within(detail).getAllByRole('button')[0]!
    const name = target.textContent!
    await user.click(target)
    expect(within(detail).getByRole('heading', { name })).toBeInTheDocument()
  })

  it('keeps every indexed result reachable and reports an honest empty state', async () => {
    const user = userEvent.setup()
    render(<CodeNodeExplorer />)
    const list = screen.getByLabelText('代码节点列表')
    expect(within(list).getByRole('status')).toHaveTextContent(String(graph.nodes.length))
    await user.click(screen.getByRole('button', { name: '显示更多节点' }))
    expect(within(list).getByRole('status')).toHaveTextContent('显示 80 个')
    await user.type(screen.getByLabelText('代码名称或路径'), 'no-such-symbol-xyz-927')
    expect(list).toHaveTextContent('0 个匹配节点')
    expect(list).toHaveTextContent('没有匹配节点')
    await user.clear(screen.getByLabelText('代码名称或路径'))
    expect(within(list).getByRole('status')).toHaveTextContent('显示 40 个')
  })
})
