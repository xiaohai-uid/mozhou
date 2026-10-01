/**
 * 建议确认核心 —— t53 附B 第 4 步「确认命令代写 settings.yaml 闭环」的**可测内核**。
 *
 * ## 这一步在评测子系统里的位置
 * `runTaskModelEvaluation` 产出 `RoutingSuggestion` 并追加进
 * `.mozhou/suggestions/suggestions.jsonl`（派生面，不入真源账本）。本模块把
 * 「作者确认其中一条」机械化成一个**纯配置变换**：
 * 当前已校验配置 + 一条建议 → 新路由表，或一条类型化拒绝。
 *
 * ## 纪律（C6：只建议不自动改路由）
 * - 本模块是**纯函数**：不读盘、不写盘、不读环境变量、不改任何全局状态。
 * - 「生效」只能由作者显式触发；本模块**不提供**任何自动应用路径。
 * - 真正落盘与 mtime 热加载归确认命令（t53 附B 第 4 步的命令部分，本票范围外）；
 *   落盘后由既有 `loadTierConfigFile` 重新机械校验 —— **校验栏零新增**。
 *
 * ## 为什么产出叶子不带 api_key_ref
 * 1. `run.ts` 的 R5 纪律：一条建议只替换一个 route 叶子的 providerId+model **成对**取值。
 * 2. web 入口 `apps/web/server/llm/tierRouting.ts:134-144` 对带 `api_key_ref` 的叶子
 *    直接抛 `TIER_ROUTE_API_KEY_REF_UNSUPPORTED` —— 凭据**只**来自 providers 注册表的
 *    `apiKeyEnv`。因此确认后的叶子必须不带该槽位，否则确认完的配置会被入口拒收。
 * 3. 密钥本体永不入配置文件（规格 §6）：本模块只写 providerId/model 两个标识。
 *
 * ## 为什么要求 provider 已在注册表登记
 * 未登记的 providerId 会让入口在运行期以「请在 providers.X 处登记 { baseURL, apiKeyEnv }」
 * 失败。确认阶段就把这种配置挡掉，等于复用既有加载器的判据——宁可拒绝，不写一份入口兑现不了的配置。
 */
import type { TierConfig, TierConfigFile, TierRoute } from '@mozhou/runtime';
import type { RoutingSuggestion } from './types.js';

/** 拒绝原因：每一条都对应一个「不能据此改路由」的机械判据。 */
export type ConfirmRejectionReason =
  /** watch 条目：其 proposedRoute 是占位，不代表任何路由变更。 */
  | 'not_a_route_change'
  /** 样本不足：status !== 'sufficient_sample'。 */
  | 'insufficient_sample'
  /** 当前配置里没有这个 task_type。 */
  | 'task_type_absent'
  /** 该 task_type 下找不到建议所指的 incumbent 叶子。 */
  | 'incumbent_not_found'
  /** 同一 providerId+model 在该 task_type 下命中多个 tier，无法确定替换哪一个。 */
  | 'ambiguous_incumbent'
  /** 目标 provider 未在 providers 注册表登记。 */
  | 'provider_not_registered'
  /** 建议的 proposedRoute 与现行叶子相同，确认无意义。 */
  | 'already_applied'
  /** proposedRoute 的 providerId/model 为空串——既有校验器会拒收这种叶子。 */
  | 'malformed_proposed_route';

/** 一次成功确认所描述的单叶子变更（供命令侧展示与审计）。 */
export interface RouteChange {
  readonly taskType: string;
  readonly tier: string;
  readonly from: TierRoute;
  readonly to: TierRoute;
}

export type ConfirmOutcome =
  | { readonly kind: 'applied'; readonly routes: TierConfig; readonly change: RouteChange }
  | { readonly kind: 'rejected'; readonly reason: ConfirmRejectionReason; readonly detail: string };

export interface ConfirmRequest {
  readonly suggestion: RoutingSuggestion;
  /**
   * 当前配置。**必须**来自 `loadTierConfigFile`（复用既有机械校验），
   * 不得手工拼装——否则「校验栏复用」这句话就是空的。
   */
  readonly current: TierConfigFile;
}

function reject(reason: ConfirmRejectionReason, detail: string): ConfirmOutcome {
  return { kind: 'rejected', reason, detail };
}

function sameRoute(left: TierRoute, right: { providerId: string; model: string }): boolean {
  return left.providerId === right.providerId && left.model === right.model;
}

/**
 * 把「作者确认某条建议」变换成新的路由表。纯函数：无 IO、无时钟、无环境。
 *
 * 返回 `applied` 时保证：新路由表**结构上**仍满足既有校验器的叶子约束
 * （叶子只含 providerId/model 两个键；两者均为**非空**字符串；provider 已登记）。
 * 真正的机械校验仍由调用方落盘后交给 `loadTierConfigFile` 复跑——那是唯一的权威判据。
 *
 * 该保证有回归测试守着（含「空 model 能从磁盘走到这里」的可达性用例）：
 * 早先版本缺非空判定，会返回一份被校验器拒收的配置，已修。
 */
export function confirmRoutingSuggestion(request: ConfirmRequest): ConfirmOutcome {
  const { suggestion, current } = request;
  const cell = suggestion.cell;

  // C6：watch 条目的 proposedRoute 是占位，绝不能据此改路由。
  if (suggestion.kind === 'watch') {
    return reject(
      'not_a_route_change',
      '建议 ' + suggestion.suggestionId + ' 是 watch（观察）条目：其 proposedRoute 为占位，不代表任何路由变更。',
    );
  }

  // 样本不足不得改路由（t53 C4 资格门）。
  if (suggestion.status !== 'sufficient_sample') {
    return reject(
      'insufficient_sample',
      '建议 ' + suggestion.suggestionId + ' 的 status=' + suggestion.status + '：样本不足，不得据此改动路由。',
    );
  }

  const tiers = current.routes[cell.taskType];
  if (tiers === undefined) {
    return reject('task_type_absent', '当前配置没有 task_type ' + cell.taskType + '。');
  }

  const matches = Object.entries(tiers).filter(
    ([, route]) => route.providerId === cell.providerId && route.model === cell.model,
  );
  if (matches.length === 0) {
    return reject(
      'incumbent_not_found',
      'task_type ' + cell.taskType + ' 下找不到 incumbent 叶子（providerId=' + cell.providerId + ' model=' + cell.model + '）。',
    );
  }
  if (matches.length > 1) {
    return reject(
      'ambiguous_incumbent',
      'task_type ' + cell.taskType + ' 下有 ' + String(matches.length) + ' 个 tier 同为 providerId=' + cell.providerId + ' model=' + cell.model + '，无法确定替换哪一个。',
    );
  }

  const [tierName, incumbent] = matches[0]!;
  const proposed = suggestion.proposedRoute;

  // 复用既有校验器的同一条判据：叶子 providerId/model 必须是非空字符串。
  // 这不是装饰——suggestions.jsonl 是磁盘上的普通 JSONL，storage.narrowSuggestion
  // 只判 typeof === 'string'、**不判非空**（storage.ts:66-68），空串能从磁盘一路走到这里。
  // 不挡的话本函数会返回 applied，而那份产出会被 loadTierConfigFile 以
  // TIER_CONFIG_STRUCTURE_INVALID 拒绝——已用探针实测，见
  // .dsh-audit/repair-20260930/S03-eval-wiring/probe-defect.log。
  if (proposed.providerId.length === 0 || proposed.model.length === 0) {
    return reject(
      'malformed_proposed_route',
      '建议 ' + suggestion.suggestionId + ' 的 proposedRoute 含空串（providerId=' +
        JSON.stringify(proposed.providerId) + ' model=' + JSON.stringify(proposed.model) +
        '）——既有校验器要求两者均为非空字符串，确认它会写出入口拒收的配置。',
    );
  }

  if (sameRoute(incumbent, proposed)) {
    return reject(
      'already_applied',
      'tier ' + cell.taskType + '.' + tierName + ' 已是 providerId=' + proposed.providerId + ' model=' + proposed.model + '，确认无变更。',
    );
  }

  if (current.providers[proposed.providerId] === undefined) {
    return reject(
      'provider_not_registered',
      'providerId ' + proposed.providerId + ' 未在 providers 注册表登记——请在 providers.' + proposed.providerId + ' 处登记 { baseURL, apiKeyEnv } 后再确认。',
    );
  }

  // R5：只替换 providerId+model 成对取值；不带 api_key_ref（见文件头 §为什么）。
  const to: TierRoute = { providerId: proposed.providerId, model: proposed.model };
  const routes: TierConfig = {
    ...current.routes,
    [cell.taskType]: { ...tiers, [tierName]: to },
  };

  return {
    kind: 'applied',
    routes,
    change: { taskType: cell.taskType, tier: tierName, from: incumbent, to },
  };
}
