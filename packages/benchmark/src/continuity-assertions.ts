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

export interface PromptfooGeneratedCase {
  readonly description: string;
  readonly vars: {
    readonly pov: string;
    readonly chapterIndex: number;
    readonly deadCharacters?: readonly string[] | undefined;
    readonly prompt: string;
  };
  readonly assert: readonly {
    readonly type: 'not-contains' | 'not-regex' | 'javascript';
    readonly value: string;
  }[];
}

/**
 * P0-2 动态测试编译器：从正史时空事实与实体状态自动编译出确定性连续性断言规则。
 * 遵循终审裁决（Q3）：正史设定为唯一真理来源，自动化编译产出测试数据，不维护手写副本。
 */
export function generateContinuityAssertionsFromCanon(
  facts: readonly TemporalFact[],
  currentChapter: number,
  pov: 'protagonist' | 'reader' | EntityRef,
  deadCharacters: readonly EntityRef[] = [],
  duePromises: readonly NarrativePromiseId[] = [],
): ContinuityAssertionOptions {
  const unrevealedSecrets = facts
    .filter((f) => f.predicate.startsWith('secret.') && (f.validUntil === null || f.validUntil >= currentChapter))
    .map((f) => ({
      factId: f.id,
      secretKeywords: [String(f.value), f.predicate.replace('secret.', '')],
    }));

  const expiredFacts = facts.filter((f) => f.validUntil !== null && f.validUntil < currentChapter);

  return {
    currentChapterIndex: currentChapter,
    pov,
    unrevealedSecrets,
    expiredFacts,
    deadCharacters,
    duePromiseIds: duePromises,
  };
}

/**
 * 将正史派生的连续性规则导出为标准 Promptfoo 测试用例（用于 CI 与离线模型回归）。
 */
export function exportPromptfooTestCaseFromCanon(
  options: ContinuityAssertionOptions,
  chapterTitle: string,
): PromptfooGeneratedCase {
  const asserts: { type: 'not-contains' | 'not-regex' | 'javascript'; value: string }[] = [];

  if (options.unrevealedSecrets) {
    for (const s of options.unrevealedSecrets) {
      for (const kw of s.secretKeywords) {
        if (kw.length >= 2) asserts.push({ type: 'not-contains', value: kw });
      }
    }
  }

  if (options.deadCharacters && options.deadCharacters.length > 0) {
    for (const dead of options.deadCharacters) {
      const name = dead.replace('char:', '');
      asserts.push({ type: 'not-regex', value: `${name}(?:推门|冷笑|说道|拔剑|站起身|抱拳)` });
    }
  }

  asserts.push({
    type: 'not-regex',
    value: '(?:他终于明白|这一夜注定无人入眠|这一夜[^。]*注定|欲知后事如何|且听下回分解)',
  });

  return {
    description: `[Canon-Derived] 第 ${options.currentChapterIndex} 章 (${chapterTitle}) 连续性回归断言`,
    vars: {
      pov: typeof options.pov === 'string' ? options.pov : 'protagonist',
      chapterIndex: options.currentChapterIndex,
      ...(options.deadCharacters && options.deadCharacters.length > 0
        ? { deadCharacters: options.deadCharacters }
        : {}),
      prompt: `撰写第 ${options.currentChapterIndex} 章《${chapterTitle}》核心场景正文。`,
    },
    assert: asserts,
  };
}

