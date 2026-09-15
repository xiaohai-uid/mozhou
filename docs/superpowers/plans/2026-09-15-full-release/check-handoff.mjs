import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(readFileSync(resolve(base, name), 'utf8'));
function validate(plan, inspectFiles = true) {
  assert.equal(plan.schema_version, 1);
  const tasks = plan.tasks;
  assert.ok(Array.isArray(tasks) && tasks.length > 0);
  const ids = new Set(tasks.map(t => t.id));
  assert.equal(ids.size, tasks.length, 'duplicate task ID');
  assert.ok(tasks.filter(t => t.status === 'in_progress').length <= 1, 'single writer only');
  const seen = new Set();
  for (const task of tasks) {
    assert.ok(plan.status_values.includes(task.status), task.id + ': invalid state');
    for (const dep of task.depends_on) {
      assert.ok(ids.has(dep), task.id + ': missing dependency ' + dep);
      assert.ok(seen.has(dep), task.id + ': dependency order or cycle ' + dep);
      if (task.status === 'verified') assert.equal(tasks.find(t => t.id === dep).status, 'verified');
    }
    for (const field of ['document', 'anchor', 'deliverable', 'verification', 'rollback']) assert.ok(task[field], task.id + ': missing ' + field);
    assert.ok(Array.isArray(task.evidence));
    if (task.status === 'verified') {
      assert.ok(task.result && task.evidence.length, task.id + ': no result/evidence');
      for (const e of task.evidence) {
        for (const field of ['kind', 'path', 'sourceCommit', 'sourceFingerprint', 'command', 'scope']) assert.ok(e[field], task.id + ': incomplete evidence');
        assert.match(e.sourceCommit, /^[a-f0-9]{40}$/i);
        assert.equal(e.exitCode, 0);
        assert.ok(Array.isArray(e.limitations));
        if (inspectFiles) assert.ok(existsSync(resolve(plan.repository, e.path)), 'evidence file missing: ' + e.path);
      }
    }
    if (inspectFiles) {
      const doc = readFileSync(resolve(base, task.document), 'utf8');
      assert.ok(doc.includes('## ' + task.anchor + ' '), 'heading missing: ' + task.id);
      if (process.argv.includes('--check-targets')) for (const path of task.existing_paths) assert.ok(existsSync(resolve(plan.repository, path)), 'baseline target missing: ' + path);
    }
    seen.add(task.id);
  }
  return ids;
}
const plan = read('tasks.json');
const ids = validate(plan);
const external = read('EXTERNAL-INPUTS.json');
assert.ok(Array.isArray(external.required) && external.required.length > 0);
for (const input of external.required) for (const id of input.required_by) assert.ok(ids.has(id), 'unknown external dependency: ' + id);
if (process.argv.includes('--self-test')) {
  for (const mutate of [
    p => p.tasks.push(structuredClone(p.tasks[0])),
    p => p.tasks[0].depends_on.push('MISSING'),
    p => p.tasks[0].depends_on.push(p.tasks.at(-1).id),
    p => { p.tasks[0].status = 'verified'; }
  ]) {
    const invalid = structuredClone(plan); mutate(invalid);
    assert.throws(() => validate(invalid, false));
  }
  console.log('Self-test: rejected duplicate, missing dependency, cycle/order error and unsupported verification.');
}
console.log('PASS: ' + ids.size + ' task records. Structure only; this does NOT verify product behavior or authorize release.');
