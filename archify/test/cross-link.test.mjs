import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crossLink as validateCrossLinkSchema } from '../renderers/shared/generated-validators.mjs';
import {
  findDuplicateLinkIds,
  linksForComponent,
  linksForStage,
  resolveArchitectureHref,
  resolveFunnelHref,
  safeCrossLinkHref,
  validateCrossLinkReferences,
} from '../renderers/shared/cross-link.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const renderer = path.join(skillRoot, 'renderers/funnel/render-funnel.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-cross-link-'));
let sequence = 0;

function funnelDoc() {
  return {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'cross-link funnel fixture' },
    stages: [
      { id: 'discovery', label: 'Discovery' },
      { id: 'checkout', label: 'Checkout' },
    ],
    transitions: [{ id: 't1', from: 'discovery', to: 'checkout' }],
  };
}

function architectureDoc(overrides = {}) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'cross-link architecture fixture', output: 'web-app-rendered.html' },
    components: [
      { id: 'api', type: 'backend', label: 'API' },
      { id: 'gateway', type: 'backend', label: 'Gateway' },
    ],
    connections: [],
    ...overrides,
  };
}

function crossLinkDoc(links) {
  return {
    schema_version: 1,
    diagram_type: 'cross-link',
    meta: { title: 'cross-link fixture' },
    links,
  };
}

function baseLink(overrides = {}) {
  return {
    id: 'link1',
    funnel: { document: 'a.funnel.json', stageId: 'checkout' },
    architecture: { document: 'b.architecture.json', componentId: 'api', level: 'hld' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Schema validation

test('a well-formed Cross-Link document validates against cross-link.schema.json', () => {
  assert.equal(validateCrossLinkSchema(crossLinkDoc([baseLink()])), true);
});

test('a Cross-Link link missing required fields fails schema validation', () => {
  const doc = crossLinkDoc([{ id: 'link1', funnel: { document: 'a.funnel.json' }, architecture: { document: 'b', componentId: 'x', level: 'hld' } }]);
  assert.equal(validateCrossLinkSchema(doc), false);
});

test('an invalid architecture level fails schema validation', () => {
  const doc = crossLinkDoc([baseLink({ architecture: { document: 'b', componentId: 'api', level: 'mid' } })]);
  assert.equal(validateCrossLinkSchema(doc), false);
});

test('Funnel does not embed Cross-Link, and Architecture does not embed Cross-Link (no shared schema fields)', () => {
  const funnelSchema = JSON.parse(fs.readFileSync(path.join(skillRoot, 'schemas/funnel.schema.json'), 'utf8'));
  const architectureSchema = JSON.parse(fs.readFileSync(path.join(skillRoot, 'schemas/architecture.schema.json'), 'utf8'));
  assert.equal(JSON.stringify(funnelSchema).includes('cross-link'), false);
  assert.equal(JSON.stringify(architectureSchema).includes('cross-link'), false);
});

// ---------------------------------------------------------------------------
// Structural validation: duplicate ids

test('findDuplicateLinkIds reports a duplicate link id', () => {
  const doc = crossLinkDoc([baseLink({ id: 'dup' }), baseLink({ id: 'dup' })]);
  const problems = findDuplicateLinkIds(doc);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /duplicates link id "dup"/);
});

// ---------------------------------------------------------------------------
// Reference validation: valid Stage -> HLD/LLD, invalid Stage, invalid
// component, invalid level (schema already rejects invalid level, this
// covers a valid-enum level that just doesn't resolve at that level).

test('a valid Stage -> HLD component link passes reference validation', () => {
  const doc = crossLinkDoc([baseLink({ funnel: { document: 'a.funnel.json', stageId: 'checkout' }, architecture: { document: 'b.architecture.json', componentId: 'api', level: 'hld' } })]);
  const problems = validateCrossLinkReferences(doc, {
    funnelDocuments: { 'a.funnel.json': funnelDoc() },
    architectureDocuments: { 'b.architecture.json': architectureDoc() },
  });
  assert.deepEqual(problems, []);
});

test('a valid Stage -> LLD component link passes reference validation', () => {
  const doc = crossLinkDoc([baseLink({ architecture: { document: 'b.architecture.json', componentId: 'api', level: 'lld' } })]);
  const problems = validateCrossLinkReferences(doc, {
    funnelDocuments: { 'a.funnel.json': funnelDoc() },
    architectureDocuments: { 'b.architecture.json': architectureDoc() },
  });
  assert.deepEqual(problems, []);
});

test('an invalid Stage id fails reference validation with a clear message', () => {
  const doc = crossLinkDoc([baseLink({ funnel: { document: 'a.funnel.json', stageId: 'does-not-exist' } })]);
  const problems = validateCrossLinkReferences(doc, {
    funnelDocuments: { 'a.funnel.json': funnelDoc() },
    architectureDocuments: { 'b.architecture.json': architectureDoc() },
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /unknown Stage id "does-not-exist"/);
});

test('an invalid Architecture component id fails reference validation', () => {
  const doc = crossLinkDoc([baseLink({ architecture: { document: 'b.architecture.json', componentId: 'does-not-exist', level: 'hld' } })]);
  const problems = validateCrossLinkReferences(doc, {
    funnelDocuments: { 'a.funnel.json': funnelDoc() },
    architectureDocuments: { 'b.architecture.json': architectureDoc() },
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /does-not-exist.*not present at level "hld"/);
});

test('a component present only at LLD (a child in the hierarchy) is correctly rejected at HLD', () => {
  const doc = crossLinkDoc([baseLink({ architecture: { document: 'b.architecture.json', componentId: 'api', level: 'hld' } })]);
  // 'api' is a child of 'gateway' in architectureDoc(), so HLD (which
  // collapses children into their nearest visible ancestor) does not expose
  // 'api' as its own component id — this is exactly the existing
  // architecture-projection.mjs behavior, reused rather than reimplemented.
  const problems = validateCrossLinkReferences(doc, {
    funnelDocuments: { 'a.funnel.json': funnelDoc() },
    architectureDocuments: { 'b.architecture.json': architectureDoc({ components: [{ id: 'gateway', type: 'backend', label: 'Gateway', children: ['api'] }, { id: 'api', type: 'backend', label: 'API' }] }) },
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /not present at level "hld"/);
});

test('a missing referenced Funnel document is reported', () => {
  const doc = crossLinkDoc([baseLink({ funnel: { document: 'missing.funnel.json', stageId: 'checkout' } })]);
  const problems = validateCrossLinkReferences(doc, {
    funnelDocuments: {},
    architectureDocuments: { 'b.architecture.json': architectureDoc() },
  });
  assert.match(problems[0], /unknown Funnel document "missing.funnel.json"/);
});

test('a missing referenced Architecture document is reported', () => {
  const doc = crossLinkDoc([baseLink({ architecture: { document: 'missing.architecture.json', componentId: 'api', level: 'hld' } })]);
  const problems = validateCrossLinkReferences(doc, {
    funnelDocuments: { 'a.funnel.json': funnelDoc() },
    architectureDocuments: {},
  });
  assert.match(problems[0], /unknown Architecture document "missing.architecture.json"/);
});

// ---------------------------------------------------------------------------
// Many-to-many is not over-constrained

test('a Stage may have multiple links, and a component may support multiple journeys', () => {
  const doc = crossLinkDoc([
    baseLink({ id: 'l1', architecture: { document: 'b.architecture.json', componentId: 'api', level: 'hld' } }),
    baseLink({ id: 'l2', architecture: { document: 'b.architecture.json', componentId: 'gateway', level: 'hld' } }),
    baseLink({ id: 'l3', funnel: { document: 'other.funnel.json', stageId: 'checkout' }, architecture: { document: 'b.architecture.json', componentId: 'api', level: 'hld' } }),
  ]);
  assert.equal(linksForStage(doc, 'a.funnel.json', 'checkout').length, 2);
  assert.equal(linksForComponent(doc, 'b.architecture.json', 'api', 'hld').length, 2);
});

// ---------------------------------------------------------------------------
// Forward and reverse lookup symmetry

test('linksForStage and linksForComponent are two views of the same underlying links (forward/reverse symmetry)', () => {
  const doc = crossLinkDoc([baseLink()]);
  const forward = linksForStage(doc, 'a.funnel.json', 'checkout');
  const reverse = linksForComponent(doc, 'b.architecture.json', 'api', 'hld');
  assert.equal(forward.length, 1);
  assert.equal(reverse.length, 1);
  assert.equal(forward[0], reverse[0]);
});

// ---------------------------------------------------------------------------
// Href safety: never an arbitrary executable URL

test('safeCrossLinkHref accepts only a relative local .html file, optionally with a #focus=id fragment', () => {
  assert.equal(safeCrossLinkHref('web-app-rendered.html'), 'web-app-rendered.html');
  assert.equal(safeCrossLinkHref('web-app-rendered.html#focus=api'), 'web-app-rendered.html#focus=api');
});

test('safeCrossLinkHref rejects absolute URLs, javascript:, data:, and any non-html target', () => {
  assert.equal(safeCrossLinkHref('https://example.com/evil.html'), null);
  assert.equal(safeCrossLinkHref('javascript:alert(1)'), null);
  assert.equal(safeCrossLinkHref('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(safeCrossLinkHref('../../etc/passwd'), null);
  assert.equal(safeCrossLinkHref('not-html.txt'), null);
  assert.equal(safeCrossLinkHref(42), null);
  assert.equal(safeCrossLinkHref(undefined), null);
});

test('resolveArchitectureHref produces a safe href using the Architecture document\'s own meta.output', () => {
  const link = baseLink({ architecture: { document: 'b.architecture.json', componentId: 'api', level: 'hld' } });
  const href = resolveArchitectureHref(link, { 'b.architecture.json': architectureDoc() });
  assert.equal(href, 'web-app-rendered.html#focus=api');
});

test('resolveFunnelHref (reverse direction) produces a safe href back to the Funnel Stage', () => {
  const link = baseLink({ funnel: { document: 'a.funnel.json', stageId: 'checkout' } });
  const href = resolveFunnelHref(link, { 'a.funnel.json': { meta: { output: 'first-purchase.html' } } });
  assert.equal(href, 'first-purchase.html#focus=checkout');
});

// ---------------------------------------------------------------------------
// Independent validity: a Funnel document renders fully with no Cross-Link
// file present, and is unaffected when one is (forward, end-to-end).

test('a Funnel document with no --cross-link flag renders identically to before Cross-Link existed', () => {
  const doc = funnelDoc();
  const id = (sequence += 1);
  const inputPath = path.join(tmp, `f-${id}.funnel.json`);
  fs.writeFileSync(inputPath, JSON.stringify(doc));
  const outputPath = path.join(tmp, `f-${id}.html`);
  execFileSync('node', [renderer, inputPath, outputPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  const html = fs.readFileSync(outputPath, 'utf8');
  assert.doesNotMatch(html, /&quot;tag&quot;:&quot;HLD&quot;|&quot;tag&quot;:&quot;LLD&quot;/);
});

test('end to end: a real --cross-link file produces a working, safe navigation link in the Funnel Passport', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-cross-link-e2e-'));
  fs.writeFileSync(path.join(dir, 'a.funnel.json'), JSON.stringify(funnelDoc()));
  fs.writeFileSync(path.join(dir, 'b.architecture.json'), JSON.stringify(architectureDoc()));
  fs.writeFileSync(path.join(dir, 'link.cross-link.json'), JSON.stringify(crossLinkDoc([baseLink()])));
  const outputPath = path.join(dir, 'out.html');
  execFileSync('node', [
    renderer, path.join(dir, 'a.funnel.json'), outputPath, '--cross-link', path.join(dir, 'link.cross-link.json'),
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const html = fs.readFileSync(outputPath, 'utf8');
  assert.match(html, /&quot;href&quot;:&quot;web-app-rendered\.html#focus=api&quot;/);
  assert.match(html, /&quot;tag&quot;:&quot;HLD&quot;/);
});

test('end to end: an invalid --cross-link reference fails the render with a clear diagnostic rather than silently rendering', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-cross-link-e2e-bad-'));
  fs.writeFileSync(path.join(dir, 'a.funnel.json'), JSON.stringify(funnelDoc()));
  fs.writeFileSync(path.join(dir, 'b.architecture.json'), JSON.stringify(architectureDoc()));
  fs.writeFileSync(path.join(dir, 'link.cross-link.json'), JSON.stringify(crossLinkDoc([baseLink({ funnel: { document: 'a.funnel.json', stageId: 'no-such-stage' } })])));
  assert.throws(() => execFileSync('node', [
    renderer, path.join(dir, 'a.funnel.json'), path.join(dir, 'out.html'), '--cross-link', path.join(dir, 'link.cross-link.json'),
  ], { stdio: 'pipe' }));
});

test('rendering with --cross-link does not mutate the Funnel, Architecture, or Cross-Link source files on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-cross-link-immutability-'));
  const funnelText = JSON.stringify(funnelDoc(), null, 2);
  const architectureText = JSON.stringify(architectureDoc(), null, 2);
  const crossLinkText = JSON.stringify(crossLinkDoc([baseLink()]), null, 2);
  fs.writeFileSync(path.join(dir, 'a.funnel.json'), funnelText);
  fs.writeFileSync(path.join(dir, 'b.architecture.json'), architectureText);
  fs.writeFileSync(path.join(dir, 'link.cross-link.json'), crossLinkText);
  execFileSync('node', [
    renderer, path.join(dir, 'a.funnel.json'), path.join(dir, 'out.html'), '--cross-link', path.join(dir, 'link.cross-link.json'),
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  assert.equal(fs.readFileSync(path.join(dir, 'a.funnel.json'), 'utf8'), funnelText);
  assert.equal(fs.readFileSync(path.join(dir, 'b.architecture.json'), 'utf8'), architectureText);
  assert.equal(fs.readFileSync(path.join(dir, 'link.cross-link.json'), 'utf8'), crossLinkText);
});
