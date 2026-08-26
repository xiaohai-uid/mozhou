/**
 * 七维特征提取（T22 · #55；t51:A4 最小面冻结）。
 *
 * extractObservations(rows)：PipelineLedgerRow → PreferenceObservation[]。
 * 读面（纯只读，t52:B6）：candidate_decision accepted/rejected 双路强信号 +
 * UserEditRecorded{action:'edit_blocks'}（source==='author' 过滤——assistant
 * 回写通道是机器写回非人偏好，整体排除）+ FlywheelRecorded（窗口闭合锚，
 * w=0 不入偏好向量，只供 degradedWindows 计数）。
 *
 * 防御性重验 F1 三条件（双路非空/不相交/候选 id 可回溯同窗口 CandidateCreated）：
 * 写入侧已机械保证，消费侧再验一次宁败不猜——不合法形态静默跳过（不是信号就
 * 不是观测），绝不臆造默认值。词表依赖型特征（动作动词密度等）显式出界不做。
 *
 * 特征全部即算即弃：正文片段只在内存中瞬时参与计算，产物仅标量（R1）。
 */
import type { PipelineLedgerRow } from '@mozhou/pipeline';
import { W_DECISION, W_EDIT_DELETE, W_EDIT_PROSE } from './types.js';
import type { EditActionLevelV1, ObservationKind, PreferenceDim, PreferenceObservation } from './types.js';

const LEVELS_V1: readonly string[] = ['cursor', 'selection'];

function narrowLevel(value: unknown): EditActionLevelV1 | undefined {
  return typeof value === 'string' && LEVELS_V1.includes(value)
    ? (value as EditActionLevelV1)
    : undefined;
}

/* ---------------------------------------------------------------------------
 * 文本特征原料（f1/f2/f3/f5）——确定性直写定义（t47-a §2.1）
 * ------------------------------------------------------------------------- */

const SENTENCE_DELIMITERS = /[。！？…]+/;

/** f1/f2 原料：按 。！？… 切句后的码点长度表（空白修剪，空句丢弃）。 */
export function sentenceLengths(text: string): number[] {
  return text
    .split(SENTENCE_DELIMITERS)
    .map((piece) => [...piece.trim()].length)
    .filter((length) => length > 0);
}

/** 最近邻秩分位（确定性）：升序第 ⌈q·n⌉ 个。 */
export function nearestRankPercentile(sortedAsc: readonly number[], q: number): number | undefined {
  if (sortedAsc.length === 0) return undefined;
  const rank = Math.ceil(q * sortedAsc.length);
  const index = Math.min(rank - 1, sortedAsc.length - 1);
  const picked = sortedAsc[index];
  return picked === undefined ? undefined : picked;
}

const QUOTE_OPEN = new Set(['「', '『', '“']);
const QUOTE_CLOSE = new Set(['」', '』', '”']);

/** f3：引号内字符数 / 总字符数（码点口径；引号字形本身不计入分子也不计入分母外——在总字符内但不属引号内字符）。 */
export function dialogueCharRatio(text: string): number | undefined {
  let total = 0;
  let inner = 0;
  let depth = 0;
  for (const ch of text) {
    total += 1;
    if (QUOTE_OPEN.has(ch)) {
      depth += 1;
      continue;
    }
    if (QUOTE_CLOSE.has(ch)) {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (depth > 0) inner += 1;
  }
  return total > 0 ? inner / total : undefined;
}

const LATIN_RUN = /[A-Za-z0-9]/;

/** 词元流：CJK 单字 + 拉丁连续词元（双重计数口径，t47-a f5）。 */
export function tokenizeUnits(text: string): string[] {
  const units: string[] = [];
  let latin = '';
  const flush = () => {
    if (latin.length > 0) {
      units.push(latin);
      latin = '';
    }
  };
  for (const ch of text) {
    if (LATIN_RUN.test(ch)) {
      latin += ch;
      continue;
    }
    flush();
    units.push(ch);
  }
  flush();
  return units;
}

const TTR_WINDOW = 500;

/** f5：500 词元窗 type-token 比（步长=窗长的不重叠切分，尾窗照计），全窗均值。 */
export function ttrWin500(text: string): number | undefined {
  const units = tokenizeUnits(text);
  if (units.length === 0) return undefined;
  let ttrSum = 0;
  let windows = 0;
  for (let start = 0; start < units.length; start += TTR_WINDOW) {
    const size = Math.min(TTR_WINDOW, units.length - start);
    ttrSum += new Set(units.slice(start, start + TTR_WINDOW)).size / size;
    windows += 1;
  }
  return ttrSum / windows;
}

/** 文本侧四特征（f1/f2/f3/f5）；无有效句子则空表。 */
function textFeatures(text: string): Partial<Record<PreferenceDim, number>> {
  const features: Partial<Record<PreferenceDim, number>> = {};
  const lengths = sentenceLengths(text);
  if (lengths.length === 0) return features;
  features['sent_len_mean'] = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
  const p90 = nearestRankPercentile([...lengths].sort((a, b) => a - b), 0.9);
  if (p90 !== undefined) features['sent_len_p90'] = p90;
  const dlg = dialogueCharRatio(text);
  if (dlg !== undefined) features['dlg_char_ratio'] = dlg;
  const ttr = ttrWin500(text);
  if (ttr !== undefined) features['ttr_win500'] = ttr;
  return features;
}

/* ---------------------------------------------------------------------------
 * 结构块特征（f4/f6/f7）
 * ------------------------------------------------------------------------- */

/** 行数（与 user-edit-step replacementLines 同语义：剥尾换行空元素）。 */
function lineCount(text: string): number {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.length;
}

interface NarrowedBlock {
  readonly op: 'insert' | 'delete' | 'replace';
  readonly paragraphStart: number;
  readonly paragraphEnd: number;
  readonly replacementText?: string;
}

/** 操作块防御性收窄（镜像 user-edit-step validateBlock 形状；坏块跳过不臆测）。 */
function narrowBlock(value: unknown): NarrowedBlock | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const op = raw['op'];
  if (op !== 'insert' && op !== 'delete' && op !== 'replace') return undefined;
  const paragraphStart = raw['paragraphStart'];
  const paragraphEnd = raw['paragraphEnd'];
  if (typeof paragraphStart !== 'number' || typeof paragraphEnd !== 'number') return undefined;
  const replacementText = raw['replacementText'];
  if (op === 'delete') {
    // delete 不得携带 replacementText（producer 形状禁止；带即违例块）
    return replacementText === undefined
      ? { op, paragraphStart, paragraphEnd }
      : undefined;
  }
  if (typeof replacementText !== 'string') return undefined;
  return { op, paragraphStart, paragraphEnd, replacementText };
}

/**
 * f4 段长跨度：delete/replace 取区间行数（end−start+1）；insert 是单点操作、
 * 区间恒 1 无信息量，取 replacementText 行数（t47-a f4 定义原文）。
 */
function paragraphSpan(block: NarrowedBlock): number {
  if (block.op === 'insert') {
    return Math.max(lineCount(block.replacementText ?? ''), 1);
  }
  return block.paragraphEnd - block.paragraphStart + 1;
}

/** f7 语境位：cursor 记 1 / selection 记 0——κ₀ 加权后验均值即语境占比。 */
function levelBit(level: EditActionLevelV1): number {
  return level === 'cursor' ? 1 : 0;
}

/* ---------------------------------------------------------------------------
 * 观测提取主流程
 * ------------------------------------------------------------------------- */

function candidateKey(taskRef: string, candidateId: string): string {
  return `${taskRef}|${candidateId}`;
}

/** CandidateCreated 元数据回溯表：taskRef|candidateId → chars（账本只携带元数据，候选原文不落账）。 */
function collectCandidateChars(rows: readonly PipelineLedgerRow[]): Map<string, number> {
  const charsById = new Map<string, number>();
  for (const row of rows) {
    if (row.kind !== 'task' || row.event.type !== 'CandidateCreated') continue;
    const payload = row.event.payload ?? {};
    const candidateId = payload['candidateId'];
    const chars = payload['chars'];
    if (typeof candidateId === 'string' && typeof chars === 'number') {
      charsById.set(candidateKey(row.event.taskRef, candidateId), chars);
    }
  }
  return charsById;
}

function stringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return undefined;
    items.push(item);
  }
  return items;
}

/**
 * candidate_decision 观测：f6 = Σchars(acc)/n_acc − Σchars(rej)/n_rej（长度偏好，
 * 按 level 语境随行记录）+ f7。任一 F1 条件或回溯失败 ⇒ undefined（跳过）。
 */
function decisionObservation(
  position: number,
  taskRef: string,
  chapterIndex: number | undefined,
  level: EditActionLevelV1,
  payload: Readonly<Record<string, unknown>>,
  charsById: Map<string, number>,
): PreferenceObservation | undefined {
  const accepted = stringArray(payload['acceptedOptionIds']);
  const rejected = stringArray(payload['rejectedOptionIds']);
  if (accepted === undefined || rejected === undefined) return undefined;
  if (accepted.length === 0 || rejected.length === 0) return undefined; // 单路不是偏好对
  if (accepted.some((id) => rejected.includes(id))) return undefined;   // 不相交
  let acceptedSum = 0;
  for (const id of accepted) {
    const chars = charsById.get(candidateKey(taskRef, id));
    if (chars === undefined) return undefined; // 凭空决策不是信号
    acceptedSum += chars;
  }
  let rejectedSum = 0;
  for (const id of rejected) {
    const chars = charsById.get(candidateKey(taskRef, id));
    if (chars === undefined) return undefined;
    rejectedSum += chars;
  }
  const features: Partial<Record<PreferenceDim, number>> = {
    cand_len_diff: acceptedSum / accepted.length - rejectedSum / rejected.length,
    level_ratio: levelBit(level),
  };
  return {
    obsId: String(position),
    sourcePosition: position,
    kind: 'candidate_decision',
    taskRef,
    ...(chapterIndex === undefined ? {} : { chapterIndex }),
    level,
    sceneType: null,
    features,
    w: W_DECISION,
  };
}

/** edit_blocks 单块观测：insert/replace 带文本四特征，delete 只带位置统计（弱负样本档 w=0.15）。 */
function editBlockObservation(
  position: number,
  blockIndex: number,
  taskRef: string,
  chapterIndex: number | undefined,
  level: EditActionLevelV1,
  blockValue: unknown,
): PreferenceObservation | undefined {
  const block = narrowBlock(blockValue);
  if (block === undefined) return undefined;
  const kind: ObservationKind =
    block.op === 'delete' ? 'edit_delete' : block.op === 'insert' ? 'edit_insert' : 'edit_replace';
  const features: Partial<Record<PreferenceDim, number>> =
    block.replacementText === undefined ? {} : { ...textFeatures(block.replacementText) };
  features['para_line_span'] = paragraphSpan(block);
  features['level_ratio'] = levelBit(level);
  return {
    obsId: `${position}:${blockIndex}`,
    sourcePosition: position,
    kind,
    taskRef,
    ...(chapterIndex === undefined ? {} : { chapterIndex }),
    level,
    sceneType: null,
    features,
    w: kind === 'edit_delete' ? W_EDIT_DELETE : W_EDIT_PROSE,
  };
}

/**
 * 全账本观测提取（rows 即 readPipelineLedger 输出，position 权威序原样保留）。
 * 纯函数：同一账本输入永远产出逐字节相同的观测序列（rebuild 幂等的前提）。
 */
export function extractObservations(rows: readonly PipelineLedgerRow[]): PreferenceObservation[] {
  const charsById = collectCandidateChars(rows);
  const observations: PreferenceObservation[] = [];
  for (const row of rows) {
    if (row.kind !== 'task') continue;
    const event = row.event;

    // FlywheelRecorded：窗口闭合锚（F3——零偏好内容，w=0；degraded 窗口供审计计数）
    if (event.type === 'FlywheelRecorded') {
      const payload = event.payload ?? {};
      observations.push({
        obsId: String(row.position),
        sourcePosition: row.position,
        kind: 'window_anchor',
        taskRef: event.taskRef,
        ...(event.chapterIndex === undefined ? {} : { chapterIndex: event.chapterIndex }),
        sceneType: null,
        features: {},
        w: 0,
        degraded: payload['outcome'] === 'state_degraded',
        ...(typeof payload['commitId'] === 'string' ? { commitId: payload['commitId'] } : {}),
      });
      continue;
    }

    if (event.type !== 'UserEditRecorded') continue;
    const payload = event.payload ?? {};
    const level = narrowLevel(payload['level']);
    if (level === undefined) continue; // 越级/缺失动作位不是合法 V1 信号

    if (payload['action'] === 'candidate_decision') {
      const observation = decisionObservation(row.position, event.taskRef, event.chapterIndex, level, payload, charsById);
      if (observation !== undefined) observations.push(observation);
      continue;
    }

    if (payload['action'] === 'edit_blocks') {
      if (payload['source'] !== 'author') continue; // assistant 回写整体排除（F2/K1 消费者侧责任）
      const blocks = payload['blocks'];
      if (!Array.isArray(blocks)) continue;
      blocks.forEach((blockValue, blockIndex) => {
        const observation = editBlockObservation(row.position, blockIndex, event.taskRef, event.chapterIndex, level, blockValue);
        if (observation !== undefined) observations.push(observation);
      });
    }
  }
  return observations;
}
