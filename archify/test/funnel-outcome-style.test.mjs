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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-funnel-outcome-style-'));
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

function baseDoc(overrides = {}) {
  return {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'outcome style fixture' },
    stages: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B', outcome: 'conversion' },
      { id: 'c', label: 'C', outcome: 'dropoff' },
    ],
    transitions: [
      { id: 't1', from: 'a', to: 'b' },
      { id: 't2', from: 'a', to: 'c' },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1/10. Default Stage retains existing appearance; no third outcome invented

test('a Stage without outcome carries no data-node-kind attribute and gets no outcome CSS rule applied', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  const nodeMarkup = svg.match(/<g id="node-a"[^>]*>/)[0];
  assert.doesNotMatch(nodeMarkup, /data-node-kind/);
});

// ---------------------------------------------------------------------------
// 2/3/5. Conversion/dropoff styling keyed off the existing semantic hook

test('a conversion Stage carries data-node-kind="conversion" (the existing Phase 10 hook)', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  const nodeMarkup = svg.match(/<g id="node-b"[^>]*>/)[0];
  assert.match(nodeMarkup, /data-node-kind="conversion"/);
});

test('a dropoff Stage carries data-node-kind="dropoff" (the existing Phase 10 hook)', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  const nodeMarkup = svg.match(/<g id="node-c"[^>]*>/)[0];
  assert.match(nodeMarkup, /data-node-kind="dropoff"/);
});

test('the rendered SVG carries a CSS rule styling [data-node-kind="conversion"] distinctly from the default', () => {
  const html = renderDoc(baseDoc());
  assert.match(html, /\[data-node-kind="conversion"\][^{]*\.c-mask\s*\{[^}]*fill:\s*var\(--database-fill\)/);
});

test('the rendered SVG carries a CSS rule styling [data-node-kind="dropoff"] distinctly from the default', () => {
  const html = renderDoc(baseDoc());
  assert.match(html, /\[data-node-kind="dropoff"\][^{]*\.c-mask\s*\{[^}]*fill:\s*var\(--security-fill\)/);
});

// ---------------------------------------------------------------------------
// 4. Conversion and dropoff are visually distinguishable from each other,
// not just from the default (different color token AND a dasharray, so the
// distinction is not hue-only).

test('conversion and dropoff use different color tokens and dropoff adds a dasharray conversion does not have', () => {
  const html = renderDoc(baseDoc());
  const conversionRule = html.match(/\[data-node-kind="conversion"\][^{]*\.c-mask\s*\{([^}]*)\}/)[1];
  const dropoffRule = html.match(/\[data-node-kind="dropoff"\][^{]*\.c-mask\s*\{([^}]*)\}/)[1];
  assert.doesNotMatch(conversionRule, /stroke-dasharray/);
  assert.match(dropoffRule, /stroke-dasharray/);
  assert.notEqual(conversionRule.match(/stroke:\s*var\(([^)]+)\)/)[1], dropoffRule.match(/stroke:\s*var\(([^)]+)\)/)[1]);
});

// ---------------------------------------------------------------------------
// 6/7. Stage ids and Transition endpoints are unaffected

test('Stage ids and Transition endpoints are unchanged by outcome styling', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  assert.match(svg, /id="node-a"/);
  assert.match(svg, /id="node-b"/);
  assert.match(svg, /id="node-c"/);
  assert.match(svg, /data-edge-from="a" data-edge-to="b"/);
  assert.match(svg, /data-edge-from="a" data-edge-to="c"/);
});

// ---------------------------------------------------------------------------
// 8/9/11. Persona Lens compatibility: outcome styling composes with, and does
// not disable, Persona dimming/highlighting/clearing.

test('a conversion Stage restricted to a Persona still carries data-node-personas alongside data-node-kind', () => {
  const doc = baseDoc({
    personas: [{ id: 'p1', label: 'P1' }],
    stages: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B', outcome: 'conversion', personas: ['p1'] },
      { id: 'c', label: 'C', outcome: 'dropoff' },
    ],
  });
  const svg = svgOf(renderDoc(doc));
  const nodeMarkup = svg.match(/<g id="node-b"[^>]*>/)[0];
  assert.match(nodeMarkup, /data-node-kind="conversion"/);
  assert.match(nodeMarkup, /data-node-personas="p1"/);
});

test('Persona Lens markup and script are present and functional alongside outcome-styled Stages', () => {
  const doc = baseDoc({ personas: [{ id: 'p1', label: 'P1' }] });
  const html = renderDoc(doc);
  assert.match(html, /id="funnel-persona-lens"/);
  assert.match(html, /function selectPersona\(personaId, label\)/);
  assert.match(html, /function clearPersona\(\)/);
});

test('the Persona dimming rule (opacity) and the outcome fill/stroke rule are separate, composable CSS rules, not a single overriding rule', () => {
  const doc = baseDoc({ personas: [{ id: 'p1', label: 'P1' }] });
  const html = renderDoc(doc);
  assert.match(html, /\[data-persona-active\] \[data-node-id\][\s\S]{0,80}\{ opacity: 0\.11; \}/);
  assert.match(html, /\[data-node-kind="conversion"\][^{]*\.c-mask/);
  // The dimming rule targets [data-node-id] (the <g>); the outcome rule
  // targets .c-mask (the <rect> inside it) — independent selectors that
  // both apply to a dimmed-and-outcome-styled node simultaneously.
});

test('clearPersona() removes data-persona-active/-match without touching data-node-kind (outcome presentation is restored, not the dimming target)', () => {
  const doc = baseDoc({ personas: [{ id: 'p1', label: 'P1' }] });
  const html = renderDoc(doc);
  const script = html.match(/function clearPersona\(\)[\s\S]*?\n\s{10}\}/)[0];
  assert.match(script, /svg\.removeAttribute\('data-persona-active'\)/);
  assert.doesNotMatch(script, /data-node-kind/);
});

// ---------------------------------------------------------------------------
// 12/13. Explore/Passport compatibility: detail groups still derive correctly
// for conversion/dropoff Stages, unaffected by the new CSS-only addition.

test('Explore detail groups still derive for a conversion Stage with its own Action/Touchpoint', () => {
  const doc = baseDoc({
    stages: [
      { id: 'a', label: 'A' },
      {
        id: 'b', label: 'B', outcome: 'conversion', decision: 'Proceed?',
      },
    ],
    transitions: [{ id: 't1', from: 'a', to: 'b' }],
  });
  const svg = svgOf(renderDoc(doc));
  const nodeMarkup = svg.match(/<g id="node-b"[^>]*>/)[0];
  const detailRaw = nodeMarkup.match(/data-node-detail-groups="([^"]*)"/)[1];
  const groups = JSON.parse(detailRaw.replace(/&quot;/g, '"'));
  assert.deepEqual(groups, [
    { title: 'Decision', items: ['Proceed?'] },
    { title: 'Transitions', items: [{ text: '← A', tag: 'Primary' }] },
  ]);
});

test('Explore detail groups still derive for a dropoff Stage with friction', () => {
  const doc = baseDoc({
    stages: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B', outcome: 'dropoff', friction: 'Gave up here' },
    ],
    transitions: [{ id: 't1', from: 'a', to: 'b' }],
  });
  const svg = svgOf(renderDoc(doc));
  const nodeMarkup = svg.match(/<g id="node-b"[^>]*>/)[0];
  const detailRaw = nodeMarkup.match(/data-node-detail-groups="([^"]*)"/)[1];
  const groups = JSON.parse(detailRaw.replace(/&quot;/g, '"'));
  assert.deepEqual(groups, [
    { title: 'Transitions', items: [{ text: '← A', tag: 'Primary' }] },
    { title: 'Friction', items: ['Gave up here'] },
  ]);
});

// ---------------------------------------------------------------------------
// 14/15/16/17. Rendering still works: no outcomes, mixed outcomes, loops,
// branching/reconvergence.

test('rendering a Funnel with no outcomes at all still works', () => {
  const doc = {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'no outcomes' },
    stages: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    transitions: [{ id: 't1', from: 'a', to: 'b' }],
  };
  const svg = svgOf(renderDoc(doc));
  const nodeMarkup = [...svg.matchAll(/<g id="node-[^"]*"[^>]*>/g)].map((m) => m[0]).join('\n');
  assert.doesNotMatch(nodeMarkup, /data-node-kind/);
});

test('rendering a Funnel with mixed outcomes works', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  assert.match(svg, /data-node-kind="conversion"/);
  assert.match(svg, /data-node-kind="dropoff"/);
});

test('rendering a Funnel with conversion/dropoff outcomes and a loop transition works', () => {
  const doc = baseDoc({
    transitions: [
      { id: 't1', from: 'a', to: 'b' },
      { id: 't2', from: 'a', to: 'c' },
      { id: 't3', from: 'c', to: 'a', role: 'loop' },
    ],
  });
  const svg = svgOf(renderDoc(doc));
  assert.equal([...svg.matchAll(/data-edge-from=/g)].length, 3);
});

test('rendering a Funnel with branching and reconvergence into a conversion/dropoff pair works', () => {
  const doc = baseDoc({
    stages: [
      { id: 'start', label: 'Start' },
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'end', label: 'End', outcome: 'conversion' },
      { id: 'exit', label: 'Exit', outcome: 'dropoff' },
    ],
    transitions: [
      { id: 't1', from: 'start', to: 'a' },
      { id: 't2', from: 'start', to: 'b' },
      { id: 't3', from: 'a', to: 'end' },
      { id: 't4', from: 'b', to: 'end' },
      { id: 't5', from: 'a', to: 'exit' },
    ],
  });
  const svg = svgOf(renderDoc(doc));
  for (const id of ['start', 'a', 'b', 'end', 'exit']) assert.match(svg, new RegExp(`data-node-id="${id}"`));
});

// ---------------------------------------------------------------------------
// 18. Determinism

test('rendering the same document twice produces byte-identical output', () => {
  const doc = baseDoc();
  assert.equal(renderDoc(doc), renderDoc(doc));
});

// ---------------------------------------------------------------------------
// Source immutability

test('rendering does not mutate the source JSON document on disk', () => {
  const doc = baseDoc();
  const id = (sequence += 1);
  const inputPath = path.join(tmp, `immutability-${id}.funnel.json`);
  const originalText = JSON.stringify(doc, null, 2);
  fs.writeFileSync(inputPath, originalText);
  const outputPath = path.join(tmp, `immutability-${id}.html`);
  execFileSync('node', [renderer, inputPath, outputPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  assert.equal(fs.readFileSync(inputPath, 'utf8'), originalText);
});

// ---------------------------------------------------------------------------
// The bundled first-purchase example (has a conversion Stage and a dropoff
// Stage already) renders correctly end to end.

test('the bundled first-purchase funnel example renders distinct conversion/dropoff styling', () => {
  const outputPath = path.join(tmp, 'first-purchase.html');
  execFileSync('node', [
    renderer,
    path.join(skillRoot, 'examples/first-purchase.funnel.json'),
    outputPath,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const html = fs.readFileSync(outputPath, 'utf8');
  const svg = svgOf(html);
  assert.match(svg, /<g id="node-confirmed"[^>]*data-node-kind="conversion"/);
  assert.match(svg, /<g id="node-browse"[^>]*data-node-kind="dropoff"/);
});
