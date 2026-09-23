import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { CodeGraphView } from './CodeGraphView'
import { CODE_GRAPH_SNAPSHOT } from './codeGraphSnapshot'

describe('CodeGraphView', () => {
  it('renders the real local GitNexus snapshot metadata and graph facts', () => {
    render(<CodeGraphView />)
    expect(screen.getByRole('heading', { name: '墨舟代码图谱' })).toBeInTheDocument()
    const metrics = screen.getByLabelText('代码图谱统计')
    expect(metrics.textContent).toContain(String(CODE_GRAPH_SNAPSHOT.stats.files))
    expect(metrics.textContent).toContain(
      CODE_GRAPH_SNAPSHOT.stats.nodes.toLocaleString('zh-CN'),
    )
    expect(metrics.textContent).toContain(
      CODE_GRAPH_SNAPSHOT.stats.processes.toLocaleString('zh-CN'),
    )
    expect(screen.getByRole('group', { name: 'GitNexus 架构域关系图' })).toBeInTheDocument()
  })

  it('searches the embedded community/process snapshot without network access', async () => {
    const user = userEvent.setup()
    render(<CodeGraphView />)
    const input = screen.getByPlaceholderText('例如 Workbench / Auth / App → SendJson')
    await user.type(input, 'Workbench')
    expect((input as HTMLInputElement).value).toBe('Workbench')
    expect(document.querySelector('.code-graph-results')?.textContent).toContain('Workbench')
  })
})
