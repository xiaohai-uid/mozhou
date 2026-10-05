/* t5-claim-refute 只读探针 1b：纯 PRAGMA 快照（无子进程、无 EPERM）。
   目的：实测 better-sqlite3@12.11.1 在「未显式设置 timeout」时的全部关键 PRAGMA 实际值，
   核对原报告「better-sqlite3 默认 timeout 为 0」的说法。
   只在系统 TEMP 建临时库；不触碰 mozhou_rt 真实书稿库；无模型费用。 */
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const REAL_BS3 = 'C:/zcode/novel-ai/packages/data-plane/node_modules/better-sqlite3';
const Database = require(REAL_BS3);
const pkg = require(REAL_BS3 + '/package.json');

const out = [];
const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mozhou-t5-pragma-'));
const dbPath = path.join(tmpDir, 'probe.db');

log('== 环境 ==');
log('better-sqlite3 version : ' + pkg.version);
log('resolved entry         : C:\\zcode\\novel-ai\\packages\\data-plane\\node_modules\\better-sqlite3\\lib\\index.js');
log('node                   : ' + process.version);
log('platform               : ' + process.platform + ' ' + process.arch);
log('temp db (系统 TEMP)    : ' + dbPath);
log('');

// 完全复刻 packages/data-plane/src/database.ts:16-26 openDatabase 的调用序列
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

log('== openDatabase() 等价调用后的运行时 PRAGMA 实测 ==');
for (const p of ['journal_mode', 'foreign_keys', 'busy_timeout', 'synchronous', 'locking_mode',
                 'user_version', 'page_size', 'cache_size', 'temp_store', 'auto_vacuum',
                 'wal_autocheckpoint', 'mmap_size', 'integrity_check']) {
  let v;
  try { v = JSON.stringify(db.pragma(p, { simple: true })); }
  catch (e) { v = 'THREW: ' + e.message; }
  log(String(p).padEnd(20) + ' = ' + v);
}
log('');
log('NOTE openDatabase 源码 (packages/data-plane/src/database.ts:17-21) 只设了');
log('     journal_mode = WAL 与 foreign_keys = ON，未出现 timeout / busy_timeout。');
log('     上述 busy_timeout = 5000 完全来自 better-sqlite3 构造函数默认值，');
log('     源码出处：node_modules/.pnpm/better-sqlite3@12.11.1/.../lib/database.js:34');
log('       const timeout = \'timeout\' in options ? options.timeout : 5000;');
log('');

const db0 = new Database(path.join(tmpDir, 'zero.db'), { timeout: 0 });
log('对照 A：new Database(p, {timeout: 0})  -> busy_timeout = ' + db0.pragma('busy_timeout', { simple: true }));
db0.close();
const dbB = new Database(path.join(tmpDir, 'default.db'));
log('对照 B：new Database(p)  (无 options)  -> busy_timeout = ' + dbB.pragma('busy_timeout', { simple: true }));
dbB.close();
log('');
log('PRAGMA synchronous 语义：2 = SQLITE_FULL（不是原报告所说的 WAL 下默认 NORMAL=1）。');
log('  busy_timeout 之外，本产品确实没有显式覆盖 synchronous，因此沿用 SQLite 默认 FULL。');

db.close();
try { fs.rmSync(tmpDir, { recursive: true, force: true }); log('临时目录已清理: ' + tmpDir); }
catch (e) { log('清理告警(不影响结论): ' + e.code); }

fs.writeFileSync(
  'C:/zcode/novel-ai/audit-2026-10-03/logs/035-t5-sqlite-pragma-runtime.txt',
  out.join('\r\n') + '\r\n', 'utf8');
console.log('\n[written] audit-2026-10-03/logs/035-t5-sqlite-pragma-runtime.txt');
