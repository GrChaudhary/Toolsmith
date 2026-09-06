import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { funnel as validateFunnel } from '../renderers/shared/generated-validators.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');

function baseFunnelDocument() {
  return {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'funnel schema fixture' },
    stages: [
      { id: 'a', label: 'Stage A' },
      { id: 'b', label: 'Stage B' },
    ],
    transitions: [
      { id: 't1', from: 'a', to: 'b' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Minimum viable document / required collections

test('a minimal document with only stages and transitions is valid', () => {
  const doc = baseFunnelDocument();
  assert.equal(validateFunnel(doc), true, JSON.stringify(validateFunnel.errors));
});

test('personas, actions, and touchpoints are optional collections', () => {
  const doc = baseFunnelDocument();
  assert.equal('personas' in doc, false);
  assert.equal('actions' in doc, false);
  assert.equal('touchpoints' in doc, false);
  assert.equal(validateFunnel(doc), true, JSON.stringify(validateFunnel.errors));
});

test('stages is required and must have at least two entries', () => {
  const doc = baseFunnelDocument();
  delete doc.stages;
  assert.equal(validateFunnel(doc), false);
  assert.equal(validateFunnel.errors?.some((e) => e.params?.missingProperty === 'stages'), true);

  const oneStage = baseFunnelDocument();
  oneStage.stages = [{ id: 'a', label: 'Stage A' }];
  oneStage.transitions = [];
  assert.equal(validateFunnel(oneStage), false);
});

test('transitions is required', () => {
  const doc = baseFunnelDocument();
  delete doc.transitions;
  assert.equal(validateFunnel(doc), false);
  assert.equal(validateFunnel.errors?.some((e) => e.params?.missingProperty === 'transitions'), true);
});

test('an unknown top-level property is rejected', () => {
  const doc = { ...baseFunnelDocument(), components: [] };
  assert.equal(validateFunnel(doc), false);
  assert.equal(validateFunnel.errors?.[0]?.keyword, 'additionalProperties');
});

// ---------------------------------------------------------------------------
// Stage semantics: personas, decision, outcome, friction

test('a stage may restrict itself to a subset of declared personas', () => {
  const doc = baseFunnelDocument();
  doc.personas = [{ id: 'newCustomer', label: 'New Customer' }, { id: 'returning', label: 'Returning' }];
  doc.stages[0].personas = ['newCustomer'];
  assert.equal(validateFunnel(doc), true, JSON.stringify(validateFunnel.errors));
});

test('stages.personas rejects an empty array (minItems: 1)', () => {
  const doc = baseFunnelDocument();
  doc.stages[0].personas = [];
  assert.equal(validateFunnel(doc), false);
});

test('a stage accepts an optional decision prompt', () => {
  const doc = baseFunnelDocument();
  doc.stages[1].decision = 'Continue to checkout?';
  assert.equal(validateFunnel(doc), true, JSON.stringify(validateFunnel.errors));
});

test('outcome accepts only conversion or dropoff', () => {
  const doc = baseFunnelDocument();
  for (const outcome of ['conversion', 'dropoff']) {
    doc.stages[1].outcome = outcome;
    assert.equal(validateFunnel(doc), true, `${outcome}: ${JSON.stringify(validateFunnel.errors)}`);
  }
  doc.stages[1].outcome = 'failure';
  assert.equal(validateFunnel(doc), false);
  assert.deepEqual(validateFunnel.errors?.[0]?.params.allowedValues, ['conversion', 'dropoff']);
});

test('a stage may carry an outcome while still being the source of an outgoing transition', () => {
  // Deliberate per the Phase 6 design: dropoff/conversion describe a
  // customer-observable result reachable at a stage, not the stage's
  // structural terminal-ness in the graph. Real funnel reporting shows a
  // "continued" and a "dropped off" count on the same stage simultaneously.
  const doc = baseFunnelDocument();
  doc.stages[0].outcome = 'dropoff';
  assert.equal(validateFunnel(doc), true, JSON.stringify(validateFunnel.errors));
  assert.equal(doc.transitions.some((t) => t.from === doc.stages[0].id), true);
});

test('friction is a free-text property, independent of outcome', () => {
  const doc = baseFunnelDocument();
  doc.stages[0].friction = 'Customers hesitate here';
  assert.equal(validateFunnel(doc), true, JSON.stringify(validateFunnel.errors));
  assert.equal('outcome' in doc.stages[0], false);
});

test('there is no "failure" concept anywhere in the schema', () => {
  // Technical failure belongs to the Architecture domain; the only
  // schema-level place the word "failure" could plausibly appear is the
  // outcome enum, and it is deliberately absent (see the outcome test above).
  const raw = fs.readFileSync(path.join(skillRoot, 'schemas', 'funnel.schema.json'), 'utf8');
  assert.doesNotMatch(raw, /"failure"/);
});

// ---------------------------------------------------------------------------
// Touchpoints

test('touchpoint type accepts only the controlled vocabulary', () => {
  const doc = baseFunnelDocument();
  doc.touchpoints = [{ id: 'web', type: 'web', label: 'Website' }];
  assert.equal(validateFunnel(doc), true, JSON.stringify(validateFunnel.errors));

  doc.touchpoints[0].type = 'social-media';
  assert.equal(validateFunnel(doc), false);
});

test('touchpoints rejects an empty array (minItems: 1)', () => {
  const doc = baseFunnelDocument();
  doc.touchpoints = [];
  assert.equal(validateFunnel(doc), false);
});

// ---------------------------------------------------------------------------
// Actions

test('an action references its stage and optionally a touchpoint', () => {
  const doc = baseFunnelDocument();
  doc.touchpoints = [{ id: 'web', type: 'web', label: 'Website' }];
  doc.actions = [{ id: 'search', stage: 'a', label: 'Search for a product', touchpoint: 'web' }];
  assert.equal(validateFunnel(doc), true, JSON.stringify(validateFunnel.errors));
});

test('an action has no technical fields available', () => {
  const doc = baseFunnelDocument();
  doc.actions = [{ id: 'search', stage: 'a', label: 'Search', endpoint: '/v1/search' }];
  assert.equal(validateFunnel(doc), false);
  assert.equal(validateFunnel.errors?.[0]?.keyword, 'additionalProperties');
});

test('an action may be marked optional', () => {
  const doc = baseFunnelDocument();
  doc.actions = [{ id: 'compare', stage: 'a', label: 'Compare options', optional: true }];
  assert.equal(validateFunnel(doc), true, JSON.stringify(validateFunnel.errors));
});

test('an action does not carry its own outcome field', () => {
  const doc = baseFunnelDocument();
  doc.actions = [{ id: 'search', stage: 'a', label: 'Search', outcome: 'conversion' }];
  assert.equal(validateFunnel(doc), false);
  assert.equal(validateFunnel.errors?.[0]?.keyword, 'additionalProperties');
});

// ---------------------------------------------------------------------------
// Transitions: required from/to, optional role, no dangling-edge shape

test('a transition requires both from and to', () => {
  const doc = baseFunnelDocument();
  delete doc.transitions[0].to;
  assert.equal(validateFunnel(doc), false);
  assert.equal(validateFunnel.errors?.some((e) => e.params?.missingProperty === 'to'), true);
});

test('transition role accepts only primary, alternative, or loop', () => {
  const doc = baseFunnelDocument();
  for (const role of ['primary', 'alternative', 'loop']) {
    doc.transitions[0].role = role;
    assert.equal(validateFunnel(doc), true, `${role}: ${JSON.stringify(validateFunnel.errors)}`);
  }
  doc.transitions[0].role = 'main';
  assert.equal(validateFunnel(doc), false);
});

test('a loop transition (stage graph is not required to be acyclic) validates', () => {
  const doc = baseFunnelDocument();
  doc.transitions.push({ id: 't2', from: 'b', to: 'a', role: 'loop', label: 'Went back' });
  assert.equal(validateFunnel(doc), true, JSON.stringify(validateFunnel.errors));
});

test('pure schema validation does not catch a dangling from/to reference', () => {
  // Deliberate and documented, not an oversight: JSON Schema bounds each
  // collection's own item shape but cannot express cross-collection facts.
  // As of Phase 9, that referential integrity is enforced by the separate
  // validateFunnelReferences() cross-collection pass in
  // renderers/shared/cli.mjs (see test/funnel-references.test.mjs) — the
  // same division of labor validateComponentHierarchy establishes for
  // architecture's `children`. Schema validation alone still returns true
  // here; that is expected, not a gap.
  const doc = baseFunnelDocument();
  doc.transitions[0].to = 'does-not-exist';
  assert.equal(validateFunnel(doc), true, JSON.stringify(validateFunnel.errors));
});

// ---------------------------------------------------------------------------
// Bundled example

test('the bundled first-purchase funnel example is schema-valid', () => {
  const doc = JSON.parse(fs.readFileSync(
    path.join(skillRoot, 'examples', 'first-purchase.funnel.json'),
    'utf8',
  ));
  assert.equal(validateFunnel(doc), true, JSON.stringify(validateFunnel.errors));
  assert.equal(doc.stages.find((s) => s.id === 'browse').outcome, 'dropoff');
  assert.equal(doc.stages.find((s) => s.id === 'confirmed').outcome, 'conversion');
  // The dropoff stage is also mid-graph: it is both a transition target and source.
  assert.equal(doc.transitions.some((t) => t.to === 'browse'), true);
  assert.equal(doc.transitions.some((t) => t.from === 'browse'), true);
});

// ---------------------------------------------------------------------------
// Isolation from Architecture / HLD-LLD / the five existing diagram types

test('funnel does not reuse componentType or any architecture vocabulary', () => {
  const raw = fs.readFileSync(path.join(skillRoot, 'schemas', 'funnel.schema.json'), 'utf8');
  assert.doesNotMatch(raw, /componentType/);
  assert.doesNotMatch(raw, /children/);
  assert.doesNotMatch(raw, /kind\.schema|"kind":\s*{\s*"\$ref"/);
});

test('funnel is registered as a standalone validator without touching the other five', () => {
  const validators = fs.readFileSync(path.join(skillRoot, 'renderers/shared/generated-validators.mjs'), 'utf8');
  for (const name of ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle', 'funnel']) {
    assert.match(validators, new RegExp(`export const ${name} = `), name);
  }
});

test('funnel has a renderer (Phase 10) but no user-facing CLI wiring and no Cross-Link artifact', () => {
  // Phase 10 adds renderers/funnel/render-funnel.mjs, invoked directly the
  // same way every other renderer is (`node renderers/<type>/render-<type>.mjs`).
  // bin/archify.mjs — the archify CLI's own command dispatch — remains
  // completely unaware `diagram_type: "funnel"` exists; see
  // test/funnel-renderer.test.mjs for renderer-specific coverage.
  assert.equal(fs.existsSync(path.join(skillRoot, 'renderers', 'funnel', 'render-funnel.mjs')), true);
  const cliSource = fs.readFileSync(path.join(skillRoot, 'bin', 'archify.mjs'), 'utf8');
  assert.doesNotMatch(cliSource, /'funnel'/);
  assert.doesNotMatch(cliSource, /"funnel"/);
  assert.equal(fs.existsSync(path.join(skillRoot, 'cross-link')), false);
});

test('architecture.schema.json and common.schema.json are untouched by the funnel addition', () => {
  const architecture = fs.readFileSync(path.join(skillRoot, 'schemas', 'architecture.schema.json'), 'utf8');
  const common = fs.readFileSync(path.join(skillRoot, 'schemas', 'common.schema.json'), 'utf8');
  assert.doesNotMatch(architecture, /funnel/i);
  assert.doesNotMatch(common, /funnel/i);
});
