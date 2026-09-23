/**
 * Wilson score 区间（T24 · #57；t53:C5 防过拟合四件套之置信区间判据）。
 *
 * 纯函数零时钟零 IO：小样本高方差天然给出更宽区间，裸均值比较的假优势被压住。
 * 无样本返回全宽 [0,1]——不产生虚假精度（宁宽不猜）。
 */
import { WILSON_Z_95 } from './types.js';

/** Wilson 95% 区间：successes/total ∈ [0,1]，越界输入钳制处理（脏输入不给 NaN）。 */
export function wilsonInterval(
  successes: number,
  total: number,
  z: number = WILSON_Z_95,
): [number, number] {
  if (!Number.isFinite(successes) || !Number.isFinite(total) || successes < 0 || total <= 0) {
    return [0, 1];
  }
  const n = Math.max(0, total);
  const k = Math.min(Math.max(0, successes), n);
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}
