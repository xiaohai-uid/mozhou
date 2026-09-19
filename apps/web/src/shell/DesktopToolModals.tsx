/**
 * 桌面辅助工具面板（T40 · Ink Realm Modal Discipline 修订，ADR-0028）：
 * History / Inspiration / Export / Compliance 属非 blocking 工具——按规格 §9/§23
 * 以右侧 non-blocking Sheet 呈现（不设全屏 scrim，写作上下文不被遮死），
 * Escape / 收起按钮关闭。灵感骰子为本地预设（LOCAL PRESET，零 AI 生成）。
 */
import { useState } from 'react'
import { useSheetA11y } from './useSheetA11y'
import {
  INSPIRATION_CHARACTERS,
  INSPIRATION_SECTS,
  INSPIRATION_ITEMS,
  INSPIRATION_CRISES,
  getRandomPreset,
} from '../shared/inspirationPresets'
import { exportCleanTxt } from '../export-suite/txtCleanExporter'
import { exportSubmissionDocx } from '../export-suite/docxExporter'
import { exportSubmissionEpub } from '../export-suite/epubExporter'

export type DesktopModalType = null | 'history' | 'inspiration' | 'export' | 'compliance'

export interface DesktopToolModalsProps {
  activeModal: DesktopModalType
  onClose: () => void
}

const TITLES: Record<Exclude<DesktopModalType, null>, string> = {
  history: '版本时光机与差异回滚',
  inspiration: '本地灵感起名工坊与卡文骰子',
  export: '作品导出',
  compliance: '平台敏感词与合规审查',
}

function Unavailable({ children }: { children: string }): JSX.Element {
  return (
    <div className="ir-unavailable">
      <b style={{ color: 'var(--warning)' }}>{children}尚未接入</b>
      <br />
      <span style={{ fontSize: 12 }}>
        Technical Preview 不会展示虚构记录，也不会模拟成功操作。接入真实数据面后再开放此功能。
      </span>
    </div>
  )
}

export function DesktopToolModals({ activeModal, onClose }: DesktopToolModalsProps): JSX.Element | null {
  const [nameResult, setNameResult] = useState('陆玄 / 顾清河 / 赵铁鹰')
  const [sectResult, setSectResult] = useState('太虚道宗 / 九曜魔门')
  const [itemResult, setItemResult] = useState('破煞法弩 / 七绝离火镜')
  const [crisisResult, setCrisisResult] = useState('庙外第三股势力逼近')

  // 本地导出状态
  const [exportFormat, setExportFormat] = useState<'txt' | 'docx' | 'epub'>('txt')
  const [exportTitle, setExportTitle] = useState('我的作品')
  const [exportSampleText, setExportSampleText] = useState('')
  const [exportStatus, setExportStatus] = useState<string | null>(null)

  // 本地合规审查状态
  const [complianceText, setComplianceText] = useState('')
  const [complianceResults, setComplianceResults] = useState<string[]>([])

  const { panelRef } = useSheetA11y(activeModal !== null, onClose)

  if (activeModal === null) return null

  const rollDice = (type: 'name' | 'sect' | 'item' | 'crisis') => {
    if (type === 'name') setNameResult(getRandomPreset(INSPIRATION_CHARACTERS, '陆玄'))
    else if (type === 'sect') setSectResult(getRandomPreset(INSPIRATION_SECTS, '太虚道宗'))
    else if (type === 'item') setItemResult(getRandomPreset(INSPIRATION_ITEMS, '破煞法弩'))
    else setCrisisResult(getRandomPreset(INSPIRATION_CRISES, '突发危机'))
  }

  const runComplianceCheck = () => {
    const issues: string[] = []
    if (!complianceText.trim()) {
      setComplianceResults(['请输入需要审查的文本段落'])
      return
    }
    const realOfficialNames = ['公安部', '国务院', '中纪委', '省委', '市委', '信访局']
    for (const name of realOfficialNames) {
      if (complianceText.includes(name)) {
        issues.push(`发现真实官方机构名「${name}」：网文灵异/现代题材建议使用架空名称（如龙国治安局、特事处等）`)
      }
    }
    if (/(?:qq|微信|vx|vx号|扣扣|群号)[\s:：]*[0-9a-zA-Z]{5,}/i.test(complianceText)) {
      issues.push('发现疑似联系方式/社交账号引流违规表达，建议移除或改为小说内部虚拟代号')
    }
    const leftQuotes = (complianceText.match(/“/g) || []).length
    const rightQuotes = (complianceText.match(/”/g) || []).length
    if (leftQuotes !== rightQuotes) {
      issues.push(`双引号未闭合：左引号 ${leftQuotes} 处，右引号 ${rightQuotes} 处`)
    }
    if (issues.length === 0) {
      issues.push('本地基础规则审查完成：未发现真实机构冲突、未闭合引号或明显违规引流表达。')
    }
    setComplianceResults(issues)
  }

  const handleTriggerExport = () => {
    try {
      const title = exportTitle.trim() || '未命名作品'
      const chapters = [
        {
          chapterIndex: 1,
          title: '第一章',
          content: exportSampleText.trim() || '正文草稿内容',
        },
      ]
      let blob: Blob
      let extension = 'txt'
      if (exportFormat === 'txt') {
        const txt = exportCleanTxt(title, chapters)
        blob = new Blob([txt], { type: 'text/plain;charset=utf-8' })
        extension = 'txt'
      } else if (exportFormat === 'docx') {
        const buf = exportSubmissionDocx(title, '', chapters)
        blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
        extension = 'docx'
      } else {
        const buf = exportSubmissionEpub(title, '墨舟作者', chapters)
        blob = new Blob([buf], { type: 'application/epub+zip' })
        extension = 'epub'
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${title}.${extension}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setExportStatus(`导出成功：已下载 ${title}.${extension}`)
    } catch (e) {
      setExportStatus(`导出失败：${(e as Error).message}`)
    }
  }

  return (
    <aside
      ref={panelRef}
      className="capability-sheet"
      role="dialog"
      aria-label={TITLES[activeModal]}
      data-testid="desktop-tool-sheet"
    >
      <div className="scene-sheet-head">
        <div>
          <div className="kicker">DESKTOP TOOL · 非阻塞面板</div>
          <b style={{ fontFamily: 'var(--serif)', fontSize: 16 }}>{TITLES[activeModal]}</b>
        </div>
        <button type="button" className="quiet-btn" onClick={onClose} data-autofocus>
          收起 ✕
        </button>
      </div>
      <div className="scene-sheet-body">
        {activeModal === 'history' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Unavailable>版本历史</Unavailable>
            <div style={{ borderTop: '1px solid var(--hairline)', paddingTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>本地正典快照与修订记录</div>
              <p className="muted" style={{ fontSize: 11, margin: '4px 0 10px' }}>
                墨舟在底层 LocalDataPlane 中记录每个章节的草稿修订（revision）及定稿 SHA-256 哈希。
              </p>
              <div style={{ background: 'var(--surface-sunken)', padding: 10, borderRadius: 8, fontSize: 11 }}>
                <div>● 离线版本守护：已开启</div>
                <div className="muted" style={{ marginTop: 4 }}>
                  外部变动冲突守卫：启用（写前哈希严格校验）
                </div>
                <div className="muted" style={{ marginTop: 2 }}>
                  全量 ZIP 备份：可随时前往「云同步与备份」生成独立全本归档包
                </div>
              </div>
            </div>
          </div>
        )}

        {activeModal === 'inspiration' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button type="button" className="card-capability cap" style={{ minHeight: 0 }} onClick={() => rollDice('name')}>
                <span className="cap-statusbar"><span className="badge b-neutral">LOCAL PRESET</span></span>
                <b className="cap-label" style={{ minHeight: 0 }}>角色龙套起名</b>
                <span className="cap-desc" style={{ color: 'var(--jade)' }}>{nameResult}</span>
              </button>
              <button type="button" className="card-capability cap" style={{ minHeight: 0 }} onClick={() => rollDice('sect')}>
                <span className="cap-statusbar"><span className="badge b-neutral">LOCAL PRESET</span></span>
                <b className="cap-label" style={{ minHeight: 0 }}>宗门势力起名</b>
                <span className="cap-desc" style={{ color: 'var(--warning)' }}>{sectResult}</span>
              </button>
              <button type="button" className="card-capability cap" style={{ minHeight: 0 }} onClick={() => rollDice('item')}>
                <span className="cap-statusbar"><span className="badge b-neutral">LOCAL PRESET</span></span>
                <b className="cap-label" style={{ minHeight: 0 }}>法宝神兵起名</b>
                <span className="cap-desc" style={{ color: 'var(--success)' }}>{itemResult}</span>
              </button>
              <button type="button" className="card-capability cap" style={{ minHeight: 0 }} onClick={() => rollDice('crisis')}>
                <span className="cap-statusbar"><span className="badge b-neutral">LOCAL PRESET</span></span>
                <b className="cap-label" style={{ minHeight: 0 }}>卡文突发事件</b>
                <span className="cap-desc" style={{ color: 'var(--danger)' }}>{crisisResult}</span>
              </button>
            </div>
            <p className="muted" style={{ fontSize: 11, lineHeight: 1.7, marginTop: 12 }}>
              本地随机预设，零 API、零 AI 生成。
            </p>
          </>
        )}

        {activeModal === 'export' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Unavailable>导出</Unavailable>
            <div style={{ borderTop: '1px solid var(--hairline)', paddingTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>本地出版级格式打包下载</div>
              <p className="muted" style={{ fontSize: 11, margin: '4px 0 10px' }}>
                选择导出格式，生成标准规范文件并触发下载：
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
                {(['txt', 'docx', 'epub'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setExportFormat(fmt)}
                    className={`btn ${exportFormat === fmt ? 'btn-primary' : ''}`}
                    style={{ fontSize: 11, padding: '6px 4px' }}
                  >
                    {fmt === 'txt' ? '作家助手 TXT' : fmt === 'docx' ? '责编审稿 Docx' : '读者 EPUB 3'}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  type="text"
                  placeholder="作品名称"
                  value={exportTitle}
                  onChange={(e) => setExportTitle(e.target.value)}
                  style={{ padding: '6px 8px', fontSize: 12, background: 'var(--surface-sunken)', border: '1px solid var(--hairline)', borderRadius: 6, color: 'var(--fg-pure)' }}
                />
                <textarea
                  rows={4}
                  placeholder="章节或样章内容（留空则生成当前样章模板）"
                  value={exportSampleText}
                  onChange={(e) => setExportSampleText(e.target.value)}
                  style={{ padding: '6px 8px', fontSize: 12, background: 'var(--surface-sunken)', border: '1px solid var(--hairline)', borderRadius: 6, color: 'var(--fg-pure)', resize: 'vertical' }}
                />
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleTriggerExport}
                  style={{ fontSize: 12, padding: '8px 12px' }}
                >
                  打包下载本地作品
                </button>
                {exportStatus && (
                  <div style={{ fontSize: 11, color: 'var(--success)', marginTop: 4 }}>{exportStatus}</div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeModal === 'compliance' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Unavailable>合规审查</Unavailable>
            <div style={{ borderTop: '1px solid var(--hairline)', paddingTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>本地离线规则核验</div>
              <p className="muted" style={{ fontSize: 11, margin: '4px 0 10px' }}>
                输入草稿段落，检查架空官方机构名规范、引号配对及引流屏蔽项：
              </p>
              <textarea
                rows={4}
                placeholder="粘贴待审查章节正文段落…"
                value={complianceText}
                onChange={(e) => setComplianceText(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', fontSize: 12, background: 'var(--surface-sunken)', border: '1px solid var(--hairline)', borderRadius: 6, color: 'var(--fg-pure)', resize: 'vertical' }}
              />
              <button
                type="button"
                className="btn-primary"
                onClick={runComplianceCheck}
                style={{ marginTop: 8, fontSize: 12, padding: '6px 12px' }}
              >
                运行本地规则审查
              </button>
              {complianceResults.length > 0 && (
                <div style={{ marginTop: 10, padding: 8, background: 'var(--surface-sunken)', borderRadius: 6, fontSize: 11, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {complianceResults.map((r, i) => (
                    <div key={i} style={{ color: r.includes('建议') || r.includes('未闭合') ? 'var(--warning)' : 'var(--success)' }}>
                      • {r}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
