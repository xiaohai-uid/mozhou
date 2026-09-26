/**
 * 分级路由解析器（T14 接线 · 规格 §4 解析协议 / §6 两级映射）。
 *
 * 职责边界：`tierConfig.ts` 只做「文件 → 校验后的两级表」；本模块做「两级表 → 单个
 * 活动路由」，并给出可喂给 `CapabilityRegistry.setGlobalOverride` 的 provider 覆盖层。
 * 两级表本身允许多叶子共存——飞轮评测把同 task_type 的每个叶子都当 incumbent 候选
 * （`packages/flywheel/src/evaluator/run.ts` 的 isIncumbent 逐叶子比对），所以「运行时
 * 用哪一个」必须有显式规则，不能由实现悄悄挑。
 *
 * 选档规则（V1 冻结）：
 *   1. 显式指定 tierName ⇒ 必须命中该 task_type 下的 tier，否则 NO_PROVIDER_TIER，
 *      消息列出键路径与可用 tier 清单；
 *   2. 未指定 ⇒ 该 task_type 恰有一个叶子才自动采用（规格 §6 示例即此单叶子形态）；
 *      零个 ⇒ NO_PROVIDER_TIER；多于一个 ⇒ NO_PROVIDER_TIER 并列出候选，提示显式指定。
 *      **多叶子时静默挑一个是静默行为变更**，与 Q6=A「调用期解析 + fail fast 指向配置键」
 *      的纪律相悖，因此一律 fail-fast 而不猜。
 *
 * 覆盖层形状（registry.ts 的 setGlobalOverride）只承载 providerId + providerVersion，
 * **承载不了 model**：model 不进覆盖层，由调用方在解析模型端点时按字段覆盖
 * （见 `apps/web/server/llm/tierRouting.ts`）。
 */
import type { TierConfig, TierRoute } from './tierConfig.js';
import { NoProviderError } from './types.js';

/** 活动路由：task_type 下被选中的那一个 tier 叶子。 */
export interface TierSelection {
  readonly taskType: string;
  readonly tier: string;
  readonly route: TierRoute;
}

/**
 * 在两级表中选出 task_type 的活动路由。
 * @param tierName 显式指定的 tier 名；缺省/空白 ⇒ 走单叶子自动采用规则。
 * @param ambiguityHint 多叶子歧义时的补救提示。运行时不知道调用方的「怎么指定 tier」
 *   （web 入口是环境变量、别处可能是参数），由调用方注入，避免补救路径不可发现。
 * @throws NoProviderError NO_PROVIDER_TASK_TYPE（无该 task_type）/ NO_PROVIDER_TIER（无此档、无叶子、多叶子歧义）。
 */
export function selectTierRoute(
  config: TierConfig,
  taskType: string,
  tierName?: string,
  ambiguityHint?: string,
): TierSelection {
  const tiers = config[taskType];
  if (tiers === undefined) {
    throw new NoProviderError('NO_PROVIDER_TASK_TYPE', taskType, `配置中无 ${taskType} 档`);
  }

  const names = Object.keys(tiers);
  const explicit = tierName?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    const route = tiers[explicit];
    if (route === undefined) {
      throw new NoProviderError(
        'NO_PROVIDER_TIER',
        `${taskType}.${explicit}`,
        `该 task_type 下无此 tier；可用 tier：${names.join(' / ')}`,
      );
    }
    return { taskType, tier: explicit, route };
  }

  if (names.length > 1) {
    const hint = ambiguityHint === undefined || ambiguityHint.length === 0 ? '' : `（${ambiguityHint}）`;
    throw new NoProviderError(
      'NO_PROVIDER_TIER',
      taskType,
      `${taskType} 下声明了多个 tier（${names.join(' / ')}），运行时不在其中静默挑一个——请显式指定要生效的 tier${hint}`,
    );
  }

  const tier = names[0];
  const route = tier === undefined ? undefined : tiers[tier];
  if (tier === undefined || route === undefined) {
    // 防御性分支：loadTierConfig 已保证「task_type 下至少一个 tier 条目」。
    throw new NoProviderError('NO_PROVIDER_TIER', taskType, `${taskType} 下无 tier 条目`);
  }
  return { taskType, tier, route };
}

/**
 * 活动路由 → CapabilityRegistry 的全局覆盖层条目。
 * providerVersion 随能力注册（路由不改变 adapter 版本），故由调用方给定；
 * model 不在此列——覆盖层形状承载不了它。
 */
export function toProviderOverride(
  selection: TierSelection,
  providerVersion: string,
): ReadonlyMap<string, { providerId: string; providerVersion: string }> {
  return new Map([[selection.taskType, { providerId: selection.route.providerId, providerVersion }]]);
}
