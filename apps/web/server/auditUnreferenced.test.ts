/**
 * 零引用体检工具的判据测试。
 *
 * 这三个用例就是本工具开发时真实栽过的三次误判，全部表现为「把死代码数高估」：
 *   1. 局部闭包：只被父函数使用，图谱不建节点 → 不能报成死代码；
 *   2. JSX 组件：被 JSX 引用不产生 CALLS 边 → 不能报成死代码；
 *   3. 装配点不在 src/ 下（apps/web/server/api.ts）→ 任何按路径前缀的过滤都会漏它。
 * 固化成断言，避免下一次有人再用图谱直接下「零引用」结论。
 */

import { describe, expect, it } from 'vitest';
import { classify } from '../../../scripts/audit-unreferenced.mjs';

// 构造「文件名 -> 出现次数」表，模拟工具读到的语料。
function counts(entries: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(entries));
}

describe('audit-unreferenced · classify', () => {
  it('局部闭包：定义 + 同文件再出现一次 ⇒ local-closure，不是死代码', () => {
    // crawl4ai.ts 的 onData 就是这个形状：定义在函数体内，被同一个函数引用。
    expect(classify('onData', 'a.ts', counts({ 'a.ts': 2 }))).toBe('local-closure');
  });

  it('同文件出现 3 次以上仍算局部闭包（多分支共用同一个闭包）', () => {
    expect(classify('timer', 'a.ts', counts({ 'a.ts': 3, 'b.ts': 1 }))).toBe('local-closure');
  });

  it('JSX 组件：只有定义处出现一次、别处没有 ⇒ unreferenced（真零引用）', () => {
    // 注意与下一条对照：JSX 组件一旦被真正引用，出现的文件是 .tsx，仍按生产计。
    expect(classify('PublicSite', 'a.tsx', counts({ 'a.tsx': 1 }))).toBe('unreferenced');
  });

  it('组件被 .tsx 生产文件引用 ⇒ used-in-prod（图谱误报，要保留）', () => {
    // 误报第 1 类：JSX 引用不产生 CALLS 边，但源码里确实出现了名字。
    expect(classify('StoryboardView', 'a.tsx', counts({ 'a.tsx': 1, 'App.tsx': 1 }))).toBe('used-in-prod');
  });

  it('装配点不在 src/ 下也算生产引用（误报第 3 类：按路径前缀过滤会漏）', () => {
    // apps/web/server/api.ts 不含 'src/'，任何 `*src/*` 过滤都会把它漏掉，
    // 于是 16 个路由工厂会被误判成零引用。
    expect(
      classify('proseRoutes', 'routes/proseRoutes.ts', counts({
        'routes/proseRoutes.ts': 1,
        'server/api.ts': 2,
      })),
    ).toBe('used-in-prod');
  });

  it('只有测试引用 ⇒ test-only（保留，规则 21 禁止因无生产引用就删）', () => {
    expect(classify('foo', 'a.ts', counts({ 'a.ts': 1, 'a.test.ts': 3 }))).toBe('test-only');
  });

  it('定义文件不在语料里（文件被删/移走）⇒ file-missing，单独报出让人来看', () => {
    // 绝不能归入 local-closure：那会被读成「没事，保留」，从而静默藏住一个坏引用。
    expect(classify('gone', 'deleted.ts', counts({ 'other.ts': 0 }))).toBe('file-missing');
  });
})