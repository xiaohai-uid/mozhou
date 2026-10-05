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
    // 三个统计量一律与渲染同口径（zh-CN 千分位）。原先只有 files 这一条拿未格式化数字
    // 去比含分隔符的串，此前 files<1000 时两者恰好同形、断言一直绿；索引首次跨过 1000
    // （997 → 1000）就必然红。那是断言本身无效，不是产品缺陷，故与同文件另两条对齐，
    // 而不是放宽成「包含任一形式」。
    expect(metrics.textContent).toContain(CODE_GRAPH_SNAPSHOT.stats.files.toLocaleString('zh-CN'))
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
