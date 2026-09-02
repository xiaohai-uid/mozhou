/**
 * @mozhou/kernel · 因果合约（CausalContract）一等领域聚合。
 * 表达仙侠/奇幻长篇中具有多方约束、对价、义务集合与违约责任的因果承诺。
 * 向通用内核投影 contract.* 派生时空事实，供 ContextCompiler 与图谱复用。
 */
import type { Brand, EntityRef, KernelEntityHead, TemporalFact } from './kernel-schema.js';

export type ContractId = Brand<`contract_${string}`, 'ContractId'>;

export type ContractPartyRole = 'creditor' | 'debtor' | 'guarantor' | 'witness' | 'beneficiary';

export interface ContractParty {
  readonly entity: EntityRef;
  readonly role: ContractPartyRole;
}

export interface ContractObligation {
  readonly obligationId: string;
  readonly debtor: EntityRef;
  readonly description: string;
  readonly consideration?: string | undefined;
  readonly isFulfilled: boolean;
}

export type ContractDeadline =
  | { readonly kind: 'chapter'; readonly chapterIndex: number }
  | { readonly kind: 'event'; readonly eventRef: string }
  | { readonly kind: 'worldTime'; readonly worldTimeOrder: number };

export type ContractStatus =
  | 'proposed'
  | 'active'
  | 'due'
  | 'fulfilled'
  | 'breached'
  | 'amended'
  | 'waived'
  | 'disputed'
  | 'terminated';

export interface CausalContract extends KernelEntityHead {
  readonly id: ContractId;
  readonly title: string;
  readonly parties: readonly ContractParty[];
  readonly obligations: readonly ContractObligation[];
  readonly deadline: ContractDeadline;
  readonly consideration?: string | undefined;
  readonly breachPenalty?: string | undefined;
  readonly status: ContractStatus;
  readonly supersedesContractId?: ContractId | undefined;
  readonly evidenceParagraph?: string | undefined;
  readonly breachDisposed?: boolean | undefined;
}

/**
 * 将因果合约投影为通用 TemporalFact 派生时空事实。
 * 使现有 ContextCompiler 与召回引擎无损复用，无需改动通用九柱存储结构。
 */
export function projectContractToTemporalFacts(contract: CausalContract): TemporalFact[] {
  const chapterAnchor = contract.deadline.kind === 'chapter' ? contract.deadline.chapterIndex : 1;
  const primaryDebtor = contract.parties.find((p) => p.role === 'debtor')?.entity ?? ('char:unknown' as EntityRef);

  const facts: TemporalFact[] = [
    {
      id: `fact_${contract.id}_status` as any,
      bookId: contract.bookId,
      revision: contract.revision,
      createdAt: contract.createdAt,
      updatedAt: contract.updatedAt,
      subject: primaryDebtor,
      predicate: `contract.status.${contract.title}`,
      value: contract.status,
      validFrom: chapterAnchor,
      validUntil: null,
      importance: 'critical',
      riskClass: 'high',
      source: { kind: 'chapter', chapterIndex: chapterAnchor },
      status: contract.status === 'proposed' ? 'candidate' : 'confirmed',
      compactedIntoVolumeId: null,
      provenance: { origin: 'author', protectedUserContent: true },
    },
  ];

  if (contract.status === 'breached') {
    facts.push({
      id: `fact_${contract.id}_breached` as any,
      bookId: contract.bookId,
      revision: contract.revision,
      createdAt: contract.createdAt,
      updatedAt: contract.updatedAt,
      subject: primaryDebtor,
      predicate: `contract.breached.${contract.title}`,
      value: contract.breachPenalty ?? '天谴因果缠身',
      validFrom: chapterAnchor,
      validUntil: null,
      importance: 'critical',
      riskClass: 'high',
      source: { kind: 'chapter', chapterIndex: chapterAnchor },
      status: 'confirmed',
      compactedIntoVolumeId: null,
      provenance: { origin: 'author', protectedUserContent: true },
    });
  }

  return facts;
}

export interface ContractAuditIssue {
  readonly contractId: ContractId;
  readonly code: 'expired_without_disposition' | 'state_contradiction';
  readonly message: string;
}

/**
 * 因果合约门禁审计：
 * 终审严格决议：违约（breached）是合法且核心的叙事走向！
 * 门禁只拦截“期限已过且无任何履约/违约/延期记录（expired_without_disposition）”或互斥状态。
 */
export function auditCausalContract(
  contract: CausalContract,
  currentChapter: number,
): ContractAuditIssue | null {
  if (contract.deadline.kind === 'chapter' && currentChapter > contract.deadline.chapterIndex) {
    // 允许的状态：fulfilled, breached (已处置), amended, waived, disputed, terminated
    if (contract.status === 'active' || contract.status === 'due') {
      return {
        contractId: contract.id,
        code: 'expired_without_disposition',
        message: `因果合约「${contract.title}」已于第 ${contract.deadline.chapterIndex} 章到期，但当前第 ${currentChapter} 章未登记履约、违约、展期或放弃记录！`,
      };
    }
  }
  return null;
}
