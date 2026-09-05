import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectArchitecture } from '../projection/architecture-projection.mjs';
import { architecture as validateArchitecture } from '../renderers/shared/generated-validators.mjs';
import { validateComponentHierarchy } from '../renderers/shared/cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const renderer = path.join(skillRoot, 'renderers/architecture/render-architecture.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-projection-'));

function hierarchicalFixture() {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: 'Doc Processing Platform',
      views: [{ id: 'v1', label: 'V1', focus: ['webApp', 'uploadApi', 'processingWorker'] }],
    },
    components: [
      { id: 'webApp', type: 'frontend', label: 'Web App', pos: [40, 300], size: [130, 60] },
      {
        id: 'docProcessing', type: 'backend', label: 'Document Processing Service', pos: [300, 290], size: [220, 80],
        children: ['uploadApi', 'objectStore', 'processingQueue', 'processingWorker', 'documentDb'],
      },
      { id: 'uploadApi', type: 'backend', label: 'Upload API', pos: [280, 140], size: [130, 60] },
      { id: 'objectStore', type: 'cloud', label: 'Object Storage', pos: [480, 60], size: [130, 60] },
      { id: 'processingQueue', type: 'messagebus', kind: 'queue', label: 'Processing Queue', pos: [480, 220], size: [130, 60] },
      { id: 'processingWorker', type: 'backend', label: 'Processing Worker', pos: [680, 220], size: [130, 60] },
      { id: 'documentDb', type: 'database', label: 'Document DB', pos: [680, 380], size: [130, 60] },
    ],
    boundaries: [
      { kind: 'region', label: 'Processing region', wraps: ['uploadApi', 'processingWorker', 'documentDb'] },
    ],
    connections: [
      { id: 'webapp-to-upload', from: 'webApp', to: 'uploadApi', label: 'POST /upload', fromSide: 'top', toSide: 'left' },
      { from: 'uploadApi', to: 'objectStore', label: 'store file', labelDy: -20 },
      { from: 'uploadApi', to: 'processingQueue', label: 'enqueue', fromSide: 'right', toSide: 'left' },
      { from: 'processingQueue', to: 'processingWorker' },
      { from: 'processingWorker', to: 'documentDb', label: 'persist result', labelDy: 24 },
    ],
  };
}

function flatFixture() {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Flat fixture' },
    components: [
      { id: 'a', type: 'backend', label: 'A', pos: [0, 0], size: [100, 50] },
      { id: 'b', type: 'database', label: 'B', pos: [200, 0], size: [100, 50] },
    ],
    connections: [
      { id: 'a-to-b', from: 'a', to: 'b', label: 'reads' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Basic contract

test('projectArchitecture rejects an unknown level', () => {
  const result = projectArchitecture(flatFixture(), 'mid');
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'projection/unknown-level');
});

test('projectArchitecture rejects a non-architecture document', () => {
  const result = projectArchitecture({ diagram_type: 'workflow' }, 'hld');
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'projection/unsupported-document');
});

test('projectArchitecture does not mutate its input', () => {
  const doc = hierarchicalFixture();
  const before = JSON.stringify(doc);
  projectArchitecture(doc, 'hld');
  projectArchitecture(doc, 'lld');
  assert.equal(JSON.stringify(doc), before);
});

// ---------------------------------------------------------------------------
// Backward compatibility: a flat document (no children anywhere) projects to
// something deeply equal to the source, for both levels.

test('a flat document projects to itself for hld', () => {
  const doc = flatFixture();
  const result = projectArchitecture(doc, 'hld');
  assert.equal(result.ok, true);
  assert.deepEqual(result.document, doc);
  assert.deepEqual(result.changedIds, { droppedComponents: [], droppedConnections: [], mergedConnections: [] });
});

test('a flat document projects to itself for lld', () => {
  const doc = flatFixture();
  const result = projectArchitecture(doc, 'lld');
  assert.equal(result.ok, true);
  assert.deepEqual(result.document, doc);
  assert.deepEqual(result.changedIds, { droppedComponents: [], droppedConnections: [], mergedConnections: [] });
});

test('every bundled architecture example (none use children) is HLD/LLD-equivalent to its source', () => {
  const examplesDir = path.join(skillRoot, 'examples');
  const examples = fs.readdirSync(examplesDir).filter((name) => name.endsWith('.architecture.json'));
  for (const name of examples) {
    const doc = JSON.parse(fs.readFileSync(path.join(examplesDir, name), 'utf8'));
    if (doc.components.some((component) => Array.isArray(component.children))) continue; // the one intentionally hierarchical example
    const hld = projectArchitecture(doc, 'hld');
    const lld = projectArchitecture(doc, 'lld');
    assert.deepEqual(hld.document, doc, `${name}: hld should equal source`);
    assert.deepEqual(lld.document, doc, `${name}: lld should equal source`);
  }
});

// ---------------------------------------------------------------------------
// Determinism

test('projection is deterministic: same input and level always produce deep-equal output', () => {
  const doc = hierarchicalFixture();
  const first = projectArchitecture(doc, 'hld');
  const second = projectArchitecture(doc, 'hld');
  assert.deepEqual(first, second);
  const firstLld = projectArchitecture(doc, 'lld');
  const secondLld = projectArchitecture(doc, 'lld');
  assert.deepEqual(firstLld, secondLld);
});

// ---------------------------------------------------------------------------
// HLD correctness

test('hld: top-level and standalone components are retained, absorbed children are hidden', () => {
  const result = projectArchitecture(hierarchicalFixture(), 'hld');
  assert.equal(result.ok, true);
  assert.deepEqual(result.document.components.map((c) => c.id), ['webApp', 'docProcessing']);
  assert.deepEqual(result.changedIds.droppedComponents, [
    'uploadApi', 'objectStore', 'processingQueue', 'processingWorker', 'documentDb',
  ]);
});

test('hld: the surviving parent component does not carry a dangling children reference', () => {
  const result = projectArchitecture(hierarchicalFixture(), 'hld');
  const parent = result.document.components.find((c) => c.id === 'docProcessing');
  assert.equal('children' in parent, false);
});

test('hld: connections fully internal to one group are dropped', () => {
  const result = projectArchitecture(hierarchicalFixture(), 'hld');
  const ids = result.document.connections.map((c) => `${c.from}->${c.to}`);
  assert.ok(!ids.includes('uploadApi->objectStore'));
  assert.ok(!ids.includes('uploadApi->processingQueue'));
  assert.ok(!ids.includes('processingQueue->processingWorker'));
  assert.ok(!ids.includes('processingWorker->documentDb'));
  assert.deepEqual(result.changedIds.droppedConnections, [
    'uploadApi->objectStore', 'uploadApi->processingQueue', 'processingQueue->processingWorker', 'processingWorker->documentDb',
  ]);
});

test('hld: a connection crossing the group boundary is lifted and, alone, preserves its id and label', () => {
  const result = projectArchitecture(hierarchicalFixture(), 'hld');
  assert.equal(result.document.connections.length, 1);
  const [connection] = result.document.connections;
  assert.equal(connection.from, 'webApp');
  assert.equal(connection.to, 'docProcessing');
  assert.equal(connection.id, 'webapp-to-upload');
  assert.equal(connection.label, 'POST /upload');
  assert.deepEqual(result.changedIds.mergedConnections, []);
});

test('hld: multiple connections crossing into the same group merge into one, with a deterministic id and no fabricated label', () => {
  const doc = hierarchicalFixture();
  // Give webApp a second, independent path into the group so two distinct
  // authored connections lift to the same (webApp, docProcessing) pair.
  doc.connections.push({ id: 'webapp-to-worker-direct', from: 'webApp', to: 'processingWorker', label: 'poll status' });
  const result = projectArchitecture(doc, 'hld');
  const crossing = result.document.connections.filter((c) => c.from === 'webApp' && c.to === 'docProcessing');
  assert.equal(crossing.length, 1);
  assert.equal(crossing[0].id, 'webApp__docProcessing');
  assert.equal('label' in crossing[0], false);
  assert.equal(result.changedIds.mergedConnections.length, 1);
  assert.deepEqual(result.changedIds.mergedConnections[0].sourceIds.sort(), ['webapp-to-upload', 'webapp-to-worker-direct'].sort());
});

test('hld: boundary wraps are remapped to the nearest HLD-visible ancestor and deduplicated', () => {
  const result = projectArchitecture(hierarchicalFixture(), 'hld');
  assert.deepEqual(result.document.boundaries, [
    { kind: 'region', label: 'Processing region', wraps: ['docProcessing'] },
  ]);
});

test('hld: guided view focus lists are remapped to the nearest HLD-visible ancestor and deduplicated', () => {
  const result = projectArchitecture(hierarchicalFixture(), 'hld');
  assert.deepEqual(result.document.meta.views[0].focus, ['webApp', 'docProcessing']);
});

test('hld: the projected document is schema-valid and hierarchy-clean', () => {
  const result = projectArchitecture(hierarchicalFixture(), 'hld');
  assert.equal(validateArchitecture(result.document), true, JSON.stringify(validateArchitecture.errors));
  assert.doesNotThrow(() => validateComponentHierarchy('architecture', result.document));
});

// ---------------------------------------------------------------------------
// LLD correctness

test('lld: parent/group components are excluded, leaves and standalone components are retained unchanged', () => {
  const result = projectArchitecture(hierarchicalFixture(), 'lld');
  assert.deepEqual(result.document.components.map((c) => c.id), [
    'webApp', 'uploadApi', 'objectStore', 'processingQueue', 'processingWorker', 'documentDb',
  ]);
  assert.deepEqual(result.changedIds.droppedComponents, ['docProcessing']);
});

test('lld: leaf ids are unchanged and no components are renamed', () => {
  const source = hierarchicalFixture();
  const result = projectArchitecture(source, 'lld');
  for (const component of result.document.components) {
    const original = source.components.find((c) => c.id === component.id);
    assert.ok(original, `${component.id} should be an authored id`);
    assert.equal(component.label, original.label);
  }
});

test('lld: connections are preserved byte-for-byte, no merging', () => {
  const source = hierarchicalFixture();
  const result = projectArchitecture(source, 'lld');
  assert.deepEqual(result.document.connections, source.connections);
  assert.deepEqual(result.changedIds, { droppedComponents: ['docProcessing'], droppedConnections: [], mergedConnections: [] });
});

test('lld: the projected document is schema-valid and hierarchy-clean', () => {
  const result = projectArchitecture(hierarchicalFixture(), 'lld');
  assert.equal(validateArchitecture(result.document), true, JSON.stringify(validateArchitecture.errors));
  assert.doesNotThrow(() => validateComponentHierarchy('architecture', result.document));
});

// ---------------------------------------------------------------------------
// Renderer compatibility: both projected documents render through the
// UNMODIFIED architecture renderer with no changes to it.

test('renderer compatibility: the unmodified renderer consumes both projected documents cleanly', () => {
  for (const level of ['hld', 'lld']) {
    const result = projectArchitecture(hierarchicalFixture(), level);
    const inputPath = path.join(tmp, `render-check.${level}.architecture.json`);
    const outputPath = path.join(tmp, `render-check.${level}.html`);
    fs.writeFileSync(inputPath, JSON.stringify(result.document, null, 2));
    assert.doesNotThrow(() => execFileSync(process.execPath, [renderer, inputPath, outputPath], { stdio: 'pipe' }));
    assert.ok(fs.existsSync(outputPath));
  }
});

// ---------------------------------------------------------------------------
// CLI: toolsmith project architecture <input.json> <hld|lld> [output.json]

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: skillRoot, encoding: 'utf8' });
}

test('CLI: archify project produces a valid, deterministic HLD projection and writes it', () => {
  const output = path.join(tmp, 'cli-hld.architecture.json');
  const result = run(['project', 'architecture', 'examples/hld-lld-projection.architecture.json', 'hld', output, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.level, 'hld');
  assert.deepEqual(payload.changedIds.droppedComponents, [
    'uploadApi', 'objectStore', 'processingQueue', 'processingWorker', 'documentDb',
  ]);
  assert.ok(fs.existsSync(output));
  const written = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.deepEqual(written.components.map((c) => c.id), ['webApp', 'docProcessing']);
});

test('CLI: archify project produces a valid LLD projection', () => {
  const output = path.join(tmp, 'cli-lld.architecture.json');
  const result = run(['project', 'architecture', 'examples/hld-lld-projection.architecture.json', 'lld', output, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const written = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.ok(!written.components.some((c) => c.id === 'docProcessing'));
});

test('CLI: archify project without an output path does not write a file, only reports', () => {
  const result = run(['project', 'architecture', 'examples/hld-lld-projection.architecture.json', 'hld']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ok hld projection/);
});

test('CLI: archify project rejects an unknown level', () => {
  const result = run(['project', 'architecture', 'examples/hld-lld-projection.architecture.json', 'mid']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage: toolsmith project architecture/);
});

test('CLI: archify project rejects a cyclic source with a diagnostic, same as validate', () => {
  const input = path.join(tmp, 'cyclic.architecture.json');
  fs.writeFileSync(input, JSON.stringify({
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 't' },
    components: [
      { id: 'a', type: 'backend', label: 'A', pos: [0, 0], size: [100, 50], children: ['b'] },
      { id: 'b', type: 'backend', label: 'B', pos: [200, 0], size: [100, 50], children: ['a'] },
    ],
  }));
  const result = run(['project', 'architecture', input, 'hld', '--json']);
  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.stage, 'source');
});

test('CLI: archify project does not change validate/deliver/render default behavior', () => {
  // The bundled hierarchical example must still validate and deliver via the
  // ordinary, unrelated commands exactly as before this feature existed.
  const validateResult = run(['validate', 'architecture', 'examples/hld-lld-projection.architecture.json', '--quality', 'showcase', '--json']);
  assert.equal(validateResult.status, 0, validateResult.stderr);
  assert.equal(JSON.parse(validateResult.stdout).ok, true);

  const deliverOutput = path.join(tmp, 'deliver-check.html');
  const deliverResult = run(['deliver', 'architecture', 'examples/hld-lld-projection.architecture.json', deliverOutput, '--json']);
  assert.equal(deliverResult.status, 0, deliverResult.stderr);
  assert.equal(JSON.parse(deliverResult.stdout).ok, true);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
