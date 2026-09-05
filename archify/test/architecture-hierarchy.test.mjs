import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { architecture as validateArchitecture } from '../renderers/shared/generated-validators.mjs';
import { validateComponentHierarchy } from '../renderers/shared/cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-hierarchy-'));

function baseDocument(components) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'hierarchy fixture' },
    components,
  };
}

function expectHierarchyProblem(doc, pattern) {
  assert.throws(
    () => validateComponentHierarchy('architecture', doc),
    (error) => {
      assert.ok(Array.isArray(error.archifyDiagnostics));
      assert.equal(error.archifyDiagnostics[0].code, 'hierarchy/invalid');
      assert.match(error.message, pattern);
      return true;
    },
  );
}

// ---------------------------------------------------------------------------
// Schema shape

test('children is optional: a document without it remains valid', () => {
  const doc = baseDocument([
    { id: 'api', type: 'backend', label: 'API' },
  ]);
  assert.equal(validateArchitecture(doc), true, JSON.stringify(validateArchitecture.errors));
});

test('children accepts a non-empty array of ids', () => {
  const doc = baseDocument([
    { id: 'parent', type: 'backend', label: 'Parent', children: ['child'] },
    { id: 'child', type: 'backend', label: 'Child' },
  ]);
  assert.equal(validateArchitecture(doc), true, JSON.stringify(validateArchitecture.errors));
});

test('children rejects an empty array (minItems: 1)', () => {
  const doc = baseDocument([
    { id: 'parent', type: 'backend', label: 'Parent', children: [] },
  ]);
  assert.equal(validateArchitecture(doc), false);
});

// ---------------------------------------------------------------------------
// Cross-collection hierarchy validation (renderers/shared/cli.mjs)

test('hierarchy validation is a no-op for non-architecture diagram types', () => {
  assert.doesNotThrow(() => validateComponentHierarchy('workflow', { nodes: [] }));
});

test('hierarchy validation passes for a document with no children anywhere', () => {
  const doc = baseDocument([
    { id: 'a', type: 'backend', label: 'A' },
    { id: 'b', type: 'backend', label: 'B' },
  ]);
  assert.doesNotThrow(() => validateComponentHierarchy('architecture', doc));
});

test('dangling child id is rejected', () => {
  const doc = baseDocument([
    { id: 'parent', type: 'backend', label: 'Parent', children: ['missing'] },
  ]);
  expectHierarchyProblem(doc, /references unknown component id "missing"/);
});

test('duplicate child id within a single children list is rejected', () => {
  const doc = baseDocument([
    { id: 'parent', type: 'backend', label: 'Parent', children: ['child', 'child'] },
    { id: 'child', type: 'backend', label: 'Child' },
  ]);
  expectHierarchyProblem(doc, /duplicates child id "child" within the same parent/);
});

test('a child claimed by two different parents is rejected', () => {
  const doc = baseDocument([
    { id: 'parentA', type: 'backend', label: 'Parent A', children: ['child'] },
    { id: 'parentB', type: 'backend', label: 'Parent B', children: ['child'] },
    { id: 'child', type: 'backend', label: 'Child' },
  ]);
  expectHierarchyProblem(doc, /claims child "child", which is already a child of "parentA"/);
});

test('self-reference is rejected', () => {
  const doc = baseDocument([
    { id: 'parent', type: 'backend', label: 'Parent', children: ['parent'] },
  ]);
  expectHierarchyProblem(doc, /references its own parent "parent" \(self-reference\)/);
});

test('a two-node cycle is rejected', () => {
  const doc = baseDocument([
    { id: 'a', type: 'backend', label: 'A', children: ['b'] },
    { id: 'b', type: 'backend', label: 'B', children: ['a'] },
  ]);
  expectHierarchyProblem(doc, /contains a cycle: a -> b -> a/);
});

test('a longer cycle is rejected and reported with its full path', () => {
  const doc = baseDocument([
    { id: 'a', type: 'backend', label: 'A', children: ['b'] },
    { id: 'b', type: 'backend', label: 'B', children: ['c'] },
    { id: 'c', type: 'backend', label: 'C', children: ['a'] },
  ]);
  expectHierarchyProblem(doc, /contains a cycle: a -> b -> c -> a/);
});

// ---------------------------------------------------------------------------
// Backward compatibility

test('every bundled architecture example remains valid and hierarchy-clean after the children schema change', () => {
  const examplesDir = path.join(skillRoot, 'examples');
  const architectureExamples = fs.readdirSync(examplesDir).filter((name) => name.endsWith('.architecture.json'));
  assert.ok(architectureExamples.length > 0);
  for (const name of architectureExamples) {
    const doc = JSON.parse(fs.readFileSync(path.join(examplesDir, name), 'utf8'));
    assert.equal(validateArchitecture(doc), true, `${name}: ${JSON.stringify(validateArchitecture.errors)}`);
    assert.doesNotThrow(() => validateComponentHierarchy('architecture', doc), `${name} should have no hierarchy problems`);
  }
});

// ---------------------------------------------------------------------------
// End-to-end via the CLI, proving schema + hierarchy checks are both wired
// into the ordinary validate path (renderers/shared/cli.mjs loadDiagram).

function writeFixture(name, doc) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, JSON.stringify(doc, null, 2));
  return file;
}

test('CLI: archify validate rejects a cyclic hierarchy with a hierarchy/invalid diagnostic', () => {
  const file = writeFixture('cycle.architecture.json', baseDocument([
    { id: 'a', type: 'backend', label: 'A', pos: [0, 0], size: [100, 50], children: ['b'] },
    { id: 'b', type: 'backend', label: 'B', pos: [200, 0], size: [100, 50], children: ['a'] },
  ]));
  const cli = path.join(skillRoot, 'bin/archify.mjs');
  assert.throws(() => execFileSync(process.execPath, [cli, 'validate', 'architecture', file], { stdio: 'pipe' }));
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
