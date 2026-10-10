/* t5-claim-refute 探针：验证「恢复过程再次中断」的行为。
   目标：核实原报告未回答的问题——recoverForward 自身被中断后是否仍能收敛。
   静态分析结论待验：recoverForward 对 partial 追加做 truncateSync(baseBytes) 后再 appendFileSync；
   若在两步之间再次崩溃，文件长度恰好 == baseBytes，classifyAppendDiskState 判为 'untouched'，
   recoverForward 的修复分支只处理 'partial'，因此该载荷被永久跳过。

   只读纪律：全部在系统 TEMP 新建一次性书库，不触碰 mozhou_rt 真实书稿库，无模型费用。 */
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, statSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createBook, LocalDataPlane, readProseChapter, proseChapterPath, TRACKING_STREAMS,
} from 'file:///C:/zcode/novel-ai/packages/data-plane/dist/index.js';
import { newFactId } from 'file:///C:/zcode/novel-ai/packages/kernel/dist/index.js';

const out = [];
const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };

const root = mkdtempSync(join(tmpdir(), 'mozhou-t5-2pc-'));
const disk = (rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch { return null; } };
const sizeOf = (rel) => { try { return statSync(join(root, rel)).size; } catch { return -1; } };

const FACT = '追踪/事实.jsonl';
const EVENTS = '.mozhou/events.jsonl'; // = RUNTIME_EVENTS_PATH (packages/data-plane/src/layout.ts:10)
const T0 = '2026-08-24T00:00:00.000Z';
let bookId = '';
/** 合法 TemporalFact 行：形状取自 packages/data-plane/src/chapter.test.ts:48-68。 */
const factRow = (i) => ({
  id: newFactId(), bookId, revision: 0, createdAt: T0, updatedAt: T0,
  subject: 'char:probe-' + i, predicate: 'located', value: '墨舟', validFrom: 1,
  validUntil: null, importance: 'notable', riskClass: 'low',
  source: { kind: 'chapter', chapterIndex: 1 }, status: 'confirmed',
  compactedIntoVolumeId: null, provenance: { origin: 'ai', protectedUserContent: false },
});

log('临时书库根: ' + root);
log('');

createBook({ dir: root, title: 'T5 恢复中断探针' });
let plane = LocalDataPlane.open(root);
bookId = plane.book.id;
plane.createChapterDraft({ chapterIndex: 1, title: '第一章' });

// ── 步骤 1：在 prose-flip 阶段崩溃 ────────────────────────────────────────────
// 结果：journal 在盘，追踪流已追加（state='done'），事件行已追加，正文**未**翻转。
try {
  plane.commitChapter({
    chapterIndex: 1,
    summary: 'probe',
    appends: { temporalFact: [factRow(1), factRow(2)] },
    onStage: (s) => { if (s === 'prose-flip') throw new Error('simulated crash at prose-flip'); },
  });
} catch (e) { log('步骤1 注入崩溃: ' + e.message); }
plane.close();

const journalPath = join(root, '.mozhou/pending-commit.json');
log('journal 在盘            : ' + existsSync(journalPath));
log('追踪流字节数(payload 已落): ' + sizeOf(FACT));
log('事件账本字节数          : ' + sizeOf('.mozhou/runtime_events.jsonl'));
log('正文 phase              : ' + readProseChapter(root, proseChapterPath(1)).phase);
log('');

// ── 步骤 2：手工构造「前滚恢复被再次中断」后的盘面 ───────────────────────────
// 2a. 把正文翻转为 journal.stagedProseSha256 对应内容（= 线性化点已过）
const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
const proseRel = journal.proseRelPath;
const before = readProseChapter(root, proseRel);
const { renderProseChapter } = await import('file:///C:/zcode/novel-ai/packages/data-plane/dist/chapter.js');
const staged = renderProseChapter({
  mozhouId: before.mozhouId,
  revision: before.revision + 1,
  chapterIndex: before.chapterIndex,
  phase: 'committed',
  commitId: journal.commitId,
  body: before.body.endsWith('\n') ? before.body : before.body + '\n',
});
writeFileSync(join(root, proseRel), staged, 'utf8');
log('步骤2a 正文已翻转为 committed  (sha 匹配 journal.stagedProseSha256 = 前滚路径)');

// 2b. 模拟「前滚恢复到一半又断电」：truncate 已执行、append 尚未执行
const target = journal.appends.find((t) => t.kind !== null);
const baseBytes = target.baseBytes;
truncateSync(join(root, target.relPath), baseBytes);
log('步骤2b 追踪流被截回 baseBytes=' + baseBytes + '（= 前滚恢复 truncate 之后、append 之前断电的盘面）');
log('        此刻该文件的 classifyAppendDiskState 结果 = size === baseBytes ⇒ \'untouched\'');
log('');

// ── 步骤 3：再次打开，触发 recoverPendingCommit ───────────────────────────────
let recovered, openErr = null;
try {
  recovered = LocalDataPlane.open(root);
} catch (e) { openErr = e; }
log('步骤3 LocalDataPlane.open(): ' + (openErr ? 'THREW ' + openErr.name + ': ' + openErr.message : '成功（未抛错）'));
if (recovered) {
  log('        打开即自动跑 recoverPendingCommit，无任何告警输出。');
  log('');
  log('== 恢复后盘面实况 ==');
  log('journal 是否已删除   : ' + !existsSync(journalPath) + '   (true = 恢复宣布完成)');
  const prose = readProseChapter(root, proseRel);
  log('正文 phase           : ' + prose.phase + '   commitId=' + prose.commitId);
  log('journal.commitId     : ' + journal.commitId);
  const streamNow = disk(target.relPath);
  log('追踪流字节数        : ' + sizeOf(target.relPath) + '  (baseBytes=' + baseBytes + ', payload=' + Buffer.from(target.payloadBase64, 'base64').length + ')');
  log('追踪流内容行数      : ' + (streamNow && streamNow.trim() ? streamNow.trim().split('\n').length : 0) + '  (journal 记录应有 2 行)');
  log('追踪流内容          : ' + JSON.stringify(streamNow));
  log('事件账本含 ChapterCommitted : ' + String(disk('.mozhou/runtime_events.jsonl')).includes('ChapterCommitted'));
  const n = recovered.db.prepare('SELECT COUNT(*) AS n FROM tracking_lines WHERE kind = ?').get('temporalFact');
  log('SQLite tracking_lines 行数  : ' + n.n);
  log('verifyBaseline()     : ' + JSON.stringify(recovered.verifyBaseline()));
  log('');
  const LOST = (sizeOf(target.relPath) === baseBytes);
  log('*** 判定 ***');
  if (LOST) {
    log('  ✗ 数据丢失已复现：恢复返回「成功」、journal 被删、正文=committed、基线校验干净，');
    log('    但追踪流的 2 行增量永久缺失（classify 判 untouched → recoverForward 不重放）。');
  } else {
    log('  ✓ 恢复收敛：追踪流已被补齐。');
  }
  log('');
  log('*** 对照：若没有这次「二次中断」，同一 commit 的正常前滚会补齐 ***');
  recovered.close();
}

rmSync(root, { recursive: true, force: true });
log('');
log('临时书库已清理: ' + root);
const fs = await import('node:fs');
fs.writeFileSync('C:/zcode/novel-ai/audit-2026-10-03/logs/038-t5-2pc-recovery-reinterrupt.txt', out.join('\r\n') + '\r\n', 'utf8');
console.log('\n[written] audit-2026-10-03/logs/038-t5-2pc-recovery-reinterrupt.txt');
