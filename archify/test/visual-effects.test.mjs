import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { architecture as validateArchitectureSchema, funnel as validateFunnelSchema } from '../renderers/shared/generated-validators.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-effects-'));
let sequence = 0;

function renderArchitecture(overrides = {}) {
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  source.meta = { ...source.meta, ...overrides };
  const id = (sequence += 1);
  const input = path.join(tmp, `arch-${id}.json`);
  const output = path.join(tmp, `arch-${id}.html`);
  fs.writeFileSync(input, JSON.stringify(source));
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'), input, output]);
  return { html: fs.readFileSync(output, 'utf8'), source };
}

function funnelDoc(overrides = {}) {
  return {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'visual effects fixture', ...overrides },
    stages: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    transitions: [{ id: 't1', from: 'a', to: 'b' }],
  };
}

function renderFunnel(overrides = {}) {
  const doc = funnelDoc(overrides);
  const id = (sequence += 1);
  const input = path.join(tmp, `funnel-${id}.json`);
  const output = path.join(tmp, `funnel-${id}.html`);
  fs.writeFileSync(input, JSON.stringify(doc));
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/funnel/render-funnel.mjs'), input, output]);
  return fs.readFileSync(output, 'utf8');
}

function svgBlock(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

function nodeIds(html) {
  return [...html.matchAll(/data-node-id="([^"]+)"/g)].map((m) => m[1]).sort();
}

// ---------------------------------------------------------------------------
// 1 & 13. Default rendering / backward compatibility: a document with no
// meta.effects at all must render with no data-effects attribute anywhere,
// identical to every document written before this field existed.

test('a document with no meta.effects renders with no data-effects attribute', () => {
  const { html } = renderArchitecture();
  assert.match(html, /<html lang="en" data-theme="dark" data-preset="classic">/);
  assert.doesNotMatch(svgBlock(html), /data-effects=/);
});

test('an empty meta.effects array renders identically to omitting the field', () => {
  const withEmpty = renderArchitecture({ effects: [] }).html;
  const omitted = renderArchitecture().html;
  assert.doesNotMatch(svgBlock(withEmpty), /data-effects=/);
  assert.equal(withEmpty, omitted);
});

// ---------------------------------------------------------------------------
// 2. Style selection: the new contrast preset validates and renders.

test('visual_preset "contrast" validates and renders as a fifth, independent style', () => {
  assert.equal(validateArchitectureSchema({
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'x', visual_preset: 'contrast' },
    components: [{ id: 'a', label: 'A', type: 'frontend' }],
    connections: [],
  }), true);
  const { html } = renderArchitecture({ visual_preset: 'contrast' });
  assert.match(html, /<html lang="en" data-theme="dark" data-preset="contrast">/);
  assert.match(svgBlock(html), /data-preset="contrast"/);
});

// ---------------------------------------------------------------------------
// 3. Theme selection remains an independent, runtime-only axis untouched by
// this work — style and effects are both authored via meta and never gate
// which themes are available or how the toggle behaves.

test('theme toggle markup is unaffected by an authored preset or effects', () => {
  const { html } = renderArchitecture({ visual_preset: 'contrast', effects: ['glow', 'grain', 'depth'] });
  assert.match(html, /html\.setAttribute\('data-theme', theme\)/);
  assert.match(html, /\[data-theme="light"\]/);
  assert.match(html, /\[data-theme="dark"\]/);
});

// ---------------------------------------------------------------------------
// 4. Individual effect selection.

test('each effect independently produces its own data-effects token', () => {
  for (const effect of ['glow', 'grain', 'depth']) {
    const { html } = renderArchitecture({ effects: [effect] });
    assert.match(html, new RegExp(`data-effects="${effect}"`), effect);
  }
});

// ---------------------------------------------------------------------------
// 5. Multiple effects compose together, deterministically deduplicated and
// order-independent (authored order never changes rendered markup).

test('multiple effects compose into one sorted, deduplicated token list', () => {
  const a = renderArchitecture({ effects: ['grain', 'glow', 'depth'] }).html;
  const b = renderArchitecture({ effects: ['depth', 'depth', 'glow', 'grain', 'glow'] }).html;
  assert.match(a, /data-effects="depth glow grain"/);
  assert.match(b, /data-effects="depth glow grain"/);
});

// ---------------------------------------------------------------------------
// 6. Style + theme + effect composition: a non-default preset combined with
// effects does not require — and does not produce — any special combined
// preset name; both axes are independently visible in the output.

test('style and effects combine without collapsing into a special combined preset', () => {
  const { html } = renderArchitecture({ visual_preset: 'blueprint', effects: ['glow', 'depth'] });
  assert.match(html, /data-preset="blueprint"/);
  assert.match(html, /data-effects="depth glow"/);
  assert.doesNotMatch(html, /data-preset="blueprint-glow-depth"/);
});

// ---------------------------------------------------------------------------
// 7 & 8. Semantic IR and authored IDs are unchanged by presentation config —
// effects and preset are meta-level render configuration, never mixed into
// components/connections, and never alter any authored identifier.

test('semantic IR (components/connections) is byte-identical with and without effects', () => {
  const { source } = renderArchitecture();
  const plain = JSON.parse(JSON.stringify(source));
  delete plain.effects;
  delete plain.visual_preset;
  const withEffects = renderArchitecture({ effects: ['glow', 'grain', 'depth'], visual_preset: 'editorial' }).source;
  assert.deepEqual(withEffects.components, source.components);
  assert.deepEqual(withEffects.connections, source.connections);
});

test('authored node ids are unchanged across every effect combination', () => {
  const baseline = nodeIds(renderArchitecture().html);
  const withEffects = nodeIds(renderArchitecture({ effects: ['glow', 'grain', 'depth'], visual_preset: 'contrast' }).html);
  assert.deepEqual(withEffects, baseline);
});

test('canonical SVG geometry is identical with and without effects', () => {
  const normalize = (svg) => svg.replace(/ data-effects="[^"]*"/, '');
  const plain = normalize(svgBlock(renderArchitecture().html));
  const withEffects = normalize(svgBlock(renderArchitecture({ effects: ['glow', 'grain', 'depth'] }).html));
  assert.equal(withEffects, plain);
});

// ---------------------------------------------------------------------------
// 9 & 10. Both a Funnel-family and an Architecture-family renderer apply
// effects through the same shared choke point (writeDiagram/applyTemplate/
// svgRootAttrs) — no diagram-type-specific effects code exists.

test('the Funnel renderer applies effects through the same shared mechanism as Architecture', () => {
  const html = renderFunnel({ effects: ['glow', 'depth'], visual_preset: 'contrast' });
  assert.match(html, /<html lang="en" data-theme="dark" data-preset="contrast" data-effects="depth glow">/);
  assert.match(svgBlock(html), /data-preset="contrast" data-effects="depth glow"/);
});

test('Architecture and Funnel both react to the glow effect via the identical shared CSS rule, not a per-type copy', () => {
  const templateCss = fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8');
  // One shared declaration block selects both the live-viewer (html-rooted)
  // and standalone-export (svg-rooted) cases; there is exactly one such
  // block, not a separate copy per diagram type.
  const glowBlocks = templateCss.match(/html\[data-effects~="glow"\] \.a-emphasis,\s*svg\[data-effects~="glow"\] \.a-emphasis \{/g) || [];
  assert.equal(glowBlocks.length, 1, 'exactly one shared glow rule should exist, not a per-diagram-type duplicate');
});

// ---------------------------------------------------------------------------
// 11. Export/print behavior: glow (an SVG-relevant filter) survives into a
// standalone exported SVG root via its svg[data-effects] branch; grain and
// depth are page-chrome-only, exactly like existing toolbar/card CSS, and
// are intentionally absent from the canonical SVG.

test('glow duplicates its selector under svg[data-effects] so a standalone export keeps the same treatment', () => {
  const templateCss = fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8');
  assert.match(templateCss, /svg\[data-effects~="glow"\] \.a-emphasis/);
  assert.match(templateCss, /svg\[data-effects~="glow"\] \.m-emphasis/);
});

test('grain and depth are HTML page-chrome effects and never appear inside the canonical SVG export', () => {
  const html = renderArchitecture({ effects: ['glow', 'grain', 'depth'] }).html;
  const svg = svgBlock(html);
  assert.doesNotMatch(svg, /effect-overlay/);
  assert.doesNotMatch(svg, /diagram-container/);
});

test('svg root still carries data-effects for export tooling even though grain/depth do not use it', () => {
  const html = renderArchitecture({ effects: ['glow', 'grain', 'depth'] }).html;
  assert.match(svgBlock(html), /data-effects="depth glow grain"/);
});

// ---------------------------------------------------------------------------
// 12. Accessibility: the grain overlay is decorative, inert to input, and
// hidden from assistive tech; it never introduces a new focus target.

test('the grain overlay node is decorative: aria-hidden and pointer-events: none', () => {
  const html = renderArchitecture({ effects: ['grain'] }).html;
  assert.match(html, /<div class="effect-overlay" aria-hidden="true"><\/div>/);
  const css = fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8');
  assert.match(css, /\.effect-overlay \{[^}]*pointer-events: none;/);
});

test('the SVG stays the diagram-container\'s direct child regardless of effects (finder/geometry contracts depend on this)', () => {
  const html = renderArchitecture({ effects: ['glow', 'grain', 'depth'] }).html;
  assert.match(html, /<div class="diagram-container"[^>]*>\s*<svg\b/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
