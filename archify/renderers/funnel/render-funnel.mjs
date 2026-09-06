import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, textUnits } from '../shared/utils.mjs';
import { focusEdgeAttrs, focusNodeAttrs, focusNodeTitle, loadDiagram, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { fittedNodeFontSize } from '../shared/text-fit.mjs';
import { anchor, arrowClassMap, asArray, defaultFromSide, defaultToSide, labelPoint, roundedPath, variantAccent } from '../shared/geometry.mjs';
import { translateMessage } from '../shared/i18n.mjs';
import { deriveStageDetailGroups } from './explore-detail.mjs';
import { personaVisualToken } from './persona-focus.mjs';
import { loadCrossLinkContext } from './cross-link-context.mjs';
import { computeAllPathsToConversion, pathEdgePairs } from './path-to-conversion.mjs';

// Phase 10 Overview renderer: the smallest static projection of
// FunnelDocument.stages/transitions to SVG. It deliberately renders nothing
// else — no Actions/Touchpoints/Personas as separate nodes, no Cards, no
// Guided Views, no animation, no interaction. See
// archify/renderers/funnel/README.md for the positioning-strategy rationale
// and the progressive-disclosure boundary this renderer establishes.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram: funnel, template, outPath, inputPath } = loadDiagram({
  rendererDir: __dirname,
  diagramType: 'funnel',
  defaultExample: 'first-purchase.funnel.json',
});

// Cross-Link (Phase 16, Workstream D): opt-in via `--cross-link <path>`;
// see cross-link-context.mjs for why this never affects any existing
// invocation that omits the flag.
const { crossLinkGroupFor } = loadCrossLinkContext({
  argv: process.argv,
  inputPath,
  funnel,
  locale: funnel.meta.locale,
});

// --- Stage positioning (Phase 9 left this an open question; resolved here as
// renderer-local, deterministic, inferred positioning — see README §Stage
// positioning). No x/y/row/col field exists in funnel.schema.json, and none
// is added: the renderer computes every coordinate from the graph shape on
// each render, so it never needs to be kept in sync with authored data.
const NODE_W = 172;
const NODE_H = 64;
const COL_SPACING = 236;
const ROW_SPACING = 108;
const MARGIN_X = 96;
const MARGIN_Y = 72;

const stages = asArray(funnel.stages);
const transitions = asArray(funnel.transitions);
const stageIds = stages.map((stage) => stage.id);

// Multi-source BFS assigns each stage the shortest distance (in transitions)
// from a stage with no incoming transition. A visited-set guard makes this
// safe for branching, reconvergence, and cycles/loops: every stage is
// enqueued at most once, so a "loop"-role transition back to an earlier
// stage can never cause revisiting or infinite recursion — it simply never
// updates a level that has already been assigned. A fully cyclic graph (no
// stage with in-degree 0) falls back to the first authored stage as the lone
// root, which is still deterministic.
function computeLevels() {
  const outgoing = new Map(stageIds.map((id) => [id, []]));
  const inDegree = new Map(stageIds.map((id) => [id, 0]));
  for (const transition of transitions) {
    outgoing.get(transition.from).push(transition.to);
    inDegree.set(transition.to, (inDegree.get(transition.to) || 0) + 1);
  }
  const roots = stageIds.filter((id) => inDegree.get(id) === 0);
  const level = new Map();
  const queue = roots.length ? [...roots] : [stageIds[0]];
  for (const id of queue) level.set(id, 0);
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head];
    const currentLevel = level.get(id);
    for (const nextId of outgoing.get(id)) {
      if (!level.has(nextId)) {
        level.set(nextId, currentLevel + 1);
        queue.push(nextId);
      }
    }
  }
  // A stage in an isolated cycle unreachable from any root still needs a
  // deterministic level: place it one column after the current maximum, in
  // authored order.
  let maxLevel = level.size ? Math.max(...level.values()) : -1;
  for (const id of stageIds) {
    if (!level.has(id)) {
      maxLevel += 1;
      level.set(id, maxLevel);
    }
  }
  return level;
}

const levelOf = computeLevels();
const columns = new Map();
for (const stage of stages) {
  const level = levelOf.get(stage.id);
  if (!columns.has(level)) columns.set(level, []);
  columns.get(level).push(stage);
}
const columnCount = columns.size;
const maxColumnHeight = Math.max(1, ...[...columns.values()].map((column) => column.length));

const positioned = new Map();
for (const [level, column] of columns) {
  const columnOffsetY = ((maxColumnHeight - column.length) * ROW_SPACING) / 2;
  column.forEach((stage, index) => {
    const cx = MARGIN_X + NODE_W / 2 + level * COL_SPACING;
    const cy = MARGIN_Y + NODE_H / 2 + columnOffsetY + index * ROW_SPACING;
    positioned.set(stage.id, {
      ...stage,
      x: cx - NODE_W / 2,
      y: cy - NODE_H / 2,
      width: NODE_W,
      height: NODE_H,
      cx,
      cy,
    });
  });
}

const viewBoxWidth = MARGIN_X * 2 + NODE_W + Math.max(0, columnCount - 1) * COL_SPACING;
const viewBoxHeight = MARGIN_Y * 2 + NODE_H + Math.max(0, maxColumnHeight - 1) * ROW_SPACING;

function validateFunnelRenderInput() {
  const problems = [];
  // Referential integrity is already enforced by validateFunnelReferences
  // inside loadDiagram; this only guards against a renderer-local impossible
  // state (an empty document) rather than re-validating what has already
  // passed.
  if (!stages.length) problems.push('Funnel document has no stages to render.');
  if (problems.length) {
    throwDiagnosticProblems('Funnel render input invalid', problems, {
      subject: { diagramType: 'funnel' },
    });
  }
}

function transitionSides(transition) {
  const from = positioned.get(transition.from);
  const to = positioned.get(transition.to);
  return {
    fromSide: defaultFromSide(from, to),
    toSide: defaultToSide(from, to),
  };
}

// Intentionally the simplest possible route: a straight line between the two
// stage anchors. Loops/backward edges therefore render as plain crossing
// lines rather than a distinct routed glyph — see README for this
// limitation. Correctness and determinism take priority over routing
// sophistication in this first renderer.
function pathFor(transition) {
  const from = positioned.get(transition.from);
  const to = positioned.get(transition.to);
  const { fromSide, toSide } = transitionSides(transition);
  const points = [anchor(from, fromSide), anchor(to, toSide)];
  return { d: roundedPath(points, 0), points };
}

function renderStage(stage) {
  const crossLinkGroup = crossLinkGroupFor(stage.id);
  const detailGroups = deriveStageDetailGroups(funnel, stage.id, funnel.meta.locale, crossLinkGroup ? [crossLinkGroup] : []);
  const passport = {
    kind: stage.outcome,
    detailGroups: detailGroups.length ? JSON.stringify(detailGroups) : undefined,
  };
  const labelFontSize = fittedNodeFontSize(stage.label, stage.width, 12, 9);
  // Phase 12: the Persona Lens (see renderPersonaLens) reads this CSV
  // client-side. Omitted entirely — not an empty string — when
  // stage.personas is omitted, so "no attribute" is the one, unambiguous
  // signal for "applies generally" (isStageApplicableToPersona's rule,
  // mirrored client-side).
  const personasAttr = Array.isArray(stage.personas) && stage.personas.length
    ? ` data-node-personas="${esc(stage.personas.join(','))}"`
    : '';
  return `        <g ${focusNodeAttrs(stage.id, stage.label, passport, funnel.meta.locale)}${personasAttr}>
          ${focusNodeTitle(stage.label, passport)}
          <rect x="${stage.x}" y="${stage.y}" width="${stage.width}" height="${stage.height}" rx="8" class="c-mask"/>
          <text data-node-label="" x="${stage.cx}" y="${stage.cy}" class="t-primary" font-size="${labelFontSize}" font-weight="600" text-anchor="middle" dominant-baseline="middle">${esc(stage.label)}</text>
        </g>`;
}

// Phase 14: map the existing Transition.role semantic (primary | alternative
// | loop — unchanged since Phase 6/10) onto the arrow *variant* vocabulary
// every other renderer already uses (arrowClassMap[entity.variant ||
// 'default'], see geometry.mjs) — Architecture/Workflow/Lifecycle/Dataflow
// all pick one of these four class+marker pairs per edge already; Funnel was
// the only renderer still hardcoded to 'default'. This is presentation-only
// derivation local to the renderer: `role` remains the sole Funnel semantic
// field, no `variant` is added to funnel.schema.json or to the Transition
// object, and no new CSS/marker definitions are needed since renderDefinitions()
// already emits all four markers for every renderer unconditionally.
// 'loop' reuses 'emphasis' (solid, highlighted) — the same variant this
// repository's own agent-run.lifecycle.json example already uses for a
// retry/re-entry transition. 'alternative' reuses 'dashed' — the same
// variant used for branch/secondary-path edges elsewhere (e.g. the
// "retry-request"/role:"branch" edge in agent-tool-call.workflow.json).
// Structurally, alternative (dashed) and loop (solid) differ in line
// pattern, not only in color, so the pair remains distinguishable without
// relying on hue alone.
const ROLE_TO_VARIANT = { alternative: 'dashed', loop: 'emphasis' };
function transitionVariant(transition) {
  return ROLE_TO_VARIANT[transition.role] || 'default';
}

function renderTransitionPath(transition, index) {
  const variant = transitionVariant(transition);
  const [cls, marker] = arrowClassMap[variant] || arrowClassMap.default;
  const routed = pathFor(transition);
  const roleAttr = transition.role ? ` data-edge-role="${esc(transition.role)}"` : '';
  const strokeWidth = variant === 'emphasis' ? 1.6 : 1.1;
  return `        <path ${focusEdgeAttrs(transition.from, transition.to, transition.label, index, transition.id)}${roleAttr} d="${routed.d}" class="${cls}" stroke-width="${strokeWidth}" marker-end="url(#${marker})"/>`;
}

function renderTransitionLabel(transition, index) {
  if (!transition.label) return '';
  const routed = pathFor(transition);
  const [lx, ly] = labelPoint(transition, routed.points);
  const labelWidth = Math.max(32, textUnits(transition.label) * 4.9 + 12);
  const roleAttr = transition.role ? ` data-edge-role="${esc(transition.role)}"` : '';
  return `        <g data-detail="context" ${focusEdgeAttrs(transition.from, transition.to, transition.label, index, transition.id)}${roleAttr}>
          <rect x="${lx - labelWidth / 2}" y="${ly - 11}" width="${labelWidth}" height="16" rx="4" class="c-mask"/>
          <text x="${lx}" y="${ly}" class="${variantAccent(transitionVariant(transition))}" font-size="8" text-anchor="middle">${esc(transition.label)}</text>
        </g>`;
}

// Phase 13: give the existing conversion/dropoff semantic hook (Phase 10's
// data-node-kind, sourced from Stage.outcome) a distinct visual treatment.
// This is presentation only — it reads data-node-kind, never funnel.stages
// directly, and adds no new attribute. Reuses the exact "alias a semantic
// kind onto an existing brand color token" convention assets/template.html
// already establishes for its own state kinds (e.g. data-kind="success" ->
// var(--database-stroke), data-kind="failure" -> var(--security-stroke)),
// so every visual preset/theme/print rule already defined for those tokens
// applies here for free. Scoped to #funnel-overview-svg and kept entirely
// inside this renderer's own output, matching the Persona Lens precedent
// (Phase 12) of never touching assets/template.html for a Funnel-only
// concern. A stroke-dasharray distinguishes dropoff from conversion
// structurally, not by hue alone, so the pair remains distinguishable
// without relying on color perception.
function renderOutcomeStyles() {
  return `
        <style>
          #funnel-overview-svg [data-node-kind="conversion"] > .c-mask {
            fill: var(--database-fill);
            stroke: var(--database-stroke);
            stroke-width: 1.5;
          }
          #funnel-overview-svg [data-node-kind="dropoff"] > .c-mask {
            fill: var(--security-fill);
            stroke: var(--security-stroke);
            stroke-width: 1.5;
            stroke-dasharray: 4 2;
          }
        </style>`;
}

function renderSvg() {
  return `      <svg id="funnel-overview-svg" viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}" ${svgRootAttrs(funnel.meta)}>
${svgAccessibleText(funnel.meta, 'funnel')}
${renderDefinitions()}
${renderOutcomeStyles()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Transition paths -->
${transitions.map(renderTransitionPath).join('\n')}

        <!-- Stages -->
${[...positioned.values()].map(renderStage).join('\n\n')}

        <!-- Transition labels -->
${transitions.map(renderTransitionLabel).join('\n')}
      </svg>`;
}

// --- Persona Lens (Phase 12): a presentation filter over the one Overview
// graph — no Persona lanes, no per-Persona graph copy. Rendered only when
// funnel.personas exists; a document with no personas gets none of this
// markup/style/script at all, exactly the same opt-in-only-when-there-is-
// data pattern Explore (Phase 11) already established for detail groups.
//
// This intentionally does NOT reuse the shared `data-lens-active`/
// `data-lens-match` attribute names that Architecture's Semantic Lens
// feature (assets/template.html) already uses: that feature is also present
// (dormant) in every generated Funnel page via the shared toolbar, and
// reusing its exact attribute vocabulary for an independent script would let
// the two features clobber each other's state on the same <svg> element.
// Persona Lens therefore uses its own `data-persona-active`/
// `data-persona-match` names and its own tiny, self-contained opacity CSS —
// scoped to this renderer's own output, not assets/template.html — mirroring
// the *visual language* of the existing dimming convention (same opacity
// values) without sharing its wiring.
//
// The one shared-file touch this phase makes is additive: assets/template.html's
// existing canonical-export/print attribute-stripping pass (which already
// strips data-lens-*, data-focus-*, data-route-*, etc. before producing a
// durable artifact) now also strips data-persona-active/data-persona-match,
// so a Persona-filtered view can never freeze into an exported/printed
// artifact — closing the same runtime-state-never-leaks-into-export
// guarantee this repository already established for every other transient
// view state.
function renderPersonaLens() {
  const personas = asArray(funnel.personas);
  if (!personas.length) return '';
  const locale = funnel.meta.locale;
  // Phase 16 (Workstream B): the same deterministic personaVisualToken()
  // Explore's Personas group swatch uses, so a given Persona reads with one
  // consistent visual identity across both surfaces. The button's own label
  // text remains the accessible identifier; the dot is decorative only.
  const buttons = personas.map((persona) => (
    `<button type="button" data-persona-button="${esc(persona.id)}" aria-pressed="false"><span class="funnel-persona-swatch" aria-hidden="true" style="background-color:var(${personaVisualToken(persona.id)})"></span>${esc(persona.label)}</button>`
  )).join('\n          ');
  return `
      <div class="funnel-persona-lens no-print" id="funnel-persona-lens" role="group" aria-label="${esc(translateMessage(locale, 'funnel.persona.filterLabel'))}">
        <style>
          #funnel-persona-lens { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; margin: 0.6rem 0; }
          #funnel-persona-lens button { font: inherit; cursor: pointer; display: inline-flex; align-items: center; }
          #funnel-persona-lens button[aria-pressed="true"] { font-weight: 700; }
          .funnel-persona-swatch { display: inline-block; width: 0.5rem; height: 0.5rem; border-radius: 999px; margin-right: 0.32rem; }
          svg#funnel-overview-svg[data-persona-active] [data-node-id],
          svg#funnel-overview-svg[data-persona-active] [data-edge-from] { opacity: 0.11; }
          svg#funnel-overview-svg[data-persona-active] [data-persona-match] { opacity: 1; }
        </style>
        ${buttons}
        <button type="button" id="funnel-persona-clear" aria-label="${esc(translateMessage(locale, 'funnel.persona.clear'))}" hidden>${esc(translateMessage(locale, 'funnel.persona.clear'))}</button>
        <span id="funnel-persona-status" aria-live="polite"></span>
      </div>
      <script>
        (function () {
          var svg = document.getElementById('funnel-overview-svg');
          var root = document.getElementById('funnel-persona-lens');
          if (!svg || !root) return;
          var buttons = Array.prototype.slice.call(root.querySelectorAll('[data-persona-button]'));
          var clearBtn = document.getElementById('funnel-persona-clear');
          var status = document.getElementById('funnel-persona-status');
          var noStagesApplyTemplate = ${JSON.stringify(translateMessage(locale, 'funnel.persona.noStagesApply'))};

          // Same rule as isStageApplicableToPersona() in
          // renderers/funnel/persona-focus.mjs: no data-node-personas
          // attribute means the Stage applies generally.
          function isApplicable(node, personaId) {
            var raw = node.getAttribute('data-node-personas');
            if (!raw) return true;
            return raw.split(',').indexOf(personaId) !== -1;
          }

          function selectPersona(personaId, label) {
            var nodes = Array.prototype.slice.call(svg.querySelectorAll('[data-node-id]'));
            var applicable = {};
            var applicableCount = 0;
            nodes.forEach(function (node) {
              var id = node.getAttribute('data-node-id');
              if (isApplicable(node, personaId)) { applicable[id] = true; applicableCount += 1; }
            });
            svg.setAttribute('data-persona-active', personaId);
            nodes.forEach(function (node) {
              var id = node.getAttribute('data-node-id');
              if (applicable[id]) node.setAttribute('data-persona-match', ''); else node.removeAttribute('data-persona-match');
            });
            Array.prototype.forEach.call(svg.querySelectorAll('[data-edge-from][data-edge-to]'), function (edge) {
              var from = edge.getAttribute('data-edge-from');
              var to = edge.getAttribute('data-edge-to');
              if (applicable[from] && applicable[to]) edge.setAttribute('data-persona-match', ''); else edge.removeAttribute('data-persona-match');
            });
            buttons.forEach(function (btn) {
              btn.setAttribute('aria-pressed', String(btn.getAttribute('data-persona-button') === personaId));
            });
            clearBtn.hidden = false;
            status.textContent = applicableCount ? '' : noStagesApplyTemplate.replace('{label}', label);
          }

          function clearPersona() {
            svg.removeAttribute('data-persona-active');
            Array.prototype.forEach.call(svg.querySelectorAll('[data-persona-match]'), function (el) {
              el.removeAttribute('data-persona-match');
            });
            buttons.forEach(function (btn) { btn.setAttribute('aria-pressed', 'false'); });
            clearBtn.hidden = true;
            status.textContent = '';
          }

          buttons.forEach(function (btn) {
            btn.addEventListener('click', function () {
              var id = btn.getAttribute('data-persona-button');
              if (btn.getAttribute('aria-pressed') === 'true') { clearPersona(); return; }
              selectPersona(id, btn.textContent);
            });
          });
          clearBtn.addEventListener('click', clearPersona);
        })();
      </script>${renderPersonaComparison(personas, locale)}`;
}

// Part 2 (Workstream D): Multi-Persona comparison. Deliberately additive
// and self-contained rather than a rewrite of the single-Persona filter
// above — its own attribute names (data-persona-compare-*, never
// data-persona-active/data-persona-match), its own toggle/checkbox
// controls, and its own <script>. Nothing above this point is touched, so
// every existing single-Persona Lens behavior (and its exact-source-text
// tests) is unaffected. Only rendered when there are 2+ Personas — with
// fewer than two, "compare" is not a meaningful mode. Reuses the exact same
// Stage graph (renderStage's existing `<g data-node-id>` elements) and the
// exact same isStageApplicableToPersona rule (mirrored client-side here for
// the same reason the single-Persona script above already mirrors it — see
// that function's own doc comment in persona-focus.mjs): no Stage node is
// duplicated, no persona-specific lane is introduced, and no new semantic
// field is read that classifyStageForPersonas/classifyTransitionForPersonas
// do not already define as the single source of truth for this rule.
function renderPersonaComparison(personas, locale) {
  if (personas.length < 2) return '';
  const checkboxes = personas.map((persona) => (
    `<label class="funnel-persona-compare-option"><input type="checkbox" data-compare-persona="${esc(persona.id)}"> <span class="funnel-persona-swatch" aria-hidden="true" style="background-color:var(${personaVisualToken(persona.id)})"></span>${esc(persona.label)}</label>`
  )).join('\n            ');
  return `
      <div class="funnel-persona-compare no-print" id="funnel-persona-compare">
        <style>
          #funnel-persona-compare { margin: 0.3rem 0; }
          #funnel-persona-compare-toggle { font: inherit; cursor: pointer; }
          #funnel-persona-compare-picker[hidden] { display: none; }
          #funnel-persona-compare-picker { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-top: 0.35rem; }
          .funnel-persona-compare-option { display: inline-flex; align-items: center; gap: 0.24rem; cursor: pointer; }
          svg#funnel-overview-svg[data-persona-compare-active] [data-node-id],
          svg#funnel-overview-svg[data-persona-compare-active] [data-edge-from] { opacity: 0.11; }
          svg#funnel-overview-svg[data-persona-compare-active] [data-persona-compare-state="shared"] { opacity: 1; }
          svg#funnel-overview-svg[data-persona-compare-active] [data-persona-compare-state="divergent"] { opacity: 0.55; }
        </style>
        <button type="button" id="funnel-persona-compare-toggle" aria-pressed="false" aria-expanded="false" aria-controls="funnel-persona-compare-picker">${esc(translateMessage(locale, 'funnel.persona.compare.toggle'))}</button>
        <div class="funnel-persona-compare-picker" id="funnel-persona-compare-picker" role="group" aria-label="${esc(translateMessage(locale, 'funnel.persona.compare.picker'))}" hidden>
          ${checkboxes}
          <button type="button" id="funnel-persona-compare-clear">${esc(translateMessage(locale, 'funnel.persona.compare.clear'))}</button>
          <span id="funnel-persona-compare-status" aria-live="polite"></span>
        </div>
      </div>
      <script>
        (function () {
          var svg = document.getElementById('funnel-overview-svg');
          var toggle = document.getElementById('funnel-persona-compare-toggle');
          var picker = document.getElementById('funnel-persona-compare-picker');
          var clearBtn = document.getElementById('funnel-persona-compare-clear');
          var status = document.getElementById('funnel-persona-compare-status');
          var checkboxInputs = Array.prototype.slice.call(picker.querySelectorAll('[data-compare-persona]'));
          var singlePersonaButtons = Array.prototype.slice.call(document.querySelectorAll('#funnel-persona-lens [data-persona-button]'));
          var singlePersonaClear = document.getElementById('funnel-persona-clear');
          var emptyTemplate = ${JSON.stringify(translateMessage(locale, 'funnel.persona.compare.empty'))};
          var statusTemplate = ${JSON.stringify(translateMessage(locale, 'funnel.persona.compare.status'))};
          if (!svg || !toggle || !picker) return;

          // Same rule as isStageApplicableToPersona() in
          // renderers/funnel/persona-focus.mjs, mirrored client-side for
          // the same reason the single-Persona script above already does.
          function isApplicable(node, personaId) {
            var raw = node.getAttribute('data-node-personas');
            if (!raw) return true;
            return raw.split(',').indexOf(personaId) !== -1;
          }

          function classify(applicableCount, total) {
            if (applicableCount === total) return 'shared';
            if (applicableCount === 0) return 'none';
            return 'divergent';
          }

          function selectedPersonaIds() {
            return checkboxInputs.filter(function (input) { return input.checked; })
              .map(function (input) { return input.getAttribute('data-compare-persona'); });
          }

          function clearComparison() {
            svg.removeAttribute('data-persona-compare-active');
            Array.prototype.forEach.call(svg.querySelectorAll('[data-persona-compare-state]'), function (el) {
              el.removeAttribute('data-persona-compare-state');
            });
            status.textContent = '';
          }

          function renderComparison() {
            var personaIds = selectedPersonaIds();
            if (personaIds.length < 2) {
              clearComparison();
              status.textContent = emptyTemplate;
              return;
            }
            clearComparison();
            svg.setAttribute('data-persona-compare-active', personaIds.join(','));
            var nodes = Array.prototype.slice.call(svg.querySelectorAll('[data-node-id]'));
            var stateById = {};
            var counts = { shared: 0, divergent: 0, none: 0 };
            nodes.forEach(function (node) {
              var raw = node.getAttribute('data-node-personas');
              var state;
              if (!raw) state = 'shared'; // generally applicable == shared by every selection
              else {
                var applicableCount = personaIds.filter(function (id) { return isApplicable(node, id); }).length;
                state = classify(applicableCount, personaIds.length);
              }
              stateById[node.getAttribute('data-node-id')] = state;
              counts[state] += 1;
              if (state === 'none') node.removeAttribute('data-persona-compare-state');
              else node.setAttribute('data-persona-compare-state', state);
            });
            Array.prototype.forEach.call(svg.querySelectorAll('[data-edge-from][data-edge-to]'), function (edge) {
              var from = edge.getAttribute('data-edge-from');
              var to = edge.getAttribute('data-edge-to');
              var fromState = stateById[from];
              var toState = stateById[to];
              var edgeState = (fromState === 'none' || toState === 'none') ? 'none'
                : (fromState === 'shared' && toState === 'shared') ? 'shared'
                : 'divergent';
              if (edgeState === 'none') edge.removeAttribute('data-persona-compare-state');
              else edge.setAttribute('data-persona-compare-state', edgeState);
            });
            status.textContent = statusTemplate
              .replace('{shared}', String(counts.shared))
              .replace('{divergent}', String(counts.divergent))
              .replace('{none}', String(counts.none));
          }

          function setComparing(active) {
            toggle.setAttribute('aria-pressed', String(active));
            toggle.setAttribute('aria-expanded', String(active));
            picker.hidden = !active;
            singlePersonaButtons.forEach(function (btn) { btn.disabled = active; });
            if (singlePersonaClear) singlePersonaClear.disabled = active;
            if (active) {
              // Compare and single-select are mutually exclusive
              // presentation modes over the same graph — entering one
              // clears the other's highlight so they never fight over the
              // same nodes' opacity.
              svg.removeAttribute('data-persona-active');
              Array.prototype.forEach.call(svg.querySelectorAll('[data-persona-match]'), function (el) {
                el.removeAttribute('data-persona-match');
              });
              singlePersonaButtons.forEach(function (btn) { btn.setAttribute('aria-pressed', 'false'); });
              if (singlePersonaClear) singlePersonaClear.hidden = true;
              status.textContent = emptyTemplate;
            } else {
              clearComparison();
              checkboxInputs.forEach(function (input) { input.checked = false; });
            }
          }

          toggle.addEventListener('click', function () {
            setComparing(toggle.getAttribute('aria-pressed') !== 'true');
          });
          checkboxInputs.forEach(function (input) {
            input.addEventListener('change', renderComparison);
          });
          clearBtn.addEventListener('click', function () {
            checkboxInputs.forEach(function (input) { input.checked = false; });
            clearComparison();
            status.textContent = emptyTemplate;
          });
        })();
      </script>`;
}

// Part 2 (Workstream C): "how can a customer move from this point toward
// conversion?" — a dedicated presentation/interaction mode, entirely
// separate from Persona Lens (its own attribute names, its own opacity
// rule, coexisting rather than sharing wiring — the same isolation
// precedent Persona Lens itself established relative to Semantic Lens).
// Rendered only when at least one Stage has outcome: "conversion"; a
// document with none gets no extra markup/style/script, matching the
// opt-in-only-when-there-is-data pattern every prior Funnel presentation
// phase already established. The traversal itself is computed once, here,
// server-side (computeAllPathsToConversion) — the browser only looks up a
// precomputed result and applies presentation; it never re-derives graph
// reachability itself, so there is exactly one implementation of the
// algorithm, not two.
function renderPathToConversionLens() {
  const hasConversionStage = funnel.stages.some((stage) => stage.outcome === 'conversion');
  if (!hasConversionStage) return '';
  const locale = funnel.meta.locale;
  const allPaths = computeAllPathsToConversion(funnel);
  const labelById = Object.fromEntries(funnel.stages.map((stage) => [stage.id, stage.label]));
  const pathData = Object.fromEntries(Object.entries(allPaths).map(([stageId, result]) => [
    stageId,
    {
      reachable: result.reachable,
      otherCount: Math.max(0, result.conversions.length - 1),
      primary: result.primary
        ? { stageId: result.primary.stageId, path: result.primary.path, edges: pathEdgePairs(result.primary.path) }
        : null,
    },
  ]));
  const options = funnel.stages.map((stage) => (
    `<option value="${esc(stage.id)}">${esc(stage.label)}</option>`
  )).join('\n          ');
  return `
      <div class="funnel-path-lens no-print" id="funnel-path-lens" role="group" aria-label="${esc(translateMessage(locale, 'funnel.path.filterLabel'))}">
        <style>
          #funnel-path-lens { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; margin: 0.6rem 0; }
          #funnel-path-lens select { font: inherit; }
          #funnel-path-lens button { font: inherit; cursor: pointer; }
          svg#funnel-overview-svg[data-path-active] [data-node-id],
          svg#funnel-overview-svg[data-path-active] [data-edge-from] { opacity: 0.11; }
          svg#funnel-overview-svg[data-path-active] [data-path-match] { opacity: 1; }
          svg#funnel-overview-svg[data-path-active] path[data-path-match] { stroke-width: 3; }
        </style>
        <label for="funnel-path-select">${esc(translateMessage(locale, 'funnel.path.filterLabel'))}</label>
        <select id="funnel-path-select">
          <option value="">${esc(translateMessage(locale, 'funnel.path.choosePlaceholder'))}</option>
          ${options}
        </select>
        <button type="button" id="funnel-path-clear" aria-label="${esc(translateMessage(locale, 'funnel.path.clear'))}" hidden>${esc(translateMessage(locale, 'funnel.path.clear'))}</button>
        <span id="funnel-path-status" aria-live="polite"></span>
      </div>
      <script>
        (function () {
          var svg = document.getElementById('funnel-overview-svg');
          var root = document.getElementById('funnel-path-lens');
          if (!svg || !root) return;
          var select = document.getElementById('funnel-path-select');
          var clearBtn = document.getElementById('funnel-path-clear');
          var status = document.getElementById('funnel-path-status');
          var data = ${JSON.stringify(pathData)};
          var labelById = ${JSON.stringify(labelById)};
          var summaryTemplate = ${JSON.stringify(translateMessage(locale, 'funnel.path.summary'))};
          var unreachableTemplate = ${JSON.stringify(translateMessage(locale, 'funnel.path.unreachable'))};
          var otherReachableTemplate = ${JSON.stringify(translateMessage(locale, 'funnel.path.otherReachable'))};

          function clearPath() {
            svg.removeAttribute('data-path-active');
            Array.prototype.forEach.call(svg.querySelectorAll('[data-path-match]'), function (el) {
              el.removeAttribute('data-path-match');
            });
            clearBtn.hidden = true;
            status.textContent = '';
          }

          function showPath(stageId) {
            var result = data[stageId];
            if (!result) return;
            clearPath();
            svg.setAttribute('data-path-active', stageId);
            clearBtn.hidden = false;
            if (!result.reachable) {
              status.textContent = unreachableTemplate.replace('{label}', labelById[stageId] || stageId);
              return;
            }
            var nodeSet = {};
            result.primary.path.forEach(function (id) { nodeSet[id] = true; });
            Array.prototype.forEach.call(svg.querySelectorAll('[data-node-id]'), function (node) {
              if (nodeSet[node.getAttribute('data-node-id')]) node.setAttribute('data-path-match', '');
            });
            Array.prototype.forEach.call(svg.querySelectorAll('[data-edge-from][data-edge-to]'), function (edge) {
              var from = edge.getAttribute('data-edge-from');
              var to = edge.getAttribute('data-edge-to');
              var onPath = result.primary.edges.some(function (pair) { return pair[0] === from && pair[1] === to; });
              if (onPath) edge.setAttribute('data-path-match', '');
            });
            var targetLabel = labelById[result.primary.stageId] || result.primary.stageId;
            var summary = summaryTemplate
              .replace('{count}', String(result.primary.path.length - 1))
              .replace('{target}', targetLabel);
            if (result.otherCount > 0) {
              summary += ' ' + otherReachableTemplate.replace('{count}', String(result.otherCount));
            }
            status.textContent = summary;
          }

          select.addEventListener('change', function () {
            if (!select.value) { clearPath(); return; }
            showPath(select.value);
          });
          clearBtn.addEventListener('click', function () {
            clearPath();
            select.value = '';
          });
        })();
      </script>`;
}

validateFunnelRenderInput();
writeDiagram({
  outPath,
  template,
  diagramType: 'funnel',
  meta: funnel.meta,
  svg: renderSvg() + renderPersonaLens() + renderPathToConversionLens(),
  cards: funnel.cards,
});
