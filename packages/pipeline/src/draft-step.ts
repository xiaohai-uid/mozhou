/**
 * Draft 步（T17 · #41；chapter-pipeline-spec §1 表第 3 行 / S4 / S8）。
 *
 * ContextPacket + recipe 实例 → 正文流写 <书>/正文/…/第N章.md（phase=draft）。
 * 纪律：
 *   - provider 调用走 runtime 既有缝：engine.execute 承载 GenerationStarted/
 *     Finished 配对与 attempts/fallback 链（T12 底座，本模块只接线不重写）；
 *     传输错误经 normalizeProviderError 归一（T13 错误表），retryable ⇒
 *     RecoverableError 交引擎二级定向重生，非 retryable ⇒ 直通 failed_terminal；
 *   - M17 三级降级可见性（S7）：一级协议档位选择静默——档位判定发生在绑定构造
 *     内部，不产生任何账本事件；二级定向重生每次 attempt 记事件——引擎既有
 *     TaskAttemptRegistered 原样承接；三级人工模板兜底必须上报
 *     failed_recoverable——候选穷尽时本步把 outcome/reason/triedProviders
 *     原样上报调用方渲染人工模板，绝不静默吞掉；
 *   - 断流标 partial、半稿持久保留（S8 Draft 中行；#60 教训：每章落盘即持久）：
 *     每个 delta 立即原子落盘正文文件，断流时状态文件标 partial，作者可选
 *     续写（mode='continue'，以盘上半稿为基底续流）或重生成（mode='generate'，
 *     全量重走）；phase=draft 天然可写，草稿写入不动 revision（revision 只随
 *     相位翻转走，T3 语义）；
 *   - 写后刷新 hash 基线（manifest）：草稿是应用自身写入，不入对账面
 *     （S2 freeDraftEdits 同判），且保证后续 commitChapter 写前校验可过。
 *     编排方契约：长持 LocalDataPlane 句柄须在步边界重开（S10 步边界检查点），
 *     以同步其内存 ctx 基线到盘上最新 manifest。
 *
 * 流缝契约：stream 工厂每次调用供一个全新 AsyncIterable<string>（delta 序列；
 * fallback 重试无法复活已消费的生成器）。传输层错误用 ProviderTransportError
 * 携带三家原始错误样本交归一化表。真实 HTTP adapter 归后续票，本票只冻结缝形状。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContextPacket } from '@mozhou/context-compiler';
import type {
  CapabilityRecipe,
  NormalizedProviderId,
  ProviderBinding,
  RawProviderError,
  RuntimeEngine,
} from '@mozhou/runtime';
import { RecoverableError, normalizeProviderError } from '@mozhou/runtime';
import {
  ChapterPhaseError,
  atomicReplace,
  proseChapterPath,
  readManifest,
  readProseChapter,
  refreshManifestEntries,
  renderProseChapter,
  writeManifest,
} from '@mozhou/data-plane';
import { readPipelineLedger } from './ledger.js';

/** Draft 运行态目录：.mozhou 运行时区（非 canon、不参与对账）。 */
export const DRAFT_STATE_DIR = '.mozhou/drafts';

export type DraftMode = 'generate' | 'continue';

/**
 * 正文流缝：工厂语义——每次 attempt 取一个全新流实例（fallback 重试无法复活
 * 已消费的生成器）；delta 为增量文本片段。测试注入假流夹具，禁真网。
 */
export type DraftStreamSource = () => AsyncIterable<string>;

/** 流缝传输层错误载体：raw 三家错误样本喂 normalizeProviderError 归一化表。 */
export class ProviderTransportError extends Error {
  override readonly name = 'ProviderTransportError';
  constructor(readonly raw: RawProviderError, message?: string) {
    super(message ?? 'provider transport error: ' + JSON.stringify(raw));
  }
}

/* ---------------------------------------------------------------------------
 * Draft 运行态文件（断流 partial 标记的唯一机械载体；无时间戳，零时钟纪律）
 * ------------------------------------------------------------------------- */

export type DraftStatus = 'streaming' | 'partial' | 'complete';

export interface DraftStateFile {
  readonly stateVersion: 1;
  readonly chapterIndex: number;
  readonly proseRelPath: string;
  readonly status: DraftStatus;
  /** 已持久化正文字符数（含续写基底）。 */
  readonly chars: number;
  /** status=partial 时的归一化失败原因；其余状态键不存在（exactOptional）。 */
  readonly reason?: string;
}

/** 运行态文件路径与正文文件同名异扩展（第NNNN章.md ↔ 第NNNN章.json）。 */
export function draftStateRelPath(chapterIndex: number): string {
  const rel = proseChapterPath(chapterIndex);
  const stem = rel.slice(rel.lastIndexOf('/') + 1);
  return DRAFT_STATE_DIR + '/' + stem.slice(0, -'.md'.length) + '.json';
}

interface DraftStateWrite {
  readonly chapterIndex: number;
  readonly proseRelPath: string;
  readonly status: DraftStatus;
  readonly chars: number;
  readonly reason?: string;
}

function writeDraftState(root: string, state: DraftStateWrite): void {
  const payload: DraftStateFile = {
    stateVersion: 1,
    chapterIndex: state.chapterIndex,
    proseRelPath: state.proseRelPath,
    status: state.status,
    chars: state.chars,
    ...(state.reason === undefined ? {} : { reason: state.reason }),
  };
  mkdirSync(join(root, DRAFT_STATE_DIR), { recursive: true });
  writeFileSync(join(root, draftStateRelPath(state.chapterIndex)), JSON.stringify(payload, null, 2) + '\n');
}

/** 读 Draft 运行态文件；缺失返回 null（从未开流的章）。撕裂/坏形宁抛不猜。 */
export function readDraftState(root: string, chapterIndex: number): DraftStateFile | null {
  const path = join(root, draftStateRelPath(chapterIndex));
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf8')) as DraftStateFile;
}

/* ---------------------------------------------------------------------------
 * 流式持久化绑定：M17 一级静默发生在这里（协议档位选择不发任何事件）
 * ------------------------------------------------------------------------- */

export interface DraftBindingOptions {
  readonly bookRoot: string;
  readonly chapterIndex: number;
  /** 归一化表的家侧判别键（deepseek/glm/claude）。 */
  readonly provider: NormalizedProviderId;
  readonly mode: DraftMode;
  readonly stream: DraftStreamSource;
}

interface ProseSnapshot {
  readonly relPath: string;
  readonly mozhouId: string;
  readonly revision: number;
  readonly chapterIndex: number;
}

function loadProseSnapshot(opts: DraftBindingOptions, mode: DraftMode): ProseSnapshot & { baseBody: string } {
  const relPath = proseChapterPath(opts.chapterIndex);
  const scan = readProseChapter(opts.bookRoot, relPath);
  if (scan.phase !== 'draft') {
    throw new ChapterPhaseError(
      opts.chapterIndex,
      'draft stream requires phase=draft, got ' + scan.phase + ' — reopen the chapter first',
    );
  }
  // generate = 全量重走（旧半稿废弃重写）；continue = 盘上半稿为续写基底（#60：落盘即真）
  return {
    relPath,
    mozhouId: scan.mozhouId,
    revision: scan.revision,
    chapterIndex: scan.chapterIndex,
    baseBody: mode === 'continue' ? scan.body : '',
  };
}

/** 落盘正文的唯一规范化：非空不以换行结尾即补换行（jsonl 计行同款纪律）。 */
function normalizeBody(body: string): string {
  return body.length > 0 && !body.endsWith('\n') ? body + '\n' : body;
}

function persistProse(bookRoot: string, snapshot: ProseSnapshot, raw: string): string {
  const normalized = normalizeBody(raw);
  atomicReplace(
    bookRoot,
    snapshot.relPath,
    renderProseChapter({
      mozhouId: snapshot.mozhouId,
      revision: snapshot.revision,
      chapterIndex: snapshot.chapterIndex,
      phase: 'draft',
      body: normalized,
    }),
  );
  return normalized;
}

function refreshBaseline(bookRoot: string, relPath: string): void {
  writeManifest(bookRoot, refreshManifestEntries(readManifest(bookRoot), bookRoot, [relPath]));
}

/**
 * 构造 Draft 步的 provider 绑定：逐 delta 原子落盘（每章落盘即持久），断流时
 * 半稿保留 + 状态文件标 partial + 抛 T13 归一化分类后的错误交引擎 fallback 链。
 * 组合根把它注册到 engine.registerProviderBinding(解析到的 providerId, …)。
 */
export function makeDraftProviderBinding(opts: DraftBindingOptions): ProviderBinding {
  // 绑定只消费盘面真源与流缝，不读 payload/snapshot——零参闭包即满足 ProviderBinding 形状
  return async () => {
    const prose = loadProseSnapshot(opts, opts.mode);
    let body = prose.baseBody;
    // chars 恒等盘上持久化字节数（含规范化尾换行），与正文文件逐字节对账
    let chars = normalizeBody(body).length;
    writeDraftState(opts.bookRoot, {
      chapterIndex: prose.chapterIndex,
      proseRelPath: prose.relPath,
      status: 'streaming',
      chars,
    });
    try {
      for await (const delta of opts.stream()) {
        if (delta.length === 0) continue;
        body += delta;
        chars = persistProse(opts.bookRoot, prose, body).length;
      }
    } catch (error) {
      // 半稿已在盘上（逐 delta 落盘）；此处补 partial 标记并按 T13 表归类上抛
      const classified = classifyStreamFailure(error, opts.provider);
      writeDraftState(opts.bookRoot, {
        chapterIndex: prose.chapterIndex,
        proseRelPath: prose.relPath,
        status: 'partial',
        chars,
        reason: classified.message,
      });
      throw classified;
    }
    const finalBody = normalizeBody(body);
    writeDraftState(opts.bookRoot, {
      chapterIndex: prose.chapterIndex,
      proseRelPath: prose.relPath,
      status: 'complete',
      chars: finalBody.length,
    });
    refreshBaseline(opts.bookRoot, prose.relPath);
    return finalBody;
  };
}

/**
 * 账本折叠：最近一条 GenerationFinished 的 reason（引擎把失败原因只写进事件
 * payload，TaskResult 不携带）。S11 全局单飞 V1 下 await 返回后最近一条即本次。
 */
function lastGenerationFinishedReason(root: string): string | undefined {
  const rows = readPipelineLedger(root);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row !== undefined && row.kind === 'task' && row.event.type === 'GenerationFinished') {
      const reason = row.event.payload?.['reason'];
      return typeof reason === 'string' ? reason : undefined;
    }
  }
  return undefined;
}

/** T13 错误表接线：传输样本 → 归一化 verdict → retryable 分流为可恢复/终态。 */
function classifyStreamFailure(error: unknown, provider: NormalizedProviderId): Error {
  if (error instanceof RecoverableError) {
    return error; // 上游已分类（如 structuredOutput 校验失败带 repairHint），原样上抛
  }
  const raw = error instanceof ProviderTransportError ? error.raw : extractRawSample(error);
  if (raw !== null) {
    const verdict = normalizeProviderError(provider, raw);
    if (verdict.retryable) {
      return new RecoverableError(
        'PROVIDER_' + verdict.code.toUpperCase() + ': ' + verdict.providerMessage,
        { code: verdict.code, providerMessage: verdict.providerMessage },
      );
    }
    return new Error('PROVIDER_TERMINAL_' + verdict.code.toUpperCase() + ': ' + verdict.providerMessage);
  }
  // 无归一化样本的未知失败：保守判不可重试（errors.ts 同款保守缺省）
  return error instanceof Error ? error : new Error(String(error));
}

function extractRawSample(error: unknown): RawProviderError | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const candidate = error as Record<string, unknown>;
  const hasSample =
    typeof candidate['status'] === 'number' ||
    typeof candidate['code'] === 'string' ||
    typeof candidate['code'] === 'number' ||
    typeof candidate['errorType'] === 'string';
  return hasSample ? candidate : null; // Record<string, unknown> 对全可选字段结构兼容
}

/* ---------------------------------------------------------------------------
 * Draft 步执行：engine.execute 接线（attempts/fallback 底座 T12 既有）
 * ------------------------------------------------------------------------- */

export interface DraftStepRequest {
  readonly engine: RuntimeEngine;
  readonly bookRoot: string;
  readonly chapterIndex: number;
  /** Compile 步产物；packet.text 是装配完成的生成输入。 */
  readonly packet: ContextPacket;
  /** recipe 实例：taskType 驱动引擎解析（tier→provider），预算字段随 payload 下发。 */
  readonly recipe: CapabilityRecipe;
  readonly mode?: DraftMode;
}

export interface DraftStepOutcome {
  /** 四态结局词表（kernel §11）；引擎 V1 只产前三态，state_degraded 随词表收窄面保留。 */
  readonly outcome: 'succeeded' | 'failed_recoverable' | 'failed_terminal' | 'state_degraded';
  readonly proseRelPath: string;
  /** succeeded = 最终全文；失败 = 盘上保留的半稿（续写基底或重生成起点）。 */
  readonly text: string;
  readonly chars: number;
  /** 断流标记：Draft 运行态文件 status==='partial'。 */
  readonly partial: boolean;
  /** 失败原因：优先运行态文件的归一化记录，其次引擎 reason 轨迹。 */
  readonly reason?: string;
  /** 三级上报轨迹：穷尽过的 provider 列表（人工兜底模板的输入）。 */
  readonly triedProviders?: readonly string[];
  /** 二级定向重生提示（透传引擎 repairHint）。 */
  readonly repairHint?: unknown;
}

/**
 * Draft 步执行。步光标推进由编排方驱动（session.advance('draft')——沿
 * compile-step 先例，步函数不持会话）；本函数负责一次生成任务与盘面落痕。
 */
export async function runDraftStep(request: DraftStepRequest): Promise<DraftStepOutcome> {
  const mode: DraftMode = request.mode ?? 'generate';
  const result = await request.engine.execute(request.recipe.taskType, {
    prompt: request.packet.text,
    recipeId: request.recipe.id,
    recipeVersion: request.recipe.recipeVersion,
    hotContextBytes: request.recipe.contextBudget.hotContextBytes,
    mode,
  });

  const proseRelPath = proseChapterPath(request.chapterIndex);
  const onDisk = readProseChapter(request.bookRoot, proseRelPath);
  const state = readDraftState(request.bookRoot, request.chapterIndex);
  const text =
    result.outcome === 'succeeded' && typeof result.value === 'string'
      ? result.value
      : onDisk.body;

  if (result.outcome !== 'succeeded') {
    const hint =
      result.outcome === 'failed_recoverable' && typeof result.repairHint === 'object' && result.repairHint !== null
        ? (result.repairHint as Record<string, unknown>)
        : {};
    const hintProviders = Array.isArray(hint['triedProviders']) ? (hint['triedProviders'] as unknown[]) : [];
    const partialReason = state?.reason;
    const hintMessage = typeof hint['providerMessage'] === 'string' ? hint['providerMessage'] : undefined;
    const failureReason: string | undefined =
      partialReason ?? hintMessage ?? lastGenerationFinishedReason(request.bookRoot);
    return {
      outcome: result.outcome,
      proseRelPath,
      text,
      chars: text.length,
      partial: state?.status === 'partial',
      ...(failureReason !== undefined ? { reason: failureReason } : {}),
      ...(result.outcome === 'failed_recoverable' && result.repairHint !== undefined
        ? { repairHint: result.repairHint }
        : {}),
      ...(result.outcome === 'failed_recoverable' && hintProviders.length > 0
        ? { triedProviders: hintProviders.filter((entry): entry is string => typeof entry === 'string') }
        : {}),
    };
  }

  return {
    outcome: 'succeeded',
    proseRelPath,
    text,
    chars: text.length,
    partial: false,
  };
}
