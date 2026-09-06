import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { funnel as validateFunnel } from '../renderers/shared/generated-validators.mjs';
import { validateFunnelReferences, validateRelationshipIds, validateGuidedViews } from '../renderers/shared/cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');

function baseFunnelDocument() {
  return {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'funnel reference fixture' },
    personas: [
      { id: 'newCustomer', label: 'New Customer' },
      { id: 'returning', label: 'Returning Customer' },
    ],
    stages: [
      { id: 'discovery', label: 'Discovery', personas: ['newCustomer'] },
      { id: 'browse', label: 'Browse Products', outcome: 'dropoff' },
      { id: 'checkout', label: 'Checkout' },
      { id: 'confirmed', label: 'Order Confirmed', outcome: 'conversion' },
    ],
    touchpoints: [
      { id: 'web', type: 'web', label: 'Storefront website' },
    ],
    actions: [
      { id: 'search', stage: 'discovery', label: 'Search for a product', touchpoint: 'web' },
    ],
    transitions: [
      { id: 'discoveryToBrowse', from: 'discovery', to: 'browse', role: 'primary' },
      { id: 'browseToCheckout', from: 'browse', to: 'checkout', role: 'primary' },
      { id: 'checkoutBackToBrowse', from: 'checkout', to: 'browse', role: 'loop' },
      { id: 'checkoutToConfirmed', from: 'checkout', to: 'confirmed', role: 'primary' },
    ],
  };
}

function expectReferenceProblem(doc, pattern) {
  assert.throws(
    () => validateFunnelReferences('funnel', doc),
    (error) => {
      assert.ok(Array.isArray(error.archifyDiagnostics));
      assert.equal(error.archifyDiagnostics[0].code, 'funnel/invalid-reference');
      assert.match(error.message, pattern);
      return true;
    },
  );
}

// ---------------------------------------------------------------------------
// No-op / pass-through behavior

test('funnel reference validation is a no-op for non-funnel diagram types', () => {
  assert.doesNotThrow(() => validateFunnelReferences('architecture', { components: [] }));
});

test('a well-formed funnel document with branching, reconvergence, and a loop passes', () => {
  const doc = baseFunnelDocument();
  assert.equal(validateFunnel(doc), true, JSON.stringify(validateFunnel.errors));
  assert.doesNotThrow(() => validateFunnelReferences('funnel', doc));
});

test('a minimal document (stages + transitions only, every optional collection omitted) passes reference validation', () => {
  const doc = {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'minimal' },
    stages: [
      { id: 'a', label: 'Stage A' },
      { id: 'b', label: 'Stage B' },
    ],
    transitions: [{ id: 't1', from: 'a', to: 'b' }],
  };
  assert.equal('personas' in doc, false);
  assert.equal('actions' in doc, false);
  assert.equal('touchpoints' in doc, false);
  assert.equal(validateFunnel(doc), true, JSON.stringify(validateFunnel.errors));
  assert.doesNotThrow(() => validateFunnelReferences('funnel', doc));
  assert.doesNotThrow(() => validateRelationshipIds('funnel', doc));
  assert.doesNotThrow(() => validateGuidedViews('funnel', doc));
});

test('omitted Personas is valid even when other stages declare persona references', () => {
  const doc = baseFunnelDocument();
  delete doc.personas;
  delete doc.stages[0].personas;
  assert.equal(validateFunnel(doc), true, JSON.stringify(validateFunnel.errors));
  assert.doesNotThrow(() => validateFunnelReferences('funnel', doc));
});

test('optional Actions may be omitted entirely', () => {
  const doc = baseFunnelDocument();
  delete doc.actions;
  assert.equal(validateFunnel(doc), true, JSON.stringify(validateFunnel.errors));
  assert.doesNotThrow(() => validateFunnelReferences('funnel', doc));
});

test('optional Touchpoints may be omitted entirely, as long as no Action references one', () => {
  const doc = baseFunnelDocument();
  delete doc.touchpoints;
  delete doc.actions[0].touchpoint;
  assert.equal(validateFunnel(doc), true, JSON.stringify(validateFunnel.errors));
  assert.doesNotThrow(() => validateFunnelReferences('funnel', doc));
});

test('a valid alternative-role transition passes reference validation alongside primary and loop roles', () => {
  const doc = baseFunnelDocument();
  doc.transitions.push({ id: 'discoveryToConfirmedAlt', from: 'discovery', to: 'confirmed', role: 'alternative' });
  assert.equal(validateFunnel(doc), true, JSON.stringify(validateFunnel.errors));
  assert.doesNotThrow(() => validateFunnelReferences('funnel', doc));
});

// ---------------------------------------------------------------------------
// Valid Funnel graph shapes (Task 12: cycles/branching/reconvergence/outcomes
// with outgoing transitions must never be rejected)

test('a stage with outcome "dropoff" may still source an outgoing transition', () => {
  const doc = baseFunnelDocument();
  assert.equal(doc.stages.find((s) => s.id === 'browse').outcome, 'dropoff');
  assert.equal(doc.transitions.some((t) => t.from === 'browse'), true);
  assert.doesNotThrow(() => validateFunnelReferences('funnel', doc));
});

test('a stage with outcome "conversion" may still source an outgoing transition', () => {
  const doc = baseFunnelDocument();
  doc.transitions.push({ id: 'confirmedToUpsell', from: 'confirmed', to: 'discovery', role: 'alternative' });
  assert.doesNotThrow(() => validateFunnelReferences('funnel', doc));
});

test('branching: a stage may source multiple outgoing transitions', () => {
  const doc = baseFunnelDocument();
  doc.transitions.push({ id: 'browseToConfirmed', from: 'browse', to: 'confirmed', role: 'alternative' });
  assert.doesNotThrow(() => validateFunnelReferences('funnel', doc));
});

test('reconvergence: a stage may be the target of multiple incoming transitions', () => {
  const doc = baseFunnelDocument();
  doc.transitions.push({ id: 'discoveryToConfirmed', from: 'discovery', to: 'confirmed', role: 'alternative' });
  const incoming = doc.transitions.filter((t) => t.to === 'confirmed');
  assert.equal(incoming.length, 2);
  assert.doesNotThrow(() => validateFunnelReferences('funnel', doc));
});

test('a loop transition (cycle) is valid and not rejected', () => {
  const doc = baseFunnelDocument();
  assert.equal(doc.transitions.some((t) => t.role === 'loop' && t.from === 'checkout' && t.to === 'browse'), true);
  assert.doesNotThrow(() => validateFunnelReferences('funnel', doc));
});

test('friction on a stage or action does not affect reference validation', () => {
  const doc = baseFunnelDocument();
  doc.stages[2].friction = 'Address form is long';
  doc.actions[0].friction = 'Search results are noisy';
  assert.equal(validateFunnel(doc), true, JSON.stringify(validateFunnel.errors));
  assert.doesNotThrow(() => validateFunnelReferences('funnel', doc));
});

// ---------------------------------------------------------------------------
// Duplicate ids (Task 12 invalid cases)

test('duplicate persona ids are rejected', () => {
  const doc = baseFunnelDocument();
  doc.personas.push({ id: 'newCustomer', label: 'Duplicate' });
  expectReferenceProblem(doc, /personas\/2\/id duplicates personas id "newCustomer"/);
});

test('duplicate stage ids are rejected', () => {
  const doc = baseFunnelDocument();
  doc.stages.push({ id: 'browse', label: 'Duplicate Browse' });
  expectReferenceProblem(doc, /stages\/4\/id duplicates stages id "browse"/);
});

test('duplicate touchpoint ids are rejected', () => {
  const doc = baseFunnelDocument();
  doc.touchpoints.push({ id: 'web', type: 'mobile-app', label: 'Duplicate' });
  expectReferenceProblem(doc, /touchpoints\/1\/id duplicates touchpoints id "web"/);
});

test('duplicate action ids are rejected', () => {
  const doc = baseFunnelDocument();
  doc.actions.push({ id: 'search', stage: 'browse', label: 'Duplicate search' });
  expectReferenceProblem(doc, /actions\/1\/id duplicates actions id "search"/);
});

test('duplicate transition ids are handled by the shared relationship registry, not this pass', () => {
  // funnel is registered in RELATIONSHIP_COLLECTIONS (transitions), so
  // duplicate transition ids are caught generically by
  // validateRelationshipIds — the same mechanism every other renderer uses —
  // rather than being re-implemented here.
  const doc = baseFunnelDocument();
  doc.transitions.push({ id: 'discoveryToBrowse', from: 'checkout', to: 'confirmed' });
  assert.doesNotThrow(() => validateFunnelReferences('funnel', doc));
  assert.throws(
    () => validateRelationshipIds('funnel', doc),
    (error) => {
      assert.equal(error.archifyDiagnostics[0].code, 'relationship/duplicate-id');
      assert.match(error.message, /transitions\/4\/id duplicates relationship id "discoveryToBrowse"/);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Dangling references (Task 12 invalid cases)

test('a dangling Stage.personas reference is rejected', () => {
  const doc = baseFunnelDocument();
  doc.stages[0].personas = ['doesNotExist'];
  expectReferenceProblem(doc, /stages\/0\/personas\/0 references unknown persona id "doesNotExist"/);
});

test('a dangling Action.stage reference is rejected', () => {
  const doc = baseFunnelDocument();
  doc.actions[0].stage = 'doesNotExist';
  expectReferenceProblem(doc, /actions\/0\/stage references unknown stage id "doesNotExist"/);
});

test('a dangling Action.touchpoint reference is rejected', () => {
  const doc = baseFunnelDocument();
  doc.actions[0].touchpoint = 'doesNotExist';
  expectReferenceProblem(doc, /actions\/0\/touchpoint references unknown touchpoint id "doesNotExist"/);
});

test('a dangling Transition.from reference is rejected', () => {
  const doc = baseFunnelDocument();
  doc.transitions[0].from = 'doesNotExist';
  expectReferenceProblem(doc, /transitions\/0\/from references unknown stage id "doesNotExist"/);
});

test('a dangling Transition.to reference is rejected', () => {
  const doc = baseFunnelDocument();
  doc.transitions[0].to = 'doesNotExist';
  expectReferenceProblem(doc, /transitions\/0\/to references unknown stage id "doesNotExist"/);
});

test('multiple reference problems are all reported together', () => {
  const doc = baseFunnelDocument();
  doc.transitions[0].to = 'doesNotExist';
  doc.actions[0].stage = 'alsoMissing';
  assert.throws(
    () => validateFunnelReferences('funnel', doc),
    (error) => {
      assert.equal(error.archifyDiagnostics[0].code, 'funnel/invalid-reference');
      assert.match(error.message, /transitions\/0\/to references unknown stage id "doesNotExist"/);
      assert.match(error.message, /actions\/0\/stage references unknown stage id "alsoMissing"/);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Registry integration (Task 3)

test('funnel participates in SEMANTIC_COLLECTIONS as "stages" via validateGuidedViews (no-op today, no meta.views in the schema yet)', () => {
  const doc = baseFunnelDocument();
  assert.doesNotThrow(() => validateGuidedViews('funnel', doc));
});

test('funnel participates in RELATIONSHIP_COLLECTIONS as "transitions" via validateRelationshipIds', () => {
  const doc = baseFunnelDocument();
  assert.doesNotThrow(() => validateRelationshipIds('funnel', doc));
});

// ---------------------------------------------------------------------------
// The bundled example stays reference-clean

test('the bundled first-purchase funnel example has no dangling references or duplicate ids', () => {
  const doc = JSON.parse(fs.readFileSync(
    path.join(skillRoot, 'examples', 'first-purchase.funnel.json'),
    'utf8',
  ));
  assert.doesNotThrow(() => validateFunnelReferences('funnel', doc));
  assert.doesNotThrow(() => validateRelationshipIds('funnel', doc));
  assert.doesNotThrow(() => validateGuidedViews('funnel', doc));
});

// ---------------------------------------------------------------------------
// Regression: Architecture's own cross-collection validation is unaffected

test('registering funnel in the shared registries does not change architecture behavior', () => {
  const doc = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'regression fixture' },
    components: [{ id: 'a', type: 'backend', label: 'A' }],
    connections: [{ from: 'a', to: 'a', id: 'self' }],
  };
  assert.doesNotThrow(() => validateRelationshipIds('architecture', doc));
  assert.doesNotThrow(() => validateGuidedViews('architecture', doc));
});
