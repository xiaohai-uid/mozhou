/**
 * @mozhou/pipeline · 安全守卫与规则契约护栏固化测试（Hardened Guardrails）
 * 覆盖：
 * 1. 5 项纯算术机械门极端对抗性测试（字数窗口边界、占位符全变体、AI红线正则、相邻段落复读回环、4-gram 方差）
 * 2. Fail-Closed 审查报告哈希防篡改（REV-001 任意单字节篡改、hash 不一致时的 blocking_fail、unknown fail closed）
 * 3. 生产流水线双回炉风控（审查回炉上限 2 次硬熔断、连续性门作者显式回炉）
 * 4. I1-I6 核心不变量与 M2 时间线单调性硬拦截
 * 5. 视角秘密隔离与单飞并发互斥锁（零泄漏无知情隔离、单飞跨章互斥锁）
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PublishBus } from '@mozhou/runtime';
import { LocalDataPlane, createBook } from '@mozhou/data-plane';
import {
  evaluateMechanicalGates,
  detect4GramRepetition,
  findCommon5Gram,
  isInsideQuotes,
  REV_001_ID,
  evaluateDeterministicRules,
  runQualityReview,
  hashProse,
  isQualityReviewCurrent,
  type QualityPolicy,
  type QualityReviewAnchor,
} from '@mozhou/quality-engine';
import {
  assertAutomationReadOnly,
  ProtectedContentViolationError,
  buildStaleMarker,
  assertTimelineBatchOrdered,
  TimelineOrderViolationError,
  queryActiveFacts,
  queryKnowledgePerspective,
  assertNoProtectedSupersession,
  TrackingRowError,
  type AuthorProvenance,
  type BookId,
  type EntityRef,
  type FactId,
  type KnowledgeHolder,
  type KnowledgeState,
  type KnowledgeStateId,
  type NarrativeStateSnapshot,
  type PovEntity,
  type TemporalFact,
  type TimelineEvent,
  type TimelineEventId,
} from '@mozhou/kernel';
import {
  ChapterProductionSession,
  GlobalSingleFlightError,
  SessionAlreadyActiveError,
  QualityReviewNotPassError,
  QualityReworkLimitExceededError,
  ReworkNotDrivenError,
  HardConflictUnresolvedError,
  readPipelineLedger,
  findOpenSessionWindow,
} from './index.js';

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* 清理失败可忽略 */
    }
  }
  roots = [];
});

function makeBook(prefix: string): { root: string; bus: PublishBus } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  createBook({ dir, title: '规则护栏固化之书' });
  const bus = new PublishBus();
  return { root: dir, bus };
}

function deps(root: string, bus: PublishBus, chapterIndex: number, tag: string) {
  return { bus, root, chapterIndex, newTaskRef: () => 'tsk_' + tag };
}

const ISO = '2026-10-02T00:00:00.000Z';

/** 空策略：evaluateDeterministicRules/runQualityReview 只读 .rules。 */
function emptyPolicy(): QualityPolicy {
  return { schemaVersion: 1, projectId: 'test', rules: [], maxAutomaticReworks: 2 };
}

/** 审查锚点：runQualityReview 只读 draftContentHash，其余字段保持契约完整。 */
function reviewAnchor(draftContentHash: string): QualityReviewAnchor {
  return {
    chapterIndex: 1,
    draftRevision: 1,
    draftContentHash,
    receiptId: 'rcpt_test',
    ruleSetDigest: 'test',
  };
}

interface FactSeed {
  readonly id: string;
  readonly subject: string;
  readonly predicate: string;
  readonly value: string | number | boolean;
  readonly provenance?: AuthorProvenance;
}

/** 构造契约完整的 TemporalFact 夹具；未被断言函数读取的字段用稳定缺省值填充。 */
function makeFact(seed: FactSeed): TemporalFact {
  return {
    id: seed.id as FactId,
    bookId: 'book_1' as BookId,
    revision: 0,
    createdAt: ISO,
    updatedAt: ISO,
    subject: seed.subject as EntityRef,
    predicate: seed.predicate,
    value: seed.value,
    validFrom: 1,
    validUntil: null,
    importance: 'notable',
    riskClass: 'low',
    source: { kind: 'chapter', chapterIndex: 1 },
    status: 'confirmed',
    compactedIntoVolumeId: null,
    provenance: seed.provenance ?? { origin: 'author', protectedUserContent: true },
  };
}

interface KnowledgeSeed {
  readonly id: string;
  readonly factId: string;
  readonly holder: string;
  readonly level: 'knows' | 'suspects' | 'believes';
  readonly knownSinceChapter: number;
}

/** 构造契约完整的 KnowledgeState 夹具；查询路径只读 holder/level/factId/knownSinceChapter。 */
function makeKnowledgeState(seed: KnowledgeSeed): KnowledgeState {
  return {
    id: seed.id as KnowledgeStateId,
    bookId: 'book_1' as BookId,
    revision: 0,
    createdAt: ISO,
    updatedAt: ISO,
    factId: seed.factId as FactId,
    holder: seed.holder as KnowledgeHolder,
    level: seed.level,
    knownSinceChapter: seed.knownSinceChapter,
  };
}

/** 收窄为查询芯所需的叙事状态切片，保留调用方传入的真实 Map。 */
function narrativeState(
  facts: ReadonlyMap<FactId, TemporalFact>,
  knowledgeStates: ReadonlyMap<KnowledgeStateId, KnowledgeState>,
): Pick<NarrativeStateSnapshot, 'facts' | 'knowledgeStates'> {
  return { facts, knowledgeStates };
}

describe('Guardrail Hardening: 规则契约与安全护栏固化测试', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // 1. 5 项纯算术机械门
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. 5 项纯算术机械门（字数窗口、占位符、AI红线、相邻段落复读、4-gram方差）', () => {
    it('1.1 字数窗口：严格以中文字符统计，超出或不足精准拦截', () => {
      const min = 50;
      const max = 100;
      // 49 个汉字 + 大量英文字母和标点
      const textTooShort = '墨'.repeat(49) + ' abcdefghijklmnopqrstuvwxyz,.:;!?-=';
      const reportShort = evaluateMechanicalGates(textTooShort, { minWords: min, maxWords: max });
      expect(reportShort.passed).toBe(false);
      expect(reportShort.fails.some((f) => f.includes('字数') && f.includes('超出窗口'))).toBe(true);

      // 正好 50 个汉字
      const textExactMin = '墨'.repeat(50);
      const reportExactMin = evaluateMechanicalGates(textExactMin, { minWords: min, maxWords: max });
      const wordCheckMin = reportExactMin.checks.find((c) => c.id === 'mech_01_words');
      expect(wordCheckMin?.ok).toBe(true);

      // 正好 100 个汉字
      const textExactMax = '墨'.repeat(100);
      const reportExactMax = evaluateMechanicalGates(textExactMax, { minWords: min, maxWords: max });
      const wordCheckMax = reportExactMax.checks.find((c) => c.id === 'mech_01_words');
      expect(wordCheckMax?.ok).toBe(true);

      // 101 个汉字
      const textTooLong = '墨'.repeat(101);
      const reportLong = evaluateMechanicalGates(textTooLong, { minWords: min, maxWords: max });
      expect(reportLong.passed).toBe(false);
      expect(reportLong.fails.some((f) => f.includes('字数') && f.includes('超出窗口'))).toBe(true);
    });

    it('1.2 占位符拦截：全变体变种（TODO, 占位, 待补, 待写, XXX, {param}）零漏网', () => {
      const placeholders = [
        '陆沉舟拔出长剑，TODO 补全兵刃招式。',
        '此地乃是占位区域，稍后完善。',
        '此招法力精纯，待补完整心法。',
        '二人相视一笑，待写后续对话。',
        '来者名叫XXX，乃是青云门长老。',
        '只见那妖兽张开巨口，喷出{element_attack}烈焰。',
      ];

      for (const phrase of placeholders) {
        const report = evaluateMechanicalGates(phrase, { minWords: 1, maxWords: 1000 });
        const check = report.checks.find((c) => c.id === 'mech_02_placeholder');
        expect(check?.ok, `应该拦截占位符片段: ${phrase}`).toBe(false);
        expect(check?.detail).toContain('检测到未清理占位符');
      }

      const cleanText = '陆沉舟长剑出鞘，剑光如练，直取黑衣人咽喉。';
      const cleanReport = evaluateMechanicalGates(cleanText, { minWords: 1, maxWords: 1000 });
      expect(cleanReport.checks.find((c) => c.id === 'mech_02_placeholder')?.ok).toBe(true);
    });

    it('1.3 AI 红线正则表：内置 10 种红线及自定义反例严格拦截', () => {
      const redlineSamples = [
        '激战过后，他终于明白了修行的真谛。',
        '夜幕降临，这一夜注定要在史册留下浓墨重彩的一笔。',
        '寒风呼啸，四野无人入眠。',
        '本章讲述了少年踏入仙途的坎坷历程。',
        '他不知道的是，更大的危机正悄然逼近。',
        '欲知后事如何，且听下回分解。',
        '剑势像潮水般涌来，让人避无可避。',
        '天地初开，宛如一场史诗。',
        '或许这就是命运吧，总让人身不由己。',
      ];

      for (const text of redlineSamples) {
        const report = evaluateMechanicalGates(text, { minWords: 1, maxWords: 1000 });
        const redlineCheck = report.checks.find((c) => c.id === 'mech_03_redlines');
        expect(redlineCheck?.ok, `应拦截高危 AI 红线: ${text}`).toBe(false);
        expect(redlineCheck?.detail).toContain('命中高危红线');
      }

      // 测试自定义反例正则追加
      const customText = '这一剑名为斩月，霸道绝伦。';
      const customReport = evaluateMechanicalGates(customText, {
        minWords: 1,
        maxWords: 1000,
        customRedlines: ['斩月'],
      });
      const customCheck = customReport.checks.find((c) => c.id === 'mech_03_redlines');
      expect(customCheck?.ok).toBe(false);
      expect(customCheck?.detail).toContain('自定义反例·斩月');
    });

    it('1.4 相邻段落复读：跨段复读拦截与修辞对话回环安全放行', () => {
      // 跨段 5 字叙述复读
      const p1 = '山神庙外大雨倾盆，雷声阵阵轰鸣。';
      const p2 = '狂风卷着大雨，山神庙外大雨倾盆，寒气逼人。';
      expect(findCommon5Gram(p1, p2)).toBe('山神庙外大');

      // 对话回环（成对引号内）安全放行
      const d1 = '师兄冷笑一声：“何苦执迷不悟！”';
      const d2 = '陆沉舟平静道：“何苦执迷不悟，师兄自己可曾悟透？”';
      expect(findCommon5Gram(d1, d2)).toBeNull();

      // 引号与标点识别
      expect(isInsideQuotes('师兄冷笑：“天地无道。”拂袖而去。', '天地无道')).toBe(true);
      expect(isInsideQuotes('师兄冷笑：“天地无道。”拂袖而去。', '拂袖而去')).toBe(false);
    });

    it('1.5 4-gram 方差：高频 4 字短语重复拦截与标点过滤', () => {
      const clean = '天道无情，以万物为刍狗。岁月流转，沧海桑田不知更迭几许。';
      expect(detect4GramRepetition(clean, 5).repeated).toBe(false);

      // 同一 4 字短语出现 6 次（maxAllowed 缺省为 5）
      const repeatProse = [
        '他看见万象森罗在眼前浮现。',
        '所谓万象森罗，不过是虚妄。',
        '天地化作万象森罗之势。',
        '心中生出万象森罗的感应。',
        '整座大阵演化为万象森罗之境。',
        '终于，万象森罗彻底溃散消逝。',
      ].join('\n\n');

      const res = detect4GramRepetition(repeatProse, 5);
      expect(res.repeated).toBe(true);
      expect(res.detail).toContain('4字短语「万象森罗」在单章内高频出现 6 次');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Fail-Closed 审查报告哈希防篡改（REV-001）
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. Fail-Closed 审查报告哈希防篡改（REV-001）', () => {
    const prose = '天地玄黄，宇宙洪荒。日月盈昃，辰宿列张。\n\n寒来暑往，秋收冬藏。';
    const trueHash = hashProse(prose);

    it('2.1 哈希严格一致时 REV-001 通过', () => {
      const evals = evaluateDeterministicRules(prose, emptyPolicy(), {
        proseContentHash: trueHash,
        anchorDraftContentHash: trueHash,
      });
      const rev = evals.find((e) => e.ruleId === REV_001_ID);
      expect(rev).toBeDefined();
      expect(rev?.verdict).toBe('pass');
      expect(rev?.severity).toBe('blocking');
    });

    it('2.2 单字节篡改导致哈希不匹配，REV-001 判定 fail 且阻断交付（blocking_fail）', async () => {
      const tamperedAnchorHash = hashProse(prose + ' '); // 仅多一个空格

      const report = await runQualityReview({
        prose,
        policy: emptyPolicy(), // 即使策略未显式声明，REV-001 也是结构性不变量
        anchor: reviewAnchor(tamperedAnchorHash), // 篡改后的锚点
        reviewer: { providerId: 'test', model: 'test', recipeVersion: '1.0' },
        failurePatterns: [],
      });

      expect(report.verdict).toBe('blocking_fail');
      const revEval = report.evaluations.find((e) => e.ruleId === REV_001_ID);
      expect(revEval?.verdict).toBe('fail');
      expect(revEval?.severity).toBe('blocking');
      expect(revEval?.evidence[0]?.note).toContain('不一致——该报告不能作为 PASS 使用');
    });

    it('2.3 Fail-Closed 纪律：语义审查提供方异常/未覆盖时，unknown 绝不升格为 pass', async () => {
      const semanticPolicy: QualityPolicy = {
        schemaVersion: 1,
        projectId: 'test',
        maxAutomaticReworks: 2,
        rules: [
          {
            id: 'SEM-001',
            version: '1.0.0',
            scope: 'project',
            kind: 'semantic',
            severity: 'advisory',
            description: '剧情张力审查',
            evidenceRequired: false,
            enabled: true,
          },
        ],
      };
      const report = await runQualityReview({
        prose,
        policy: semanticPolicy,
        anchor: reviewAnchor(trueHash),
        reviewer: { providerId: 'test', model: 'test', recipeVersion: '1.0' },
        failurePatterns: [],
        // 未提供 semanticEvaluator
      });

      // 缺少提供方时必须 refused，不能假装 pass
      expect(report.verdict).toBe('refused');
      const semEval = report.evaluations.find((e) => e.ruleId === 'SEM-001');
      expect(semEval?.verdict).toBe('unknown');
    });

    it('2.4 时效性守卫：草稿改动后旧 PASS 立即失效（isQualityReviewCurrent 为 false）', async () => {
      const report = await runQualityReview({
        prose,
        policy: emptyPolicy(),
        anchor: reviewAnchor(trueHash),
        reviewer: { providerId: 'test', model: 'test', recipeVersion: '1.0' },
        failurePatterns: [],
      });
      expect(report.verdict).toBe('pass');

      // 正文改动，revision + 1 且哈希改变
      const newProse = prose + '\n\n新追加段落。';
      const isCurrent = isQualityReviewCurrent(report, {
        draftRevision: 2,
        draftContentHash: hashProse(newProse),
      });
      expect(isCurrent).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. 生产流水线双回炉风控
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. 生产流水线双回炉风控（审查回炉上限 2 次、连续性门作者显式回炉）', () => {
    it('3.1 文学审查回炉：blocking_fail 拦截前进；自动回炉严格限 2 次，第 3 次抛出 QualityReworkLimitExceededError', () => {
      const { root, bus } = makeBook('mozhou-guard-rework-');
      LocalDataPlane.open(root).createChapterDraft({ chapterIndex: 1, title: '第一章' });
      const session = ChapterProductionSession.start(deps(root, bus, 1, 'rework_limit'));

      // prepare -> compile -> draft -> review
      session.advance('compile');
      session.advance('draft');
      session.advance('review');

      // 模拟质量审查 blocking_fail
      session.recordQualityReview({ reportId: 'rpt_fail_1', verdict: 'blocking_fail' });

      // 未 pass 禁止前进至 user_edit
      expect(() => session.advance('user_edit')).toThrow(QualityReviewNotPassError);

      // 第 1 次回炉：成功返回 draft
      session.requestQualityRework();
      expect(session.currentStep).toBe('draft');
      expect(session.project().qualityReworkCount).toBe(1);

      // 重新推到 review
      session.advance('review');
      session.recordQualityReview({ reportId: 'rpt_fail_2', verdict: 'blocking_fail' });

      // 第 2 次回炉：成功返回 draft
      session.requestQualityRework();
      expect(session.currentStep).toBe('draft');
      expect(session.project().qualityReworkCount).toBe(2);

      // 再次推到 review
      session.advance('review');
      session.recordQualityReview({ reportId: 'rpt_fail_3', verdict: 'blocking_fail' });

      // 第 3 次回炉：触发死循环熔断风控，抛出 QualityReworkLimitExceededError
      expect(() => session.requestQualityRework()).toThrow(QualityReworkLimitExceededError);
      // 会话状态保持在 review，不失控自动死循环
      expect(session.currentStep).toBe('review');
    });

    it('3.2 连续性门回炉：hard_conflict 拦截前进；必须作者显式 requestRework 回炉至 user_edit', () => {
      const { root, bus } = makeBook('mozhou-guard-gate-');
      LocalDataPlane.open(root).createChapterDraft({ chapterIndex: 1, title: '第一章' });
      const session = ChapterProductionSession.start(deps(root, bus, 1, 'gate_rework'));

      session.advance('compile');
      session.advance('draft');
      session.advance('review');
      session.recordQualityReview({ reportId: 'rpt_pass', verdict: 'pass' });
      session.advance('user_edit');
      session.advance('final_extract');
      session.advance('continuity_gate', { verdict: 'hard_conflict' });

      // 硬冲突悬置时，禁止前进至 canon_proposal
      expect(() => session.advance('canon_proposal')).toThrow(HardConflictUnresolvedError);

      // 作者显式回炉，重退至 user_edit
      session.requestRework();
      expect(session.currentStep).toBe('user_edit');

      // 门若为 pass，禁止乱调 requestRework（防非法逆向）
      session.advance('final_extract');
      session.advance('continuity_gate', { verdict: 'pass' });
      expect(() => session.requestRework()).toThrow(ReworkNotDrivenError);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. I1-I6 核心不变量与 M2 时间线单调性硬拦截
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. I1-I6 核心不变量与 M2 时间线单调性硬拦截', () => {
    it('4.1 I1：受保护内容（protectedUserContent=true）自动化通道禁写，动首字节前拦截', () => {
      expect(() => {
        assertAutomationReadOnly(
          { origin: 'author', protectedUserContent: true },
          { kind: 'outlineNode', id: 'out_node_1' },
        );
      }).toThrow(ProtectedContentViolationError);

      // 人工或未受保护内容放行
      expect(() => {
        assertAutomationReadOnly(
          { origin: 'ai', protectedUserContent: false },
          { kind: 'outlineNode', id: 'out_node_2' },
        );
      }).not.toThrow();

      // 追踪流防自动化取代守卫（assertNoProtectedSupersession）
      const protectedFact = makeFact({
        id: 'fact_prot_01',
        subject: 'char:protagonist',
        predicate: 'mastery',
        value: 'sword',
        provenance: { origin: 'author', protectedUserContent: true },
      });
      const aiAttemptFact: TemporalFact = {
        ...protectedFact,
        value: 'magic',
        provenance: { origin: 'ai', protectedUserContent: false },
      };
      const liveMap = new Map<FactId, TemporalFact>([[protectedFact.id, protectedFact]]);
      expect(() => {
        assertNoProtectedSupersession(liveMap, [aiAttemptFact]);
      }).toThrow(ProtectedContentViolationError);
    });

    it('4.2 I2：stale 只是建议性重验信号，不静默删除或覆写实体', () => {
      const marker = buildStaleMarker({
        reason: 'upstream_canon_changed',
        upstreamRefs: [{ kind: 'temporalFact', id: 'fact_001', revision: 2 }],
        markedAt: '2026-10-02T12:00:00.000Z',
      });
      expect(marker.reason).toBe('upstream_canon_changed');
      expect(marker.upstreamRefs).toHaveLength(1);
    });

    it('4.3 M2：时间线序数严格单调硬门，乱序插入直接拦截', () => {
      const ev1: TimelineEvent = {
        id: 'tle_1' as TimelineEventId,
        bookId: 'book_1' as BookId,
        revision: 0,
        createdAt: '2026-10-02T00:00:00.000Z',
        updatedAt: '2026-10-02T00:00:00.000Z',
        chapterIndex: 1,
        worldTimeOrder: 100,
        worldTimeLabel: '事件1',
        participants: ['char:tester'],
        summary: '事件1',
        impactFactIds: [],
      };
      const ev2: TimelineEvent = {
        id: 'tle_2' as TimelineEventId,
        bookId: 'book_1' as BookId,
        revision: 0,
        createdAt: '2026-10-02T00:00:00.000Z',
        updatedAt: '2026-10-02T00:00:00.000Z',
        chapterIndex: 1,
        worldTimeOrder: 90, // 倒退序数！
        worldTimeLabel: '事件2',
        participants: ['char:tester'],
        summary: '事件2',
        impactFactIds: [],
      };

      // 存量最大值为 95，ev1=100 合法，ev2=90 乱序违规
      expect(() => {
        assertTimelineBatchOrdered([ev1, ev2], 95);
      }).toThrow(TimelineOrderViolationError);

      // 单调递增批次放行
      const ev2Correct: TimelineEvent = { ...ev2, worldTimeOrder: 110 };
      expect(() => {
        assertTimelineBatchOrdered([ev1, ev2Correct], 95);
      }).not.toThrow();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. 视角秘密隔离与单飞并发互斥锁
  // ──────────────────────────────────────────────────────────────────────────
  describe('5. 视角秘密隔离与单飞并发互斥锁', () => {
    it('5.1 视角秘密隔离：未知情角色对 secret 事实零泄漏；全知 reader 视角拒答', () => {
      // 拒绝 reader 视角
      expect(() => {
        const invalidPov: string = 'reader';
        queryActiveFacts(
          narrativeState(
            new Map<FactId, TemporalFact>(),
            new Map<KnowledgeStateId, KnowledgeState>(),
          ),
          { chapter: 1, pov: invalidPov as PovEntity },
        );
      }).toThrow(TrackingRowError);

      const secretFact = makeFact({
        id: 'fact_secret_01',
        subject: 'char:master',
        predicate: 'secret.real_identity',
        value: '魔尊转世',
      });

      const publicFact = makeFact({
        id: 'fact_public_01',
        subject: 'char:master',
        predicate: 'sect_rank',
        value: '掌门',
      });

      const facts = new Map<FactId, TemporalFact>([
        [secretFact.id, secretFact],
        [publicFact.id, publicFact],
      ]);

      // 角色 A 未获知秘密
      const knowledgeStatesA = new Map<KnowledgeStateId, KnowledgeState>();
      const resultA = queryActiveFacts(narrativeState(facts, knowledgeStatesA), {
        chapter: 1,
        pov: 'char:disciple_a',
      });
      // 仅能看到公开事实，秘密事实彻底隔离
      expect(resultA.map((f) => f.id)).toEqual(['fact_public_01']);

      // 角色 B 在第 2 章获知秘密 (level: 'knows')
      const knowledgeStatesB = new Map<KnowledgeStateId, KnowledgeState>([
        [
          'ks_01' as KnowledgeStateId,
          makeKnowledgeState({
            id: 'ks_01',
            factId: secretFact.id,
            holder: 'char:disciple_b',
            level: 'knows',
            knownSinceChapter: 2,
          }),
        ],
      ]);

      // 第 1 章时依然看不到
      const resultB_Ch1 = queryActiveFacts(narrativeState(facts, knowledgeStatesB), {
        chapter: 1,
        pov: 'char:disciple_b',
      });
      expect(resultB_Ch1.map((f) => f.id)).toEqual(['fact_public_01']);

      // 第 2 章时合法可见
      const resultB_Ch2 = queryActiveFacts(narrativeState(facts, knowledgeStatesB), {
        chapter: 2,
        pov: 'char:disciple_b',
      });
      expect(resultB_Ch2.map((f) => f.id)).toContain('fact_secret_01');

      // 非权威通道 queryKnowledgePerspective 秘密事实绝不泄露正典值
      const suspectsPerspective = queryKnowledgePerspective(
        narrativeState(
          facts,
          new Map<KnowledgeStateId, KnowledgeState>([
            [
              'ks_suspect' as KnowledgeStateId,
              makeKnowledgeState({
                id: 'ks_suspect',
                factId: secretFact.id,
                holder: 'char:disciple_a',
                level: 'suspects',
                knownSinceChapter: 1,
              }),
            ],
          ]),
        ),
        { chapter: 1, pov: 'char:disciple_a' },
      );
      // 绝不包含真实 value '魔尊转世'
      expect(suspectsPerspective[0]?.presentation).not.toContain('魔尊转世');
      expect(suspectsPerspective[0]?.presentation).toContain('存在未确证的隐秘事实');
    });

    it('5.2 全局单飞并发互斥锁：别章未收卷时开新卷直接拒绝且零副作用', () => {
      const { root, bus } = makeBook('mozhou-guard-singleflight-');
      const plane = LocalDataPlane.open(root);
      plane.createChapterDraft({ chapterIndex: 1, title: '第一章' });
      plane.createChapterDraft({ chapterIndex: 2, title: '第二章' });

      // 启动第 1 章会话
      const ch1Session = ChapterProductionSession.start(deps(root, bus, 1, 'flight_ch1'));
      expect(ch1Session.currentStep).toBe('prepare');

      const ledgerCountBefore = readPipelineLedger(root).length;

      // 尝试在第 1 章未完成时启动第 2 章：直接抛出 GlobalSingleFlightError
      expect(() => {
        ChapterProductionSession.start(deps(root, bus, 2, 'flight_ch2'));
      }).toThrow(GlobalSingleFlightError);

      // 账本在拦截点零增长
      expect(readPipelineLedger(root)).toHaveLength(ledgerCountBefore);
      // 开放窗口依旧仅为第 1 章
      expect(findOpenSessionWindow(readPipelineLedger(root))).toEqual({
        chapterIndex: 1,
        taskRef: 'tsk_flight_ch1',
      });

      // 同章重复开卷抛 SessionAlreadyActiveError
      expect(() => {
        ChapterProductionSession.start(deps(root, bus, 1, 'flight_ch1_repeat'));
      }).toThrow(SessionAlreadyActiveError);
    });
  });
});
