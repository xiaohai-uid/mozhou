/**
 * 不变量：`@mozhou/quality-engine/de-ai` 必须能进浏览器包。
 *
 * 背景（工单 7）：包根 ./index.js 重导出 policy.ts（node:crypto）与
 * staleness.ts（node:fs），渲染进程导入即炸。所以浏览器侧改走子路径 ./de-ai。
 * 本测试把「子路径的静态导入闭包无 Node 依赖」变成可执行门禁——不靠人肉 review，
 * 也不靠「dist 恰好构建成功」这种一次性事实。
 *
 * 断言：
 *  1. 正向：src/de-ai.ts 的相对导入闭包内不得出现任何 Node 内置模块。
 *  2. 正向：闭包不得经 policy.ts / staleness.ts 回流到包根。
 *  3. 反向控制组（证明本测试有牙）：src/index.ts 闭包**必须**触达 node:crypto——
 *     否则说明包根已不再需要子路径，本测试会失败并提示重新评估。
 *  4. 接线：package.json exports 必须同时保留 "." 与 "./de-ai"，且 ./de-ai 指向
 *     与 src/de-ai.ts 同名的 dist 产物，杜绝「声明了子路径却没有源文件」的悬空接线。
 *
 * 解析纪律：不引入正则与外部依赖，只用纯字符串扫描（避免把源码文本喂给
 * 任何求值/命令通道），保证测试自身零副作用。
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(SRC_DIR, '..');

/** 逐字符剥离行注释与块注释（保留字符串字面量内容，以便后续提取说明符）。 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let inBlock = false;
  let inLine = false;
  let quote: string | null = null;
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (inBlock) {
      if (ch === '*' && next === '/') { inBlock = false; i += 2; continue; }
      i += 1;
      continue;
    }
    if (inLine) {
      if (ch === '\n') { inLine = false; out += ch; }
      i += 1;
      continue;
    }
    if (quote !== null) {
      out += ch;
      if (ch === '\\') { out += next ?? ''; i += 2; continue; }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') { inBlock = true; i += 2; continue; }
    if (ch === '/' && next === '/') { inLine = true; i += 2; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; out += ch; i += 1; continue; }
    out += ch;
    i += 1;
  }
  return out;
}

/** 取一行里 `from` 关键字之后、或裸 import 之后的第一个引号说明符。 */
function specifierOnLine(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  const fromAt = line.indexOf(' from ');
  const atBraceFrom = line.indexOf('} from ');
  const start = fromAt !== -1 ? fromAt : atBraceFrom !== -1 ? atBraceFrom : -1;
  let searchFrom = 0;
  if (start !== -1) {
    searchFrom = start + 1;
  } else if (trimmed.startsWith('import')) {
    searchFrom = 0;
  } else {
    return null;
  }
  const rest = line.slice(searchFrom);
  for (const quote of ["'", '"']) {
    const open = rest.indexOf(quote);
    if (open === -1) continue;
    const close = rest.indexOf(quote, open + 1);
    if (close === -1) continue;
    const spec = rest.slice(open + 1, close);
    return spec;
  }
  return null;
}

/** BFS 相对导入闭包，返回闭包内所有源文件的绝对路径。 */
function importClosure(entryAbsPath: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entryAbsPath];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const line of code.split('\n')) {
      const spec = specifierOnLine(line);
      if (spec === null || !spec.startsWith('.')) continue;
      // 源码按 NodeNext 纪律用 .js 说明符指向 .ts 源文件
      const target = resolve(dirname(file), spec.endsWith('.js') ? spec.slice(0, -3) + '.ts' : spec);
      if (existsSync(target)) queue.push(target);
    }
  }
  return seen;
}

/** 闭包内被 import 的 Node 内置模块说明符（node:* 与常见裸内置）。 */
const BARE_BUILTINS = ['fs', 'crypto', 'path', 'os', 'child_process', 'stream', 'util'];

function nodeBuiltinsInClosure(closure: Set<string>): string[] {
  const hits: string[] = [];
  for (const file of closure) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const line of code.split('\n')) {
      const spec = specifierOnLine(line);
      if (spec === null) continue;
      if (spec.startsWith('node:')) hits.push(file + ' -> ' + spec);
      else if (BARE_BUILTINS.includes(spec)) hits.push(file + ' -> ' + spec);
    }
  }
  return hits;
}

interface PkgExports {
  exports?: Record<string, { types?: string; default?: string }>;
}

function readPkg(): PkgExports {
  return JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8')) as PkgExports;
}

describe('@mozhou/quality-engine/de-ai 浏览器安全子路径', () => {
  it('正向：de-ai 入口的相对导入闭包不含任何 Node 内置模块', () => {
    const closure = importClosure(resolve(SRC_DIR, 'de-ai.ts'));
    expect(closure.size).toBeGreaterThan(0);
    expect(nodeBuiltinsInClosure(closure)).toEqual([]);
  });

  it('正向：de-ai 入口不得经 policy.ts / staleness.ts 回流到包根', () => {
    const closure = importClosure(resolve(SRC_DIR, 'de-ai.ts'));
    const names = [...closure].map((f) => basename(f));
    expect(names).not.toContain('policy.ts');
    expect(names).not.toContain('staleness.ts');
  });

  it('反向控制组：包根 index.ts 闭包必须触达 node:crypto（否则子路径已无必要）', () => {
    const hits = nodeBuiltinsInClosure(importClosure(resolve(SRC_DIR, 'index.ts')));
    expect(hits.some((h) => h.endsWith('-> node:crypto'))).toBe(true);
  });

  it('接线：exports["./de-ai"] 指向与 src/de-ai.ts 同名的 dist 产物', () => {
    const sub = readPkg().exports?.['./de-ai'];
    expect(sub).toBeDefined();
    expect(sub?.types).toBe('./dist/de-ai.d.ts');
    expect(sub?.default).toBe('./dist/de-ai.js');
    // 声明必须落到真实源文件——避免「只有 exports 没有 src」的假接线
    expect(existsSync(resolve(SRC_DIR, 'de-ai.ts'))).toBe(true);
  });

  it('接线：包根 "." 与 "./package.json" 保留（既有服务端导入不被 exports 收口破坏）', () => {
    const pkg = readPkg();
    expect(pkg.exports?.['.']?.default).toBe('./dist/index.js');
    expect(pkg.exports?.['.']?.types).toBe('./dist/index.d.ts');
    expect(pkg.exports?.['./package.json']).toBe('./package.json');
  });
});
