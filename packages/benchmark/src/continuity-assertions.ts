/**
 * @mozhou/benchmark · L1 确定性连续性断言引擎（0 Token 消耗）。
 * 针对 ContextPacket 进行严格的时序、认知与设定边界机检。
 */
import type { ContextPacket } from '@mozhou/context-compiler';
import type { EntityRef, NarrativePromiseId, TemporalFact } from '@mozhou/kernel';

export interface ContinuityViolation {
  readonly ruleId: string;
  readonly severity: 'critical' | 'high' | 'warning';
  readonly message: string;
  readonly evidence?: string | undefined;
}

export interface ContinuityAssertionReport {
  readonly passed: boolean;
  readonly violations: readonly ContinuityViolation[];
  readonly totalChecked: number;
}

export interface ContinuityAssertionOptions {
  readonly currentChapterIndex: number;
  readonly pov: 'protagonist' | 'reader' | EntityRef;
  /** 秘密事实字典（未揭露事实 ID → 秘密关键词/真名） */
  readonly unrevealedSecrets?: readonly { factId: string; secretKeywords: readonly string[] }[] | undefined;
  /** 过期事实列表 */
  readonly expiredFacts?: readonly TemporalFact[] | undefined;
  /** 死亡或封印角色 */
  readonly deadCharacters?: readonly EntityRef[] | undefined;
  /** 到期应付伏笔 */
  readonly duePromiseIds?: readonly NarrativePromiseId[] | undefined;
}

/**
 * L1 确定性连续性硬断言机检。
 * 验证装配完成的 ContextPacket 绝不携带未授权秘密、已过期事实或死亡角色的活跃状态。
 */
export function evaluateContinuityPacket(
  packet: ContextPacket,
  options: ContinuityAssertionOptions,
): ContinuityAssertionReport {
  const violations: ContinuityViolation[] = [];
  let totalChecked = 0;

  // 1. 秘密零泄漏断言（Secret Zero-Leakage）
  if (options.unrevealedSecrets && options.unrevealedSecrets.length > 0) {
    for (const secret of options.unrevealedSecrets) {
      totalChecked += 1;
      for (const kw of secret.secretKeywords) {
        if (packet.text.includes(kw)) {
          violations.push({
            ruleId: 'L1-CONT-001-SECRET-LEAK',
            severity: 'critical',
            message: `未授权 POV (${options.pov}) 的 ContextPacket 装配文本中泄漏了机密关键词「${kw}」`,
            evidence: `factId: ${secret.factId}, keyword: ${kw}`,
          });
          break;
        }
      }
    }
  }

  // 2. 过期事实拦截断言（No Expired Facts）
  if (options.expiredFacts && options.expiredFacts.length > 0) {
    for (const fact of options.expiredFacts) {
      totalChecked += 1;
      if (fact.validUntil !== null && fact.validUntil < options.currentChapterIndex) {
        const factStr = String(fact.value);
        if (factStr.length >= 2 && packet.text.includes(factStr)) {
          violations.push({
            ruleId: 'L1-CONT-002-EXPIRED-FACT',
            severity: 'high',
            message: `第 ${options.currentChapterIndex} 章上下文包含已于第 ${fact.validUntil} 章过期的时空事实「${fact.predicate}: ${factStr}」`,
            evidence: `factId: ${fact.id}, validUntil: ${fact.validUntil}`,
          });
        }
      }
    }
  }

  // 3. 死亡角色活跃状态防御（Dead Character Integrity）
  if (options.deadCharacters && options.deadCharacters.length > 0) {
    for (const deadRef of options.deadCharacters) {
      totalChecked += 1;
      // 检查 settings 区域中是否将死亡角色标记为 active 或具有健康属性
      for (const setting of packet.settings) {
        if (setting.identifier === deadRef && setting.text.includes('status: active')) {
          violations.push({
            ruleId: 'L1-CONT-003-DEAD-ACTIVE',
            severity: 'critical',
            message: `已确认死亡的角色「${deadRef}」在上下文设定卡中依然标有 status: active 活跃状态`,
            evidence: setting.identifier,
          });
        }
      }
    }
  }

  // 4. 到期伏笔追踪（Due Promise Preserved）
  if (options.duePromiseIds && options.duePromiseIds.length > 0) {
    for (const promiseId of options.duePromiseIds) {
      totalChecked += 1;
      const foundInStructural = packet.structural.some((s) => s.text.includes(promiseId));
      if (!foundInStructural && !packet.text.includes(promiseId)) {
        violations.push({
          ruleId: 'L1-CONT-004-DUE-PROMISE-MISSING',
          severity: 'high',
          message: `本章到期伏笔「${promiseId}」未在 ContextPacket 结构层或提示词中装配`,
          evidence: promiseId,
        });
      }
    }
  }


  return {
    passed: violations.length === 0,
    violations,
    totalChecked,
  };
}
