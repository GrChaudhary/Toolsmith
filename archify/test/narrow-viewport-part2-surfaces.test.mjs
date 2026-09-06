// Part 3 (E): dedicated narrow-viewport audit for the Toolsmith Part 2
// surfaces (reverse Cross-Link Passport, Path Lens, Multi-Persona
// comparison) at 320/360/390px. These surfaces did not exist when the
// original viewer-chrome-layout narrow-viewport coverage was written.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-narrow-viewport-'));
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;

const NARROW_WIDTHS = [320, 360, 390];

async function evaluate(browser, sessionId, expression) {
  const response = await browser.cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description
      || response.exceptionDetails.text
      || 'Runtime.evaluate failed');
  }
  return response.result?.value;
}

async function load(browser, artifactPath, width) {
  const sessionId = await browser.sessionPromise;
  await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height: 800,
    deviceScaleFactor: 1,
    mobile: true,
  }, sessionId);
  const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
  const navigation = await browser.cdp.send('Page.navigate', { url: pathToFileURL(artifactPath).href }, sessionId);
  if (navigation.errorText) throw new Error(`Chrome navigation failed: ${navigation.errorText}`);
  await loaded;
  await new Promise((resolve) => setTimeout(resolve, 300));
  return sessionId;
}

async function noHorizontalOverflow(browser, sessionId) {
  return evaluate(browser, sessionId, `({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  })`);
}

function renderFunnel(inputName) {
  const input = path.join(skillRoot, 'examples', inputName);
  const output = path.join(tmp, `${path.basename(inputName, '.json')}.html`);
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers', 'funnel', 'render-funnel.mjs'),
    input,
    output,
  ]);
  return output;
}

function renderArchitectureWithCrossLink() {
  const architectureInput = path.join(skillRoot, 'examples', 'web-app.architecture.json');
  const funnelInput = path.join(skillRoot, 'examples', 'first-purchase.funnel.json');
  const architectureCopy = path.join(tmp, 'web-app.architecture.json');
  const funnelCopy = path.join(tmp, 'first-purchase.funnel.json');
  fs.copyFileSync(architectureInput, architectureCopy);
  fs.copyFileSync(funnelInput, funnelCopy);
  const crossLinkPath = path.join(tmp, 'cross-link.json');
  fs.writeFileSync(crossLinkPath, JSON.stringify({
    schema_version: 1,
    diagram_type: 'cross-link',
    meta: { title: 'Narrow-viewport fixture' },
    links: [{
      id: 'link-1',
      funnel: { document: 'first-purchase.funnel.json', stageId: 'browse' },
      architecture: { document: 'web-app.architecture.json', componentId: 'api', level: 'hld' },
      note: 'Checkout flow',
    }],
  }));
  const output = path.join(tmp, 'web-app-cross-link.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers', 'architecture', 'render-architecture.mjs'),
    architectureCopy,
    output,
    '--cross-link',
    crossLinkPath,
  ]);
  return output;
}

test('Funnel Path Lens and Multi-Persona comparison stay overflow-free at 320/360/390px', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const output = renderFunnel('first-purchase.funnel.json');
  for (const width of NARROW_WIDTHS) {
    const browser = new ChromeVisualBrowser(chromePath);
    try {
      const sessionId = await load(browser, output, width);
      const before = await noHorizontalOverflow(browser, sessionId);
      assert.equal(before.scrollWidth, before.clientWidth, `${width}px: page overflows before opening any panel`);

      const opened = await evaluate(browser, sessionId, `(function () {
        var toggle = document.getElementById('funnel-persona-compare-toggle');
        if (toggle) toggle.click();
        var pathSelect = document.querySelector('select[id*="path"]');
        return { toggleFound: !!toggle, pathSelectFound: !!pathSelect };
      })()`);
      assert.ok(opened.toggleFound, `${width}px: Multi-Persona compare toggle must be present`);
      assert.ok(opened.pathSelectFound, `${width}px: Path Lens select must be present`);

      const after = await noHorizontalOverflow(browser, sessionId);
      assert.equal(after.scrollWidth, after.clientWidth, `${width}px: page overflows after opening the persona comparison picker`);

      const pickerRect = await evaluate(browser, sessionId, `(function () {
        var el = document.getElementById('funnel-persona-compare-picker');
        if (!el) return null;
        var rect = el.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      })()`);
      assert.ok(pickerRect, `${width}px: persona comparison picker must render once toggled`);
      assert.ok(pickerRect.left >= 0 && pickerRect.right <= width, `${width}px: persona comparison picker must stay within the viewport (${JSON.stringify(pickerRect)})`);
    } finally {
      await browser.close();
    }
  }
});

test('Architecture reverse Cross-Link Passport group stays reachable and overflow-free at 320/360/390px', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const output = renderArchitectureWithCrossLink();
  for (const width of NARROW_WIDTHS) {
    const browser = new ChromeVisualBrowser(chromePath);
    try {
      const sessionId = await load(browser, output, width);
      await evaluate(browser, sessionId, `Archify.focus.set('api', { toggle: false })`);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const overflow = await noHorizontalOverflow(browser, sessionId);
      assert.equal(overflow.scrollWidth, overflow.clientWidth, `${width}px: page overflows with the Passport open`);

      const hasCrossLinkGroup = await evaluate(browser, sessionId, `document.body.innerText.includes('Checkout flow')`);
      assert.ok(hasCrossLinkGroup, `${width}px: reverse Cross-Link group must remain visible in the Passport`);
    } finally {
      await browser.close();
    }
  }
});
