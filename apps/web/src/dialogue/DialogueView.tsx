/**
 * 写作对话独立视图（填补 T40 航道占位）：
 * - 未建书：显式空态引导（与 Works/Tasks 空态同口径，不假装可用）；
 * - 已建书：复用工作台同源 DialogueStream（问卷 → NDJSON 流式出稿），
 *   挂当前选中章，产出与工作台编辑器一致。
 */
import { DialogueStream } from '../workbench/DialogueStream'
import type { BookInfo } from '../shell/workbenchStorage'

export interface DialogueViewProps {
  book: BookInfo | null
  chapterIndex: number
  onGoToWorkbench: () => void
}

export function DialogueView({ book, chapterIndex, onGoToWorkbench }: DialogueViewProps): JSX.Element {
  if (book === null) {
    return (
      <div className="card" data-testid="dialogue-empty" style={{ margin: 24, padding: 20 }}>
        <b>写作对话需要先建书</b>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.7, margin: '8px 0 12px' }}>
          写作对话通过「墨舟先问 → 作者选答」的问卷流生成章节草稿（NDJSON 流式出稿）。
          回到工作台创建或打开一部作品后，本页即可使用。
        </p>
        <button className="btn-primary" onClick={onGoToWorkbench}>
          前往工作台
        </button>
      </div>
    )
  }

  return (
    <div className="dialogue-view" data-testid="dialogue-view" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 24px',
          borderBottom: '1px solid var(--border, #27272a)',
        }}
      >
        <b style={{ fontSize: 14 }}>写作对话</b>
        <span className="mono muted" style={{ fontSize: 12 }}>
          《{book.title}》 · 第 {chapterIndex} 章
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 24px 24px' }}>
        <DialogueStream book={book} chapterIndex={chapterIndex} />
      </div>
    </div>
  )
}
