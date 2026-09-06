import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { personaVisualToken } from '../renderers/funnel/persona-focus.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const renderer = path.join(skillRoot, 'renderers/funnel/render-funnel.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-persona-identity-'));
let sequence = 0;

function renderDoc(doc) {
  const id = (sequence += 1);
  const inputPath = path.join(tmp, `doc-${id}.funnel.json`);
  const outputPath = path.join(tmp, `doc-${id}.html`);
  fs.writeFileSync(inputPath, JSON.stringify(doc));
  execFileSync('node', [renderer, inputPath, outputPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  return fs.readFileSync(outputPath, 'utf8');
}

// ---------------------------------------------------------------------------
// Deterministic identity (pure function)

test('personaVisualToken is deterministic: the same id always yields the same token', () => {
  const a = personaVisualToken('newCustomer');
  const b = personaVisualToken('newCustomer');
  assert.equal(a, b);
});

test('personaVisualToken only ever returns one of the seven existing brand stroke tokens', () => {
  const allowed = new Set([
    '--frontend-stroke', '--backend-stroke', '--database-stroke', '--cloud-stroke',
    '--security-stroke', '--messagebus-stroke', '--external-stroke',
  ]);
  for (const id of ['a', 'b', 'newCustomer', 'returningCustomer', 'vip', 'x', 'y', 'z']) {
    assert.ok(allowed.has(personaVisualToken(id)), `unexpected token for ${id}`);
  }
});

test('personaVisualToken never mutates or reads anything beyond its argument (pure)', () => {
  const id = { toString: () => 'frozen-id' };
  Object.freeze(id);
  assert.doesNotThrow(() => personaVisualToken(id));
});

// ---------------------------------------------------------------------------
// Coherent identity across Persona Lens and Explore

function docWithPersonas() {
  return {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'persona identity fixture' },
    personas: [
      { id: 'newCustomer', label: 'New Customer' },
      { id: 'vip', label: 'VIP' },
    ],
    stages: [
      { id: 'a', label: 'A', personas: ['newCustomer', 'vip'] },
      { id: 'b', label: 'B' },
    ],
    transitions: [{ id: 't1', from: 'a', to: 'b' }],
  };
}

test('the same Persona shows the same swatch token in the Persona Lens button and in Explore', () => {
  const html = renderDoc(docWithPersonas());
  const buttonMatch = html.match(/data-persona-button="newCustomer"[^>]*>\s*<span class="funnel-persona-swatch"[^>]*style="background-color:var\((--[a-z-]+)\)"/);
  assert.ok(buttonMatch, 'expected a swatch on the Persona Lens button');
  const detailRaw = html.match(/data-node-detail-groups="([^"]*)"/)[1].replace(/&quot;/g, '"');
  const groups = JSON.parse(detailRaw);
  const personasGroup = groups.find((g) => g.title === 'Personas');
  const item = personasGroup.items.find((entry) => entry.text === 'New Customer');
  assert.equal(item.swatch, buttonMatch[1]);
  assert.equal(item.swatch, personaVisualToken('newCustomer'));
});

test('two different Personas on the same Stage do not necessarily collide, and identity is not color-only (label text always present)', () => {
  const html = renderDoc(docWithPersonas());
  const detailRaw = html.match(/data-node-detail-groups="([^"]*)"/)[1].replace(/&quot;/g, '"');
  const groups = JSON.parse(detailRaw);
  const personasGroup = groups.find((g) => g.title === 'Personas');
  assert.deepEqual(personasGroup.items.map((item) => item.text).sort(), ['New Customer', 'VIP']);
  personasGroup.items.forEach((item) => assert.ok(item.text && item.text.length > 0));
});

test('the swatch dot is decorative (aria-hidden) — text remains the sole accessible identifier', () => {
  const html = renderDoc(docWithPersonas());
  assert.match(html, /class="funnel-persona-swatch" aria-hidden="true"/);
  assert.match(html, /swatchEl\.setAttribute\('aria-hidden', 'true'\)/);
});

test('rendering the same document twice produces the same swatch assignment (determinism end to end)', () => {
  const doc = docWithPersonas();
  const first = renderDoc(doc);
  const second = renderDoc(doc);
  assert.equal(first, second);
});

test('a document with no personas renders no swatch markup at all', () => {
  const doc = {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'no personas' },
    stages: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    transitions: [{ id: 't1', from: 'a', to: 'b' }],
  };
  const html = renderDoc(doc);
  assert.doesNotMatch(html, /funnel-persona-swatch/);
  // The generic .semantic-passport-detail-swatch CSS class is always present
  // in the shared template (same dormant-until-populated pattern as Phase
  // 15's detail-tag CSS) — what must be absent is any actual swatch value.
  assert.doesNotMatch(html, /"swatch":/);
});
