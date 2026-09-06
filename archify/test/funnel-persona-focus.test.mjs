import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStageApplicableToPersona } from '../renderers/funnel/persona-focus.mjs';

// ---------------------------------------------------------------------------
// Semantic applicability tests (Task 27, items 1-6)

test('1. a Stage with omitted personas applies regardless of which Persona is selected (no filter case is a degenerate "always true")', () => {
  const stage = { id: 'a', label: 'A' };
  assert.equal(isStageApplicableToPersona(stage, 'anyPersona'), true);
  assert.equal(isStageApplicableToPersona(stage, 'anotherPersona'), true);
});

test('2. a Stage with omitted `personas` applies to every selected Persona', () => {
  const stage = { id: 'a', label: 'A' };
  assert.equal(isStageApplicableToPersona(stage, 'newCustomer'), true);
  assert.equal(isStageApplicableToPersona(stage, 'returningCustomer'), true);
});

test('3. a Stage explicitly listing the selected Persona applies', () => {
  const stage = { id: 'a', label: 'A', personas: ['newCustomer'] };
  assert.equal(isStageApplicableToPersona(stage, 'newCustomer'), true);
});

test('4. a Stage explicitly listing another Persona does not apply', () => {
  const stage = { id: 'a', label: 'A', personas: ['returningCustomer'] };
  assert.equal(isStageApplicableToPersona(stage, 'newCustomer'), false);
});

test('5. a Stage listing multiple Personas applies to each one listed', () => {
  const stage = { id: 'a', label: 'A', personas: ['newCustomer', 'returningCustomer'] };
  assert.equal(isStageApplicableToPersona(stage, 'newCustomer'), true);
  assert.equal(isStageApplicableToPersona(stage, 'returningCustomer'), true);
  assert.equal(isStageApplicableToPersona(stage, 'vip'), false);
});

test('does not mutate the Stage object', () => {
  const stage = Object.freeze({ id: 'a', label: 'A', personas: Object.freeze(['newCustomer']) });
  assert.doesNotThrow(() => isStageApplicableToPersona(stage, 'newCustomer'));
  assert.deepEqual(stage.personas, ['newCustomer']);
});

test('an empty personas array means the Stage applies to no one explicitly (distinct from omitted)', () => {
  // Not a case the approved semantic model authors deliberately (schema
  // requires minItems: 1 on stages[].personas), but the pure function's rule
  // must still be well-defined for it: present-but-empty is "explicitly
  // restricted to nobody," not "generally applicable" — only an *omitted*
  // array means general applicability.
  const stage = { id: 'a', label: 'A', personas: [] };
  assert.equal(isStageApplicableToPersona(stage, 'newCustomer'), false);
});
