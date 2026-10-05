/* t5-claim-refute 只读探针 2：跨进程锁争用的**行为级**实测。
   目的：证伪/证实「better-sqlite3 默认 timeout 为 0 → 外部进程读锁库会**立即**抛 SQLITE_BUSY」。
   方法：异步 spawn 持锁子进程（活 4s），主进程在其存活期间尝试 BEGIN IMMEDIATE 并计时。
   全程使用系统 TEMP 临时库，不触碰 mozhou_rt 真实书稿库。 */
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const BS3 = 'C:/zcode/novel-ai/packages/data-modules/node_modules/better-sqlite3';
const REAL_BS3 = 'C:/zcode/novel-ai/packages/data-plane/node_modules/better-sqlite3';
const Database = require(REAL_BS3);
const pkg = require(REAL_BS3 + '/package.json');

const out = [];
const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mozhou-t5-contend-'));
const dbPath = path.join(tmpDir, 'contend.db');

log('better-sqlite3 version : ' + pkg.version);
log('temp db                : ' + dbPath);
log('');

const me = new Database(dbPath);
me.pragma('journal_mode = WAL');
me.exec('CREATE TABLE t(x INTEGER); INSERT INTO t VALUES (1);');
log('本连接 busy_timeout    : ' + me.pragma('busy_timeout', { simple: true }) + ' ms  (源码 database.ts 未设置)');
log('');

const holder = path.join(tmpDir, 'holder.cjs');
fs.writeFileSync(holder, `
const Database = require(${JSON.stringify(REAL_BS3)});
const db = new Database(${JSON.stringify(dbPath)});
db.pragma('busy_timeout = 0');                 // 持锁方不等待，确保真正独占
db.exec('BEGIN IMMEDIATE');
db.prepare('UPDATE t SET x = 2').run();
process.stdout.write('LOCKED\\n');
setTimeout(() => { try { db.exec('ROLLBACK'); db.close(); } catch {} process.exit(0); }, 6000);
`);

function attempt(label, conn) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    let done = false;
    const finish = (msg) => {
      if (done) return; done = true;
      resolve(msg);
    };
    setTimeout(() => finish(`${label}: 3000ms 内未完成（说明还在等锁）`), 3000);
    try {
      conn.exec('BEGIN IMMEDIATE');
      const dt = Number(process.hrtime.bigint() - t0) / 1e6;
      try { conn.exec('ROLLBACK'); } catch {}
      finish(`${label}: **意外拿到写锁** (${dt.toFixed(1)} ms) — 持锁子进程可能已退出`);
    } catch (e) {
      const dt = Number(process.hrtime.bigint() - t0) / 1e6;
      finish(`${label}: 抛错 code=${e.code} 耗时 ${dt.toFixed(1)} ms  msg="${e.message}"`);
    }
  });
}

(async () => {
  await new Promise((res) => {
    const p = spawn(process.execPath, [holder], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    p.stdout.on('data', (d) => { buf += d; if (buf.includes('LOCKED')) res(); });
    p.stderr.on('data', (d) => log('holder stderr: ' + d));
    log('持锁子进程 pid=' + p.pid + ' 等待 LOCKED 信号…');
  });
  log('持锁子进程已持有 BEGIN IMMEDIATE 写事务（存活 6s）。');
  log('');

  log('== 行为级实测：默认 timeout 连接在锁被占用时的反应 ==');
  log(await attempt('默认 (busy_timeout=' + me.pragma('busy_timeout', { simple: true }) + ')', me));
  log('');

  const zero = new Database(path.join(tmpDir, 'zero.db'), { timeout: 0 });
  log('对照：显式 timeout:0 的连接 -> busy_timeout=' + zero.pragma('busy_timeout', { simple: true }));
  log(await attempt('显式 timeout:0', zero));
  zero.close();
  log('');
  log('判读：若「默认」一栏抛错耗时 ≈ 5000 ms 而「显式 timeout:0」一栏 <50 ms，');
  log('      则原报告「better-sqlite3 默认 timeout 为 0 / 立即抛 SQLITE_BUSY」被证伪。');

  me.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  log('');
  log('临时目录已清理: ' + tmpDir);
  fs.writeFileSync(
    'C:/zcode/novel-ai/audit-2026-10-03/logs/036-t5-sqlite-lock-contention.txt',
    out.join('\r\n') + '\r\n', 'utf8');
})();
