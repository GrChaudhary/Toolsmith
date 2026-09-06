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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-funnel-render-'));
let sequence = 0;

function renderDoc(doc) {
  const id = (sequence += 1);
  const inputPath = path.join(tmp, `doc-${id}.funnel.json`);
  const outputPath = path.join(tmp, `doc-${id}.html`);
  fs.writeFileSync(inputPath, JSON.stringify(doc));
  execFileSync('node', [renderer, inputPath, outputPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  return fs.readFileSync(outputPath, 'utf8');
}

function baseDoc(overrides = {}) {
  return {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'renderer fixture' },
    stages: [
      { id: 'a', label: 'Stage A' },
      { id: 'b', label: 'Stage B' },
    ],
    transitions: [{ id: 't1', from: 'a', to: 'b' }],
    ...overrides,
  };
}

function svgOf(html) {
  const match = html.match(/<svg[\s\S]*?<\/svg>/);
  assert.ok(match, 'rendered output must contain one <svg>');
  return match[0];
}

// ---------------------------------------------------------------------------
// 1. Minimal Funnel

test('a minimal two-stage funnel renders one SVG with both stages and the transition', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  assert.match(svg, /data-node-id="a"/);
  assert.match(svg, /data-node-id="b"/);
  assert.match(svg, /data-edge-from="a" data-edge-to="b"/);
});

// ---------------------------------------------------------------------------
// 2/3. Multiple stages, linear transitions

test('a linear chain of stages renders every stage and every transition', () => {
  const doc = baseDoc({
    stages: [
      { id: 'discovery', label: 'Discovery' },
      { id: 'browse', label: 'Browse' },
      { id: 'checkout', label: 'Checkout' },
      { id: 'confirmed', label: 'Confirmed', outcome: 'conversion' },
    ],
    transitions: [
      { id: 't1', from: 'discovery', to: 'browse' },
      { id: 't2', from: 'browse', to: 'checkout' },
      { id: 't3', from: 'checkout', to: 'confirmed' },
    ],
  });
  const svg = svgOf(renderDoc(doc));
  for (const id of ['discovery', 'browse', 'checkout', 'confirmed']) {
    assert.match(svg, new RegExp(`data-node-id="${id}"`));
  }
  assert.equal([...svg.matchAll(/data-edge-from=/g)].length, 3);
});

// ---------------------------------------------------------------------------
// 4. Branching

test('branching (one stage, two outgoing transitions) renders both transitions', () => {
  const doc = baseDoc({
    stages: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ],
    transitions: [
      { id: 't1', from: 'a', to: 'b' },
      { id: 't2', from: 'a', to: 'c' },
    ],
  });
  const svg = svgOf(renderDoc(doc));
  assert.match(svg, /data-edge-from="a" data-edge-to="b"/);
  assert.match(svg, /data-edge-from="a" data-edge-to="c"/);
});

// ---------------------------------------------------------------------------
// 5. Reconvergence

test('reconvergence (two stages, one shared target) renders both incoming transitions', () => {
  const doc = baseDoc({
    stages: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ],
    transitions: [
      { id: 't1', from: 'a', to: 'c' },
      { id: 't2', from: 'b', to: 'c' },
    ],
  });
  const svg = svgOf(renderDoc(doc));
  assert.match(svg, /data-edge-from="a" data-edge-to="c"/);
  assert.match(svg, /data-edge-from="b" data-edge-to="c"/);
});

// ---------------------------------------------------------------------------
// 6. Loop / cycle — must not crash or infinitely recurse

test('a loop transition back to an earlier stage renders without crashing', () => {
  const doc = baseDoc({
    stages: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ],
    transitions: [
      { id: 't1', from: 'a', to: 'b' },
      { id: 't2', from: 'b', to: 'c' },
      { id: 't3', from: 'c', to: 'b', role: 'loop' },
    ],
  });
  const svg = svgOf(renderDoc(doc));
  assert.match(svg, /data-edge-from="c" data-edge-to="b" data-edge-key="2" data-edge-id="t3" data-edge-role="loop"/);
});

test('a fully cyclic graph (no stage with zero in-degree) renders without crashing', () => {
  const doc = baseDoc({
    stages: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
    transitions: [
      { id: 't1', from: 'a', to: 'b' },
      { id: 't2', from: 'b', to: 'a' },
    ],
  });
  const svg = svgOf(renderDoc(doc));
  assert.match(svg, /data-node-id="a"/);
  assert.match(svg, /data-node-id="b"/);
});

// ---------------------------------------------------------------------------
// 7/8. Outcome as a visual semantic hook

test('conversion outcome is preserved as data-node-kind="conversion"', () => {
  const doc = baseDoc({ stages: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', outcome: 'conversion' }] });
  const svg = svgOf(renderDoc(doc));
  assert.match(svg, /data-node-id="b"[^>]*data-node-kind="conversion"/);
});

test('dropoff outcome is preserved as data-node-kind="dropoff"', () => {
  const doc = baseDoc({ stages: [{ id: 'a', label: 'A', outcome: 'dropoff' }, { id: 'b', label: 'B' }] });
  const svg = svgOf(renderDoc(doc));
  assert.match(svg, /data-node-id="a"[^>]*data-node-kind="dropoff"/);
});

test('a stage without outcome has no data-node-kind attribute', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  const nodeMarkup = svg.match(/<g id="node-a"[^>]*>/)[0];
  assert.doesNotMatch(nodeMarkup, /data-node-kind/);
});

// ---------------------------------------------------------------------------
// 9. Transition role

test('transition role is exposed as data-edge-role', () => {
  const doc = baseDoc({ transitions: [{ id: 't1', from: 'a', to: 'b', role: 'alternative' }] });
  const svg = svgOf(renderDoc(doc));
  assert.match(svg, /data-edge-role="alternative"/);
});

test('a transition without role has no data-edge-role attribute', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  const edgeMarkup = svg.match(/<path [^>]*data-edge-from="a"[^>]*>/)[0];
  assert.doesNotMatch(edgeMarkup, /data-edge-role/);
});

// ---------------------------------------------------------------------------
// 10. Transition label

test('a transition label is rendered as visible text', () => {
  const doc = baseDoc({ transitions: [{ id: 't1', from: 'a', to: 'b', label: 'Chose to continue' }] });
  const svg = svgOf(renderDoc(doc));
  assert.match(svg, />Chose to continue</);
});

test('a transition without a label renders no extra label text group', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  assert.doesNotMatch(svg, /data-detail="context"/);
});

// ---------------------------------------------------------------------------
// 11/12. Stable identity

test('stage ids and transition endpoints are the authored ids, unmodified', () => {
  const doc = baseDoc({
    stages: [{ id: 'myCustomStageId', label: 'Custom' }, { id: 'b', label: 'B' }],
    transitions: [{ id: 't1', from: 'myCustomStageId', to: 'b' }],
  });
  const svg = svgOf(renderDoc(doc));
  assert.match(svg, /id="node-myCustomStageId"/);
  assert.match(svg, /data-node-id="myCustomStageId"/);
  assert.match(svg, /data-edge-from="myCustomStageId" data-edge-to="b"/);
});

// ---------------------------------------------------------------------------
// 13. Determinism

test('rendering the same document twice produces byte-identical output', () => {
  const doc = baseDoc();
  const first = renderDoc(doc);
  const second = renderDoc(doc);
  assert.equal(first, second);
});

// ---------------------------------------------------------------------------
// 14. Empty optional collections

test('a document with every optional collection omitted renders successfully', () => {
  const doc = baseDoc();
  assert.equal('personas' in doc, false);
  assert.equal('actions' in doc, false);
  assert.equal('touchpoints' in doc, false);
  assert.doesNotThrow(() => renderDoc(doc));
});

// ---------------------------------------------------------------------------
// 15. Multiple personas do not duplicate Overview nodes

test('multiple personas on a stage do not produce duplicate stage nodes', () => {
  const doc = baseDoc({
    personas: [{ id: 'p1', label: 'P1' }, { id: 'p2', label: 'P2' }],
    stages: [
      { id: 'a', label: 'A', personas: ['p1', 'p2'] },
      { id: 'b', label: 'B' },
    ],
  });
  const svg = svgOf(renderDoc(doc));
  assert.equal([...svg.matchAll(/data-node-id="a"/g)].length, 1);
});

// ---------------------------------------------------------------------------
// 16/17. Actions and Touchpoints are not separate Overview graph nodes

test('Actions do not become separate Overview graph nodes', () => {
  const doc = baseDoc({
    touchpoints: [{ id: 'web', type: 'web', label: 'Website' }],
    actions: [{ id: 'search', stage: 'a', label: 'Search', touchpoint: 'web' }],
  });
  const svg = svgOf(renderDoc(doc));
  assert.doesNotMatch(svg, /data-node-id="search"/);
  assert.equal([...svg.matchAll(/<g [^>]*data-node-id=/g)].length, 2);
});

test('Touchpoints do not become separate Overview graph nodes', () => {
  const doc = baseDoc({
    touchpoints: [{ id: 'web', type: 'web', label: 'Website' }],
    actions: [{ id: 'search', stage: 'a', label: 'Search', touchpoint: 'web' }],
  });
  const svg = svgOf(renderDoc(doc));
  assert.doesNotMatch(svg, /data-node-id="web"/);
});

// ---------------------------------------------------------------------------
// The bundled Phase 7 example renders end to end

test('the bundled first-purchase funnel example renders successfully', () => {
  const outputPath = path.join(tmp, 'first-purchase.html');
  execFileSync('node', [
    renderer,
    path.join(skillRoot, 'examples/first-purchase.funnel.json'),
    outputPath,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const html = fs.readFileSync(outputPath, 'utf8');
  const svg = svgOf(html);
  for (const id of ['discovery', 'browse', 'checkout', 'confirmed']) {
    assert.match(svg, new RegExp(`data-node-id="${id}"`));
  }
  assert.match(svg, /data-node-kind="dropoff"/);
  assert.match(svg, /data-node-kind="conversion"/);
});

// ---------------------------------------------------------------------------
// Invalid input is rejected before rendering (renderer reuses loadDiagram's
// schema + Phase 9 referential-integrity validation; it does not re-implement
// or weaken it)

test('a dangling transition reference is rejected before any SVG is produced', () => {
  const doc = baseDoc({ transitions: [{ id: 't1', from: 'a', to: 'doesNotExist' }] });
  assert.throws(() => renderDoc(doc));
});

test('a document that fails JSON Schema validation is rejected', () => {
  const doc = baseDoc();
  delete doc.stages;
  assert.throws(() => renderDoc(doc));
});

// ---------------------------------------------------------------------------
// Phase 11: Explore detail is carried as data-node-detail-groups, read by the
// shared Semantic Passport (assets/template.html) on focus/click — the
// Overview graph itself (nodes/edges) is unaffected either way.

test('a Stage with Explore detail carries a well-formed data-node-detail-groups JSON payload', () => {
  const doc = baseDoc({
    stages: [
      { id: 'a', label: 'A', decision: 'Continue?' },
      { id: 'b', label: 'B' },
    ],
  });
  const svg = svgOf(renderDoc(doc));
  const nodeMarkup = svg.match(/<g id="node-a"[^>]*>/)[0];
  const raw = nodeMarkup.match(/data-node-detail-groups="([^"]*)"/)[1];
  const groups = JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  assert.deepEqual(groups, [
    { title: 'Decision', items: ['Continue?'] },
    { title: 'Transitions', items: [{ text: '→ B', tag: 'Primary' }] },
  ]);
});

test('a Stage touched by no Transition and with no other Explore detail carries no data-node-detail-groups attribute', () => {
  // Phase 16: every Stage touched by at least one Transition now gets a
  // Transitions group, so this "nothing to show" case needs a Stage that
  // is genuinely untouched by any Transition, rather than reusing baseDoc's
  // 'a' (which t1 always connects to 'b').
  const doc = baseDoc({
    stages: [
      { id: 'a', label: 'Stage A' },
      { id: 'b', label: 'Stage B' },
      { id: 'c', label: 'Stage C' },
    ],
  });
  const svg = svgOf(renderDoc(doc));
  const nodeMarkup = svg.match(/<g id="node-c"[^>]*>/)[0];
  assert.doesNotMatch(nodeMarkup, /data-node-detail-groups/);
});

test('Explore detail reflects Actions, Touchpoints, Personas, and Transitions for the correct Stage only', () => {
  const doc = baseDoc({
    personas: [{ id: 'p1', label: 'New Customer' }],
    stages: [
      { id: 'a', label: 'A', personas: ['p1'] },
      { id: 'b', label: 'B' },
    ],
    touchpoints: [{ id: 'web', type: 'web', label: 'Website' }],
    actions: [{ id: 'search', stage: 'a', label: 'Search', touchpoint: 'web' }],
  });
  const svg = svgOf(renderDoc(doc));
  const nodeA = svg.match(/<g id="node-a"[^>]*>/)[0];
  const nodeB = svg.match(/<g id="node-b"[^>]*>/)[0];
  const groupsA = JSON.parse(nodeA.match(/data-node-detail-groups="([^"]*)"/)[1].replace(/&quot;/g, '"'));
  const groupsB = JSON.parse(nodeB.match(/data-node-detail-groups="([^"]*)"/)[1].replace(/&quot;/g, '"'));
  assert.deepEqual(groupsA.map((g) => g.title), ['Actions', 'Touchpoints', 'Personas', 'Transitions']);
  // 'b' has no Actions/Touchpoints/Personas of its own — only the
  // Transitions group the incoming transition from 'a' produces.
  assert.deepEqual(groupsB.map((g) => g.title), ['Transitions']);
});

test('Explore detail does not add Actions/Touchpoints/Personas as separate Overview graph nodes', () => {
  const doc = baseDoc({
    touchpoints: [{ id: 'web', type: 'web', label: 'Website' }],
    actions: [{ id: 'search', stage: 'a', label: 'Search', touchpoint: 'web' }],
  });
  const svg = svgOf(renderDoc(doc));
  assert.equal([...svg.matchAll(/<g [^>]*data-node-id=/g)].length, 2);
  assert.doesNotMatch(svg, /data-node-id="search"/);
  assert.doesNotMatch(svg, /data-node-id="web"/);
});

test('rendering the same document twice produces identical Explore detail (determinism)', () => {
  const doc = baseDoc({
    touchpoints: [{ id: 'web', type: 'web', label: 'Website' }],
    actions: [{ id: 'search', stage: 'a', label: 'Search', touchpoint: 'web' }],
  });
  const first = renderDoc(doc);
  const second = renderDoc(doc);
  assert.equal(first, second);
});

test('rendering does not mutate the source Funnel JSON file on disk', () => {
  const doc = baseDoc({
    touchpoints: [{ id: 'web', type: 'web', label: 'Website' }],
    actions: [{ id: 'search', stage: 'a', label: 'Search', touchpoint: 'web' }],
  });
  const id = (sequence += 1);
  const inputPath = path.join(tmp, `immutability-${id}.funnel.json`);
  const originalText = JSON.stringify(doc, null, 2);
  fs.writeFileSync(inputPath, originalText);
  const outputPath = path.join(tmp, `immutability-${id}.html`);
  execFileSync('node', [renderer, inputPath, outputPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  assert.equal(fs.readFileSync(inputPath, 'utf8'), originalText);
});

// ---------------------------------------------------------------------------
// 18. Existing Architecture renderer behavior remains unchanged

test('the architecture renderer still renders its bundled example unchanged', () => {
  const outputPath = path.join(tmp, 'architecture.html');
  execFileSync('node', [
    path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    path.join(skillRoot, 'examples/web-app.architecture.json'),
    outputPath,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const rendered = fs.readFileSync(outputPath, 'utf8');
  const repoRoot = path.resolve(skillRoot, '..');
  const golden = fs.readFileSync(path.join(repoRoot, 'examples/web-app.html'), 'utf8');
  assert.equal(rendered.replace(/\r\n?/g, '\n'), golden.replace(/\r\n?/g, '\n'));
});
