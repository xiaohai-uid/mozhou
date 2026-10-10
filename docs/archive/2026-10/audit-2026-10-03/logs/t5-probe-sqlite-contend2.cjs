/* t5-claim-refute 只读探针 3：同文件正确对照组。
   修正 v2 的缺陷：v2 的 timeout:0 对照用了另一个库文件（zero.db），无锁可比。
   本版两条连接都指向**同一个** contend.db。 */
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const REAL_BS3 = 'C:/zcode/novel-ai/packages/data-plane/node_modules/better-sqlite3';
const Database = require(REAL_BS3);
const pkg = require(REAL_BS3 + '/package.json');

const out = [];
const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mozhou-t5-contend2-'));
const dbPath = path.join(tmpDir, 'contend.db');

log('better-sqlite3 version : ' + pkg.version);
log('node                    : ' + process.version + '  ' + process.platform + '/' + process.arch);
log('temp db                 : ' + dbPath);
log('');

const setup = new Database(dbPath);
setup.pragma('journal_mode = WAL');
setup.exec('CREATE TABLE t(x INTEGER); INSERT INTO t VALUES (1);');
setup.close();

const defaultConn = new Database(dbPath);           // ← 等价于 openDatabase()：未传 timeout
const zeroConn = new Database(dbPath, { timeout: 0 }); // ← 对照组
log('默认连接   busy_timeout = ' + defaultConn.pragma('busy_timeout', { simple: true }));
log('timeout:0  busy_timeout = ' + zeroConn.pragma('busy_timeout', { simple: true }));
log('');

const holder = path.join(tmpDir, 'holder.cjs');
fs.writeFileSync(holder, `
const Database = require(${JSON.stringify(REAL_BS3)});
const db = new Database(${JSON.stringify(dbPath)});
db.pragma('busy_timeout = 0');
db.exec('BEGIN IMMEDIATE');
db.prepare('UPDATE t SET x = 2').run();
process.stdout.write('LOCKED\\n');
setTimeout(() => { try { db.exec('ROLLBACK'); db.close(); } catch {} process.exit(0); }, 20000);
`);

function attempt(label, conn, capMs) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    let done = false;
    const fin = (m) => { if (done) return; done = true; resolve(m); };
    const timer = setTimeout(() => fin(`${label}: ${capMs}ms 内仍在等待（说明会等）`), capMs);
    try {
      conn.exec('BEGIN IMMEDIATE');
      clearTimeout(timer);
      const dt = Number(process.hrtime.bigint() - t0) / 1e6;
      try { conn.exec('ROLLBACK'); } catch {}
      fin(`${label}: 拿到写锁 (${dt.toFixed(1)} ms)`);
    } catch (e) {
      clearTimeout(timer);
      const dt = Number(process.hrtime.bigint() - t0) / 1e6;
      fin(`${label}: 抛 ${e.code} 耗时 ${dt.toFixed(1)} ms  "${e.message}"`);
    }
  });
}

(async () => {
  const child = await new Promise((res) => {
    const p = spawn(process.execPath, [holder], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    p.stdout.on('data', (d) => { buf += d; if (buf.includes('LOCKED')) res(p); });
    p.stderr.on('data', (d) => log('holder stderr: ' + d));
  });
  log('持锁子进程 pid=' + child.pid + ' 已持有 BEGIN IMMEDIATE（存活 20s，两组测试期间不退出）。');
  log('两条被测连接指向同一个 ' + dbPath);
  log('');
  log('== 行为级实测 ==');
  log(await attempt('A 默认 (未设 timeout) ', defaultConn, 8000));
  log(await attempt('B 显式 timeout:0      ', zeroConn, 3000));
  log('');
  log('判读：A 等待约 5000ms 才抛 SQLITE_BUSY、B 立即(<50ms)抛 SQLITE_BUSY');
  log('      ⇒ better-sqlite3 默认 timeout = 5000，不是 0。原报告该断言不成立。');

  defaultConn.close(); zeroConn.close();
  await new Promise((r) => child.on('exit', r));
  fs.rmSync(tmpDir, { recursive: true, force: true });
  log('');
  log('临时目录已清理: ' + tmpDir);
  fs.writeFileSync(
    'C:/zcode/novel-ai/audit-2026-10-03/logs/037-t5-sqlite-lock-contention-v2.txt',
    out.join('\r\n') + '\r\n', 'utf8');
})();
