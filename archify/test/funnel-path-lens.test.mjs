// Part 2 (Workstream C): render-funnel.mjs's Path Lens — the presentation
// integration of renderers/funnel/path-to-conversion.mjs's pure traversal.
// The traversal algorithm itself (BFS correctness, cycles, determinism) is
// covered by test/path-to-conversion.test.mjs and is not re-tested here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const renderer = path.join(skillRoot, 'renderers/funnel/render-funnel.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-path-lens-'));
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;
const chromeTest = (name, fn) => test(name, {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, fn);
let sequence = 0;

function withConversion(overrides = {}) {
  return {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'path lens fixture' },
    stages: [
      { id: 'discovery', label: 'Discovery' },
      { id: 'browse', label: 'Browse' },
      { id: 'checkout', label: 'Checkout' },
      { id: 'confirmed', label: 'Confirmed', outcome: 'conversion' },
      { id: 'abandoned', label: 'Abandoned', outcome: 'dropoff' },
    ],
    transitions: [
      { id: 't1', from: 'discovery', to: 'browse' },
      { id: 't2', from: 'browse', to: 'checkout' },
      { id: 't3', from: 'checkout', to: 'confirmed' },
      { id: 't4', from: 'checkout', to: 'abandoned' },
    ],
    ...overrides,
  };
}

function withoutConversion() {
  return {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'no conversion fixture' },
    stages: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    transitions: [{ id: 't1', from: 'a', to: 'b' }],
  };
}

function render(doc) {
  const id = (sequence += 1);
  const inputPath = path.join(tmp, `doc-${id}.funnel.json`);
  const outputPath = path.join(tmp, `doc-${id}.html`);
  fs.writeFileSync(inputPath, JSON.stringify(doc));
  execFileSync('node', [renderer, inputPath, outputPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  return { html: fs.readFileSync(outputPath, 'utf8'), outputPath };
}

// ---------------------------------------------------------------------------
// Backward compatibility: no conversion stage -> no Path Lens markup at all.

test('a document with no conversion-outcome Stage renders no Path Lens markup at all', () => {
  const { html } = render(withoutConversion());
  assert.doesNotMatch(html, /funnel-path-lens/);
  assert.doesNotMatch(html, /funnel-path-select/);
});

test('a document with a conversion Stage renders the Path Lens control and precomputed data', () => {
  const { html } = render(withConversion());
  assert.match(html, /id="funnel-path-lens"/);
  assert.match(html, /id="funnel-path-select"/);
  assert.match(html, /<option value="discovery">Discovery<\/option>/);
  assert.match(html, /"confirmed":\{"reachable":true/);
});

// ---------------------------------------------------------------------------
// Accessibility: labeled control, live status region, real <select>/<button>
// (natively keyboard-operable), no color-only signal (a text status is
// always produced alongside the opacity-based highlight).

test('the Path Lens control has an accessible group label, a labeled select, and a live status region', () => {
  const { html } = render(withConversion());
  assert.match(html, /role="group" aria-label="Path to conversion"/);
  assert.match(html, /<label for="funnel-path-select">Path to conversion<\/label>/);
  assert.match(html, /<select id="funnel-path-select">/);
  assert.match(html, /id="funnel-path-status" aria-live="polite"/);
});

// ---------------------------------------------------------------------------
// Export/print: the lens is marked no-print, exactly like Persona Lens, and
// carries no runtime-state attribute in its static markup (data-path-active
// only ever appears via client-side script, never authored into the file).

test('the Path Lens is excluded from print, matching the existing no-print convention', () => {
  const { html } = render(withConversion());
  assert.match(html, /class="funnel-path-lens no-print"/);
});

test('the static rendered file carries no data-path-active attribute (runtime-only state)', () => {
  const { html } = render(withConversion());
  assert.doesNotMatch(html, /<g[^>]* data-path-active/);
  assert.doesNotMatch(html, /<svg[^>]* data-path-active/);
});

// ---------------------------------------------------------------------------
// Determinism / source immutability at the renderer level.

test('rendering with a Path Lens does not mutate the source Funnel document on disk', () => {
  const doc = withConversion();
  const id = (sequence += 1);
  const inputPath = path.join(tmp, `immutable-${id}.funnel.json`);
  const text = JSON.stringify(doc, null, 2);
  fs.writeFileSync(inputPath, text);
  execFileSync('node', [renderer, inputPath, path.join(tmp, `immutable-${id}.html`)], { stdio: ['ignore', 'ignore', 'pipe'] });
  assert.equal(fs.readFileSync(inputPath, 'utf8'), text);
});

test('rendering twice from the same source produces byte-identical output', () => {
  const doc = withConversion();
  const id = (sequence += 1);
  const inputPath = path.join(tmp, `det-${id}.funnel.json`);
  fs.writeFileSync(inputPath, JSON.stringify(doc));
  const out1 = path.join(tmp, `det-${id}-1.html`);
  const out2 = path.join(tmp, `det-${id}-2.html`);
  execFileSync('node', [renderer, inputPath, out1], { stdio: ['ignore', 'ignore', 'pipe'] });
  execFileSync('node', [renderer, inputPath, out2], { stdio: ['ignore', 'ignore', 'pipe'] });
  assert.equal(fs.readFileSync(out1, 'utf8'), fs.readFileSync(out2, 'utf8'));
});

// ---------------------------------------------------------------------------
// 13/14. Explore/Passport coexistence: selecting a Persona or focusing a
// Stage for its Passport must not be disturbed by the Path Lens existing on
// the same page, and vice versa (independent attribute names, exactly like
// Persona Lens's own isolation from Semantic Lens).

test('Path Lens and Persona Lens use entirely independent attribute names', () => {
  const { html } = render(withConversion({
    personas: [{ id: 'p1', label: 'Shopper' }],
    stages: withConversion().stages.map((stage) => ({ ...stage, personas: stage.id === 'confirmed' ? ['p1'] : undefined })),
  }));
  assert.match(html, /data-path-active/);
  assert.match(html, /data-persona-active/);
  // Neither script's variable/attribute names overlap.
  assert.doesNotMatch(html, /data-path-match.*data-persona-match|data-persona-match.*data-path-match/);
});

chromeTest('selecting a Path and focusing a Stage for its Passport work independently on the same page', async () => {
  const { outputPath } = render(withConversion());
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await browser.sessionPromise;
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
    await browser.cdp.send('Page.navigate', { url: pathToFileURL(outputPath).href }, sessionId);
    await loaded;
    const evaluate = async (expression) => {
      const response = await browser.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || 'eval failed');
      return response.result?.value;
    };
    await evaluate(`(function(){ var s=document.getElementById('funnel-path-select'); s.value='discovery'; s.dispatchEvent(new Event('change')); })()`);
    await evaluate(`document.getElementById('node-checkout').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))`);
    const state = await evaluate(`({
      pathActive: document.getElementById('funnel-overview-svg').getAttribute('data-path-active'),
      passportHidden: document.getElementById('focus-detail-groups').hidden,
      focusedId: document.getElementById('funnel-overview-svg').getAttribute('data-focus-active')
    })`);
    assert.equal(state.pathActive, 'discovery');
    assert.equal(state.focusedId, 'checkout');
  } finally {
    await browser.close();
  }
});

chromeTest('a viewer is told when more than one conversion point is reachable, never implying just one route', async () => {
  const doc = withConversion({
    stages: [
      ...withConversion().stages,
      { id: 'confirmedAlt', label: 'Confirmed (alt)', outcome: 'conversion' },
    ],
    transitions: [
      ...withConversion().transitions,
      { id: 't5', from: 'browse', to: 'confirmedAlt' },
    ],
  });
  const { outputPath } = render(doc);
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await browser.sessionPromise;
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
    await browser.cdp.send('Page.navigate', { url: pathToFileURL(outputPath).href }, sessionId);
    await loaded;
    const evaluate = async (expression) => {
      const response = await browser.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || 'eval failed');
      return response.result?.value;
    };
    await evaluate(`(function(){ var s=document.getElementById('funnel-path-select'); s.value='discovery'; s.dispatchEvent(new Event('change')); })()`);
    const status = await evaluate(`document.getElementById('funnel-path-status').textContent`);
    assert.match(status, /other conversion point/);
  } finally {
    await browser.close();
  }
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
