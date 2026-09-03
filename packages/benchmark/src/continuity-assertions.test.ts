import { describe, expect, it } from 'vitest';
import type { ContextPacket } from '@mozhou/context-compiler';
import type { BookId, FactId, NarrativePromiseId, TemporalFact } from '@mozhou/kernel';
import {
  evaluateContinuityPacket,
  exportPromptfooTestCaseFromCanon,
  generateContinuityAssertionsFromCanon,
} from './continuity-assertions.js';


describe('L1 确定性连续性断言引擎 (evaluateContinuityPacket)', () => {
  const dummyPacket: ContextPacket = {
    taskType: 'CHAPTER_DRAFTING',
    chapterIndex: 5,
    structural: [
      { section: 'outline', text: '本章任务：调查假神法印', tokens: 10 },
      { section: 'promises', text: '待决承诺: prom_01J_reveal', tokens: 10 },
    ],
    settings: [
      {
        identifier: 'char:chen-que',
        tier: 'entity_card',
        text: '陈缺：青年修士',
        tokens: 10,
        trimType: 'none',
        desirabilityPosition: 0,
      },
      {
        identifier: 'char:wang-lin',
        tier: 'entity_card',
        text: '王林：status: active',
        tokens: 10,
        trimType: 'none',
        desirabilityPosition: 1,
      },
    ],

    story: { text: '', tokens: 0, trimType: 'none' },
    text: '【本章大纲】陈缺进城。城东有假神法印出没。待决承诺: prom_01J_reveal',
    totalTokens: 100,
  };


  it('秘密零泄漏：当 ContextPacket 包含未授权秘密关键词时抛出 critical 违规', () => {
    const report = evaluateContinuityPacket(
      {
        ...dummyPacket,
        text: dummyPacket.text + ' 隐藏机密：真神降临古阵开启',
      },
      {
        currentChapterIndex: 5,
        pov: 'protagonist',
        unrevealedSecrets: [
          { factId: 'fact_secret_01', secretKeywords: ['真神降临古阵'] },
        ],
      },
    );

    expect(report.passed).toBe(false);
    expect(report.violations.some((v) => v.ruleId === 'L1-CONT-001-SECRET-LEAK')).toBe(true);
    expect(report.violations[0]?.severity).toBe('critical');
  });

  it('过期事实拦截：上下文包含已于此前章节过期的事实时精准报错', () => {
    const expiredFact: TemporalFact = {
      id: 'fact_expired_wound' as FactId,
      bookId: 'book_01' as BookId,
      revision: 0,
      createdAt: '',
      updatedAt: '',
      subject: 'char:chen-que',
      predicate: 'state.injured',
      value: '断骨未愈',
      validFrom: 1,
      validUntil: 3, // 已在第 3 章痊愈过期
      importance: 'notable',
      riskClass: 'low',
      source: { kind: 'chapter', chapterIndex: 1 },
      status: 'confirmed',
      compactedIntoVolumeId: null,
      provenance: { origin: 'author', protectedUserContent: false },
    };

    const packetWithExpired = {
      ...dummyPacket,
      text: dummyPacket.text + ' 状态备注：断骨未愈仍在影响身法。',
    };

    const report = evaluateContinuityPacket(packetWithExpired, {
      currentChapterIndex: 5,
      pov: 'protagonist',
      expiredFacts: [expiredFact],
    });

    expect(report.passed).toBe(false);
    expect(report.violations.some((v) => v.ruleId === 'L1-CONT-002-EXPIRED-FACT')).toBe(true);
  });

  it('死亡角色活跃状态防御：已死亡角色不可在设定卡中带有 status: active', () => {
    const report = evaluateContinuityPacket(dummyPacket, {
      currentChapterIndex: 5,
      pov: 'protagonist',
      deadCharacters: ['char:wang-lin'],
    });

    expect(report.passed).toBe(false);
    expect(report.violations.some((v) => v.ruleId === 'L1-CONT-003-DEAD-ACTIVE')).toBe(true);
  });

  it('合规上下文通过所有 L1 确定性硬断言', () => {
    const cleanPacket: ContextPacket = {
      ...dummyPacket,
      settings: [
        {
          identifier: 'char:chen-que',
          tier: 'entity_card',
          text: '陈缺：青年修士',
          tokens: 10,
          trimType: 'none',
          desirabilityPosition: 0,
        },

      ],
      text: '【本章大纲】陈缺进城，调查旧案。待决承诺: prom_01J_reveal',
    };


    const report = evaluateContinuityPacket(cleanPacket, {
      currentChapterIndex: 5,
      pov: 'protagonist',
      unrevealedSecrets: [{ factId: 'fact_secret_01', secretKeywords: ['真神降临古阵'] }],
      deadCharacters: ['char:wang-lin'],
      duePromiseIds: ['prom_01J_reveal' as NarrativePromiseId],
    });

    expect(report.passed).toBe(true);
    expect(report.violations.length).toBe(0);
  });

  it('从正史事实动态编译连续性断言与 Promptfoo 测试用例', () => {
    const mockFacts: TemporalFact[] = [
      {
        id: 'fact_secret_true_god' as FactId,
        bookId: 'book_01' as BookId,
        revision: 0,
        createdAt: '',
        updatedAt: '',
        subject: 'char:chen-que',
        predicate: 'secret.true_god_altar',
        value: '真神降临古阵',
        validFrom: 1,
        validUntil: null,
        importance: 'critical',
        riskClass: 'high',
        source: { kind: 'chapter', chapterIndex: 1 },
        status: 'confirmed',
        compactedIntoVolumeId: null,
        provenance: { origin: 'author', protectedUserContent: true },
      },
    ];

    const options = generateContinuityAssertionsFromCanon(
      mockFacts,
      3,
      'protagonist',
      ['char:wang-lin'],
      ['prom_01' as NarrativePromiseId],
    );

    expect(options.currentChapterIndex).toBe(3);
    expect(options.unrevealedSecrets?.length).toBe(1);
    expect(options.unrevealedSecrets?.[0]?.secretKeywords).toContain('真神降临古阵');
    expect(options.deadCharacters).toContain('char:wang-lin');

    const promptfooCase = exportPromptfooTestCaseFromCanon(options, '古庙探秘');
    expect(promptfooCase.description).toContain('第 3 章 (古庙探秘)');
    expect(promptfooCase.assert.some((a) => a.value === '真神降临古阵')).toBe(true);
    expect(promptfooCase.assert.some((a) => a.value.includes('wang-lin'))).toBe(true);
  });
});

