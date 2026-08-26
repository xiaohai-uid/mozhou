/**
 * AuthorPreferenceLearner 编排入口（T22 · #55；四导出收口）。
 *
 * - runPreferenceLearning：cursor 幂等续读——readPipelineLedger 全账本上下文提取
 *   （候选回溯 join 需要全窗），按 profile.cursor 过滤增量折叠；游标推进到账本
 *   末位（尾部无观测行也视为已消费）；重启续读、重放去重双保险（position 过滤
 *   + obsId 先到先得）。
 * - rebuildPreference：全量重建（幂等）——冷启动折叠全部观测 + 两份产物整表
 *   重写。验收指纹必须用排序后的内容集合哈希而非物理行序（T10b 已知陷阱：
 *   交错写入与重扫描的物理排列不同，物理行序指纹假红）。
 *
 * 快照延迟物化（t51:A2）：profile.json 只在 obsCount>0 后落盘——空账本零字节、
 * 冷启动先验不物化。R1 标量红线由 types/storage 形状保证，测试另有扫描断言。
 */
import { readPipelineLedger } from '@mozhou/pipeline';
import { extractObservations } from './features.js';
import { coldStartProfile, reduce } from './inference.js';
import type { PreferenceProfileState } from './inference.js';
import {
  appendObservations,
  loadProfileSnapshot,
  readPersistedObservations,
  rewriteObservations,
  saveProfileSnapshot,
} from './storage.js';
import type { PreferenceObservation } from './types.js';

export interface PreferenceLearningOutcome {
  readonly profile: PreferenceProfileState;
  /** 本次折叠的新观测条数（自愈路径=全量重折数）。 */
  readonly processedObservations: number;
  /** 本次是否落盘 profile.json（首批观测后物化语义）。 */
  readonly materialized: boolean;
  /** 续读模式：resume=正常增量；rebuild=冷启动/快照损坏自愈（整表重折）。 */
  readonly mode: 'resume' | 'rebuild';
}

function ledgerEndCursor(rows: ReturnType<typeof readPipelineLedger>, profile: PreferenceProfileState): PreferenceProfileState {
  const lastRow = rows[rows.length - 1];
  if (lastRow === undefined || lastRow.position <= profile.cursor) return profile;
  return { ...profile, cursor: lastRow.position };
}

/** 增量学习：读账本 → 提取 → 续读折叠 → 观测追加 + 快照物化。纯消费端零回写账本。 */
export function runPreferenceLearning(bookRoot: string): PreferenceLearningOutcome {
  const rows = readPipelineLedger(bookRoot);
  const allObservations = extractObservations(rows);
  const snapshot = loadProfileSnapshot(bookRoot);

  let profile: PreferenceProfileState;
  let fresh: readonly PreferenceObservation[];
  let mode: 'resume' | 'rebuild';

  if (snapshot === null) {
    // 冷启动 / 自愈（快照缺失或损坏）：S/W 是账本的纯函数，以账本为准整表重折
    mode = 'rebuild';
    profile = reduce(coldStartProfile(), allObservations);
    rewriteObservations(bookRoot, allObservations);
    fresh = allObservations;
  } else {
    mode = 'resume';
    const knownIds = new Set(readPersistedObservations(bookRoot).map((row) => row.obsId));
    fresh = allObservations.filter(
      (row) => row.sourcePosition > snapshot.cursor && !knownIds.has(row.obsId),
    );
    appendObservations(bookRoot, fresh);
    profile = reduce(snapshot, fresh);
  }

  profile = ledgerEndCursor(rows, profile);

  // 快照延迟物化：首批观测后才许有 profile.json 字节
  let materialized = false;
  if (profile.obsCount > 0) {
    saveProfileSnapshot(bookRoot, profile);
    materialized = true;
  }
  return { profile, processedObservations: fresh.length, materialized, mode };
}

export interface PreferenceRebuildOutcome {
  readonly profile: PreferenceProfileState;
  /** 重写进 observations.jsonl 的行数（含窗口锚）。 */
  readonly observationCount: number;
}

/**
 * 全量重建：删库级重算（幂等）。同一账本重复重建产出逐字节相同的两份产物；
 * 与增量路径行为等值（验收=排序内容集指纹 + 行为探针，见 learner.test）。
 */
export function rebuildPreference(bookRoot: string): PreferenceRebuildOutcome {
  const rows = readPipelineLedger(bookRoot);
  const observations = extractObservations(rows);
  const folded = reduce(coldStartProfile(), observations);
  const profile = ledgerEndCursor(rows, folded);
  rewriteObservations(bookRoot, observations);
  if (profile.obsCount > 0) {
    saveProfileSnapshot(bookRoot, profile);
  }
  return { profile, observationCount: observations.length };
}
