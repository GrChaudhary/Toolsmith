import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-semantic-passport-'));

const CASES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

function render(mode, example) {
  const output = path.join(tmp, `${mode}.html`);
  execFileSync(process.execPath, [
    path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
    path.join(skillRoot, 'examples', example),
    output,
  ]);
  return fs.readFileSync(output, 'utf8');
}

function svg(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

test('all typed renderers emit details-on-demand metadata and native SVG titles', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    const diagram = svg(html);
    assert.match(diagram, /data-node-kind="[^"]+"/, mode);
    assert.match(diagram, /data-node-sublabel="[^"]+"/, mode);
    assert.match(diagram, /data-node-context="[^"]+"/, mode);
    assert.match(diagram, /<g id="node-[^"]+"[\s\S]*?<title>[^<]+ · [^<]+<\/title>/, mode);
  }
});

test('renderer-owned structure supplies truthful Semantic Passport context', () => {
  const architecture = render('architecture', CASES.architecture);
  const workflow = render('workflow', CASES.workflow);
  const sequence = render('sequence', CASES.sequence);
  const dataflow = render('dataflow', CASES.dataflow);
  const lifecycle = render('lifecycle', CASES.lifecycle);

  assert.match(architecture, /data-node-id="api"[^>]+data-node-kind="backend"[^>]+data-node-context="AWS Region: us-west-2 › sg-api :443\/:8000"/);
  assert.match(workflow, /data-node-id="approval"[^>]+data-node-kind="security"[^>]+data-node-context="Policy &amp; Recovery › Human or policy stop › Plan \+ route"/);
  assert.match(sequence, /data-node-id="redis"[^>]+data-node-kind="database"[^>]+data-node-context="Sequence participant"/);
  assert.match(dataflow, /data-node-id="warehouse"[^>]+data-node-kind="database"[^>]+data-node-context="04 \/ Store"/);
  assert.match(lifecycle, /data-node-id="executing"[^>]+data-node-kind="active"[^>]+data-node-context="Lifecycle phases"/);
});

test('Relationship Lens renders one Semantic Passport and copyable stable focus link', () => {
  const html = render('workflow', CASES.workflow);
  assert.match(html, /<span class="relationship-lens-eyebrow">Semantic passport<\/span>/);
  assert.match(html, /id="focus-detail" hidden/);
  assert.match(html, /id="focus-kind" data-passport="kind"/);
  assert.match(html, /id="focus-context" data-passport="context" hidden/);
  assert.match(html, /id="focus-tag" data-passport="tag" hidden/);
  assert.match(html, /id="focus-id" data-passport="id"/);
  assert.match(html, /id="btn-focus-clear"[^>]+aria-label="Close semantic passport"[^>]+title="Close">&#215;<\/button>/);
  assert.match(html, /id="btn-focus-copy"[^>]+aria-label="Copy link to focused node"/);
  assert.match(html, /id="btn-focus-relations"[^>]+aria-expanded="false"[^>]+aria-controls="relationship-lens-list"/);
  assert.match(html, /function renderPassport\(id, node\)/);
  assert.match(html, /var relationId = record && record\.id/);
  assert.match(html, /\? '#relation=' \+ encodeURIComponent\(relationId\)/);
  assert.match(html, /: '#focus=' \+ encodeURIComponent\(activeIds\[0\]\)/);
  assert.match(html, /navigator\.clipboard\.writeText\(value\)/);
  assert.match(html, /document\.execCommand\('copy'\)/);
  assert.match(html, /copyLink: copyFocusLink/);
  assert.match(html, /compactOnMobile = mobile && chip\.getAttribute\('data-relations-expanded'\) !== 'true'/);
  assert.match(html, /nodeTop - chip\.offsetHeight - gap/);
  assert.match(html, /focus-chip:not\(\[data-relations-expanded="true"\]\) \.relationship-lens-list \{ display: none; \}/);
  assert.match(html, /clearBtn\.addEventListener\('click', function \(\) \{ clear\(\{ restoreFocus: true \}\); \}\)/);
  assert.match(html, /chip\.hidden \|\| !target \|\| typeof target\.closest !== 'function' \|\| chip\.contains\(target\)/);
  assert.match(html, /target\.closest\('\[data-node-id\], \[data-relationship-hit-key\], \.overview-map'\)/);
  assert.match(html, /document\.addEventListener\('click',[\s\S]+?clear\(\);\s+\}, true\);/);
  assert.match(html, /Archify\.focus\.clear\(\{ restoreFocus: true \}\)/);
});

test('Node Finder searches and presents the same passport facts', () => {
  const html = render('dataflow', CASES.dataflow);
  assert.match(html, /var authored = node\.getAttribute\('data-node-kind'\)/);
  assert.match(html, /var sublabel = node\.getAttribute\('data-node-sublabel'\) \|\| ''/);
  assert.match(html, /var context = node\.getAttribute\('data-node-context'\) \|\| ''/);
  assert.match(html, /var tag = node\.getAttribute\('data-node-tag'\) \|\| ''/);
  assert.match(html, /search: \(id \+ ' ' \+ label \+ ' ' \+ type \+ ' ' \+ sublabel \+ ' ' \+ context \+ ' ' \+ tag \+ ' ' \+ sourceSearch \+ ' ' \+ text\)\.toLowerCase\(\)/);
  assert.match(html, /\[viewerKindLabel\(item\.type\), item\.id, item\.sublabel, item\.tag\]\.filter\(Boolean\)\.join\(' \\u00b7 '\)/);
  assert.match(html, /meta\.title = \[viewerKindLabel\(item\.type\), item\.id, item\.context, item\.sublabel, item\.tag\]\.filter\(Boolean\)\.join\(' \\u00b7 '\)/);
});

// ---------------------------------------------------------------------------
// Phase 11: the Semantic Passport gained a generic, optional detail-groups
// section (assets/template.html: #focus-detail-groups + renderDetailGroups(),
// keyed off an optional data-node-detail-groups JSON attribute). It is
// additive — no renderer other than Funnel currently emits that attribute —
// so the five existing renderers' own node markup must be byte-for-byte
// unaffected, while the shared template markup/JS/CSS gains the new,
// dormant-by-default container once, for every diagram type.

test('the shared template exposes the generic detail-groups Passport container and renderer for every diagram type', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    assert.match(html, /id="focus-detail-groups"/, mode);
    assert.match(html, /function renderDetailGroups\(node\)/, mode);
  }
});

test('none of the five existing renderers emit data-node-detail-groups on their own nodes', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const diagram = svg(render(mode, example));
    assert.doesNotMatch(diagram, /data-node-detail-groups/, mode);
  }
});

test('Funnel is the renderer that actually populates data-node-detail-groups', () => {
  const output = path.join(tmp, 'funnel.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers/funnel/render-funnel.mjs'),
    path.join(skillRoot, 'examples/first-purchase.funnel.json'),
    output,
  ]);
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /id="focus-detail-groups"/);
  assert.match(svg(html), /data-node-detail-groups="\[/);
});

// ---------------------------------------------------------------------------
// Phase 15: renderDetailGroups() gained a second, still fully generic, item
// shape — a plain string (unchanged) or an optional {text, tag} object — so
// a renderer can attach a small neutral tag (e.g. Funnel's "Optional" Action
// marker or a Touchpoint's type) without either Passport knowing what
// produced the data or a second Passport implementation existing.

test('renderDetailGroups supports a generic {text, tag} item shape via safe DOM construction, with no per-diagram-type branching', () => {
  const html = render('architecture', CASES.architecture);
  assert.match(html, /typeof item === 'object' && item\.text !== undefined/);
  assert.match(html, /tagEl\.className = 'semantic-passport-detail-tag'/);
  assert.match(html, /tagEl\.textContent = String\(item\.tag\)/);
  assert.doesNotMatch(html, /diagramType === .funnel./);
  assert.doesNotMatch(html, /diagram_type === .funnel./);
});

test('the generic detail-tag CSS is present for every diagram type but only Funnel ever populates a tag', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const html = render(mode, example);
    assert.match(html, /\.semantic-passport-detail-tag \{/, mode);
    assert.doesNotMatch(svg(render(mode, example)), /"tag":/, mode);
  }
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
