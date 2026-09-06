import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveStageDetailGroups } from '../renderers/funnel/explore-detail.mjs';

// Phase 16 (Workstream C): Transition.role, already visually established on
// the Overview since Phase 14, now also reads in the Stage Passport via the
// same generic {title, items:[{text, tag}]} detail-group shape Phase 15
// established for Actions/Touchpoints — no Funnel-specific Passport
// component, no edges becoming independently focusable.

function doc(overrides = {}) {
  return {
    schema_version: 1,
    diagram_type: 'funnel',
    meta: { title: 'transition passport fixture' },
    stages: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ],
    transitions: [
      { id: 't1', from: 'a', to: 'b' },
      { id: 't2', from: 'a', to: 'c', role: 'alternative', label: 'Skip ahead' },
      { id: 't3', from: 'c', to: 'a', role: 'loop' },
    ],
    ...overrides,
  };
}

test('a Transition with no role reads as "Primary" in the Transitions group (matches the Overview default-appearance rule)', () => {
  const groups = deriveStageDetailGroups(doc(), 'a', 'en');
  const transitions = groups.find((g) => g.title === 'Transitions').items;
  const outToB = transitions.find((item) => item.text === '→ B');
  assert.equal(outToB.tag, 'Primary');
});

test('an alternative Transition reads as "Alternative"', () => {
  const groups = deriveStageDetailGroups(doc(), 'a', 'en');
  const transitions = groups.find((g) => g.title === 'Transitions').items;
  const outToC = transitions.find((item) => item.text.startsWith('→ C'));
  assert.equal(outToC.tag, 'Alternative');
});

test('a loop Transition reads as "Loop"', () => {
  const groups = deriveStageDetailGroups(doc(), 'a', 'en');
  const transitions = groups.find((g) => g.title === 'Transitions').items;
  const inFromC = transitions.find((item) => item.text === '← C');
  assert.equal(inFromC.tag, 'Loop');
});

test('direction is shown with an arrow: outgoing "→ neighbor", incoming "← neighbor"', () => {
  const groups = deriveStageDetailGroups(doc(), 'a', 'en');
  const transitions = groups.find((g) => g.title === 'Transitions').items.map((item) => item.text);
  assert.ok(transitions.some((text) => text.startsWith('→')));
  assert.ok(transitions.some((text) => text.startsWith('←')));
});

test('an authored Transition label is preserved and appended, not replaced by the role tag', () => {
  const groups = deriveStageDetailGroups(doc(), 'a', 'en');
  const transitions = groups.find((g) => g.title === 'Transitions').items;
  const labeled = transitions.find((item) => item.text.includes('Skip ahead'));
  assert.equal(labeled.text, '→ C — Skip ahead');
  assert.equal(labeled.tag, 'Alternative');
});

test('a Stage touched by no Transition gets no Transitions group', () => {
  const isolated = doc({
    stages: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'lonely', label: 'Lonely' }],
  });
  const groups = deriveStageDetailGroups(isolated, 'lonely', 'en');
  assert.equal(groups.some((g) => g.title === 'Transitions'), false);
});

test('generic Passport architecture: this is data, not a new Passport component — the group is a plain {title, items[]} shape', () => {
  const groups = deriveStageDetailGroups(doc(), 'a', 'en');
  const transitionsGroup = groups.find((g) => g.title === 'Transitions');
  assert.ok(Array.isArray(transitionsGroup.items));
  transitionsGroup.items.forEach((item) => {
    assert.equal(typeof item.text, 'string');
    assert.equal(typeof item.tag, 'string');
  });
});

test('deriveStageDetailGroups does not mutate the source document when deriving Transitions', () => {
  const source = doc();
  const before = JSON.stringify(source);
  deriveStageDetailGroups(source, 'a', 'en');
  assert.equal(JSON.stringify(source), before);
});

test('localizes the Transitions group title (zh-CN)', () => {
  const groups = deriveStageDetailGroups(doc(), 'a', 'zh-CN');
  assert.ok(groups.some((g) => g.title === '流转'));
});
