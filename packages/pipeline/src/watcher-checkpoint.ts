/**
 * S10 watcher × S3 写前校验交互（T19 · #43）：管线在步边界检查点响应
 * EXTERNAL_MODIFIED——挂起（抛 CheckpointSuspendedError），步内不打断（避免
 * 半步状态 × 对账叠加）；整条管线的对账软门禁 = 警告不硬阻塞（pass-through）。
 *
 * 检测底座复用 data-plane 启动必检的 verifyBaseline()（盘上现状 vs 哈希基线，
 * mtime/尺寸预筛 + SHA-256 复核同一实现），并按 S2 分面取 reconcileSurface：
 * 只有 phase=committed 的正文章修改（含全部缺失——文件没了无法读相位，保守
 * 入面）构成对账面；phase=draft 正文章的自由改动豁免（draftFreeEdits）。
 *
 * 步边界纪律：guardedPipelineStep 只在【入界】检查一次——出边界由下一步的入
 * 边界承担，因此步内发生的外部改动绝不打断本步；检查点每次经 LocalDataPlane.open
 * 重开平面句柄（同步盘上最新基线，长持句柄不跨步）。
 */
import { LocalDataPlane } from '@mozhou/data-plane';
import type { BaselineReport } from '@mozhou/data-plane';

/** 步边界对账面非空：EXTERNAL_MODIFIED 挂起（编排方捕获后走恢复/作者确认面）。 */
export class CheckpointSuspendedError extends Error {
  override readonly name = 'CheckpointSuspendedError';

  constructor(readonly chapterIndex: number, readonly reconcileSurface: readonly string[]) {
    super(
      'step boundary checkpoint suspended: EXTERNAL_MODIFIED on chapter ' +
        chapterIndex +
        ' reconciliation surface [' +
        reconcileSurface.join(', ') +
        '] — resolve or dismiss before the next pipeline step',
    );
  }
}

/** 软门禁警告：对账面逐文件折算，调用方自行决定上报/展示（永不硬阻塞）。 */
export interface ReconciliationWarning {
  readonly relPath: string;
  readonly kind: 'external_modified' | 'missing';
}

function verifyAtBoundary(root: string): BaselineReport {
  // 每次检查点重开平面句柄：open() 第一步即 recoverPendingCommit，随后以最新
  // 基线做盘上核对——崩溃窗口与外部改动在同一道门里被看见。
  return LocalDataPlane.open(root).verifyBaseline();
}

/**
 * 步边界检查点：本章对账面非空即挂起（EXTERNAL_MODIFIED 只在步边界响应）。
 * 纯读判定——挂起本身零盘面副作用。
 */
export function stepBoundaryCheckpoint(root: string, chapterIndex: number): void {
  const surface = verifyAtBoundary(root).reconcileSurface;
  if (surface.length > 0) {
    throw new CheckpointSuspendedError(chapterIndex, surface);
  }
}

/**
 * 带步边界检查点的管线步执行：入界检查通过后整步原子执行，步内不打断；
 * 出边界的对账由下一步的入界检查承担。同步/异步步函数皆可。
 */
export async function guardedPipelineStep<T>(
  root: string,
  chapterIndex: number,
  step: () => T | Promise<T>,
): Promise<T> {
  stepBoundaryCheckpoint(root, chapterIndex);
  return await step();
}

/**
 * 整条管线的对账软门禁（pass-through）：把对账面折算为警告返回，永不抛——
 * 「警告不硬阻塞」适用于全管线；硬挂起语义只在显式的 stepBoundaryCheckpoint。
 */
export function pipelineReconciliationGate(root: string): readonly ReconciliationWarning[] {
  // 只从对账面派生（S2 分面：draft 自由改豁免不入面）；缺失文件无法读相位，
  // 一律保守按 kind='missing' 上报。
  const report = verifyAtBoundary(root);
  const missing = new Set(report.missing);
  return report.reconcileSurface.map((relPath) => ({
    relPath,
    kind: missing.has(relPath) ? ('missing' as const) : ('external_modified' as const),
  }));
}

