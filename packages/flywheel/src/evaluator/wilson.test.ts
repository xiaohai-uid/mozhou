/**
 * Wilson 区间验收（T24 · #57；t53:C5 置信区间判据的机械性质断言）。
 * 零时钟零 IO：全部纯数值性质。
 */
import { describe, expect, it } from 'vitest';
import { wilsonInterval } from './wilson.js';

describe('wilsonInterval', () => {
  it('零样本返回全宽区间（不产生虚假精度）', () => {
    expect(wilsonInterval(0, 0)).toEqual([0, 1]);
  });

  it('区间包含点估计且端点有序', () => {
    const [lo, hi] = wilsonInterval(7, 20);
    expect(lo).toBeLessThan(7 / 20);
    expect(hi).toBeGreaterThan(7 / 20);
    expect(lo).toBeLessThanOrEqual(hi);
  });

  it('全败下界钳 0、全胜上界钳 1（不越 [0,1]）', () => {
    expect(wilsonInterval(0, 12)[0]).toBe(0);
    expect(wilsonInterval(12, 12)[1]).toBe(1);
    const [lo, hi] = wilsonInterval(3, 200);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1);
  });

  it('样本越大区间越窄（小样本高方差被压住的机制）', () => {
    const width = (k: number, n: number) => wilsonInterval(k, n)[1] - wilsonInterval(k, n)[0];
    expect(width(50, 100)).toBeLessThan(width(5, 10));
    expect(width(500, 1000)).toBeLessThan(width(50, 100));
  });

  it('同比例不同样本量：大样本下界更高（R3 分离判据的物理来源）', () => {
    expect(wilsonInterval(90, 100)[0]).toBeGreaterThan(wilsonInterval(9, 10)[0]);
  });

  it('脏输入不给 NaN：负数/非有限值按全宽处理', () => {
    expect(wilsonInterval(-1, 10)).toEqual([0, 1]);
    expect(wilsonInterval(Number.NaN, 10)).toEqual([0, 1]);
    expect(wilsonInterval(5, Number.POSITIVE_INFINITY)).toEqual([0, 1]);
  });
});
