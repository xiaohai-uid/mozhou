/**
 * Canon Proposal 步（T18 · #42；chapter-pipeline-spec §1 表第 8 行 / S6）。
 *
 * 通过 Gate 的候选 delta → 按风险分级的提案记录。分流判据全部数据化（N1：
 * 门禁输入必须是数据不是现场判断）——
 *   - temporalFact：行自带 riskClass（冻结 Schema 字段）；
 *   - knowledgeState：继承被引事实的 riskClass（知悉秘密=秘密暴露同险）；
 *   - relationshipState：规格 Risk-Graded 阈值表「关系变动」恒 medium；
 *   - timelineEvent：取被引 impactFactIds 的最高风险；无引用即 low；
 *   - narrativePromise：status=paid_off 即 high（规格：promise pay-offs 高危），
 *     其余生命周期位与读不出 status 的字节透传行一律 medium——绝不静默自动落正典。
 *
 * 分流语义（S6）：
 *   - low 自动落 canon ⇒ 提案项入场即 confirmed（auto_canonicalized 留痕可审计）；
 *   - medium 进提案队列挂起等待程序化确认（headless 等价 panel）⇒ pending；
 *   - high 必须显式确认方可进入 Commit ⇒ pending。
 *
 * 提案记录持久化于 .mozhou/proposals/prp_<ULID>.json（运行时区，非 canon、不参与
 * 对账）：候选行随记录落盘是未确认提案跨重启待决的盘面凭据（S8 Proposal 后行；
 * 投影悬挂标记 = CanonProposalCreated#taskRef 成对头悬挂）。确认协议本体归
 * ProposalPort（proposal-port.ts），本模块只负责提案的创建与存取。
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newUlid } from '@mozhou/kernel';
import type { DomainEvent, FactId, FactRiskClass } from '@mozhou/kernel';
import type { PublishBus } from '@mozhou/runtime';
import { RUNTIME_PROPOSALS_DIR } from '@mozhou/data-plane';
import { CANDIDATE_FAMILIES } from './extract-step.js';
import type { CandidateDeltaBatch, CandidateFamily } from './extract-step.js';

/** 提案项状态机：pending（挂起待决）→ confirmed | rejected | edit_accepted（逐条粒度，ProposalPort 驱动）。 */
export type ProposalItemState = 'pending' | 'confirmed' | 'rejected' | 'edit_accepted';

export interface CanonProposalItem {
  /** 定位键：'<family>#<index>'（批内位置确定，与行内容解耦）。 */
  readonly itemId: string;
  readonly family: CandidateFamily;
  readonly riskClass: FactRiskClass;
  /** 分流路由：low 入场即 confirmed（auto_canonicalized），其余 pending 待确认。 */
  readonly state: ProposalItemState;
  /** 分流依据（审计面：为什么这一条落在这档）。 */
  readonly routingBasis: string;
  /** 候选行原样（提案后恢复的盘面凭据：重启后确认仍可拿全量载荷）。 */
  readonly row: Readonly<Record<string, unknown>>;
}

export interface CanonProposalRecord {
  readonly proposalVersion: 1;
  readonly proposalId: string;
  readonly taskRef: string;
  readonly chapterIndex: number;
  readonly createdAt: string;
  /** open = 待决/待提交；consumed = 已进 Commit（或全拒收口）——恢复扫描据此区分悬挂与已闭合。 */
  readonly state: 'open' | 'consumed';
  /** 提案收口面（markProposalConsumed 时回填）。 */
  readonly consumedAt?: string;
  readonly items: readonly CanonProposalItem[];
}

/** 风险路由违例：分流判据要求的数据缺失或非法（宁败不猜）。 */
export class ProposalRoutingError extends Error {
  override readonly name = 'ProposalRoutingError';
  constructor(detail: string) {
    super('canon proposal routing violation: ' + detail);
  }
}

const FACT_RISKS: readonly FactRiskClass[] = ['low', 'medium', 'high'];

/** 风险档位序（继承取最高用）。 */
const RISK_RANK: Record<FactRiskClass, number> = { low: 0, medium: 1, high: 2 };

function requireRowObject(row: unknown, family: string, index: number): Record<string, unknown> {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new ProposalRoutingError(family + '#' + index + ' must be a JSON object');
  }
  return row as Record<string, unknown>;
}

function riskOfClass(value: unknown, locator: string): FactRiskClass {
  if (typeof value !== 'string' || !(FACT_RISKS as readonly string[]).includes(value)) {
    throw new ProposalRoutingError(locator + ' riskClass must be low|medium|high');
  }
  return value as FactRiskClass;
}

/**
 * 风险路由纯函数。factRiskById 是「存量活跃 ∪ 本批」事实的风险表（调用方组装），
 * 认知/时间线的继承判据从这里取数。
 */
export function routeItemRisk(
  family: CandidateFamily,
  row: Record<string, unknown>,
  locator: string,
  factRiskById: ReadonlyMap<FactId, FactRiskClass>,
): { riskClass: FactRiskClass; basis: string } {
  switch (family) {
    case 'temporalFact': {
      const risk = riskOfClass(row['riskClass'], locator);
      return { riskClass: risk, basis: 'temporalFact.riskClass 自带档位' };
    }
    case 'knowledgeState': {
      const factId = row['factId'];
      if (typeof factId !== 'string') {
        throw new ProposalRoutingError(locator + ' factId must be a string');
      }
      const inherited = factRiskById.get(factId as FactId);
      if (inherited === undefined) {
        throw new ProposalRoutingError(
          locator + ' references fact ' + String(factId) + ' absent from live/batch risk table',
        );
      }
      return { riskClass: inherited, basis: 'knowledgeState 继承被引事实 riskClass=' + inherited };
    }
    case 'relationshipState':
      return { riskClass: 'medium', basis: 'Risk-Graded 阈值表：关系变动恒 medium' };
    case 'timelineEvent': {
      const refs = row['impactFactIds'];
      let max: FactRiskClass | null = null;
      if (Array.isArray(refs)) {
        for (const ref of refs) {
          if (typeof ref !== 'string') {
            throw new ProposalRoutingError(locator + ' impactFactIds entries must be strings');
          }
          const risk = factRiskById.get(ref as FactId);
          if (risk === undefined) {
            throw new ProposalRoutingError(
              locator + ' impacts fact ' + ref + ' absent from live/batch risk table',
            );
          }
          if (max === null || RISK_RANK[risk] > RISK_RANK[max]) {
            max = risk;
          }
        }
      }
      if (max === null) {
        return { riskClass: 'low', basis: 'timelineEvent 无事实引用 ⇒ low' };
      }
      return { riskClass: max, basis: 'timelineEvent 取 impactFactIds 最高风险=' + max };
    }
    case 'narrativePromise': {
      // 字节透传族的防御性读取：status 可读且为 paid_off ⇒ high（规格高危位）；
      // 其余一律 medium 进队列——绝不静默自动落正典。
      const status = row['status'];
      if (status === 'paid_off') {
        return { riskClass: 'high', basis: 'narrativePromise.status=paid_off（规格：承诺兑现高危）' };
      }
      return { riskClass: 'medium', basis: 'narrativePromise 非兑现位/状态不可读 ⇒ 队列确认' };
    }
  }
}

/* ----------------------------------------------------------------------------
 * 提案仓（.mozhou/proposals/*.json）：创建 / 存取（Port 与恢复共用）
 * ------------------------------------------------------------------------- */

function proposalsDir(root: string): string {
  return join(root, RUNTIME_PROPOSALS_DIR);
}

function proposalPath(root: string, proposalId: string): string {
  return join(proposalsDir(root), proposalId + '.json');
}

function persistProposal(root: string, record: CanonProposalRecord): void {
  mkdirSync(proposalsDir(root), { recursive: true });
  const target = proposalPath(root, record.proposalId);
  const tmp = target + '.tmp';
  writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n');
  renameSync(tmp, target);
}

/** 读回提案记录（不存在/损坏返回 null——运行时区审计容忍，真源在账本事件指针）。 */
export function loadCanonProposal(root: string, proposalId: string): CanonProposalRecord | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(proposalPath(root, proposalId), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (record['proposalVersion'] !== 1 || typeof record['proposalId'] !== 'string') return null;
    if (!Array.isArray(record['items'])) return null;
    return parsed as unknown as CanonProposalRecord;
  } catch {
    return null;
  }
}

export function listCanonProposals(root: string): CanonProposalRecord[] {
  let names: string[];
  try {
    names = readdirSync(proposalsDir(root));
  } catch {
    return [];
  }
  const loaded: CanonProposalRecord[] = [];
  for (const name of names.filter((candidate) => candidate.endsWith('.json')).sort()) {
    const record = loadCanonProposal(root, name.replace(/\.json$/, ''));
    if (record !== null) loaded.push(record);
  }
  return loaded;
}

/** 覆写保存（Port 决策落账用；创建走 createCanonProposal 保持事件配对纪律）。 */
export function saveCanonProposal(root: string, record: CanonProposalRecord): void {
  persistProposal(root, record);
}

/* ----------------------------------------------------------------------------
 * 步执行：Gate 通过的 delta → 分流提案记录落盘 + CanonProposalCreated
 * ------------------------------------------------------------------------- */

export interface RoutingCounts {
  readonly low: number;
  readonly medium: number;
  readonly high: number;
}

export interface CreateCanonProposalRequest {
  readonly bus: PublishBus;
  readonly bookRoot: string;
  /** 会话窗口任务引用（编排方从 ChapterProductionSession.taskRef 取）。 */
  readonly taskRef: string;
  readonly chapterIndex: number;
  /** 通过 Continuity Gate 的候选 delta（原样承接；本步不再核检）。 */
  readonly delta: CandidateDeltaBatch;
}

export interface CanonProposalOutcome {
  readonly proposalId: string;
  readonly items: readonly CanonProposalItem[];
  readonly routed: RoutingCounts;
}

/**
 * Canon Proposal 步执行：五族候选逐条定档 → low 入场即确认、medium/high 挂起待决
 * → 提案记录落盘（跨重启凭据）→ CanonProposalCreated 落账（成对头，Commit 闭合）。
 */
export function createCanonProposal(request: CreateCanonProposalRequest): CanonProposalOutcome {
  /* 风险表：「存量活跃 ∪ 本批」事实 id → riskClass（存量经 data-plane 折叠读路径）。 */
  const factRiskById = new Map<FactId, FactRiskClass>();
  // 本批先行收集（含尚未校验的原始行——Gate 已过，此处只取数不重验）
  const familiesWithRows = CANDIDATE_FAMILIES.filter((family) => request.delta[family] !== undefined);
  for (const family of familiesWithRows) {
    if (family !== 'temporalFact') continue;
    (request.delta[family] as readonly unknown[]).forEach((row, index) => {
      const record = requireRowObject(row, family, index);
      factRiskById.set(record['id'] as FactId, riskOfClass(record['riskClass'], family + '#' + index));
    });
  }

  const items: CanonProposalItem[] = [];
  for (const family of CANDIDATE_FAMILIES) {
    const rows = request.delta[family];
    if (rows === undefined) continue;
    rows.forEach((rawRow, index) => {
      const row = requireRowObject(rawRow, family, index);
      const locator = family + '#' + index;
      const route = routeItemRisk(family, row, locator, factRiskById);
      items.push({
        itemId: locator,
        family,
        riskClass: route.riskClass,
        // low 自动落 canon：入场即确认（auto_canonicalized）；medium/high 挂起
        state: route.riskClass === 'low' ? 'confirmed' : 'pending',
        routingBasis: route.basis,
        row,
      });
    });
  }

  const routed: RoutingCounts = {
    low: items.filter((item) => item.riskClass === 'low').length,
    medium: items.filter((item) => item.riskClass === 'medium').length,
    high: items.filter((item) => item.riskClass === 'high').length,
  };

  const record: CanonProposalRecord = {
    proposalVersion: 1,
    proposalId: 'prp_' + newUlid(),
    taskRef: request.taskRef,
    chapterIndex: request.chapterIndex,
    createdAt: new Date().toISOString(),
    state: 'open',
    items,
  };
  persistProposal(request.bookRoot, record);

  const event: DomainEvent = {
    type: 'CanonProposalCreated',
    taskRef: request.taskRef,
    chapterIndex: request.chapterIndex,
    payload: {
      proposalId: record.proposalId,
      routed,
      pendingItems: items.filter((item) => item.state === 'pending').length,
    },
  };
  request.bus.publish({ root: request.bookRoot }, event);

  return { proposalId: record.proposalId, items, routed };
}

/**
 * 提案收口：Commit 消费确认集后由编排方调用——记录翻 consumed，恢复扫描不再
 * 视其为悬挂待决。幂等：已 consumed 的提案原样返回。
 */
export function markProposalConsumed(root: string, proposalId: string): CanonProposalRecord {
  const record = loadCanonProposal(root, proposalId);
  if (record === null) {
    throw new ProposalRoutingError('no such canon proposal: ' + proposalId);
  }
  if (record.state === 'consumed') return record;
  const closed: CanonProposalRecord = { ...record, state: 'consumed', consumedAt: new Date().toISOString() };
  persistProposal(root, closed);
  return closed;
}
