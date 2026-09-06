// Phase 12: the single semantic rule Persona-focused presentation is built
// on. Pure and read-only — never mutates `stage`, never reads or writes
// anything beyond the two arguments. The client-side Persona Lens script
// embedded by render-funnel.mjs (see renderPersonaLens()) implements this
// exact same rule against `data-node-personas` (a CSV of stage.personas,
// omitted entirely when stage.personas is omitted) because the browser runs
// plain inline script, not this ES module — keep the two in sync if this
// rule ever changes.
export function isStageApplicableToPersona(stage, personaId) {
  if (!Array.isArray(stage.personas)) return true; // omitted -> applies generally
  return stage.personas.includes(personaId);
}

// Phase 16 (Workstream B): a stable, deterministic *presentation* identity
// for a Persona, derived from its authored id — never authored, never
// stored, and never a field on the Persona semantic object. The same
// Persona id always maps to the same token, so the same visual identity
// appears in the Persona Lens filter buttons, Explore's Personas group, and
// anywhere else this function is consulted, without requiring an author to
// pick a color.
//
// The token set is not new color: it is the seven existing brand stroke
// custom properties (assets/template.html's :root/[data-theme] variables)
// already used, tuned, and theme/preset-aware for six other purposes across
// this codebase (Architecture component kind, outcome styling, etc.). This
// keeps Persona identity inside the one existing "alias a semantic value
// onto an existing brand token" convention rather than inventing a second
// color system, and it means every visual preset/theme this repository
// already supports renders a correct, contrast-tuned color for free.
const PERSONA_TOKENS = Object.freeze([
  '--frontend-stroke',
  '--backend-stroke',
  '--database-stroke',
  '--cloud-stroke',
  '--security-stroke',
  '--messagebus-stroke',
  '--external-stroke',
]);

function hashPersonaId(personaId) {
  let hash = 0;
  const text = String(personaId);
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function personaVisualToken(personaId) {
  return PERSONA_TOKENS[hashPersonaId(personaId) % PERSONA_TOKENS.length];
}

// Part 2 (Workstream D): Multi-Persona comparison classification. This is
// the ONLY applicability model used — it is a thin aggregation over
// isStageApplicableToPersona(), never a second, independently-invented rule.
// A Stage or Transition is classified against a set of selected Persona
// ids as exactly one of:
//   'general'   — the Stage carries no `personas` restriction at all (the
//                 same "omitted -> applies generally" fact every selected
//                 Persona shares, not a coincidence of the current
//                 selection)
//   'shared'    — restricted, but every selected Persona is applicable
//   'divergent' — applicable to at least one but not all selected Personas
//   'none'      — applicable to none of the selected Personas
// With exactly one selected Persona, 'divergent' is impossible by
// construction (a single persona is either fully applicable or not at
// all), so this reduces to the same two outcomes single-Persona Lens mode
// already produces — comparison mode is a strict generalization, not a
// parallel model.
export function classifyStageForPersonas(stage, personaIds) {
  if (!Array.isArray(stage.personas)) return 'general';
  if (!personaIds.length) return 'none';
  const applicableCount = personaIds.filter((id) => isStageApplicableToPersona(stage, id)).length;
  if (applicableCount === personaIds.length) return 'shared';
  if (applicableCount === 0) return 'none';
  return 'divergent';
}

// A Transition has no `personas` field of its own (Task/Workstream D5: "do
// not invent new semantic transition rules") — its applicability is always
// derived from whether BOTH endpoint Stages are applicable to a given
// Persona, the same rule the existing single-Persona Lens script already
// applies when matching edges (`applicable[from] && applicable[to]`).
export function classifyTransitionForPersonas(transition, stageById, personaIds) {
  const fromStage = stageById.get(transition.from);
  const toStage = stageById.get(transition.to);
  if (!fromStage || !toStage || !personaIds.length) return 'none';
  const applicableCount = personaIds.filter((id) => (
    isStageApplicableToPersona(fromStage, id) && isStageApplicableToPersona(toStage, id)
  )).length;
  if (applicableCount === personaIds.length) return 'shared';
  if (applicableCount === 0) return 'none';
  return 'divergent';
}
