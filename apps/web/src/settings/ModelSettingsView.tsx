/**
 * 模型设置页（ModelSettingsView）——商业化阻断 2 的 UI 半边。
 *
 * 为什么必须有这个页面：审查发现整个产品**没有任何一处**能录入大模型密钥。
 * 作者拿到的是一个装好的桌面应用，第一屏是向导，然后就没有下文了——
 * 既没有输入框，也没有说明去哪儿取。
 *
 * 表单逻辑在 ProviderSettingsForm（与移动端系统中心共用同一份），本页只负责
 * 卡片外壳与「已配置 / 未配置」状态徽标。
 */
import { ProviderSettingsForm, useProviderSettings } from './ProviderSettingsForm'

export function ModelSettingsView(): JSX.Element {
  const state = useProviderSettings()
  const configured = state.settings?.configured === true
  const statusText = state.settings === null ? '读取中…' : configured ? '已配置' : '未配置'

  return (
    <div className="view">
      <div className="card">
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <b>模型设置</b>
          <span className={configured ? 'cap-badge native' : 'cap-badge pending'} data-testid="provider-status">
            {statusText}
          </span>
        </div>

        <p className="mono muted" style={{ fontSize: 11, lineHeight: 1.8, marginTop: 4 }}>
          墨舟不托管你的模型账号。把服务商给你的 API 密钥填在这里，章节生成、事实抽取与质量审查
          都会走这个端点。未配置前，「生成草稿」会明确拒绝，而不是假装成功。
        </p>

        <ProviderSettingsForm state={state} />

        <p className="mono muted" data-testid="provider-privacy-note" style={{ fontSize: 11, lineHeight: 1.8, marginTop: 12 }}>
          密钥以 AES-256-GCM 加密后存放在本机应用数据目录，不写入 localStorage、不写入书籍目录、
          不随书导出。清除配置会删除该文件。
        </p>
      </div>
    </div>
  )
}
