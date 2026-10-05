/**
 * 「为什么这么写」入口（T2）。
 *
 * ## 它解决什么
 * 装配看板（ReceiptPanel）此前只能从左侧「检视 · Novel OS → 装配看板」进入，
 * 而且进去之后还要自己在列表里翻找对应章的回执。作者在正文侧看着一段写坏的
 * 剧情想知道「模型当时读了什么」时，这两步导航足够把人劝退——于是 Hidden Context
 * 变成了没人去查的盲区。本按钮把这条路径压成一次点击。
 *
 * ## 诚实边界（不要在 UI 里粉饰）
 * - 本章**从未装配过**时按钮禁用，并如实说明原因，不跳到一个空看板假装「无问题」。
 * - 有多份回执时取**列表序最后一条**（回执一证一文件、ULID 文件名字典序 = 时间序），
 *   即该章最近一次装配；不猜「哪一次才是作者眼前这一稿」——那需要正文哈希对齐，
 *   现有契约没有这个字段，**不在本票范围**。
 * - 点击只读不改：打开的是既有回执详情，不触发任何装配或写盘。
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReceiptListResponse } from '../../shared/api'
import { post } from '../lib/post'

export function WhyThisWritingButton({
  root,
  chapterIndex,
  onOpen,
}: {
  /** 当前书根；null = 未建书，按钮不渲染。 */
  readonly root: string | null
  readonly chapterIndex: number
  /** 交出本章最近一次回执 id，由 App 切到装配看板并预选。 */
  readonly onOpen: (receiptId: string) => void
}): JSX.Element | null {
  const [reason, setReason] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const probe = useCallback(async (): Promise<void> => {
    if (root === null) return
    setBusy(true)
    setReason(null)
    try {
      const data = await post<ReceiptListResponse>('/api/receipts', { root })
      const mine = data.receipts.filter((row) => row.chapterIndex === chapterIndex)
      if (mine.length === 0) {
        setReason('本章还没有装配记录——先生成一次草稿再看')
        return
      }
      onOpen(mine[mine.length - 1]!.receiptId)
    } catch (cause) {
      setReason('装配记录读取失败：' + (cause as Error).message)
    } finally {
      setBusy(false)
    }
  }, [root, chapterIndex, onOpen])

  useEffect(() => { setReason(null) }, [chapterIndex])

  if (root === null) return null
  return (
    <>
      <button
        type="button"
        className="btn"
        style={{ padding: '4px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}
        disabled={busy}
        onClick={() => { void probe() }}
      >
        为什么这么写
      </button>
      {reason !== null && (
        <span className="mono muted" role="status" style={{ fontSize: 11 }}>
          {reason}
        </span>
      )}
    </>
  )
}
