/**
 * T14 接线验收：分级路由解析器（selectTierRoute / toProviderOverride）。
 *
 * 覆盖的失败路径与不变量：
 *   - 未指定 tier 且单叶子 ⇒ 自动采用（规格 §6 示例形态）；
 *   - 未指定 tier 且多叶子 ⇒ fail-fast（不静默挑一个）且消息含键路径 + 候选清单；
 *   - 显式 tier 缺失 ⇒ fail-fast 且消息列出可用 tier；
 *   - task_type 缺档 ⇒ NO_PROVIDER_TASK_TYPE；
 *   - 覆盖层只承载 providerId/providerVersion，绝不携带 model。
 */
import { describe, expect, it } from 'vitest';
import { selectTierRoute, toProviderOverride } from './tierRouting.js';
import { NoProviderError } from './types.js';
import type { TierConfig } from './tierConfig.js';

const SINGLE: TierConfig = {
  CHAPTER_DRAFTING: {
    quality: { providerId: 'deepseek', model: 'deepseek-reasoner' },
  },
};

const MULTI: TierConfig = {
  CHAPTER_DRAFTING: {
    quality: { providerId: 'deepseek', model: 'deepseek-reasoner' },
    fast: { providerId: 'deepseek', model: 'deepseek-chat' },
  },
};

describe('selectTierRoute', () => {
  it('未指定 tier 且单叶子：自动采用该叶子', () => {
    const selection = selectTierRoute(SINGLE, 'CHAPTER_DRAFTING');
    expect(selection).toEqual({
      taskType: 'CHAPTER_DRAFTING',
      tier: 'quality',
      route: { providerId: 'deepseek', model: 'deepseek-reasoner' },
    });
  });

  it('显式指定 tier：命中该叶子，空白串等同未指定', () => {
    expect(selectTierRoute(MULTI, 'CHAPTER_DRAFTING', 'fast').tier).toBe('fast');
    expect(selectTierRoute(SINGLE, 'CHAPTER_DRAFTING', '   ').tier).toBe('quality');
  });

  it('显式 tier 缺失：NO_PROVIDER_TIER，键路径指向 task_type.tier 且列出可用 tier', () => {
    const err = (() => {
      try {
        selectTierRoute(MULTI, 'CHAPTER_DRAFTING', 'turbo');
        return null;
      } catch (e: unknown) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(NoProviderError);
    expect((err as NoProviderError).code).toBe('NO_PROVIDER_TIER');
    expect((err as NoProviderError).configKeyPath).toBe('CHAPTER_DRAFTING.turbo');
    expect((err as NoProviderError).message).toContain('quality');
    expect((err as NoProviderError).message).toContain('fast');
  });

  it('未指定 tier 且多叶子：fail-fast 而不是静默挑一个，消息含键路径与候选', () => {
    const err = (() => {
      try {
        selectTierRoute(MULTI, 'CHAPTER_DRAFTING');
        return null;
      } catch (e: unknown) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(NoProviderError);
    expect((err as NoProviderError).code).toBe('NO_PROVIDER_TIER');
    expect((err as NoProviderError).configKeyPath).toBe('CHAPTER_DRAFTING');
    expect((err as NoProviderError).message).toContain('quality / fast');
  });

  it('多叶子歧义可注入补救提示：候选清单与提示同时出现在报错里（补救路径可发现）', () => {
    const err = (() => {
      try {
        selectTierRoute(MULTI, 'CHAPTER_DRAFTING', undefined, '本生成入口的操作位是环境变量 MOZHOU_DRAFT_TIER');
        return null;
      } catch (e: unknown) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(NoProviderError);
    expect((err as NoProviderError).configKeyPath).toBe('CHAPTER_DRAFTING');
    expect((err as NoProviderError).message).toContain('quality / fast');
    expect((err as NoProviderError).message).toContain('MOZHOU_DRAFT_TIER');
  });

  it('task_type 缺档：NO_PROVIDER_TASK_TYPE，键路径即 task_type', () => {
    const err = (() => {
      try {
        selectTierRoute(SINGLE, 'LONGFORM_PLANNING');
        return null;
      } catch (e: unknown) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(NoProviderError);
    expect((err as NoProviderError).code).toBe('NO_PROVIDER_TASK_TYPE');
    expect((err as NoProviderError).configKeyPath).toBe('LONGFORM_PLANNING');
  });

  it('toProviderOverride：只出 providerId/providerVersion，model 不进覆盖层', () => {
    const selection = selectTierRoute(MULTI, 'CHAPTER_DRAFTING', 'fast');
    const override = toProviderOverride(selection, '1.0.0');
    expect([...override.keys()]).toEqual(['CHAPTER_DRAFTING']);
    expect(override.get('CHAPTER_DRAFTING')).toEqual({ providerId: 'deepseek', providerVersion: '1.0.0' });
    expect(Object.keys(override.get('CHAPTER_DRAFTING') ?? {})).not.toContain('model');
  });
});
