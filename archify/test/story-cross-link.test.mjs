// Part 2 (Workstream B): Story/Guided View -> Cross-Link integration.
// assets/template.html's Guided View chapter activation deliberately hides
// the full Semantic Passport (Archify.focus.setMany's hideChip:true, see
// activate()/selectStoryBeat()) even for a single-Stage chapter, so the
// existing forward Cross-Link Passport group (Workstream D of Phase 16) is
// not reachable during chapter playback on its own. This adds one small,
// generic surface instead: storyStep() (assets/template.html) reads any
// href-bearing item already present in a node's existing
// data-node-detail-groups attribute (today, only Cross-Link produces one)
// and renderStoryCaption() shows it as a real link in the per-beat caption
// bar. No Story-specific field is added to the Funnel schema, no Cross-Link
// reference is added to Funnel stages, and no new navigation mechanism is
// introduced — this is the same #focus= deep link Cross-Link's forward
// direction already uses.
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
const funnelRenderer = path.join(skillRoot, 'renderers/funnel/render-funnel.mjs');
const archRenderer = path.join(skillRoot, 'renderers/architecture/render-architecture.mjs');
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;
const chromeTest = (name, fn) => test(name, {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, fn);

function scenario() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'archify-story-cross-link-'));
}

function funnelDoc(overrides = {}) {
  return {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: {
      title: 'story cross-link fixture',
      output: 'a.html',
      views: [{ id: 'c1', label: 'Checkout chapter', focus: ['checkout'] }],
      ...overrides.meta,
    },
    stages: [
      { id: 'browse', label: 'Browse' },
      { id: 'checkout', label: 'Checkout' },
      { id: 'confirmed', label: 'Confirmed', outcome: 'conversion' },
    ],
    transitions: [{ id: 't1', from: 'browse', to: 'checkout' }, { id: 't2', from: 'checkout', to: 'confirmed' }],
  };
}

function architectureDoc(overrides = {}) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'story cross-link architecture fixture', output: 'b.html' },
    components: [
      { id: 'checkoutSvc', type: 'backend', label: 'Checkout Service', pos: [40, 40], size: [120, 60] },
      { id: 'inventorySvc', type: 'backend', label: 'Inventory Service', pos: [220, 40], size: [120, 60] },
    ],
    connections: [],
    ...overrides,
  };
}

function crossLinkDoc(links) {
  return { schema_version: 1, diagram_type: 'cross-link', meta: { title: 'story cross-link fixture' }, links };
}

function link(overrides = {}) {
  return {
    id: 'link1',
    funnel: { document: 'a.funnel.json', stageId: 'checkout' },
    architecture: { document: 'b.architecture.json', componentId: 'checkoutSvc', level: 'hld' },
    ...overrides,
  };
}

function writeScenario(dir, { funnel = funnelDoc(), architecture = architectureDoc(), links } = {}) {
  fs.writeFileSync(path.join(dir, 'a.funnel.json'), JSON.stringify(funnel));
  fs.writeFileSync(path.join(dir, 'b.architecture.json'), JSON.stringify(architecture));
  if (links) fs.writeFileSync(path.join(dir, 'link.cross-link.json'), JSON.stringify(crossLinkDoc(links)));
}

function renderFunnel(dir, useCrossLink) {
  const output = path.join(dir, 'a.html');
  const args = [funnelRenderer, path.join(dir, 'a.funnel.json'), output];
  if (useCrossLink) args.push('--cross-link', path.join(dir, 'link.cross-link.json'));
  execFileSync('node', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  return output;
}

function renderArchitecture(dir, useCrossLink) {
  const output = path.join(dir, 'b.html');
  const args = [archRenderer, path.join(dir, 'b.architecture.json'), output];
  if (useCrossLink) args.push('--cross-link', path.join(dir, 'link.cross-link.json'));
  execFileSync('node', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  return output;
}

// ---------------------------------------------------------------------------
// Static/structural coverage (no browser required): the generic template
// mechanism this workstream adds.

test('assets/template.html carries one generic, diagram-type-agnostic story-caption-links mechanism', () => {
  const templateSource = fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8');
  assert.match(templateSource, /function storyStepLinks\(node\)/);
  assert.match(templateSource, /function renderStoryCaptionLinks\(step\)/);
  // Reuses the exact same relative-local-html(+#focus=id)-only pattern
  // enforced server-side and by renderDetailGroups() — not a looser
  // Story-specific rule.
  const occurrences = (templateSource.match(/\^\[A-Za-z0-9_\]\[A-Za-z0-9_\\-\.\/\]\*\\\.html\(#focus=\[A-Za-z0-9_-\]\+\)\?\$/g) || []).length;
  assert.equal(occurrences, 2, 'the href-safety pattern should appear exactly twice: once in renderDetailGroups, once in storyStepLinks');
});

// ---------------------------------------------------------------------------
// 1, 3, 8. Story with no Cross-Link artifact: unchanged behavior.

chromeTest('a Stage with no Cross-Link links shows no caption links, and story playback is otherwise unchanged', async () => {
  const dir = scenario();
  writeScenario(dir);
  const output = renderFunnel(dir, false);
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await browser.sessionPromise;
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
    await browser.cdp.send('Page.navigate', { url: pathToFileURL(output).href }, sessionId);
    await loaded;
    const evaluate = async (expression) => {
      const response = await browser.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || 'eval failed');
      return response.result?.value;
    };
    await evaluate(`document.querySelector('[data-guided-view-id]').click()`);
    await evaluate(`document.querySelector('[data-story-node]').click()`);
    const state = await evaluate(`(function(){
      var links = document.getElementById('guided-story-caption-links');
      var route = document.getElementById('guided-story-caption-route');
      return { linksHidden: links.hidden, linksChildCount: links.children.length, route: route.textContent };
    })()`);
    assert.equal(state.linksHidden, true);
    assert.equal(state.linksChildCount, 0);
    assert.equal(state.route, 'Checkout · Starting point');
  } finally {
    await browser.close();
  }
});

// ---------------------------------------------------------------------------
// 2, 4. Story with a Cross-Link artifact; Stage with an HLD link.

chromeTest('a Stage with an HLD Cross-Link surfaces a working link in the story caption', async () => {
  const dir = scenario();
  writeScenario(dir, { links: [link({ architecture: { document: 'b.architecture.json', componentId: 'checkoutSvc', level: 'hld' } })] });
  renderArchitecture(dir, true);
  const output = renderFunnel(dir, true);
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await browser.sessionPromise;
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
    await browser.cdp.send('Page.navigate', { url: pathToFileURL(output).href }, sessionId);
    await loaded;
    const evaluate = async (expression) => {
      const response = await browser.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || 'eval failed');
      return response.result?.value;
    };
    await evaluate(`document.querySelector('[data-guided-view-id]').click()`);
    await evaluate(`document.querySelector('[data-story-node]').click()`);
    const state = await evaluate(`(function(){
      var links = document.getElementById('guided-story-caption-links');
      var a = links.querySelector('a');
      return { hidden: links.hidden, href: a ? a.getAttribute('href') : null, text: a ? a.textContent : null };
    })()`);
    assert.equal(state.hidden, false);
    assert.equal(state.href, 'b.html#focus=checkoutSvc');
    // The caption link's visible text is the detail-group's own title
    // (crosslink.detail.architecture = "Architecture" on the Funnel side) —
    // the same group Explore's Passport already shows, not new copy.
    assert.equal(state.text, 'Architecture');
  } finally {
    await browser.close();
  }
});

// ---------------------------------------------------------------------------
// 5. Stage with an LLD link.

test('an LLD-level link produces a safe href and passes through storyStepLinks unchanged in shape', () => {
  const dir = scenario();
  writeScenario(dir, { links: [link({ architecture: { document: 'b.architecture.json', componentId: 'checkoutSvc', level: 'lld' } })] });
  renderArchitecture(dir, true);
  const html = fs.readFileSync(renderFunnel(dir, true), 'utf8');
  const attrs = html.match(/data-node-id="checkout"[^>]*/)[0];
  assert.match(attrs, /&quot;tag&quot;:&quot;LLD&quot;/);
  assert.match(attrs, /&quot;href&quot;:&quot;b\.html#focus=checkoutSvc&quot;/);
});

// ---------------------------------------------------------------------------
// 6. Stage with multiple Architecture links.

chromeTest('a Stage linked to multiple Architecture components shows one caption link per component', async () => {
  const dir = scenario();
  writeScenario(dir, {
    links: [
      link({ id: 'l1', architecture: { document: 'b.architecture.json', componentId: 'checkoutSvc', level: 'hld' } }),
      link({ id: 'l2', architecture: { document: 'b.architecture.json', componentId: 'inventorySvc', level: 'hld' } }),
    ],
  });
  renderArchitecture(dir, true);
  const output = renderFunnel(dir, true);
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await browser.sessionPromise;
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
    await browser.cdp.send('Page.navigate', { url: pathToFileURL(output).href }, sessionId);
    await loaded;
    const evaluate = async (expression) => {
      const response = await browser.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || 'eval failed');
      return response.result?.value;
    };
    await evaluate(`document.querySelector('[data-guided-view-id]').click()`);
    await evaluate(`document.querySelector('[data-story-node]').click()`);
    const hrefs = await evaluate(`Array.prototype.map.call(document.getElementById('guided-story-caption-links').children, function (a) { return a.getAttribute('href'); })`);
    // Both links live in the same Passport group ("Architecture"), but each
    // is its own item with its own component/href, so each renders as its
    // own caption link — one per linked Architecture component.
    assert.deepEqual(hrefs.sort(), ['b.html#focus=checkoutSvc', 'b.html#focus=inventorySvc']);
  } finally {
    await browser.close();
  }
});

// ---------------------------------------------------------------------------
// 7. Safe URL generation: an unsafe href never reaches the DOM as a link.

test('storyStepLinks only accepts the same relative-local-html(+#focus) pattern renderDetailGroups already enforces', () => {
  const templateSource = fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8');
  const fn = templateSource.match(/function storyStepLinks\(node\) \{[\s\S]*?\n      \}/)[0];
  assert.match(fn, /\/\^\[A-Za-z0-9_\]\[A-Za-z0-9_\\-\.\/\]\*\\\.html\(#focus=\[A-Za-z0-9_-\]\+\)\?\$\//);
});

// ---------------------------------------------------------------------------
// 9. Return navigation: the reverse Cross-Link group (Workstream A) is the
// return path, reusing the same #focus= deep link — no second routing
// system. Verified end to end in test/cross-link-reverse.test.mjs and (with
// a real browser) here for the full Story -> Architecture -> back round trip.

chromeTest('the full round trip works: story caption link -> Architecture Passport -> link back to the originating Stage', async () => {
  const dir = scenario();
  writeScenario(dir, { links: [link()] });
  renderArchitecture(dir, true);
  const output = renderFunnel(dir, true);
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await browser.sessionPromise;
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    let loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
    await browser.cdp.send('Page.navigate', { url: pathToFileURL(output).href }, sessionId);
    await loaded;
    const evaluate = async (expression) => {
      const response = await browser.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || 'eval failed');
      return response.result?.value;
    };
    await evaluate(`document.querySelector('[data-guided-view-id]').click()`);
    await evaluate(`document.querySelector('[data-story-node]').click()`);
    loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
    await evaluate(`document.querySelector('.guided-story-caption-link').click()`);
    await loaded;
    const onArchitecture = await evaluate(`({
      url: location.href,
      groupsHtml: document.getElementById('focus-detail-groups').innerHTML
    })`);
    assert.match(onArchitecture.url, /b\.html#focus=checkoutSvc$/);
    assert.match(onArchitecture.groupsHtml, /Used by customer journeys/);
    const backHref = await evaluate(`document.querySelector('#focus-detail-groups a').getAttribute('href')`);
    assert.equal(backHref, 'a.html#focus=checkout');
  } finally {
    await browser.close();
  }
});

process.on('exit', () => {});
