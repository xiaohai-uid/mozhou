/**
 * 壳层遥测 hook：书/章变化时并行拉取管线状态证据
 * （works 相位 / receipts 凭证 / quality 时效 / change-matrix 影响），
 * 供 Pipeline 六态与检视摘要轨消费。全部失败容忍（allSettled）——
 * 任一面不可用只降级为 '—'，不阻塞壳层。
 */
import { useCallback, useEffect, useState } from 'react'
import { post } from '../lib/post'
import type { WorksOverviewResponse, ReceiptListItem } from '../../server/api'
import type { MatrixRowsLite, QualityStatusLite } from './shellTelemetry'

export interface ShellTelemetry {
  readonly works: WorksOverviewResponse | null
  readonly receipts: readonly ReceiptListItem[]
  readonly quality: QualityStatusLite | null
  readonly matrixRows: MatrixRowsLite['rows'] | null
}
const EMPTY: ShellTelemetry = { works: null, receipts: [], quality: null, matrixRows: null }

export function useShellTelemetry(root: string | null, chapterIndex: number): ShellTelemetry {
  const [telemetry, setTelemetry] = useState<ShellTelemetry>(EMPTY)

  const refresh = useCallback(async (): Promise<void> => {
    if (root === null) {
      setTelemetry(EMPTY)
      return
    }
    const [works, receipts, quality, matrix] = await Promise.allSettled([
      post<WorksOverviewResponse>('/api/works', { root }),
      post<{ ok: boolean; receipts: readonly ReceiptListItem[] }>('/api/receipts', { root }),
      post<QualityStatusLite & { ok: boolean }>('/api/chapter.quality', { root, chapterIndex }),
      post<{ ok: boolean; matrix: MatrixRowsLite }>('/api/change-matrix', { root }),
    ])
    // 载荷归一化：字段缺失（如测试桩/降级面）不得让壳层崩溃。
    setTelemetry({
      works: works.status === 'fulfilled' && Array.isArray(works.value?.chapters) ? works.value : null,
      receipts: receipts.status === 'fulfilled' && Array.isArray(receipts.value?.receipts) ? receipts.value.receipts : [],
      quality:
        quality.status === 'fulfilled' &&
        (quality.value?.status === 'no_review' || quality.value?.status === 'current' || quality.value?.status === 'stale')
          ? quality.value
          : null,
      matrixRows: matrix.status === 'fulfilled' && Array.isArray(matrix.value?.matrix?.rows) ? matrix.value.matrix.rows : null,
    })
  }, [root, chapterIndex])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** 写作层落盘（ProseEditorPanel Accept）→ 遥测即时重验（works 相位/质量时效变化）。 */
  useEffect(() => {
    const onRefresh = (): void => {
      void refresh()
    }
    window.addEventListener('mozhou:telemetry-refresh', onRefresh)
    return () => window.removeEventListener('mozhou:telemetry-refresh', onRefresh)
  }, [refresh])

  return telemetry
}
