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
 *
 * T21 受控增补（#54 · t52）：execute 第三参 meta 桥接会话窗口——parentTaskRef/
 * chapterIndex/eventPayload（M14 形状 recipeSnapshot）；业务 payload 删平铺
 * recipeId/recipeVersion 两键（唯一消费方走嵌套路径，t52:B1；消费面 W6 起在
 * @mozhou/runtime recipe-payload 与 @mozhou/quality-engine metrics-gates，原
 * benchmark version-matrix.ts 兼容层已删）；
 * 失败原因折叠改按本次 taskRef 精确匹配（Q-E，替代「最近一条」邻接启发式）。
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContextPacket } from '@mozhou/context-compiler';
import type {
  CapabilityRecipe,
  CapabilityRecipeDocument,
  NormalizedProviderId,
  ProviderBinding,
  RawProviderError,
  RuntimeEngine,
} from '@mozhou/runtime';
import { RecoverableError, normalizeProviderError, toGenerationStartedPayload } from '@mozhou/runtime';
import {
  ChapterPhaseError,
  atomicWriteFileSync,
  proseChapterPath,
  readProseChapter,
} from '@mozhou/data-plane';
import { readPipelineLedger } from './ledger.js';
import {
  CandidateError,
  CANDIDATE_TERMINAL,
  appendCandidateDelta,
  createDraftCandidate,
  requestCandidateCancel,
  resolveCandidateCancel,
  finishCandidate,
  readDraftCandidate,
  candidateRelPath,
  type CandidateMode,
  type WriteBase,
  resolveCandidateGenerationId,
} from './draft-candidate.js';

/** Draft 运行态目录：.mozhou 运行时区（非 canon、不参与对账）。 */
export const DRAFT_STATE_DIR = '.mozhou/drafts';

export type DraftMode = 'generate' | 'continue';

/**
 * 正文流缝：工厂语义——每次 attempt 取一个全新流实例（fallback 重试无法复活
 * 已消费的生成器）；delta 为增量文本片段。signal 由引擎超时与外部取消合并后传入，
 * 传输层应据此中止在途请求。测试注入假流夹具，禁真网。
 */
export type DraftStreamSource = (signal?: AbortSignal) => AsyncIterable<string>;

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
  /**
   * 本次 attempt 实际追加的正文字符数（不含续写基底；纯空白增量记 0）。
   * 判别「上游有没有真的给出正文」的机械依据：generate 模式基底为 0，
   * continue 模式基底非 0，故 chars 无法单独回答这个问题。
   */
  readonly appendedChars?: number;
  /** status=partial 时的归一化失败原因；其余状态键不存在（exactOptional）。 */
  readonly reason?: string;
  /** C2（T04）：本次生成关联的候选 id；恢复/重开时回读候选文本。 */
  readonly candidateId?: string;
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
  readonly appendedChars?: number;
  readonly reason?: string;
  readonly candidateId?: string;
}

/** 复用候选路径的 UUID 校验；派生状态不能借 candidateId 穿出运行态目录。 */
function candidateStateRelPath(candidateId: string): string {
  const candidatePath = candidateRelPath(candidateId);
  return DRAFT_STATE_DIR + '/candidates/' + candidatePath.slice(candidatePath.lastIndexOf('/') + 1);
}

/** 调用方持同一书锁：候选私有状态始终更新，章指针仅由当前所有者更新。 */
function writeDraftState(root: string, state: DraftStateWrite, claimChapter = false): void {
  const payload: DraftStateFile = {
    stateVersion: 1,
    chapterIndex: state.chapterIndex,
    proseRelPath: state.proseRelPath,
    status: state.status,
    chars: state.chars,
    ...(state.appendedChars === undefined ? {} : { appendedChars: state.appendedChars }),
    ...(state.reason === undefined ? {} : { reason: state.reason }),
    ...(state.candidateId === undefined ? {} : { candidateId: state.candidateId }),
  };
  const current = readDraftState(root, state.chapterIndex);
  mkdirSync(join(root, DRAFT_STATE_DIR), { recursive: true });
  if (state.candidateId !== undefined) {
    const privatePath = candidateStateRelPath(state.candidateId);
    mkdirSync(join(root, DRAFT_STATE_DIR, 'candidates'), { recursive: true });
    atomicWriteFileSync(join(root, privatePath), JSON.stringify(payload, null, 2) + '\n');
    // 旧任务可以结算自己的半稿；新任务已认领章指针时，旧任务不得把它抢回来。
    if (!claimChapter && current?.candidateId !== state.candidateId) return;
  }
  // 原子落盘（与同包 draft-candidate.writeCandidate 一致）：裸 writeFileSync 被中断会留下
  // 截断的 JSON，readDraftState 对撕裂内容宁抛不猜——一次崩溃即把该章的运行态读废。
  // tmp → fsync → rename 后，rename 是唯一可见点，盘上永远是完整 JSON。
  atomicWriteFileSync(join(root, draftStateRelPath(state.chapterIndex)), JSON.stringify(payload, null, 2) + '\n');
}

/** 读 Draft 运行态文件；缺失返回 null（从未开流的章）。撕裂/坏形宁抛不猜。 */
export function readDraftState(root: string, chapterIndex: number): DraftStateFile | null {
  const path = join(root, draftStateRelPath(chapterIndex));
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf8')) as DraftStateFile;
}

/** 精确回读本候选；旧版仅有章文件时，身份相符才可作为兼容来源。 */
function readCandidateState(root: string, chapterIndex: number, candidateId: string): DraftStateFile | null {
  const path = join(root, candidateStateRelPath(candidateId));
  if (existsSync(path)) {
    const state = JSON.parse(readFileSync(path, 'utf8')) as DraftStateFile;
    if (state.candidateId !== candidateId || state.chapterIndex !== chapterIndex || state.stateVersion !== 1) {
      throw new CandidateError('IDENTITY_MISMATCH', 'IDENTITY_MISMATCH: candidate draft state identity does not match the request');
    }
    return state;
  }
  const legacyState = readDraftState(root, chapterIndex);
  return legacyState?.candidateId === candidateId ? legacyState : null;
}

/* ---------------------------------------------------------------------------
 * 流式持久化绑定：M17 一级静默发生在这里（协议档位选择不发任何事件）
 * ------------------------------------------------------------------------- */

export interface DraftBindingOptions {
  readonly bookRoot: string;
  readonly chapterIndex: number;
  /** 归一化表的家侧判别键（deepseek/glm/claude）。 */
  readonly provider: NormalizedProviderId;
  /** C2（T04）候选模式映射：旧 generate→replace（全量重走）、continue→continue（续写基底）。 */
  readonly mode: DraftMode;
  readonly stream: DraftStreamSource;
  /** C2（T04）：候选上下文。未提供候选即拒绝绑定——绝无「直接正文落盘」旁路。 */
  readonly candidate: {
    readonly id: string;
    /** W4-2a：候选生成标识（新名）。 */
    readonly generationId?: string | undefined;
    /** @deprecated W4-2a 旧名，保留为可选输入别名（既有测试仍传它）。 */
    readonly operationId?: string | undefined;
    readonly bookId: string;
    readonly base: WriteBase;
    readonly mode: CandidateMode;
    readonly selection?: { readonly from: number; readonly to: number; readonly selectedTextHash: string };
    /** continue 续写基底：断流半稿文本（调用方从旧候选读取传入）。 */
    readonly seedText?: string;
  };
  /** 取消信号：HTTP 请求断开/显式 cancel 时中止上游流；延迟 chunk 不再写盘。 */
  readonly signal?: AbortSignal;
  /**
   * W4-2b：客户端视图代次。提供时，**旧代次**的迟到 chunk 在写盘之前被丢弃
   * （未提供则只按序号丢弃，保持既有调用方行为不变）。
   */
  readonly generationEpoch?: number;
  /**
   * 书稿写锁注入（可选）：圈住候选的**读-改-写**短临界区。
   *
   * 候选落盘（draft-candidate.writeCandidate）的原子性由调用方在同一书稿锁内提供
   * （draft-candidate.ts:400）。生成路径此前未接锁，于是「取消读到 streaming」与
   * 「采纳/另一次取消读到同一现场」的交叉读改写会互相覆盖（丢更新）。
   * 生产由路由注入 withBookWriteLock；未注入（既有测试、离线调用）时直接执行，
   * 行为与注入前逐字相同。
   *
   * 纪律：只圈候选读改写，**不圈模型等待**——模型等待在锁外，否则同书其他写入
   * （保存别章、备份）会被整段生成阻塞。
   */
  readonly withWriteLock?: (<T>(fn: () => T | Promise<T>) => Promise<T>) | undefined;
}

function assertDraftPhase(bookRoot: string, chapterIndex: number): void {
  const scan = readProseChapter(bookRoot, proseChapterPath(chapterIndex));
  if (scan.phase !== 'draft') {
    throw new ChapterPhaseError(
      chapterIndex,
      'draft stream requires phase=draft, got ' + scan.phase + ' — reopen the chapter first',
    );
  }
}

/** 候选读改写短临界区：注入书稿锁时在锁内执行；未注入时直接执行（默认行为不变）。 */
async function inCandidateSection<T>(
  withWriteLock: DraftBindingOptions['withWriteLock'],
  fn: () => T | Promise<T>,
): Promise<T> {
  if (withWriteLock === undefined) return await fn();
  return await withWriteLock(fn);
}

/**
 * 构造 Draft 步的 provider 绑定（C2·T04）：流式 delta 只 appendCandidateDelta——
 * 未经 Accept 的生成不触碰正文/revision/hash（I01）。断流/取消/失败保留候选文本：
 * - 取消（外部 signal / CANDIDATE_TERMINAL）：候选标 cancelled，不再接收后续 chunk；
 * - 断流：候选 finish partial（半稿保留可续），状态文件标 partial + 归一化原因；
 * - 完整收尾：候选 finish ready，状态文件标 complete。
 * 组合根把它注册到 engine.registerProviderBinding(解析到的 providerId, …)。
 */
/** 合并外部取消信号与引擎超时信号；任一中止即视为中止。 */
function combineAbortSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  if (a.aborted) return a
  if (b.aborted) return b
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  a.addEventListener('abort', abort, { once: true })
  b.addEventListener('abort', abort, { once: true })
  controller.signal.addEventListener(
    'abort',
    () => {
      a.removeEventListener('abort', abort)
      b.removeEventListener('abort', abort)
    },
    { once: true },
  )
  return controller.signal
}

export function makeDraftProviderBinding(opts: DraftBindingOptions): ProviderBinding {
  // 绑定只消费盘面真源与流缝，不读 payload/snapshot；第三参 signal 是引擎超时中止通道。
  //
  // 跨 attempt 累加器：引擎会定向重生，首选 attempt 已落盘的半稿是真内容、可采纳，
  // 不能被随后备用 attempt 的空输出抹掉。若按 attempt 各自计数，后写者胜会产出
  // produced=false，末帧把「生成过」判成「什么都没生成」，作者半稿反被 error 帧困死。
  let producedChars = 0
  // 同一绑定的 fallback attempt 只能更新已认领的状态，不能重新抢占新任务的章指针。
  let mayClaimChapter = true;
  return async (_payload, _snapshot, bindingOptions) => {
    const signal = combineAbortSignals(opts.signal, bindingOptions?.signal);
    assertDraftPhase(opts.bookRoot, opts.chapterIndex);
    const producedAtStart = producedChars;
    const aborted = (): boolean => signal !== undefined && signal.aborted;
    const relPath = proseChapterPath(opts.chapterIndex);
    // 候选由调用方先建（HTTP/管线）；恢复场景（streaming/partial 跨进程）直接续用。
    // 读-建是读改写，放进书稿锁短临界区（见 withWriteLock 注释）。
    let candidate = await inCandidateSection(opts.withWriteLock, () => {
      const existing = readDraftCandidate(opts.bookRoot, opts.candidate.id);
      const currentCandidate = existing ?? createDraftCandidate(opts.bookRoot, {
        id: opts.candidate.id,
        generationId: resolveCandidateGenerationId(opts.candidate),
        bookId: opts.candidate.bookId,
        chapterIndex: opts.chapterIndex,
        base: opts.candidate.base,
        mode: opts.candidate.mode,
        ...(opts.candidate.selection === undefined ? {} : { selection: opts.candidate.selection }),
        ...(opts.candidate.seedText === undefined ? {} : { seedText: opts.candidate.seedText }),
      });
      // 认领与候选读建共用同一临界区。初始等锁期间已取消的任务不能覆盖新任务。
      if (!aborted()) {
        writeDraftState(opts.bookRoot, {
          chapterIndex: opts.chapterIndex,
          proseRelPath: relPath,
          status: 'streaming',
          chars: currentCandidate.text.length,
          appendedChars: producedChars,
          candidateId: currentCandidate.id,
        }, mayClaimChapter);
      }
      mayClaimChapter = false;
      return currentCandidate;
    });
    const publishState = async (state: DraftStateWrite): Promise<void> =>
      await inCandidateSection(opts.withWriteLock, () => writeDraftState(opts.bookRoot, state));
    // 闭包收窄边界：此后 candidate 会在循环内被 appendCandidateDelta 重赋值，闭包里
    // 只依赖不变的候选 id（同 invocation 内 id 恒定）。
    const candidateIdRef = candidate.id;
    // F-09 取消单次结算：外部 /api/draft.cancel 可能已把候选直接终态化为 cancelled——
    // 此时 requestCandidateCancel 会抛 CANDIDATE_NOT_CANCELLABLE，该 CandidateError 带
    // code 字段，曾被 catch 里的 provider 错误归一误判成 PROVIDER_TERMINAL_UNKNOWN
    // （审查探针 cancel-midstream）。竞态落败方幂等让位：已终态即读回现场，
    // 绝不二次结算、绝不改判他人已定的结局。
    // 结算本身是两段候选读改写（进入中间态 → 判定终态），整段放进同一临界区，
    // 避免外部 cancel/accept 在中间态插入。
    const settleAbort = async (outcome: { readonly upstreamCompleted: boolean }) =>
      await inCandidateSection(opts.withWriteLock, () => {
        try {
          requestCandidateCancel(opts.bookRoot, candidateIdRef);
          return resolveCandidateCancel(opts.bookRoot, candidateIdRef, outcome);
        } catch (error) {
          if (!(error instanceof CandidateError && error.code === 'CANDIDATE_NOT_CANCELLABLE')) throw error;
          // 竞态落败方读盘取已定结局；此刻候选必须存在（本 invocation 刚建/读过），
          // 读不到 = 盘面异常，宁败不脏
          const settledElsewhere = readDraftCandidate(opts.bookRoot, candidateIdRef);
          if (settledElsewhere === null) {
            throw new CandidateError('CANDIDATE_NOT_FOUND', `CANDIDATE_NOT_FOUND: candidate ${candidateIdRef} vanished during cancel race`);
          }
          return settledElsewhere;
        }
      });
    // W4-2b：单任务内序号——从候选当前序号续起（跨进程续用不倒退），供丢弃迟到 chunk。
    let streamSequence = candidate.lastSequence;
    try {
      if (aborted()) {
        // 上游从未开始：判定点即此刻，未完成 ⇒ cancelled（F-09：幂等结算）
        const settled = await settleAbort({ upstreamCompleted: false });
        await publishState({
          chapterIndex: opts.chapterIndex,
          proseRelPath: relPath,
          status: 'partial',
          chars: settled.text.length,
          appendedChars: producedChars,
          candidateId: settled.id,
        });
        return settled.text;
      }
      for await (const delta of opts.stream(signal)) {
        if (aborted()) {
          // 取消后的延迟 chunk 不写盘、不继续付费重试；上游被我们中止 ⇒ 未完成 ⇒ cancelled。
          // F-09：此处直接结算并返回——旧实现 break 后会再撞下方「上游已结束」判定点，
          // 二次 requestCandidateCancel 抛错并被误判成 PROVIDER_TERMINAL_UNKNOWN。
          const settled = await settleAbort({ upstreamCompleted: false });
          await publishState({
            chapterIndex: opts.chapterIndex,
            proseRelPath: relPath,
            status: 'partial',
            chars: settled.text.length,
            appendedChars: producedChars,
            candidateId: settled.id,
          });
          return settled.text;
        }
        if (delta.length === 0) continue;
        streamSequence += 1;
        // 迟到 chunk 门：**写盘之前**双校验（旧代次 / 已见序号一律丢弃，不落盘不报错）。
        // 锁内还要**再查一次取消**：等锁期间作者可能已按停止——待写 delta 不得落盘，
        // 更不得落盘后按「自然结束」认定成功（S2：等锁前的检查覆盖不到这个窗口）。
        const appended = await inCandidateSection(opts.withWriteLock, () => {
          if (aborted()) return null;
          return appendCandidateDelta(opts.bookRoot, candidate.id, delta, {
            ...(opts.generationEpoch === undefined ? {} : { generationEpoch: opts.generationEpoch }),
            sequence: streamSequence,
          });
        });
        if (appended === null) {
          // 等锁期间被取消：丢弃待写 delta，按「上游未完成」结算（不是成功）。
          const settled = await settleAbort({ upstreamCompleted: false });
          await publishState({
            chapterIndex: opts.chapterIndex,
            proseRelPath: relPath,
            status: 'partial',
            chars: settled.text.length,
            appendedChars: producedChars,
            candidateId: settled.id,
          });
          return settled.text;
        }
        candidate = appended;
        // 纯空白帧（换行、缩进）不计入：它们不构成可采纳的正文
        producedChars += delta.trim().length;
      }
      if (aborted()) {
        // **判定点：上游流已经结束**（循环自然退出）——完成先于取消生效 ⇒ succeeded（规划 §6.5），
        // 不因「客户端在此期间按了停止」就把一次完整生成改判为取消。
        // F-09：若外部 cancelCandidate 已抢先终态化（cancelled），settleAbort 幂等让位——
        // 保留已结算的 cancelled（单次结算），状态文件按实际终态写 partial。
        const settled = await settleAbort({ upstreamCompleted: true });
        await publishState({
          chapterIndex: opts.chapterIndex,
          proseRelPath: relPath,
          status: settled.taskState === 'succeeded' ? 'complete' : 'partial',
          chars: settled.text.length,
          appendedChars: producedChars,
          candidateId: settled.id,
        });
        return settled.text;
      }
      // 零增量流 = 上游静默空输出。抛 RecoverableError 交引擎二级定向重生
      // （M17），候选穷尽后随链报 failed_recoverable；由下方 catch 统一
      // 标 partial + 写归一原因，绝不把空候选终态化成 ready。
      if (producedChars === producedAtStart) {
        throw new RecoverableError(
          'PROVIDER_EMPTY_STREAM: ' + opts.provider + ' 返回流但未产出任何正文增量（基底 ' +
            candidate.text.length + ' 字未变，本次追加 0 字）',
        );
      }
      // 流完整结束（含完成帧）：ready
      const finalCandidate = await inCandidateSection(opts.withWriteLock, () =>
        finishCandidate(opts.bookRoot, candidate.id, 'ready'),
      );
      await publishState({
        chapterIndex: opts.chapterIndex,
        proseRelPath: relPath,
        status: 'complete',
        chars: finalCandidate.text.length,
        appendedChars: producedChars,
        candidateId: finalCandidate.id,
      });
      return finalCandidate.text;
    } catch (error) {
      // 取消竞态：他人已终态化候选（CANDIDATE_TERMINAL）——半稿保留，不再写盘
      if (error instanceof CandidateError && error.code === CANDIDATE_TERMINAL) {
        await publishState({
          chapterIndex: opts.chapterIndex,
          proseRelPath: relPath,
          status: 'partial',
          chars: candidate.text.length,
          appendedChars: producedChars,
          candidateId: candidate.id,
        });
        return candidate.text;
      }
      // 断流：候选半稿保留（partial），状态文件标 partial + T13 归一化原因
      const classified = classifyStreamFailure(error, opts.provider);
      try {
        if (candidate.status === 'streaming') {
          await inCandidateSection(opts.withWriteLock, () => finishCandidate(opts.bookRoot, candidate.id, 'partial'));
        }
      } catch {
        // 终态冲突时保留现场即可
      }
      await publishState({
        chapterIndex: opts.chapterIndex,
        proseRelPath: relPath,
        status: 'partial',
        chars: candidate.text.length,
        appendedChars: producedChars,
        candidateId: candidate.id,
        reason: classified.message,
      });
      throw classified;
    }
  };
}

/**
 * 账本折叠：本次执行（taskRef 精确匹配）的 GenerationFinished reason（引擎把失败
 * 原因只写进事件 payload）。T21 · t52:Q-E：TaskResult 增只读 taskRef 后按本次
 * taskRef 精确折叠，替代旧「最近一条」邻接启发式——S11 单飞解除后最近≠本次
 * （T19 重提交全量重走场景即反例）。
 */
function generationFinishedReason(root: string, taskRef: string): string | undefined {
  const rows = readPipelineLedger(root);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row !== undefined && row.kind === 'task' && row.event.type === 'GenerationFinished' && row.event.taskRef === taskRef) {
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
  /** 本次生成的候选身份；并发入口必须提供，省略时保留旧版章状态读取方式。 */
  readonly candidateId?: string;
  /** Compile 步产物；packet.text 是装配完成的生成输入。 */
  readonly packet: ContextPacket;
  /** recipe 实例：taskType 驱动引擎解析（tier→provider），预算字段随 payload 下发。 */
  readonly recipe: CapabilityRecipe;
  readonly mode?: DraftMode;
  /**
   * 会话窗口任务引用（T21 · t52:B1；编排方从 ChapterProductionSession.taskRef 取，
   * recordUserEdit/runFlywheelRecord 的 taskRef 同源）：经 meta.parentTaskRef 进执行
   * 事件 payload 层（DomainEvent 禁增顶层字段，t52:B5）。缺省不桥接。
   */
  readonly taskRef?: string;
  /**
   * 配方原档（T21 · P1a，t52:B1 定案值；loadRecipeById/loadRecipeFile 所得）：可得时
   * 经 meta.eventPayload = toGenerationStartedPayload(doc) 把 M14 形状解析快照挂进
   * GenerationStarted.payload.recipeSnapshot（三级嵌套，版本矩阵消费面——W6 起
   * 在 @mozhou/runtime recipe-payload / @mozhou/quality-engine metrics-gates）；
   * 缺省行不含 recipeSnapshot（读侧 ?? null 容缺是既定行为）。
   */
  readonly recipeDoc?: CapabilityRecipeDocument;
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
  /**
   * 本次运行是否真的产出了正文（运行态文件 appendedChars > 0）。
   * 调用方据此区分两种失败：「什么都没给」（⇒ 该报失败）与
   * 「断了但已留下可采纳的半稿」（⇒ 维持 partial 语义，别把半稿当失败藏起来）。
   * chars 答不了这个问题：continue 模式的基底本身就让 chars > 0。
   */
  readonly produced: boolean;
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
  if (request.candidateId !== undefined) candidateRelPath(request.candidateId);
  const mode: DraftMode = request.mode ?? 'generate';
  // T21（t52:B1）桥接：会话窗口 taskRef→parentTaskRef（payload 层）、chapterIndex→顶层槽；
  // recipeDoc 可得时铸 M14 形状 eventPayload。业务 payload 不再携带平铺 recipeId/
  // recipeVersion 两键——唯一消费方只走 recipeSnapshot 嵌套路径（W6 起消费面在
  // @mozhou/runtime recipe-payload / @mozhou/quality-engine metrics-gates）。
  const result = await request.engine.execute(
    request.recipe.taskType,
    {
      prompt: request.packet.text,
      hotContextBytes: request.recipe.contextBudget.hotContextBytes,
      mode,
    },
    {
      ...(request.taskRef === undefined ? {} : { parentTaskRef: request.taskRef }),
      chapterIndex: request.chapterIndex,
      ...(request.recipeDoc === undefined ? {} : { eventPayload: toGenerationStartedPayload(request.recipeDoc) }),
    },
  );

  const proseRelPath = proseChapterPath(request.chapterIndex);
  const state = request.candidateId === undefined
    ? readDraftState(request.bookRoot, request.chapterIndex)
    : readCandidateState(request.bookRoot, request.chapterIndex, request.candidateId);
  // C2（T04）：生成结果从候选读取，不再从正文取——正文只能经 accept 落盘（I01）
  const candidateId = request.candidateId ?? state?.candidateId;
  const candidate = candidateId === undefined ? null : readDraftCandidate(request.bookRoot, candidateId);
  const candidateText = candidate === null ? '' : candidate.text;
  const text =
    result.outcome === 'succeeded' && typeof result.value === 'string'
      ? result.value
      : candidateText;

  if (result.outcome !== 'succeeded') {
    const hint =
      result.outcome === 'failed_recoverable' && typeof result.repairHint === 'object' && result.repairHint !== null
        ? (result.repairHint as Record<string, unknown>)
        : {};
    const hintProviders = Array.isArray(hint['triedProviders']) ? (hint['triedProviders'] as unknown[]) : [];
    const partialReason = state?.reason;
    const hintMessage = typeof hint['providerMessage'] === 'string' ? hint['providerMessage'] : undefined;
    const failureReason: string | undefined =
      partialReason ?? hintMessage ?? generationFinishedReason(request.bookRoot, result.taskRef);
    return {
      outcome: result.outcome,
      proseRelPath,
      text,
      chars: text.length,
      partial: state?.status === 'partial',
      produced: (state?.appendedChars ?? 0) > 0,
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
    partial: candidate?.status === 'partial',
    produced: (state?.appendedChars ?? 0) > 0,
  };
}
