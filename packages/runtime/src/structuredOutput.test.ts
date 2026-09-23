/**
 * structuredOutput 包装器测试——json_schema 通过与违反两路 + 组合器编排。
 * 引擎侧接驳：RecoverableError(repairHint) 由既有 attempts 循环承接为 failed_recoverable。
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// ajv@8 在 NodeNext+verbatimModuleSyntax 下默认导出类型有互操作歧义，
// 用 createRequire 取 CJS 面并手写最小结构约束。
const require = createRequire(import.meta.url);
interface MinimalAjv {
  validate(schema: unknown, data: unknown): boolean;
  errors?: Array<{ instancePath: string; keyword?: string; message?: string; params?: Record<string, unknown> }> | null;
}
const AjvCtor = require('ajv') as new (opts?: Record<string, unknown>) => MinimalAjv;
import { RuntimeEngine, RecoverableError, type ProviderBinding } from './engine.js';
import { makeStructuredBinding, validateWithSchema } from './structuredOutput.js';
import { PublishBus } from './eventBus.js';
import { CapabilityRegistry } from './registry.js';

const ajv = new AjvCtor({ allErrors: false });

const CHAPTER_SCHEMA = {
  type: 'object',
  required: ['title', 'paragraphs'],
  properties: {
    title: { type: 'string' },
    paragraphs: { type: 'array', items: { type: 'string' }, minItems: 1 },
    mood: { type: 'string', enum: ['tense', 'calm'] },
  },
} as const;

describe('validateWithSchema', () => {
  it('通过路：合规对象原样返回', () => {
    const value = { title: '第一章', paragraphs: ['开篇'], mood: 'calm' };
    expect(validateWithSchema(ajv, CHAPTER_SCHEMA, value)).toBe(value);
  });

  it('违反路·缺必填：RecoverableError 携带 repairHint 定位到缺失字段本身', () => {
    try {
      validateWithSchema(ajv, CHAPTER_SCHEMA, { title: '第一章' });
      expect.unreachable('应抛 RecoverableError');
    } catch (e) {
      expect(e).toBeInstanceOf(RecoverableError);
      const err = e as RecoverableError;
      expect(err.repairHint).toEqual({
        field: '$/paragraphs',
        expected: 'required（缺失必填字段）',
      });
      expect(err.message).toContain('$/paragraphs');
    }
  });

  it('违反路·类型不符：repairHint.expected 给出期望类型名', () => {
    try {
      validateWithSchema(ajv, CHAPTER_SCHEMA, { title: 42, paragraphs: ['x'] });
      expect.unreachable('应抛 RecoverableError');
    } catch (e) {
      const hint = (e as RecoverableError).repairHint as { field: string; expected: string };
      expect(hint.field).toBe('/title');
      expect(hint.expected).toBe('type=string');
    }
  });

  it('违反路·枚举越界：expected 列出允许值', () => {
    try {
      validateWithSchema(ajv, CHAPTER_SCHEMA, { title: 't', paragraphs: ['p'], mood: 'epic' });
      expect.unreachable('应抛 RecoverableError');
    } catch (e) {
      const hint = (e as RecoverableError).repairHint as { expected: string };
      expect(hint.expected).toContain('enum=');
      expect(hint.expected).toContain('tense');
    }
  });
});

describe('makeStructuredBinding 组合器', () => {
  it('无 outputSchema ⇒ 原样透传，不做校验', async () => {
    const raw: ProviderBinding = () => Promise.resolve({ anything: true });
    const wrapped = makeStructuredBinding(raw, undefined, ajv);
    await expect(wrapped({}, {} as never)).resolves.toEqual({ anything: true });
  });

  it('字符串 JSON 文本先 coerce 再校验：合法文本通过', async () => {
    const raw: ProviderBinding = () => Promise.resolve('{"title":"章一","paragraphs":["p1"]}');
    const wrapped = makeStructuredBinding(raw, { outputSchema: CHAPTER_SCHEMA }, ajv);
    await expect(wrapped({}, {} as never)).resolves.toEqual({
      title: '章一',
      paragraphs: ['p1'],
    });
  });

  it('坏 JSON 文本 ⇒ RecoverableError 指向根 $', async () => {
    const raw: ProviderBinding = () => Promise.resolve('{不是 json');
    const wrapped = makeStructuredBinding(raw, { outputSchema: CHAPTER_SCHEMA }, ajv);
    await expect(wrapped({}, {} as never)).rejects.toMatchObject({
      repairHint: { field: '$', expected: 'valid json' },
    });
  });

  it('schema 违反 ⇒ 抛 RecoverableError（引擎二级 attempt 的接入口）', async () => {
    const raw: ProviderBinding = () => Promise.resolve({ title: '章一' }); // 缺 paragraphs
    const wrapped = makeStructuredBinding(raw, { outputSchema: CHAPTER_SCHEMA }, ajv);
    await expect(wrapped({}, {} as never)).rejects.toBeInstanceOf(RecoverableError);
  });
});

describe('引擎接驳：包装 binding 穷尽 attempts ⇒ failed_recoverable 且携带 repairHint', () => {
  function freshEngine(binding: ProviderBinding): RuntimeEngine {
    const registry = new CapabilityRegistry();
    registry.registerCapability({
      taskType: 'chapter.generate',
      providerId: 'deepseek-main',
      providerVersion: '1.0.0',
      failurePolicy: { timeoutMs: 5000, fallbackProviderIds: [] },
    });
    const root = mkdtempSync(join(tmpdir(), 'mozhou-so-'));
    mkdirSync(join(root, '.mozhou'), { recursive: true });
    const engine = new RuntimeEngine({
      bus: new PublishBus(),
      ctx: { root },
      registry,
      newTaskRef: (() => {
        let n = 0;
        return () => `so_${String(++n).padStart(3, '0')}`;
      })(),
    });
    engine.registerProviderBinding(
      'deepseek-main',
      makeStructuredBinding(binding, { outputSchema: CHAPTER_SCHEMA }, ajv),
    );
    return engine;
  }

  it('二级 attempt 后仍违反 schema ⇒ outcome=failed_recoverable + repairHint 落 TaskResult', async () => {
    // RuntimeEngine 构造签名以 engine.ts 为准；此处若构造面不同由编译期暴露。
    const engine = freshEngine(() => Promise.resolve({ title: '只有标题' }));
    const result = await engine.execute('chapter.generate', {});
    expect(result.outcome).toBe('failed_recoverable');
    // T12 穷尽语义：末次业务 hint 与 triedProviders 合并
    expect(result.repairHint).toEqual({
      field: '$/paragraphs',
      expected: 'required（缺失必填字段）',
      triedProviders: ['deepseek-main'],
    });
  });
});
