/**
 * harness/tests/lock-holder.mjs —— T15 的「活跃持锁者」子进程。
 *
 * 它用**两种实现共有的锁表示**（mkdir 出 <ticketDir>/.ledger.lock，再写 owner.json）
 * 模拟一个仍存活的持锁者，然后：
 *   1. 落 ready 标记（父进程据此模拟「时钟前跳」）；
 *   2. 睡 holdMs（父进程在这段时间里试图取锁并发请求）；
 *   3. 醒来后用被测实现自己的 spendRealCall 占用一次额度。
 *
 * 全程**不发任何网络请求**。
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function argOf(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}
const implDir = argOf('implDir', null);
const ticketDir = argOf('ticketDir', null);
const label = argOf('label', 'A');
const holdMs = Number(argOf('holdMs', '3000'));
const readyFile = argOf('ready', null);

const lock = join(ticketDir, '.ledger.lock');
mkdirSync(lock);
writeFileSync(join(lock, 'owner.json'), JSON.stringify({
  token: 'held-by-' + label, pid: process.pid, host: hostname(), acquiredAt: new Date().toISOString(),
}, null, 2), 'utf8');
if (readyFile !== null) writeFileSync(readyFile, String(process.pid), 'utf8');

await new Promise((r) => setTimeout(r, holdMs));

// 临界区结束：先释放自己持有的锁，再去申请额度（否则会把自己挡住）。
rmSync(lock, { recursive: true, force: true });

let outcome = 'UNEXPECTED_OK';
let errorCode = null;
try {
  const mod = await import(pathToFileURL(join(implDir, 'accounting.mjs')).href);
  const r = mod.spendRealCall(ticketDir, { reason: 'T15 holder ' + label, channel: 'real' });
  outcome = 'spent';
  errorCode = null;
  globalThis.__t15 = r.seq;
} catch (error) {
  outcome = 'refused';
  errorCode = error && error.code ? error.code : (error && error.name);
}
process.stdout.write(JSON.stringify({ label, pid: process.pid, outcome, errorCode, seq: globalThis.__t15 ?? null }) + String.fromCharCode(10));