import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveStageDetailGroups } from '../renderers/funnel/explore-detail.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const renderer = path.join(skillRoot, 'renderers/funnel/render-funnel.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-funnel-explore-visual-detail-'));
let sequence = 0;

function renderDoc(doc) {
  const id = (sequence += 1);
  const inputPath = path.join(tmp, `doc-${id}.funnel.json`);
  const outputPath = path.join(tmp, `doc-${id}.html`);
  fs.writeFileSync(inputPath, JSON.stringify(doc));
  execFileSync('node', [renderer, inputPath, outputPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  return fs.readFileSync(outputPath, 'utf8');
}

function svgOf(html) {
  const match = html.match(/<svg[\s\S]*?<\/svg>/);
  assert.ok(match, 'rendered output must contain one <svg>');
  return match[0];
}

function groupsFor(svg, nodeId) {
  const nodeMarkup = svg.match(new RegExp(`<g id="node-${nodeId}"[^>]*>`))[0];
  const raw = nodeMarkup.match(/data-node-detail-groups="([^"]*)"/);
  return raw ? JSON.parse(raw[1].replace(/&quot;/g, '"')) : [];
}

function baseDoc(overrides = {}) {
  return {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'explore visual detail fixture' },
    touchpoints: [
      { id: 'web', type: 'web', label: 'Storefront website' },
      { id: 'email', type: 'email', label: 'Confirmation email' },
    ],
    stages: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
    actions: [
      { id: 'required', stage: 'a', label: 'Required action', touchpoint: 'web' },
      { id: 'opt', stage: 'a', label: 'Optional action', touchpoint: 'email', optional: true },
    ],
    transitions: [{ id: 't1', from: 'a', to: 'b' }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1/2/3. Required action (omitted or false) stays a plain string, unchanged

test('an Action with optional omitted is a plain string item with no tag', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  const groups = groupsFor(svg, 'a');
  const actions = groups.find((g) => g.title === 'Actions').items;
  const required = actions.find((item) => (typeof item === 'string' ? item : item.text).startsWith('Required action'));
  assert.equal(typeof required, 'string');
});

test('an Action with optional: false behaves identically to omitted', () => {
  const doc = baseDoc();
  doc.actions[0].optional = false;
  const svg = svgOf(renderDoc(doc));
  const groups = groupsFor(svg, 'a');
  const actions = groups.find((g) => g.title === 'Actions').items;
  const required = actions.find((item) => (typeof item === 'string' ? item : item.text).startsWith('Required action'));
  assert.equal(typeof required, 'string');
});

// ---------------------------------------------------------------------------
// 4/5/6. Optional Action receives distinct, non-error presentation

test('an Action with optional: true receives a {text, tag} item distinguishable from a plain string', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  const groups = groupsFor(svg, 'a');
  const actions = groups.find((g) => g.title === 'Actions').items;
  const optional = actions.find((item) => typeof item === 'object' && item.text.startsWith('Optional action'));
  assert.ok(optional, 'expected an object-shaped item for the optional Action');
  assert.equal(optional.tag, 'Optional');
});

test('the optional tag text is neutral ("Optional"), not an error/failure/warning word', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  const groups = groupsFor(svg, 'a');
  const actions = groups.find((g) => g.title === 'Actions').items;
  const optional = actions.find((item) => typeof item === 'object');
  assert.equal(optional.tag, 'Optional');
  assert.doesNotMatch(optional.tag.toLowerCase(), /error|fail|warn|invalid|deprecated/);
});

// ---------------------------------------------------------------------------
// 7/8. Optional indicator does not alter Action identity or label text

test('the Action label text itself is unchanged by optionality (no inline "(optional)" suffix baked into the text)', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  const groups = groupsFor(svg, 'a');
  const actions = groups.find((g) => g.title === 'Actions').items;
  const optional = actions.find((item) => typeof item === 'object');
  assert.equal(optional.text, 'Optional action — Confirmation email');
  assert.doesNotMatch(optional.text, /\(optional\)/);
});

// ---------------------------------------------------------------------------
// 9/10. Touchpoint type is surfaced, using the actual schema enum

test('every Touchpoint item carries its type as a tag, using the actual funnel.schema.json enum values', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  const groups = groupsFor(svg, 'a');
  const touchpoints = groups.find((g) => g.title === 'Touchpoints').items;
  const web = touchpoints.find((item) => item.text === 'Storefront website');
  const email = touchpoints.find((item) => item.text === 'Confirmation email');
  assert.equal(web.tag, 'Web');
  assert.equal(email.tag, 'Email');
});

test('all eight funnel.schema.json Touchpoint.type enum values humanize to a compact, readable tag', () => {
  const types = ['web', 'mobile-app', 'email', 'phone', 'in-person', 'notification', 'partner', 'other'];
  const doc = {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'all touchpoint types' },
    touchpoints: types.map((type, i) => ({ id: `tp${i}`, type, label: `Touchpoint ${i}` })),
    stages: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    actions: types.map((type, i) => ({ id: `act${i}`, stage: 'a', label: `Action ${i}`, touchpoint: `tp${i}` })),
    transitions: [{ id: 't1', from: 'a', to: 'b' }],
  };
  const svg = svgOf(renderDoc(doc));
  const groups = groupsFor(svg, 'a');
  const touchpoints = groups.find((g) => g.title === 'Touchpoints').items;
  const tags = touchpoints.map((item) => item.tag);
  assert.deepEqual(tags, ['Web', 'Mobile App', 'Email', 'Phone', 'In Person', 'Notification', 'Partner', 'Other']);
});

// ---------------------------------------------------------------------------
// 11. Unknown Touchpoint type is still rejected by schema validation
// (Phase 15 must not have loosened funnel.schema.json)

test('an unknown Touchpoint.type is still rejected by schema validation', () => {
  const doc = baseDoc();
  doc.touchpoints[0].type = 'carrier-pigeon';
  const id = (sequence += 1);
  const inputPath = path.join(tmp, `invalid-${id}.funnel.json`);
  fs.writeFileSync(inputPath, JSON.stringify(doc));
  assert.throws(() => execFileSync('node', [renderer, inputPath, path.join(tmp, `invalid-${id}.html`)], { stdio: 'pipe' }));
});

// ---------------------------------------------------------------------------
// 12/13. Touchpoint label/identity unchanged

test('Touchpoint label and identity (referenced by id) are unaffected by the new tag presentation', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  const groups = groupsFor(svg, 'a');
  const touchpoints = groups.find((g) => g.title === 'Touchpoints').items;
  assert.deepEqual(touchpoints.map((item) => item.text).sort(), ['Confirmation email', 'Storefront website']);
});

// ---------------------------------------------------------------------------
// 14/15. Actions/Touchpoints remain detail entities, not graph nodes

test('Actions and Touchpoints still do not become separate Overview graph nodes', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  assert.equal([...svg.matchAll(/<g [^>]*data-node-id=/g)].length, 2);
  assert.doesNotMatch(svg, /data-node-id="required"/);
  assert.doesNotMatch(svg, /data-node-id="web"/);
});

// ---------------------------------------------------------------------------
// 16/17. Action -> Stage and Action -> Touchpoint relationships unchanged

test('Action -> Stage and Action -> Touchpoint relationships are unchanged (same resolved text content)', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  const groupsA = groupsFor(svg, 'a');
  const groupsB = groupsFor(svg, 'b');
  assert.ok(groupsA.find((g) => g.title === 'Actions'));
  // 'b' has no Actions/Touchpoints of its own — only a Transitions group
  // (Phase 16), since a transition touches it.
  assert.deepEqual(groupsB.map((g) => g.title), ['Transitions']);
});

// ---------------------------------------------------------------------------
// 18/19/20/21/22. Existing detail groups remain intact (Decision/Personas/Friction/Outcome via kind)

test('Decision, Personas, and Friction groups remain present and unaffected where applicable', () => {
  const doc = baseDoc({
    personas: [{ id: 'p1', label: 'P1' }],
    stages: [
      { id: 'a', label: 'A', decision: 'Proceed?', personas: ['p1'], friction: 'Some friction', outcome: 'conversion' },
      { id: 'b', label: 'B' },
    ],
  });
  const svg = svgOf(renderDoc(doc));
  const groups = groupsFor(svg, 'a');
  assert.deepEqual(groups.map((g) => g.title), ['Decision', 'Actions', 'Touchpoints', 'Personas', 'Transitions', 'Friction']);
  const nodeMarkup = svg.match(/<g id="node-a"[^>]*>/)[0];
  assert.match(nodeMarkup, /data-node-kind="conversion"/);
});

// ---------------------------------------------------------------------------
// 23/24. Conversion/dropoff Stage detail still works with the new item shape

test('a conversion Stage still exposes correctly-shaped Actions/Touchpoints detail', () => {
  const doc = baseDoc({ stages: [{ id: 'a', label: 'A', outcome: 'conversion' }, { id: 'b', label: 'B' }] });
  const svg = svgOf(renderDoc(doc));
  const groups = groupsFor(svg, 'a');
  const optional = groups.find((g) => g.title === 'Actions').items.find((item) => typeof item === 'object');
  assert.equal(optional.tag, 'Optional');
});

test('a dropoff Stage still exposes correctly-shaped Actions/Touchpoints detail', () => {
  const doc = baseDoc({ stages: [{ id: 'a', label: 'A', outcome: 'dropoff' }, { id: 'b', label: 'B' }] });
  const svg = svgOf(renderDoc(doc));
  const groups = groupsFor(svg, 'a');
  const touchpoints = groups.find((g) => g.title === 'Touchpoints').items;
  assert.equal(touchpoints.length, 2);
});

// ---------------------------------------------------------------------------
// 25. Primary/alternative/loop transitions remain unaffected by detail changes

test('transitions with primary/alternative/loop roles render unaffected alongside the new detail item shape', () => {
  const doc = baseDoc({
    transitions: [
      { id: 't1', from: 'a', to: 'b', role: 'alternative' },
      { id: 't2', from: 'b', to: 'a', role: 'loop' },
    ],
  });
  const svg = svgOf(renderDoc(doc));
  assert.match(svg, /data-edge-role="alternative"[^>]*class="a-dashed"/);
  assert.match(svg, /data-edge-role="loop"[^>]*class="a-emphasis"/);
});

// ---------------------------------------------------------------------------
// 26/27/28. Persona Lens compatibility

test('Persona Lens remains functional alongside the new Actions/Touchpoints detail shape', () => {
  const doc = baseDoc({ personas: [{ id: 'p1', label: 'P1' }], stages: [{ id: 'a', label: 'A', personas: ['p1'] }, { id: 'b', label: 'B' }] });
  const html = renderDoc(doc);
  assert.match(html, /id="funnel-persona-lens"/);
  assert.match(html, /function selectPersona\(personaId, label\)/);
});

test('optional Action and Touchpoint type detail remain correctly derived for a Persona-restricted Stage', () => {
  const doc = baseDoc({ personas: [{ id: 'p1', label: 'P1' }], stages: [{ id: 'a', label: 'A', personas: ['p1'] }, { id: 'b', label: 'B' }] });
  const svg = svgOf(renderDoc(doc));
  const groups = groupsFor(svg, 'a');
  const optional = groups.find((g) => g.title === 'Actions').items.find((item) => typeof item === 'object');
  const touchpoints = groups.find((g) => g.title === 'Touchpoints').items;
  assert.equal(optional.tag, 'Optional');
  assert.ok(touchpoints.every((item) => typeof item.tag === 'string' && item.tag.length > 0));
});

// ---------------------------------------------------------------------------
// 29/30. Determinism and source immutability

test('rendering the same document twice produces byte-identical output', () => {
  const doc = baseDoc();
  assert.equal(renderDoc(doc), renderDoc(doc));
});

test('deriveStageDetailGroups does not mutate the source document', () => {
  const doc = baseDoc();
  const before = JSON.stringify(doc);
  deriveStageDetailGroups(doc, 'a', 'en');
  assert.equal(JSON.stringify(doc), before);
});

test('rendering does not mutate the source JSON document on disk', () => {
  const doc = baseDoc();
  const id = (sequence += 1);
  const inputPath = path.join(tmp, `immutability-${id}.funnel.json`);
  const originalText = JSON.stringify(doc, null, 2);
  fs.writeFileSync(inputPath, originalText);
  execFileSync('node', [renderer, inputPath, path.join(tmp, `immutability-${id}.html`)], { stdio: ['ignore', 'ignore', 'pipe'] });
  assert.equal(fs.readFileSync(inputPath, 'utf8'), originalText);
});

// ---------------------------------------------------------------------------
// The bundled first-purchase example exercises both features end to end

test('the bundled first-purchase funnel example renders optional Action tags and Touchpoint type tags', () => {
  const outputPath = path.join(tmp, 'first-purchase.html');
  execFileSync('node', [
    renderer,
    path.join(skillRoot, 'examples/first-purchase.funnel.json'),
    outputPath,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const svg = svgOf(fs.readFileSync(outputPath, 'utf8'));
  const confirmedGroups = groupsFor(svg, 'confirmed');
  const optional = confirmedGroups.find((g) => g.title === 'Actions').items.find((item) => typeof item === 'object');
  assert.equal(optional.tag, 'Optional');
  const touchpoints = confirmedGroups.find((g) => g.title === 'Touchpoints').items;
  assert.equal(touchpoints[0].tag, 'Email');
});
