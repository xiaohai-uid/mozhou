/**
 * StyleProfileStore——文风.md 唯一合法写者（T23 · #56；t51:B1 受控豁免三件套 · Contract Delta）。
 *
 * **Contract Delta（I1 受控豁免，t51:B1 批准走 Contract Delta）**：文风.md frontmatter
 * 保持 protected:true 不削弱——I1 本意是挡生成管线等无差别自动化通道，不禁飞轮自维护。
 * 豁免三件套缺一不可，本模块是唯一收口：
 *   1. 唯一合法写者 = flywheel 的 StyleProfileStore（data-plane 的 serialize/read 是
 *      纯序列化/解析，不做任何写盘）；
 *   2. 全部写路径收口到 writeStyleProfiles 单口：原子替换（atomicReplace）+ manifest
 *      条目同步（refreshManifestEntries，下游 stale 感知，user-edit-step.ts 先例）；
 *   3. 每次写盘强制伴随 StyleProfileUpdated 审计事件（审计替代禁令）：事件与写盘在
 *      同一函数内先后发生，先落盘后发事件；任一步抛错即整体上报失败（宁败不脏），
 *      调用方按 state_degraded 降级语义处理。作者手改仍走 EXTERNAL_MODIFIED 对账
 *      且永远赢（learner 读侧每次批量前重扫盘上现值作 old 基线）。
 *
 * 审计事件 payload（t48-b §4-C）：{profiles after 全量, beforeDigest, afterDigest,
 * sampleCount?, alphaUsed?, regimeChange?, rolledBackTo?}；taskRef/chapterIndex 走
 * DomainEvent 顶层槽位（t51:B5）。before 不内联（账本瘦身），回滚靠重放历史重建。
 *
 * taboo 候选侧账（.mozhou/style/taboo-candidates.json）：派生面 P1 本地优先、
 * R3 删除即重置；(词,章) 去重计数的跨批持久化载体。
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ScenarioType } from '@mozhou/kernel';
import type { DomainEvent } from '@mozhou/kernel';
import type { PublishBus } from '@mozhou/runtime';
import {
  STYLE_PROFILE_PATH,
  atomicReplace,
  emitStyleProfilesYaml,
  readStyleProfiles,
  refreshManifestEntries,
  readManifest,
  serializeStyleProfiles,
  sha256Hex,
  writeManifest,
} from '@mozhou/data-plane';
import type { StyleProfilesMap } from '@mozhou/data-plane';
import { emptyTabooCandidateState } from './style-learner.js';
import type { TabooCandidateState } from './style-learner.js';

/** taboo 候选侧账落点（.mozhou 运行时区；R3 删除即重置）。 */
export const TABOO_STATE_RELPATH = '.mozhou/style/taboo-candidates.json';

/** 审计面（updateStyleProfiles().report 字段直传；回滚场景手铸等价形状）。 */
export interface StyleWriteAudit {
  /** 本批有效正观测总数（跨场景型合计；缺省省略）。 */
  readonly sampleCount?: number;
  /** 本批学习率（0.05 / boost 0.2；缺省省略）。 */
  readonly alphaUsed?: number;
  /** regime 快速跟随标记（缺省省略）。 */
  readonly regimeChange?: boolean;
  /** 回滚锚：重放恢复到的批次号（t48-b §4-C；缺省非回滚）。 */
  readonly rolledBackTo?: number;
}

export interface WriteStyleProfilesRequest {
  readonly bus: PublishBus;
  readonly bookRoot: string;
  /** 审计事件顶层槽位（DomainEvent 词表纪律：taskRef/chapterIndex 不进 payload）。 */
  readonly taskRef: string;
  readonly chapterIndex: number;
  /** next 全量四行（调用方从 updateStyleProfiles().next 取；唯一写入口径）。 */
  readonly next: StyleProfilesMap;
  readonly audit?: StyleWriteAudit;
}

export interface WriteStyleProfilesOutcome {
  readonly beforeDigest: string;
  readonly afterDigest: string;
  readonly revisions: Readonly<Record<ScenarioType, number>>;
}

/**
 * 单口写路径：读现值（宁败不脏）→ 序列化整块替换 → 原子落盘 → manifest 同步 →
 * 强制审计事件。任何一步失败即抛，不产生半写状态（原子替换保证）。
 */
export function writeStyleProfiles(request: WriteStyleProfilesRequest): WriteStyleProfilesOutcome {
  // 读侧重扫盘上现值：作者手动改永远赢（EXTERNAL_MODIFIED 对账是权威通道）
  const raw = readFileSync(join(request.bookRoot, STYLE_PROFILE_PATH), 'utf8');
  const before = readStyleProfiles(request.bookRoot);
  const beforeDigest = sha256Hex(emitStyleProfilesYaml(before));

  const newRaw = serializeStyleProfiles(raw, request.next);
  atomicReplace(request.bookRoot, STYLE_PROFILE_PATH, newRaw);
  writeManifest(
    request.bookRoot,
    refreshManifestEntries(readManifest(request.bookRoot), request.bookRoot, [STYLE_PROFILE_PATH]),
  );

  const afterDigest = sha256Hex(emitStyleProfilesYaml(request.next));
  const audit = request.audit ?? {};
  const event: DomainEvent = {
    type: 'StyleProfileUpdated',
    taskRef: request.taskRef,
    chapterIndex: request.chapterIndex,
    payload: {
      profiles: request.next,
      beforeDigest,
      afterDigest,
      ...(audit.sampleCount === undefined ? {} : { sampleCount: audit.sampleCount }),
      ...(audit.alphaUsed === undefined ? {} : { alphaUsed: audit.alphaUsed }),
      ...(audit.regimeChange === undefined ? {} : { regimeChange: audit.regimeChange }),
      ...(audit.rolledBackTo === undefined ? {} : { rolledBackTo: audit.rolledBackTo }),
    },
  };
  request.bus.publish({ root: request.bookRoot }, event);

  return {
    beforeDigest,
    afterDigest,
    revisions: {
      action: request.next.action.revision,
      dialogue: request.next.dialogue.revision,
      romance_emotion: request.next.romance_emotion.revision,
      exposition_worldbuilding: request.next.exposition_worldbuilding.revision,
    },
  };
}

/* ----------------------------------------------------------------------------
 * taboo 候选侧账（(词,章) 去重计数的跨批持久化载体）
 * ------------------------------------------------------------------------- */

function isTabooState(value: unknown): value is TabooCandidateState {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return ['action', 'dialogue', 'romance_emotion', 'exposition_worldbuilding'].every((key) =>
    Array.isArray(record[key]),
  );
}

/** 缺文件 = 空白状态（首次建账）；损坏宁败不脏（派生面坏账必须响亮）。 */
export function loadTabooCandidateState(bookRoot: string): TabooCandidateState {
  let raw: string;
  try {
    raw = readFileSync(join(bookRoot, TABOO_STATE_RELPATH), 'utf8');
  } catch {
    return emptyTabooCandidateState();
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isTabooState(parsed)) {
    throw new Error('taboo 候选侧账形状违例（须四场景型数组）: ' + TABOO_STATE_RELPATH);
  }
  return parsed;
}

export function saveTabooCandidateState(bookRoot: string, state: TabooCandidateState): void {
  mkdirSync(dirname(join(bookRoot, TABOO_STATE_RELPATH)), { recursive: true }); // atomicReplace 不建父目录
  atomicReplace(bookRoot, TABOO_STATE_RELPATH, JSON.stringify(state, null, 2) + '\n');
}
