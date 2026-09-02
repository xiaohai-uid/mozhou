import { describe, expect, it } from 'vitest';
import type { BookId, EntityRef } from './kernel-schema.js';
import {
  auditCausalContract,
  projectContractToTemporalFacts,
  type CausalContract,
  type ContractId,
} from './causal-contract.js';

describe('P1-1 CausalContract 领域扩展与门禁审计', () => {
  const contractFixture: CausalContract = {
    id: 'contract_01J_tian_dao' as ContractId,
    bookId: 'book_01J' as BookId,
    revision: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    title: '天道借法契约',
    parties: [
      { entity: 'char:gu-qing-zhou' as EntityRef, role: 'debtor' },
      { entity: 'faction:tian-dao' as EntityRef, role: 'creditor' },
    ],
    obligations: [
      {
        obligationId: 'ob_01',
        debtor: 'char:gu-qing-zhou' as EntityRef,
        description: '在第三章结束前献祭寿元十年',
        isFulfilled: false,
      },
    ],
    deadline: { kind: 'chapter', chapterIndex: 3 },
    consideration: '借用先果权斩杀魔尊',
    breachPenalty: '雷劫噬心道基尽毁',
    status: 'active',
  };

  it('合约向 TemporalFact 派生事实投影：投影出状态事实与违约事实', () => {
    const facts = projectContractToTemporalFacts(contractFixture);
    expect(facts.length).toBe(1);
    expect(facts[0]?.predicate).toContain('contract.status');
    expect(facts[0]?.value).toBe('active');

    const breachedFacts = projectContractToTemporalFacts({
      ...contractFixture,
      status: 'breached',
    });
    expect(breachedFacts.length).toBe(2);
    expect(breachedFacts.some((f) => f.predicate.includes('contract.breached'))).toBe(true);
    expect(breachedFacts.some((f) => f.value === '雷劫噬心道基尽毁')).toBe(true);
  });

  it('超期且无任何处置（未履约/未违约/未延期）被门禁硬拦截', () => {
    const issue = auditCausalContract(contractFixture, 4); // 当前第 4 章，截止第 3 章
    expect(issue).not.toBeNull();
    expect(issue?.code).toBe('expired_without_disposition');
  });

  it('违约（Breach）是合法剧情走向：已登记违约状态则门禁放行', () => {
    const breachedContract: CausalContract = {
      ...contractFixture,
      status: 'breached',
      breachDisposed: true,
    };
    const issue = auditCausalContract(breachedContract, 4);
    expect(issue).toBeNull(); // 违约合法，门禁放行
  });

  it('履约、展期、豁免均视为合法处置，门禁放行', () => {
    expect(auditCausalContract({ ...contractFixture, status: 'fulfilled' }, 4)).toBeNull();
    expect(auditCausalContract({ ...contractFixture, status: 'amended' }, 4)).toBeNull();
    expect(auditCausalContract({ ...contractFixture, status: 'waived' }, 4)).toBeNull();
  });
});
