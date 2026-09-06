import { translateMessage } from '../shared/i18n.mjs';
import { personaVisualToken } from './persona-focus.mjs';

// Phase 15: a small, generic humanizer for a controlled enum value with no
// per-language translation table of its own — the same fallback shape
// assets/template.html's client-side viewerKindLabel() already uses for
// unrecognized data-node-kind values (e.g. "conversion" -> "Conversion").
// funnel.schema.json's Touchpoint.type enum (web, mobile-app, email, phone,
// in-person, notification, partner, other) is reused verbatim; this only
// changes how its value reads, never its value.
function humanizeTouchpointType(type) {
  return String(type)
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// Phase 16 (Workstream C): the same humanization approach as
// humanizeTouchpointType, applied to Transition.role. Omitted role reads as
// "Primary" — the same default-appearance rule Phase 14's renderer styling
// already applies (an omitted role and an explicit role: "primary" render
// identically), so Explore's text stays consistent with what the Overview
// graph actually shows.
function humanizeTransitionRole(role) {
  return humanizeTouchpointType(role || 'primary');
}

// Phase 11: a pure, read-only projection from FunnelDocument to the detail a
// Stage's Explore reveal shows. It never mutates its input and never adds a
// second semantic model — every value here is looked up directly from the
// validated document (Phase 9's validateFunnelReferences already guarantees
// every reference resolves, so lookups here never need a defensive fallback
// for a dangling id).

// Structured detail for one Stage: its own fields plus every collection that
// references it, resolved to full objects. This is the projection other
// future presentation code (not just render-funnel.mjs) can build on.
export function deriveStageDetail(funnel, stageId) {
  const stage = (funnel.stages || []).find((candidate) => candidate.id === stageId);
  if (!stage) throw new Error(`deriveStageDetail: unknown stage id ${JSON.stringify(stageId)}`);

  const personaById = new Map((funnel.personas || []).map((persona) => [persona.id, persona]));
  const touchpointById = new Map((funnel.touchpoints || []).map((touchpoint) => [touchpoint.id, touchpoint]));
  const stageById = new Map((funnel.stages || []).map((candidate) => [candidate.id, candidate]));

  // Phase 16 (Workstream C): every Transition touching this Stage, in
  // authored order, resolved to its neighbor Stage's label — the smallest
  // generic representation of "what connects here and with what role"
  // without turning Transitions into graph nodes or requiring edges to
  // become independently focusable. A self-referencing transition
  // (from === to === stageId) appears once, as an outgoing entry, matching
  // how the Overview already renders it (Phase 10's known straight-line
  // limitation) rather than inventing a second "self" direction.
  const transitions = (funnel.transitions || [])
    .filter((transition) => transition.from === stageId || transition.to === stageId)
    .map((transition) => {
      const direction = transition.from === stageId ? 'out' : 'in';
      const neighborId = direction === 'out' ? transition.to : transition.from;
      const neighbor = stageById.get(neighborId);
      return {
        direction,
        neighborId,
        neighborLabel: neighbor ? neighbor.label : neighborId,
        role: transition.role || 'primary',
        label: transition.label,
      };
    });

  // Omitted stage.personas means the Stage applies generally, per the
  // approved Phase 6 semantic model — represented here as an empty list,
  // not a fabricated "all personas" entry.
  const personas = (stage.personas || []).map((personaId) => personaById.get(personaId));

  const actions = (funnel.actions || [])
    .filter((action) => action.stage === stageId)
    .map((action) => ({
      id: action.id,
      label: action.label,
      description: action.description,
      optional: action.optional === true,
      friction: action.friction,
      touchpoint: action.touchpoint ? touchpointById.get(action.touchpoint) : null,
    }));

  return {
    id: stage.id,
    label: stage.label,
    decision: stage.decision,
    outcome: stage.outcome,
    friction: stage.friction,
    personas,
    actions,
    transitions,
  };
}

// Presentation-shaped projection: an array of {title, items[]} groups ready
// for the Semantic Passport's generic detail-groups slot
// (data-node-detail-groups, renderers/shared/cli.mjs's focusNodeAttrs). Group
// order is fixed and deterministic; a group is omitted entirely when it has
// nothing to show, so a Stage with no optional detail produces an empty
// array (the Passport then shows no extra section at all).
// `extraGroups` (Phase 16, Workstream D): zero or more already-built
// {title, items[]} groups a caller wants appended after the Funnel-derived
// ones — used by render-funnel.mjs to attach a Cross-Link "Architecture"
// group without this module knowing Cross-Link exists. Defaults to an
// empty array, so every existing call site is unaffected.
export function deriveStageDetailGroups(funnel, stageId, locale, extraGroups = []) {
  const detail = deriveStageDetail(funnel, stageId);
  const groups = [];

  if (detail.decision) {
    groups.push({ title: translateMessage(locale, 'funnel.detail.decision'), items: [detail.decision] });
  }

  if (detail.actions.length) {
    groups.push({
      title: translateMessage(locale, 'funnel.detail.actions'),
      items: detail.actions.map((action) => {
        const touchpointSuffix = action.touchpoint ? ` — ${action.touchpoint.label}` : '';
        const text = `${action.label}${touchpointSuffix}`;
        // Phase 15: optionality is a generic {text, tag} item (rendered as a
        // small, neutral tag by the Semantic Passport's generic
        // renderDetailGroups(), not a Funnel-specific component) instead of
        // Phase 11's inline "(optional)" text — a required Action (optional
        // omitted or false) is untouched: still a plain string, identical to
        // every prior phase's output.
        return action.optional
          ? { text, tag: translateMessage(locale, 'funnel.detail.actionOptionalTag') }
          : text;
      }),
    });
  }

  // Touchpoints are presented per their association with an Action (Task 5),
  // deduplicated by id so a reused Touchpoint appears once even when several
  // Actions on this Stage reference it — the underlying Touchpoint object in
  // the source document is never duplicated, only its label is listed once.
  // Phase 15: each item also carries the Touchpoint's required `type` as a
  // {text, tag} pair, so its category reads at a glance instead of requiring
  // inference from the label text alone. `type` itself is untouched — only
  // how it is displayed changes (humanizeTouchpointType above).
  const seenTouchpointIds = new Set();
  const touchpointItems = [];
  for (const action of detail.actions) {
    if (!action.touchpoint || seenTouchpointIds.has(action.touchpoint.id)) continue;
    seenTouchpointIds.add(action.touchpoint.id);
    touchpointItems.push({ text: action.touchpoint.label, tag: humanizeTouchpointType(action.touchpoint.type) });
  }
  if (touchpointItems.length) {
    groups.push({ title: translateMessage(locale, 'funnel.detail.touchpoints'), items: touchpointItems });
  }

  if (detail.personas.length) {
    groups.push({
      title: translateMessage(locale, 'funnel.detail.personas'),
      // Phase 16 (Workstream B): the same deterministic swatch token
      // personaVisualToken() derives for Persona Lens's filter buttons, so
      // the same Persona reads with the same identity in both surfaces. The
      // Persona's authored label remains the only accessible identifier —
      // the swatch is a non-essential, generic-item-shape addition (see
      // assets/template.html's renderDetailGroups()), never color-only.
      items: detail.personas.map((persona) => ({ text: persona.label, swatch: personaVisualToken(persona.id) })),
    });
  }

  // Phase 16 (Workstream C): Transition role, already visually established
  // on the Overview graph since Phase 14, also reads in the Stage Passport
  // — the smallest generic representation (an arrow-direction text plus a
  // role tag) rather than making edges independently focusable or adding a
  // Funnel-specific Passport section.
  if (detail.transitions.length) {
    groups.push({
      title: translateMessage(locale, 'funnel.detail.transitions'),
      items: detail.transitions.map((transition) => {
        const arrow = transition.direction === 'out' ? '→' : '←';
        const labelSuffix = transition.label ? ` — ${transition.label}` : '';
        return {
          text: `${arrow} ${transition.neighborLabel}${labelSuffix}`,
          tag: humanizeTransitionRole(transition.role),
        };
      }),
    });
  }

  const frictionItems = [];
  if (detail.friction) frictionItems.push(detail.friction);
  for (const action of detail.actions) {
    if (action.friction) frictionItems.push(`${action.label}: ${action.friction}`);
  }
  if (frictionItems.length) {
    groups.push({ title: translateMessage(locale, 'funnel.detail.friction'), items: frictionItems });
  }

  for (const extraGroup of extraGroups) {
    if (extraGroup && Array.isArray(extraGroup.items) && extraGroup.items.length) groups.push(extraGroup);
  }

  return groups;
}
