/**
 * 建议确认核心的确定性测试（t53 附B 第 4 步）。
 *
 * 零网络、零真实模型、零环境依赖：全部用例只喂纯数据。
 * 最后一个用例把产出**真的**交给既有 `loadTierConfigFile` 复跑——
 * 「校验栏复用」不是注释里的承诺，而是这条断言在守。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadTierConfigFile, type TierConfigFile } from '@mozhou/runtime';
import { confirmRoutingSuggestion } from './confirm.js';
import { appendSuggestions, readSuggestions } from './storage.js';
import type { RoutingSuggestion } from './types.js';

const TASK = 'CHAPTER_DRAFTING';

/** 当前配置：两个 task_type、多 tier，其中一个叶子带 api_key_ref（用于验证归一化）。 */
function currentConfig(): TierConfigFile {
  return {
    routes: {
      [TASK]: {
        primary: { providerId: 'prov_a', model: 'model-a1' },
        secondary: { providerId: 'prov_b', model: 'model-b1', api_key_ref: 'LEGACY_KEY_REF' },
      },
      STORYBOARD: {
        primary: { providerId: 'prov_a', model: 'model-a2' },
      },
    },
    providers: {
      prov_a: { baseURL: 'https://a.example.invalid', apiKeyEnv: 'PROV_A_KEY' },
      prov_b: { baseURL: 'https://b.example.invalid', apiKeyEnv: 'PROV_B_KEY' },
      prov_c: { baseURL: 'https://c.example.invalid', apiKeyEnv: 'PROV_C_KEY' },
    },
  };
}

/** 造一条建议；缺省是「把 prov_a/model-a1 换成 prov_c/model-c1」的 promote。 */
function suggestion(overrides: Partial<RoutingSuggestion> = {}): RoutingSuggestion {
  const base: RoutingSuggestion = {
    suggestionId: 'sug_TEST',
    createdAtUtc: '2026-09-30T00:00:00.000Z',
    cell: { taskType: TASK, providerId: 'prov_a', model: 'model-a1', recipeVersion: 'v1' },
    kind: 'promote',
    proposedRoute: { providerId: 'prov_c', model: 'model-c1' },
    basis: {
      sampleSize: { decisions: 40, chapterWindows: 6 },
      challengerAcceptanceWilson: [0.5, 0.9],
      incumbentAcceptanceWilson: [0.1, 0.4],
      editRatioDeltaPct: 12.5,
      benchmarkGatePassed: true,
      matrixRowRef: 'matrix:v1:2026-09-01',
    },
    status: 'sufficient_sample',
  };
  return { ...base, ...overrides };
}

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const dir of TEMP_DIRS.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows 锁容忍 */
    }
  }
});

describe('confirmRoutingSuggestion · 成功路径', () => {
  it('promote：把 incumbent 叶子换成 proposed，且只动那一个 tier', () => {
    const current = currentConfig();
    const outcome = confirmRoutingSuggestion({ suggestion: suggestion(), current });

    expect(outcome.kind).toBe('applied');
    if (outcome.kind !== 'applied') return;

    expect(outcome.routes[TASK]?.primary).toEqual({ providerId: 'prov_c', model: 'model-c1' });
    // 同 task_type 的其他 tier 不动
    expect(outcome.routes[TASK]?.secondary).toEqual({
      providerId: 'prov_b',
      model: 'model-b1',
      api_key_ref: 'LEGACY_KEY_REF',
    });
    // 其他 task_type 不动
    expect(outcome.routes['STORYBOARD']).toEqual({ primary: { providerId: 'prov_a', model: 'model-a2' } });
    // providers 注册表不被本模块改动
    expect(current.providers['prov_c']).toEqual({ baseURL: 'https://c.example.invalid', apiKeyEnv: 'PROV_C_KEY' });

    expect(outcome.change).toEqual({
      taskType: TASK,
      tier: 'primary',
      from: { providerId: 'prov_a', model: 'model-a1' },
      to: { providerId: 'prov_c', model: 'model-c1' },
    });
  });

  it('产出叶子不带 api_key_ref —— 即使 incumbent 原本带（否则 web 入口会抛 API_KEY_REF_UNSUPPORTED）', () => {
    const current = currentConfig();
    const outcome = confirmRoutingSuggestion({
      suggestion: suggestion({
        cell: { taskType: TASK, providerId: 'prov_b', model: 'model-b1', recipeVersion: 'v1' },
      }),
      current,
    });

    expect(outcome.kind).toBe('applied');
    if (outcome.kind !== 'applied') return;
    expect(outcome.routes[TASK]?.secondary).toEqual({ providerId: 'prov_c', model: 'model-c1' });
    expect('api_key_ref' in (outcome.routes[TASK]?.secondary ?? {})).toBe(false);
  });

  it('纯函数：不修改传入的 current（不可变）', () => {
    const current = currentConfig();
    const before = JSON.stringify(current);
    confirmRoutingSuggestion({ suggestion: suggestion(), current });
    expect(JSON.stringify(current)).toBe(before);
  });
});

describe('confirmRoutingSuggestion · 拒绝路径（每条都要有机械判据）', () => {
  it('watch 条目 ⇒ not_a_route_change（proposedRoute 是占位）', () => {
    const outcome = confirmRoutingSuggestion({
      suggestion: suggestion({ kind: 'watch', proposedRoute: { providerId: 'prov_a', model: '' } }),
      current: currentConfig(),
    });
    expect(outcome).toMatchObject({ kind: 'rejected', reason: 'not_a_route_change' });
  });

  it('样本不足 ⇒ insufficient_sample', () => {
    const outcome = confirmRoutingSuggestion({
      suggestion: suggestion({ status: 'insufficient_sample' }),
      current: currentConfig(),
    });
    expect(outcome).toMatchObject({ kind: 'rejected', reason: 'insufficient_sample' });
  });

  it('task_type 不在配置里 ⇒ task_type_absent', () => {
    const outcome = confirmRoutingSuggestion({
      suggestion: suggestion({ cell: { taskType: 'NOT_A_TASK', providerId: 'prov_a', model: 'model-a1', recipeVersion: null } }),
      current: currentConfig(),
    });
    expect(outcome).toMatchObject({ kind: 'rejected', reason: 'task_type_absent' });
  });

  it('找不到 incumbent 叶子 ⇒ incumbent_not_found', () => {
    const outcome = confirmRoutingSuggestion({
      suggestion: suggestion({ cell: { taskType: TASK, providerId: 'prov_x', model: 'nope', recipeVersion: null } }),
      current: currentConfig(),
    });
    expect(outcome).toMatchObject({ kind: 'rejected', reason: 'incumbent_not_found' });
  });

  it('同一 route 命中多个 tier ⇒ ambiguous_incumbent（不猜替换哪一个）', () => {
    const current = currentConfig();
    const ambiguous: TierConfigFile = {
      ...current,
      routes: {
        ...current.routes,
        [TASK]: {
          primary: { providerId: 'prov_a', model: 'model-a1' },
          duplicate: { providerId: 'prov_a', model: 'model-a1' },
        },
      },
    };
    const outcome = confirmRoutingSuggestion({ suggestion: suggestion(), current: ambiguous });
    expect(outcome).toMatchObject({ kind: 'rejected', reason: 'ambiguous_incumbent' });
  });

  it('目标 provider 未登记 ⇒ provider_not_registered（提示登记位置）', () => {
    const outcome = confirmRoutingSuggestion({
      suggestion: suggestion({ proposedRoute: { providerId: 'prov_unregistered', model: 'm' } }),
      current: currentConfig(),
    });
    expect(outcome).toMatchObject({ kind: 'rejected', reason: 'provider_not_registered' });
    if (outcome.kind === 'rejected') expect(outcome.detail).toContain('providers.prov_unregistered');
  });

  it('proposed 与现行叶子相同 ⇒ already_applied', () => {
    const outcome = confirmRoutingSuggestion({
      suggestion: suggestion({ proposedRoute: { providerId: 'prov_a', model: 'model-a1' } }),
      current: currentConfig(),
    });
    expect(outcome).toMatchObject({ kind: 'rejected', reason: 'already_applied' });
  });
});

describe('confirmRoutingSuggestion · 校验栏复用（真跑既有 loadTierConfigFile）', () => {
  it('产出路由表 + 原注册表落盘后，仍能过既有机械校验且叶子就是 proposed', async () => {
    const current = currentConfig();
    const outcome = confirmRoutingSuggestion({ suggestion: suggestion(), current });
    expect(outcome.kind).toBe('applied');
    if (outcome.kind !== 'applied') return;

    const dir = mkdtempSync(join(tmpdir(), 'mozhou-confirm-'));
    TEMP_DIRS.push(dir);
    const file = join(dir, 'settings.yaml');
    // YAML 1.2 是 JSON 的超集，yaml 的 parse 能直接吃 JSON 文本——
    // 这样无需为测试引入 yaml 依赖，又让产出真的过一遍生产校验器。
    writeFileSync(file, JSON.stringify({ ...outcome.routes, providers: current.providers }), 'utf8');

    const reloaded = await loadTierConfigFile(file);
    expect(reloaded.routes[TASK]?.primary).toEqual({ providerId: 'prov_c', model: 'model-c1' });
    expect(reloaded.providers['prov_c']).toEqual({ baseURL: 'https://c.example.invalid', apiKeyEnv: 'PROV_C_KEY' });
  });
});

describe('confirmRoutingSuggestion · 空串守卫（可达性回归）', () => {
  it('proposedRoute.model 为空串 ⇒ malformed_proposed_route（不得产出被校验器拒收的配置）', () => {
    const outcome = confirmRoutingSuggestion({
      suggestion: suggestion({ proposedRoute: { providerId: 'prov_c', model: '' } }),
      current: currentConfig(),
    });
    expect(outcome).toMatchObject({ kind: 'rejected', reason: 'malformed_proposed_route' });
  });

  it('proposedRoute.providerId 为空串 ⇒ malformed_proposed_route', () => {
    const outcome = confirmRoutingSuggestion({
      suggestion: suggestion({ proposedRoute: { providerId: '', model: 'model-c1' } }),
      current: currentConfig(),
    });
    expect(outcome).toMatchObject({ kind: 'rejected', reason: 'malformed_proposed_route' });
  });

  /**
   * 这条用例守的是**可达性**，不是假想输入：
   * storage.narrowSuggestion 只判 typeof === 'string'、不判非空，
   * 因此一条 proposedRoute.model 为 "" 的记录能真的从磁盘上的
   * suggestions.jsonl 读回来，进而走到 confirmRoutingSuggestion。
   * 若守卫被移除，本用例会在「第一次确认返回 applied」处失败。
   */
  it('空 model 能从磁盘 suggestions.jsonl 读回（证明该输入真实可达），且确认时被挡下', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-confirm-disk-'));
    TEMP_DIRS.push(dir);

    appendSuggestions(dir, [suggestion({ proposedRoute: { providerId: 'prov_c', model: '' } })]);
    const rows = readSuggestions(dir);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.proposedRoute.model).toBe('');

    const outcome = confirmRoutingSuggestion({ suggestion: rows[0]!, current: currentConfig() });
    expect(outcome).toMatchObject({ kind: 'rejected', reason: 'malformed_proposed_route' });
  });
});
