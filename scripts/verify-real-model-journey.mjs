/**
 * scripts/verify-real-model-journey.mjs
 *
 * 真实模型端到端验收：建书 → 建章 → 真实流式生成 → 采纳候选 → 定稿提交。
 *
 * 为什么需要这个脚本：仓库此前的生成链路测试全部注入假 provider，或走
 * `MOZHOU_DRAFT_PROVIDER=mock`（把 prompt 切块当正文回吐）；唯一调用真实模型的
 * 测试在 CI 中永远被跳过。因此「AI 能否真的写出可用正文」这一核心主张长期处于
 * **未验证**状态。本脚本用真实上游跑一次完整旅程并留档。
 *
 * 用法：
 *   DEEPSEEK_API_KEY=sk-xxx node scripts/verify-real-model-journey.mjs
 *   （或 OPENAI_API_KEY / MOZHOU_API_KEY；可选 MOZHOU_API_BASE / MOZHOU_MODEL）
 *
 * 未配置密钥时：如实写出 BLOCKED 证据并以 0 退出——不伪造成功，也不假装跑过。
 */
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..');

const SERVER_PORT = Number(process.env.MOZHOU_VERIFY_PORT ?? 5199);
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = join(repoRoot, 'evidence', 'real-model-journey', RUN_ID);

const logLines = [];
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logLines.push(line);
}

function sourceCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: repoRoot }).toString().trim();
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

const apiKey =
  process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || process.env.MOZHOU_API_KEY || '';

log('================================================================');
log('MoZhou · 真实模型端到端验收（建书 → 建章 → 生成 → 采纳 → 提交）');
log('================================================================');

if (!apiKey) {
  log('BLOCKED: 未配置 DEEPSEEK_API_KEY / OPENAI_API_KEY / MOZHOU_API_KEY。');
  log('本脚本不伪造真实模型结果：请配置密钥后重跑。');
  writeEvidence({
    kind: 'test',
    status: 'BLOCKED',
    reason: 'NO_REAL_MODEL_CREDENTIAL',
    sourceCommit: sourceCommit(),
    command: 'node scripts/verify-real-model-journey.mjs',
    exitCode: 0,
    scope: '真实模型端到端旅程（建书 → 建章 → 真实流式生成 → 采纳候选 → 定稿提交）',
    limitations: [
      '未配置真实模型密钥，旅程未执行：本次运行不构成任何真实生成能力的证据。',
      '配置 DEEPSEEK_API_KEY（或 OPENAI_API_KEY / MOZHOU_API_KEY）后重跑本脚本方可取证。',
    ],
  });
  process.exit(0);
}

const { createBook, LocalDataPlane } = await import(
  new URL('../packages/data-plane/dist/index.js', import.meta.url).href
);

let server = null;
let bookRoot = null;
let serverCwd = null;

/**
 * 起独立服务进程。
 *
 * `cwd` 刻意指向专用临时目录：数据根是 `resolve(process.cwd(), '.mozhou_data')`，
 * 而数据根有进程级排他锁。若沿用仓库 cwd，会撞上开发者本机正在运行的墨舟实例
 * （DATA_ROOT_LOCKED），验收脚本既跑不起来、也不该去碰用户真实数据根。
 * 静态资源按模块自身路径解析，不受 cwd 影响。
 */
function startServer() {
  const serverEntry = resolve(repoRoot, 'apps/web/dist-server/productionServer.js');
  serverCwd = mkdtempSync(join(tmpdir(), 'mozhou-realmodel-server-'));
  const env = {
    ...process.env,
    PORT: String(SERVER_PORT),
    HOST: '127.0.0.1',
    // 刻意不设置 MOZHOU_DRAFT_PROVIDER=mock：本脚本要验的就是真实上游。
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
      const res = await fetch(`${SERVER_URL}/api/membership`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
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
  // 1. 建书 + 建章
  bookRoot = mkdtempSync(join(tmpdir(), 'mozhou-realmodel-'));
  const created = createBook({ dir: bookRoot, title: '真实模型验收书' });
  log(`book created: id=${created.book.id} root=${bookRoot}`);

  const plane = LocalDataPlane.openOrRebuild(bookRoot);
  try {
    plane.createChapterDraft({ chapterIndex: 1, title: '第一章 启程' });
  } finally {
    plane.close();
  }
  log('chapter 1 draft created');

  // 2. 启动真实服务器（不设 mock provider）
  server = startServer();
  await waitForServer();
  log(`server ready at ${SERVER_URL}`);

  // 3. 真实流式生成
  const prompt = '写一段开篇：清晨的渡口，主角第一次见到那艘将改变他一生的船。要求 200 字左右，第三人称，有具体感官细节。';
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

  log(`provider=${startFrame.provider} chars=${generated.length} outcome=${doneFrame.outcome}`);

  // 真实模型判据：provider 帧必须自报 real，且正文不是对 prompt 的回吐
  if (startFrame.provider !== 'real-openai-compatible') {
    throw new Error(`provider frame is "${startFrame.provider}", expected "real-openai-compatible" — 旅程未走真实上游`);
  }
  if (generated.length < 50) {
    throw new Error(`generated text too short (${generated.length} chars) to be real prose`);
  }
  if (prompt.includes(generated)) {
    throw new Error('generated text is an echo of the prompt — 疑似 mock 流，非真实生成');
  }

  // 4. 采纳候选
  const accept = await postJson('/api/draft.accept', {
    root: bookRoot,
    candidateId: startFrame.candidateId,
    base: startFrame.base,
    idempotencyKey: `verify-${RUN_ID}`,
  });
  if (accept.status !== 200 || accept.data.ok !== true) {
    throw new Error(`draft.accept failed: HTTP ${accept.status} ${JSON.stringify(accept.data)}`);
  }
  log(`candidate accepted: revision=${accept.data.revision ?? 'n/a'}`);

  // 5. 校验正文真的落到正典文件
  const prosePath = join(bookRoot, '正文', '第一卷', '第0001章.md');
  if (!existsSync(prosePath)) throw new Error(`prose file missing after accept: ${prosePath}`);
  const proseOnDisk = readFileSync(prosePath, 'utf8');
  if (!proseOnDisk.includes(generated.slice(0, 40))) {
    throw new Error('prose on disk does not contain the generated text — accept did not land');
  }
  log('prose on disk verified to contain generated text');

  // 6. 定稿提交
  const commit = await postJson('/api/chapter.commit', {
    root: bookRoot,
    chapterIndex: 1,
    summary: '真实模型端到端验收 · 第 1 章定稿',
  });
  if (commit.status !== 200 || commit.data.ok !== true) {
    throw new Error(`chapter.commit failed: HTTP ${commit.status} ${JSON.stringify(commit.data)}`);
  }
  log(`chapter committed: ${commit.data.commitId} phase=${commit.data.phase}`);

  writeEvidence({
    kind: 'test',
    status: 'VERIFIED',
    sourceCommit: sourceCommit(),
    command: 'node scripts/verify-real-model-journey.mjs',
    exitCode: 0,
    scope: '真实模型端到端旅程：建书 → 建章 → 真实流式生成 → 采纳候选 → 定稿提交',
    provider: {
      frame: startFrame.provider,
      base: process.env.MOZHOU_API_BASE ?? 'provider default',
      model: process.env.MOZHOU_MODEL ?? 'provider default',
    },
    result: {
      promptChars: prompt.length,
      generatedChars: generated.length,
      generatedHead: generated.slice(0, 120),
      candidateId: startFrame.candidateId,
      outcome: doneFrame.outcome,
      commitId: commit.data.commitId,
      contentSha256: commit.data.contentSha256,
      proseFile: '正文/第一卷/第0001章.md',
    },
    limitations,
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
    command: 'node scripts/verify-real-model-journey.mjs',
    exitCode,
    scope: '真实模型端到端旅程：建书 → 建章 → 真实流式生成 → 采纳候选 → 定稿提交',
    error: message,
    limitations,
  });
} finally {
  if (server) {
    server.kill();
  }
  if (bookRoot && !process.env.MOZHOU_VERIFY_KEEP_BOOK) {
    rmSync(bookRoot, { recursive: true, force: true });
  }
  if (serverCwd && !process.env.MOZHOU_VERIFY_KEEP_BOOK) {
    rmSync(serverCwd, { recursive: true, force: true });
  }
}

process.exit(exitCode);
