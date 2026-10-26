/**
 * apps/web/src/workbench/AgentToolboxPanel.tsx
 *
 * 智能体工具箱前端面板（Agent Toolbox Panel）：
 * 展示后端 ToolRegistry 注册的 8 类工具（file_read, file_write, file_manage,
 * skill_lookup, skill_create, skill_update, question, web_search）的名称、描述与参数模式，
 * 支持在线配置参数并向 /api/tools.execute 发起调试调用。
 *
 * 规范遵循：
 *   1. Night Manuscript Studio 设计风格（深墨底色、金/青灰语义标记、Mono 参数与输出）；
 *   2. 严禁静态引入 shared/**：就地声明同口径 DTO；
 *   3. 联网搜索默认关闭，支持通过 enabledTools 动态开启并测试。
 */
import { useCallback, useEffect, useState } from 'react'
import { post } from '../lib/post'
import type { BookInfo } from '../shell/workbenchStorage'

/** 就地声明工具参数模式 DTO（与后端 ToolJsonSchema / shared DTO 同口径，严禁静态引入 shared/**） */
export interface ToolPropertySchema {
  readonly type?: string
  readonly description?: string
  readonly [key: string]: unknown
}

export interface ToolParametersSchema {
  readonly type: 'object'
  readonly properties: Readonly<Record<string, ToolPropertySchema>>
  readonly required?: readonly string[]
}

export interface ToolDefinitionDto {
  readonly name: string
  readonly description: string
  readonly parameters: ToolParametersSchema
}

export interface ToolsListResponseDto {
  readonly ok: boolean
  readonly tools: readonly ToolDefinitionDto[]
  readonly error?: string
}

export interface ToolExecutionResultDto {
  readonly ok: boolean
  readonly content: string
  readonly meta?: Readonly<Record<string, unknown>>
  readonly error?: string
}

export interface AgentToolboxPanelProps {
  readonly book?: BookInfo | null | undefined
}

/** 8 类工具预置测试模板，方便作者或开发者一键填入并测试 */
const SAMPLE_ARGUMENTS: Record<string, Record<string, unknown>> = {
  file_read: {
    path: '正文/第一卷/第0001章.md',
    listOnly: false,
    offset: 0,
    limit: 100,
  },
  file_write: {
    path: '设定/人物卡.md',
    content: '# 主角设定\n姓名：陆玄\n性格：沉稳果断',
    mode: 'overwrite',
  },
  file_manage: {
    action: 'mkdir',
    path: '设定/分卷大纲',
  },
  skill_lookup: {
    id: 'creative-writing',
  },
  skill_create: {
    id: 'dialogue-polisher',
    name: '对白润色师',
    description: '针对古风仙侠小说对话进行口语化与节奏感润色',
    body: '# 技能指南\n保持人物语言贴合身份背景，避免现代网络黑话。',
  },
  skill_update: {
    id: 'dialogue-polisher',
    name: '对白润色师 V2',
    description: '增强宗门大典与论道辩驳场景的庄重辞令',
    body: '# 技能指南 V2\n增加对文言化对白与暗语交锋的处理范例。',
  },
  question: {
    question: '当前主角在第 3 章是否应提前揭示其隐藏的太虚道体？',
  },
  web_search: {
    keywords: '道教九天十地神煞名录',
    limit: 5,
  },
}

export function AgentToolboxPanel({ book }: AgentToolboxPanelProps): JSX.Element {
  const [tools, setTools] = useState<readonly ToolDefinitionDto[]>([])
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [enableWebSearch, setEnableWebSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // 当前选中的测试工具与执行状态
  const [selectedToolName, setSelectedToolName] = useState<string>('file_read')
  const [argsJson, setArgsJson] = useState<string>(
    JSON.stringify(SAMPLE_ARGUMENTS['file_read'], null, 2),
  )
  const [confirmedPathsInput, setConfirmedPathsInput] = useState<string>('')
  const [executing, setExecuting] = useState(false)
  const [execResult, setExecResult] = useState<ToolExecutionResultDto | null>(null)
  const [execError, setExecError] = useState<string | null>(null)

  // 拉取已注册工具定义清单
  const fetchTools = useCallback(async (withWebSearch: boolean) => {
    setLoading(true)
    setListError(null)
    try {
      const payload: Record<string, unknown> = {}
      if (withWebSearch) {
        payload['enabledTools'] = { web_search: true }
      }
      const data = await post<ToolsListResponseDto>('/api/tools.list', payload)
      if (data.ok && Array.isArray(data.tools)) {
        const toolList: readonly ToolDefinitionDto[] = data.tools
        setTools(toolList)
        if (toolList.length > 0 && !toolList.some((t: ToolDefinitionDto) => t.name === selectedToolName)) {
          const first: ToolDefinitionDto | undefined = toolList[0]
          if (first) {
            setSelectedToolName(first.name)
            setArgsJson(JSON.stringify(SAMPLE_ARGUMENTS[first.name] ?? {}, null, 2))
          }
        }
      } else {
        setListError(data.error ?? '获取工具清单返回异常')
      }
    } catch (err) {
      setListError((err as Error).message || '网络请求失败')
    } finally {
      setLoading(false)
    }
  }, [selectedToolName])

  useEffect(() => {
    void fetchTools(enableWebSearch)
  }, [enableWebSearch, fetchTools])

  // 选中某个工具时，若存在默认模板则预填
  const handleSelectTool = (name: string) => {
    setSelectedToolName(name)
    setExecResult(null)
    setExecError(null)
    const sample = SAMPLE_ARGUMENTS[name] ?? {}
    setArgsJson(JSON.stringify(sample, null, 2))
  }

  // 填入官方示例参数
  const handleFillSample = () => {
    const sample = SAMPLE_ARGUMENTS[selectedToolName] ?? {}
    setArgsJson(JSON.stringify(sample, null, 2))
  }

  // 执行工具调试调用
  const handleExecuteTool = async () => {
    setExecuting(true)
    setExecResult(null)
    setExecError(null)

    let parsedArgs: Record<string, unknown> = {}
    try {
      const trimmed = argsJson.trim()
      if (trimmed !== '') {
        parsedArgs = JSON.parse(trimmed) as Record<string, unknown>
      }
    } catch (jsonErr) {
      setExecError(`参数 JSON 解析失败：${(jsonErr as Error).message}`)
      setExecuting(false)
      return
    }

    const confirmedPaths = confirmedPathsInput
      .split('\n')
      .map((p) => p.trim())
      .filter((p) => p !== '')

    try {
      const payload: Record<string, unknown> = {
        name: selectedToolName,
        args: parsedArgs,
        root: book?.root ?? undefined,
        confirmedPaths: confirmedPaths.length > 0 ? confirmedPaths : undefined,
      }
      if (enableWebSearch) {
        payload['enabledTools'] = { web_search: true }
      }

      const res = await post<ToolExecutionResultDto>('/api/tools.execute', payload)
      setExecResult(res)
    } catch (err) {
      const postErr = err as Error & { body?: ToolExecutionResultDto }
      if (postErr.body && typeof postErr.body.ok === 'boolean') {
        const fallbackRes: ToolExecutionResultDto = {
          ok: postErr.body.ok,
          content: postErr.body.content || postErr.body.error || postErr.message,
          ...(postErr.body.meta !== undefined ? { meta: postErr.body.meta } : {}),
          ...(postErr.body.error !== undefined ? { error: postErr.body.error } : {}),
        }
        setExecResult(fallbackRes)
      } else {
        setExecError(postErr.message || '执行工具请求失败')
      }
    } finally {
      setExecuting(false)
    }
  }

  const selectedTool = tools.find((t) => t.name === selectedToolName)
  const filteredTools = tools.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <div
      className="agent-toolbox-panel"
      data-testid="agent-toolbox-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: 4,
        color: 'var(--foreground)',
      }}
    >
      {/* 头部摘要栏 */}
      <div
        className="toolbox-header"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          borderBottom: '1px solid var(--hairline)',
          paddingBottom: 12,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 10,
                color: 'var(--gold)',
                background: 'var(--gold-soft)',
                border: '1px solid var(--gold-line-soft)',
                borderRadius: 4,
                padding: '2px 6px',
                letterSpacing: '0.08em',
              }}
            >
              TOOL REGISTRY
            </span>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>智能体工具箱</h3>
          </div>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 11.5 }}>
            已就绪 8 类标准工具 · 路径三档授权沙箱隔离 · 软删除进回收站
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              cursor: 'pointer',
              userSelect: 'none',
              background: 'var(--surface-sunken)',
              padding: '4px 8px',
              borderRadius: 6,
              border: '1px solid var(--hairline)',
            }}
            title="开启后下发 web_search 工具定义并在分发时放行搜索"
          >
            <input
              type="checkbox"
              data-testid="web-search-toggle"
              checked={enableWebSearch}
              onChange={(e) => setEnableWebSearch(e.target.checked)}
              disabled={loading}
            />
            <span style={{ color: enableWebSearch ? 'var(--jade)' : 'var(--text-muted)' }}>
              启用联网搜索 (web_search)
            </span>
          </label>

          <button
            type="button"
            className="btn"
            data-testid="tools-refresh-btn"
            onClick={() => void fetchTools(enableWebSearch)}
            disabled={loading}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            {loading ? '刷新中…' : '刷新清单'}
          </button>
        </div>
      </div>

      {listError !== null && (
        <div
          role="alert"
          className="wb-error"
          style={{
            padding: '8px 12px',
            fontSize: 12,
            background: 'rgba(231, 127, 140, 0.1)',
            border: '1px solid var(--danger)',
            borderRadius: 6,
            color: 'var(--danger)',
          }}
        >
          工具清单加载失败：{listError}
        </div>
      )}

      {/* 搜索与过滤 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="text"
          className="control"
          data-testid="tools-search-input"
          placeholder="按工具名称或描述过滤 (如 file_read, skill)..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            flex: 1,
            padding: '6px 10px',
            fontSize: 12,
            background: 'var(--surface-sunken)',
            borderRadius: 6,
            border: '1px solid var(--hairline)',
          }}
        />
        <span className="mono muted" style={{ fontSize: 11 }}>
          {filteredTools.length} / {tools.length} 项工具已就绪
        </span>
      </div>

      {/* 主体两栏布局：左侧工具列表，右侧参数详情与在线调用测试台 */}
      <div
        className="toolbox-main-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(240px, 320px) minmax(360px, 1fr)',
          gap: 14,
          alignItems: 'start',
        }}
      >
        {/* 左侧：工具列表卡片 */}
        <div
          className="tools-list-col"
          data-testid="tools-list"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            maxHeight: 520,
            overflowY: 'auto',
            paddingRight: 4,
          }}
        >
          {filteredTools.length === 0 && !loading && (
            <div
              className="card muted"
              style={{ padding: 14, textAlign: 'center', fontSize: 12 }}
            >
              未找到匹配的工具
            </div>
          )}

          {filteredTools.map((tool) => {
            const isSelected = tool.name === selectedToolName
            return (
              <button
                key={tool.name}
                type="button"
                data-testid={`tool-card-${tool.name}`}
                onClick={() => handleSelectTool(tool.name)}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: isSelected
                    ? '1px solid var(--gold)'
                    : '1px solid var(--hairline)',
                  background: isSelected
                    ? 'var(--surface-raised)'
                    : 'var(--surface-2)',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s ease, background 0.15s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                  }}
                >
                  <span
                    className="mono"
                    style={{
                      fontWeight: 600,
                      fontSize: 13,
                      color: isSelected ? 'var(--gold-bright)' : 'var(--foreground)',
                    }}
                  >
                    {tool.name}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontFamily: 'var(--mono)',
                      padding: '1px 5px',
                      borderRadius: 4,
                      background:
                        tool.name === 'web_search'
                          ? 'var(--jade-soft)'
                          : 'var(--surface-sunken)',
                      color:
                        tool.name === 'web_search'
                          ? 'var(--jade)'
                          : 'var(--text-muted)',
                      border: '1px solid var(--hairline)',
                    }}
                  >
                    {tool.name === 'web_search' ? '联网扩展' : '核心内置'}
                  </span>
                </div>
                <p
                  className="muted"
                  style={{
                    margin: 0,
                    fontSize: 11,
                    lineHeight: 1.5,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                  }}
                >
                  {tool.description}
                </p>
              </button>
            )
          })}
        </div>

        {/* 右侧：工具参数规格与测试台 */}
        <div
          className="tool-execution-col card"
          style={{
            padding: 16,
            background: 'var(--surface-2)',
            border: '1px solid var(--hairline)',
            borderRadius: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {selectedTool ? (
            <>
              {/* 选中工具标题与描述 */}
              <div
                style={{
                  borderBottom: '1px solid var(--hairline)',
                  paddingBottom: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: 'var(--gold)' }}>
                    {selectedTool.name}
                  </span>
                  <span className="tag" style={{ fontSize: 11 }}>调试台</span>
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 12, lineHeight: 1.6, color: 'var(--text-muted)' }}>
                  {selectedTool.description}
                </p>
              </div>

              {/* 参数定义列表 */}
              <div>
                <div className="kicker" style={{ fontSize: 10, marginBottom: 6, color: 'var(--text-faint)' }}>
                  PARAMETER SPECIFICATIONS (JSON SCHEMA)
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    background: 'var(--surface-sunken)',
                    padding: 8,
                    borderRadius: 6,
                    border: '1px solid var(--hairline)',
                    fontSize: 11.5,
                  }}
                  data-testid="tool-parameters-spec"
                >
                  {Object.entries(selectedTool.parameters.properties ?? {}).map(([propName, prop]) => {
                    const isRequired = selectedTool.parameters.required?.includes(propName)
                    return (
                      <div
                        key={propName}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '120px 70px 1fr',
                          gap: 8,
                          alignItems: 'baseline',
                        }}
                      >
                        <span className="mono" style={{ color: isRequired ? 'var(--gold-bright)' : 'var(--foreground)' }}>
                          {propName}
                          {isRequired && <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>}
                        </span>
                        <span className="mono muted" style={{ fontSize: 10.5 }}>
                          {prop.type ?? 'any'}
                        </span>
                        <span className="muted" style={{ fontSize: 11 }}>
                          {prop.description ?? '—'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 参数测试输入框 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <label htmlFor="tool-args-input" className="kicker" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                    INPUT ARGS (JSON)
                  </label>
                  <button
                    type="button"
                    className="btn"
                    data-testid="fill-sample-args-btn"
                    onClick={handleFillSample}
                    style={{ fontSize: 10.5, padding: '2px 8px' }}
                  >
                    填充示例参数
                  </button>
                </div>

                <textarea
                  id="tool-args-input"
                  data-testid="tool-args-input"
                  aria-label="输入参数JSON"
                  className="control mono"
                  rows={5}
                  value={argsJson}
                  onChange={(e) => setArgsJson(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    fontSize: 11.5,
                    lineHeight: 1.5,
                    background: 'var(--surface-sunken)',
                    borderRadius: 6,
                    border: '1px solid var(--hairline)',
                    resize: 'vertical',
                  }}
                />
              </div>

              {/* 外部路径确认列表（针对外部路径白名单授权测试） */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label
                  htmlFor="confirmed-paths-input"
                  className="kicker"
                  style={{ fontSize: 10, color: 'var(--text-faint)' }}
                  title="路径三档授权防护：对书根外部的路径需在此显式授权，每行一个路径"
                >
                  CONFIRMED PATHS (可选，外部路径授权每行一条)
                </label>
                <input
                  id="confirmed-paths-input"
                  data-testid="confirmed-paths-input"
                  type="text"
                  className="control mono"
                  placeholder="如：C:\temp\external_ref.txt"
                  value={confirmedPathsInput}
                  onChange={(e) => setConfirmedPathsInput(e.target.value)}
                  style={{
                    padding: '5px 8px',
                    fontSize: 11,
                    background: 'var(--surface-sunken)',
                    borderRadius: 6,
                    border: '1px solid var(--hairline)',
                  }}
                />
              </div>

              {/* 执行操作栏 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                <button
                  type="button"
                  className="btn-primary"
                  data-testid="tool-execute-btn"
                  onClick={() => void handleExecuteTool()}
                  disabled={executing}
                  style={{
                    padding: '6px 18px',
                    fontSize: 12.5,
                    fontWeight: 600,
                  }}
                >
                  {executing ? '执行调试中…' : `测试执行 ${selectedTool.name}`}
                </button>

                {execResult !== null && (
                  <button
                    type="button"
                    className="btn"
                    data-testid="clear-result-btn"
                    onClick={() => setExecResult(null)}
                    style={{ fontSize: 11, padding: '4px 8px' }}
                  >
                    清除输出
                  </button>
                )}
              </div>

              {/* 错误提示 */}
              {execError !== null && (
                <div
                  role="alert"
                  className="wb-error"
                  data-testid="tool-exec-error"
                  style={{
                    padding: '8px 12px',
                    fontSize: 11.5,
                    background: 'rgba(231, 127, 140, 0.1)',
                    border: '1px solid var(--danger)',
                    borderRadius: 6,
                    color: 'var(--danger)',
                  }}
                >
                  执行错误：{execError}
                </div>
              )}

              {/* 执行结果展示卡 */}
              {execResult !== null && (
                <div
                  className="exec-result-card"
                  data-testid="tool-result-card"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    background: 'var(--surface-sunken)',
                    border: `1px solid ${execResult.ok ? 'var(--jade-line)' : 'var(--danger)'}`,
                    borderRadius: 6,
                    padding: 10,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span
                      data-testid="tool-result-status"
                      className="mono"
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: execResult.ok ? 'var(--success)' : 'var(--danger)',
                      }}
                    >
                      {execResult.ok ? '✓ DISPATCH SUCCESS (ok: true)' : '✗ EXECUTION FAILED (ok: false)'}
                    </span>
                    {execResult.meta && (
                      <span className="mono muted" style={{ fontSize: 10 }}>
                        META: {JSON.stringify(execResult.meta)}
                      </span>
                    )}
                  </div>

                  <div className="kicker" style={{ fontSize: 9.5, color: 'var(--text-faint)' }}>
                    RETURN CONTENT
                  </div>
                  <pre
                    data-testid="tool-result-content"
                    className="mono"
                    style={{
                      margin: 0,
                      padding: 8,
                      fontSize: 11,
                      lineHeight: 1.5,
                      background: 'var(--surface-3)',
                      borderRadius: 4,
                      maxHeight: 200,
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      color: execResult.ok ? 'var(--foreground)' : 'var(--danger)',
                    }}
                  >
                    {execResult.content || '（返回内容为空）'}
                  </pre>
                </div>
              )}
            </>
          ) : (
            <div className="muted" style={{ padding: 24, textAlign: 'center', fontSize: 12 }}>
              请在左侧选择要查看或调试的工具
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
