/**
 * StyleLearner 学习核（T23 · #56；t51:B6 / t48-b §3-§4 / 规格 §4「风格」常量行）。
 *
 * 纯函数核：old 画像 + 本章批次观测 ⇒ next 画像 + 审计报告。零时钟零 IO——
 * 持久化归 StyleProfileStore 单口（style-store.ts），触发点归 Flywheel Record 步
 * （record-step 后调用，失败降级不阻断正文）。
 *
 * 机械可学面（t48-b §3 诚实降级）：V1 仅 dialogueRatio + sentenceLengthDistribution
 * （有确定性统计定义）+ tabooWords（计数转正）三项自动演化；
 * sensoryDensity/actionPacing 无机械算法维度，保持种子空值，其更新仅走 LLM 旁路
 * 建议 + 作者确认（ProposalPort {port:'style'} 永挂待决契约）——宁缺毋滥，不做伪精确。
 *
 * 观测语义（t48-b §3 信号价值分层）：
 *   - replace/insert 新文本 = 正观测（作者亲笔改写/主动添加）；
 *   - delete 被删词 = tabooWords 负观测（词级，P0 片段禁止入内核——R1 标量红线）；
 *   - 「保留不动」在观测提取器层即不发观测 ⇒ 结构性零计入 EMA（计入会自证循环）；
 *   - 场景归类（edit block → scenarioType）是上游分类器职责，置信阈值/触发词表
 *     DEFER 台架校准票（t51:B3）——本核只消费已归类观测，低置信整批不上桌。
 *
 * 护栏（规格 §4 风格行 / t51:B6）：
 *   - EMA α=0.05；二档 regimeBoost α=0.2（R_high/K 判定 DEFER 台架票——机制在此，
 *     由调用方判定后显式声明，报告打 regimeChange 标记供审计事件 payload 携带）；
 *   - Δmax=0.1 单批位移钳制：常规 α 下数学上恒不激活（最大位移 α·dist ≤ 0.05 < 0.1），
 *     真实作用域是 boost 期过冲保险丝；
 *   - Nmin=10：场景型有效正观测 <10 则该型数值分面本批不更新（taboo 计数独立进行，
 *     其转正判据自带跨章门槛，不受样本门约束）；
 *   - taboo 转正：(词, 章) 去重计数，跨 ≥2 章 且 ≥3 次 ⇒ 转正；表容量 50，FIFO 让位；
 *   - 分布桶边界沿用行上既有边界永不动（分布可比性），EMA 后重归一化使 Σshare ≈ 1。
 *
 * revision 语义（Q14）：vN = KernelEntityHead.revision，按章批次递增——仅实际变化
 * 的行 +1（四场景型独立演化含独立版本史；未动行字节级不变、引用复用可断言）。
 * 回滚 = 重放 ledger 历史 after 值覆写 + revision 继续 +1（纯函数重放确定性由测试钉死）。
 */
import type { ScenarioType } from '@mozhou/kernel';
import type { StyleProfileRow, StyleProfilesMap } from '@mozhou/data-plane';

/** EMA 学习率（ADR-0012 已裁；规格 §4）。 */
export const STYLE_ALPHA = 0.05;
/** regime 快速跟随档学习率（t48-b §4-B 二档学习率；R_high/K 判定 DEFER 台架票）。 */
export const STYLE_ALPHA_BOOST = 0.2;
/** 单批位移钳制上限——仅 boost 期真实生效的过冲保险丝（t51:B6）。 */
export const STYLE_DELTA_MAX = 0.1;
/** 场景型有效正观测最小样本门：不足则该型数值分面本批不更新。 */
export const STYLE_NMIN = 10;
/** taboo 转正跨章门槛：命中章节 ≥2。 */
export const TABOO_PROMOTION_MIN_CHAPTERS = 2;
/** taboo 转正命中次数门槛：（词,章) 去重后总命中 ≥3。 */
export const TABOO_PROMOTION_MIN_HITS = 3;
/** tabooWords 表容量上限（防 structural 注入段膨胀）。 */
export const TABOO_CAPACITY = 50;

/**
 * 单条编辑观测——触发点从 UserEditRecorded 结构化块机械提取后的形态。
 * R1 标量红线：只携带标量统计与词级词条，任何 P0 正文片段禁止进入本接口
 * （提取器负责把新文本折算成标量、把被删文本切成语词条再喂进来）。
 */
export interface StyleEditObservation {
  readonly scenarioType: ScenarioType;
  /** 观测章次（taboo (词,章) 去重计数键）。 */
  readonly chapterIndex: number;
  /** replace/insert=positive；delete=negative。「保留不动」不产生观测。 */
  readonly polarity: 'positive' | 'negative';
  /** 正观测可选标量：新文本对话字符占比 [0,1]。缺省 = 该维本条不参与。 */
  readonly dialogueRatio?: number;
  /** 正观测可选标量：新文本句长序列（字数；按行上种子桶边界归桶）。 */
  readonly sentenceLengths?: readonly number[];
  /** 负观测词级词条：被删文本中的候选禁忌词（同一观测内重复词由提取器去重）。 */
  readonly deletedWords?: readonly string[];
}

/** taboo 候选累计状态（(词,章) 去重计数；派生面，随画像同批持久化）。 */
export interface TabooCandidateEntry {
  readonly word: string;
  readonly totalHits: number;
  /** 命中过的章次（去重升序）。 */
  readonly chapters: readonly number[];
}

export type TabooCandidateState = Readonly<Record<ScenarioType, readonly TabooCandidateEntry[]>>;

/** 空白 taboo 状态（首次建账用）。 */
export function emptyTabooCandidateState(): TabooCandidateState {
  return {
    action: [],
    dialogue: [],
    romance_emotion: [],
    exposition_worldbuilding: [],
  };
}

export interface UpdateStyleProfilesOptions {
  /**
   * regime 快速跟随开关（t48-b §4-B 三件套之③）：R_high/K 判定 DEFER 台架校准票，
   * 本核只提供机制——调用方判定后显式声明。true ⇒ α=0.2 且 Δmax 保险丝生效，
   * 报告 regimeChange=true（审计事件 payload 据此打标）。
   */
  readonly regimeBoost?: boolean;
  /** 上批结转的 taboo 候选状态；缺省视作空白（首次建账）。 */
  readonly tabooState?: TabooCandidateState;
}

/** 单场景型本批结局（审计报告分面）。 */
export interface ScenarioBatchOutcome {
  /** 有效正观测数（Nmin 门计数口径）。 */
  readonly sampleCount: number;
  /** 该型画像行是否发生任何变化（含 taboo 转正；决定 revision 是否 +1）。 */
  readonly updated: boolean;
  /** 未做数值更新的原因（taboo 转正仍可能发生）。 */
  readonly skipReason?: 'nmin_not_met' | 'no_observations';
}

/** 本批转正词条（扁平审计面；StyleProfileUpdated payload 直接取用）。 */
export interface TabooPromotion {
  readonly scenarioType: ScenarioType;
  readonly word: string;
  readonly hits: number;
  readonly chapterCount: number;
}

export interface StyleUpdateReport {
  /** 本批实际使用的学习率（0.05 或 boost 0.2）。 */
  readonly alphaUsed: number;
  /** regime 快速跟随标记（调用方声明 boost 即打标，供事件 payload 透传）。 */
  readonly regimeChange: boolean;
  readonly outcomes: Readonly<Record<ScenarioType, ScenarioBatchOutcome>>;
  readonly tabooPromotions: readonly TabooPromotion[];
  /** 结转 taboo 状态（含本批新增计数；已转正词条剪除防侧账膨胀）。 */
  readonly nextTabooState: TabooCandidateState;
}

export interface StyleUpdateResult {
  readonly next: StyleProfilesMap;
  readonly report: StyleUpdateReport;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 六位小数量化：消浮点尾垃圾，保证 YAML 发射逐字节确定（String(value) 直印）。 */
function round6(value: number): number {
  const rounded = Math.round(value * 1e6) / 1e6;
  return rounded === 0 ? 0 : rounded; // 消 -0
}

function mean(values: readonly number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** 句长按行上桶边界归桶：首个 maxLengthChars ≥ 长度的桶；超末界落末桶。 */
function bucketShares(lengths: readonly number[], buckets: readonly { readonly maxLengthChars: number }[]): number[] {
  const counts = buckets.map(() => 0);
  for (const length of lengths) {
    let index = buckets.findIndex((b) => length <= b.maxLengthChars);
    if (index === -1) index = buckets.length - 1;
    counts[index] = (counts[index] ?? 0) + 1;
  }
  const total = lengths.length;
  return counts.map((count) => count / total);
}

/** 六位量化后把残差记到最大份额桶，保证 Σshare ≈ 1 达解析容差 1e-6 内。 */
function normalizeShares(shares: readonly number[]): number[] {
  const rounded = shares.map(round6);
  let sum = 0;
  let maxIndex = 0;
  for (let i = 0; i < rounded.length; i += 1) {
    const value = rounded[i] ?? 0;
    sum += value;
    if (value > (rounded[maxIndex] ?? 0)) maxIndex = i;
  }
  const residual = round6(1 - sum);
  rounded[maxIndex] = round6((rounded[maxIndex] ?? 0) + residual);
  return rounded;
}

function mergeTabooHits(
  entries: readonly TabooCandidateEntry[],
  negatives: readonly StyleEditObservation[],
): TabooCandidateEntry[] {
  const merged = entries.map((entry) => ({ ...entry }));
  for (const obs of negatives) {
    const words = obs.deletedWords ?? [];
    const seenInObs = new Set<string>();
    for (const word of words) {
      if (seenInObs.has(word)) continue; // (词,章) 去重的观测内侧
      seenInObs.add(word);
      const existing = merged.find((entry) => entry.word === word);
      if (existing !== undefined) {
        existing.totalHits += 1;
        if (!existing.chapters.includes(obs.chapterIndex)) {
          merged[merged.indexOf(existing)] = {
            ...existing,
            chapters: [...existing.chapters, obs.chapterIndex].sort((a, b) => a - b),
          };
        }
      } else {
        merged.push({ word, totalHits: 1, chapters: [obs.chapterIndex] });
      }
    }
  }
  return merged;
}

/**
 * 学习核主入口：本章批次 ⇒ 四场景型独立分面演化。
 * 未变化行原对象复用（字节级不变可断言）；分布桶边界永不动。
 */
export function updateStyleProfiles(
  old: StyleProfilesMap,
  batch: readonly StyleEditObservation[],
  options: UpdateStyleProfilesOptions = {},
): StyleUpdateResult {
  const alpha = options.regimeBoost === true ? STYLE_ALPHA_BOOST : STYLE_ALPHA;
  const regimeChange = options.regimeBoost === true;

  const nextRows: Record<ScenarioType, StyleProfileRow> = { ...old };
  const outcomes = {} as Record<ScenarioType, ScenarioBatchOutcome>;
  const promotions: TabooPromotion[] = [];
  const nextTaboo = {} as Record<ScenarioType, readonly TabooCandidateEntry[]>;

  for (const scenarioType of Object.keys(old) as ScenarioType[]) {
    const row = old[scenarioType];
    const obs = batch.filter((o) => o.scenarioType === scenarioType);
    const positives = obs.filter((o) => o.polarity === 'positive');
    const negatives = obs.filter((o) => o.polarity === 'negative');

    // ---- taboo 候选累计与转正（独立于 Nmin 样本门） ----
    let candidates = mergeTabooHits(options.tabooState?.[scenarioType] ?? [], negatives);
    const promotedWords: string[] = [];
    for (const candidate of candidates) {
      if (row.tabooWords.includes(candidate.word)) continue; // 已在表内不再重复转正
      if (
        candidate.chapters.length >= TABOO_PROMOTION_MIN_CHAPTERS &&
        candidate.totalHits >= TABOO_PROMOTION_MIN_HITS
      ) {
        promotedWords.push(candidate.word);
        promotions.push({
          scenarioType,
          word: candidate.word,
          hits: candidate.totalHits,
          chapterCount: candidate.chapters.length,
        });
      }
    }
    // 已转正词条剪出侧账（后续命中无害：includes 检查挡重复转正）
    candidates = candidates.filter(
      (candidate) => candidate.word === undefined || !promotedWords.includes(candidate.word),
    );
    nextTaboo[scenarioType] = candidates;

    let tabooWords = row.tabooWords;
    if (promotedWords.length > 0) {
      const grown = [...row.tabooWords, ...promotedWords];
      tabooWords = grown.slice(Math.max(0, grown.length - TABOO_CAPACITY)); // FIFO 让位
    }

    // ---- 数值分面 EMA（Nmin 门） ----
    let dialogueRatio = row.dialogueRatio;
    let distribution = row.sentenceLengthDistribution;
    let numericChanged = false;
    const sampleCount = positives.length;
    let skipReason: 'nmin_not_met' | 'no_observations' | undefined;

    if (sampleCount === 0) {
      skipReason = 'no_observations';
    } else if (sampleCount < STYLE_NMIN) {
      skipReason = 'nmin_not_met';
    } else {
      const dlgObserved = positives
        .map((o) => o.dialogueRatio)
        .filter((v): v is number => v !== undefined);
      if (dlgObserved.length > 0) {
        const raw = (1 - alpha) * row.dialogueRatio + alpha * mean(dlgObserved);
        const boundedDelta = Math.max(
          -STYLE_DELTA_MAX,
          Math.min(STYLE_DELTA_MAX, clamp01(raw) - row.dialogueRatio),
        );
        const nextValue = round6(row.dialogueRatio + boundedDelta);
        if (nextValue !== row.dialogueRatio) {
          dialogueRatio = nextValue;
          numericChanged = true;
        }
      }

      const lengths = positives.flatMap((o) => o.sentenceLengths ?? []);
      if (lengths.length > 0) {
        const observed = bucketShares(lengths, row.sentenceLengthDistribution);
        const emed = row.sentenceLengthDistribution.map((bucket, i) => {
          const oldShare = bucket.share;
          const raw = (1 - alpha) * oldShare + alpha * (observed[i] ?? 0);
          const boundedDelta = Math.max(-STYLE_DELTA_MAX, Math.min(STYLE_DELTA_MAX, raw - oldShare));
          return { maxLengthChars: bucket.maxLengthChars, share: oldShare + boundedDelta };
        });
        const normalized = normalizeShares(emed.map((b) => b.share));
        const nextBuckets = emed.map((bucket, i) => ({
          maxLengthChars: bucket.maxLengthChars,
          share: normalized[i] ?? bucket.share,
        }));
        if (normalized.some((share, i) => share !== row.sentenceLengthDistribution[i]?.share)) {
          distribution = nextBuckets;
          numericChanged = true;
        }
      }
    }

    const updated = numericChanged || tabooWords !== row.tabooWords;
    outcomes[scenarioType] = {
      sampleCount,
      updated,
      ...(skipReason === undefined ? {} : { skipReason }),
    };

    nextRows[scenarioType] = updated
      ? { ...row, revision: row.revision + 1, dialogueRatio, sentenceLengthDistribution: distribution, tabooWords }
      : row; // 未动行原对象复用：字节级不变
  }

  return {
    next: nextRows,
    report: { alphaUsed: alpha, regimeChange, outcomes, tabooPromotions: promotions, nextTabooState: nextTaboo },
  };
}
