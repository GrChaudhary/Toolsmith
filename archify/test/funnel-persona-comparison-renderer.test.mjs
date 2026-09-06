// Part 2 (Workstream D): render-funnel.mjs's Multi-Persona comparison UI.
// The classification rule itself is covered by
// test/funnel-persona-comparison.test.mjs and is not re-tested here.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-persona-compare-'));
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;
const chromeTest = (name, fn) => test(name, {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, fn);
let sequence = 0;

function docWithPersonas(overrides = {}) {
  return {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'persona comparison fixture' },
    personas: [
      { id: 'newCustomer', label: 'New Customer' },
      { id: 'returningCustomer', label: 'Returning Customer' },
    ],
    stages: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B', personas: ['newCustomer'] },
      { id: 'c', label: 'C', personas: ['returningCustomer'] },
      { id: 'd', label: 'D' },
    ],
    transitions: [
      { id: 't1', from: 'a', to: 'b' },
      { id: 't2', from: 'a', to: 'c' },
      { id: 't3', from: 'b', to: 'd' },
      { id: 't4', from: 'c', to: 'd' },
    ],
    ...overrides,
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

async function withPage(outputPath, run) {
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
    await run(evaluate);
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// D1: single-persona mode preserved exactly; comparison only appears at 2+.

test('a document with fewer than two Personas renders no comparison UI', () => {
  const single = docWithPersonas({ personas: [{ id: 'newCustomer', label: 'New Customer' }], stages: docWithPersonas().stages.map((s) => ({ ...s, personas: undefined })) });
  const { html } = render(single);
  assert.doesNotMatch(html, /funnel-persona-compare/);
  // Single-Persona Lens itself is still present, unchanged.
  assert.match(html, /id="funnel-persona-lens"/);
});

test('the existing single-Persona script is byte-for-byte present, unmodified, when comparison UI also renders', () => {
  const { html } = render(docWithPersonas());
  assert.match(html, /function clearPersona\(\)/);
  assert.match(html, /svg\.removeAttribute\('data-persona-active'\)/);
  assert.match(html, /if \(applicable\[from\] && applicable\[to\]\) edge\.setAttribute\('data-persona-match', ''\); else edge\.removeAttribute\('data-persona-match'\);/);
});

// ---------------------------------------------------------------------------
// D2/13/14: no Stage duplication, exactly one node per authored Stage.

test('comparison UI introduces no new Stage nodes — exactly one <g data-node-id> per authored Stage', () => {
  const { html } = render(docWithPersonas());
  const svg = html.match(/<svg[\s\S]*?<\/svg>/)[0];
  assert.equal([...svg.matchAll(/<g [^>]*data-node-id=/g)].length, 4);
  assert.doesNotMatch(html, /persona-lane/);
});

// ---------------------------------------------------------------------------
// D6: multiple checkboxes, accessible group, clear control.

test('the comparison picker offers one checkbox per Persona with an accessible group label', () => {
  const { html } = render(docWithPersonas());
  assert.match(html, /role="group" aria-label="Select personas to compare"/);
  assert.match(html, /data-compare-persona="newCustomer"/);
  assert.match(html, /data-compare-persona="returningCustomer"/);
  assert.match(html, /id="funnel-persona-compare-clear"/);
});

test('the compare toggle is a real button with aria-pressed/aria-expanded (keyboard-operable, no color-only state)', () => {
  const { html } = render(docWithPersonas());
  assert.match(html, /id="funnel-persona-compare-toggle" aria-pressed="false" aria-expanded="false" aria-controls="funnel-persona-compare-picker"/);
});

// ---------------------------------------------------------------------------
// D7: reuses the existing visual system (personaVisualToken swatches,
// opacity-based dimming) rather than a new one.

test('comparison checkboxes reuse the exact same personaVisualToken swatch Persona Lens buttons already use', () => {
  const { html } = render(docWithPersonas());
  const lensSwatch = html.match(/data-persona-button="newCustomer"[\s\S]*?background-color:var\((--[a-z]+-stroke)\)/)[1];
  const compareSwatch = html.match(/data-compare-persona="newCustomer"[\s\S]*?background-color:var\((--[a-z]+-stroke)\)/)[1];
  assert.equal(lensSwatch, compareSwatch);
});

// ---------------------------------------------------------------------------
// Export/print + determinism + source immutability.

test('the comparison UI is excluded from print, matching the existing no-print convention', () => {
  const { html } = render(docWithPersonas());
  assert.match(html, /class="funnel-persona-compare no-print"/);
});

test('rendering does not mutate the source document and is deterministic', () => {
  const doc = docWithPersonas();
  const id = (sequence += 1);
  const inputPath = path.join(tmp, `det-${id}.funnel.json`);
  const text = JSON.stringify(doc, null, 2);
  fs.writeFileSync(inputPath, text);
  const out1 = path.join(tmp, `det-${id}-1.html`);
  const out2 = path.join(tmp, `det-${id}-2.html`);
  execFileSync('node', [renderer, inputPath, out1], { stdio: ['ignore', 'ignore', 'pipe'] });
  execFileSync('node', [renderer, inputPath, out2], { stdio: ['ignore', 'ignore', 'pipe'] });
  assert.equal(fs.readFileSync(inputPath, 'utf8'), text);
  assert.equal(fs.readFileSync(out1, 'utf8'), fs.readFileSync(out2, 'utf8'));
});

// ---------------------------------------------------------------------------
// Live, browser-verified behavior: 1/2/3+ personas, shared/divergent,
// reconvergence, generally-applicable, explicit non-match, clear/reset,
// Explore/Passport integration, Story compatibility.

chromeTest('two selected personas classify shared vs divergent Stages correctly and report counts', async () => {
  const { outputPath } = render(docWithPersonas());
  await withPage(outputPath, async (evaluate) => {
    await evaluate(`document.getElementById('funnel-persona-compare-toggle').click()`);
    await evaluate(`(function(){
      document.querySelectorAll('[data-compare-persona]').forEach(function(b){ b.checked = true; b.dispatchEvent(new Event('change')); });
    })()`);
    const state = await evaluate(`(function(){
      var svg = document.getElementById('funnel-overview-svg');
      return {
        a: document.getElementById('node-a').getAttribute('data-persona-compare-state'),
        b: document.getElementById('node-b').getAttribute('data-persona-compare-state'),
        c: document.getElementById('node-c').getAttribute('data-persona-compare-state'),
        d: document.getElementById('node-d').getAttribute('data-persona-compare-state'),
        status: document.getElementById('funnel-persona-compare-status').textContent
      };
    })()`);
    assert.equal(state.a, 'shared'); // generally applicable
    assert.equal(state.b, 'divergent');
    assert.equal(state.c, 'divergent');
    assert.equal(state.d, 'shared'); // reconvergence
    assert.match(state.status, /2 shared/);
    assert.match(state.status, /2 divergent/);
  });
});

chromeTest('three or more personas: a Stage must apply to every one of them to be shared', async () => {
  const doc = docWithPersonas({
    personas: [
      { id: 'p1', label: 'P1' },
      { id: 'p2', label: 'P2' },
      { id: 'p3', label: 'P3' },
    ],
    stages: [
      { id: 'a', label: 'A', personas: ['p1', 'p2'] },
      { id: 'b', label: 'B', personas: ['p1', 'p2', 'p3'] },
    ],
    transitions: [{ id: 't1', from: 'a', to: 'b' }],
  });
  const { outputPath } = render(doc);
  await withPage(outputPath, async (evaluate) => {
    await evaluate(`document.getElementById('funnel-persona-compare-toggle').click()`);
    await evaluate(`(function(){
      document.querySelectorAll('[data-compare-persona]').forEach(function(b){ b.checked = true; b.dispatchEvent(new Event('change')); });
    })()`);
    const state = await evaluate(`({
      a: document.getElementById('node-a').getAttribute('data-persona-compare-state'),
      b: document.getElementById('node-b').getAttribute('data-persona-compare-state')
    })`);
    assert.equal(state.a, 'divergent'); // not applicable to p3
    assert.equal(state.b, 'shared');
  });
});

chromeTest('an explicit non-match is reported as "none" and excluded from the highlight', async () => {
  const doc = docWithPersonas({
    personas: [...docWithPersonas().personas, { id: 'someOtherPersona', label: 'Other' }],
    stages: [...docWithPersonas().stages, { id: 'e', label: 'E', personas: ['someOtherPersona'] }],
  });
  const { outputPath } = render(doc);
  await withPage(outputPath, async (evaluate) => {
    await evaluate(`document.getElementById('funnel-persona-compare-toggle').click()`);
    // Select only the original two personas — 'someOtherPersona' stays
    // unchecked, so Stage 'e' (restricted to someOtherPersona) is
    // applicable to none of the selected set.
    await evaluate(`(function(){
      ['newCustomer', 'returningCustomer'].forEach(function (id) {
        var box = document.querySelector('[data-compare-persona="' + id + '"]');
        box.checked = true;
        box.dispatchEvent(new Event('change'));
      });
    })()`);
    const state = await evaluate(`document.getElementById('node-e').getAttribute('data-persona-compare-state')`);
    assert.equal(state, null);
    const status = await evaluate(`document.getElementById('funnel-persona-compare-status').textContent`);
    assert.match(status, /1 not applicable/);
  });
});

chromeTest('clearing the comparison removes all highlight state and restores the status message', async () => {
  const { outputPath } = render(docWithPersonas());
  await withPage(outputPath, async (evaluate) => {
    await evaluate(`document.getElementById('funnel-persona-compare-toggle').click()`);
    await evaluate(`(function(){
      document.querySelectorAll('[data-compare-persona]').forEach(function(b){ b.checked = true; b.dispatchEvent(new Event('change')); });
    })()`);
    await evaluate(`document.getElementById('funnel-persona-compare-clear').click()`);
    const state = await evaluate(`({
      active: document.getElementById('funnel-overview-svg').getAttribute('data-persona-compare-active'),
      remaining: document.querySelectorAll('[data-persona-compare-state]').length
    })`);
    assert.equal(state.active, null);
    assert.equal(state.remaining, 0);
  });
});

chromeTest('turning comparison mode off restores single-Persona Lens interactivity', async () => {
  const { outputPath } = render(docWithPersonas());
  await withPage(outputPath, async (evaluate) => {
    await evaluate(`document.getElementById('funnel-persona-compare-toggle').click()`);
    let disabled = await evaluate(`document.querySelector('[data-persona-button]').disabled`);
    assert.equal(disabled, true);
    await evaluate(`document.getElementById('funnel-persona-compare-toggle').click()`);
    disabled = await evaluate(`document.querySelector('[data-persona-button]').disabled`);
    assert.equal(disabled, false);
    // Single-select still works after leaving comparison mode.
    await evaluate(`document.querySelector('[data-persona-button="newCustomer"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    const active = await evaluate(`document.getElementById('funnel-overview-svg').getAttribute('data-persona-active')`);
    assert.equal(active, 'newCustomer');
  });
});

chromeTest('entering comparison mode clears an active single-Persona selection so the two never highlight simultaneously', async () => {
  const { outputPath } = render(docWithPersonas());
  await withPage(outputPath, async (evaluate) => {
    await evaluate(`document.querySelector('[data-persona-button="newCustomer"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    let active = await evaluate(`document.getElementById('funnel-overview-svg').getAttribute('data-persona-active')`);
    assert.equal(active, 'newCustomer');
    await evaluate(`document.getElementById('funnel-persona-compare-toggle').click()`);
    active = await evaluate(`document.getElementById('funnel-overview-svg').getAttribute('data-persona-active')`);
    assert.equal(active, null);
  });
});

chromeTest('Explore/Passport focus works normally while comparison mode is active', async () => {
  const { outputPath } = render(docWithPersonas());
  await withPage(outputPath, async (evaluate) => {
    await evaluate(`document.getElementById('funnel-persona-compare-toggle').click()`);
    await evaluate(`document.getElementById('node-a').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))`);
    const focused = await evaluate(`document.getElementById('funnel-overview-svg').getAttribute('data-focus-active')`);
    assert.equal(focused, 'a');
  });
});

chromeTest('Story/Guided View playback is unaffected by the presence of the comparison UI', async () => {
  const doc = docWithPersonas({ meta: { title: 'x', views: [{ id: 'c1', label: 'Chapter', focus: ['a'] }] } });
  const { outputPath } = render(doc);
  await withPage(outputPath, async (evaluate) => {
    await evaluate(`document.querySelector('[data-guided-view-id]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    const focusActive = await evaluate(`document.getElementById('funnel-overview-svg').getAttribute('data-focus-active')`);
    assert.equal(focusActive, 'a');
  });
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
