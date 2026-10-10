/* t5-claim-refute 只读探针：不触碰任何真实书稿库，仅在系统 TEMP 建临时库。
   目的：实测 better-sqlite3@12.11.1 在「未显式设置 timeout」时的实际 PRAGMA 值，
   核对原报告「better-sqlite3 默认 timeout 为 0」的说法。
   不产生模型费用、不写 mozhou_rt 真实书稿库。 */
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const BS3 = 'C:/zcode/novel-ai/packages/data-plane/node_modules/better-sqlite3';
const Database = require(BS3);
const pkg = require(BS3 + '/package.json');

const out = [];
const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mozhou-t5-sqlite-'));
const dbPath = path.join(tmpDir, 'probe.db');

log('== 环境 ==');
log('better-sqlite3 version   : ' + pkg.version);
log('resolved entry            : ' + path.join(BS3, 'lib', 'index.js'));
log('node                      : ' + process.version);
log('platform                  : ' + process.platform + ' ' + process.arch);
log('temp db                   : ' + dbPath);
log('');

// 完全复刻 packages/data-plane/src/database.ts:16-26 openDatabase 的调用序列
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

log('== openDatabase() 等价调用后的运行时 PRAGMA 实测 ==');
const pragmas = [
  'journal_mode', 'foreign_keys', 'busy_timeout', 'synchronous', 'locking_mode',
  'user_version', 'page_size', 'cache_size', 'temp_store', 'auto_vacuum',
  'wal_autocheckpoint', 'mmap_size', 'page_count', 'freelist_count', 'integrity_check',
];
for (const p of pragmas) {
  let v;
  try { v = JSON.stringify(db.pragma(p, { simple: true })); }
  catch (e) { v = 'THREW: ' + e.message; }
  log(String(p).padEnd(20) + ' = ' + v);
}
log('');
log('NOTE busy_timeout 未出现在 openDatabase 源码中（database.ts:19-20 只设了 journal_mode 与 foreign_keys）');
log('     以上 busy_timeout 数值完全来自 better-sqlite3 构造函数的默认 timeout。');
log('');

// 版本 A：显式 timeout:0
const db0 = new Database(path.join(tmpDir, 'zero.db'), { timeout: 0 });
log('对照 A：new Database(p,{timeout:0})      -> busy_timeout = ' + db0.pragma('busy_timeout', { simple: true }));
db0.close();
// 版本 B：完全默认
const dbB = new Database(path.join(tmpDir, 'default.db'));
log('对照 B：new Database(p)  (无 options)    -> busy_timeout = ' + dbB.pragma('busy_timeout', { simple: true }));
dbB.close();
log('');

// 行为级实测：A 进程持有写锁，B 进程在默认设置下写 —— 是否「立即抛 SQLITE_BUSY」？
log('== 锁争用行为实测（跨进程，模拟「外部进程读取/写入锁库」） ==');
const { spawnSync } = require('node:child_process');
const contendDb = path.join(tmpDir, 'contend.db');
const c1 = new Database(contendDb);
c1.pragma('journal_mode = WAL');
c1.exec('CREATE TABLE t(x INTEGER); INSERT INTO t VALUES (1);');

const holder = path.join(tmpDir, 'holder.cjs');
fs.writeFileSync(holder, `
const Database = require(${JSON.stringify(BS3)});
const db = new Database(${JSON.stringify(contendDb)});
db.pragma('busy_timeout = 0');           // 故意让持有者用 0 以便独占写锁
db.exec('BEGIN IMMEDIATE');
db.prepare('UPDATE t SET x = 2').run();
process.stdout.write('LOCKED\\n');
setTimeout(() => { try { db.exec('ROLLBACK'); db.close(); } catch {} process.exit(0); }, 4000);
`);

const p = spawnSync(process.execPath, [holder], { timeout: 8000 });
log('持锁子进程输出: ' + String(p.stdout).trim());

const t0 = process.hrtime.bigint();
let outcome;
try {
  c1.exec('BEGIN IMMEDIATE');
  outcome = 'UNEXPECTED: 竟然拿到写锁';
  try { c1.exec('ROLLBACK'); } catch {}
} catch (e) {
  const dt = Number(process.hrtime.bigint() - t0) / 1e6;
  outcome = 'THREW after ' + dt.toFixed(1) + ' ms  code=' + e.code + '  msg=' + e.message;
}
log('默认 timeout 的连接尝试 BEGIN IMMEDIATE -> ' + outcome);
log('');
log('判读：若抛出耗时 ≈ 5000ms，说明实际生效的是 better-sqlite3 默认 timeout=5000，');
log('      而非原报告所称的「默认 0 / 立即抛 SQLITE_BUSY」。');
log('');

c1.close();
fs.rmSync(tmpDir, { recursive: true, force: true });
log('临时目录已清理: ' + tmpDir);

fs.writeFileSync(
  'C:/zcode/novel-ai/audit-2026-10-03/logs/035-t5-sqlite-pragma-runtime.txt',
  out.join('\r\n') + '\r\n',
  'utf8'
);
