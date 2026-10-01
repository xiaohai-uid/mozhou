/**
 * harness/tests/child-spend.mjs —— 子进程占用额度（验证跨进程共享与并发不超发）。
 * 只写账本，**不发任何网络请求**。
 */
import { budgetSnapshot, spendRealCall } from '../accounting.mjs';

function argOf(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}
const ticketDir = argOf('ticketDir');
const attempts = Number(argOf('attempts', '1'));
const label = argOf('label', 'child');

const outcomes = [];
for (let i = 0; i < attempts; i += 1) {
  try {
    spendRealCall(ticketDir, { reason: 'child ' + label + ' attempt ' + (i + 1) });
    outcomes.push('spent');
  } catch (error) {
    outcomes.push(error.code ?? error.name ?? 'ERROR');
  }
}
process.stdout.write(JSON.stringify({ label, pid: process.pid, outcomes, snapshot: budgetSnapshot(ticketDir) }) + '\n');
