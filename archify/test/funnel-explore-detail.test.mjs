import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveStageDetail, deriveStageDetailGroups } from '../renderers/funnel/explore-detail.mjs';

function richDocument() {
  return {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'explore fixture' },
    personas: [
      { id: 'newCustomer', label: 'New Customer' },
      { id: 'returningCustomer', label: 'Returning Customer' },
    ],
    stages: [
      { id: 'discovery', label: 'Discovery', personas: ['newCustomer'] },
      { id: 'browse', label: 'Browse Products', outcome: 'dropoff' },
      {
        id: 'checkout',
        label: 'Checkout',
        decision: 'Continue to checkout?',
        friction: 'The shipping address form asks for the same details twice',
      },
      { id: 'confirmed', label: 'Order Confirmed', outcome: 'conversion' },
    ],
    touchpoints: [
      { id: 'web', type: 'web', label: 'Storefront website' },
      { id: 'confirmationEmail', type: 'email', label: 'Order confirmation email' },
    ],
    actions: [
      { id: 'search', stage: 'discovery', label: 'Search for a product', touchpoint: 'web' },
      { id: 'compare', stage: 'browse', label: 'Compare a few options', touchpoint: 'web', optional: true },
      {
        id: 'fillAddress',
        stage: 'checkout',
        label: 'Fill in the shipping address',
        touchpoint: 'web',
        friction: 'Repeated validation errors on the postal code field',
      },
      { id: 'pay', stage: 'checkout', label: 'Enter payment details', touchpoint: 'web' },
      {
        id: 'receiveConfirmation',
        stage: 'confirmed',
        label: 'Receive order confirmation',
        touchpoint: 'confirmationEmail',
        optional: true,
        description: 'Sent automatically once payment is captured',
      },
    ],
    transitions: [
      { id: 't1', from: 'discovery', to: 'browse' },
      { id: 't2', from: 'browse', to: 'checkout' },
      { id: 't3', from: 'checkout', to: 'confirmed' },
    ],
  };
}

// ---------------------------------------------------------------------------
// deriveStageDetail: correctness of resolution

test('1/2. selecting a Stage exposes its id and label', () => {
  const detail = deriveStageDetail(richDocument(), 'checkout');
  assert.equal(detail.id, 'checkout');
  assert.equal(detail.label, 'Checkout');
});

test('3. Stage decision is exposed when present', () => {
  const detail = deriveStageDetail(richDocument(), 'checkout');
  assert.equal(detail.decision, 'Continue to checkout?');
});

test('decision is undefined when absent', () => {
  const detail = deriveStageDetail(richDocument(), 'discovery');
  assert.equal(detail.decision, undefined);
});

test('4. Stage outcome is exposed when present (conversion and dropoff)', () => {
  const doc = richDocument();
  assert.equal(deriveStageDetail(doc, 'browse').outcome, 'dropoff');
  assert.equal(deriveStageDetail(doc, 'confirmed').outcome, 'conversion');
});

test('5. Stage friction is exposed when present', () => {
  const detail = deriveStageDetail(richDocument(), 'checkout');
  assert.equal(detail.friction, 'The shipping address form asks for the same details twice');
});

test('6. Stage Personas resolve to full Persona objects', () => {
  const detail = deriveStageDetail(richDocument(), 'discovery');
  assert.deepEqual(detail.personas, [{ id: 'newCustomer', label: 'New Customer' }]);
});

test('7. a Stage with omitted personas resolves to an empty list (applies generally)', () => {
  const detail = deriveStageDetail(richDocument(), 'browse');
  assert.deepEqual(detail.personas, []);
});

test('8. Actions associated with the Stage are resolved correctly', () => {
  const detail = deriveStageDetail(richDocument(), 'checkout');
  assert.deepEqual(detail.actions.map((a) => a.id), ['fillAddress', 'pay']);
});

test('9. Actions from another Stage are excluded', () => {
  const detail = deriveStageDetail(richDocument(), 'checkout');
  assert.equal(detail.actions.some((a) => a.id === 'search'), false);
  assert.equal(detail.actions.some((a) => a.id === 'compare'), false);
});

test('10. Action description is preserved', () => {
  const detail = deriveStageDetail(richDocument(), 'confirmed');
  const action = detail.actions.find((a) => a.id === 'receiveConfirmation');
  assert.equal(action.description, 'Sent automatically once payment is captured');
});

test('Action description is undefined when not authored', () => {
  const detail = deriveStageDetail(richDocument(), 'checkout');
  const action = detail.actions.find((a) => a.id === 'pay');
  assert.equal(action.description, undefined);
});

test('11. Action optional flag is preserved (true and false/absent)', () => {
  const detail = deriveStageDetail(richDocument(), 'confirmed');
  assert.equal(detail.actions.find((a) => a.id === 'receiveConfirmation').optional, true);
  const checkoutDetail = deriveStageDetail(richDocument(), 'checkout');
  assert.equal(checkoutDetail.actions.find((a) => a.id === 'pay').optional, false);
});

test('12. Action friction is preserved', () => {
  const detail = deriveStageDetail(richDocument(), 'checkout');
  const action = detail.actions.find((a) => a.id === 'fillAddress');
  assert.equal(action.friction, 'Repeated validation errors on the postal code field');
});

test('13. Action Touchpoint resolves to the full Touchpoint object', () => {
  const detail = deriveStageDetail(richDocument(), 'confirmed');
  const action = detail.actions.find((a) => a.id === 'receiveConfirmation');
  assert.deepEqual(action.touchpoint, { id: 'confirmationEmail', type: 'email', label: 'Order confirmation email' });
});

test('an Action with no touchpoint resolves to null, not undefined or a missing key', () => {
  const doc = richDocument();
  doc.actions.push({ id: 'noTouchpoint', stage: 'checkout', label: 'Think it over' });
  const detail = deriveStageDetail(doc, 'checkout');
  const action = detail.actions.find((a) => a.id === 'noTouchpoint');
  assert.equal(action.touchpoint, null);
});

// ---------------------------------------------------------------------------
// 14/15. Touchpoint presentation and reuse

test('14. Touchpoint label/type are preserved via resolution', () => {
  const detail = deriveStageDetail(richDocument(), 'checkout');
  assert.equal(detail.actions[0].touchpoint.label, 'Storefront website');
  assert.equal(detail.actions[0].touchpoint.type, 'web');
});

test('15. a reused Touchpoint is resolved per Action but not semantically duplicated', () => {
  const doc = richDocument();
  const detail = deriveStageDetail(doc, 'checkout');
  assert.equal(detail.actions[0].touchpoint.label, 'Storefront website');
  assert.equal(detail.actions[1].touchpoint.label, 'Storefront website');
  // Same underlying Touchpoint object identity resolved from the one
  // authored touchpoints[] entry, not two separately constructed copies.
  assert.equal(detail.actions[0].touchpoint, doc.touchpoints[0]);
  assert.equal(detail.actions[1].touchpoint, doc.touchpoints[0]);

  const groups = deriveStageDetailGroups(doc, 'checkout', 'en');
  const touchpointGroup = groups.find((g) => g.title === 'Touchpoints');
  assert.deepEqual(touchpointGroup.items, [{ text: 'Storefront website', tag: 'Web' }]);
});

// ---------------------------------------------------------------------------
// 16/17. Missing optional data does not crash

test('16. missing optional collections (personas/actions/touchpoints) do not crash', () => {
  const doc = {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'minimal' },
    stages: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    transitions: [{ id: 't1', from: 'a', to: 'b' }],
  };
  assert.doesNotThrow(() => deriveStageDetail(doc, 'a'));
  const detail = deriveStageDetail(doc, 'a');
  assert.deepEqual(detail.personas, []);
  assert.deepEqual(detail.actions, []);
  assert.doesNotThrow(() => deriveStageDetailGroups(doc, 'a', 'en'));
});

test('17. missing optional Stage detail (no decision/outcome/friction) does not crash and produces no groups for those fields', () => {
  const doc = richDocument();
  const groups = deriveStageDetailGroups(doc, 'discovery', 'en');
  assert.equal(groups.some((g) => g.title === 'Decision'), false);
  assert.equal(groups.some((g) => g.title === 'Friction'), false);
});

test('a Stage with zero optional detail and zero Transitions touching it produces zero groups', () => {
  const doc = {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'bare' },
    stages: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
    transitions: [{ id: 't1', from: 'a', to: 'b' }],
  };
  // 'c' is not touched by any Transition, so it has no optional detail at
  // all — 'a' does have one (Phase 16: Transitions), covered separately.
  assert.deepEqual(deriveStageDetailGroups(doc, 'c', 'en'), []);
});

test('a Stage touched only by a Transition still gets a Transitions group (Phase 16)', () => {
  const doc = {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'bare' },
    stages: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    transitions: [{ id: 't1', from: 'a', to: 'b' }],
  };
  assert.deepEqual(deriveStageDetailGroups(doc, 'a', 'en'), [
    { title: 'Transitions', items: [{ text: '→ B', tag: 'Primary' }] },
  ]);
});

// ---------------------------------------------------------------------------
// 19/25. Source immutability

test('19. deriving detail does not mutate the source document', () => {
  const doc = richDocument();
  const frozen = JSON.parse(JSON.stringify(doc));
  deriveStageDetail(doc, 'checkout');
  deriveStageDetailGroups(doc, 'checkout', 'en');
  assert.deepEqual(doc, frozen);
});

test('25. source immutability holds across every collection (stages/actions/touchpoints/personas/transitions)', () => {
  const doc = richDocument();
  Object.freeze(doc);
  Object.freeze(doc.stages);
  Object.freeze(doc.actions);
  Object.freeze(doc.touchpoints);
  Object.freeze(doc.personas);
  Object.freeze(doc.transitions);
  doc.stages.forEach(Object.freeze);
  doc.actions.forEach(Object.freeze);
  doc.touchpoints.forEach(Object.freeze);
  doc.personas.forEach(Object.freeze);
  doc.transitions.forEach(Object.freeze);
  assert.doesNotThrow(() => deriveStageDetail(doc, 'checkout'));
  assert.doesNotThrow(() => deriveStageDetailGroups(doc, 'checkout', 'en'));
});

// ---------------------------------------------------------------------------
// 20/24. Determinism

test('20/24. deriving detail twice from the same document produces identical output', () => {
  const doc = richDocument();
  const first = deriveStageDetailGroups(doc, 'checkout', 'en');
  const second = deriveStageDetailGroups(doc, 'checkout', 'en');
  assert.deepEqual(first, second);
});

// ---------------------------------------------------------------------------
// 21/22/23. Graph shape does not affect stage-detail projection

test('21/22/23. branching, reconvergence, and cyclic graphs do not affect Stage-detail projection (detail is Action/Persona-keyed, not graph-keyed)', () => {
  const doc = richDocument();
  doc.transitions.push({ id: 'loopBack', from: 'checkout', to: 'browse', role: 'loop' });
  doc.transitions.push({ id: 'altPath', from: 'discovery', to: 'confirmed', role: 'alternative' });
  const detail = deriveStageDetail(doc, 'checkout');
  assert.equal(detail.decision, 'Continue to checkout?');
  assert.deepEqual(detail.actions.map((a) => a.id), ['fillAddress', 'pay']);
});

// ---------------------------------------------------------------------------
// Full group composition (end-to-end shape check)

test('deriveStageDetailGroups composes Decision, Actions, Touchpoints, Transitions, and Friction in a fixed order', () => {
  const groups = deriveStageDetailGroups(richDocument(), 'checkout', 'en');
  assert.deepEqual(groups.map((g) => g.title), ['Decision', 'Actions', 'Touchpoints', 'Transitions', 'Friction']);
});

test('Actions group items include optional and touchpoint annotations', () => {
  const groups = deriveStageDetailGroups(richDocument(), 'confirmed', 'en');
  const actionsGroup = groups.find((g) => g.title === 'Actions');
  assert.deepEqual(actionsGroup.items, [
    { text: 'Receive order confirmation — Order confirmation email', tag: 'Optional' },
  ]);
});

test('Friction group merges Stage-level and Action-level friction', () => {
  const groups = deriveStageDetailGroups(richDocument(), 'checkout', 'en');
  const frictionGroup = groups.find((g) => g.title === 'Friction');
  assert.deepEqual(frictionGroup.items, [
    'The shipping address form asks for the same details twice',
    'Fill in the shipping address: Repeated validation errors on the postal code field',
  ]);
});

test('an unknown Stage id throws rather than silently inventing detail', () => {
  assert.throws(() => deriveStageDetail(richDocument(), 'doesNotExist'), /unknown stage id/);
});

test('deriveStageDetailGroups localizes group titles (zh-CN)', () => {
  const groups = deriveStageDetailGroups(richDocument(), 'checkout', 'zh-CN');
  assert.deepEqual(groups.map((g) => g.title), ['决策', '客户操作', '接触点', '流转', '摩擦点']);
});
