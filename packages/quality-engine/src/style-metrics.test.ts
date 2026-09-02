import { describe, expect, it } from 'vitest';
import { evaluateStyleMetrics } from './style-metrics.js';

describe('evaluateStyleMetrics', () => {
  it('handles empty text gracefully with default scores', () => {
    const res = evaluateStyleMetrics('');
    expect(res.charCount).toBe(0);
    expect(res.dialogueRatio).toBe(0);
    expect(res.sepiaNarrativeScore.pass1NarrativeArchitecture).toBe(100);
    expect(res.sepiaNarrativeScore.aiTellsCount).toBe(0);
  });

  it('calculates dialogue ratio and sentence pacing accurately', () => {
    const text = '“你到底是谁？”林玄拔剑而立，冷眼望去。白衣人一言不发，挥掌击落。';
    const res = evaluateStyleMetrics(text);
    expect(res.charCount).toBe(text.length);
    expect(res.dialogueRatio).toBeGreaterThan(0.1);
    expect(res.actionPacing).toBeGreaterThan(0.1);
    expect(res.sensoryDensity).toBeGreaterThan(0.1);
  });

  it('detects AI tells and reduces sepia pass scores accordingly', () => {
    const aiText = `
      他深吸了一口气，心跳剧烈加速。
      不仅如此，而且值得注意的是，显而易见总而言之。
      难道这一切都是宿命吗？
      究竟是谁在操纵因果？
      这一刻，他终于懂了生命的意义，明白了一个道理。
    `;
    const res = evaluateStyleMetrics(aiText);
    expect(res.sepiaNarrativeScore.aiTellsCount).toBeGreaterThan(0);
    expect(res.sepiaNarrativeScore.pass1NarrativeArchitecture).toBeLessThan(100);
    expect(res.sepiaNarrativeScore.pass2DiscourseFlow).toBeLessThan(100);
    expect(res.sepiaNarrativeScore.pass3SurfacePurity).toBeLessThan(100);
    expect(res.sepiaNarrativeScore.aiTellsSummary.length).toBeGreaterThanOrEqual(3);
  });
});
