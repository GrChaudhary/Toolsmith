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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-funnel-role-style-'));
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

function pathFor(svg, edgeId) {
  const match = svg.match(new RegExp(`<path[^>]*data-edge-id="${edgeId}"[^>]*>`));
  assert.ok(match, `expected a <path> for edge ${edgeId}`);
  return match[0];
}

function baseDoc(overrides = {}) {
  return {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'role style fixture' },
    stages: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ],
    transitions: [
      { id: 'noRole', from: 'a', to: 'b' },
      { id: 'primaryRole', from: 'a', to: 'c', role: 'primary' },
      { id: 'altRole', from: 'b', to: 'c', role: 'alternative', label: 'Skip ahead' },
      { id: 'loopRole', from: 'c', to: 'a', role: 'loop' },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1/2. No role and primary both retain default styling

test('a Transition with no role retains the default a-default class and default marker', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  const markup = pathFor(svg, 'noRole');
  assert.match(markup, /class="a-default"/);
  assert.match(markup, /marker-end="url\(#arrowhead\)"/);
  assert.doesNotMatch(markup, /data-edge-role/);
});

test('a Transition with role="primary" retains the default a-default class and default marker', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  const markup = pathFor(svg, 'primaryRole');
  assert.match(markup, /class="a-default"/);
  assert.match(markup, /marker-end="url\(#arrowhead\)"/);
  assert.match(markup, /data-edge-role="primary"/);
});

// ---------------------------------------------------------------------------
// 3/4/5/6. Alternative and loop receive distinct styling, keyed off the
// existing data-edge-role hook, and are distinguishable from each other.

test('an alternative Transition receives the dashed class and matching marker', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  const markup = pathFor(svg, 'altRole');
  assert.match(markup, /class="a-dashed"/);
  assert.match(markup, /marker-end="url\(#arrowhead-dashed\)"/);
  assert.match(markup, /data-edge-role="alternative"/);
});

test('a loop Transition receives the emphasis class and matching marker', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  const markup = pathFor(svg, 'loopRole');
  assert.match(markup, /class="a-emphasis"/);
  assert.match(markup, /marker-end="url\(#arrowhead-emphasis\)"/);
  assert.match(markup, /data-edge-role="loop"/);
});

test('alternative (dashed, solid-stroke-width) and loop (solid, thicker) are visually distinguishable by class, marker, and stroke-width, not only by color', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  const alt = pathFor(svg, 'altRole');
  const loop = pathFor(svg, 'loopRole');
  assert.notEqual(alt.match(/class="([^"]+)"/)[1], loop.match(/class="([^"]+)"/)[1]);
  assert.notEqual(alt.match(/marker-end="url\(#([^)]+)\)"/)[1], loop.match(/marker-end="url\(#([^)]+)\)"/)[1]);
  assert.notEqual(alt.match(/stroke-width="([^"]+)"/)[1], loop.match(/stroke-width="([^"]+)"/)[1]);
});

// ---------------------------------------------------------------------------
// 7/8/9/10. Identity and labels unchanged

test('Transition from/to and edge identity attributes are unchanged by role styling', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  const markup = pathFor(svg, 'altRole');
  assert.match(markup, /data-edge-from="b" data-edge-to="c"/);
  assert.match(markup, /data-edge-id="altRole"/);
});

test('an authored Transition label is preserved verbatim, with no [role] text appended', () => {
  const html = renderDoc(baseDoc());
  assert.match(html, />Skip ahead</);
  assert.doesNotMatch(html, /\[alternative\]/);
  assert.doesNotMatch(html, /\[loop\]/);
  assert.doesNotMatch(html, /\[primary\]/);
});

// ---------------------------------------------------------------------------
// 11/12/13/14. Branching, reconvergence, cycles, loop role all still render

test('branching, reconvergence, and a cycle all render correctly with mixed roles', () => {
  const doc = baseDoc({
    stages: [
      { id: 'start', label: 'Start' },
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'end', label: 'End' },
    ],
    transitions: [
      { id: 't1', from: 'start', to: 'a', role: 'primary' },
      { id: 't2', from: 'start', to: 'b', role: 'alternative' },
      { id: 't3', from: 'a', to: 'end', role: 'primary' },
      { id: 't4', from: 'b', to: 'end', role: 'primary' },
      { id: 't5', from: 'end', to: 'start', role: 'loop' },
    ],
  });
  const svg = svgOf(renderDoc(doc));
  for (const id of ['start', 'a', 'b', 'end']) assert.match(svg, new RegExp(`data-node-id="${id}"`));
  assert.equal([...svg.matchAll(/data-edge-from=/g)].length, 5);
  assert.match(pathFor(svg, 't5'), /class="a-emphasis"/);
});

test('a loop-role transition renders without requiring geometric self-loop detection (from !== to)', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  const markup = pathFor(svg, 'loopRole');
  assert.match(markup, /data-edge-from="c" data-edge-to="a"/);
});

// ---------------------------------------------------------------------------
// 15. Outcome (Phase 13) styling remains intact alongside role-styled edges

test('conversion/dropoff node styling is untouched when role-styled edges are present', () => {
  const doc = baseDoc({
    stages: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B', outcome: 'conversion' },
      { id: 'c', label: 'C', outcome: 'dropoff' },
    ],
  });
  const html = renderDoc(doc);
  assert.match(html, /\[data-node-kind="conversion"\][^{]*\.c-mask\s*\{[^}]*fill:\s*var\(--database-fill\)/);
  assert.match(html, /\[data-node-kind="dropoff"\][^{]*\.c-mask\s*\{[^}]*fill:\s*var\(--security-fill\)/);
  const svg = svgOf(html);
  const nodeB = svg.match(/<g id="node-b"[^>]*>/)[0];
  const nodeC = svg.match(/<g id="node-c"[^>]*>/)[0];
  assert.match(nodeB, /data-node-kind="conversion"/);
  assert.match(nodeC, /data-node-kind="dropoff"/);
});

// ---------------------------------------------------------------------------
// 16/17/18/19. Persona Lens compatibility

test('Persona Lens markup and script remain present and functional alongside role-styled edges', () => {
  const doc = baseDoc({ personas: [{ id: 'p1', label: 'P1' }] });
  const html = renderDoc(doc);
  assert.match(html, /id="funnel-persona-lens"/);
  assert.match(html, /function selectPersona\(personaId, label\)/);
  assert.match(html, /function clearPersona\(\)/);
});

test('Persona dimming applies to alternative-role edges the same way as any other edge (via data-edge-from/to, independent of class)', () => {
  const doc = baseDoc({ personas: [{ id: 'p1', label: 'P1' }] });
  const html = renderDoc(doc);
  // The Persona Lens script matches edges purely by data-edge-from/to, not by
  // class or data-edge-role, so alternative/loop edges dim/highlight exactly
  // like any other edge — confirmed by reading its selector, which contains
  // no role/class condition at all.
  const script = html.match(/function selectPersona[\s\S]*?\n\s{10}\}/)[0];
  assert.doesNotMatch(script, /data-edge-role/);
  assert.doesNotMatch(script, /class="a-/);
  assert.match(script, /data-edge-from.*data-edge-to/);
});

test('clearPersona() does not touch data-edge-role or edge class/marker attributes (role presentation is restored, not the dimming target)', () => {
  const doc = baseDoc({ personas: [{ id: 'p1', label: 'P1' }] });
  const html = renderDoc(doc);
  const script = html.match(/function clearPersona\(\)[\s\S]*?\n\s{10}\}/)[0];
  assert.doesNotMatch(script, /data-edge-role/);
  assert.doesNotMatch(script, /marker-end/);
});

// ---------------------------------------------------------------------------
// 20. Explore/Passport remains functional (Stage detail groups untouched)

test('Explore detail groups still derive correctly for a Stage whose incoming/outgoing edges include alternative and loop roles', () => {
  const doc = baseDoc({
    stages: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B', decision: 'Continue?' },
      { id: 'c', label: 'C' },
    ],
  });
  const svg = svgOf(renderDoc(doc));
  const nodeMarkup = svg.match(/<g id="node-b"[^>]*>/)[0];
  const detailRaw = nodeMarkup.match(/data-node-detail-groups="([^"]*)"/)[1];
  const groups = JSON.parse(detailRaw.replace(/&quot;/g, '"'));
  assert.deepEqual(groups, [
    { title: 'Decision', items: ['Continue?'] },
    {
      title: 'Transitions',
      items: [
        { text: '← A', tag: 'Primary' },
        { text: '→ C — Skip ahead', tag: 'Alternative' },
      ],
    },
  ]);
});

// ---------------------------------------------------------------------------
// 21/22. No-role and mixed-role documents both render

test('a Funnel document with no role values on any Transition still renders', () => {
  const doc = {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'no roles' },
    stages: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    transitions: [{ id: 't1', from: 'a', to: 'b' }],
  };
  const svg = svgOf(renderDoc(doc));
  assert.match(pathFor(svg, 't1'), /class="a-default"/);
});

test('a Funnel document with mixed role values renders all four visual states', () => {
  const svg = svgOf(renderDoc(baseDoc()));
  assert.match(pathFor(svg, 'noRole'), /class="a-default"/);
  assert.match(pathFor(svg, 'primaryRole'), /class="a-default"/);
  assert.match(pathFor(svg, 'altRole'), /class="a-dashed"/);
  assert.match(pathFor(svg, 'loopRole'), /class="a-emphasis"/);
});

// ---------------------------------------------------------------------------
// 23/24. Determinism and source immutability

test('rendering the same document twice produces byte-identical output', () => {
  const doc = baseDoc();
  assert.equal(renderDoc(doc), renderDoc(doc));
});

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
// The bundled first-purchase example (has a loop-role transition already)

test('the bundled first-purchase funnel example renders its loop transition with emphasis styling', () => {
  const outputPath = path.join(tmp, 'first-purchase.html');
  execFileSync('node', [
    renderer,
    path.join(skillRoot, 'examples/first-purchase.funnel.json'),
    outputPath,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const html = fs.readFileSync(outputPath, 'utf8');
  const svg = svgOf(html);
  const loopMarkup = pathFor(svg, 'checkoutBackToBrowse');
  assert.match(loopMarkup, /class="a-emphasis"/);
  assert.match(loopMarkup, /marker-end="url\(#arrowhead-emphasis\)"/);
});
