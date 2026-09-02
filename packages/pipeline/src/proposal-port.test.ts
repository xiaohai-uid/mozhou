/**
 * ProposalPort 统一确认面黑盒（T18 · #42）：
 *   - 一个 Port 两个调用方的复用实证（同一实例同一协议驱动管线提案与 T5 对账提案）；
 *   - confirm / reject / editAccept 逐条粒度各一路；
 *   - 未决条目收口规则（对账端一次性 decideItems 落五态终态）；
 *   - 未确认提案跨重启存活（新 Port 实例同 root 续接）。
 * 零时钟零外部服务。
 */
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { newUlid } from '@mozhou/kernel';
import { PublishBus } from '@mozhou/runtime';
import { LocalDataPlane, TRACKING_STREAMS, createBook } from '@mozhou/data-plane';
import { createCanonProposal } from './proposal-step.js';
import { ProposalPort, ProposalPortError, confirmedAppendsForCommit, listPendingProposalRefs } from './proposal-port.js';

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch {} }
  roots = [];
});

const NOW = '2026-08-25T00:00:00.000Z';

function factRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'fact_' + newUlid(),
    bookId: 'book_' + newUlid(),
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    subject: 'char:linwan',
    predicate: 'located',
    value: '墨舟',
    validFrom: 2,
    validUntil: null,
    importance: 'notable',
    riskClass: 'low',
    source: { kind: 'chapter', chapterIndex: 2 },
    status: 'candidate',
    compactedIntoVolumeId: null,
    provenance: { origin: 'ai', protectedUserContent: false },
    ...overrides,
  };
}

function newBook(): { root: string; plane: LocalDataPlane } {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-t18-port-'));
  roots.push(dir);
  createBook({ dir, title: '确认之书' });
  const plane = LocalDataPlane.open(dir);
  plane.createChapterDraft({ chapterIndex: 2, title: '第二章' });
  return { root: dir, plane };
}

/** 管线侧夹具提案：low 一条、medium 一条、high 一条。 */
function seedPipelineProposal(root: string, bus: PublishBus): ReturnType<typeof createCanonProposal> {
  return createCanonProposal({
    bus,
    bookRoot: root,
    taskRef: 'tsk_t18_port',
    chapterIndex: 2,
    delta: {
      temporalFact: [
        factRow(),
        factRow({ predicate: 'secret.identity', riskClass: 'high' }),
      ],
      relationshipState: [
        {
          id: 'rels_' + newUlid(),
          bookId: 'book_' + newUlid(),
          revision: 0,
          createdAt: NOW,
          updatedAt: NOW,
          entityA: 'char:linwan',
          entityB: 'char:ahei',
          relationshipType: '盟友',
          affinityScore: 20,
          validFrom: 2,
          validUntil: null,
          sourceChapterIndex: 2,
        },
      ],
    },
  });
}

describe('ProposalPort 统一确认面', () => {
  it('复用实证：一个 Port 实例同协议驱动管线与 T5 对账两个调用方，逐条粒度各自落定', () => {
    const { root, plane } = newBook();

    /* --- 管线调用方 --- */
    const seeded = seedPipelineProposal(root, new PublishBus());
    const pipelineRef = { port: 'pipeline', proposalId: seeded.proposalId } as const;

    /* --- 对账调用方：种子一章已提交事实流，外部追加一行触发检出 --- */
    plane.createChapterDraft({ chapterIndex: 1, title: '第一章' });
    const committed = factRow({ validFrom: 1 });
    plane.commitChapter({
      chapterIndex: 1,
      summary: 'seed',
      finalProse: '# 第一章\n\n定稿。\n',
      appends: { temporalFact: [committed] },
    });
    const externalLine = factRow({ subject: 'char:ahei', value: '北岸' });
    appendFileSync(join(root, '追踪/事实.jsonl'), JSON.stringify(externalLine) + '\n');
    const recon = plane.reconciliation();
    recon.pollOnce();
    const open = recon.listOpenProposals().at(-1);
    if (open === undefined || open.summary === null || open.summary.kind !== 'trackingStream') {
      throw new Error('fixture: expected an awaiting_author trackingStream reconciliation proposal');
    }
    expect(open.state).toBe('awaiting_author');
    const reconciliationRef = { port: 'reconciliation', proposalId: open.proposalId } as const;

    /* --- 同一 Port 实例、同一组动词 --- */
    const port = new ProposalPort({ root, reconciliation: recon });

    // 管线端：medium 关系条确认、high 秘密条显式确认、……
    // 待决条目按族序（temporalFact 先于 relationshipState）确定性排列
    expect(port.pendingItemsOf(pipelineRef)).toEqual(['temporalFact#1', 'relationshipState#0']);
    expect(port.confirm(pipelineRef, 'relationshipState#0').finalized).toBe(false);
    expect(port.confirm(pipelineRef, 'temporalFact#1').finalized).toBe(true);

    // 对账端：接受新增行、拒绝 whole 标记位 ⇒ 收口进 partially_applied（混合取舍）
    expect(port.pendingItemsOf(reconciliationRef)).toEqual(['whole', 'add:1']);
    expect(port.confirm(reconciliationRef, 'add:1').finalized).toBe(false);
    const done = port.reject(reconciliationRef, 'whole');
    expect(done.finalized).toBe(true);

    // 复用实证的落点：两个后端的终态都能从各自仓读回
    const resolved = recon.getProposal(open.proposalId);
    expect(resolved?.resolution).toBe('partially_applied');
    const reloaded = loadPipelineFor(root, seeded.proposalId);
    expect(reloaded?.items.every((item) => item.state === 'confirmed')).toBe(true);

    // 投影侧：被接受的行已按盘上现状落 tracking_lines（Q12 应用语义）
    const streamPath = join(root, TRACKING_STREAMS[0].path);
    expect(readFileSync(streamPath, 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('管线端三动词：reject 排除出确认集；editAccept 浅合并覆盖候选行字段', () => {
    const { root } = newBook();
    const seeded = seedPipelineProposal(root, new PublishBus());
    const ref = { port: 'pipeline', proposalId: seeded.proposalId } as const;
    const port = new ProposalPort({ root });

    expect(port.editAccept(ref, 'temporalFact#1', { value: '南岸（作者改）' }).action).toBe('edit_accepted');
    expect(port.reject(ref, 'relationshipState#0').action).toBe('rejected');

    const rows = port.confirmedCanonicalRows(ref);
    const editedFact = rows.temporalFact?.find((row) => (row as Record<string, unknown>)['predicate'] === 'secret.identity');
    expect((editedFact as Record<string, unknown>)['value']).toBe('南岸（作者改）');
    expect(rows.relationshipState).toEqual([]); // rejected 不入确认集

    const appends = confirmedAppendsForCommit(root, seeded.proposalId);
    expect(appends.temporalFact).toHaveLength(2); // low 原样 + high 编辑后
    expect(appends.relationshipState).toBeUndefined();
  });

  it('Commit 门禁：pending 未清（含 high 未显式确认）即拒——confirmedCanonicalRows 宁败不静默', () => {
    const { root } = newBook();
    const seeded = seedPipelineProposal(root, new PublishBus());
    const ref = { port: 'pipeline', proposalId: seeded.proposalId } as const;
    const port = new ProposalPort({ root });

    expect(() => port.confirmedCanonicalRows(ref)).toThrow(ProposalPortError);
    expect(() => port.confirmedCanonicalRows(ref)).toThrow(/explicit confirmation before Commit/);
    expect(listPendingProposalRefs({ root })).toEqual([ref]);
  });

  it('editAccept 协议纪律：管线空 patch 拒；对账带 patch 拒（编辑通道是文件本身）', () => {
    const { root, plane } = newBook();
    const seeded = seedPipelineProposal(root, new PublishBus());
    const pipelineRef = { port: 'pipeline', proposalId: seeded.proposalId } as const;
    const portWithoutRecon = new ProposalPort({ root });
    expect(() => portWithoutRecon.editAccept(pipelineRef, 'temporalFact#1')).toThrow(ProposalPortError);
    expect(() => portWithoutRecon.confirm({ port: 'reconciliation', proposalId: 'rcln_x' }, 'whole')).toThrow(
      /without a ReconciliationService backend/,
    );

    // 对账端带 patch 显式拒绝
    plane.createChapterDraft({ chapterIndex: 1, title: '第一章' });
    plane.commitChapter({
      chapterIndex: 1,
      summary: 'seed',
      finalProse: '# 第一章\n\n定稿。\n',
      appends: { temporalFact: [factRow({ validFrom: 1 })] },
    });
    appendFileSync(join(root, '追踪/事实.jsonl'), JSON.stringify(factRow()) + '\n');
    const recon = plane.reconciliation();
    recon.pollOnce();
    const open = recon.listOpenProposals().at(-1);
    if (open === undefined) throw new Error('fixture: expected an open reconciliation proposal');
    const port = new ProposalPort({ root, reconciliation: recon });
    expect(() => port.editAccept({ port: 'reconciliation', proposalId: open.proposalId }, 'whole', { value: 'x' })).toThrow(
      /the file itself is the edit channel/,
    );
  });

  it('未知条目宁败不猜：known 清单随错误回显', () => {
    const { root } = newBook();
    const seeded = seedPipelineProposal(root, new PublishBus());
    const port = new ProposalPort({ root });
    expect(() => port.confirm({ port: 'pipeline', proposalId: seeded.proposalId }, 'temporalFact#9')).toThrow(
      /known items: temporalFact#0, temporalFact#1, relationshipState#0/,
    );
  });

  it('未确认提案跨重启存活：新 Port 实例同 root 续接，决策缓冲跨重启有效', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-t18-restart-'));
    roots.push(dir);
    createBook({ dir, title: '重启之书' });

    // 第一段会话：建提案，只确认一条即「进程结束」
    {
      const plane = LocalDataPlane.open(dir);
      plane.createChapterDraft({ chapterIndex: 2, title: '第二章' });
      const seeded = seedPipelineProposal(dir, new PublishBus());
      const port = new ProposalPort({ root: dir });
      port.confirm({ port: 'pipeline', proposalId: seeded.proposalId }, 'temporalFact#1'); // high 显式确认
      plane.close();
    }

    // 重启：新平面 + 新 Port 实例——待决视图原样恢复
    let proposalId = '';
    {
      const plane = LocalDataPlane.open(dir);
      const port = new ProposalPort({ root: dir, reconciliation: plane.reconciliation() });
      const refs = listPendingProposalRefs({ root: dir, reconciliation: plane.reconciliation() });
      expect(refs).toHaveLength(1);
      const ref = refs[0];
      if (ref === undefined || ref.port !== 'pipeline') throw new Error('expected a pending pipeline ref');
      proposalId = ref.proposalId;
      // 悬挂标记双凭据之一：提案记录 state=open 且仍有 pending 条目
      expect(port.pendingItemsOf(ref)).toEqual(['relationshipState#0']);
      expect(port.pendingItemsOf(ref)).not.toContain('temporalFact#1'); // 已确认的不回来

      port.confirm(ref, 'relationshipState#0');
      const rows = port.confirmedCanonicalRows(ref);
      expect(rows.temporalFact).toHaveLength(2);
      expect(rows.relationshipState).toHaveLength(1);
    }

    // 第二段会话收口提交后：提案翻 consumed，恢复扫描不再报悬挂
    {
      const port = new ProposalPort({ root: dir });
      port.markConsumed({ port: 'pipeline', proposalId });
      expect(listPendingProposalRefs({ root: dir })).toEqual([]);
      expect(readdirSync(join(dir, '.mozhou/proposals'))).toHaveLength(1); // 记录留档不删除
    }
  });
});

/* 测试局部 helper：从盘读回管线提案记录（避免引入实现私有通道）。 */
import { loadCanonProposal } from './proposal-step.js';
function loadPipelineFor(root: string, proposalId: string) {
  return loadCanonProposal(root, proposalId);
}

describe('ProposalPort · style 后端（t51:B2）', () => {
  it('confirm 显式生效；reject/editAccept 响亮拒绝；永挂待决视图', () => {
    const root = mkdtempSync(join(tmpdir(), 'mozhou-port-style-'));
    roots.push(root);
    createBook({ dir: root, title: 'PortStyle' });
    const accepted: string[] = [];
    const port = new ProposalPort({
      root,
      styleBackend: {
        listPending: () => [
          { id: 'sug_1', scenarioType: 'action', proposal: { sensoryDensity: 0.6 } },
          { id: 'sug_2', scenarioType: 'dialogue', proposal: { actionPacing: 0.4 } },
        ],
        accept: (item) => accepted.push(item.id),
      },
    });

    // 永挂待决：pendingItemsOf 返回全部挂起建议
    const pending = port.pendingItemsOf({ port: 'style', proposalId: 'style:any' });
    expect(pending).toEqual(['sug_1', 'sug_2']);
    // 未决策前 accept 回调未被调用（无隐式采纳）
    expect(accepted).toEqual([]);

    // 逐条 confirm 才生效
    const outcome = port.confirm({ port: 'style', proposalId: 'style:any' }, 'sug_1');
    expect(outcome.action).toBe('confirmed');
    expect(outcome.finalized).toBe(false);
    expect(accepted).toEqual(['sug_1']);

    // reject/editAccept 不是 style 后端的合法动作（无静默批量/无编辑面）
    expect(() => port.reject({ port: 'style', proposalId: 'style:any' }, 'sug_2'))
      .toThrow(ProposalPortError);
    expect(() => port.editAccept({ port: 'style', proposalId: 'style:any' }, 'sug_2', { x: 1 }))
      .toThrow(ProposalPortError);
    // 未知建议响亮拒绝
    expect(() => port.confirm({ port: 'style', proposalId: 'style:any' }, 'sug_nope'))
      .toThrow(ProposalPortError);
  });

  it('缺省无 styleBackend：访问 style 引用响亮报错（防守缺省）', () => {
    const root = mkdtempSync(join(tmpdir(), 'mozhou-port-style-nb-'));
    roots.push(root);
    createBook({ dir: root, title: 'PortStyleNoBackend' });
    const port = new ProposalPort({ root });
    expect(() => port.pendingItemsOf({ port: 'style', proposalId: 'style:x' }))
      .toThrow(ProposalPortError);
    expect(() => port.confirm({ port: 'style', proposalId: 'style:x' }, 'sug_1'))
      .toThrow(ProposalPortError);
  });
});
