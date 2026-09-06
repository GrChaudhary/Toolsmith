// Part 2 (Workstream A): Architecture -> Funnel live reverse Cross-Link
// navigation. These tests exercise renderers/architecture/render-architecture.mjs
// with a real --cross-link flag; the pure lookup/validation/href-safety
// functions themselves are already covered by test/cross-link.test.mjs and
// are not re-tested here (reused, not reimplemented — see
// renderers/architecture/cross-link-context.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const renderer = path.join(skillRoot, 'renderers/architecture/render-architecture.mjs');

function funnelDoc(overrides = {}) {
  return {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'reverse cross-link funnel fixture' },
    stages: [
      { id: 'discovery', label: 'Discovery' },
      { id: 'checkout', label: 'Checkout' },
      { id: 'renewal', label: 'Renewal' },
    ],
    transitions: [{ id: 't1', from: 'discovery', to: 'checkout' }, { id: 't2', from: 'checkout', to: 'renewal' }],
    ...overrides,
  };
}

function architectureDoc(overrides = {}) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'reverse cross-link architecture fixture' },
    components: [
      { id: 'api', type: 'backend', label: 'API', pos: [40, 40], size: [120, 60] },
      { id: 'gateway', type: 'backend', label: 'Gateway', pos: [220, 40], size: [120, 60] },
      { id: 'cache', type: 'database', label: 'Cache', pos: [40, 160], size: [120, 60] },
    ],
    connections: [],
    ...overrides,
  };
}

function crossLinkDoc(links) {
  return { schema_version: 1, diagram_type: 'cross-link', meta: { title: 'reverse cross-link fixture' }, links };
}

function link(overrides = {}) {
  return {
    id: 'link1',
    funnel: { document: 'a.funnel.json', stageId: 'checkout' },
    architecture: { document: 'b.architecture.json', componentId: 'api', level: 'hld' },
    ...overrides,
  };
}

function scenario(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-cross-link-reverse-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(content));
  }
  return dir;
}

function render(dir, crossLinkFile) {
  const outputPath = path.join(dir, 'out.html');
  const args = [renderer, path.join(dir, 'b.architecture.json'), outputPath];
  if (crossLinkFile) args.push('--cross-link', path.join(dir, crossLinkFile));
  execFileSync('node', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  return fs.readFileSync(outputPath, 'utf8');
}

function nodeAttrs(html, id) {
  const match = html.match(new RegExp(`data-node-id="${id}"[^>]*`));
  return match ? match[0] : '';
}

// ---------------------------------------------------------------------------
// 1. No Cross-Link artifact: Architecture output/behavior unchanged.

test('no --cross-link flag: Architecture renders exactly as before, byte-identical to the checked-in golden fixture', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-cross-link-reverse-plain-'));
  const outputPath = path.join(dir, 'out.html');
  execFileSync('node', [renderer, path.join(skillRoot, 'examples/web-app.architecture.json'), outputPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  const html = fs.readFileSync(outputPath, 'utf8');
  const golden = fs.readFileSync(path.join(skillRoot, 'examples/web-app-rendered.html'), 'utf8');
  assert.equal(html, golden);
});

test('a --cross-link file with links naming an unrelated Architecture document changes nothing', () => {
  const dir = scenario({
    'a.funnel.json': funnelDoc(),
    'b.architecture.json': architectureDoc(),
  });
  const withoutFlag = render(dir);
  fs.writeFileSync(path.join(dir, 'link.cross-link.json'), JSON.stringify(crossLinkDoc([
    link({ architecture: { document: 'other.architecture.json', componentId: 'api', level: 'hld' } }),
  ])));
  const withUnrelatedCrossLink = render(dir, 'link.cross-link.json');
  assert.equal(withUnrelatedCrossLink, withoutFlag);
  assert.doesNotMatch(nodeAttrs(withoutFlag, 'api'), /data-node-detail-groups/);
});

// ---------------------------------------------------------------------------
// 2. One reverse link.

test('one reverse link produces a "Used by customer journeys" Passport group with a safe href back to the Funnel Stage', () => {
  const dir = scenario({
    'a.funnel.json': funnelDoc(),
    'b.architecture.json': architectureDoc(),
    'link.cross-link.json': crossLinkDoc([link()]),
  });
  const html = render(dir, 'link.cross-link.json');
  const attrs = nodeAttrs(html, 'api');
  assert.match(attrs, /data-node-detail-groups="/);
  assert.match(attrs, /&quot;title&quot;:&quot;Used by customer journeys&quot;/);
  assert.match(attrs, /&quot;href&quot;:&quot;a\.funnel\.html#focus=checkout&quot;/);
});

// ---------------------------------------------------------------------------
// 3. Multiple reverse links: one component supporting several Stages.

test('multiple reverse links from one component surface as multiple items in the same group', () => {
  const dir = scenario({
    'a.funnel.json': funnelDoc(),
    'b.architecture.json': architectureDoc(),
    'link.cross-link.json': crossLinkDoc([
      link({ id: 'l1', funnel: { document: 'a.funnel.json', stageId: 'checkout' } }),
      link({ id: 'l2', funnel: { document: 'a.funnel.json', stageId: 'renewal' } }),
    ]),
  });
  const html = render(dir, 'link.cross-link.json');
  const attrs = nodeAttrs(html, 'api');
  assert.match(attrs, /&quot;href&quot;:&quot;a\.funnel\.html#focus=checkout&quot;/);
  assert.match(attrs, /&quot;href&quot;:&quot;a\.funnel\.html#focus=renewal&quot;/);
});

// ---------------------------------------------------------------------------
// 4. One Funnel Stage linked to multiple Architecture components.

test('one Funnel Stage linked to multiple Architecture components: each component gets its own correct group', () => {
  const dir = scenario({
    'a.funnel.json': funnelDoc(),
    'b.architecture.json': architectureDoc(),
    'link.cross-link.json': crossLinkDoc([
      link({ id: 'l1', architecture: { document: 'b.architecture.json', componentId: 'api', level: 'hld' } }),
      link({ id: 'l2', architecture: { document: 'b.architecture.json', componentId: 'gateway', level: 'hld' } }),
    ]),
  });
  const html = render(dir, 'link.cross-link.json');
  assert.match(nodeAttrs(html, 'api'), /&quot;href&quot;:&quot;a\.funnel\.html#focus=checkout&quot;/);
  assert.match(nodeAttrs(html, 'gateway'), /&quot;href&quot;:&quot;a\.funnel\.html#focus=checkout&quot;/);
  assert.doesNotMatch(nodeAttrs(html, 'cache'), /data-node-detail-groups/);
});

// ---------------------------------------------------------------------------
// 5 & 6. HLD and LLD targets both surface, tagged with their authored level.

test('an HLD-level link tags its item "HLD"', () => {
  const dir = scenario({
    'a.funnel.json': funnelDoc(),
    'b.architecture.json': architectureDoc(),
    'link.cross-link.json': crossLinkDoc([link({ architecture: { document: 'b.architecture.json', componentId: 'api', level: 'hld' } })]),
  });
  assert.match(nodeAttrs(render(dir, 'link.cross-link.json'), 'api'), /&quot;tag&quot;:&quot;HLD&quot;/);
});

test('an LLD-level link tags its item "LLD"', () => {
  const dir = scenario({
    'a.funnel.json': funnelDoc(),
    'b.architecture.json': architectureDoc(),
    'link.cross-link.json': crossLinkDoc([link({ architecture: { document: 'b.architecture.json', componentId: 'api', level: 'lld' } })]),
  });
  assert.match(nodeAttrs(render(dir, 'link.cross-link.json'), 'api'), /&quot;tag&quot;:&quot;LLD&quot;/);
});

// ---------------------------------------------------------------------------
// 7. Invalid Cross-Link rejection.

test('an invalid reverse reference fails the render with a clear diagnostic rather than silently rendering', () => {
  const dir = scenario({
    'a.funnel.json': funnelDoc(),
    'b.architecture.json': architectureDoc(),
    'link.cross-link.json': crossLinkDoc([link({ architecture: { document: 'b.architecture.json', componentId: 'no-such-component', level: 'hld' } })]),
  });
  assert.throws(() => render(dir, 'link.cross-link.json'));
});

test('a --cross-link file that does not exist fails clearly', () => {
  const dir = scenario({ 'b.architecture.json': architectureDoc() });
  assert.throws(() => execFileSync('node', [
    renderer, path.join(dir, 'b.architecture.json'), path.join(dir, 'out.html'), '--cross-link', path.join(dir, 'missing.json'),
  ], { stdio: 'pipe' }));
});

// ---------------------------------------------------------------------------
// 8. Safe URL construction: reused verbatim from renderers/shared/cross-link.mjs
// (safeCrossLinkHref); this proves the renderer actually enforces it rather
// than trusting an authored funnel.document/output value.

test('an unsafe authored Funnel output filename is refused rather than producing an unsafe href', () => {
  const dir = scenario({
    'a.funnel.json': funnelDoc({ meta: { title: 'x', output: 'javascript:alert(1)' } }),
    'b.architecture.json': architectureDoc(),
    'link.cross-link.json': crossLinkDoc([link()]),
  });
  const html = render(dir, 'link.cross-link.json');
  // resolveFunnelHref returns null for an unsafe href, so the group has no
  // usable items and is omitted entirely rather than emitting a bad link.
  assert.doesNotMatch(nodeAttrs(html, 'api'), /data-node-detail-groups/);
});

// ---------------------------------------------------------------------------
// 9. Stable authored IDs: component ids/labels are untouched by Cross-Link.

test('authored component ids and labels are unchanged whether or not --cross-link is used', () => {
  const dir = scenario({
    'a.funnel.json': funnelDoc(),
    'b.architecture.json': architectureDoc(),
    'link.cross-link.json': crossLinkDoc([link()]),
  });
  const withoutFlag = render(dir);
  const withFlag = render(dir, 'link.cross-link.json');
  const stripDetailGroups = (html) => html.replace(/ data-node-detail-groups="[^"]*"/g, '');
  assert.equal(stripDetailGroups(withFlag), withoutFlag);
});

// ---------------------------------------------------------------------------
// 10 & 11. Architecture Explore/Passport integration: reuses the exact same
// generic data-node-detail-groups slot Funnel's Passport already uses (no
// second Passport implementation, no Funnel-specific field on the component).

test('the reverse group uses the shared generic Passport detail-groups mechanism, not a new one', () => {
  const dir = scenario({
    'a.funnel.json': funnelDoc(),
    'b.architecture.json': architectureDoc(),
    'link.cross-link.json': crossLinkDoc([link()]),
  });
  const html = render(dir, 'link.cross-link.json');
  // Same attribute name Funnel's Passport groups already use; same
  // renderDetailGroups() in assets/template.html reads it — no
  // architecture-specific parallel implementation.
  assert.match(nodeAttrs(html, 'api'), /data-node-detail-groups="\[\{&quot;title&quot;/);
});

test('a component with no links renders with no detail-groups attribute at all', () => {
  const dir = scenario({
    'a.funnel.json': funnelDoc(),
    'b.architecture.json': architectureDoc(),
    'link.cross-link.json': crossLinkDoc([link()]),
  });
  const html = render(dir, 'link.cross-link.json');
  assert.doesNotMatch(nodeAttrs(html, 'gateway'), /data-node-detail-groups/);
  assert.doesNotMatch(nodeAttrs(html, 'cache'), /data-node-detail-groups/);
});

// ---------------------------------------------------------------------------
// 12. Export behavior: the canonical exported SVG contains the same
// presentation-only data attribute as the live viewer (it is static JSON,
// not runtime state, so it survives export exactly like Funnel's existing
// detail-groups already do) and rendering never mutates the source files.

test('the canonical SVG (not just the live-viewer HTML) carries the reverse detail-groups attribute', () => {
  const dir = scenario({
    'a.funnel.json': funnelDoc(),
    'b.architecture.json': architectureDoc(),
    'link.cross-link.json': crossLinkDoc([link()]),
  });
  const html = render(dir, 'link.cross-link.json');
  const svg = html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
  assert.match(svg, /data-node-detail-groups="\[\{&quot;title&quot;/);
});

test('rendering with --cross-link does not mutate the Architecture, Funnel, or Cross-Link source files on disk', () => {
  const dir = scenario({
    'a.funnel.json': funnelDoc(),
    'b.architecture.json': architectureDoc(),
    'link.cross-link.json': crossLinkDoc([link()]),
  });
  const before = {
    a: fs.readFileSync(path.join(dir, 'a.funnel.json'), 'utf8'),
    b: fs.readFileSync(path.join(dir, 'b.architecture.json'), 'utf8'),
    link: fs.readFileSync(path.join(dir, 'link.cross-link.json'), 'utf8'),
  };
  render(dir, 'link.cross-link.json');
  assert.equal(fs.readFileSync(path.join(dir, 'a.funnel.json'), 'utf8'), before.a);
  assert.equal(fs.readFileSync(path.join(dir, 'b.architecture.json'), 'utf8'), before.b);
  assert.equal(fs.readFileSync(path.join(dir, 'link.cross-link.json'), 'utf8'), before.link);
});
