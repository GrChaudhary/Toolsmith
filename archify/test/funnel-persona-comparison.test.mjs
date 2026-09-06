// Part 2 (Workstream D): pure Multi-Persona comparison classification.
// Renderer/UI integration is covered separately in
// test/funnel-persona-comparison-renderer.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStageForPersonas, classifyTransitionForPersonas, isStageApplicableToPersona } from '../renderers/funnel/persona-focus.mjs';

// ---------------------------------------------------------------------------
// 1, 2, 3. One / two / three-or-more selected Personas.

test('one selected Persona: a general Stage is "general", an applicable one is "shared", divergent is impossible', () => {
  const general = { id: 'a', label: 'A' };
  const applicable = { id: 'b', label: 'B', personas: ['p1'] };
  const notApplicable = { id: 'c', label: 'C', personas: ['p2'] };
  assert.equal(classifyStageForPersonas(general, ['p1']), 'general');
  assert.equal(classifyStageForPersonas(applicable, ['p1']), 'shared');
  assert.equal(classifyStageForPersonas(notApplicable, ['p1']), 'none');
});

test('two selected Personas: a Stage applicable to both is shared, to only one is divergent', () => {
  const both = { id: 'a', label: 'A', personas: ['p1', 'p2'] };
  const onlyOne = { id: 'b', label: 'B', personas: ['p1'] };
  const neither = { id: 'c', label: 'C', personas: ['p3'] };
  assert.equal(classifyStageForPersonas(both, ['p1', 'p2']), 'shared');
  assert.equal(classifyStageForPersonas(onlyOne, ['p1', 'p2']), 'divergent');
  assert.equal(classifyStageForPersonas(neither, ['p1', 'p2']), 'none');
});

test('three or more selected Personas: shared requires every one of them, not just a majority', () => {
  const almostAll = { id: 'a', label: 'A', personas: ['p1', 'p2'] };
  const all = { id: 'b', label: 'B', personas: ['p1', 'p2', 'p3'] };
  assert.equal(classifyStageForPersonas(almostAll, ['p1', 'p2', 'p3']), 'divergent');
  assert.equal(classifyStageForPersonas(all, ['p1', 'p2', 'p3']), 'shared');
});

// ---------------------------------------------------------------------------
// 4, 5, 6. Shared / divergent stages, reconvergence via a shared Stage after
// divergent ones.

test('a shared Stage after divergent ones represents reconvergence into a common journey', () => {
  const divergentA = { id: 'a', label: 'A', personas: ['p1'] };
  const divergentB = { id: 'b', label: 'B', personas: ['p2'] };
  const reconverged = { id: 'c', label: 'C' }; // generally applicable
  assert.equal(classifyStageForPersonas(divergentA, ['p1', 'p2']), 'divergent');
  assert.equal(classifyStageForPersonas(divergentB, ['p1', 'p2']), 'divergent');
  assert.equal(classifyStageForPersonas(reconverged, ['p1', 'p2']), 'general');
});

// ---------------------------------------------------------------------------
// 7, 8. Generally applicable stages; explicit non-match.

test('a generally applicable Stage (omitted personas) is "general" regardless of selection size', () => {
  const stage = { id: 'a', label: 'A' };
  assert.equal(classifyStageForPersonas(stage, ['p1']), 'general');
  assert.equal(classifyStageForPersonas(stage, ['p1', 'p2', 'p3']), 'general');
});

test('a Stage explicitly excluding every selected Persona is "none"', () => {
  const stage = { id: 'a', label: 'A', personas: ['other'] };
  assert.equal(classifyStageForPersonas(stage, ['p1', 'p2']), 'none');
});

// ---------------------------------------------------------------------------
// Transitions derive applicability from both endpoints, never a new field.

test('classifyTransitionForPersonas: shared only when both endpoints are applicable to every selected Persona', () => {
  const stageById = new Map([
    ['a', { id: 'a', personas: ['p1', 'p2'] }],
    ['b', { id: 'b', personas: ['p1', 'p2'] }],
    ['c', { id: 'c', personas: ['p1'] }],
  ]);
  assert.equal(classifyTransitionForPersonas({ from: 'a', to: 'b' }, stageById, ['p1', 'p2']), 'shared');
  assert.equal(classifyTransitionForPersonas({ from: 'a', to: 'c' }, stageById, ['p1', 'p2']), 'divergent');
});

test('classifyTransitionForPersonas: none when neither endpoint is applicable to any selected Persona', () => {
  const stageById = new Map([
    ['a', { id: 'a', personas: ['other'] }],
    ['b', { id: 'b', personas: ['other'] }],
  ]);
  assert.equal(classifyTransitionForPersonas({ from: 'a', to: 'b' }, stageById, ['p1', 'p2']), 'none');
});

test('classifyTransitionForPersonas: general endpoints (no restriction) make the transition shared', () => {
  const stageById = new Map([
    ['a', { id: 'a' }],
    ['b', { id: 'b' }],
  ]);
  assert.equal(classifyTransitionForPersonas({ from: 'a', to: 'b' }, stageById, ['p1', 'p2']), 'shared');
});

// ---------------------------------------------------------------------------
// Reuses the existing rule, never a second applicability model.

test('classifyStageForPersonas agrees with isStageApplicableToPersona for a single-Persona selection', () => {
  const stages = [
    { id: 'a' },
    { id: 'b', personas: ['p1'] },
    { id: 'c', personas: ['p2'] },
    { id: 'd', personas: ['p1', 'p2'] },
  ];
  for (const stage of stages) {
    const classification = classifyStageForPersonas(stage, ['p1']);
    const applicable = isStageApplicableToPersona(stage, 'p1');
    assert.equal(classification === 'none', !applicable);
  }
});

// ---------------------------------------------------------------------------
// Purity / immutability.

test('classifyStageForPersonas and classifyTransitionForPersonas never mutate their inputs', () => {
  const stage = Object.freeze({ id: 'a', label: 'A', personas: Object.freeze(['p1']) });
  const stageById = new Map([['a', stage], ['b', Object.freeze({ id: 'b', label: 'B' })]]);
  assert.doesNotThrow(() => classifyStageForPersonas(stage, ['p1', 'p2']));
  assert.doesNotThrow(() => classifyTransitionForPersonas({ from: 'a', to: 'b' }, stageById, ['p1', 'p2']));
  assert.deepEqual(stage.personas, ['p1']);
});

test('an empty selected-Persona set never throws or defaults to shared: restricted stages become none, general stays general', () => {
  assert.equal(classifyStageForPersonas({ id: 'a' }, []), 'general');
  assert.equal(classifyStageForPersonas({ id: 'a', personas: ['p1'] }, []), 'none');
});
