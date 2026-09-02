export interface ProseReadingFlowProps {
  title?: string
  wordCount?: number
  revision?: number
  proseParagraphs?: string[]
  onOpenFormat?: () => void
}

export function ProseReadingFlow({
  title = '第一章 假道士与真显灵',
  wordCount = 3420,
  revision = 4,
  proseParagraphs = [
    '暴雨倾盆。落魄山腰处的山神庙早已破败多年，残垣断瓦间透着刺骨的阴风。',
    '陆玄盘坐在冰冷的神台边，身上那件洗得发白的八卦道袍被夜风吹得猎猎作响。他手里捏着半块发硬的干粮，正小心翼翼地擦拭着袖子里的黄纸与白磷。',
    '“陆半仙，你方才说这庙里真有神灵庇护，那为何这神台之上，只供着一具无头泥塑？”',
    '庙门哐当一声被撞开，龙国安宁县特事治安官赵捕头按着腰间佩刀，满身雨水地大步跨入，目光如隼，死死盯在陆玄脸上。',
  ],
  onOpenFormat,
}: ProseReadingFlowProps): JSX.Element {
  return (
    <div style={{ padding: '16px 20px 110px' }}>
      <h2
        style={{
          fontFamily: 'var(--font-prose-mobile)',
          fontSize: 22,
          fontWeight: 700,
          color: 'var(--fg-pure-mobile)',
          marginBottom: 6,
        }}
      >
        {title}
      </h2>

      <div
        style={{
          fontSize: 11,
          color: 'var(--fg-muted-mobile)',
          marginBottom: 20,
          paddingBottom: 10,
          borderBottom: '1px solid var(--hairline-subtle-mobile)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', gap: 12 }}>
          <span>{wordCount.toLocaleString()} 字</span>
          <span>修改版本：Rev {revision}</span>
          <span style={{ color: 'var(--emerald-mobile)' }}>● 敏感词合规通过</span>
        </div>
        <button
          type="button"
          className="mobile-tag"
          style={{ cursor: 'pointer', background: 'transparent', border: 'none' }}
          onClick={onOpenFormat}
        >
          一键规范排版
        </button>
      </div>

      <div
        style={{
          fontFamily: 'var(--font-prose-mobile)',
          fontSize: 16.5,
          lineHeight: 2.0,
          color: 'var(--fg-primary-mobile)',
          textAlign: 'justify',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {proseParagraphs.map((p, idx) => {
          const isForeshadow = idx === 1
          return (
            <p
              key={p.slice(0, 10)}
              style={
                isForeshadow
                  ? {
                      paddingLeft: 12,
                      borderLeft: '2px solid var(--gold-mobile)',
                      background:
                        'linear-gradient(90deg, var(--gold-soft-mobile) 0%, transparent 100%)',
                      borderRadius: '0 6px 6px 0',
                    }
                  : undefined
              }
            >
              {p}
              {isForeshadow && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    fontSize: 10.5,
                    color: 'var(--gold-mobile)',
                    background: 'var(--gold-soft-mobile)',
                    border: '1px solid rgba(212, 163, 89, 0.25)',
                    padding: '1px 6px',
                    borderRadius: 4,
                    marginLeft: 6,
                    verticalAlign: 'middle',
                  }}
                >
                  伏笔 · 物理道具
                </span>
              )}
            </p>
          )
        })}
      </div>
    </div>
  )
}
