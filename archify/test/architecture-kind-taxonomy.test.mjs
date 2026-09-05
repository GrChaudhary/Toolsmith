import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { architecture as validateArchitecture } from '../renderers/shared/generated-validators.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');

function baseArchitectureDocument() {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'kind taxonomy fixture' },
    components: [
      { id: 'api', type: 'backend', label: 'API' },
      { id: 'store', type: 'database', label: 'Store' },
    ],
  };
}

test('kind is optional: an architecture document without kind remains valid', () => {
  const doc = baseArchitectureDocument();
  assert.equal(validateArchitecture(doc), true, JSON.stringify(validateArchitecture.errors));
});

test('kind accepts each of the three pilot values', () => {
  for (const kind of ['queue', 'cache', 'identity-provider']) {
    const doc = baseArchitectureDocument();
    doc.components[1].kind = kind;
    assert.equal(validateArchitecture(doc), true, `${kind}: ${JSON.stringify(validateArchitecture.errors)}`);
  }
});

test('kind rejects a value outside the pilot vocabulary', () => {
  const doc = baseArchitectureDocument();
  doc.components[1].kind = 'kafka-topic';
  assert.equal(validateArchitecture(doc), false);
  assert.deepEqual(
    validateArchitecture.errors?.[0]?.params.allowedValues,
    ['queue', 'cache', 'identity-provider'],
  );
});

test('kind coexists with componentType: any type may carry any pilot kind at the schema level', () => {
  const doc = baseArchitectureDocument();
  // Schema validation does not enforce the conventional kind/type pairing —
  // that is an informational review concern (see architecture-review.test.mjs),
  // never a validation constraint.
  doc.components[0].type = 'backend';
  doc.components[0].kind = 'queue';
  assert.equal(validateArchitecture(doc), true, JSON.stringify(validateArchitecture.errors));
});

test('existing bundled architecture examples remain valid after the kind schema change', () => {
  const examplesDir = path.join(skillRoot, 'examples');
  const architectureExamples = fs.readdirSync(examplesDir)
    .filter((name) => name.endsWith('.architecture.json'));
  assert.ok(architectureExamples.length > 0, 'expected at least one bundled architecture example');
  for (const name of architectureExamples) {
    const doc = JSON.parse(fs.readFileSync(path.join(examplesDir, name), 'utf8'));
    assert.equal(validateArchitecture(doc), true, `${name}: ${JSON.stringify(validateArchitecture.errors)}`);
  }
});

test('the new enterprise-pilot example demonstrates kind alongside untouched componentType usage', () => {
  const doc = JSON.parse(fs.readFileSync(
    path.join(skillRoot, 'examples', 'enterprise-pilot.architecture.json'),
    'utf8',
  ));
  assert.equal(validateArchitecture(doc), true, JSON.stringify(validateArchitecture.errors));
  const byId = Object.fromEntries(doc.components.map((component) => [component.id, component]));
  assert.equal(byId.authProvider.kind, 'identity-provider');
  assert.equal(byId.authProvider.type, 'security');
  assert.equal(byId.sessionCache.kind, 'cache');
  assert.equal(byId.sessionCache.type, 'database');
  assert.equal(byId.notifyQueue.kind, 'queue');
  assert.equal(byId.notifyQueue.type, 'messagebus');
  // api/db/users demonstrate that existing componentType-only usage needs no change.
  assert.equal('kind' in byId.api, false);
  assert.equal('kind' in byId.db, false);
  assert.equal('kind' in byId.users, false);
});
