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

        {/*
          本机模型接入说明（P2 缺陷「本机模型接入指引误导」）。
          为什么写在这里：写作区此前对**所有** provider 失败都只说「去填 API 密钥」，
          而本机部署（MOZHOU_API_BASE=http://127.0.0.1:8317）失败的真因是 SSRF 门禁
          按设计拒绝环回地址——填密钥接不上，照做只会被当成产品坏了。本页是该说明
          唯一的常驻落点：作者被指引到设置页时，正好在这里读到本机路径；也顺带回答
          「这台机器明明有模型，为什么它不要我填密钥」。
        */}
        <p
          className="mono muted"
          data-testid="provider-local-model-note"
          style={{ fontSize: 11, lineHeight: 1.8, marginTop: 12 }}
        >
          <b>接本机模型？</b>本机部署（如 127.0.0.1 上的 Ollama / llama.cpp / vLLM）不需要填上面的密钥表：
          在启动墨舟的环境里设 <code>MOZHOU_API_BASE</code> 指向它的 OpenAI 兼容地址（如{' '}
          <code>http://127.0.0.1:8317/v1</code>）与 <code>MOZHOU_API_KEY</code>（本机服务通常任意非空值即可）。
          <br />
          <b>还需额外一个开关：</b>本机/私有地址默认被出站安全门禁拒绝（防 SSRF）。只有确定要让墨舟
          访问本机网络时才设 <code>MOZHOU_ALLOW_PRIVATE_LLM=1</code> 并重启——只设 base 会被拦下。
          该开关只把范围放到 http/https，仍需显式开启，不设即保持拒绝。
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
