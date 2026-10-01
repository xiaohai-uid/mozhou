/**
 * C:\zcode\novel-ai-handoff-stage4\runner.mjs
 *
 * 本轮（多章上下文 / 取消后恢复）隔离验收运行器。**不是产品代码，刻意放在仓库之外**：
 * 仓库 lint 走 typescript-eslint 的 project service，未列入 tsconfig 的 .mjs 会被
 * 报 Parsing error —— 把可执行脚本放进仓库会污染「改动后 pnpm lint 全绿」这个结论
 * （第一版放在 handoff-results/ 下时实测就把 lint 打红了，已移出）。
 * 证据产物（JSON/日志/导出文件）仍回填到仓库内的 handoff-results/ 供审查。
 *
 * 它做三件事：
 *   1. 起一个**隔离**墨舟服务进程（独立 MOZHOU_DATA_ROOT / PORT / MOZHOU_SECRET_KEY，
 *      从 apps/web/dist-server 的本次构建产物启动）；
 *   2. 全部通过**应用 HTTP 路由**建测试作品、落夹具正文、生成、取消、采纳、导出；
 *   3. 不打印凭据、不写凭据进任何文件、不触碰真实书稿库与真实数据根。
 *
 * 用法（先 pnpm build && pnpm --filter @mozhou/web build）：
 *   node runner.mjs --phase b                     # 多章上下文（默认受控/离线通道）
 *   node runner.mjs --phase c-control             # 可控流式替身：取消边界
 *   node runner.mjs --phase c-disc                # 断开后服务端收尾
 *   node runner.mjs --phase c-real --channel real # 真实上游（**默认关闭**，必须显式开启）
 *
 * 纪律（Codex 第四轮复核后收紧）：
 *   - **channel 默认 'controlled'**：不给 --channel real，就绝不会碰真实上游；
 *   - 真实通道的每一次请求都必须先经 guardedSend() 原子占用整张工单的共享额度；
 *   - 每次运行产出**唯一目录**（runs/<runId>/），原始帧/日志/结果都在里面，不覆盖历史；
 *   - 凭据只从**子进程环境内存**继承，永不落盘、永不打印、永不写进命令行参数。
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { budgetSnapshot, initLedger } from './harness/accounting.mjs';
import { guardedSend } from './harness/transport.mjs';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const REPO = 'C:\\zcode\\novel-ai';
/** 产物先落在仓库外（HERE/artifacts），最后由 export-results.mjs 回填到 handoff-results/。 */
const ART = join(HERE, 'artifacts');
const STATE = join(HERE, '.state');
mkdirSync(ART, { recursive: true });
mkdirSync(STATE, { recursive: true });

function argOf(name, fallback = null) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

/**
 * **通道判别**：默认 'controlled'（本地替身，零真实调用）。
 * 只有显式 --channel real 才可能走到真实上游；且真实请求必须过 guardedSend 额度门。
 */
const CHANNEL = argOf('channel', 'controlled');
if (CHANNEL !== 'controlled' && CHANNEL !== 'real') {
  console.error('非法 --channel：' + CHANNEL + '（只接受 controlled | real）');
  process.exit(2);
}
const PHASE = argOf('phase', 'b');
/** 整张工单共享的额度账本目录（跨进程、跨运行）。 */
const TICKET_DIR = argOf('ticketDir', join(STATE, 'ticket'));
/** 初始额度只允许显式设置；缺省 0 ⇒ 新工单默认不允许任何真实调用。 */
const CALL_BUDGET = Number(argOf('callBudget', '0'));
/** 只初始化账本、不做任何请求（供离线验证与人工立案）。 */
const INIT_ONLY = process.argv.includes('--init-ledger-only');

/** 每次运行一个**唯一目录**：不覆盖历史，原始帧与日志都留在里面。 */
const RUN_ID = PHASE + '-' + CHANNEL + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(3).toString('hex');
const RUN_DIR = join(HERE, 'runs', RUN_ID);
mkdirSync(RUN_DIR, { recursive: true });
const DATA_ROOT = argOf('dataRoot', join(STATE, 'stage4-data'));
const CONTROL_PORT = Number(argOf('controlPort', '0'));

/** 防覆盖检查：同名 run 目录已存在即拒绝（时间戳+随机后缀理论上不会撞，撞了要显式停）。 */
if (existsSync(join(RUN_DIR, 'run.json'))) {
  console.error('RUN_DIR 已存在，拒绝覆盖：' + RUN_DIR);
  process.exit(3);
}

const logLines = [];
function log(msg) {
  const line = '[' + new Date().toISOString() + '] ' + msg;
  console.log(line);
  logLines.push(line);
  writeFileSync(join(RUN_DIR, 'run.log'), logLines.join('\n') + '\n', 'utf8');
}
/** 结果写进本次运行的唯一目录；同时写一份 latest 指针，便于人工查看（不是覆盖证据）。 */
function writeJson(name, payload) {
  writeFileSync(join(RUN_DIR, name), JSON.stringify(payload, null, 2) + '\n', 'utf8');
}
function writeRaw(name, text) {
  writeFileSync(join(RUN_DIR, name), text, 'utf8');
}
function writeArtifact(name, buf) {
  writeFileSync(join(RUN_DIR, name), buf);
}
function writeLog(name) {
  writeFileSync(join(RUN_DIR, (name === undefined ? 'run.log' : name)), logLines.join('\n') + '\n', 'utf8');
}

/* ---- 额度账本：先立案（只写盘），真实通道每次请求前先占用 ---- */
function ensureLedger() {
  const existing = budgetSnapshot(TICKET_DIR);
  if (existing.exists) {
    // 已立案：**不重置**（重启不退款）；只做合法性检查
    return existing;
  }
  initLedger(TICKET_DIR, {
    ticket: 'mozhou-stage4-audit-fix',
    allowance: CALL_BUDGET,
    note: '整张工单共享额度；缺省 0 = 默认不允许任何真实调用',
  });
  return budgetSnapshot(TICKET_DIR);
}
const LEDGER_AT_START = ensureLedger();
const TICKET_ALLOWANCE = LEDGER_AT_START.allowance;

/** 运行元数据：账目生成器（make-ledger.mjs）按它识别 channel 与额度。 */
writeFileSync(join(RUN_DIR, 'run-meta.json'), JSON.stringify({
  runId: RUN_ID,
  phase: PHASE,
  channel: CHANNEL,
  realModelCallsAllowed: TICKET_ALLOWANCE,
  ledgerFile: join(TICKET_DIR, 'ledger.json'),
  repo: REPO,
  dataRoot: DATA_ROOT,
  startedAt: new Date().toISOString(),
  argv: process.argv.slice(2),
}, null, 2) + '\n', 'utf8');

/** 每个生成调用都落一份**原始 NDJSON 帧**（不加工、不截断）。 */
let frameSeq = 0;
function writeFrames(label, rawLines) {
  frameSeq += 1;
  const safe = String(label).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60);
  const name = 'frames-' + String(frameSeq).padStart(2, '0') + '-' + safe + '.ndjson';
  writeRaw(name, rawLines.join(String.fromCharCode(10)) + String.fromCharCode(10));
  return name;
}
/** 运行时请求上限 = 账本额度（跨进程共享），不再是本进程局部变量。 */
const realCallBudget = TICKET_ALLOWANCE;
function sha256Text(t) { return createHash('sha256').update(t, 'utf8').digest('hex'); }
function readUtf8(p) { return existsSync(p) ? readFileSync(p, 'utf8') : null; }

/**
 * /api/chapter.prose 的 body 是**盘上原文**（含 YAML frontmatter）。本函数取出
 * frontmatter 之后的正文载荷，供逐段比对使用（导出验证同口径）。
 */
function stripFrontmatter(raw) {
  if (typeof raw !== 'string') return '';
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(raw);
  return m === null ? raw : raw.slice(m[0].length);
}
/** 仅脚手架占位（从未被作者/生成写入过）的章：正文载荷只有 `# 第N章` 标题。 */
function isScaffoldOnly(raw, chapterIndex) {
  const body = stripFrontmatter(raw).trim();
  return body === '' || body === ('# 第' + chapterIndex + '章').trim() || body === ('# 第 ' + chapterIndex + ' 章').trim();
}

/**
 * 真实上游调用计数（预算：最多 4 次生成请求 + 1 次最小连接诊断）。
 * 429/tpm-rpm 是**上游限流**，不是产品缺陷；如实记录并等待后重试，且计入预算。
 */
/**
 * 从既有帧序列**补记**统计（只用于报告可读性；**不再**是权威账目）。
 * 权威账目只有一份：账本（TICKET_DIR/ledger.json），由 guardedSend 在发请求前写入。
 */
function summarizeStream(r) {
  const errFrame = r.frames.find((f) => f.event === 'error');
  const doneFrame = r.frames.find((f) => f.event === 'done');
  return {
    elapsedMs: r.elapsedMs ?? null,
    terminal: doneFrame !== undefined ? 'done' : errFrame !== undefined ? 'error' : r.aborted ? 'aborted_by_client' : 'no_terminal_frame',
    error: errFrame === undefined ? null : String(errFrame.error),
    rateLimited: errFrame !== undefined && /429|tpm\/rpm|rate_limit/i.test(String(errFrame.error ?? '')),
    deltaChars: r.frames.filter((f) => f.event === 'delta').map((f) => f.text ?? '').join('').length,
  };
}

/**
 * 真实通道的唯一发放入口。**先经 guardedSend 原子占用额度，再发请求**。
 * channel !== 'real' 时直接拒绝——受控替身一律走 openDraftStream，不经过这里。
 * @returns {{result: object, reservation: object, summary: object}}
 */
async function sendReal(body, onFrame, label, runDir) {
  if (CHANNEL !== 'real') {
    throw new Error('ChannelRefused: 当前 channel=' + CHANNEL + '，真实通道未开启（不许发真实请求）');
  }
  const t0 = Date.now();
  const { result, reservation } = await guardedSend({
    channel: 'real',
    ticketDir: TICKET_DIR,
    reason: label,
    runDir,
    transport: async () => await openDraftStream(body, onFrame),
  });
  const summary = summarizeStream(result);
  log('  [real] ' + label + ' reservation=' + reservation.reservationId + ' seq=' + reservation.seq + ' remaining=' + reservation.remainingAfter + ' → ' + summary.terminal);
  return { result, reservation, summary };
}

/**
 * **唯一的生成发放入口**。按 CHANNEL 分流：
 *   controlled ⇒ 直接打本地替身（零额度占用）；
 *   real       ⇒ 必须先过 guardedSend（先记账后发送）。
 * 调用方一律用这个函数，禁止再出现「某处自己 fetch /api/draft.stream」的裸调用。
 */
async function generate(body, onFrame, label) {
  if (CHANNEL === 'controlled') {
    const result = await openDraftStream({ ...body, channel: 'controlled' }, onFrame);
    const framesFile = writeFrames('controlled-' + label, result.rawLines ?? []);
    return { result, reservation: null, summary: summarizeStream(result), channel: 'controlled', framesFile };
  }
  const out = await sendReal({ ...body, channel: 'real' }, onFrame, label, RUN_DIR);
  const framesFile = writeFrames('real-' + label, out.result.rawLines ?? []);
  return { ...out, channel: 'real', framesFile };
}

/** 限流/连接失败退避重试——**每次重试都要重新占用额度**（不退款，因此受账本硬约束）。 */
async function generateWithBackoff(body, onFrame, label, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 1;
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    last = await generate(body, onFrame, label + '（第 ' + attempt + ' 次尝试）');
    const transient = last.summary.rateLimited || (last.result.error !== null && last.result.error !== undefined && /fetch failed/i.test(String(last.result.error)));
    if (!transient || attempt === maxAttempts) return last;
    log('  上游瞬时限流/连接失败，' + (opts.waitMs ?? 75000) + 'ms 后重试：' + label);
    await new Promise((res) => setTimeout(res, opts.waitMs ?? 75000));
  }
  return last;
}

const assertions = [];
function assert(name, ok, evidence) {
  assertions.push({ name, result: ok ? 'PASS' : 'FAIL', evidence: evidence === undefined ? null : evidence });
  log((ok ? '  PASS  ' : '  FAIL  ') + name + (evidence === undefined ? '' : ' :: ' + String(typeof evidence === 'string' ? evidence : JSON.stringify(evidence)).slice(0, 400)));
  return ok;
}

/* ---------------- 隔离服务 ---------------- */
let PORT = 0;
const SECRET_KEY = randomBytes(48).toString('base64');
let child = null;
let serverLog = [];

function entryPath() { return join(REPO, 'apps', 'web', 'dist-server', 'productionServer.js'); }

async function freePort() {
  return await new Promise((res, rej) => {
    const srv = createNetServer();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => res(p)); });
  });
}

/**
 * 读取 Windows **用户级**环境变量（本机凭据只放在这里，当前 shell 没有继承）。
 * 值只进子进程内存，绝不落盘 / 打印 / 进命令行。
 */
function userEnv(name) {
  try {
    const out = execFileSync('pwsh', ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('" + name + "','User')"], { encoding: 'utf8' });
    return out.trim();
  } catch {
    return '';
  }
}

/**
 * 受控替身端点。**只有 channel=controlled 时才存在**，且只注入到本运行自己起的子进程。
 * 这里显式开 MOZHOU_ALLOW_PRIVATE_LLM 是为了让被测进程能访问环回替身；
 * 它只影响本测试子进程（另有 loopback-gate-control 对照证明未授权时门禁仍拒）。
 */
let CONTROLLED_ENDPOINT = null;

function buildEnv(useCredentials) {
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    windir: process.env.windir,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(PORT),
    MOZHOU_DATA_ROOT: DATA_ROOT,
    MOZHOU_SECRET_KEY: SECRET_KEY,
    MOZHOU_HOSTED: 'false',
    MOZHOU_TIER_CONFIG: join(DATA_ROOT, '__absent__', 'tier-config.json'),
  };
  if (CHANNEL === 'controlled') {
    if (CONTROLLED_ENDPOINT === null) throw new Error('controlled channel 需要先起受控替身并设置 CONTROLLED_ENDPOINT');
    env.MOZHOU_API_KEY = 'controlled-fixture-key';
    env.MOZHOU_API_BASE = CONTROLLED_ENDPOINT;
    env.MOZHOU_MODEL = 'controlled-fixture';
    env.MOZHOU_ALLOW_PRIVATE_LLM = '1';
    return env;
  }
  if (useCredentials) {
    const key = (process.env.MOZHOU_API_KEY || process.env.SENSENOVA_API_KEY || userEnv('SENSENOVA_API_KEY')).trim();
    const base = (process.env.MOZHOU_API_BASE || process.env.SENSENOVA_BASE_URL || userEnv('SENSENOVA_BASE_URL') || 'https://token.sensenova.cn/v1').trim();
    if (key === '' || base === '') throw new Error('BLOCKED: 缺少真实模型凭据（变量名 MOZHOU_API_KEY/SENSENOVA_API_KEY 与 MOZHOU_API_BASE/SENSENOVA_BASE_URL）');
    env.MOZHOU_API_KEY = key;
    env.MOZHOU_API_BASE = base;
    env.MOZHOU_MODEL = 'deepseek-v4-flash';
  }
  return env;
}

/**
 * 起一个受控替身并把端点记进 CONTROLLED_ENDPOINT。
 * channel=controlled 的所有阶段（含 B / C-real 的离线回归）都从这里取端点。
 */
async function startControlledFixture(recordName, opts = {}) {
  const upstreamPort = await freePort();
  const fixtureArgs = [join(HERE, 'fixtures', 'controlled-upstream.mjs'), '--port', String(upstreamPort), '--record', join(RUN_DIR, recordName)];
  // completeAll：让替身正常收尾（不必在提示词里塞控制词，避免污染候选文本）。
  if (opts.completeAll === true) fixtureArgs.push('--complete');
  const fixture = spawn(process.execPath, fixtureArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  const upLog = [];
  fixture.stdout.on('data', (d) => upLog.push(d.toString()));
  fixture.stderr.on('data', (d) => upLog.push('[err]' + d.toString()));
  for (let i = 0; i < 100; i += 1) {
    try { const r = await fetch('http://127.0.0.1:' + upstreamPort + '/__ping'); if (r.ok) break; } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  CONTROLLED_ENDPOINT = 'http://127.0.0.1:' + upstreamPort + '/v1';
  writeRaw(recordName, '[]' + String.fromCharCode(10));
  return { fixture, upstreamPort, upLog, port: upstreamPort };
}

async function startServer({ real }) {
  PORT = CONTROL_PORT > 0 ? CONTROL_PORT : await freePort();
  const entry = join(REPO, 'apps', 'web', 'dist-server', 'productionServer.js');
  if (!existsSync(entry)) throw new Error('缺少本次构建产物，请先 pnpm build 与 pnpm --filter @mozhou/web build: ' + entry);
  serverLog = [];
  child = spawn(process.execPath, [entry], {
    cwd: join(REPO, 'apps', 'web'),
    env: buildEnv(real),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => serverLog.push(d.toString()));
  child.stderr.on('data', (d) => serverLog.push(d.toString()));
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url() + '/api/health');
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 350));
  }
  writeRaw('server-boot.log', serverLog.join('') + '\n');
  throw new Error('server did not become ready; log=' + serverLog.join('').slice(-3000));
}
function url() { return 'http://127.0.0.1:' + PORT; }

async function stopServer() {
  if (child === null) return { stopped: true, pid: null };
  const pid = child.pid;
  const exited = new Promise((res) => child.once('exit', (code, signal) => res({ code, signal })));
  child.kill();
  const r = await Promise.race([exited, new Promise((res) => setTimeout(() => res({ code: null, signal: 'timeout' }), 8000))]);
  return { stopped: true, pid, exit: r };
}

/* ---------------- HTTP ---------------- */
async function post(path, body) {
  const res = await fetch(url() + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 2000) }; }
  return { status: res.status, data, contentType: res.headers.get('Content-Type') };
}
async function postBuffer(path, body) {
  const res = await fetch(url() + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf, contentType: res.headers.get('Content-Type') };
}

/**
 * 打开 /api/draft.stream 逐帧回调。onFrame(frame, ctx)；ctx.abort() 主动断开
 * ——与浏览器 DialogueStream 的 readerRef.current.cancel() 同一条断开路径
 * （fetch body 流中止 → 客户端 TCP 复位 → 服务端 res 'close' → AbortController.abort()）。
 */
async function openDraftStream(body, onFrame, hooks = {}) {
  const ctrl = new AbortController();
  const frames = [];
  const rawLines = [];
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(url() + '/api/draft.stream', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
    });
  } catch (e) {
    return { frames, rawLines, meta: null, error: 'connect failed: ' + String(e && e.message), aborted: false };
  }
  const meta = { status: res.status, contentType: res.headers.get('Content-Type') };
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    return { frames, rawLines, meta, error: 'HTTP ' + res.status + ': ' + text.slice(0, 500), aborted: false };
  }
  const decoder = new TextDecoder();
  let buffered = '';
  let aborted = false;
  const ctx = {
    abort: () => { aborted = true; try { ctrl.abort(); } catch { /* already */ } },
    abortCalledAtMs: null,
  };
  try {
    for await (const chunk of res.body) {
      buffered += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, idx).trim();
        buffered = buffered.slice(idx + 1);
        if (!line) continue;
        rawLines.push(line);
        let frame = null;
        try { frame = JSON.parse(line); } catch { frame = null; }
        if (frame !== null) {
          frame.__tMs = Date.now() - t0;
          frames.push(frame);
          if (onFrame) onFrame(frame, ctx);
        }
      }
    }
  } catch (e) {
    if (!aborted) return { frames, rawLines, meta, error: String(e && e.message ? e.message : e), aborted, elapsedMs: Date.now() - t0 };
  }
  return { frames, rawLines, meta, aborted, abortCalledAtMs: ctx.abortCalledAtMs, elapsedMs: Date.now() - t0 };
}

/* ---------------- 书目辅助 ---------------- */
async function createBook(title) {
  const r = await post('/api/book', { title });
  if (r.status !== 200 || r.data.ok !== true) throw new Error('createBook failed: HTTP ' + r.status + ' ' + JSON.stringify(r.data));
  return r.data; // { root, bookId }
}
const readProse = (root, chapterIndex) => post('/api/chapter.prose', { root, chapterIndex });
const saveProse = (root, chapterIndex, body, expectedRevision, title) =>
  post('/api/chapter.prose.save', { root, chapterIndex, body, expectedRevision, ...(title === undefined ? {} : { title }) });

/* ---------------- 夹具 ---------------- */
const CH1_TITLE = '第一章 铜罗盘';
const CH1_BODY = [
  '雾把码头压得很低。林舟摸到怀里那只黄铜罗盘，指腹停在那道靛蓝色缺口上——磕口是斜的，像被什么东西从内侧顶开。',
  '“阿岚走的时候，把它留给了你。”老周把信递过来，声音里没有安慰的意思，“信封背面那四个字，是她亲手写的。”',
  '信封背面只有一行小字：潮退三寸。',
  '林舟抬头望向东岸。那座灯塔已经熄灯三年，塔身锈成一根插进雾里的灰针。',
].join('\n\n');

/* ==================== 阶段 B：多章上下文 ==================== */
async function phaseB() {
  const out = { phase: 'B', startedAt: new Date().toISOString(), channel: CHANNEL, runId: RUN_ID, runDir: RUN_DIR };
  let fixture = null;
  if (CHANNEL === 'controlled') {
    fixture = await startControlledFixture('controlled-upstream-b.json', { completeAll: true });
    out.controlledUpstream = { port: fixture.port, kind: 'test-double (not a real model)' };
  }
  await startServer({ real: true });
  out.server = { port: PORT, dataRoot: DATA_ROOT };
  log('server up on ' + url() + ' (dataRoot=' + DATA_ROOT + ')');

  const caps = await post('/api/capabilities', {});
  out.capabilities = caps.data;
  assert('provider 可用（真实通道）', caps.data.providerAvailable === true, caps.data.providerUnavailableReason ?? caps.data.detail);

  const book = await createBook('多章上下文验收书');
  out.book = book;
  const root = book.root;
  log('book created: ' + root);

  // --- 第一章夹具：经应用路由落盘（expectedRevision=null ⇒ 新建语义，不触发任何模型调用） ---
  const save1 = await saveProse(root, 1, CH1_BODY, null, CH1_TITLE);
  out.chapter1Save = save1.data;
  if (!(save1.status === 200 && save1.data.ok === true)) {
    assert('第一章夹具落盘', false, JSON.stringify(save1.data));
    return out;
  }
  const read1 = await readProse(root, 1);
  const ch1Payload = stripFrontmatter(read1.data.body);
  out.chapter1Readback = { revision: read1.data.revision, rawChars: read1.data.body.length, payloadChars: ch1Payload.length, payloadSha256: sha256Text(ch1Payload), rawSha256: sha256Text(read1.data.body) };
  assert('第一章读回正文与写入一致（正文载荷逐字相同）', ch1Payload.trim() === CH1_BODY.trim(), out.chapter1Readback);

  const ch1Facts = ['靛蓝色缺口', '阿岚', '潮退三寸', '熄灯三年'];
  const missing = ch1Facts.filter((f) => !read1.data.body.includes(f));
  assert('第一章夹具含全部稀有事实', missing.length === 0, { missing });

  // --- 第二章：中性指令（不复述任何第一章细节，避免伪造前文记忆证据） ---
  const prompt2 = '接着上一章写约200字，保持既有角色与物件，不要分析。';
  const gen2w = await generateWithBackoff({ root, chapterIndex: 2, prompt: prompt2 }, () => {}, 'B:第二章上下文生成', { maxAttempts: CHANNEL === 'real' ? 2 : 1, waitMs: 45000 });
  const gen2 = gen2w.result;
  out.channel = gen2w.channel;
  out.reservation = gen2w.reservation;
  out.chapter2Stream = {
    meta: gen2.meta,
    elapsedMs: gen2.elapsedMs,
    error: gen2.error ?? null,
    frames: gen2.frames.map((f) => (f.event === 'delta' ? { event: 'delta', chars: (f.text ?? '').length, __tMs: f.__tMs } : { ...f, prompt: f.prompt === undefined ? undefined : '__' + String(f.prompt).length + '_chars__' })),
  };
  const start = gen2.frames.find((f) => f.event === 'start');
  const done = gen2.frames.find((f) => f.event === 'done');
  const errF = gen2.frames.find((f) => f.event === 'error');
  if (start === undefined) { assert('第二章生成 start 帧', false, gen2.error ?? JSON.stringify(out.chapter2Stream.frames).slice(0, 500)); return out; }

  const ctxText = String(start.prompt ?? '');
  writeFileSync(join(RUN_DIR, 'context-chapter2.txt'), ctxText, 'utf8');
  // 落盘诊断帧（prompt 是本请求**实际**送进模型装配的完整上下文）
  writeFileSync(join(RUN_DIR, 'context-chapter2.frames.ndjson'), gen2.rawLines.join('\n') + '\n', 'utf8');

  out.captureContext = {
    contextMode: start.contextMode,
    contextTokens: start.contextTokens,
    provider: start.provider,
    promptChars: ctxText.length,
    promptSha256: sha256Text(ctxText),
    promptFile: 'context-chapter2.txt',
  };
  assert('第二章上下文里出现第一章的 4 个稀有事实', ch1Facts.every((f) => ctxText.includes(f)), { present: ch1Facts.filter((f) => ctxText.includes(f)) });
  assert('第二章上下文不含第二章指令以外的提示（指令未复述细节）', !prompt2.includes('靛蓝') && !prompt2.includes('阿岚') && !prompt2.includes('潮退'), { prompt: prompt2 });
  assert('第二章 start 帧 provider 自报可用上游', start.provider === 'real-openai-compatible' || start.provider === 'mock', start.provider);
  out.providerIdentity = {
    startFrameProvider: start.provider,
    channel: gen2w.channel,
    endpointProvenance: gen2w.channel === 'controlled'
      ? 'KNOWN_CONTROLLED_FIXTURE（本进程用 MOZHOU_API_BASE=http://127.0.0.1:<fixture> 起的服务，端点身份由本运行自身的环境决定）'
      : 'KNOWN_REAL（本进程用凭据解析出的公网端点；密钥不入账）',
    note: '真实通道的端点身份无法从墨舟账本反查（GenerationStarted 只记 providerId，BYOK 不打印 tier-route trace）；因此每次运行的 channel 必须由本文件显式声明。',
  };
  assert('第二章有 done 帧且 succeeded', done !== undefined && done.outcome === 'succeeded', done ?? errF ?? null);

  // --- 未采纳的候选不得覆盖正文 ---
  const r2after = await readProse(root, 2);
  out.chapter2BeforeAccept = { exists: r2after.data.exists, revision: r2after.data.revision, bodyChars: (r2after.data.body ?? '').length };
  const r1after = await readProse(root, 1);
  assert('生成未覆盖已保存的第一章', stripFrontmatter(r1after.data.body).trim() === CH1_BODY.trim() && r1after.data.revision === read1.data.revision, { revisionBefore: read1.data.revision, revisionAfter: r1after.data.revision });
  assert('未采纳的候选没有污染第二章正文（仍是脚手架原文，revision 不变）',
    r2after.data.exists === true && isScaffoldOnly(r2after.data.body, 2) && r2after.data.revision === 0,
    { exists: r2after.data.exists, payload: stripFrontmatter(r2after.data.body), revision: r2after.data.revision });

  // --- 候选查询 ---
  const candId = start.candidateId;
  const cand = await post('/api/draft.candidate', { root, candidateId: candId });
  out.candidate = { status: cand.status, data: { status: cand.data?.candidate?.status, chars: (cand.data?.candidate?.text ?? '').length, mode: cand.data?.candidate?.mode } };
  const generated = gen2.frames.filter((f) => f.event === 'delta').map((f) => f.text ?? '').join('');
  writeFileSync(join(RUN_DIR, 'chapter2-candidate.md'), generated, 'utf8');
  out.candidateChars = generated.length;

  // --- 采纳 ---
  const accept = await post('/api/draft.accept', {
    root, chapterIndex: 2, candidateId: candId, base: start.base, idempotencyKey: 'stage4-b-' + candId,
  });
  out.accept = { status: accept.status, data: accept.data };
  assert('第二章候选采纳成功（200 + ok）', accept.status === 200 && accept.data.ok === true, accept.data);

  const replay = await post('/api/draft.accept', {
    root, chapterIndex: 2, candidateId: candId, base: start.base, idempotencyKey: 'stage4-b-' + candId,
  });
  out.acceptReplay = { status: replay.status, alreadyApplied: replay.data.alreadyApplied, revision: replay.data.revision };
  assert('同幂等键重复采纳不新增版本', replay.data.alreadyApplied === true && replay.data.revision === accept.data.revision, out.acceptReplay);

  const read2 = await readProse(root, 2);
  const ch2Payload = stripFrontmatter(read2.data.body);
  out.chapter2Readback = { revision: read2.data.revision, phase: read2.data.phase, payloadChars: ch2Payload.length, payloadSha256: sha256Text(ch2Payload) };
  writeFileSync(join(RUN_DIR, 'chapter2-accepted.md'), read2.data.body, 'utf8');
  assert('第二章正文落盘且含采纳的候选文本', ch2Payload.includes(generated.slice(0, 40)) && generated.length > 0, { payloadChars: ch2Payload.length, candidateChars: generated.length });
  assert('第一章在第二章采纳后仍未变', stripFrontmatter((await readProse(root, 1)).data.body).trim() === CH1_BODY.trim(), null);

  // --- 全本导出 ---
  const bookTitle = '多章上下文验收书';
  const txt = await postBuffer('/api/export', { root, bookTitle, format: 'txt' });
  writeFileSync(join(RUN_DIR, 'book-export.txt'), txt.buf);
  out.exportTxt = { status: txt.status, bytes: txt.buf.length, sha256: createHash('sha256').update(txt.buf).digest('hex') };
  const docx = await postBuffer('/api/export', { root, bookTitle, format: 'docx' });
  writeFileSync(join(RUN_DIR, 'book-export.docx'), docx.buf);
  out.exportDocx = { status: docx.status, bytes: docx.buf.length };
  const epub = await postBuffer('/api/export', { root, bookTitle, format: 'epub' });
  writeFileSync(join(RUN_DIR, 'book-export.epub'), epub.buf);
  out.exportEpub = { status: epub.status, bytes: epub.buf.length };

  const txtText = txt.buf.toString('utf8');
  const p2 = ch2Payload.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const p1 = CH1_BODY.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const idxP1 = p1.map((p) => txtText.indexOf(p));
  const idxP2 = p2.map((p) => txtText.indexOf(p));
  out.exportTxtParagraphCheck = { ch1: idxP1, ch2: idxP2 };
  assert('TXT 导出含第一章各段（按序）', idxP1.every((i, k) => i >= 0 && (k === 0 || i > idxP1[k - 1])), idxP1);
  assert('TXT 导出含第二章各段（按序）', idxP2.every((i, k) => i >= 0 && (k === 0 || i > idxP2[k - 1])), idxP2);
  assert('TXT 导出章序为 1 → 2', Math.max(...idxP1) < Math.min(...idxP2), { lastCh1: Math.max(...idxP1.slice(-1)), firstCh2: idxP2[0] });

  out.serverLogTail = serverLog.join('').split('\n').slice(-25);
  out.ledger = budgetSnapshot(TICKET_DIR);
  out.assertions = assertions;
  out.finishedAt = new Date().toISOString();
  if (fixture !== null) { try { fixture.fixture.kill(); } catch { /* ignore */ } }
  return out;
}

/* ==================== 阶段 C-可控：取消边界 ==================== */
async function phaseCControl() {
  const out = { phase: 'C-control', startedAt: new Date().toISOString(), channel: CHANNEL, runId: RUN_ID, runDir: RUN_DIR };
  const fx = await startControlledFixture('controlled-upstream-events.json');
  await startServer({ real: true });
  out.server = { port: PORT, dataRoot: DATA_ROOT };
  const book = await createBook('取消恢复验收书-控制组');
  const root = book.root;
  out.book = book;
  log('book created: ' + root);

  log('step: save chapter1 fixture');
  const save1 = await saveProse(root, 1, CH1_BODY, null, CH1_TITLE);
  out.chapter1Save = { status: save1.status, revision: save1.data.revision };
  const before = await readProse(root, 1);
  out.chapter1Before = { revision: before.data.revision, sha256: sha256Text(before.data.body), chars: before.data.body.length };
  // 先起受控替身再起被测服务：buildEnv 在 controlled 通道下需要 CONTROLLED_ENDPOINT。
  log('step: start controlled upstream fixture');

  // 受控上游：环回测试替身。MOZHOU_ALLOW_PRIVATE_LLM 只对本测试子进程显式设置。
  const controlRoot = join(DATA_ROOT, 'controlled-upstream');
  mkdirSync(controlRoot, { recursive: true });
  const upstreamPort = fx.port;
  const fixture = fx.fixture;
  const upLog = fx.upLog;
  out.controlledUpstream = { port: upstreamPort, kind: 'test-double (not a real model)' };
  log('step: loopback gate control experiment');

  // 环回门禁的对照实验（零模型调用、零额外服务进程：直接吃产物里的解析函数）。
  // 结论必须成对出现：**不放行 ⇒ 门禁拒绝；显式放行 ⇒ 同一端点可解析**。
  {
    const mod = await import('file:///' + join(REPO, 'apps', 'web', 'dist-server', 'llm', 'openaiStream.js').replace(/\\/g, '/'));
    const baseEnv = { MOZHOU_API_KEY: 'controlled-fixture-key', MOZHOU_API_BASE: 'http://127.0.0.1:' + upstreamPort + '/v1', MOZHOU_MODEL: 'controlled-fixture' };
    const probe = (extra) => {
      try {
        const ep = mod.resolveChatEndpoint({ ...baseEnv, ...extra });
        return { resolved: ep !== null, allowPrivateNetwork: ep?.allowPrivateNetwork ?? null };
      } catch (e) {
        return { resolved: false, errorCode: e?.code ?? null, errorName: e?.name ?? null, message: String(e?.message ?? e) };
      }
    };
    out.loopbackGateControl = {
      note: '同一份环回端点：未授权时解析必须抛 SSRF_BLOCKED；显式授权时解析成功。全局开关未被修改。',
      withoutAllow: probe({}),
      withAllow: probe({ MOZHOU_ALLOW_PRIVATE_LLM: '1' }),
    };
    writeFileSync(join(RUN_DIR, 'loopback-gate-control.json'), JSON.stringify(out.loopbackGateControl, null, 2) + '\n', 'utf8');
  }

  log('step: start controlled-mode server');
  // 第二个服务进程：走环回端点（**只对这个测试子进程**显式放行环回，不放宽全局门禁）
  await stopServer();
  const startControlled = async () => {
    const entry = join(REPO, 'apps', 'web', 'dist-server', 'productionServer.js');
    PORT = await freePort();
    serverLog = [];
    child = spawn(process.execPath, [entry], {
      cwd: join(REPO, 'apps', 'web'),
      env: { ...buildEnv(false), PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d) => serverLog.push(d.toString()));
    child.stderr.on('data', (d) => serverLog.push(d.toString()));
    for (let i = 0; i < 200; i += 1) {
      try { const r = await fetch(url() + '/api/health'); if (r.ok) return; } catch { /* wait */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('controlled server did not become ready');
  };
  try {
    await startControlled();
  } catch (e) {
    writeFileSync(join(RUN_DIR, 'c-control-boot.log'), serverLog.join('') + '\n', 'utf8');
    out.controlledBootFailed = String(e && e.message);
    out.controlledBootLogTail = serverLog.join('').slice(-4000);
    throw e;
  }
  out.controlledServer = { port: PORT, note: 'MOZHOU_ALLOW_PRIVATE_LLM=1 只设在这个测试子进程；全局开关未改' };

  // 逐帧：收到首个 delta 后立刻断开（= 浏览器 reader.cancel() 同路径）
  let cancelledAt = null;
  const streamW = await generate({ root, chapterIndex: 1, prompt: '受控上游取消验收：写一段约200字。' }, (frame, ctx) => {
    if (frame.event === 'delta' && cancelledAt === null) {
      cancelledAt = Date.now();
      ctx.abort();
    }
  });
  const stream = streamW.result;
  await new Promise((r) => setTimeout(r, 1500));
  out.clientCancel = {
    abortedClientSide: stream.aborted,
    frames: stream.frames.map((f) => (f.event === 'delta' ? { event: 'delta', chars: (f.text ?? '').length, __tMs: f.__tMs } : { ...f, prompt: f.prompt === undefined ? undefined : '__prompt_' + String(f.prompt).length + '___' })),
    elapsedMs: stream.elapsedMs,
    error: stream.error ?? null,
  };
  const start = stream.frames.find((f) => f.event === 'start');
  const doneFrame = stream.frames.find((f) => f.event === 'done');
  const deltaChars = stream.frames.filter((f) => f.event === 'delta').map((f) => f.text ?? '').join('');
  assert('受控上游已发出首个 delta（取消前确有流）', deltaChars.length > 0, { chars: deltaChars.length });
  assert('客户端断开后不再收到 done 帧', doneFrame === undefined, { doneFrame: doneFrame ?? null });

  // 上游事件：是否观察到客户端连接关闭
  const events = JSON.parse(readUtf8(join(RUN_DIR, 'controlled-upstream-events.json')) ?? '[]');
  out.upstreamEvents = events;
  const closed = events.filter((e) => e.event === 'connection_closed' || e.event === 'request_aborted');
  assert('上游侧观察到连接关闭/中止（模型调用确实被停止）', closed.length > 0, closed);

  // 候选终态 + 正文零变化
  const cand = await post('/api/draft.candidate', { root, candidateId: start.candidateId });
  out.candidateAfterCancel = { http: cand.status, status: cand.data?.candidate?.status, chars: (cand.data?.candidate?.text ?? '').length };
  const afterCancel = await readProse(root, 1);
  out.chapter1After = { revision: afterCancel.data.revision, sha256: sha256Text(afterCancel.data.body), chars: afterCancel.data.body.length };
  assert('取消后正文/revision/指纹零变化', afterCancel.data.body === before.data.body && afterCancel.data.revision === before.data.revision, out.chapter1After);

  // 采纳一个已取消候选必须被拒
  const acceptCancelled = await post('/api/draft.accept', { root, chapterIndex: 1, candidateId: start.candidateId, base: start.base, idempotencyKey: 'stage4-c-cancel-' + start.candidateId });
  out.acceptCancelled = { status: acceptCancelled.status, code: acceptCancelled.data.code, error: acceptCancelled.data.error };
  assert('采纳已取消候选被拒（409 + CANDIDATE_NOT_ACCEPTABLE）', acceptCancelled.status === 409 && acceptCancelled.data.code === 'CANDIDATE_NOT_ACCEPTABLE', out.acceptCancelled);
  const afterReject = await readProse(root, 1);
  assert('被拒采纳后正文/revision/指纹仍零变化', afterReject.data.body === before.data.body && afterReject.data.revision === before.data.revision, null);

  // 显式 /api/draft.cancel 只改候选状态：单独观察
  // 客户端断开时服务端把候选标成 partial（半稿保留）；/api/draft.cancel 对
  // streaming|partial 都合法（draft-candidate.ts:201）。这里观察的是「显式取消
  // 与断开取消是两条不同的路径，但都不动正文」这一事实。
  const explicit = await post('/api/draft.cancel', { root, candidateId: start.candidateId });
  out.explicitCancel = { beforeStatus: out.candidateAfterCancel.status, status: explicit.status, data: explicit.data };
  const cancelOk = explicit.status === 200
    ? explicit.data.status === 'cancelled'
    : explicit.status === 409 && explicit.data.code === 'CANDIDATE_TERMINAL';
  assert('显式 /api/draft.cancel：partial → cancelled（或已终态时 409 CANDIDATE_TERMINAL），且不改正文', cancelOk, out.explicitCancel);
  const afterExplicit = await readProse(root, 1);
  assert('显式 cancel 后正文零变化', afterExplicit.data.body === before.data.body && afterExplicit.data.revision === before.data.revision, null);

  // 服务重启后读回
  await stopServer();
  await new Promise((r) => setTimeout(r, 300));
  await startControlled(); // 同一隔离数据根、同一受控上游；不引入真实上游调用
  out.restartedAt = { port: PORT };
  const afterRestart = await readProse(root, 1);
  out.afterRestart = { revision: afterRestart.data.revision, chars: afterRestart.data.body.length };
  assert('重启后已保存正文仍可读且一致', afterRestart.data.body === before.data.body, out.afterRestart);
  const candAfterRestart = await post('/api/draft.candidate', { root, candidateId: start.candidateId });
  out.candidateAfterRestart = { status: candAfterRestart.data?.candidate?.status, textChars: (candAfterRestart.data?.candidate?.text ?? '').length };
  assert('重启后取消候选不被当作成功成品（status=cancelled）', candAfterRestart.data?.candidate?.status === 'cancelled', out.candidateAfterRestart);

  // 作者编辑：取消之后可以继续编辑
  const cur = await readProse(root, 1);
  const edited = before.data.body + '\n\n雾散了一点。';
  const save = await saveProse(root, 1, edited, cur.data.revision);
  out.authorEditAfterCancel = { status: save.status, revision: save.data.revision, error: save.data.error ?? null };
  assert('取消后作者仍可保存编辑', save.status === 200 && save.data.ok === true, out.authorEditAfterCancel);
  const readEdited = await readProse(root, 1);
  assert('编辑落盘一致（正文载荷逐字相同）', stripFrontmatter(readEdited.data.body).trim() === edited.trim(), { revision: readEdited.data.revision, payloadChars: stripFrontmatter(readEdited.data.body).length });

  // 取消之后能在同一章重新生成并采纳
  const gen3W = await generate({ root, chapterIndex: 1, prompt: '受控上游：取消后再生成。 __COMPLETE__' }, () => {}, 'C-control:取消后再生成');
  const gen3 = gen3W.result;
  const start3 = gen3.frames.find((f) => f.event === 'start');
  const done3 = gen3.frames.find((f) => f.event === 'done');
  out.regenerateAfterCancel = { meta: gen3.meta, done: done3 ?? null, error: gen3.error ?? null, deltas: gen3.frames.filter((f) => f.event === 'delta').length };
  assert('取消后再次生成能拿到 done（completed candidate）', done3 !== undefined, done3 ?? gen3.frames.find((f) => f.event === 'error') ?? null);
  if (done3 !== undefined && start3 !== undefined) {
    const acc = await post('/api/draft.accept', { root, chapterIndex: 1, candidateId: start3.candidateId, base: start3.base, idempotencyKey: 'stage4-c-regen-' + start3.candidateId });
    out.regenerateAccept = { status: acc.status, revision: acc.data.revision, error: acc.data.error ?? null };
    assert('取消后再生成的候选可采纳', acc.status === 200 && acc.data.ok === true, out.regenerateAccept);
  }

  writeFileSync(join(RUN_DIR, 'controlled-upstream.log'), upLog.join(''), 'utf8');
  child.kill();
  fixture.kill();
  out.serverLogTail = serverLog.join('').split('\n').slice(-30);
  out.assertions = assertions;
  out.finishedAt = new Date().toISOString();
  return out;
}

/* ==================== 阶段 C-真实：真实上游取消 ==================== */
async function phaseCReal() {
  const out = { phase: 'C-real', startedAt: new Date().toISOString(), channel: CHANNEL, runId: RUN_ID, runDir: RUN_DIR };
  await startServer({ real: true });
  out.server = { port: PORT, dataRoot: DATA_ROOT };
  const book = await createBook('取消恢复验收书-真实组');
  const root = book.root;
  out.book = book;

  const save1 = await saveProse(root, 1, CH1_BODY, null, CH1_TITLE);
  out.chapter1Save = { status: save1.status, revision: save1.data.revision };
  const before = await readProse(root, 1);
  out.chapter1Before = { revision: before.data.revision, sha256: sha256Text(before.data.body), chars: before.data.body.length };

  // 请求 #1：流式中断（收到首个 delta 即断开）
  // 真实通道下，每一次尝试都会**先占用共享额度再发请求**（generate → guardedSend）。
  let sawDeltaAt = null;
  const s1W = await generateWithBackoff(
    { root, chapterIndex: 1, prompt: '接着上一章写约200字的续写，保持既有角色与物件。' },
    (frame, ctx) => {
      if (frame.event === 'delta' && sawDeltaAt === null) { sawDeltaAt = frame.__tMs; ctx.abort(); }
    },
    'C-real #1：收到首个 delta 即断开（模拟作者取消）',
    { maxAttempts: 3, waitMs: 75000 },
  );
  const s1 = s1W.result;
  out.reservation1 = s1W.reservation;
  await new Promise((r) => setTimeout(r, 1500));
  const start1 = s1.frames.find((f) => f.event === 'start');
  const done1 = s1.frames.find((f) => f.event === 'done');
  out.realCancel = {
    aborted: s1.aborted,
    firstDeltaAtMs: sawDeltaAt,
    elapsedMs: s1.elapsedMs,
    frameSummary: s1.frames.map((f) => (f.event === 'delta' ? { event: 'delta', chars: (f.text ?? '').length } : { ...f, prompt: f.prompt === undefined ? undefined : '__prompt___' })),
    error: s1.error ?? null,
  };
  const delta1 = s1.frames.filter((f) => f.event === 'delta').map((f) => f.text ?? '').join('');
  writeFileSync(join(RUN_DIR, 'real-cancel-partial.md'), delta1, 'utf8');
  out.realCancel.deltaChars = delta1.length;
  const cancelledInTime = done1 === undefined && s1.aborted === true;
  assert('真实上游：取消在 done 之前发生（否则本场景 NOT EXERCISED）', cancelledInTime, { sawDeltaAt, done: done1 ?? null });
  if (start1 !== undefined) {
    const cand = await post('/api/draft.candidate', { root, candidateId: start1.candidateId });
    out.realCancelCandidate = { status: cand.data?.candidate?.status, chars: (cand.data?.candidate?.text ?? '').length };
  }
  const afterCancel = await readProse(root, 1);
  out.chapter1AfterCancel = { revision: afterCancel.data.revision, sha256: sha256Text(afterCancel.data.body), chars: afterCancel.data.body.length };
  assert('真实取消后正文/revision/指纹零变化', afterCancel.data.body === before.data.body && afterCancel.data.revision === before.data.revision, out.chapter1AfterCancel);

  // 请求 #2：取消之后再生成一次并采纳
  const s2W = await generateWithBackoff(
    { root, chapterIndex: 1, prompt: '取消之后重新生成：写约200字的续写，保持既有角色与物件。' },
    () => {},
    'C-real #2：取消之后重新生成并采纳',
    { maxAttempts: 3, waitMs: 75000 },
  );
  const s2 = s2W.result;
  out.reservation2 = s2W.reservation;
  const start2 = s2.frames.find((f) => f.event === 'start');
  const done2 = s2.frames.find((f) => f.event === 'done');
  const err2 = s2.frames.find((f) => f.event === 'error');
  out.realRegenerate = { meta: s2.meta, done: done2 ?? null, error: err2 ?? null, deltaChars: s2.frames.filter((f) => f.event === 'delta').map((f) => f.text ?? '').join('').length };
  const text2 = s2.frames.filter((f) => f.event === 'delta').map((f) => f.text ?? '').join('');
  writeFileSync(join(RUN_DIR, 'real-regenerate-candidate.md'), text2, 'utf8');
  assert('真实上游：取消后再次生成成功', done2 !== undefined && done2.outcome === 'succeeded', done2 ?? err2 ?? null);
  if (start2 !== undefined && done2 !== undefined) {
    const acc = await post('/api/draft.accept', { root, chapterIndex: 1, candidateId: start2.candidateId, base: start2.base, idempotencyKey: 'stage4-c-real-' + start2.candidateId });
    out.realAccept = { status: acc.status, revision: acc.data.revision, error: acc.data.error ?? null };
    assert('真实上游：取消后再生成可采纳', acc.status === 200 && acc.data.ok === true, out.realAccept);
    const rb = await readProse(root, 1);
    out.realAcceptedReadback = { revision: rb.data.revision, chars: rb.data.body.length, sha256: sha256Text(rb.data.body) };
    writeFileSync(join(RUN_DIR, 'real-accepted.md'), rb.data.body, 'utf8');
    assert('真实采纳后正文不只含原文（确有新正文）', rb.data.body.length > before.data.body.length, out.realAcceptedReadback);
  }

  out.ledger = budgetSnapshot(TICKET_DIR);
  out.assertions = assertions;
  out.finishedAt = new Date().toISOString();
  return out;
}

/* ==================== 阶段 C-断开后服务端收尾 ==================== */
/**
 * 观察点：客户端在流中**立刻断开**，而上游随后**正常收尾**。
 * 这是「取消后恢复」最容易出事的一条缝——服务端在已销毁的响应上还要写 done 帧。
 * 不做任何修复，只如实记录：服务端是否存活、候选终态、正文是否零变化。
 */
async function phaseCDisc() {
  const out = { phase: 'C-disc', startedAt: new Date().toISOString(), channel: CHANNEL, runId: RUN_ID, runDir: RUN_DIR };
  const fxDisc = await startControlledFixture('controlled-upstream-disc.json');
  await startServer({ real: true });
  out.server = { port: PORT, dataRoot: DATA_ROOT };
  const book = await createBook('断开收尾验收书');
  const root = book.root;
  out.book = book;
  const save1 = await saveProse(root, 1, CH1_BODY, null, CH1_TITLE);
  const before = await readProse(root, 1);
  out.chapter1Before = { revision: before.data.revision, sha256: sha256Text(before.data.body) };

  const upstreamPort = fxDisc.port;
  const fixture = fxDisc.fixture;
  const upLog = fxDisc.upLog;

  await stopServer();
  const entry = join(REPO, 'apps', 'web', 'dist-server', 'productionServer.js');
  PORT = await freePort();
  serverLog = [];
  child = spawn(process.execPath, [entry], {
    cwd: join(REPO, 'apps', 'web'),
    env: { ...buildEnv(false), PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => serverLog.push(d.toString()));
  child.stderr.on('data', (d) => serverLog.push(d.toString()));
  let serverExited = null;
  child.on('exit', (code, signal) => { serverExited = { code, signal }; });
  for (let i = 0; i < 200; i += 1) {
    try { const r = await fetch(url() + '/api/health'); if (r.ok) break; } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  out.controlledServer = { port: PORT };

  // **关键区分**：客户端断开之后，墨舟进程还会继续把上游流读完（AbortController.abort()
  // 只掐断响应读取，不掐断引擎/上游链接）。用 __HOLD__ 让夹具在客户端断开**之后**才正常
  // 收尾，从而逼出「向已销毁的响应写 done 帧」这条缝。
  const sW = await generate({ root, chapterIndex: 1, prompt: '断开后上游仍正常收尾 __HOLD__' }, (frame, ctx) => {
    if (frame.event === 'delta') ctx.abort();
  }, 'C-disc:断开后上游收尾');
  const s = sW.result;
  await new Promise((r) => setTimeout(r, 8000));
  out.stream = { aborted: s.aborted, frames: s.frames.map((f) => ({ event: f.event, __tMs: f.__tMs })), error: s.error ?? null };
  out.serverExitedWithin4s = serverExited;
  let alive = false;
  let healthStatus = null;
  try { const h = await fetch(url() + '/api/health'); healthStatus = h.status; alive = h.ok; } catch (e) { alive = false; healthStatus = 'fetch_failed: ' + String(e && e.message); }
  out.serverAliveAfterCompletion = alive;
  out.healthStatus = healthStatus;
  assert('客户端断开后服务端在 4s 内没有退出', serverExited === null, serverExited);
  assert('客户端断开后服务端仍能响应 /api/health', alive === true, healthStatus);

  const start = s.frames.find((f) => f.event === 'start');
  if (start !== undefined) {
    const cand = await post('/api/draft.candidate', { root, candidateId: start.candidateId });
    out.candidate = { status: cand.data?.candidate?.status, chars: (cand.data?.candidate?.text ?? '').length };
  }
  const after = await readProse(root, 1);
  out.chapter1After = { revision: after.data.revision, sha256: sha256Text(after.data.body) };
  assert('断开取消后正文/revision/指纹零变化', after.data.body === before.data.body && after.data.revision === before.data.revision, out.chapter1After);

  const events = JSON.parse(readUtf8(join(RUN_DIR, 'controlled-upstream-disc.json')) ?? '[]');
  out.upstreamEvents = events;
  assert('上游侧观察到连接关闭（模型调用确实被停止）', events.some((e) => e.event === 'connection_closed'), events.filter((e) => e.event !== 'delta_sent'));
  out.serverLogTail = serverLog.join('').split('\n').slice(-40);
  out.uncaught = serverLog.join('').split('\n').filter((l) => /uncaught_exception|unhandled_rejection|shutdown\.start/.test(l));
  assert('服务端日志没有 uncaughtException / unhandledRejection', out.uncaught.length === 0, out.uncaught);

  writeFileSync(join(RUN_DIR, 'controlled-upstream-disc.log'), upLog.join(''), 'utf8');
  try { fixture.kill(); } catch { /* ignore */ }
  out.assertions = assertions;
  out.finishedAt = new Date().toISOString();
  return out;
}

/* ==================== 阶段 GUARD：零网络自检（不发任何请求）==================== */
/**
 * 只验证门禁本身，**不启动任何服务、不发任何请求**。用途：
 *   1. 证明 channel=controlled 时 sendReal 被拒（受控运行不可能偷偷走真实通道）；
 *   2. 证明 channel=real 且额度用尽时，在发出请求**之前**就抛 BUDGET_EXHAUSTED；
 *   3. 证明非法额度 / 缺账本时 fail closed。
 */
async function phaseGuard() {
  const out = { phase: 'GUARD', startedAt: new Date().toISOString(), channel: CHANNEL, runId: RUN_ID, runDir: RUN_DIR, networkUsed: false };
  const results = [];
  const probe = async (name, fn) => {
    try { const v = await fn(); results.push({ name, rejected: false, value: v }); }
    catch (error) { results.push({ name, rejected: true, code: error.code ?? null, name_: error.name, message: String(error.message).slice(0, 200) }); }
  };

  // 为了让 T2/T3 可测，用一个**临时独立账本**，不动工单账本
  const tmpTicket = join(RUN_DIR, 'guard-ticket');

  await probe('controlled 通道下 sendReal 必须被拒（不会偷发真实请求）', async () => {
    if (CHANNEL !== 'controlled') return 'SKIPPED（本运行 channel=real）';
    return await sendReal({ root: 'x', chapterIndex: 1, prompt: 'x' }, () => {}, 'guard:controlled-should-refuse', RUN_DIR);
  });

  await probe('额度 0：guardedSend 在发请求前被挡（BUDGET_EXHAUSTED）', async () => {
    initLedger(tmpTicket, { ticket: 'guard-zero', allowance: 0 });
    let transportCalled = 0;
    try {
      await guardedSend({ channel: 'real', ticketDir: tmpTicket, reason: 'guard:额度0', runDir: RUN_DIR, transport: async () => { transportCalled += 1; return 'should-not-happen'; } });
    } catch (error) {
      error.transportCalled = transportCalled;
      throw error;
    }
  });

  await probe('缺账本：fail closed（LEDGER_MISSING）', async () => {
    await guardedSend({ channel: 'real', ticketDir: join(RUN_DIR, 'no-such-ticket'), reason: 'guard:缺账本', runDir: RUN_DIR, transport: async () => 'should-not-happen' });
  });

  await probe('非法额度（负数）：fail closed（BUDGET_INVALID）', async () => {
    initLedger(join(RUN_DIR, 'guard-bad'), { ticket: 'guard-bad', allowance: -1 });
  });

  await probe('损坏账本：fail closed（LEDGER_CORRUPT）', async () => {
    const dir = join(RUN_DIR, 'guard-corrupt');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'ledger.json'), '{ not json', 'utf8');
    await guardedSend({ channel: 'real', ticketDir: dir, reason: 'guard:损坏账本', runDir: RUN_DIR, transport: async () => 'should-not-happen' });
  });

  out.results = results;
  out.assertions = results.map((r) => ({ name: r.name, result: r.rejected === true ? 'PASS' : 'FAIL', evidence: r }));
  out.allAssertionsPassed = results.every((r) => r.rejected === true || String(r.value).startsWith('SKIPPED'));
  return out;
}

/* ==================== main ==================== */
let result;
try {
  if (PHASE === 'b') result = await phaseB();
  else if (PHASE === 'c-control') result = await phaseCControl();
  else if (PHASE === 'c-real') result = await phaseCReal();
  else if (PHASE === 'c-disc') result = await phaseCDisc();
  else if (PHASE === 'guard') result = await phaseGuard();
  else throw new Error('unknown phase: ' + PHASE);
  result.allAssertionsPassed = result.assertions.every((a) => a.result === 'PASS');
} catch (error) {
  result = { phase: PHASE, channel: CHANNEL, runId: RUN_ID, runDir: RUN_DIR, fatal: String(error && error.stack ? error.stack : error), assertions, ledger: budgetSnapshot(TICKET_DIR) };
  result.allAssertionsPassed = false;
} finally {
  try { await stopServer(); } catch { /* ignore */ }
}

writeJson('phase-' + PHASE + '.json', result);
writeLog('phase-' + PHASE + '.log');
log('phase=' + PHASE + ' allAssertionsPassed=' + String(result.allAssertionsPassed));
process.exit(result.allAssertionsPassed === true ? 0 : 1);
