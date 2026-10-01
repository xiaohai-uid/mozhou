/**
 * harness/tests/audit-red.test.mjs —— 第四轮返修新增的**红例**（Codex 复核 P1×2 + P2）。
 *
 * 与 offline-budget.test.mjs 的 52 项**并存，互不覆盖**：那 52 项验的是常规路径，
 * 这三项验的是 Codex 指出「不在其覆盖范围内」的破坏性边界。
 *
 * 用法（同一个文件可跑在修前/修后两套实现上）：
 *   node harness/tests/audit-red.test.mjs                                  # 跑当前实现
 *   set MOZHOU_LEDGER_IMPL=C:\...\.baseline-round5\harness                 # 跑修前实现（应当变红）
 *
 * 全程**零网络**：transport 一律是假函数，只可能写账本。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const STAGE = resolve(HERE, '..', '..');
const IMPL = process.env.MOZHOU_LEDGER_IMPL ? resolve(process.env.MOZHOU_LEDGER_IMPL) : join(STAGE, 'harness');
const WORK = join(STAGE, '.redwork');
const CHILD = join(HERE, 'lock-holder.mjs');
const INIT_CHILD = join(HERE, 'init-child.mjs');

console.log('被测实现：' + IMPL);
process.env.MOZHOU_TICKET_REGISTRY = join(WORK, 'registry.json');
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

const acct = await import(pathToFileURL(join(IMPL, 'accounting.mjs')).href);
const { guardedSend } = await import(pathToFileURL(join(IMPL, 'transport.mjs')).href);
const { initLedger, spendRealCall, budgetSnapshot, ledgerPath, readLedger, spentCount } = acct;

let passed = 0;
let failed = 0;
const results = [];
function check(name, ok, evidence) {
  const row = { name, result: ok ? 'PASS' : 'FAIL', evidence: evidence === undefined ? null : evidence };
  results.push(row);
  if (ok) passed += 1; else failed += 1;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (evidence === undefined ? '' : ' :: ' + JSON.stringify(evidence).slice(0, 300)));
}
function fresh(name) {
  const dir = join(WORK, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}
function has(name) { return typeof acct[name] === 'function'; }

function runChild(script, args) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => {
      let parsed = null;
      const last = out.trim().split(/\r?\n/).filter(Boolean).pop();
      if (last !== undefined) { try { parsed = JSON.parse(last); } catch { parsed = null; } }
      resolvePromise({ code, out, err, json: parsed });
    });
  });
}
async function waitFile(p, ms = 8000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (existsSync(p)) return true; await new Promise((r) => setTimeout(r, 25)); }
  return false;
}
function ledgerConsistent(dir) {
  const raw = readFileSync(ledgerPath(dir), 'utf8');
  const led = JSON.parse(raw);
  const tmp = readdirSync(dir).filter((f) => f.includes('.tmp-'));
  return {
    parsed: true,
    used: spentCount(led),
    spendRows: led.spend.length,
    seqs: led.spend.map((r) => r.seq),
    tmpLeft: tmp,
  };
}

// ================================================================== 
console.log('== T15 活锁：时钟前跳 31 秒后仍不得夺锁 ==');
{
  const dir = fresh('t15');
  initLedger(dir, { ticket: 'T15', allowance: 1, note: 'stale lock repro' });
  const ready = join(dir, 'A.ready');
  const holder = spawn(process.execPath, [
    CHILD, '--implDir', IMPL, '--ticketDir', dir, '--label', 'A', '--holdMs', '2500', '--ready', ready,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let holderOut = '';
  holder.stdout.on('data', (d) => { holderOut += d.toString(); });
  const gotReady = await waitFile(ready);
  check('持锁者子进程已持锁（ready 标记出现）', gotReady === true, { ready: gotReady });

  // 模拟 Codex 的时钟前跳：把锁目录 mtime 拨回 31 秒前。
  const lock = join(dir, '.ledger.lock');
  const back = new Date(Date.now() - 31000);
  try { utimesSync(lock, back, back); } catch (error) { /* 忽略 */ }
  const staleMs = 31000;

  let parentTransportRan = false;
  let parentError = null;
  const t0 = Date.now();
  try {
    await guardedSend({
      channel: 'real', ticketDir: dir, reason: 'T15 parent send',
      transport: async () => { parentTransportRan = true; return { fake: true }; },
    });
  } catch (error) {
    parentError = { code: error && error.code ? error.code : null, name: error && error.name };
  }
  const elapsed = Date.now() - t0;
  check('父进程必须**等到活锁被释放**才可能进入临界区（elapsed >= 持锁时长的大部分），不得凭年龄夺锁',
    elapsed >= 1800, { elapsed, holdMs: 2500, parentError, parentTransportRan, staleMs });
  const holderDone = await new Promise((r) => {
    let buf = '';
    holder.stdout.on('data', (d) => { buf += d.toString(); });
    holder.on('close', () => {
      let j = null;
      try { j = JSON.parse(buf.trim().split(/\r?\n/).filter(Boolean).pop()); } catch { j = null; }
      r(j);
    });
  });
  const transports = (parentTransportRan ? 1 : 0) + (holderDone && holderDone.outcome === 'spent' ? 1 : 0);
  check('全过程最多只有一个 transport 实际执行', transports === 1, { transports, holder: holderDone });

  const cons = ledgerConsistent(dir);
  check('账本完整可解析、无 .tmp 残留、used=1',
    cons.parsed === true && cons.used === 1 && cons.spendRows === 1 && cons.tmpLeft.length === 0, cons);
  rmSync(dir, { recursive: true, force: true });
}

console.log('== T15a-allowance2 活锁期间最多只允许一次 transport ==');
{
  const dir = fresh('t15a2');
  initLedger(dir, { ticket: 'T15a2', allowance: 2, note: 'stale lock repro, 2 slots' });
  const ready = join(dir, 'A.ready');
  const holder = spawn(process.execPath, [
    CHILD, '--implDir', IMPL, '--ticketDir', dir, '--label', 'A', '--holdMs', '2500', '--ready', ready,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  await waitFile(ready);
  const lock = join(dir, '.ledger.lock');
  const back = new Date(Date.now() - 31000);
  try { utimesSync(lock, back, back); } catch (error) { /* 忽略 */ }
  let parentTransportRan = false;
  let parentError = null;
  const t0 = Date.now();
  try {
    await guardedSend({
      channel: 'real', ticketDir: dir, reason: 'T15a2 parent send',
      transport: async () => { parentTransportRan = true; return { fake: true }; },
    });
  } catch (error) {
    parentError = { code: error && error.code ? error.code : null };
  }
  const elapsed = Date.now() - t0;
  const holderDone = await new Promise((r) => {
    let buf = '';
    holder.stdout.on('data', (d) => { buf += d.toString(); });
    holder.on('close', () => {
      let j = null;
      try { j = JSON.parse(buf.trim().split(/\r?\n/).filter(Boolean).pop()); } catch { j = null; }
      r(j);
    });
  });
  check('父进程**等到了活锁释放**才进入临界区（elapsed >= 持锁时长的大部分），未夺锁',
    elapsed >= 1800, { elapsed, holdMs: 2500, parentError, parentTransportRan });
  const transports = (parentTransportRan ? 1 : 0) + (holderDone && holderDone.outcome === 'spent' ? 1 : 0);
  check('额度 2 下两个尝试串行完成，账本两条占用互不覆盖',
    transports === 2 && ledgerConsistent(dir).spendRows === 2, { transports, ...ledgerConsistent(dir) });
  rmSync(dir, { recursive: true, force: true });
}


console.log('== T15b 释放必须校验所有权（不得删掉后继者的锁）==');
{
  const dir = fresh('t15b');
  initLedger(dir, { ticket: 'T15b', allowance: 2, note: 'ownership' });
  const lock = join(dir, '.ledger.lock');
  // A 持锁
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({ token: 'A-token', pid: 1, host: 'x' }), 'utf8');
  // 锁被显式回收并转交给 B
  rmSync(lock, { recursive: true, force: true });
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({ token: 'B-token', pid: 2, host: 'x' }), 'utf8');
  // A 迟到释放
  let releaseRejected = false;
  let code = null;
  if (has('releaseLock')) {
    try { acct.releaseLock(dir, 'A-token'); }
    catch (error) { releaseRejected = true; code = error && error.code; }
    check('迟到释放因 token 不匹配被拒（LOCK_NOT_OWNER）', releaseRejected === true && code === 'LOCK_NOT_OWNER', { code });
  } else {
    check('迟到释放因 token 不匹配被拒（LOCK_NOT_OWNER）', false, { why: '当前实现没有 releaseLock，无法校验所有权' });
  }
  check('B 的锁没有被 A 的迟到释放删掉', existsSync(lock), { lockExists: existsSync(lock) });
  rmSync(dir, { recursive: true, force: true });
}

console.log('== T16 initLedger 不得重置已有消耗 ==');
{
  const dir = fresh('t16a');
  initLedger(dir, { ticket: 'T16a', allowance: 1, note: 'reset probe' });
  spendRealCall(dir, { reason: 'T16a first' });
  const before = budgetSnapshot(dir).used;
  let initErr = null;
  try { initLedger(dir, { ticket: 'T16a', allowance: 1, note: 're-init same' }); }
  catch (error) { initErr = error && error.code; }
  const after = budgetSnapshot(dir).used;
  check('同参数重复初始化后消耗保持不变（不重置）', before === 1 && after === 1, { before, after, initErr });
  let secondSpend = 'spent';
  try { spendRealCall(dir, { reason: 'T16a second' }); }
  catch (error) { secondSpend = error && error.code; }
  check('重置会导致第二次占用成功 —— 修复后必须被额度挡住', secondSpend === 'BUDGET_EXHAUSTED', { secondSpend, used: budgetSnapshot(dir).used });
  rmSync(dir, { recursive: true, force: true });
}
{
  const dir = fresh('t16b');
  initLedger(dir, { ticket: 'T16b', allowance: 1, note: 'conflict' });
  spendRealCall(dir, { reason: 'T16b first' });
  let code = null;
  try { initLedger(dir, { ticket: 'T16b', allowance: 5, note: 'raise by init' }); }
  catch (error) { code = error && error.code; }
  const snap = budgetSnapshot(dir);
  check('用 init 改额度被拒（配置冲突），账本不变',
    code === 'ALLOWANCE_CONFLICT' && snap.allowance === 1 && snap.used === 1, { code, allowance: snap.allowance, used: snap.used });
  rmSync(dir, { recursive: true, force: true });
}
{
  const dir = fresh('t16c');
  initLedger(dir, { ticket: 'T16c', allowance: 1, note: 'ticket conflict' });
  let code = null;
  try { initLedger(dir, { ticket: 'OTHER', allowance: 1, note: 'hijack' }); }
  catch (error) { code = error && error.code; }
  check('换 ticket 名重新初始化被拒（TICKET_CONFLICT）', code === 'TICKET_CONFLICT', { code });
  rmSync(dir, { recursive: true, force: true });
}

console.log('== T16b 并发首次创建 + 初始化/占用交错 ==');
{
  const dir = fresh('t16d');
  const kids = [];
  for (let i = 0; i < 6; i += 1) {
    kids.push(runChild(INIT_CHILD, ['--implDir', IMPL, '--ticketDir', dir, '--mode', 'init', '--ticket', 'T16d', '--allowance', '2', '--label', 'init' + i]));
  }
  const resultsInit = await Promise.all(kids);
  const allOk = resultsInit.every((r) => r.code === 0);
  check('6 个子进程并发首次创建全部正常退出', allOk, resultsInit.map((r) => ({ code: r.code, outcome: r.json && r.json.outcome, error: r.json && r.json.errorCode })));
  const led = readLedger(dir);
  check('并发创建后账本合法且额度没有被叠加/清零',
    led.realCallAllowance === 2 && spentCount(led) === 0, { allowance: led.realCallAllowance, used: spentCount(led) });
  rmSync(dir, { recursive: true, force: true });
}
{
  const dir = fresh('t16e');
  initLedger(dir, { ticket: 'T16e', allowance: 6, note: 'interleave' });
  const kids = [];
  for (let i = 0; i < 4; i += 1) {
    kids.push(runChild(INIT_CHILD, ['--implDir', IMPL, '--ticketDir', dir, '--mode', 'init', '--ticket', 'T16e', '--allowance', '6', '--label', 're' + i]));
  }
  for (let i = 0; i < 3; i += 1) {
    kids.push(runChild(INIT_CHILD, ['--implDir', IMPL, '--ticketDir', dir, '--mode', 'spend', '--label', 'sp' + i]));
  }
  await Promise.all(kids);
  const cons = ledgerConsistent(dir);
  check('初始化/占用交错后，占用记录一条都没丢（used=3）',
    cons.used === 3 && cons.spendRows === 3 && cons.tmpLeft.length === 0, cons);
  rmSync(dir, { recursive: true, force: true });
}

console.log('== T16c 不得靠更换账本位置重获额度 ==');
{
  const dirA = fresh('t16f-a');
  const dirB = fresh('t16f-b');
  initLedger(dirA, { ticket: 'T16f', allowance: 1, note: 'origin' });
  spendRealCall(dirA, { reason: 'T16f spent at A' });
  let code = null;
  try { initLedger(dirB, { ticket: 'T16f', allowance: 1, note: 'moved' }); }
  catch (error) { code = error && error.code; }
  let bSpend = 'not_attempted';
  try { const l2 = readLedger(dirB); if (l2 !== null) spendRealCall(dirB, { reason: 'T16f at B' }); }
  catch (error) { bSpend = error && error.code; }
  check('同一工单换目录重开被拒（TICKET_RELOCATED）', code === 'TICKET_RELOCATED', { code });
  check('换目录后没有凭空多出可用额度', bSpend === 'not_attempted', { bSpend });
  rmSync(dirA, { recursive: true, force: true });
  rmSync(dirB, { recursive: true, force: true });
}

console.log('== T17 每次尝试唯一 attemptId，账目按尝试而非按文件计数 ==');
{
  const dir = fresh('t17');
  initLedger(dir, { ticket: 'T17', allowance: 5, note: 'attempts' });

  // (a) 首帧前传输异常：不得漏计
  let thrown = null;
  try {
    await guardedSend({
      channel: 'real', ticketDir: dir, reason: 'T17 boom-before-first-frame',
      transport: async () => { throw new Error('connect ECONNREFUSED before any frame'); },
    });
  } catch (error) { thrown = error.message; }
  const snapAfterBoom = budgetSnapshot(dir);
  check('首帧前传输异常也占用一次额度（不漏计、不退款）',
    snapAfterBoom.used === 1, { used: snapAfterBoom.used, thrown });

  // (b) 取消：同样占额度
  await guardedSend({
    channel: 'real', ticketDir: dir, reason: 'T17 cancel',
    transport: async () => { const e = new Error('client cancelled'); e.name = 'AbortError'; throw e; },
  }).catch(() => null);
  const snapAfterCancel = budgetSnapshot(dir);
  check('取消也占额度且不退款', snapAfterCancel.used === 2, { used: snapAfterCancel.used });

  // (c) attempts.jsonl 与账本一一对账
  const hasAttemptsFile = has('readAttemptEvents');
  let reconciled = false;
  let detail = null;
  if (hasAttemptsFile) {
    const ev = acct.readAttemptEvents(dir);
    const started = ev.filter((e) => e.event === 'started' && e.reservationId !== null);
    const terminal = new Set(ev.filter((e) => e.event === 'terminal').map((e) => e.attemptId));
    const rows = snapAfterCancel.spend;
    const matched = rows.every((r) => ev.some((e) => e.event === 'started' && e.attemptId === r.attemptId));
    const distinct = new Set(rows.map((r) => r.attemptId)).size === rows.length;
    reconciled = matched && distinct && terminal.size === 2;
    detail = { spendRows: rows.length, distinctAttemptIds: new Set(rows.map((r) => r.attemptId)).size, terminalEvents: terminal.size, matched };
  }
  check('每条 spend 都有唯一 attemptId 与配对的 started/terminal 事件（对账一致）',
    hasAttemptsFile ? reconciled : false, hasAttemptsFile ? detail : { why: '当前实现没有 attempt 事件流，账目无法对账' });

  // (d) 进程中途被杀：只有 started 没有 terminal → 必须标 UNKNOWN，且仍计一次
  // 用「占用后进程即死」造出真实的孤儿尝试：spendRealCall 内部会写 started，但不会有 terminal。
  if (hasAttemptsFile) {
    spendRealCall(dir, { reason: 'T17 killed-after-reserve' });
  }
  let unknownMarked = false;
  let unknownDetail = null;
  if (hasAttemptsFile) {
    const ev = acct.readAttemptEvents(dir);
    const orphan = ev.filter((e) => e.event === 'started' && e.reservationId !== null)
      .filter((e) => !ev.some((t) => t.event === 'terminal' && t.attemptId === e.attemptId));
    unknownMarked = orphan.length >= 1;
    unknownDetail = { orphanAttempts: orphan.map((o) => o.attemptId) };
  }
  check('有 started 无 terminal 的尝试被识别为结果未知（UNKNOWN），不静默丢弃',
    hasAttemptsFile ? unknownMarked : false, hasAttemptsFile ? unknownDetail : { why: '无 attempt 事件流' });
  rmSync(dir, { recursive: true, force: true });
}

console.log('== T17e 报告层：按 attemptId 计数，重复帧不多计，孤儿尝试标 UNKNOWN ==');
{
  const makerPath = join(IMPL, 'make-ledger.mjs');
  const hasMaker = existsSync(makerPath);
  if (!hasMaker) {
    check('账目生成器提供 buildLedgerReport（供测试与对账使用）', false, { why: '当前实现没有可导入的账目生成器，报告层无法按 attemptId 计数' });
  } else {
    const dir = fresh('t17e');
    initLedger(dir, { ticket: 'T17e', allowance: 4, note: 'report layer' });
    const ok = await guardedSend({
      channel: 'real', ticketDir: dir, reason: 'T17e ok',
      transport: async () => ({ frames: ['a', 'b'] }),
    });
    let boomId = null;
    try {
      await guardedSend({
        channel: 'real', ticketDir: dir, reason: 'T17e boom',
        transport: async () => { throw new Error('boom before first frame'); },
      });
    } catch (error) { boomId = error.attemptId ?? null; }
    // 首帧前异常那次没有任何帧文件；再手工造一个「占用后即死」的孤儿
    const orphan = spendRealCall(dir, { reason: 'T17e killed after reserve' });

    // 造一个运行目录：第一次尝试的帧 + 一份**内容完全相同**的副本
    const runDir = join(WORK, 'runs', 'synth');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'run-meta.json'), JSON.stringify({ runId: 'synth', phase: 'synth', channel: 'real' }), 'utf8');
    const frames = [
      JSON.stringify({ event: 'start', candidateId: 'cand-synth', provider: 'real-openai-compatible' }),
      JSON.stringify({ event: 'delta', text: 'ab' }),
      JSON.stringify({ event: 'done', outcome: 'succeeded', chars: 2 }),
    ].join(String.fromCharCode(10)) + String.fromCharCode(10);
    writeFileSync(join(runDir, 'frames-' + ok.attemptId + '.ndjson'), frames, 'utf8');
    writeFileSync(join(runDir, 'context-dump-' + ok.attemptId + '.ndjson'), frames, 'utf8');

    const { buildLedgerReport } = await import(pathToFileURL(makerPath).href);
    const rep = buildLedgerReport({ ticketDir: dir, runsDir: join(WORK, 'runs'), legacy: [] });
    check('同一请求的两份同内容帧文件只计一次（不按文件计数）',
      rep.counts.attemptsFromThisInstrumentation === 3
      && rep.reconciliation.duplicateFrameFiles === 1,
      { attempts: rep.counts.attemptsFromThisInstrumentation, dup: rep.reconciliation.duplicateFrameFiles, ids: rep.attempts.map((a) => a.attemptId) });
    const errored = rep.attempts.filter((a) => a.terminal === 'transport_error' && a.frames.length === 0);
    check('首帧前异常的那次尝试仍被计入（有 terminal 事件、零帧文件）',
      errored.length === 1, { errored: errored.map((a) => ({ id: a.attemptId, frames: a.frames.length })) });
    check('占用后即死的尝试标为 UNKNOWN 而不是被丢弃',
      rep.reconciliation.unknownResults.includes(orphan.attemptId),
      { unknown: rep.reconciliation.unknownResults, orphan: orphan.attemptId });
    check('账本行与 started 事件一一对账（无孤儿 started / 无无主占用）',
      rep.reconciliation.spendWithoutStarted.length === 0 && rep.reconciliation.startedWithoutSpend.length === 0,
      rep.reconciliation);
  }
}

const summary = {
  passed, failed, total: results.length,
  ranAt: new Date().toISOString(),
  implUnderTest: IMPL,
  networkUsed: false,
  realModelCalls: 0,
  results,
};
writeFileSync(join(WORK, '..', 'artifacts-audit-red.json'), JSON.stringify(summary, null, 2) + String.fromCharCode(10), 'utf8');
console.log(String.fromCharCode(10) + '== 汇总 == passed=' + passed + ' failed=' + failed + ' total=' + results.length);
process.exit(failed === 0 ? 0 : 1);