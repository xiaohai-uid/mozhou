/**
 * StyleProfile → compile 注入缝验收（T23 · #56；t51:B4）。
 *
 * 四场景型全注入（否决 top-2）、section 键冻结、≤800 token 硬断言、确定性输出。
 */
import { describe, expect, it } from 'vitest';
import { seedStyleProfileRows } from '@mozhou/data-plane';
import {
  renderStyleSections,
  estimateStyleSectionsTokens,
  assertStyleSectionsWithinBudget,
} from './style-sections.js';

describe('renderStyleSections · 注入缝', () => {
  it('四场景型全注入（否决 top-2）：section 键冻结为 style_profile:<scenarioType>', () => {
    const sections = renderStyleSections(seedStyleProfileRows());
    expect(sections).toHaveLength(4);
    expect(sections.map((s) => s.section)).toEqual([
      'style_profile:action',
      'style_profile:dialogue',
      'style_profile:romance_emotion',
      'style_profile:exposition_worldbuilding',
    ]);
  });

  it('确定性：同输入两次渲染逐字节相等（Receipt 可复算）', () => {
    const a = renderStyleSections(seedStyleProfileRows());
    const b = renderStyleSections(seedStyleProfileRows());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('seed 画像渲染合计 ≤800 token 冻结断言不抛', () => {
    const sections = renderStyleSections(seedStyleProfileRows());
    expect(estimateStyleSectionsTokens(sections)).toBeLessThanOrEqual(800);
    expect(() => assertStyleSectionsWithinBudget(sections)).not.toThrow();
  });

  it('超限断言抛错：人为放大 content 触发 t51:B4 硬约束', () => {
    const sections = renderStyleSections(seedStyleProfileRows()).map((section) => ({
      ...section,
      content: section.content + 'x'.repeat(5000),
    }));
    expect(() => assertStyleSectionsWithinBudget(sections)).toThrow(/exceed token budget/);
  });

  it('内容携带 revision 与量化分面（消费侧可读可 diff）', () => {
    const sections = renderStyleSections(seedStyleProfileRows());
    const action = sections[0];
    expect(action?.content).toContain('# action StyleProfile v0');
    expect(action?.content).toContain('revision: 0');
    expect(action?.content).toContain('dialogueRatio: 0.300');
    expect(action?.content).toContain('sentenceBuckets:');
  });
});
