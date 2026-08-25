/**
 * T15 验收测试（#39）：①合法 recipe 全字段往返 ②每类 schema 违规至少一例拒载
 * ③retiredPaths 命中拒绝 ④双轨版本行为 ⑤触发表四型枚举 + quality_gate 回填试跑
 * （M14：解析快照可被 GenerationStarted 携带）。
 * 零时钟零外部服务：账本与配方文件落 hermetic 临时目录，无 sleep 无网络。
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PublishBus, readLedger } from '../eventBus.js';
import type { ResolutionSnapshot } from '../types.js';
import {
  loadRecipeById,
  loadRecipeFile,
  loadRecipeText,
  recipeFilePath,
  toGenerationStartedPayload,
  validateRecipeDocument,
} from './loader.js';
import { LOAD_CONDITION_TYPES, RecipeLoadError } from './types.js';
import type { CapabilityRecipeDocument } from './types.js';

const FIXTURE_PATH = fileURLToPath(
  new URL('./fixtures/quality-gate.recipe.yaml', import.meta.url),
);

const fixtureText = (): string => readFileSync(FIXTURE_PATH, 'utf8');

let cachedDoc: CapabilityRecipeDocument | undefined;
const fixtureDoc = (): CapabilityRecipeDocument => {
  if (!cachedDoc) cachedDoc = loadRecipeText(fixtureText());
  return cachedDoc;
};

/** 深可变克隆（JSON 往返），供违规用例做外科手术式改写。 */
type JsonObj = Record<string, unknown>;
const cloneDoc = (doc: CapabilityRecipeDocument): JsonObj =>
  JSON.parse(JSON.stringify(doc)) as JsonObj;
const partOf = (obj: JsonObj, key: string): JsonObj => obj[key] as JsonObj;
const recipeOf = (doc: JsonObj): JsonObj => partOf(doc, 'recipe');
const arrayOf = (obj: JsonObj, key: string): JsonObj[] => obj[key] as JsonObj[];

/** 统一断言：validate 抛 RecipeLoadError 且 code/报错字段路径命中。 */
function expectRejected(broken: unknown, code: string, fieldInMessage: string): void {
  let caught: unknown;
  try {
    validateRecipeDocument(broken);
    expect.unreachable('应拒载');
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(RecipeLoadError);
  const err = caught as RecipeLoadError;
  expect(err.code).toBe(code);
  expect(err.message).toContain(fieldInMessage);
}

describe('T15 · 合法 recipe 全字段往返（F1-F17 裁剪集全覆盖）', () => {
  it('fixture 经文本路加载成功且关键字段逐项就位', () => {
    const doc = fixtureDoc();
    expect(doc.schemaVersion).toBe(1);
    expect(doc.compatibilityPolicy).toBe('none');
    expect(doc.versioning.schemaVersionRule).toBe('incompatible-change-requires-major-reject');

    const r = doc.recipe;
    expect(r.id).toBe('quality-gate');
    expect(r.recipeVersion).toMatch(/^\d+\.\d+\.\d+$/);
    // F3 出处三件套：全 SHA 落库、MIT、pin oh-story v0.7.6
    expect(r.source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(r.source.repo).toContain('oh-story-claudecode');
    expect(r.source.license).toBe('MIT');
    expect(r.source.refinedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.source.refineNote.length).toBeGreaterThan(0);
    // F4 结构化拆分
    expect(r.brief.triggers.length).toBeGreaterThan(0);
    expect(r.brief.runtimeSemantics.length).toBeGreaterThan(0);
    // F12 七件套整槽
    expect(Object.keys(r.trackingGate).sort()).toEqual(
      [
        'authorityState',
        'budgets',
        'casField',
        'derivedViews',
        'failureTaxonomy',
        'hookPoint',
        'transactionModes',
      ],
    );
    // F16 容量预算
    expect(r.contextBudget.hotContextBytes).toBeGreaterThan(0);
    expect(r.prechecks.length).toBeGreaterThan(0);
  });

  it('JSON 序列化往返无损，往返对象再校验仍得同一文档', () => {
    const doc = fixtureDoc();
    const roundTripped: unknown = JSON.parse(JSON.stringify(doc));
    expect(roundTripped).toEqual(doc);
    expect(validateRecipeDocument(cloneDoc(doc))).toEqual(doc);
  });

  it('文件路与文本路装载结果一致', async () => {
    await expect(loadRecipeFile(FIXTURE_PATH)).resolves.toEqual(fixtureDoc());
  });
});

describe('T15 · 每类 schema 违规至少一例拒载', () => {
  const violations: {
    name: string;
    code: string;
    field: string;
    apply: (d: JsonObj) => void;
  }[] = [
    { name: '顶层未知键（additionalProperties 冻结）', code: 'RECIPE_SCHEMA_INVALID', field: '$', apply: (d) => { d['unknownTop'] = true; } },
    { name: '缺 schemaVersion', code: 'RECIPE_SCHEMA_INVALID', field: '$/schemaVersion', apply: (d) => { delete d['schemaVersion']; } },
    { name: '缺 contextBudget（F16 整槽必填）', code: 'RECIPE_SCHEMA_INVALID', field: '/recipe', apply: (d) => { delete recipeOf(d)['contextBudget']; } },
    { name: 'id 非 kebab-case（F1）', code: 'RECIPE_SCHEMA_INVALID', field: '/recipe/id', apply: (d) => { recipeOf(d)['id'] = 'Quality_Gate'; } },
    { name: 'recipeVersion 非 semver（F2）', code: 'RECIPE_SCHEMA_INVALID', field: '/recipe/recipeVersion', apply: (d) => { recipeOf(d)['recipeVersion'] = '1.0'; } },
    { name: 'commit 短 SHA（全 SHA 落库，短 SHA 仅展示）', code: 'RECIPE_SCHEMA_INVALID', field: '/recipe/source/commit', apply: (d) => { partOf(recipeOf(d), 'source')['commit'] = '9d0bd5f'; } },
    { name: 'license 词表越界', code: 'RECIPE_SCHEMA_INVALID', field: '/recipe/source/license', apply: (d) => { partOf(recipeOf(d), 'source')['license'] = 'Apache-2.0'; } },
    { name: 'refinedAt 非 ISO 日期', code: 'RECIPE_SCHEMA_INVALID', field: '/recipe/source/refinedAt', apply: (d) => { partOf(recipeOf(d), 'source')['refinedAt'] = '2026/08/24'; } },
    { name: '触发表出现第五型（四型枚举外）', code: 'RECIPE_SCHEMA_INVALID', field: '/recipe/references/0/loadCondition/type', apply: (d) => { (arrayOf(recipeOf(d), 'references')[0] as JsonObj)['loadCondition'] = { type: 'manual', value: 'judge' }; } },
    { name: 'failure.policy 词表越界（R4=A 条目化枚举）', code: 'RECIPE_SCHEMA_INVALID', field: '/recipe/references/0/failure/policy', apply: (d) => { partOf(arrayOf(recipeOf(d), 'references')[0] as JsonObj, 'failure')['policy'] = 'retry'; } },
    { name: 'policy=repair 缺 repairAction（if/then 条件必填）', code: 'RECIPE_SCHEMA_INVALID', field: '/repairAction', apply: (d) => { const f = partOf(arrayOf(recipeOf(d), 'references')[1] as JsonObj, 'failure'); f['policy'] = 'repair'; delete f['repairAction']; } },
    { name: 'precheck severityPolicy 越界（F11）', code: 'RECIPE_SCHEMA_INVALID', field: '/recipe/prechecks/0/severityPolicy', apply: (d) => { (arrayOf(recipeOf(d), 'prechecks')[0] as JsonObj)['severityPolicy'] = 'fatal'; } },
    { name: 'maxBlockingRetries 非整数', code: 'RECIPE_SCHEMA_INVALID', field: '/recipe/prechecks/0/retryPolicy/maxBlockingRetries', apply: (d) => { partOf(arrayOf(recipeOf(d), 'prechecks')[0] as JsonObj, 'retryPolicy')['maxBlockingRetries'] = 1.5; } },
    { name: 'hookPoint 词表越界（F12 七件套内枚举）', code: 'RECIPE_SCHEMA_INVALID', field: '/recipe/trackingGate/hookPoint', apply: (d) => { partOf(recipeOf(d), 'trackingGate')['hookPoint'] = 'duringWrite'; } },
    { name: 'failureTaxonomy 词表越界（失败三分法）', code: 'RECIPE_SCHEMA_INVALID', field: '/recipe/trackingGate/failureTaxonomy', apply: (d) => { partOf(recipeOf(d), 'trackingGate')['failureTaxonomy'] = 'mystery'; } },
    { name: 'sizeBudget.target 非正整数（F8）', code: 'RECIPE_SCHEMA_INVALID', field: '/recipe/artifacts/0/sizeBudget/target', apply: (d) => { partOf(arrayOf(recipeOf(d), 'artifacts')[0] as JsonObj, 'sizeBudget')['target'] = 0; } },
    { name: 'contextBudget.hotContextBytes 非正整数（F16）', code: 'RECIPE_SCHEMA_INVALID', field: '/recipe/contextBudget/hotContextBytes', apply: (d) => { partOf(recipeOf(d), 'contextBudget')['hotContextBytes'] = -5; } },
    { name: 'transactionModes 空数组（七件套 minItems）', code: 'RECIPE_SCHEMA_INVALID', field: '/recipe/trackingGate/transactionModes', apply: (d) => { partOf(recipeOf(d), 'trackingGate')['transactionModes'] = []; } },
    { name: 'derivedViews 条目缺 path', code: 'RECIPE_SCHEMA_INVALID', field: '/recipe/trackingGate/derivedViews/0/path', apply: (d) => { delete (arrayOf(partOf(recipeOf(d), 'trackingGate'), 'derivedViews')[0] as JsonObj)['path']; } },
    { name: 'sizeBudget target>max（draft-07 表达不了，语义层兜住）', code: 'RECIPE_SEMANTIC_INVALID', field: '$.recipe.artifacts[0].sizeBudget', apply: (d) => { partOf(arrayOf(recipeOf(d), 'artifacts')[0] as JsonObj, 'sizeBudget')['target'] = 999999; } },
  ];

  for (const v of violations) {
    it(`拒载：${v.name}`, () => {
      const broken = cloneDoc(fixtureDoc());
      v.apply(broken);
      expectRejected(broken, v.code, v.field);
    });
  }

  it('YAML 解析失败与根非映射各拒一例（PARSE_FAILED）', () => {
    expect(() => loadRecipeText('key: [unclosed')).toThrowError(RecipeLoadError);
    try {
      loadRecipeText('42');
      expect.unreachable('应拒载');
    } catch (e) {
      expect((e as RecipeLoadError).code).toBe('RECIPE_PARSE_FAILED');
    }
  });
});

describe('T15 · retiredPaths 命中拒绝（R7=A 显式退役声明）', () => {
  const retired = 'skills/quality-gate/checklist.md';

  it('references[].path 命中即拒，报错同时含退役路径与字段位置', () => {
    const d = cloneDoc(fixtureDoc());
    (arrayOf(recipeOf(d), 'references')[3] as JsonObj)['path'] = retired;
    let caught: unknown;
    try {
      validateRecipeDocument(d);
      expect.unreachable('应拒载');
    } catch (e) {
      caught = e;
    }
    const err = caught as RecipeLoadError;
    expect(err.code).toBe('RETIRED_PATH_HIT');
    expect(err.message).toContain(retired);
    expect(err.message).toContain('$.recipe.references[3].path');
  });

  it.each([
    ['artifacts[].path', (d: JsonObj) => { (arrayOf(recipeOf(d), 'artifacts')[0] as JsonObj)['path'] = retired; }],
    ['prechecks[].script', (d: JsonObj) => { (arrayOf(recipeOf(d), 'prechecks')[0] as JsonObj)['script'] = retired; }],
    ['entry.routerDoc', (d: JsonObj) => { partOf(recipeOf(d), 'entry')['routerDoc'] = retired; }],
    ['trackingGate.authorityState', (d: JsonObj) => { partOf(recipeOf(d), 'trackingGate')['authorityState'] = retired; }],
    ['trackingGate.derivedViews[].path', (d: JsonObj) => { (arrayOf(partOf(recipeOf(d), 'trackingGate'), 'derivedViews')[0] as JsonObj)['path'] = retired; }],
  ])('%s 命中即拒', (_label, apply) => {
    const d = cloneDoc(fixtureDoc());
    apply(d);
    expectRejected(d, 'RETIRED_PATH_HIT', retired);
  });

  it('未命中退役表的同形路径放行（控制组）', () => {
    const d = cloneDoc(fixtureDoc());
    (arrayOf(recipeOf(d), 'references')[3] as JsonObj)['path'] = `${retired}.bak`;
    expect(() => validateRecipeDocument(d)).not.toThrow();
  });
});

describe('T15 · 双轨版本行为（schemaVersion × recipeVersion，R7/R8=A）', () => {
  it('schemaVersion 不认识直接拒（零兼容承诺：不解析、无迁移）', () => {
    const d = cloneDoc(fixtureDoc());
    d['schemaVersion'] = 2;
    expectRejected(d, 'RECIPE_SCHEMA_UNSUPPORTED_VERSION', 'schemaVersion=2');
  });

  it('schemaVersion 类型不符同判不认识（拒载优先于结构探测）', () => {
    const d = cloneDoc(fixtureDoc());
    d['schemaVersion'] = '1';
    expectRejected(d, 'RECIPE_SCHEMA_UNSUPPORTED_VERSION', '"1"');
  });

  it('recipeVersion 自由演进：schemaVersion=1 下升到 3.2.1 照常通过（双轨独立）', () => {
    const d = cloneDoc(fixtureDoc());
    recipeOf(d)['recipeVersion'] = '3.2.1';
    const doc = validateRecipeDocument(d);
    expect(doc.recipe.recipeVersion).toBe('3.2.1');
    expect(doc.schemaVersion).toBe(1);
  });
});

describe('T15 · 触发表静态四型枚举（F7+R3=A）', () => {
  const values: Record<string, string> = { phase: 'judge', input: 'genre', fallback: 'markers 未命中时', always: '' };

  for (const t of LOAD_CONDITION_TYPES) {
    it(`${t} 型合法（value=${t === 'always' ? '空串哨兵' : '非空'}）`, () => {
      const d = cloneDoc(fixtureDoc());
      ;(arrayOf(recipeOf(d), 'references')[0] as JsonObj)['loadCondition'] = {
        type: t,
        value: values[t],
      };
      const doc = validateRecipeDocument(d);
      expect(doc.recipe.references[0]?.loadCondition.type).toBe(t);
    });
  }

  it('四型在 fixture 中各出现一次（静态触发表全型可用）', () => {
    const types = fixtureDoc().recipe.references.map((ref) => ref.loadCondition.type);
    expect([...types].sort()).toEqual([...LOAD_CONDITION_TYPES].sort());
  });

  it('非 always 型给空串 value 拒载（取值纪律）', () => {
    const d = cloneDoc(fixtureDoc());
    ;(arrayOf(recipeOf(d), 'references')[0] as JsonObj)['loadCondition'] = { type: 'input', value: '' };
    expectRejected(d, 'RECIPE_SCHEMA_INVALID', '/recipe/references/0/loadCondition/value');
  });

  it('loadCondition 缺 value 字段拒载（整槽必填）', () => {
    const d = cloneDoc(fixtureDoc());
    ;(arrayOf(recipeOf(d), 'references')[0] as JsonObj)['loadCondition'] = { type: 'phase' };
    expectRejected(d, 'RECIPE_SCHEMA_INVALID', '/recipe/references/0/loadCondition/value');
  });
});

describe('T15 · quality_gate 回填试跑：解析快照被 GenerationStarted 携带（M14 接缝）', () => {
  function hermeticRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'mozhou-t15-'));
    mkdirSync(join(root, '.mozhou'), { recursive: true });
    return root;
  }

  it('payload={snapshot, recipeSnapshot} 发布进真实账本，回读深等原解析快照且配对闭合', () => {
    const doc = fixtureDoc();
    const bus = new PublishBus();
    const ctx = { root: hermeticRoot() };

    const snapshot: ResolutionSnapshot = {
      taskType: doc.recipe.taskType,
      capability: doc.recipe.taskType,
      providerId: 'deepseek-primary',
      providerVersion: '1.0.0',
    };
    // 与 engine.execute 同槽共存形态：ResolutionSnapshot + 配方解析快照共用一个 GenerationStarted
    bus.publish(ctx, {
      type: 'GenerationStarted',
      taskRef: 't-quality-gate-1',
      chapterIndex: 7,
      payload: { snapshot, ...toGenerationStartedPayload(doc) },
    });
    bus.publish(ctx, {
      type: 'GenerationFinished',
      taskRef: 't-quality-gate-1',
      chapterIndex: 7,
      payload: { outcome: 'succeeded' },
    });

    const lines = readLedger(ctx);
    expect(lines).toHaveLength(2);
    const started = lines[0]?.event;
    expect(started?.type).toBe('GenerationStarted');
    expect(started?.payload?.['snapshot']).toEqual(snapshot);
    expect(started?.payload?.['recipeSnapshot']).toEqual(doc);
    // 配对纪律未破：head 已被 tail 闭合
    expect(bus.openHeadKeys()).toEqual([]);
  });

  it('携带物是纯 JSON：账本文件原文反序列化后仍深等于解析快照', () => {
    const doc = fixtureDoc();
    const bus = new PublishBus();
    const ctx = { root: hermeticRoot() };
    bus.publish(ctx, {
      type: 'GenerationStarted',
      taskRef: 't-quality-gate-2',
      payload: toGenerationStartedPayload(doc),
    });
    const rawLine = readFileSync(join(ctx.root, '.mozhou', 'events.jsonl'), 'utf8').trim();
    const stored = JSON.parse(rawLine) as { event: { payload?: Record<string, unknown> } };
    expect(stored.event.payload?.['recipeSnapshot']).toEqual(doc);
  });
});

describe('T15 · 约定存放位装载（<baseDir>/<id>.recipe.yaml）', () => {
  it('loadRecipeById 按约定文件名装载成功', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'mozhou-recipes-'));
    writeFileSync(join(baseDir, 'quality-gate.recipe.yaml'), fixtureText(), 'utf8');
    await expect(loadRecipeById(baseDir, 'quality-gate')).resolves.toEqual(fixtureDoc());
  });

  it('约定路径拼装：baseDir + id + .recipe.yaml', () => {
    expect(recipeFilePath('/somewhere/recipes', 'quality-gate')).toBe(
      '/somewhere/recipes/quality-gate.recipe.yaml',
    );
  });

  it('不存在的配方 id ⇒ RECIPE_FILE_UNREADABLE', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'mozhou-recipes-'));
    mkdirSync(baseDir, { recursive: true });
    await expect(loadRecipeById(baseDir, 'nope')).rejects.toMatchObject({
      code: 'RECIPE_FILE_UNREADABLE',
    });
  });
});
