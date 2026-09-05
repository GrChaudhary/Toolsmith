import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runArchitectureReview } from '../review/architecture-review.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-review-'));

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: skillRoot, encoding: 'utf8' });
}

function writeFixture(name, doc) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, JSON.stringify(doc, null, 2));
  return file;
}

function baseDoc(overrides = {}) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'review fixture' },
    components: [
      { id: 'api', type: 'backend', label: 'API' },
    ],
    ...overrides,
  };
}

test('runArchitectureReview: no findings when no component uses a pilot kind', () => {
  const { findings, summary } = runArchitectureReview(baseDoc());
  assert.deepEqual(findings, []);
  assert.deepEqual(summary, { pass: 0, warning: 0, fail: 0 });
});

test('runArchitectureReview: pass finding when kind matches its conventional componentType', () => {
  const doc = baseDoc({
    components: [{ id: 'q', type: 'messagebus', kind: 'queue', label: 'Queue' }],
  });
  const { findings, summary } = runArchitectureReview(doc);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'pass');
  assert.equal(findings[0].rule, 'kind-componenttype-alignment');
  assert.equal(summary.pass, 1);
  assert.equal(summary.warning, 0);
});

test('runArchitectureReview: warning finding when kind does not match its conventional componentType', () => {
  const doc = baseDoc({
    components: [{ id: 'q', type: 'backend', kind: 'queue', label: 'Mislabeled queue' }],
  });
  const { findings, summary } = runArchitectureReview(doc);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'warning');
  assert.match(findings[0].message, /kind "queue"/);
  assert.match(findings[0].message, /componentType "backend"/);
  assert.equal(summary.warning, 1);
});

test('CLI: archify review is standalone and exits 0 even when findings include warnings', () => {
  const file = writeFixture('misaligned.architecture.json', baseDoc({
    components: [{ id: 'q', type: 'backend', kind: 'queue', label: 'Mislabeled queue', pos: [40, 40], size: [130, 60] }],
  }));
  const result = run(['review', 'architecture', file, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.command, 'review');
  assert.equal(payload.summary.warning, 1);

  // A warning-producing document must still validate and deliver cleanly —
  // review is informational only and never gates either pipeline.
  const validateResult = run(['validate', 'architecture', file, '--json']);
  assert.equal(validateResult.status, 0, validateResult.stderr);
  assert.equal(JSON.parse(validateResult.stdout).ok, true);
});

test('CLI: archify review only supports architecture in Phase 1', () => {
  const workflowExample = path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json');
  const result = run(['review', 'workflow', workflowExample]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /architecture diagrams only/);
});

test('CLI: archify review reports usage() on missing arguments', () => {
  const result = run(['review']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

test('CLI: archify review rejects unparsable input without crashing', () => {
  const file = path.join(tmp, 'broken.json');
  fs.writeFileSync(file, '{ not json');
  const result = run(['review', 'architecture', file]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /could not be parsed/);
});

test('CLI: archify review on the bundled enterprise-pilot example is all-pass', () => {
  const example = path.join(skillRoot, 'examples', 'enterprise-pilot.architecture.json');
  const result = run(['review', 'architecture', example, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.summary.warning, 0);
  assert.equal(payload.summary.fail, 0);
  assert.equal(payload.summary.pass, 3);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
