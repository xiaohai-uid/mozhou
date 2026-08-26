/**
 * ProposalPort 统一确认面（T18 · #42；chapter-pipeline-spec S6 架构核心）。
 *
 * 一个 Port，两个调用方：管线 Canon 提案（.mozhou/proposals/prp_*.json）与 T5
 * 外部修改五态对账提案（ReconciliationService 的 .mozhou/reconciliations/）共用
 * 同一确认协议——confirm / reject / editAccept，逐条粒度。
 *
 * 统一语义（协议冻结面）：
 *   - confirm(ref, itemId)：接受该条当前载荷。管线 = 候选行原样入 Commit 确认集；
 *     对账 = 该行按盘上现状落投影（applyTrackingStream 应用期直读盘面）。
 *   - reject(ref, itemId)：拒绝该条。管线 = 排除出确认集；对账 = 不升格进投影
 *     （Q12：拒绝 ≠ 回滚文件）。
 *   - editAccept(ref, itemId, patch?)：作者修改后接受。管线 = patch 浅合并覆盖候选行
 *     字段后入确认集；对账 = 编辑通道就是文件本身（先改文件再接受），携带 patch
 *     即显式拒绝——宁败不猜，绝不静默丢弃修改。
 *
 * 收口规则：全部条目决毕即收口。对账端一次性 decideItems(acceptedIds) 落五态终态
 * （applied/partially_applied/dismissed 由既有服务判定）；管线端由编排方在 Commit
 * 消费确认集后 markProposalConsumed 收口。
 *
 * 审计纪律：Port 决策不新增账本事件——kernel 事件词表是唯一真源且本票未授权增补，
 * 管线决策审计面 = 提案记录自身（逐条 state/patch 落盘），对账决策审计面 = T5 既有
 * ReconciliationResolved 平铺事件 + 决策缓冲文件。
 *
 * 恢复纪律（S8 Proposal 后行）：未决提案跨重启保持待决——管线记录持久化在提案仓，
 * 对账决策缓冲持久化在 .mozhou/proposals/port_rcln_*.json，新 Port 实例同 root 打开
 * 即续接（投影悬挂标记 = CanonProposalCreated 成对头 + 记录 state=open 双凭据）。
 */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TrackingKind } from '@mozhou/data-plane';
import { itemIdsOf } from '@mozhou/data-plane';
import type { ChangeSummary, ReconciliationProposal, ReconciliationService } from '@mozhou/data-plane';
import { CANDIDATE_FAMILIES } from './extract-step.js';
import type { CandidateFamily } from './extract-step.js';
import { listCanonProposals, loadCanonProposal, saveCanonProposal } from './proposal-step.js';
import type { CanonProposalItem, CanonProposalRecord } from './proposal-step.js';

/** 统一提案引用：port 判别三个调用方后端。
 *  style = StyleLearner LLM 旁路建议确认面（t51:B2）：派生建议不落提案仓，
 *  内存持留、永挂待决、无超时自动生效、confirm 显式生效（见下 README）。 */
export type ProposalPortRef =
  | { readonly port: 'pipeline'; readonly proposalId: string }
  | { readonly port: 'reconciliation'; readonly proposalId: string }
  | { readonly port: 'style'; readonly proposalId: string };

export type PortAction = 'confirmed' | 'rejected' | 'edit_accepted';

export class ProposalPortError extends Error {
  override readonly name = 'ProposalPortError';
}

function portError(detail: string): never {
  throw new ProposalPortError(detail);
}

export interface ProposalMutationOutcome {
  readonly ref: ProposalPortRef;
  readonly itemId: string;
  readonly action: PortAction;
  /** 本次决策后仍处 pending 的条目数（0 = 全部决毕）。 */
  readonly pendingItems: number;
  /** 全部条目决毕 ⇒ true。 */
  readonly finalized: boolean;
}

/* ----------------------------------------------------------------------------
 * 管线后端
 * ------------------------------------------------------------------------- */

function pipelineRecord(root: string, ref: Extract<ProposalPortRef, { port: 'pipeline' }>): CanonProposalRecord {
  const record = loadCanonProposal(root, ref.proposalId);
  if (record === null) {
    return portError('no such pipeline proposal: ' + ref.proposalId);
  }
  if (record.state === 'consumed') {
    return portError('pipeline proposal already consumed: ' + ref.proposalId);
  }
  return record;
}

function pipelineItem(record: CanonProposalRecord, itemId: string): CanonProposalItem {
  const item = record.items.find((candidate) => candidate.itemId === itemId);
  if (item === undefined) {
    return portError(
      'unknown item ' + itemId + ' for ' + record.proposalId + '; known items: ' +
        record.items.map((candidate) => candidate.itemId).join(', '),
    );
  }
  if (item.state !== 'pending') {
    return portError('item ' + itemId + ' of ' + record.proposalId + ' already decided (' + item.state + ')');
  }
  return item;
}

/** patch 浅合并：顶层字段覆盖（值原样替换）；空 patch 视为 confirm 语义违例。 */
function applyPatch(row: Readonly<Record<string, unknown>>, patch: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...row };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = value;
  }
  return merged;
}

/* ----------------------------------------------------------------------------
 * 对账后端：逐条决策缓冲 → 全部决毕一次性 decideItems 收口
 * ------------------------------------------------------------------------- */

interface ReconciliationDecision {
  readonly action: PortAction;
  readonly decidedAt: string;
}

interface ReconciliationDecisionLedger {
  readonly ledgerVersion: 1;
  readonly proposalId: string;
  readonly decisions: Readonly<Record<string, ReconciliationDecision>>;
}

const PORT_RCLN_PREFIX = 'port_rcln_';

function decisionLedgerPath(root: string, proposalId: string): string {
  return join(root, '.mozhou', 'proposals', PORT_RCLN_PREFIX + proposalId + '.json');
}

function loadDecisionLedger(root: string, proposalId: string): ReconciliationDecisionLedger {
  try {
    const parsed = JSON.parse(readFileSync(decisionLedgerPath(root, proposalId), 'utf8')) as Record<string, unknown>;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      parsed['ledgerVersion'] === 1 &&
      typeof parsed['decisions'] === 'object' &&
      parsed['decisions'] !== null
    ) {
      return {
        ledgerVersion: 1,
        proposalId,
        decisions: parsed['decisions'] as Record<string, ReconciliationDecision>,
      };
    }
  } catch {
    // 缺文件/损坏 = 无决策缓冲（运行时区审计容忍）
  }
  return { ledgerVersion: 1, proposalId, decisions: {} };
}

function persistDecisionLedger(root: string, ledger: ReconciliationDecisionLedger): void {
  mkdirSync(join(root, '.mozhou', 'proposals'), { recursive: true });
  const target = decisionLedgerPath(root, ledger.proposalId);
  const tmp = target + '.tmp';
  writeFileSync(tmp, JSON.stringify(ledger, null, 2) + '\n');
  renameSync(tmp, target);
}

/* ----------------------------------------------------------------------------
 * Port 本体
 * ------------------------------------------------------------------------- */

/** style 建议条目：LLM 旁路分类结果（如 sensoryDensity/actionPacing 标定），
 *  confirm 前的可选载荷。 */
export interface StyleSuggestionItem {
  readonly id: string;
  readonly scenarioType: string;
  readonly proposal: Readonly<Record<string, unknown>>;
}

/** style 后端确认时回调：把采纳的建议写进 StyleProfile（writeStyleProfiles 唯一写口）。 */
export interface StylePortBackend {
  /** 当前挂起建议（永挂待决视图；调用方每次从学习器旁路产出后刷新）。 */
  readonly listPending: () => readonly StyleSuggestionItem[];
  /** confirm 生效回调：调用方（flywheel）按建议写盘并返回该素材（比如新 revision）。 */
  readonly accept: (item: StyleSuggestionItem) => void;
}

export interface ProposalPortDeps {
  readonly root: string;
  /** reconciliation 引用的后端服务（LocalDataPlane.reconciliation() 单例即可）。 */
  readonly reconciliation?: ReconciliationService | undefined;
  /** style 旁路建议后端（t51:B2）；缺省 = style port 不可用（响亮报错）。 */
  readonly styleBackend?: StylePortBackend | undefined;
}

export class ProposalPort {
  readonly #root: string;
  readonly #reconciliation: ReconciliationService | undefined;
  readonly #styleBackend: StylePortBackend | undefined;

  constructor(deps: ProposalPortDeps) {
    this.#root = deps.root;
    this.#reconciliation = deps.reconciliation;
    this.#styleBackend = deps.styleBackend;
  }

  /* ---------------- 协议三动词 ---------------- */

  confirm(ref: ProposalPortRef, itemId: string): ProposalMutationOutcome {
    return this.#decide(ref, itemId, 'confirmed', undefined);
  }

  reject(ref: ProposalPortRef, itemId: string): ProposalMutationOutcome {
    return this.#decide(ref, itemId, 'rejected', undefined);
  }

  /**
   * 作者修改后接受。管线：patch 浅合并覆盖候选行；对账：编辑通道是文件本身，
   * 携带 patch 显式拒绝（先改文件再 editAccept）。
   */
  editAccept(ref: ProposalPortRef, itemId: string, patch: Readonly<Record<string, unknown>> = {}): ProposalMutationOutcome {
    if (ref.port === 'reconciliation' && Object.keys(patch).length > 0) {
      return portError(
        'reconciliation proposals take no patch — the file itself is the edit channel; ' +
          'edit the tracked file first, then editAccept without a patch (' + ref.proposalId + ')',
      );
    }
    if (Object.keys(patch).length === 0 && ref.port === 'pipeline') {
      return portError('editAccept with an empty patch is a confirm on the pipeline port — say what you edited');
    }
    return this.#decide(ref, itemId, 'edit_accepted', patch);
  }

  /* ---------------- 查询/恢复面 ---------------- */

  /** 未决条目 id（重启后续接的入口视图；style = 当前挂起建议全集——永挂待决）。 */
  pendingItemsOf(ref: ProposalPortRef): readonly string[] {
    if (ref.port === 'pipeline') {
      const record = loadCanonProposal(this.#root, ref.proposalId);
      if (record === null || record.state === 'consumed') return [];
      return record.items.filter((item) => item.state === 'pending').map((item) => item.itemId);
    }
    if (ref.port === 'style') {
      const backend = this.#requireStyle();
      return backend.listPending().map((item) => item.id);
    }
    const service = this.#requireReconciliation();
    const proposal = requireOpenReconciliation(service, ref.proposalId);
    const ledger = loadDecisionLedger(this.#root, ref.proposalId);
    return [...itemIdsOf(proposal.summary)].filter((itemId) => ledger.decisions[itemId] === undefined);
  }

  /** 全书未决提案引用扫描（恢复入口）：管线 open 记录 + 对账 awaiting_author + style 挂起建议。 */
  listPendingRefs(): ProposalPortRef[] {
    const refs: ProposalPortRef[] = [];
    for (const record of listCanonProposals(this.#root)) {
      if (record.state === 'open' && record.items.some((item) => item.state === 'pending')) {
        refs.push({ port: 'pipeline', proposalId: record.proposalId });
      }
    }
    if (this.#reconciliation !== undefined) {
      for (const proposal of this.#reconciliation.listOpenProposals()) {
        if (proposal.state === 'awaiting_author' && proposal.summary !== null) {
          refs.push({ port: 'reconciliation', proposalId: proposal.proposalId });
        }
      }
    }
    if (this.#styleBackend !== undefined) {
      for (const item of this.#styleBackend.listPending()) {
        refs.push({ port: 'style', proposalId: 'style:' + item.id });
      }
    }
    return refs;
  }

  /**
   * Commit 侧读缝：确认集按族分组（confirmed + edit_accepted 含 patch 后载荷）。
   * 存在 pending 条目即拒——medium 队列未清、high 未显式确认都进不了 Commit（S6）。
   */
  confirmedCanonicalRows(ref: Extract<ProposalPortRef, { port: 'pipeline' }>): Partial<Record<CandidateFamily, unknown[]>> {
    const record = pipelineRecord(this.#root, ref);
    const pending = record.items.filter((item) => item.state === 'pending');
    if (pending.length > 0) {
      return portError(
        'cannot commit with pending items (' + pending.map((item) => item.itemId).join(', ') + ') — ' +
          'medium waits for programmatic confirmation and high requires explicit confirmation before Commit',
      );
    }
    const rows: Partial<Record<CandidateFamily, unknown[]>> = {};
    for (const family of CANDIDATE_FAMILIES) rows[family] = [];
    for (const item of record.items) {
      if (item.state === 'rejected') continue;
      (rows[item.family] as unknown[]).push(item.row);
    }
    return rows;
  }

  /** 管线提案收口（Commit 消费后由编排方调用；幂等）。 */
  markConsumed(ref: Extract<ProposalPortRef, { port: 'pipeline' }>): void {
    const record = loadCanonProposal(this.#root, ref.proposalId);
    if (record === null) return portError('no such pipeline proposal: ' + ref.proposalId);
    if (record.state === 'consumed') return;
    if (record.items.some((item) => item.state === 'pending')) {
      return portError('cannot consume ' + ref.proposalId + ' with pending items');
    }
    saveCanonProposal(this.#root, {
      ...record,
      state: 'consumed',
      consumedAt: new Date().toISOString(),
    });
  }

  /* ---------------- 内核：逐条决策统一路径 ---------------- */

  #decide(
    ref: ProposalPortRef,
    itemId: string,
    action: PortAction,
    patch: Readonly<Record<string, unknown>> | undefined,
  ): ProposalMutationOutcome {
    if (ref.port === 'pipeline') {
      return this.#decidePipeline(ref, itemId, action, patch);
    }
    if (ref.port === 'style') {
      return this.#decideStyle(ref, itemId, action);
    }
    return this.#decideReconciliation(ref, itemId, action);
  }

  #decidePipeline(
    ref: Extract<ProposalPortRef, { port: 'pipeline' }>,
    itemId: string,
    action: PortAction,
    patch: Readonly<Record<string, unknown>> | undefined,
  ): ProposalMutationOutcome {
    const record = pipelineRecord(this.#root, ref);
    // 决策前置卫兵：未知条目/已决条目在此响亮失败（返回值本身不参与改写）
    pipelineItem(record, itemId);
    const nextItems = record.items.map((candidate) =>
      candidate.itemId === itemId
        ? {
            ...candidate,
            state: action,
            row:
              action === 'edit_accepted'
                ? applyPatch(candidate.row, patch ?? {})
                : candidate.row,
          }
        : candidate,
    );
    saveCanonProposal(this.#root, { ...record, items: nextItems });
    return outcomeOf(ref, itemId, action, nextItems.filter((candidate) => candidate.state === 'pending').length);
  }

  #decideReconciliation(
    ref: Extract<ProposalPortRef, { port: 'reconciliation' }>,
    itemId: string,
    action: PortAction,
  ): ProposalMutationOutcome {
    const service = this.#requireReconciliation();
    const proposal = requireOpenReconciliation(service, ref.proposalId);
    const known = itemIdsOf(proposal.summary);
    if (!known.has(itemId)) {
      return portError(
        'unknown item ' + itemId + ' for ' + ref.proposalId + '; known items: ' + [...known].join(', '),
      );
    }
    const ledger = loadDecisionLedger(this.#root, ref.proposalId);
    if (ledger.decisions[itemId] !== undefined) {
      return portError(
        'item ' + itemId + ' of ' + ref.proposalId + ' already decided (' + ledger.decisions[itemId]?.action + ')',
      );
    }

    const decisions: Record<string, ReconciliationDecision> = {
      ...ledger.decisions,
      [itemId]: { action, decidedAt: new Date().toISOString() },
    };

    const undecided = [...known].filter((candidate) => decisions[candidate] === undefined);
    if (undecided.length > 0) {
      persistDecisionLedger(this.#root, { ledgerVersion: 1, proposalId: ref.proposalId, decisions });
      return outcomeOf(ref, itemId, action, undecided.length);
    }

    // 全部决毕 ⇒ 一次性收口进 T5 五态终态（applied/partially_applied/dismissed 由既有服务判定）
    const accepted = Object.entries(decisions)
      .filter(([, decision]) => decision.action !== 'rejected')
      .map(([decisionItemId]) => decisionItemId);
    service.decideItems(ref.proposalId, accepted);
    try {
      unlinkSync(decisionLedgerPath(this.#root, ref.proposalId));
    } catch {
      // 缓冲已不在（外部清理）——终态已落 T5 提案仓，无需补救
    }
    return outcomeOf(ref, itemId, action, 0);
  }

  #requireReconciliation(): ReconciliationService {
    if (this.#reconciliation === undefined) {
      return portError(
        'this ProposalPort was opened without a ReconciliationService backend (pipeline-only port)',
      );
    }
    return this.#reconciliation;
  }

  #requireStyle(): StylePortBackend {
    if (this.#styleBackend === undefined) {
      return portError(
        'this ProposalPort was opened without a style backend (t51:B2) — supply deps.styleBackend',
      );
    }
    return this.#styleBackend;
  }

  /**
   * style 后端决策（t51:B2 语义精确映射）：
   *   - 永挂待决：挂起建议只经 listPending 暴露，无任何持久化/清理定时器；
   *   - 无超时自动生效：本方法之外没有任何路径会采纳建议——finish 超时逻辑不存在；
   *   - 无静默批量接受：每条建议必须单条 confirm；reject 只是放弃该条不回写。
   * reject/editAccept 对 style 后端均显式拒绝（该面只有 confirm 这一个生效动作）。
   */
  #decideStyle(
    ref: Extract<ProposalPortRef, { port: 'style' }>,
    itemId: string,
    action: PortAction,
  ): ProposalMutationOutcome {
    if (action !== 'confirmed') {
      return portError(
        'style proposals accept only confirm (t51:B2: no silent batch accept, no edit surface) — ' +
          'got ' + action + ' for ' + itemId,
      );
    }
    const backend = this.#requireStyle();
    const item = backend.listPending().find((candidate) => candidate.id === itemId);
    if (item === undefined) {
      return portError('unknown style suggestion ' + itemId + ' (listPending() is the only registry)');
    }
    backend.accept(item);
    const stillPending = backend.listPending().filter((candidate) => candidate.id !== itemId).length;
    return outcomeOf(ref, itemId, action, stillPending);
  }
}

function requireOpenReconciliation(service: ReconciliationService, proposalId: string): ReconciliationProposal & { summary: ChangeSummary } {
  const proposal = service.getProposal(proposalId);
  if (proposal === null || proposal.resolvedAt !== null || proposal.summary === null) {
    return portError('no open reconciliation proposal for id ' + proposalId);
  }
  return proposal as ReconciliationProposal & { summary: ChangeSummary };
}

function outcomeOf(ref: ProposalPortRef, itemId: string, action: PortAction, pendingItems: number): ProposalMutationOutcome {
  return { ref, itemId, action, pendingItems, finalized: pendingItems === 0 };
}

/* ----------------------------------------------------------------------------
 * 恢复读缝（模块级）：管线确认集消费给 commitChapter.appends（TrackingKind 同名族）
 * ------------------------------------------------------------------------- */

/** 确认集 → commitChapter appends 形状（族名与追踪流 kind 一一对应）。 */
export function confirmedAppendsForCommit(
  root: string,
  proposalId: string,
): Partial<Record<TrackingKind, readonly unknown[]>> {
  const port = new ProposalPort({ root });
  const grouped = port.confirmedCanonicalRows({ port: 'pipeline', proposalId });
  const appends: Partial<Record<TrackingKind, readonly unknown[]>> = {};
  for (const family of CANDIDATE_FAMILIES) {
    const rows = grouped[family] ?? [];
    if (rows.length > 0) appends[family] = rows;
  }
  return appends;
}

/** 恢复入口：全书未决提案引用（新 Port 实例同 root 打开即续接）。 */
export function listPendingProposalRefs(deps: ProposalPortDeps): ProposalPortRef[] {
  return new ProposalPort(deps).listPendingRefs();
}
