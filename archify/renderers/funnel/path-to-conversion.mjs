// Part 2 (Workstream C): "how can a customer move from this point toward
// conversion?" — a presentation/interaction feature derived entirely from
// the existing Funnel semantic model (`stages`, `transitions`). No new
// field is added to funnel.schema.json: no pathToConversion array, no path
// state, no conversion probability, no analytics metric. Everything here is
// a pure function over an already-validated FunnelDocument; nothing is
// mutated, and nothing depends on render coordinates or DOM state.
//
// Algorithm: a single breadth-first search from the selected Stage,
// following `transitions[].from -> transitions[].to` in the forward
// (authored) direction only — the same direction a customer's journey
// actually progresses. BFS visits each Stage at most once (a `distance` map
// doubling as the visited set), so a cycle can never cause infinite
// traversal, duplicate expansion, or exponential search: total work is
// O(stages + transitions) regardless of how many cycles exist. Because BFS
// explores in non-decreasing distance order, the first time a Stage is
// reached is via a shortest path, and every reachable conversion Stage
// (there may be several) is discovered in one pass.
//
// Deterministic tie-break rule (documented, not incidental): neighbors are
// expanded in the exact order `funnel.transitions` authors them (grouped by
// `from`, preserving array order) — never Map/object iteration order,
// never randomness. When two paths could reach the same Stage at the same
// distance, whichever transition appears earlier in the authored array
// wins that Stage's predecessor, and hence its reconstructed path. When
// several conversion Stages are reachable, they are returned sorted by
// (distance ascending, then the conversion Stage's own position in the
// authored `stages` array ascending) — again fully determined by authored
// order, never by iteration order that is not semantically guaranteed.

export function findConversionStageIds(funnel) {
  return (funnel.stages || [])
    .filter((stage) => stage.outcome === 'conversion')
    .map((stage) => stage.id);
}

function buildForwardAdjacency(funnel) {
  const adjacency = new Map();
  for (const transition of funnel.transitions || []) {
    if (!adjacency.has(transition.from)) adjacency.set(transition.from, []);
    adjacency.get(transition.from).push(transition.to);
  }
  return adjacency;
}

// Pure BFS from `fromStageId`. Returns:
//   - reachable: whether ANY conversion Stage is reachable
//   - conversions: every reachable conversion Stage, each with its own
//     deterministic shortest path (see tie-break rule above), sorted
//     nearest-first
//   - primary: conversions[0], or null — a single deterministic choice for
//     presentation to highlight by default; the caller is expected to also
//     surface `conversions.length` so the UI never implies this is the only
//     possible route (see renderPathToConversionLens in render-funnel.mjs).
export function computePathsToConversion(funnel, fromStageId) {
  const stageIndex = new Map((funnel.stages || []).map((stage, index) => [stage.id, index]));
  if (!stageIndex.has(fromStageId)) {
    throw new Error(`computePathsToConversion: unknown stage id ${JSON.stringify(fromStageId)}`);
  }

  const conversionIds = new Set(findConversionStageIds(funnel));
  const adjacency = buildForwardAdjacency(funnel);

  const distance = new Map([[fromStageId, 0]]);
  const predecessor = new Map();
  const queue = [fromStageId];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    for (const next of adjacency.get(current) || []) {
      if (distance.has(next)) continue; // already discovered via a shortest (or earlier-tied) path
      distance.set(next, distance.get(current) + 1);
      predecessor.set(next, current);
      queue.push(next);
    }
  }

  function reconstructPath(stageId) {
    const path = [stageId];
    let cursor = stageId;
    while (predecessor.has(cursor)) {
      cursor = predecessor.get(cursor);
      path.push(cursor);
    }
    path.reverse();
    return path;
  }

  const conversions = [...conversionIds]
    .filter((id) => distance.has(id))
    .map((id) => ({ stageId: id, distance: distance.get(id), path: reconstructPath(id) }))
    .sort((a, b) => (a.distance - b.distance) || (stageIndex.get(a.stageId) - stageIndex.get(b.stageId)));

  return {
    fromStageId,
    reachable: conversions.length > 0,
    conversions,
    primary: conversions[0] || null,
  };
}

// Precomputes computePathsToConversion for every Stage once, server-side —
// consumed as static JSON by the client-side Path Lens (renderPathToConversionLens
// in render-funnel.mjs) so the browser never needs a second implementation
// of this traversal. The same "compute once in Node, embed as data, let the
// browser only look up and present" pattern assets/template.html's own
// Guided Views already establish for their precomputed chapter data.
export function computeAllPathsToConversion(funnel) {
  const result = {};
  for (const stage of funnel.stages || []) {
    result[stage.id] = computePathsToConversion(funnel, stage.id);
  }
  return result;
}

// The set of directed (from -> to) pairs a path's consecutive Stages imply
// — used to match against transitions[] for edge highlighting. A path with
// n Stages has n-1 edges; a Stage with no outgoing path (already at
// conversion, or unreachable) has zero.
export function pathEdgePairs(path) {
  const pairs = [];
  for (let i = 0; i + 1 < path.length; i += 1) pairs.push([path[i], path[i + 1]]);
  return pairs;
}
