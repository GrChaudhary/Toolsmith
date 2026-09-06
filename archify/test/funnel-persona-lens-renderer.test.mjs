import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const renderer = path.join(skillRoot, 'renderers/funnel/render-funnel.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-funnel-persona-lens-'));
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

function docWithPersonas(overrides = {}) {
  return {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'persona lens fixture' },
    personas: [
      { id: 'newCustomer', label: 'New Customer' },
      { id: 'returningCustomer', label: 'Returning Customer' },
    ],
    stages: [
      { id: 'discovery', label: 'Discovery', personas: ['newCustomer'] },
      { id: 'browse', label: 'Browse' },
      { id: 'loyalty', label: 'Loyalty Perks', personas: ['returningCustomer'] },
    ],
    transitions: [
      { id: 't1', from: 'discovery', to: 'browse' },
      { id: 't2', from: 'browse', to: 'loyalty' },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Opt-in only when personas exist (mirrors Phase 11's detail-groups pattern)

test('a document with no personas renders no Persona Lens markup at all', () => {
  const doc = {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'no personas' },
    stages: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    transitions: [{ id: 't1', from: 'a', to: 'b' }],
  };
  const html = renderDoc(doc);
  assert.doesNotMatch(html, /funnel-persona-lens/);
  assert.doesNotMatch(html, /data-node-personas/);
});

test('a document with personas renders the Persona Lens control, one button per Persona', () => {
  const html = renderDoc(docWithPersonas());
  assert.match(html, /id="funnel-persona-lens"/);
  assert.match(html, /data-persona-button="newCustomer"[^>]*>[\s\S]*?New Customer</);
  assert.match(html, /data-persona-button="returningCustomer"[^>]*>[\s\S]*?Returning Customer</);
  assert.match(html, /id="funnel-persona-clear"[^>]* hidden>/);
});

// ---------------------------------------------------------------------------
// Stage applicability is reflected in data-node-personas (2/3/4/5)

test('a Stage with omitted personas carries no data-node-personas attribute (applies generally)', () => {
  const svg = svgOf(renderDoc(docWithPersonas()));
  const nodeMarkup = svg.match(/<g id="node-browse"[^>]*>/)[0];
  assert.doesNotMatch(nodeMarkup, /data-node-personas/);
});

test('a Stage restricted to one Persona carries exactly that id', () => {
  const svg = svgOf(renderDoc(docWithPersonas()));
  const nodeMarkup = svg.match(/<g id="node-discovery"[^>]*>/)[0];
  assert.match(nodeMarkup, /data-node-personas="newCustomer"/);
});

test('a Stage restricted to multiple Personas carries all of them as CSV, in authored order', () => {
  const doc = docWithPersonas();
  doc.stages[1].personas = ['newCustomer', 'returningCustomer'];
  const svg = svgOf(renderDoc(doc));
  const nodeMarkup = svg.match(/<g id="node-browse"[^>]*>/)[0];
  assert.match(nodeMarkup, /data-node-personas="newCustomer,returningCustomer"/);
});

// ---------------------------------------------------------------------------
// 13/14. No graph duplication, no lanes

test('Persona Lens does not duplicate Stage graph nodes, one per Stage regardless of Persona count', () => {
  const svg = svgOf(renderDoc(docWithPersonas()));
  assert.equal([...svg.matchAll(/<g [^>]*data-node-id=/g)].length, 3);
});

test('no lane/column markup is introduced for Personas', () => {
  const html = renderDoc(docWithPersonas());
  assert.doesNotMatch(html, /persona-lane/);
  assert.doesNotMatch(html, /class="c-lane"/);
});

// ---------------------------------------------------------------------------
// 11/12. Stable identity — rendering with personas present changes nothing
// about Stage/Transition identity compared to a personas-free render.

test('Stage ids and Transition endpoints are unaffected by Persona Lens presence', () => {
  const svg = svgOf(renderDoc(docWithPersonas()));
  assert.match(svg, /id="node-discovery"/);
  assert.match(svg, /data-node-id="discovery"/);
  assert.match(svg, /data-edge-from="discovery" data-edge-to="browse"/);
  assert.match(svg, /data-edge-from="browse" data-edge-to="loyalty"/);
});

// ---------------------------------------------------------------------------
// Embedded client-side logic mirrors isStageApplicableToPersona's rule and
// implements clear/exit (verified as literal source, the same convention
// test/semantic-passport.test.mjs already uses for embedded runtime code)

test('the embedded script applies the same omitted-personas-means-general-applicability rule', () => {
  const html = renderDoc(docWithPersonas());
  assert.match(html, /function isApplicable\(node, personaId\)/);
  assert.match(html, /if \(!raw\) return true;/);
});

test('the embedded script marks matching edges active only when both endpoints are applicable (no misleading active path)', () => {
  const html = renderDoc(docWithPersonas());
  assert.match(html, /if \(applicable\[from\] && applicable\[to\]\) edge\.setAttribute\('data-persona-match', ''\); else edge\.removeAttribute\('data-persona-match'\);/);
});

test('the embedded script provides a clear/exit function restoring normal Overview presentation', () => {
  const html = renderDoc(docWithPersonas());
  assert.match(html, /function clearPersona\(\)/);
  assert.match(html, /svg\.removeAttribute\('data-persona-active'\)/);
});

test('the Persona Lens\'s own script does not reuse the Architecture Semantic Lens attribute vocabulary (avoids state collision)', () => {
  // The shared template's own (unrelated, pre-existing, Architecture-facing)
  // Semantic Lens feature legitimately sets data-lens-active elsewhere on the
  // page — this test scopes the check to the Persona Lens's own <script>
  // block, not the whole document.
  const html = renderDoc(docWithPersonas());
  const personaLensScript = html.match(/id="funnel-persona-lens"[\s\S]*?<\/script>/)[0];
  assert.doesNotMatch(personaLensScript, /data-lens-active/);
  assert.match(personaLensScript, /svg\.setAttribute\('data-persona-active'/);
});

// ---------------------------------------------------------------------------
// Zero-applicable-explicit-stage edge case (Task 8/14, 28)

test('a status region exists to report when a selected Persona has zero applicable Stages, without crashing at render time', () => {
  const doc = docWithPersonas({
    personas: [
      { id: 'newCustomer', label: 'New Customer' },
      { id: 'vip', label: 'VIP' },
    ],
    stages: [
      { id: 'discovery', label: 'Discovery', personas: ['newCustomer'] },
      { id: 'loyalty', label: 'Loyalty Perks', personas: ['newCustomer'] },
    ],
    transitions: [{ id: 't1', from: 'discovery', to: 'loyalty' }],
  });
  assert.doesNotThrow(() => renderDoc(doc));
  const html = renderDoc(doc);
  assert.match(html, /id="funnel-persona-status"/);
  assert.match(html, /noStagesApplyTemplate/);
});

// ---------------------------------------------------------------------------
// Graph shape regression (23-27): branching/reconvergence/cycles still render
// with Persona Lens present

test('Persona Lens coexists with branching, reconvergence, and a loop transition', () => {
  const doc = docWithPersonas({
    stages: [
      { id: 'a', label: 'A', personas: ['newCustomer'] },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
      { id: 'd', label: 'D' },
    ],
    transitions: [
      { id: 't1', from: 'a', to: 'b' },
      { id: 't2', from: 'a', to: 'c' },
      { id: 't3', from: 'b', to: 'd' },
      { id: 't4', from: 'c', to: 'd' },
      { id: 't5', from: 'd', to: 'b', role: 'loop' },
    ],
  });
  const svg = svgOf(renderDoc(doc));
  for (const id of ['a', 'b', 'c', 'd']) assert.match(svg, new RegExp(`data-node-id="${id}"`));
  assert.equal([...svg.matchAll(/data-edge-from=/g)].length, 5);
});

// ---------------------------------------------------------------------------
// 32/33. Source immutability, and determinism

test('rendering with Persona Lens present does not mutate the source JSON file on disk', () => {
  const doc = docWithPersonas();
  const id = (sequence += 1);
  const inputPath = path.join(tmp, `immutability-${id}.funnel.json`);
  const originalText = JSON.stringify(doc, null, 2);
  fs.writeFileSync(inputPath, originalText);
  const outputPath = path.join(tmp, `immutability-${id}.html`);
  execFileSync('node', [renderer, inputPath, outputPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  assert.equal(fs.readFileSync(inputPath, 'utf8'), originalText);
});

test('rendering the same document twice produces identical Persona Lens output (determinism)', () => {
  const doc = docWithPersonas();
  const first = renderDoc(doc);
  const second = renderDoc(doc);
  assert.equal(first, second);
});

// ---------------------------------------------------------------------------
// Phase 11 Explore regression: a Stage's Explore detail (Passport groups)
// and its Persona Lens applicability data coexist independently — Persona
// selection is presentation state and never rewrites Explore's semantic
// projection (Tasks 9 and 29).

test('a Stage carries both data-node-detail-groups and data-node-personas when it has both, and neither is altered by the other', () => {
  const doc = docWithPersonas({
    stages: [
      { id: 'discovery', label: 'Discovery', personas: ['newCustomer'], decision: 'Look around?' },
      { id: 'browse', label: 'Browse' },
      { id: 'loyalty', label: 'Loyalty Perks', personas: ['returningCustomer'] },
    ],
  });
  const svg = svgOf(renderDoc(doc));
  const nodeMarkup = svg.match(/<g id="node-discovery"[^>]*>/)[0];
  assert.match(nodeMarkup, /data-node-personas="newCustomer"/);
  const detailRaw = nodeMarkup.match(/data-node-detail-groups="([^"]*)"/)[1];
  const groups = JSON.parse(detailRaw.replace(/&quot;/g, '"'));
  // Explore's own Personas group (Phase 11) is untouched by Persona Lens —
  // both features read the same stage.personas fact independently.
  assert.deepEqual(groups, [
    { title: 'Decision', items: ['Look around?'] },
    { title: 'Personas', items: [{ text: 'New Customer', swatch: '--cloud-stroke' }] },
    { title: 'Transitions', items: [{ text: '→ Browse', tag: 'Primary' }] },
  ]);
});

// ---------------------------------------------------------------------------
// The bundled first-purchase example (has personas) renders correctly

test('the bundled first-purchase funnel example renders a working Persona Lens', () => {
  const outputPath = path.join(tmp, 'first-purchase.html');
  execFileSync('node', [
    renderer,
    path.join(skillRoot, 'examples/first-purchase.funnel.json'),
    outputPath,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const html = fs.readFileSync(outputPath, 'utf8');
  assert.match(html, /data-persona-button="newCustomer"/);
  const svg = svgOf(html);
  assert.match(svg, /<g id="node-discovery"[^>]*data-node-personas="newCustomer"/);
});
