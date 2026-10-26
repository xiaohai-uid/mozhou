/**
 * scripts/verify-mock-journey.mjs
 *
 * 主框架走通验收（零真实模型）：建书 → 会话开启 → 步进 → mock 流式生成 →
 * 采纳候选 → 审查 → 步进 → 定稿提交 → 上下文凭证回读 → 导出。全链 HTTP，起的是
 * 真实 productionServer 进程，走的真实 RuntimeEngine / 管线 / 数据面；
 * 唯一被 mock 掉的是 LLM 上游（MOZHOU_DRAFT_PROVIDER=mock，既有显式演示/测试
 * 开关，start 帧自报 provider:'mock'）。
 *
 * 与 verify-real-model-journey.mjs 的分工：
 *   - 后者验「真实上游能不能写」——需要密钥，未配置即 BLOCKED；
 *   - 本脚本验「主框架十步骨架能不能走通」——零密钥、零上游费用、可进 CI。
 *   两者都不伪造对方的结果：本脚本 VERIFIED ≠ 真实生成能力 VERIFIED。
 *
 * 提取缝说明：mock 档只覆盖草稿生成；提交期的正典提取（extractChapterDelta）
 * 无 mock 档可用 ⇒ 按其既有降级语义回空批 ⇒ 走提交路由的「无候选直提」分支。
 * 该分支是有契约的正式路径（proseRoutes.sessionComplete.test.ts 夹具同款），
 * 不是本脚本的特殊豁免。
 *
 * 用法：
 *   node scripts/verify-mock-journey.mjs
 *   （可选 MOZHOU_VERIFY_PORT，缺省 5198；MOZHOU_VERIFY_KEEP_BOOK=1 保留现场）
 */
import { spawn } from 'node:child_process';
import { readSourceStamp } from './release/lib/source-stamp.mjs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..');

const SERVER_PORT = Number(process.env.MOZHOU_VERIFY_PORT ?? 5198);
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = join(repoRoot, 'evidence', 'mock-journey', RUN_ID);

const logLines = [];
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logLines.push(line);
}

/**
 * 来源戳：脏工作区里短 HEAD 会谎报（旅程跑的是未提交源码，戳却指向干净提交）。
 * 复用 scripts/release/lib/source-stamp.mjs：脏则加 `-dirty` 后缀。
 */
function sourceCommit() {
  try {
    return readSourceStamp(repoRoot).sourceCommit;
  } catch {
    return 'unknown';
  }
}

function writeEvidence(payload) {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, 'result.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  writeFileSync(join(evidenceDir, 'run.log'), `${logLines.join('\n')}\n`, 'utf8');
  log(`evidence written: ${evidenceDir}`);
}

log('================================================================');
log('MoZhou · 主框架走通验收（mock 生成 · 全链 HTTP · 零真实模型）');
log('================================================================');

/**
 * 审查策略：与前端/测试面同款的确定性规则集（schemaVersion 1 + maxAutomaticReworks 2
 * 才被 /api/chapter.review 认作显式 policy）。web 直连面无语义提供方 ⇒ 只有确定性
 * 规则可判——这与 proseRoutes.sessionComplete.test.ts 夹具一致，缺省全平台策略必 refused。
 */
const DETERMINISTIC_POLICY = {
  schemaVersion: 1,
  projectId: 'verify-mock-journey',
  rules: [
    { id: 'PARA-001', version: '1.0.0', scope: 'platform', kind: 'deterministic', severity: 'blocking', description: '段落瀑布', evidenceRequired: true, enabled: true },
    { id: 'REV-001', version: '1.0.0', scope: 'platform', kind: 'deterministic', severity: 'blocking', description: '锚点一致', evidenceRequired: true, enabled: true },
  ],
  maxAutomaticReworks: 2,
};

let server = null;
let bookRoot = null;
let serverCwd = null;

/** 起独立服务进程。cwd 指向专用临时目录：数据根有进程级排他锁，不碰开发者本机实例。 */
function startServer() {
  const serverEntry = resolve(repoRoot, 'apps/web/dist-server/productionServer.js');
  serverCwd = mkdtempSync(join(tmpdir(), 'mozhou-mockjourney-server-'));
  const env = {
    ...process.env,
    PORT: String(SERVER_PORT),
    HOST: '127.0.0.1',
    // 主开关：mock provider 走真实 RuntimeEngine/候选落盘路径，只是不打出网请求。
    MOZHOU_DRAFT_PROVIDER: 'mock',
  };
  const child = spawn('node', [serverEntry], {
    cwd: serverCwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => {
    const s = d.toString().trim();
    if (s) log(`[server] ${s}`);
  });
  child.stderr.on('data', (d) => {
    const s = d.toString().trim();
    if (s) log(`[server:err] ${s}`);
  });
  return child;
}

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${SERVER_URL}/api/health`, { method: 'GET' });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not become ready in time');
}

async function postJson(path, body) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

/** 消费 /api/draft.stream 的 NDJSON 流，返回各帧。 */
async function streamDraft(path, body) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`draft.stream HTTP ${res.status}: ${await res.text()}`);
  }
  const frames = [];
  let buffered = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buffered += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffered.indexOf('\n')) !== -1) {
      const line = buffered.slice(0, idx).trim();
      buffered = buffered.slice(idx + 1);
      if (line) frames.push(JSON.parse(line));
    }
  }
  if (buffered.trim()) frames.push(JSON.parse(buffered.trim()));
  return frames;
}

const limitations = [];
let exitCode = 0;

try {
  // 1. 建书（HTTP；数据根 = 服务进程临时 cwd 下的 .mozhou_data）
  server = startServer();
  await waitForServer();
  log(`server ready at ${SERVER_URL}`);

  const created = await postJson('/api/book', { title: '主框架走通验收书' });
  if (created.status !== 200 || created.data.ok !== true) {
    throw new Error(`book create failed: HTTP ${created.status} ${JSON.stringify(created.data)}`);
  }
  bookRoot = created.data.root;
  log(`book created: id=${created.data.bookId} root=${bookRoot}`);

  // 1.5 作者填故事脑（真实路径：Story Brain 面板存实体卡）。
  // 新书零正典 ⇒ 召回空 ⇒ buildDraftContext 走 structural_fallback（合法生成路径
  // 但不落 ContextCompiled 凭证，D10 不编锚点）⇒ 后续审查必 409 NO_COMPILED_RECEIPT。
  // 存一张卡让召回通道有真命中 ⇒ compiled_receipt 模式，审查锚点成立。
  const cardSaved = await postJson('/api/story-brain.entity.save', {
    root: bookRoot,
    name: '林渡',
    cardType: 'char',
    brief: '清晨渡口第一次见到那艘船的少年主角。',
    details: '在渡口长大的少年，对水流和船只的习性异常敏感。',
  });
  if (cardSaved.status !== 200 || cardSaved.data.ok !== true) {
    throw new Error(`story-brain.entity.save failed: HTTP ${cardSaved.status} ${JSON.stringify(cardSaved.data)}`);
  }
  log(`story brain entity saved: ref=${cardSaved.data.card?.ref ?? cardSaved.data.card?.id ?? 'n/a'}`);

  // 2. 会话开启（步 1 prepare）
  const opened = await postJson('/api/session.open', { root: bookRoot, chapterIndex: 1 });
  if (opened.status !== 200 || opened.data.ok !== true) {
    throw new Error(`session.open failed: HTTP ${opened.status} ${JSON.stringify(opened.data)}`);
  }
  log(`session opened: taskRef=${opened.data.taskRef} step=${opened.data.currentStep}`);

  // 3. 步进 prepare→compile（不依赖 provider，该门不得误伤）
  const toCompile = await postJson('/api/session.advance', { root: bookRoot, chapterIndex: 1 });
  if (toCompile.status !== 200 || toCompile.data.currentStep !== 'compile') {
    throw new Error(`advance to compile failed: HTTP ${toCompile.status} ${JSON.stringify(toCompile.data)}`);
  }

  // 4. 步进 compile→draft（mock provider 下放行；无 provider 时此处应 PROVIDER_UNAVAILABLE，
  //    该负路径由 pipelineRoutes.advanceGuard.test.ts 回归锁死，本脚本不重复）
  const toDraft = await postJson('/api/session.advance', { root: bookRoot, chapterIndex: 1 });
  if (toDraft.status !== 200 || toDraft.data.currentStep !== 'draft') {
    throw new Error(`advance to draft failed: HTTP ${toDraft.status} ${JSON.stringify(toDraft.data)}`);
  }
  log('session stepped: prepare → compile → draft');

  // 5. mock 流式生成（真实 RuntimeEngine + 候选落盘，仅上游被 mock）
  const prompt = '写一段开篇：清晨的渡口，主角第一次见到那艘将改变他一生的船。';
  const frames = await streamDraft('/api/draft.stream', {
    root: bookRoot,
    chapterIndex: 1,
    prompt,
    mode: 'replace',
  });
  const startFrame = frames.find((f) => f.event === 'start');
  const doneFrame = frames.find((f) => f.event === 'done');
  const errorFrame = frames.find((f) => f.event === 'error');
  const generated = frames
    .filter((f) => f.event === 'delta')
    .map((f) => f.text ?? '')
    .join('');

  if (errorFrame) throw new Error(`stream error frame: ${errorFrame.error}`);
  if (!startFrame) throw new Error('missing start frame');
  if (!doneFrame) throw new Error('missing done frame');
  if (startFrame.provider !== 'mock') {
    throw new Error(`provider frame is "${startFrame.provider}", expected "mock" — 旅程必须显式走 mock 缝`);
  }
  if (frames.filter((f) => f.event === 'delta').length === 0) {
    throw new Error('mock stream produced zero deltas');
  }
  log(`draft streamed: provider=${startFrame.provider} chars=${generated.length} outcome=${doneFrame.outcome}`);

  // 6. 采纳候选
  const accept = await postJson('/api/draft.accept', {
    root: bookRoot,
    candidateId: startFrame.candidateId,
    base: startFrame.base,
    idempotencyKey: `mock-journey-${RUN_ID}`,
  });
  if (accept.status !== 200 || accept.data.ok !== true) {
    throw new Error(`draft.accept failed: HTTP ${accept.status} ${JSON.stringify(accept.data)}`);
  }
  log(`candidate accepted: revision=${accept.data.revision ?? 'n/a'}`);

  // 7. 校验正文真的落到正典文件
  const prosePath = join(bookRoot, '正文', '第一卷', '第0001章.md');
  if (!existsSync(prosePath)) throw new Error(`prose file missing after accept: ${prosePath}`);
  const proseOnDisk = readFileSync(prosePath, 'utf8');
  if (!proseOnDisk.includes(generated.slice(0, 40))) {
    throw new Error('prose on disk does not contain the streamed text — accept did not land');
  }
  log('prose on disk verified to contain streamed text');

  // 8. 文学审查（确定性策略，零模型调用；编译凭证由 draft.stream 的 draftContext 落下）
  // 骨架旅程用 30 字 mock 草稿；显式关闭字数窗口，机械门的阻断行为由
  // review-step / productionRoutes 的负例单独覆盖。默认窗口仍对真实草稿生效。
  const review = await postJson('/api/chapter.review', {
    root: bookRoot,
    chapterIndex: 1,
    policy: DETERMINISTIC_POLICY,
    mechanicalOptions: { minWords: 0 },
  });
  if (review.status !== 200 || review.data.ok !== true) {
    throw new Error(`chapter.review failed: HTTP ${review.status} ${JSON.stringify(review.data)}`);
  }
  if (review.data.verdict !== 'pass') {
    throw new Error(`review verdict is "${review.data.verdict}", expected "pass": ${JSON.stringify(review.data.blockingFailures ?? review.data)}`);
  }
  log(`review passed: reportId=${review.data.reportId} mechanicalPassed=${review.data.mechanicalGate?.passed}`);

  // 9. 步进 review→user_edit（verdict 'pass' 已由审查落账，该门应放行）
  const toUserEdit = await postJson('/api/session.advance', { root: bookRoot, chapterIndex: 1 });
  if (toUserEdit.status !== 200 || toUserEdit.data.currentStep !== 'user_edit') {
    throw new Error(`advance to user_edit failed: HTTP ${toUserEdit.status} ${JSON.stringify(toUserEdit.data)}`);
  }
  log('session stepped: review → user_edit');

  // 10. 定稿提交（步 6-10 一次收口；mock 档下提取缝降级空批 ⇒ 无候选直提分支）
  let commit = await postJson('/api/chapter.commit', {
    root: bookRoot,
    chapterIndex: 1,
    summary: '主框架走通验收 · 第 1 章定稿',
    expectedRevision: accept.data.revision,
  });
  if (commit.status === 409 && commit.data.code === 'CANON_PROPOSAL_PENDING') {
    const proposalId = commit.data.proposalId;
    const pendingItems = Array.isArray(commit.data.pendingItems) ? commit.data.pendingItems : [];
    if (!proposalId || pendingItems.length === 0) {
      throw new Error(`chapter.commit 409 CANON_PROPOSAL_PENDING without pending items: ${JSON.stringify(commit.data)}`);
    }
    log(`canon proposal pending: ${proposalId} · ${pendingItems.length} 项，逐项 confirm`);
    for (const item of pendingItems) {
      const decision = await postJson('/api/proposal.decide', {
        root: bookRoot,
        proposalId,
        itemId: item.itemId,
        action: 'confirm',
      });
      if (decision.status !== 200 || decision.data.ok !== true) {
        throw new Error(`proposal.decide failed: HTTP ${decision.status} ${JSON.stringify(decision.data)}`);
      }
    }
    commit = await postJson('/api/chapter.commit', {
      root: bookRoot,
      chapterIndex: 1,
      summary: '主框架走通验收 · 第 1 章定稿',
      expectedRevision: accept.data.revision,
    });
  }
  if (commit.status !== 200 || commit.data.ok !== true) {
    throw new Error(`chapter.commit failed: HTTP ${commit.status} ${JSON.stringify(commit.data)}`);
  }
  log(`chapter committed: ${commit.data.commitId} phase=${commit.data.phase}`);

  // 11. 上下文凭证可回读（draft.stream 经 draftContext 落下的编译凭证）
  const receipts = await postJson('/api/receipts', { root: bookRoot });
  if (receipts.status !== 200 || receipts.data.ok !== true || !Array.isArray(receipts.data.receipts)) {
    throw new Error(`receipts readback failed: HTTP ${receipts.status} ${JSON.stringify(receipts.data)}`);
  }
  if (receipts.data.receipts.length === 0) {
    throw new Error('no context receipts on disk — compile stage did not leave a receipt');
  }
  log(`context receipts readback: ${receipts.data.receipts.length} 条`);

  // 12. 导出（定稿章节可导出为 TXT）
  const exportRes = await fetch(`${SERVER_URL}/api/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root: bookRoot, format: 'txt' }),
  });
  if (!exportRes.ok) {
    throw new Error(`export failed: HTTP ${exportRes.status} ${await exportRes.text()}`);
  }
  const exported = await exportRes.text();
  if (!exported.includes(generated.slice(0, 20))) {
    throw new Error('exported txt does not contain the committed prose');
  }
  log(`export verified: ${exported.length} chars txt`);

  writeEvidence({
    kind: 'test',
    status: 'VERIFIED',
    sourceCommit: sourceCommit(),
    command: 'node scripts/verify-mock-journey.mjs',
    exitCode: 0,
    scope: '主框架走通（mock 生成）：建书 → 会话开启 → 步进 → mock 流式生成 → 采纳 → 审查 → 步进 → 提交（步 6-10 收口）→ 上下文凭证回读 → 导出',
    provider: { frame: startFrame.provider, note: 'MOZHOU_DRAFT_PROVIDER=mock（显式演示/测试开关）' },
    result: {
      promptChars: prompt.length,
      streamedChars: generated.length,
      streamedHead: generated.slice(0, 120),
      candidateId: startFrame.candidateId,
      outcome: doneFrame.outcome,
      reviewVerdict: review.data.verdict,
      reportId: review.data.reportId,
      commitId: commit.data.commitId,
      receiptCount: receipts.data.receipts.length,
      exportedChars: exported.length,
      proseFile: '正文/第一卷/第0001章.md',
    },
    limitations: [
      'mock 档生成 = prompt 切块回吐，不构成任何真实生成能力的证据（真实上游另见 pnpm verify:real-model）。',
      '正典提取在 mock 档下按既有降级语义回空批，走无候选直提分支；真实提取路径未被本脚本覆盖。',
      ...limitations,
    ],
  });
  log('RESULT: VERIFIED');
} catch (error) {
  exitCode = 1;
  const message = error?.message ?? String(error);
  log(`FAILED: ${message}`);
  writeEvidence({
    kind: 'test',
    status: 'FAILED',
    sourceCommit: sourceCommit(),
    command: 'node scripts/verify-mock-journey.mjs',
    exitCode,
    scope: '主框架走通（mock 生成）：建书 → 会话开启 → 步进 → mock 流式生成 → 采纳 → 审查 → 步进 → 提交（步 6-10 收口）→ 上下文凭证回读 → 导出',
    error: message,
    limitations,
  });
} finally {
  if (server) {
    server.kill();
  }
  const safeRm = (target) => {
    if (!target || process.env.MOZHOU_VERIFY_KEEP_BOOK) return;
    try {
      rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      // Windows file lock tolerance during asynchronous process termination
    }
  };
  safeRm(bookRoot);
  safeRm(serverCwd);
}

process.exit(exitCode);
