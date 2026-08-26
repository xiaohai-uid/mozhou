/**
 * StyleLearner 触发点编排（T23 · #56；t48-b §6-C）。
 *
 * 依赖方向纪律：flywheel → pipeline（读 ledger），pipeline 不 import flywheel——
 * Flywheel Record 步的 afterRecord 钩子（record-step.ts）由编排方注入本函数。
 *
 * 流程：readPipelineLedger 按 taskRef 滤本窗口 UserEditRecorded({action:'edit_blocks',
 * source:'author'}) → 从结构化块机械提取 StyleEditObservation（replace/insert=正、
 * delete→deletedWords 负；R1 标量红线：只折算标量/词级，P0 片段禁止入接口）→
 * updateStyleProfiles（EMA 核）→ writeStyleProfiles 单口（原子替换+审计事件）。
 * taboo 候选侧账随批存取（.mozhou/style/taboo-candidates.json；R3 删除即重置）。
 *
 * 零时钟零外部服务：全部注入（bus/nowIso 显式）；抛错即整体失败（宁败不脏），
 * 调用方（afterRecord 钩子）按 S12 降级语义处理，不吞掉 FlywheelRecorded 事件。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readPipelineLedger } from '@mozhou/pipeline';
import { readStyleProfiles } from '@mozhou/data-plane';
import type { PublishBus } from '@mozhou/runtime';
import type { ScenarioType } from '@mozhou/kernel';
import {
  emptyTabooCandidateState,
  updateStyleProfiles,
} from './style-learner.js';
import type {
  StyleEditObservation,
  StyleUpdateResult,
  TabooCandidateState,
} from './style-learner.js';
import {
  TABOO_STATE_RELPATH,
  loadTabooCandidateState,
  saveTabooCandidateState,
  writeStyleProfiles,
} from './style-store.js';

export interface RunStyleLearnerRequest {
  readonly bus: PublishBus;
  readonly bookRoot: string;
  /** 会话窗口 taskRef：只处理本窗口的 author 编辑。 */
  readonly taskRef: string;
  /** 审计事件顶层槽位。 */
  readonly chapterIndex: number;
  /** regime 快速跟随（DEFER 台架票回填前调用方等价判定；缺省 false）。 */
  readonly regimeBoost?: boolean;
}

export interface RunStyleLearnerOutcome extends StyleUpdateResult {
  readonly observations: number;
  /** 无任何 author 编辑行时 true（窗口没有风格信号，不产生写盘）。 */
  readonly noEdits: boolean;
}

function rec(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** 行块 → 观测序列。观测口径=句粒度（style-learner Nmin 按 positives.length 计数）：
 *  insert/replace 新文本逐句一条正观测（句长标量+整块对话比）；delete 一条负观测。
 *  R1 红线：只折算标量/词级，P0 片段禁止进入接口。 */
function observationsFromBlock(
  block: Record<string, unknown>,
  scenarioType: ScenarioType,
  chapterIndex: number,
): StyleEditObservation[] {
  const op = block['op'];
  const replacementText = block['replacementText'];
  const removedText = block['removedText'];
  if (op === 'insert' || op === 'replace') {
    const text = typeof replacementText === 'string' ? replacementText : '';
    const sentences = splitProseSentences(text);
    if (sentences.length === 0) return [];
    const ratio = dialogueRatioOf(text);
    return sentences.map((length) => ({
      scenarioType,
      chapterIndex,
      polarity: 'positive',
      sentenceLengths: [length],
      dialogueRatio: ratio,
    }));
  }
  if (op === 'delete') {
    const removed = typeof removedText === 'string' ? removedText : '';
    const words = tokenizeTabooWords(removed);
    if (words.length === 0) return [];
    return [{
      scenarioType,
      chapterIndex,
      polarity: 'negative',
      deletedWords: words,
    }];
  }
  return [];
}

/** 按句读切分（顿号/句号/分号/感叹/问号/换行）；退回整段单句。 */
function splitProseSentences(text: string): number[] {
  if (text.length === 0) return [];
  // 显式 [\n] 而非源码换行——正则字面量内不允许裸换行
  return text
    .split(/[。！？；\u000a]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => part.length);
}

/** 对话字符占比：引号包裹片段字符数 / 总字符数（[0,1] 粗估）。 */
function dialogueRatioOf(text: string): number {
  if (text.length === 0) return 0;
  let dialogChars = 0;
  let inQuote = false;
  for (const ch of text) {
    if (ch === '“' || ch === '”' || ch === '"' || ch === '「' || ch === '」') {
      inQuote = !inQuote;
    } else if (inQuote) {
      dialogChars += 1;
    }
  }
  return dialogChars / text.length;
}

/** 被删文本词级切词：中文 2+ 字连续子串视为候选词条（简单机械法；词表校准归 DEFER 台架票）。 */
function tokenizeTabooWords(text: string): string[] {
  if (text.length === 0) return [];
  const tokens = text.match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    if (!seen.has(token)) {
      seen.add(token);
      out.push(token);
    }
  }
  return out;
}

export function runStyleLearnerForWindow(request: RunStyleLearnerRequest): RunStyleLearnerOutcome {
  const ledger = readPipelineLedger(request.bookRoot);
  const observations: StyleEditObservation[] = [];

  for (const row of ledger) {
    if (row.kind !== 'task') continue;
    const event = row.event;
    if (event.type !== 'UserEditRecorded') continue;
    if (event.taskRef !== request.taskRef) continue;
    const payload = rec(event.payload);
    if (payload === undefined || payload['action'] !== 'edit_blocks') continue;
    if (payload['source'] !== 'author') continue; // assistant 回写不是人偏好（t47-a F2）
    const chapterIndex = typeof event.chapterIndex === 'number' ? event.chapterIndex : request.chapterIndex;
    const scenarioType = pickScenarioType(payload, chapterIndex);
    const blocks = Array.isArray(payload['blocks']) ? payload['blocks'] : [];
    for (const rawBlock of blocks) {
      const block = rec(rawBlock);
      if (block === undefined) continue;
      observations.push(...observationsFromBlock(block, scenarioType, chapterIndex));
    }
  }

  if (observations.length === 0) {
    return {
      noEdits: true,
      observations: 0,
      next: currentProfiles(request.bookRoot),
      report: {
        alphaUsed: request.regimeBoost === true ? 0.2 : 0.05,
        regimeChange: request.regimeBoost === true,
        outcomes: emptyOutcomes(),
        tabooPromotions: [],
        nextTabooState: emptyTabooCandidateState(),
      },
    };
  }

  const tabooState = readTabooStateOrEmpty(request.bookRoot);
  const current = currentProfiles(request.bookRoot);

  const result = updateStyleProfiles(current, observations, {
    tabooState,
    ...(request.regimeBoost === undefined ? {} : { regimeBoost: request.regimeBoost }),
  });
  writeStyleProfiles({
    bus: request.bus,
    bookRoot: request.bookRoot,
    taskRef: request.taskRef,
    chapterIndex: request.chapterIndex,
    next: result.next,
    audit: {
      sampleCount: observations.length,
      alphaUsed: result.report.alphaUsed,
      regimeChange: result.report.regimeChange,
    },
  });
  saveTabooCandidateState(request.bookRoot, result.report.nextTabooState);

  return { noEdits: false, observations: observations.length, ...result };
}

/* ---------------------------------------------------------------------------
 * 小工具
 * ------------------------------------------------------------------------- */

function emptyOutcomes(): Record<ScenarioType, { sampleCount: number; updated: boolean }> {
  return {
    action: { sampleCount: 0, updated: false },
    dialogue: { sampleCount: 0, updated: false },
    romance_emotion: { sampleCount: 0, updated: false },
    exposition_worldbuilding: { sampleCount: 0, updated: false },
  };
}

/** 当前四行画像（宁败不脏：文风.md 缺/坏即抛——调用方按 S12 降级处理）。 */
function currentProfiles(bookRoot: string) {
  return readStyleProfiles(bookRoot);
}

/** taboo 侧账存在才加载，否则空白（首次建账）；损坏抛错不静默（宁败不脏）。 */
function readTabooStateOrEmpty(bookRoot: string): TabooCandidateState {
  const tabooPath = join(bookRoot, TABOO_STATE_RELPATH);
  try {
    if (!existsSync(tabooPath)) return emptyTabooCandidateState();
    return loadTabooCandidateState(bookRoot);
  } catch (error) {
    throw new Error('taboo 侧账读取失败: ' + (error as Error).message);
  }
}

/** 场景型判别：V1 按章奇偶近似（action/romance 交替）——真实分类器 DEFER 台架票，
 *  本函数是显式标注的占位路由，供台架回填后替换（t48-b §8 分类器校准节奏）。 */
function pickScenarioType(payload: Record<string, unknown>, chapterIndex: number): ScenarioType {
  const explicit = payload['scenarioType'];
  if (explicit === 'action' || explicit === 'dialogue' || explicit === 'romance_emotion' || explicit === 'exposition_worldbuilding') {
    return explicit;
  }
  // 占位路由：章奇→action，偶→dialogue（台架校准后替换；注释为证）
  return chapterIndex % 2 === 1 ? 'action' : 'dialogue';
}
