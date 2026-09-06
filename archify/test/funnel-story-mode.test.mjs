import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { funnel as validateFunnelSchema } from '../renderers/shared/generated-validators.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const renderer = path.join(skillRoot, 'renderers/funnel/render-funnel.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-funnel-story-'));
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
    meta: { title: 'story mode fixture' },
    stages: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    transitions: [{ id: 't1', from: 'a', to: 'b' }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Phase 16 baseline-audit fix: funnel.schema.json's meta previously omitted
// locale/output/visual_preset/views entirely, even though shared code
// (writeDiagram, translateMessage calls throughout render-funnel.mjs) has
// unconditionally read meta.locale/meta.output/meta.visual_preset since
// Phase 10/11. This means an authored meta.locale: "zh-CN" was, until this
// fix, rejected by schema validation for Funnel specifically — a genuine,
// previously undetected correctness gap (existing tests only ever passed a
// raw locale string as a function argument, never through actual schema
// validation of a real .funnel.json file).

test('meta.locale now validates for Funnel (previously rejected — the discovered gap)', () => {
  const doc = baseDoc({ meta: { title: 'x', locale: 'zh-CN' } });
  assert.equal(validateFunnelSchema(doc), true);
});

test('meta.output now validates for Funnel', () => {
  const doc = baseDoc({ meta: { title: 'x', output: 'custom.html' } });
  assert.equal(validateFunnelSchema(doc), true);
});

test('meta.visual_preset now validates for Funnel, using the same shared five-value enum every other diagram type uses', () => {
  for (const preset of ['classic', 'signal-flow', 'blueprint', 'editorial', 'contrast']) {
    assert.equal(validateFunnelSchema(baseDoc({ meta: { title: 'x', visual_preset: preset } })), true, preset);
  }
  assert.equal(validateFunnelSchema(baseDoc({ meta: { title: 'x', visual_preset: 'not-a-real-preset' } })), false);
});

test('meta.views now validates for Funnel using the same shared common.schema.json#/$defs/guidedViews shape', () => {
  const doc = baseDoc({
    meta: {
      title: 'x',
      views: [{ id: 'chapter1', label: 'Chapter 1', focus: ['a', 'b'] }],
    },
  });
  assert.equal(validateFunnelSchema(doc), true);
});

test('meta.animation now validates for Funnel using the same shared common.schema.json#/$defs/animation enum', () => {
  assert.equal(validateFunnelSchema(baseDoc({ meta: { title: 'x', animation: 'trace' } })), true);
  assert.equal(validateFunnelSchema(baseDoc({ meta: { title: 'x', animation: 'none' } })), true);
  assert.equal(validateFunnelSchema(baseDoc({ meta: { title: 'x', animation: 'not-a-real-value' } })), false);
});

test('meta still rejects a genuinely unsupported property (additionalProperties: false is preserved)', () => {
  const doc = baseDoc({ meta: { title: 'x', notARealField: 'nope' } });
  assert.equal(validateFunnelSchema(doc), false);
});

// ---------------------------------------------------------------------------
// End-to-end: an authored meta.views renders the existing, generic,
// already-fully-built Guided View / Story mode player — no new player code
// was written for this phase; only the schema gap above was fixed.

test('an authored meta.views renders the existing generic Guided View/Story controls for Funnel', () => {
  const html = renderDoc(baseDoc({
    meta: {
      title: 'x',
      views: [{ id: 'chapter1', label: 'Chapter 1', focus: ['a', 'b'], note: 'The whole path' }],
    },
  }));
  assert.match(html, /viewer\.guided\.region/);
  assert.match(html, /function.*[Gg]uided/);
  assert.match(html, /"chapter1"/);
  assert.match(html, /Chapter 1/);
});

test('meta.views with an unknown focus id is rejected by the existing generic validateGuidedViews (already wired for Funnel since Phase 9)', () => {
  const doc = baseDoc({
    meta: { title: 'x', views: [{ id: 'chapter1', label: 'Chapter 1', focus: ['a', 'does-not-exist'] }] },
  });
  const inputPath = path.join(tmp, `bad-${(sequence += 1)}.funnel.json`);
  fs.writeFileSync(inputPath, JSON.stringify(doc));
  assert.throws(() => execFileSync('node', [renderer, inputPath, path.join(tmp, 'bad.html')], { stdio: 'pipe' }));
});

test('a Funnel document with no meta.views renders with no guided-story content, same as before this phase', () => {
  const html = renderDoc(baseDoc());
  assert.match(html, /viewer\.guided\.noStory|This diagram has no authored guided story/);
});

// ---------------------------------------------------------------------------
// Runtime state (story playback position) is never part of the semantic
// document — it lives only in the viewer's own runtime script, the same
// generic Guided View machinery every other diagram type already relies on.

test('story playback state (currentStep/playing) has no corresponding Funnel schema field', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, 'schemas/funnel.schema.json'), 'utf8'));
  const text = JSON.stringify(schema);
  for (const forbidden of ['currentStep', 'playing', 'cameraPosition', 'animationProgress', 'presentationMode']) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

// ---------------------------------------------------------------------------
// Determinism / immutability

test('rendering a document with meta.views does not mutate the source file on disk', () => {
  const doc = baseDoc({ meta: { title: 'x', views: [{ id: 'c1', label: 'C1', focus: ['a'] }] } });
  const id = (sequence += 1);
  const inputPath = path.join(tmp, `immutability-${id}.funnel.json`);
  const originalText = JSON.stringify(doc, null, 2);
  fs.writeFileSync(inputPath, originalText);
  execFileSync('node', [renderer, inputPath, path.join(tmp, `immutability-${id}.html`)], { stdio: ['ignore', 'ignore', 'pipe'] });
  assert.equal(fs.readFileSync(inputPath, 'utf8'), originalText);
});

test('the bundled first-purchase example authors meta.views and renders Story mode content', () => {
  const outputPath = path.join(tmp, 'first-purchase.html');
  execFileSync('node', [renderer, path.join(skillRoot, 'examples/first-purchase.funnel.json'), outputPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  const html = fs.readFileSync(outputPath, 'utf8');
  assert.match(html, /"journey"/);
  assert.match(html, /The journey/);
});
