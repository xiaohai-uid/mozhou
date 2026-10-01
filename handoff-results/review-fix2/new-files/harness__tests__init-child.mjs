/**
 * harness/tests/init-child.mjs —— T16 的并发子进程。
 * mode=init : 调用 initLedger（可指定 ticket / allowance，模拟「重新初始化」）
 * mode=spend: 调用 guardedSend 占用一次额度（假 transport，绝不联网）
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

function argOf(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}
const implDir = argOf('implDir', null);
const ticketDir = argOf('ticketDir', null);
const mode = argOf('mode', 'init');
const ticket = argOf('ticket', null);
const allowance = argOf('allowance', null);
const label = argOf('label', 'c');

let outcome = 'UNEXPECTED_OK';
let errorCode = null;
let used = null;
try {
  if (mode === 'init') {
    const { initLedger } = await import(pathToFileURL(join(implDir, 'accounting.mjs')).href);
    const led = initLedger(ticketDir, {
      ticket,
      allowance: allowance === null ? 0 : Number(allowance),
      note: 'T16 child ' + label,
    });
    used = led.spend.length + led.migratedSpend.length;
  } else {
    const { guardedSend } = await import(pathToFileURL(join(implDir, 'transport.mjs')).href);
    await guardedSend({
      channel: 'real',
      ticketDir,
      reason: 'T16 spend ' + label,
      transport: async () => ({ fake: true }),
    });
  }
} catch (error) {
  outcome = 'refused';
  errorCode = error && error.code ? error.code : (error && error.name);
}
process.stdout.write(JSON.stringify({ label, pid: process.pid, mode, outcome, errorCode, used }) + String.fromCharCode(10));
