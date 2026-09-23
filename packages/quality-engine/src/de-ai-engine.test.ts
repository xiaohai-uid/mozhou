import { describe, expect, it } from 'vitest';
import { runDeAiDiagnostics } from './de-ai-engine.js';

describe('De-AI 工业级引擎 v2.0 判定契约', () => {
  it('干净地道的网文正文评分为 100 且 0 违规', () => {
    const text = '秦三抓起一把石灰，撒在供桌脚边。夜风穿堂而过，吹得窗纸噗噗作响。他靠着门槛坐下，喝了一口凉茶。';
    const report = runDeAiDiagnostics(text);
    expect(report.clean).toBe(true);
    expect(report.score).toBe(100);
    expect(report.findings).toHaveLength(0);
  });

  it('命中 Tier 1 假主语与抽象概念拟人化时触发阻断', () => {
    const text = '无尽的恐惧瞬间吞噬了他的心智，让他动弹不得。';
    const report = runDeAiDiagnostics(text);
    expect(report.clean).toBe(false);
    expect(report.tier1Count).toBeGreaterThanOrEqual(1);
    expect(report.findings[0]?.category).toBe('假主语/抽象概念拟人化');
  });

  it('命中 Tier 1 否定铺垫肯定翻转时触发阻断', () => {
    const text = '他不是在逃跑，而是为了诱敌深入。';
    const report = runDeAiDiagnostics(text);
    expect(report.clean).toBe(false);
    expect(report.tier1Count).toBeGreaterThanOrEqual(1);
    expect(report.findings[0]?.category).toBe('否定铺垫肯定翻转');
  });

  it('单段内 Tier 2 词汇聚集超过阈值时触发黄色预警', () => {
    const shortPara = '然而他深吸了一口气，仿佛察觉到了什么，与此同时脚步停了下来。';
    const report = runDeAiDiagnostics(shortPara);
    expect(report.tier2Count).toBeGreaterThanOrEqual(1);
  });

  it('引号内对白自动豁免保护', () => {
    const dialogue = '他推开门冷笑道：“这不是在逃跑，而是引蛇出洞，懂吗？”随后转身离开。';
    const report = runDeAiDiagnostics(dialogue);
    // 引号内的“不是…而是”应被放行
    expect(report.tier1Count).toBe(0);
  });

  it('白名单词汇精准放行', () => {
    const text = '恐惧吞噬了四周的阴兵。';
    const report = runDeAiDiagnostics(text, ['恐惧吞噬']);
    expect(report.tier1Count).toBe(0);
  });
});
