/**
 * EditorQualityTelemetry 组件回归 + 浏览器安全接线门禁（工单 7）。
 *
 * 覆盖：
 * - happy path：字数/段落/复读/Tier1/Tier2 来自真实计算，非示例值；
 * - 失败路径 1：AI 腔调正文 → Tier1 > 0 且徽章转「待净化」，isClean 为假；
 * - 失败路径 2：4-gram 复读但 De-AI 满分 → 复合 isClean 仍为假（复合量词不塌缩为分数）；
 * - 边界：空/纯空白正文 → 全零指标 + 满分纯净，不产生 NaN；
 * - 不变量：whitelistWords 贯通到引擎（Tier2 聚集被白名单压制）；
 * - 接线门禁：本组件必须走 @mozhou/quality-engine/de-ai 子路径，禁止回退包根
 *   （包根携 node:crypto/node:fs，会让渲染进程 bundle 直接炸）。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
// 解析证明：dist/de-ai.js 不存在时本文件在收集阶段即失败——与生产构建同一条解析路径
import { runDeAiDiagnostics } from '@mozhou/quality-engine/de-ai';
import { EditorQualityTelemetry } from './EditorQualityTelemetry';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPONENT_SRC = resolve(HERE, 'EditorQualityTelemetry.tsx');

/** 供断言用的真实引擎结果——测试的期望值不靠手抄常量。 */
function report(text: string, whitelist: readonly string[] = []) {
  return runDeAiDiagnostics(text, whitelist);
}

const PLAIN = '夜幕降临。\n海港的钟声回荡。';
const AI_TONE = '恐惧瞬间吞噬了他的理智。';
const TIER2_CROWDED =
  '他抬起头，仿佛看见了什么，仿佛又什么都没看见，仿佛这一切早已注定，仿佛时间在此凝固不动，仿佛潮水退去后留下的只有空壳。';
const REPEATED = '潮水退去潮水退去潮水退去';

function bar() {
  return screen.getByTestId('editor-quality-telemetry');
}

describe('EditorQualityTelemetry（真实指标）', () => {
  it('happy path：中文正文按字/段统计，De-AI 满分且标记为纯净', () => {
    const expected = report(PLAIN);
    render(<EditorQualityTelemetry content={PLAIN} />);

    const text = bar().textContent ?? '';
    expect(text).toContain('字数');
    expect(text).toContain('11'); // 夜幕降临(4) + 海港的钟声回荡(7)
    expect(text).toContain('段落');
    expect(text).toContain('2');
    expect(text).toContain('4-gram 复读');
    expect(text).toContain(`De-AI 正典纯净 (${expected.score}分)`);
    expect(expected.clean).toBe(true);
  });

  it('失败路径：AI 腔调正文 → Tier1 计数上屏且徽章转「待净化」', () => {
    const expected = report(AI_TONE);
    expect(expected.tier1Count).toBe(1); // 前置条件：夹具确实命中 Tier 1
    render(<EditorQualityTelemetry content={AI_TONE} />);

    const text = bar().textContent ?? '';
    expect(text).toContain('Tier 1 必阻断');
    expect(text).toContain('1');
    expect(text).toContain(`AI 腔调待净化 (${expected.score}分)`);
    expect(text).not.toContain('正典纯净');
  });

  it('失败路径：4-gram 复读但 De-AI 满分 → 复合 isClean 仍为假（不被分数掩盖）', () => {
    expect(report(REPEATED).score).toBe(100); // De-AI 看不到复读，分数满分
    render(<EditorQualityTelemetry content={REPEATED} />);

    const text = bar().textContent ?? '';
    expect(text).toContain('4-gram 复读');
    expect(text).toContain('1'); // 滑窗第三次命中同一 4-gram
    // 分数满分但复读未清零 → 必须仍显示待净化，不得用 100 分冒充纯净
    expect(text).toContain('AI 腔调待净化 (100分)');
    expect(text).not.toContain('正典纯净');
  });

  it('边界：空/纯空白正文 → 全零指标 + 满分纯净，不产生 NaN', () => {
    render(<EditorQualityTelemetry content="   \n  " />);

    const text = bar().textContent ?? '';
    expect(text).not.toContain('NaN');
    expect(text).toContain('0');
    expect(text).toContain('De-AI 正典纯净 (100分)');
  });

  it('不变量：whitelistWords 贯通到引擎——Tier2 聚集被白名单压制', () => {
    expect(report(TIER2_CROWDED).tier2Count).toBe(1); // 无白名单：段落聚集命中
    const { rerender } = render(<EditorQualityTelemetry content={TIER2_CROWDED} />);
    expect(bar().textContent ?? '').toContain('AI 腔调待净化');

    rerender(<EditorQualityTelemetry content={TIER2_CROWDED} whitelistWords={['仿佛']} />);
    const text = bar().textContent ?? '';
    expect(report(TIER2_CROWDED, ['仿佛']).tier2Count).toBe(0);
    expect(text).toContain('De-AI 正典纯净 (100分)');
  });
});

describe('EditorQualityTelemetry（浏览器安全接线门禁）', () => {
  it('必须从 @mozhou/quality-engine/de-ai 子路径导入，禁止回退包根', () => {
    const src = readFileSync(COMPONENT_SRC, 'utf8');
    const importLines = src
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('import '));
    const specs = importLines
      .map((l) => {
        const open = l.indexOf("'");
        const close = l.lastIndexOf("'");
        return open !== -1 && close > open ? l.slice(open + 1, close) : '';
      })
      .filter((s) => s.includes('@mozhou/quality-engine'));

    expect(specs).toEqual(['@mozhou/quality-engine/de-ai']);
    expect(specs).not.toContain('@mozhou/quality-engine');
  });
});
