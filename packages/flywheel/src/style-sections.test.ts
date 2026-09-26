/**
 * StyleProfile → compile 注入缝验收（T23 · #56；t51:B4）。
 *
 * 四场景型全注入（否决 top-2）、section 键冻结、≤800 token 硬断言、确定性输出。
 * 预算断言只认注入的精确计量器（token-budget-assembly-spec §3 禁估算器进预算路径）。
 */
import { describe, expect, it } from 'vitest';
import { seedStyleProfileRows } from '@mozhou/data-plane';
import {
  renderStyleSections,
  countStyleSectionsTokens,
  assertStyleSectionsWithinBudget,
  type StyleTokenCounter,
} from './style-sections.js';

/** 确定性测试替身：flywheel 不依赖 context-compiler，真实词表口径在
 *  apps/web/server/draftContext.test.ts 的集成用例里验证。 */
const fixedCounter = (tokens: number): StyleTokenCounter => ({ count: () => tokens });
const charCounter: StyleTokenCounter = { count: (text) => text.length };

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

  it('seed 画像渲染合计 ≤800 token 冻结断言不抛（真实词表口径见 apps/web 集成用例）', () => {
    const sections = renderStyleSections(seedStyleProfileRows());
    expect(countStyleSectionsTokens(sections, fixedCounter(100))).toBe(400);
    expect(() => assertStyleSectionsWithinBudget(sections, fixedCounter(100))).not.toThrow();
  });

  it('超限断言抛错：人为放大 content 触发 t51:B4 硬约束', () => {
    const sections = renderStyleSections(seedStyleProfileRows()).map((section) => ({
      ...section,
      content: section.content + 'x'.repeat(5000),
    }));
    expect(() => assertStyleSectionsWithinBudget(sections, charCounter)).toThrow(/exceed token budget/);
  });

  it('计量口径与 assemble 结构层一致：逐 section 计 content + "\\n"（assemble.ts renderPiece）', () => {
    const sections = renderStyleSections(seedStyleProfileRows());
    const seen: string[] = [];
    const recorder: StyleTokenCounter = {
      count: (text) => {
        seen.push(text);
        return 0;
      },
    };
    assertStyleSectionsWithinBudget(sections, recorder);
    expect(seen).toEqual(sections.map((section) => section.content + '\n'));
  });

  it('反回归：门只信注入计量器，绝不用字符数估算（token-budget-assembly-spec §3）', () => {
    // 每段 +5000 字符：若门退回 chars/1.5 估算（≈13334 token）必然抛错；
    // 精确计量器报 1 token/段则合计 4，应当放行——这就是估算器误杀生成的那类输入。
    const sections = renderStyleSections(seedStyleProfileRows()).map((section) => ({
      ...section,
      content: section.content + 'x'.repeat(5000),
    }));
    expect(() => assertStyleSectionsWithinBudget(sections, fixedCounter(1))).not.toThrow();
    expect(countStyleSectionsTokens(sections, fixedCounter(1))).toBe(4);
  });

  it('边界不变量：合计恰 800 放行，801 抛错（冻结上限，宁败不截断）', () => {
    const sections = renderStyleSections(seedStyleProfileRows());
    expect(() => assertStyleSectionsWithinBudget(sections, fixedCounter(200))).not.toThrow();
    expect(countStyleSectionsTokens(sections, fixedCounter(200))).toBe(800);
    expect(() => assertStyleSectionsWithinBudget(sections, fixedCounter(201))).toThrow(
      /804 > 800 \(t51:B4\)/,
    );
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
