// review-fix2 / rollback.mjs
// Only undoes the round-5 changes to the external test harness.
// Never deletes the whole stage dir, never touches handoff-results or review-fix.
//   node rollback.mjs --dry-run
//   node rollback.mjs --apply
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// STAGE 可用 MOZHOU_STAGE_DIR 覆盖，便于在**副本**上先演练回滚再动真身。
const STAGE = process.env.MOZHOU_STAGE_DIR || 'C:/zcode/novel-ai-handoff-stage4';
const PKG = 'C:/zcode/novel-ai/handoff-results/review-fix2';
const APPLY = process.argv.includes('--apply');

const MODIFIED = ['runner.mjs', 'harness/accounting.mjs', 'harness/transport.mjs',
  'harness/make-ledger.mjs', 'harness/tests/offline-budget.test.mjs',
  'harness/tests/child-spend.mjs', 'fixtures/controlled-upstream.mjs'];
const ADDED = ['harness/tests/audit-red.test.mjs', 'harness/tests/lock-holder.mjs',
  'harness/tests/init-child.mjs'];
const KEEP = ['stage/runs  (历史运行目录，不删)', 'stage/.baseline-round5  (修前基线证据，不删)',
  'handoff-results  (原始交回包，不删)', 'handoff-results/review-fix  (第四轮交回包，不删)'];

// autocrlf 必须显式关掉：开着时 git apply 会把 LF 写成 CRLF，回滚后**内容对但字节不对**。
const GIT = ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf'];
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

console.log('mode: ' + (APPLY ? 'APPLY' : 'DRY-RUN'));
console.log('');
console.log('[kept, never touched]');
for (const k of KEEP) console.log('  - ' + k);
console.log('');

let failed = 0;
for (const f of MODIFIED) {
  const diff = join(PKG, 'diffs', f.split('/').join('__') + '.diff');
  const base = join(STAGE, '.baseline-round5', f);
  if (!existsSync(diff)) { console.log('  SKIP  ' + f + ' (no diff in package)'); continue; }
  if (readFileSync(diff, 'utf8').trim() === '') { console.log('  SKIP  ' + f + ' (identical to baseline)'); continue; }
  if (!APPLY) { console.log('  WOULD reverse-apply  ' + f); continue; }
  try {
    execFileSync('git', [...GIT, 'apply', '-R', diff], { cwd: STAGE, stdio: ['ignore', 'pipe', 'pipe'] });
    const live = sha(join(STAGE, f));
    const want = existsSync(base) ? sha(base) : null;
    const ok = want === null || live === want;
    console.log('  ' + (ok ? 'OK  ' : 'DIFF') + '  ' + f + '  sha256=' + live.slice(0, 16)
      + (want === null ? '' : '  baseline=' + want.slice(0, 16)) + (ok ? '' : '  (MISMATCH)'));
    if (!ok) failed += 1;
  } catch (e) {
    failed += 1;
    console.log('  FAIL  ' + f + ' :: ' + String(e.message).split(String.fromCharCode(10))[0]);
  }
}

for (const f of ADDED) {
  const abs = join(STAGE, f);
  if (!existsSync(abs)) { console.log('  SKIP  ' + f + ' (absent)'); continue; }
  if (!APPLY) { console.log('  WOULD delete  ' + f + ' (added this round)'); continue; }
  rmSync(abs, { force: true });
  console.log('  OK    deleted  ' + f);
}

console.log('');
if (failed === 0) {
  console.log('done.');
} else {
  console.log(failed + ' step(s) need attention');
}
if (!APPLY) console.log('(dry run; add --apply to execute)');
process.exit(failed === 0 ? 0 : 1);