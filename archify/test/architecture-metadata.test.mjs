import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { architecture as validateArchitecture } from '../renderers/shared/generated-validators.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-metadata-'));

function baseArchitectureDocument() {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'enterprise metadata fixture' },
    components: [
      { id: 'api', type: 'backend', label: 'API' },
      { id: 'store', type: 'database', label: 'Store' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Schema shape: each of the four layers is independently optional, rejects
// unknown sub-properties, and rejects an authored-but-empty object.

test('technology/security/ownership/deployment are optional: a document without them remains valid', () => {
  const doc = baseArchitectureDocument();
  assert.equal(validateArchitecture(doc), true, JSON.stringify(validateArchitecture.errors));
});

test('technology accepts name and vendor, rejects unknown sub-properties', () => {
  const doc = baseArchitectureDocument();
  doc.components[1].technology = { name: 'Redis', vendor: 'Redis Ltd.' };
  assert.equal(validateArchitecture(doc), true, JSON.stringify(validateArchitecture.errors));

  const invalid = baseArchitectureDocument();
  invalid.components[1].technology = { name: 'Redis', version: '7.2' };
  assert.equal(validateArchitecture(invalid), false);
});

test('security accepts auth_method, rejects unknown sub-properties', () => {
  const doc = baseArchitectureDocument();
  doc.components[0].security = { auth_method: 'OAuth2.0' };
  assert.equal(validateArchitecture(doc), true, JSON.stringify(validateArchitecture.errors));

  const invalid = baseArchitectureDocument();
  invalid.components[0].security = { auth_method: 'OAuth2.0', data_classification: 'restricted' };
  assert.equal(validateArchitecture(invalid), false);
});

test('ownership accepts team and status, status is limited to active/deprecated/planned', () => {
  const doc = baseArchitectureDocument();
  doc.components[0].ownership = { team: 'platform-messaging', status: 'active' };
  assert.equal(validateArchitecture(doc), true, JSON.stringify(validateArchitecture.errors));

  const invalid = baseArchitectureDocument();
  invalid.components[0].ownership = { status: 'retired' };
  assert.equal(validateArchitecture(invalid), false);
});

test('deployment accepts provider, rejects unknown sub-properties (environment is not part of this phase)', () => {
  const doc = baseArchitectureDocument();
  doc.components[1].deployment = { provider: 'AWS' };
  assert.equal(validateArchitecture(doc), true, JSON.stringify(validateArchitecture.errors));

  const invalid = baseArchitectureDocument();
  invalid.components[1].deployment = { provider: 'AWS', environment: 'production' };
  assert.equal(validateArchitecture(invalid), false);
});

test('each metadata object rejects an authored-but-empty value (minProperties: 1)', () => {
  for (const field of ['technology', 'security', 'ownership', 'deployment']) {
    const doc = baseArchitectureDocument();
    doc.components[0][field] = {};
    assert.equal(validateArchitecture(doc), false, `${field}: empty object should be rejected`);
  }
});

test('kind and componentType coexistence from Phase 1 is unaffected by the new metadata fields', () => {
  const doc = baseArchitectureDocument();
  doc.components[1].type = 'database';
  doc.components[1].kind = 'cache';
  doc.components[1].technology = { name: 'Redis' };
  assert.equal(validateArchitecture(doc), true, JSON.stringify(validateArchitecture.errors));
});

// ---------------------------------------------------------------------------
// Backward compatibility: every bundled architecture example remains valid.

test('existing bundled architecture examples remain valid after the metadata schema change', () => {
  const examplesDir = path.join(skillRoot, 'examples');
  const architectureExamples = fs.readdirSync(examplesDir)
    .filter((name) => name.endsWith('.architecture.json'));
  assert.ok(architectureExamples.length > 0, 'expected at least one bundled architecture example');
  for (const name of architectureExamples) {
    const doc = JSON.parse(fs.readFileSync(path.join(examplesDir, name), 'utf8'));
    assert.equal(validateArchitecture(doc), true, `${name}: ${JSON.stringify(validateArchitecture.errors)}`);
  }
});

test('the enterprise-pilot example demonstrates all four approved metadata fields', () => {
  const doc = JSON.parse(fs.readFileSync(
    path.join(skillRoot, 'examples', 'enterprise-pilot.architecture.json'),
    'utf8',
  ));
  assert.equal(validateArchitecture(doc), true, JSON.stringify(validateArchitecture.errors));
  const byId = Object.fromEntries(doc.components.map((component) => [component.id, component]));
  assert.deepEqual(byId.authProvider.security, { auth_method: 'OAuth2.0' });
  assert.deepEqual(byId.sessionCache.technology, { name: 'Redis', vendor: 'Redis Ltd.' });
  assert.deepEqual(byId.notifyQueue.ownership, { team: 'platform-messaging', status: 'active' });
  assert.deepEqual(byId.db.deployment, { provider: 'AWS' });
  // api/users demonstrate that omitting all enterprise metadata remains valid.
  for (const field of ['technology', 'security', 'ownership', 'deployment']) {
    assert.equal(field in byId.api, false);
    assert.equal(field in byId.users, false);
  }
});

// ---------------------------------------------------------------------------
// Mandatory rendering-neutrality check: the enterprise-pilot example rendered
// with its Phase 2 metadata must produce byte-identical HTML to the same
// document with that metadata stripped. No renderer may read these fields.

test('rendering neutrality: Phase 2 metadata produces byte-identical HTML to the same document without it', () => {
  const withMetadataInput = path.join(skillRoot, 'examples', 'enterprise-pilot.architecture.json');
  const doc = JSON.parse(fs.readFileSync(withMetadataInput, 'utf8'));

  const stripped = JSON.parse(JSON.stringify(doc));
  for (const component of stripped.components) {
    delete component.technology;
    delete component.security;
    delete component.ownership;
    delete component.deployment;
  }
  const strippedInput = path.join(tmp, 'enterprise-pilot.stripped.architecture.json');
  fs.writeFileSync(strippedInput, JSON.stringify(stripped, null, 2));

  const withMetadataOutput = path.join(tmp, 'with-metadata.html');
  const withoutMetadataOutput = path.join(tmp, 'without-metadata.html');
  const renderer = path.join(skillRoot, 'renderers/architecture/render-architecture.mjs');

  execFileSync(process.execPath, [renderer, withMetadataInput, withMetadataOutput], { stdio: 'pipe' });
  execFileSync(process.execPath, [renderer, strippedInput, withoutMetadataOutput], { stdio: 'pipe' });

  const withMetadataHtml = fs.readFileSync(withMetadataOutput);
  const withoutMetadataHtml = fs.readFileSync(withoutMetadataOutput);
  assert.ok(
    withMetadataHtml.equals(withoutMetadataHtml),
    'Phase 2 metadata fields must be completely rendering-neutral: the renderer must not read technology/security/ownership/deployment',
  );
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
