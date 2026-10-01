/**
 * harness/tests/offline-budget.test.mjs
 *
 * **离线**验证「整张工单共享额度」的每一条拒绝路径。零真实网络、零真实模型。
 * 覆盖 Codex 第四轮点名的六种绕过场景 + 额度/账本/锁的非法输入：
 *   T1 传输异常（先发后记账的旧缺陷）
 *   T2 429 限流
 *   T3 客户端取消
 *   T4 进程重启（额度不重置）
 *   T5 两个并发进程（不超发）
 *   T6 多入口不能绕过（只有 guardedSend 能发；其余入口必须抛）
 *   T7 非法预算 ⇒ 关闭真实通道
 *   T8 账本损坏 ⇒ 关闭真实通道
 *   T9 锁被占用超时 ⇒ 关闭真实通道
 *   T10 受控通道不占额度
 *   T11 多个子进程同时抢额度（跨进程原子性）
 *   T12 runner 里不存在绕过 guardedSend 的真实请求调用点（源码级扫描）
 */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  BudgetExhaustedError, BudgetUnavailableError, budgetSnapshot, initLedger, ledgerPath, spendRealCall, validateLedger,
} from '../accounting.mjs';
import { ChannelRefusedError, guardedSend } from '../transport.mjs';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const HARNESS = resolve(HERE, '..');
const STAGE = resolve(HARNESS, '..');

// 防自递归：子进程脚本若被误写成「再跑一遍本测试」，会指数级 fork。
// 实测踩过这个坑（child-spend.mjs 被写成了测试文件本体），这里加硬闸。
if (process.env.MOZHOU_BUDGET_CHILD === '1') {
  console.error('拒绝：离线测试套件不得在子进程里重入（MOZHOU_BUDGET_CHILD=1）');
  process.exit(97);
}

let passed = 0;
let failed = 0;
const results = [];
function check(name, ok, evidence) {
  results.push({ name, ok, evidence: evidence === undefined ? null : evidence });
  if (ok) { passed += 1; console.log('  PASS  ' + name); }
  else { failed += 1; console.log('  FAIL  ' + name + ' :: ' + JSON.stringify(evidence)); }
}
function freshTicket(name, allowance) {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-budget-' + name + '-'));
  initLedger(dir, { ticket: 'offline-test-' + name, allowance, note: 'offline test' });
  return dir;
}
/**
 * 跑一个子进程并收集它的 stdout。
 * 刻意**不用 execFileSync/spawnSync**：本机实测 spawnSync 的管道捕获会 ENOBUFS
 * （Windows + 受限环境下的管道缓冲问题），改用异步 spawn + 事件收集。
 */
function runChild(scriptPath, args) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, MOZHOU_BUDGET_CHILD: '1' },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => resolvePromise({ code: null, stdout: out, stderr: err + String(e), spawnError: String(e) }));
    child.on('exit', (code) => resolvePromise({ code, stdout: out, stderr: err }));
  });
}
/** 取子进程 stdout 里最后一行 JSON。 */
function lastJson(stdout) {
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try { return JSON.parse(lines[i]); } catch { /* 继续往前找 */ }
  }
  return null;
}

async function expectReject(fn) {
  try { await fn(); return { rejected: false }; }
  catch (error) { return { rejected: true, name: error.name, code: error.code ?? null, message: String(error.message).slice(0, 160) }; }
}

console.log('== T1 传输异常：占用必须先于请求持久化，异常不退款 ==');
{
  const dir = freshTicket('t1', 1);
  const transportCalls = [];
  const transport = async (reservation) => {
    // 断言：进入 transport 时，账本里**已经**有这次占用
    const snap = budgetSnapshot(dir);
    transportCalls.push({ reservationId: reservation?.reservationId ?? null, ledgerUsedAtEntry: snap.used });
    throw new Error('simulated ECONNRESET before any byte');
  };
  const first = await expectReject(() => guardedSend({ channel: 'real', ticketDir: dir, reason: 'T1 传输异常', transport }));
  const afterFirst = budgetSnapshot(dir);
  const second = await expectReject(() => guardedSend({ channel: 'real', ticketDir: dir, reason: 'T1 第二次尝试', transport }));
  const afterSecond = budgetSnapshot(dir);
  check('传输异常时 transport 被调用了一次', transportCalls.length === 1, transportCalls);
  check('进入 transport 时账本已记账（先记账后发送）', transportCalls[0]?.ledgerUsedAtEntry === 1, transportCalls[0]);
  check('传输异常被如实抛出', first.rejected === true && /ECONNRESET/.test(first.message), first);
  check('异常后额度不退款（used=1）', afterFirst.used === 1, { used: afterFirst.used });
  check('第二次尝试被额度挡住，且 transport 没有被再次调用', second.rejected === true && second.code === 'BUDGET_EXHAUSTED' && transportCalls.length === 1, { second, transportCalls: transportCalls.length });
  check('第二次拒绝后 used 仍为 1', afterSecond.used === 1, { used: afterSecond.used });
  rmSync(dir, { recursive: true, force: true });
}

console.log('== T2 429 限流：不退款 ==');
{
  const dir = freshTicket('t2', 2);
  const calls = [];
  const transport = async () => { calls.push(Date.now()); const e = new Error('上游 429: inference exceeds tpm/rpm limit'); e.code = 'RATE_LIMITED'; throw e; };
  const r1 = await expectReject(() => guardedSend({ channel: 'real', ticketDir: dir, reason: 'T2 第一次 429', transport }));
  const r2 = await expectReject(() => guardedSend({ channel: 'real', ticketDir: dir, reason: 'T2 第二次 429', transport }));
  const r3 = await expectReject(() => guardedSend({ channel: 'real', ticketDir: dir, reason: 'T2 第三次（应被挡）', transport }));
  const snap = budgetSnapshot(dir);
  check('两次 429 各消耗一次额度且不退款', snap.used === 2 && calls.length === 2, { used: snap.used, calls: calls.length });
  check('第三次被额度挡住', r3.rejected === true && r3.code === 'BUDGET_EXHAUSTED', r3);
  check('两次 429 的错误被如实带出', r1.rejected && r2.rejected && /429/.test(r1.message), { r1, r2 });
  rmSync(dir, { recursive: true, force: true });
}

console.log('== T3 客户端取消：不退款 ==');
{
  const dir = freshTicket('t3', 1);
  const transport = async () => { const e = new Error('aborted by client'); e.name = 'AbortError'; throw e; };
  const r = await expectReject(() => guardedSend({ channel: 'real', ticketDir: dir, reason: 'T3 取消', transport }));
  const snap = budgetSnapshot(dir);
  check('取消后额度不退款', r.rejected === true && snap.used === 1, { r, used: snap.used });
  check('账本里留有取消原因（可审计）', snap.rows.some((row) => /T3 取消/.test(row.reason)), snap.rows.map((x) => x.reason));
  rmSync(dir, { recursive: true, force: true });
}

console.log('== T4 进程重启：额度从盘上继承 ==');
{
  const dir = freshTicket('t4', 2);
  // 父进程先消耗 1
  await guardedSend({ channel: 'real', ticketDir: dir, reason: 'T4 父进程占用', transport: async () => 'ok' });
  const before = budgetSnapshot(dir);
  // 子进程（全新模块实例）读同一个账本，再消耗 1，然后第三次必须被挡
  const script = join(HERE, 'child-spend.mjs');
  const childRun = await runChild(script, ['--ticketDir', dir, '--attempts', '2']);
  const child = lastJson(childRun.stdout);
  const after = budgetSnapshot(dir);
  check('子进程正常退出（无 spawn/管道异常）', childRun.code === 0 && child !== null, { code: childRun.code, stderr: childRun.stderr.slice(0, 200) });
  check('父进程占用已持久化', before.used === 1, before);
  check('子进程第 1 次成功、第 2 次被挡（额度跨进程继承）', child.outcomes[0] === 'spent' && child.outcomes[1] === 'BUDGET_EXHAUSTED', child);
  check('磁盘上总占用 = 2（不因重启重置）', after.used === 2, { used: after.used });
  rmSync(dir, { recursive: true, force: true });
}

console.log('== T5/T11 并发进程：不超发（跨进程原子性）==');
{
  for (const [allowance, procs] of [[3, 8], [1, 6]]) {
    const dir = freshTicket('t5-' + allowance + '-' + procs, allowance);
    const script = join(HERE, 'child-spend.mjs');
    const runs = await Promise.all(
      Array.from({ length: procs }, (_v, i) => runChild(script, ['--ticketDir', dir, '--attempts', '1', '--label', 'p' + i])),
    );
    const spent = runs.map((run) => lastJson(run.stdout)?.outcomes?.[0] ?? 'PARSE_ERROR');
    check('并发子进程全部正常退出', runs.every((run) => run.code === 0), runs.map((run) => run.code));
    const okCount = spent.filter((s) => s === 'spent').length;
    const blocked = spent.filter((s) => s === 'BUDGET_EXHAUSTED').length;
    const snap = budgetSnapshot(dir);
    check('并发 ' + procs + ' 进程 / 额度 ' + allowance + '：成功数恰好等于额度', okCount === allowance, { okCount, allowance, spent });
    check('并发 ' + procs + ' 进程 / 额度 ' + allowance + '：其余全部被挡', blocked === procs - allowance && snap.used === allowance, { blocked, used: snap.used, procs });
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('== T6 多入口不能绕过 ==');
{
  const dir = freshTicket('t6', 1);
  // guardedSend(real) 是唯一能发真实请求的入口
  await guardedSend({ channel: 'real', ticketDir: dir, reason: 'T6 唯一入口', transport: async () => 'ok' });
  const direct = await expectReject(async () => { spendRealCall(dir, { reason: 'T6 直接调 spend（额度已尽）' }); });
  check('额度用尽后直接调 spendRealCall 也被挡（没有第二条放行路径）', direct.rejected === true && direct.code === 'BUDGET_EXHAUSTED', direct);
  // channel 非 real/controlled 一律拒绝
  const badChannel = await expectReject(() => guardedSend({ channel: 'any', ticketDir: dir, reason: 'x', transport: async () => 'ok' }));
  check('非法 channel 被拒', badChannel.rejected === true && /channel 必须是/.test(badChannel.message), badChannel);
  const emptyReason = await expectReject(async () => { spendRealCall(dir, { reason: '   ' }); });
  check('空 reason 被拒（账目不可审计就不许占用）', emptyReason.rejected === true && emptyReason.code === 'REASON_REQUIRED', emptyReason);
  rmSync(dir, { recursive: true, force: true });
}

console.log('== T7 非法预算 ⇒ 关闭真实通道 ==');
{
  for (const bad of [-1, 1.5, '4', null, undefined, NaN, Infinity, 999]) {
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-budget-t7-'));
    const r = await expectReject(async () => { initLedger(dir, { ticket: 't7', allowance: bad }); });
    check('非法 allowance ' + JSON.stringify(bad) + ' 被拒', r.rejected === true && (r.code === 'BUDGET_INVALID' || r.name === 'BudgetUnavailableError'), r);
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('== T8 账本损坏 ⇒ 关闭真实通道（不猜着重置）==');
{
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-budget-t8-'));
  mkdirSync(dir, { recursive: true });
  const cases = {
    '非 JSON': '{ this is not json',
    '缺 version': JSON.stringify({ ticket: 'x', realCallAllowance: 4, migratedSpend: [], spend: [] }),
    'version 错': JSON.stringify({ version: 99, ticket: 'x', realCallAllowance: 4, migratedSpend: [], spend: [] }),
    'allowance 为字符串': JSON.stringify({ version: 1, ticket: 'x', realCallAllowance: 4, migratedSpend: [], spend: [] }).replace('"realCallAllowance":4', '"realCallAllowance":"4"'),
    'spend 不是数组': JSON.stringify({ version: 1, ticket: 'x', realCallAllowance: 4, migratedSpend: [], spend: {} }),
    'reservationId 重复': JSON.stringify({ version: 1, ticket: 'x', realCallAllowance: 4, migratedSpend: [], spend: [{ reservationId: 'a' }, { reservationId: 'a' }] }),
  };
  for (const [name, content] of Object.entries(cases)) {
    writeFileSync(ledgerPath(dir), content, 'utf8');
    const r = await expectReject(async () => { spendRealCall(dir, { reason: 'T8 ' + name }); });
    // allowance 的**类型**非法会在 assertValidAllowance 先被挡（BUDGET_INVALID），
    // 结构与 JSON 层面的损坏走 LEDGER_CORRUPT。两条都属于 fail-closed，都应拒绝。
    const failClosed = r.rejected === true && (r.code === 'LEDGER_CORRUPT' || r.code === 'BUDGET_INVALID');
    check('损坏账本「' + name + '」被拒且不发请求（fail-closed）', failClosed, r);
  }
  // 缺失账本也必须拒绝（不是「没有账本 ⇒ 从零开始」）
  rmSync(ledgerPath(dir), { force: true });
  const missing = await expectReject(async () => { spendRealCall(dir, { reason: 'T8 缺账本' }); });
  check('账本缺失被拒（默认不允许任何真实调用）', missing.rejected === true && missing.code === 'LEDGER_MISSING', missing);
  rmSync(dir, { recursive: true, force: true });
}

console.log('== T9 锁被占用超时 ⇒ 关闭真实通道 ==');
{
  const dir = freshTicket('t9', 4);
  mkdirSync(join(dir, '.ledger.lock'));
  const t0 = Date.now();
  const r = await expectReject(async () => { spendRealCall(dir, { reason: 'T9 锁占用' }); });
  const elapsed = Date.now() - t0;
  check('锁被占用时抛 LOCK_TIMEOUT 而不是照发', r.rejected === true && r.code === 'LOCK_TIMEOUT', r);
  check('锁超时等待有界（<15s）', elapsed < 15000, { elapsed });
  check('锁超时后额度未被消耗', budgetSnapshot(dir).used === 0, budgetSnapshot(dir));
  rmSync(join(dir, '.ledger.lock'), { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
}

console.log('== T10 受控通道不占真实额度 ==');
{
  const dir = freshTicket('t10', 0);
  const r = await guardedSend({ channel: 'controlled', ticketDir: dir, reason: 'T10 受控', transport: async () => 'fixture-ok' });
  const snap = budgetSnapshot(dir);
  check('受控通道可以发请求（不占真实额度）', r.result === 'fixture-ok' && r.reservation === null, r);
  check('受控通道没有写入任何额度占用', snap.used === 0, snap);
  rmSync(dir, { recursive: true, force: true });
}

console.log('== T14 runner 源码级扫描（真实通道唯一入口）==');
/* 说明：T14 只做结构扫描，不产生任何网络或额度写入。 */
/**
 * runner.mjs 的**结构级**扫描（保守，宁可误报）：
 *   - 打 /api/draft.stream 的 fetch 只允许出现在 openDraftStream() 里（一个物理入口）；
 *   - openDraftStream() 只允许被 generate() 与 sendReal() 调用；
 *   - sendReal() 必须调用 guardedSend，且 channel!=='real' 时先抛错；
 *   - generator 的默认 channel 必须是 controlled。
 * 这样「新增一条绕过预算的真实请求路径」会因为多出调用点而立刻把测试打红。
 */
function scanRunnerForBypass(runnerPath) {
  const src = readFileSync(runnerPath, 'utf8');
  const bodyOf = (name) => {
    const start = src.indexOf('function ' + name + '(');
    if (start < 0) return '';
    // 粗略切到下一个顶层 function/常量声明
    const rest = src.slice(start);
    const end = rest.indexOf(String.fromCharCode(10) + '}');
    return end < 0 ? rest : rest.slice(0, end + 2);
  };
  // 只数**真调用**：fetch(<expr> + '/api/draft.stream')；注释里的路径不算。
  const fetchSites = (src.match(/fetch\([^;]{0,80}?\/api\/draft\.stream/g) ?? []).length;
  const openBody = src.slice(src.indexOf('async function openDraftStream('));
  const openFnEnd = openBody.indexOf(String.fromCharCode(10) + '}');
  const openFn = openFnEnd < 0 ? openBody : openBody.slice(0, openFnEnd);
  const openFnFetches = (openFn.match(/fetch\(/g) ?? []).length;
  const generateBody = bodyOf('generate');
  const sendRealBody = bodyOf('sendReal');
  const defaultChannelIsControlled = /const\s+CHANNEL\s*=\s*argOf\('channel',\s*'controlled'\)/.test(src);
  const sendRealGuards = /if \(CHANNEL !== 'real'\)/.test(sendRealBody) && /guardedSend\(/.test(sendRealBody);
  const generateSingleEntry = (generateBody.match(/openDraftStream\(/g) ?? []).length === 1 && (generateBody.match(/sendReal\(/g) ?? []).length === 1;
  return {
    fetchSites,
    openFnFetches,
    generateSingleEntry,
    sendRealGuards,
    guardedSites: (src.match(/guardedSend\(/g) ?? []).length,
    defaultChannelIsControlled,
  };
}

{
  const scan = scanRunnerForBypass(join(STAGE, 'runner.mjs'));
  check('打 /api/draft.stream 的 fetch 只有一处（唯一物理入口）', scan.fetchSites === 1 && scan.openFnFetches === 1, scan);
  check('generate() 是唯一分流函数（内部各一处 openDraftStream / sendReal）', scan.generateSingleEntry === true, scan);
  check('sendReal() 既判 channel 又过 guardedSend', scan.sendRealGuards === true, scan);
  check('runner 默认 channel 为 controlled（真实通道默认关闭）', scan.defaultChannelIsControlled === true, scan);
}

console.log('== T13 账本原子性：不存在半截文件 ==');
{
  const dir = freshTicket('t13', 2);
  await guardedSend({ channel: 'real', ticketDir: dir, reason: 'T13 a', transport: async () => 'ok' });
  const raw = readFileSync(ledgerPath(dir), 'utf8');
  let parsed = null; let parseOk = true;
  try { parsed = JSON.parse(raw); } catch { parseOk = false; }
  check('写入后账本是完整可解析 JSON', parseOk === true);
  check('文件里不含临时文件名残留', !readFileSync(ledgerPath(dir), 'utf8').includes('.tmp-'));
  const { readdirSync } = await import('node:fs');
  const tmpFiles = readdirSync(dir).filter((f) => f.includes('.tmp-'));
  check('目录里没有遗留 .tmp 文件', tmpFiles.length === 0, { tmpFiles });
  check('validateLedger 接受正常账本', validateLedger(parsed) === parsed);
  rmSync(dir, { recursive: true, force: true });
}

const summary = { passed, failed, total: results.length, ranAt: new Date().toISOString(), networkUsed: false, realModelCalls: 0, results };
writeFileSync(join(STAGE, 'artifacts-offline-budget.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
console.log('\n== 汇总 == passed=' + passed + ' failed=' + failed + ' total=' + results.length);
process.exit(failed === 0 ? 0 : 1);
