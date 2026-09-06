// Part 2 (Workstream C): pure graph-traversal tests for
// renderers/funnel/path-to-conversion.mjs. Presentation/rendering
// integration (render-funnel.mjs's Path Lens) is covered separately in
// test/funnel-path-lens.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAllPathsToConversion,
  computePathsToConversion,
  findConversionStageIds,
  pathEdgePairs,
} from '../renderers/funnel/path-to-conversion.mjs';

function stage(id, overrides = {}) {
  return { id, label: id, ...overrides };
}

function transition(id, from, to, overrides = {}) {
  return { id, from, to, ...overrides };
}

// ---------------------------------------------------------------------------
// 1. Simple linear path.

test('a simple linear path is found in order, shortest distance first', () => {
  const funnel = {
    stages: [stage('a'), stage('b'), stage('c'), stage('d', { outcome: 'conversion' })],
    transitions: [transition('t1', 'a', 'b'), transition('t2', 'b', 'c'), transition('t3', 'c', 'd')],
  };
  const result = computePathsToConversion(funnel, 'a');
  assert.equal(result.reachable, true);
  assert.equal(result.conversions.length, 1);
  assert.deepEqual(result.primary, { stageId: 'd', distance: 3, path: ['a', 'b', 'c', 'd'] });
});

// ---------------------------------------------------------------------------
// 2. Branching.

test('branching: both branches are explored; the shortest reaches conversion first', () => {
  const funnel = {
    stages: [stage('a'), stage('long1'), stage('long2'), stage('short'), stage('z', { outcome: 'conversion' })],
    transitions: [
      transition('t1', 'a', 'long1'),
      transition('t2', 'long1', 'long2'),
      transition('t3', 'long2', 'z'),
      transition('t4', 'a', 'short'),
      transition('t5', 'short', 'z'),
    ],
  };
  const result = computePathsToConversion(funnel, 'a');
  assert.equal(result.primary.distance, 2);
  assert.deepEqual(result.primary.path, ['a', 'short', 'z']);
});

// ---------------------------------------------------------------------------
// 3. Reconvergence.

test('reconvergence: two branches rejoin before conversion, and the shortest overall path is used', () => {
  const funnel = {
    stages: [stage('a'), stage('left'), stage('right'), stage('join'), stage('z', { outcome: 'conversion' })],
    transitions: [
      transition('t1', 'a', 'left'),
      transition('t2', 'a', 'right'),
      transition('t3', 'left', 'join'),
      transition('t4', 'right', 'join'),
      transition('t5', 'join', 'z'),
    ],
  };
  const result = computePathsToConversion(funnel, 'a');
  assert.equal(result.primary.distance, 3);
  // Deterministic tie-break: 'left' is authored before 'right' (t1 before
  // t2), so 'join' is first discovered via 'left'.
  assert.deepEqual(result.primary.path, ['a', 'left', 'join', 'z']);
});

// ---------------------------------------------------------------------------
// 4. Multiple conversion endpoints.

test('multiple conversion endpoints: every reachable one is reported, nearest first', () => {
  const funnel = {
    stages: [stage('a'), stage('near', { outcome: 'conversion' }), stage('mid'), stage('far', { outcome: 'conversion' })],
    transitions: [
      transition('t1', 'a', 'near'),
      transition('t2', 'a', 'mid'),
      transition('t3', 'mid', 'far'),
    ],
  };
  const result = computePathsToConversion(funnel, 'a');
  assert.equal(result.conversions.length, 2);
  assert.deepEqual(result.conversions.map((c) => c.stageId), ['near', 'far']);
  assert.equal(result.primary.stageId, 'near');
});

test('two conversion endpoints reachable at the same distance are ordered by authored Stage order', () => {
  const funnel = {
    stages: [stage('a'), stage('convB', { outcome: 'conversion' }), stage('convA', { outcome: 'conversion' })],
    transitions: [transition('t1', 'a', 'convB'), transition('t2', 'a', 'convA')],
  };
  const result = computePathsToConversion(funnel, 'a');
  assert.equal(result.conversions.length, 2);
  // Both at distance 1; 'convB' is authored before 'convA' in stages[], so
  // it sorts first despite the transition to convA being authored second
  // too — the tie-break for *ordering reachable conversions* is Stage
  // authoring order, independent of transition order.
  assert.deepEqual(result.conversions.map((c) => c.stageId), ['convB', 'convA']);
});

// ---------------------------------------------------------------------------
// 5. Unreachable conversion.

test('an unreachable conversion Stage is reported as unreachable, not silently omitted with reachable:true', () => {
  const funnel = {
    stages: [stage('a'), stage('deadend'), stage('z', { outcome: 'conversion' })],
    transitions: [transition('t1', 'a', 'deadend')],
  };
  const result = computePathsToConversion(funnel, 'a');
  assert.equal(result.reachable, false);
  assert.deepEqual(result.conversions, []);
  assert.equal(result.primary, null);
});

// ---------------------------------------------------------------------------
// 6. Cycle with no conversion.

test('a cycle with no reachable conversion terminates (no infinite traversal) and reports unreachable', () => {
  const funnel = {
    stages: [stage('a'), stage('b'), stage('c')],
    transitions: [transition('t1', 'a', 'b'), transition('t2', 'b', 'c'), transition('t3', 'c', 'a')],
  };
  const result = computePathsToConversion(funnel, 'a');
  assert.equal(result.reachable, false);
  assert.deepEqual(result.conversions, []);
});

// ---------------------------------------------------------------------------
// 7. Cycle with a reachable conversion beyond it.

test('a valid conversion reachable beyond a cycle remains discoverable', () => {
  const funnel = {
    stages: [stage('a'), stage('b'), stage('c'), stage('z', { outcome: 'conversion' })],
    transitions: [
      transition('t1', 'a', 'b'),
      transition('t2', 'b', 'c'),
      transition('t3', 'c', 'a'), // cycle back to a
      transition('t4', 'c', 'z'), // exit toward conversion
    ],
  };
  const result = computePathsToConversion(funnel, 'a');
  assert.equal(result.reachable, true);
  assert.deepEqual(result.primary.path, ['a', 'b', 'c', 'z']);
});

test('a self-loop transition never causes infinite traversal', () => {
  const funnel = {
    stages: [stage('a'), stage('z', { outcome: 'conversion' })],
    transitions: [transition('t1', 'a', 'a'), transition('t2', 'a', 'z')],
  };
  const result = computePathsToConversion(funnel, 'a');
  assert.equal(result.reachable, true);
  assert.deepEqual(result.primary.path, ['a', 'z']);
});

// ---------------------------------------------------------------------------
// 8. Dropoff stages: plain graph nodes, no special traversal treatment.

test('a dropoff-outcome Stage is treated as an ordinary node — traversal passes through it like any other', () => {
  const funnel = {
    stages: [stage('a'), stage('dropoff', { outcome: 'dropoff' }), stage('z', { outcome: 'conversion' })],
    transitions: [transition('t1', 'a', 'dropoff'), transition('t2', 'dropoff', 'z')],
  };
  const result = computePathsToConversion(funnel, 'a');
  assert.deepEqual(result.primary.path, ['a', 'dropoff', 'z']);
});

test('a dropoff Stage with no outgoing transitions is a dead end, not a special traversal stop', () => {
  const funnel = {
    stages: [stage('a'), stage('dropoff', { outcome: 'dropoff' }), stage('z', { outcome: 'conversion' })],
    transitions: [transition('t1', 'a', 'dropoff')],
  };
  const result = computePathsToConversion(funnel, 'a');
  assert.equal(result.reachable, false);
});

// ---------------------------------------------------------------------------
// 9. Alternative/loop-role transitions: followed like any other edge.

test('alternative and loop-role transitions are followed exactly like primary transitions', () => {
  const funnel = {
    stages: [stage('a'), stage('b'), stage('z', { outcome: 'conversion' })],
    transitions: [
      transition('t1', 'a', 'b', { role: 'alternative' }),
      transition('t2', 'b', 'a', { role: 'loop' }),
      transition('t3', 'b', 'z', { role: 'primary' }),
    ],
  };
  const result = computePathsToConversion(funnel, 'a');
  assert.deepEqual(result.primary.path, ['a', 'b', 'z']);
});

// ---------------------------------------------------------------------------
// 10. Deterministic path selection: repeated calls agree, and the choice
// does not depend on object/Map iteration order (verified by feeding the
// same graph with transitions authored in a different array order, which
// legitimately changes the tie-break result deterministically — not
// randomly).

test('repeated calls on the same input are byte-identical (deterministic)', () => {
  const funnel = {
    stages: [stage('a'), stage('b'), stage('c'), stage('z', { outcome: 'conversion' })],
    transitions: [transition('t1', 'a', 'b'), transition('t2', 'b', 'c'), transition('t3', 'c', 'z')],
  };
  const first = JSON.stringify(computePathsToConversion(funnel, 'a'));
  const second = JSON.stringify(computePathsToConversion(funnel, 'a'));
  assert.equal(first, second);
});

test('the tie-break follows authored transition order, not insertion-independent iteration', () => {
  const viaB = {
    stages: [stage('a'), stage('b'), stage('c'), stage('z', { outcome: 'conversion' })],
    transitions: [transition('t1', 'a', 'b'), transition('t2', 'a', 'c'), transition('t3', 'b', 'z'), transition('t4', 'c', 'z')],
  };
  const viaC = {
    stages: [stage('a'), stage('b'), stage('c'), stage('z', { outcome: 'conversion' })],
    transitions: [transition('t2', 'a', 'c'), transition('t1', 'a', 'b'), transition('t4', 'c', 'z'), transition('t3', 'b', 'z')],
  };
  assert.deepEqual(computePathsToConversion(viaB, 'a').primary.path, ['a', 'b', 'z']);
  assert.deepEqual(computePathsToConversion(viaC, 'a').primary.path, ['a', 'c', 'z']);
});

// ---------------------------------------------------------------------------
// 11. Stable authored IDs / 12. Source immutability.

test('computePathsToConversion never mutates the source document', () => {
  const funnel = {
    stages: [stage('a'), stage('b', { outcome: 'conversion' })],
    transitions: [transition('t1', 'a', 'b')],
  };
  const before = JSON.stringify(funnel);
  computePathsToConversion(funnel, 'a');
  computeAllPathsToConversion(funnel);
  assert.equal(JSON.stringify(funnel), before);
});

test('path stage ids are exactly the authored ids, never rewritten or synthesized', () => {
  const funnel = {
    stages: [stage('discovery'), stage('checkout'), stage('confirmed', { outcome: 'conversion' })],
    transitions: [transition('t1', 'discovery', 'checkout'), transition('t2', 'checkout', 'confirmed')],
  };
  const result = computePathsToConversion(funnel, 'discovery');
  assert.deepEqual(result.primary.path, ['discovery', 'checkout', 'confirmed']);
  assert.equal(result.primary.stageId, 'confirmed');
});

// ---------------------------------------------------------------------------
// Supporting helpers.

test('findConversionStageIds returns conversion stage ids in authored order', () => {
  const funnel = { stages: [stage('a', { outcome: 'conversion' }), stage('b'), stage('c', { outcome: 'conversion' })] };
  assert.deepEqual(findConversionStageIds(funnel), ['a', 'c']);
});

test('pathEdgePairs derives consecutive directed pairs from a path', () => {
  assert.deepEqual(pathEdgePairs(['a', 'b', 'c']), [['a', 'b'], ['b', 'c']]);
  assert.deepEqual(pathEdgePairs(['a']), []);
  assert.deepEqual(pathEdgePairs([]), []);
});

test('computeAllPathsToConversion precomputes a result for every Stage, keyed by id', () => {
  const funnel = {
    stages: [stage('a'), stage('b'), stage('z', { outcome: 'conversion' })],
    transitions: [transition('t1', 'a', 'b'), transition('t2', 'b', 'z')],
  };
  const all = computeAllPathsToConversion(funnel);
  assert.deepEqual(Object.keys(all).sort(), ['a', 'b', 'z']);
  assert.equal(all.a.primary.distance, 2);
  // 'z' is itself a conversion Stage, so it is trivially reachable from
  // itself at distance 0 — a one-Stage path, not a special "already there"
  // case requiring different handling.
  assert.equal(all.z.reachable, true);
  assert.deepEqual(all.z.primary, { stageId: 'z', distance: 0, path: ['z'] });
});

test('computePathsToConversion throws on an unknown starting stage id', () => {
  const funnel = { stages: [stage('a')], transitions: [] };
  assert.throws(() => computePathsToConversion(funnel, 'no-such-stage'));
});
