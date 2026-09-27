/**
 * 模型端点配置表单（ProviderSettingsForm）——桌面设置页与移动端系统中心共用同一份。
 *
 * 单一真源：端点的读/写/探针/清除四个动作只在这里发生一次，桌面与移动不会各写一套
 * 而悄悄漂移。视觉外壳（卡片、状态徽标、区块标题）由各自的宿主页负责。
 *
 * 契约（既有路由，不新增端点）：
 *   GET  /api/llm/settings        → 脱敏配置
 *   POST /api/llm/settings        → 保存（AES-256-GCM 加密落盘，明文永不回显）
 *   POST /api/llm/test            → 真实最小探针
 *   POST /api/llm/settings/reset  → 清除
 */
import { useCallback, useEffect, useState } from 'react'
import { post } from '../lib/post'

export interface MaskedSettings {
  readonly configured: boolean
  readonly providerId: string
  readonly baseUrl: string
  readonly maskedKey: string
  readonly model: string
  readonly configVersion: number
  readonly updatedAt: string | null
}

export interface ProviderSettingsState {
  readonly settings: MaskedSettings | null
  readonly error: string | null
  readonly notice: string | null
  readonly testResult: { readonly model: string; readonly latencyMs: number; readonly maskedKey: string } | null
  readonly save: (input: { readonly apiKey: string; readonly baseUrl: string; readonly model: string }) => Promise<void>
  readonly test: () => Promise<void>
  readonly reset: () => Promise<void>
}

const DEFAULT_MODEL = 'deepseek-chat'
const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1'

/** 端点配置的读写探针逻辑（无 JSX，便于桌面/移动共用与单测）。 */
export function useProviderSettings(): ProviderSettingsState {
  const [settings, setSettings] = useState<MaskedSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<ProviderSettingsState['testResult']>(null)

  const load = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      const res = await fetch('/api/llm/settings', { method: 'GET' })
      const data = (await res.json()) as { ok?: boolean; error?: string; settings?: MaskedSettings }
      if (!res.ok || data.ok === false || data.settings === undefined) {
        throw new Error(data.error ?? '读取模型配置失败 (HTTP ' + res.status + ')')
      }
      setSettings(data.settings)
    } catch (cause) {
      setError((cause as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(
    async (input: { readonly apiKey: string; readonly baseUrl: string; readonly model: string }): Promise<void> => {
      setError(null)
      setNotice(null)
      setTestResult(null)
      if (input.apiKey.trim() === '') {
        setError('请先填写 API 密钥')
        return
      }
      try {
        const saved = await post<{ settings: MaskedSettings }>('/api/llm/settings', {
          apiKey: input.apiKey.trim(),
          baseUrl: input.baseUrl.trim(),
          model: input.model.trim(),
        })
        setSettings(saved.settings)
        setNotice('已保存。写章节、抽事实、跑质量审查都会用这个端点。')
      } catch (cause) {
        setError((cause as Error).message)
      }
    },
    [],
  )

  const test = useCallback(async (): Promise<void> => {
    setError(null)
    setTestResult(null)
    try {
      setTestResult(await post('/api/llm/test', {}))
    } catch (cause) {
      setError((cause as Error).message)
    }
  }, [])

  const reset = useCallback(async (): Promise<void> => {
    setError(null)
    setNotice(null)
    setTestResult(null)
    try {
      await post('/api/llm/settings/reset', {})
      setNotice('已清除本机保存的密钥与端点。')
      await load()
    } catch (cause) {
      setError((cause as Error).message)
    }
  }, [load])

  return { settings, error, notice, testResult, save, test, reset }
}

export interface ProviderSettingsFormProps {
  readonly state: ProviderSettingsState
  /** 移动端内联展开时不重复渲染大标题；桌面页自带卡片标题。 */
  readonly compact?: boolean
}

/** 配置表单本体：密钥 / 端点 / 模型 + 保存 / 测试 / 清除 + 状态回显。 */
export function ProviderSettingsForm({ state, compact = false }: ProviderSettingsFormProps): JSX.Element {
  const { settings, error, notice, testResult, save, test, reset } = state
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const configured = settings?.configured === true

  // 读回的配置优先；尚未读到时用默认值。作者改过的输入不被回读覆盖
  // （configVersion 只在服务端成功保存后自增，故它就是「有没有被覆盖」的分界）。
  const loadedVersion = settings?.configVersion ?? -1
  const [seededVersion, setSeededVersion] = useState(-1)
  if (loadedVersion !== seededVersion) {
    setSeededVersion(loadedVersion)
    if (settings !== null) {
      setBaseUrl(settings.baseUrl === '' ? DEFAULT_BASE_URL : settings.baseUrl)
      setModel(settings.model === '' ? DEFAULT_MODEL : settings.model)
    }
  }

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 8 : 10, marginTop: compact ? 8 : 14 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
        <span className="mono muted">API 密钥</span>
        <input
          type="password"
          value={apiKey}
          autoComplete="off"
          placeholder={configured ? '已保存（改端点需重填密钥）' : '粘贴你的 API Key'}
          onChange={(e) => setApiKey(e.target.value)}
        />
        {configured && (
          <span className="mono muted" data-testid="provider-masked-key" style={{ fontSize: 11 }}>
            本机已存：{settings?.maskedKey}
          </span>
        )}
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
        <span className="mono muted">端点地址（OpenAI 兼容）</span>
        <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={DEFAULT_BASE_URL} />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
        <span className="mono muted">模型名</span>
        <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder={DEFAULT_MODEL} />
      </label>

      <div className="actions" style={{ marginTop: 2, gap: 8 }}>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void run(() => save({ apiKey, baseUrl, model }))}
        >
          {busy ? '处理中…' : '保存配置'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={testing || !configured}
          onClick={() => {
            setTesting(true)
            void run(test).finally(() => setTesting(false))
          }}
        >
          {testing ? '测试中…' : '测试连接'}
        </button>
        {configured && (
          <button type="button" className="btn" disabled={busy} onClick={() => void run(reset)}>
            清除配置
          </button>
        )}
      </div>

      {error !== null && (
        <p
          className="mono"
          data-testid="provider-error"
          style={{ margin: 0, color: 'var(--danger, #d9534f)', fontSize: 11 }}
        >
          {error}
        </p>
      )}
      {notice !== null && (
        <p className="mono" data-testid="provider-save-notice" style={{ margin: 0, color: 'var(--success)', fontSize: 11 }}>
          {notice}
        </p>
      )}
      {testResult !== null && (
        <p className="mono" data-testid="provider-test-result" style={{ margin: 0, color: 'var(--success)', fontSize: 11 }}>
          连接正常 · 模型 {testResult.model} · 延迟 {testResult.latencyMs}ms · 密钥 {testResult.maskedKey}
        </p>
      )}
    </div>
  )
}
