# Funnel Renderer (Overview + Explore, Phases 10–11)

Render `diagram_type: "funnel"` JSON files into the standard Archify HTML
template.

```bash
node archify/renderers/funnel/render-funnel.mjs input.funnel.json output.html
```

The renderer validates input against `archify/schemas/funnel.schema.json`
with the bundled standalone validator, then against the Phase 9
cross-collection referential-integrity checks
(`validateFunnelReferences` in `renderers/shared/cli.mjs`), both via the
shared `loadDiagram` pipeline every renderer uses. No dependency installation
is required, and there is no `archify render funnel` CLI command — invoke the
script directly, the same way every other renderer can be.

If `output.html` is omitted, the renderer uses `meta.output` from the JSON
file or falls back to `funnel.html` in the current working directory.

## What this renderer draws — the Overview only

This is deliberately the first and smallest layer of Toolsmith's
progressive-disclosure model (see `schemas/README.md`'s Funnel section):

- Every `Stage` becomes one visual node (label, stable id, and — if present —
  an `outcome`-derived `data-node-kind="conversion"|"dropoff"` hook for a
  future visual-style phase to key off).
- Every `Transition` becomes one visual edge (stable `data-edge-from`/
  `data-edge-to`, an optional `data-edge-role` hook, and its `label` if one
  is authored).

**Intentionally not rendered as separate graph nodes:** Actions, Touchpoints,
and Personas. They remain fully present in the source JSON document — this
renderer does not delete, transform, or otherwise touch them — and are
available to a future Explore/Detailed presentation layer to reveal without
requiring any change to `funnel.schema.json` or to this Overview graph.
Friction and Decision text are likewise left as semantic data with no visual
treatment yet — **until the user asks for it**, via Explore (below).

## Explore: revealing detail on Stage focus (Phase 11)

The Overview stays clean by default, but every Stage node this renderer
emits also carries an optional `data-node-detail-groups` attribute — a
JSON-serialized array of `{title, items[]}` groups — derived by
`renderers/funnel/explore-detail.mjs` from that Stage's Decision, Actions
(with their resolved Touchpoint and optional/friction flags), Touchpoints
(deduplicated), Personas, and Friction (Stage- and Action-level, merged).
A Stage with none of that optional detail simply carries no attribute at
all — the Overview node itself never changes shape or size because of it.

This is read exclusively by the **existing, unmodified-in-behavior Semantic
Passport** already shared by every renderer (`assets/template.html`): clicking
or focusing any `[data-node-id]` element already opened a passport panel
before this phase existed (kind/label/id, already working for Funnel since
Phase 10's `focusNodeAttrs` reuse). Phase 11 adds exactly one generic,
optional section to that existing panel — `#focus-detail-groups`, populated
by `renderDetailGroups()` — that renders whatever `{title, items[]}` groups
a node's `data-node-detail-groups` attribute contains, using the same visual
language as the existing evidence/meta sections. **No other renderer sets
this attribute**, so Architecture/Workflow/Sequence/Dataflow/Lifecycle
output is provably unaffected (see `test/semantic-passport.test.mjs`) —
the container exists (harmlessly `hidden`) in every generated file because
it lives in the one shared template, but only Funnel ever has content to
show in it.

Outcome (`conversion`/`dropoff`) is deliberately **not** duplicated into a
detail group — it already surfaces through the Passport's existing `kind`
slot via the same `data-node-kind` hook Phase 10 established.

This is presentation only. Selecting/focusing a Stage is runtime viewer
state (tracked in `assets/template.html`'s existing focus machinery, the
same as every other diagram type) — it is never written back into the
Funnel JSON document, and `deriveStageDetail`/`deriveStageDetailGroups` are
pure functions that never mutate their input (see
`test/funnel-explore-detail.test.mjs`).

**Not implemented in Phase 11:** Persona filtering/lanes, Guided Views,
animation, storytelling, drill-down into Architecture, and any visual
theming beyond reusing the Passport's existing look. See `schemas/README.md`
for how these fit into the longer progressive-disclosure roadmap.

## Explore detail visual semantics: optional Actions and Touchpoint type (Phase 15)

Two Explore facts were text-only through Phase 11: an Action's `optional`
boolean read only as an inline "(optional)" suffix baked into its label
string, and a Touchpoint's required `type` didn't appear in Explore at all —
only its `label` did. Phase 15 makes both easier to scan without adding any
field to `funnel.schema.json` or writing a Funnel-specific Passport.

The mechanism is a small, **generic** extension to the existing detail-group
item contract in `assets/template.html`'s `renderDetailGroups()`: an item was
always a plain string; it may now *also* be a `{text, tag}` object, in which
case a small, neutral text tag renders after the item text via
`document.createElement`/`textContent` (never `innerHTML`). `renderDetailGroups()`
has no idea this data came from Funnel — it only recognizes the two generic
shapes — so no `if (diagramType === 'funnel')` branch was added anywhere, and
the other five renderers (which never emit this attribute) are unaffected
(see `test/semantic-passport.test.mjs`).

`renderers/funnel/explore-detail.mjs`'s `deriveStageDetailGroups()` (still a
pure function, still Funnel-only) decides when to use the richer shape:

- An Action with `optional` omitted or `false` — the default/required
  case — is still a **plain string**, byte-identical to every prior phase.
  Nothing changes in appearance for the common case.
- An Action with `optional: true` becomes `{ text, tag: "Optional" }` —
  replacing the old inline "(optional)" text with a small tag rendered the
  same neutral color as every other tag, never a warning/error color, since
  optional only means "the customer may take this action," not a problem.
- Every Touchpoint item becomes `{ text: touchpoint.label, tag:
  humanizeTouchpointType(touchpoint.type) }` — `type` is a required
  Touchpoint field, so every item always gets a tag. `humanizeTouchpointType`
  only changes how the existing `funnel.schema.json` enum value
  (`web`/`mobile-app`/`email`/`phone`/`in-person`/`notification`/`partner`/`other`)
  is *displayed* ("Mobile App", "In Person", …) — the same simple
  title-casing fallback `assets/template.html`'s client-side
  `viewerKindLabel()` already uses for an untranslated raw value (e.g.
  Phase 13's `conversion`/`dropoff`) — never a new enum value, and never a
  judgment about the touchpoint (Task 6: type is a category, not an outcome).

The new `.semantic-passport-detail-tag` CSS reuses the exact visual recipe
(pill shape, faint border, muted color, small uppercase-ish scale) the
Passport's existing `.semantic-passport-meta` chips already use — a
generic, repository-native "small tag" look, not a new component or color
system, and it renders identically across every existing theme/preset since
it's built entirely from existing CSS custom properties. Because the tag is
real text (not an icon), no separate ARIA treatment was needed — a screen
reader reading a `<li>` already reads its tag's text as part of that list
item's content.

**Not implemented in Phase 15:** a Funnel-specific Passport component (none
was created — the generic Passport still has zero Funnel awareness), Action
or Touchpoint graph nodes, per-Touchpoint-type icons or colors, and any
change to Transition role or Stage outcome presentation — all three semantic
dimensions (`Stage.outcome`, `Transition.role`, `Action.optional`/
`Touchpoint.type`) remain independent, each reaching its own presentation
layer without the others knowing.

## Persona Lens: filtering the Overview by Persona (Phase 12)

`funnel.personas` is a semantic Funnel entity; a Stage's applicability to a
given Persona is determined entirely by `Stage.personas`
(`renderers/funnel/persona-focus.mjs`'s `isStageApplicableToPersona`):
**omitted `Stage.personas` means the Stage applies generally** to every
Persona; a listed Persona id means the Stage applies to that Persona; a
Persona absent from a non-omitted list does not apply. This is documented
once, in one pure function, and used identically whether checked in a test
or (in equivalent inline form, since the browser runs plain script, not this
ES module) at render time.

When `funnel.personas` is non-empty, the renderer emits one button per
Persona (labeled with the authored `persona.label`) plus a Clear button, all
below the Overview SVG. Clicking a Persona button:

- keeps every applicable Stage (general or explicitly-listed) at full
  opacity;
- dims every other Stage, and dims any Transition touching a non-applicable
  Stage — so filtering never leaves a misleading "active" path running
  through a Stage that isn't part of the selected Persona's journey;
- announces a status message if the selection produces zero applicable
  Stages (a real but degenerate case — it does not crash or invent a
  synthetic path).

Clicking Clear (or the active Persona button again) restores the normal
Overview exactly — nothing about the graph's positions, ids, or transitions
ever changes; only element `opacity` does. **There is no Persona lane, no
per-Persona graph copy, and no duplicated Stage node** — one graph, filtered.

This is presentation/runtime state only: the selected Persona lives in the
DOM (`data-persona-active` on the SVG, `data-persona-match` on applicable
nodes/edges), never in the Funnel document, and Explore (Phase 11) is
completely unaffected — a Stage's Decision/Actions/Touchpoints/Personas/
Friction detail is exactly the same whether or not a Persona filter is
active, because Persona Lens and Explore both read the same immutable
document independently.

**Why a new, Funnel-local `data-persona-*` vocabulary instead of reusing
Architecture's existing Semantic Lens** (`assets/template.html`'s
`data-lens-active`/`data-lens-match`, which already implements the same
dim-non-matching/highlight-matching visual language): that feature's toolbar
button and dialog are present, dormant, on every generated page including
Funnel's, and its selection model is single-valued kind-matching, not
multi-membership Persona matching. Reusing its exact attribute names for an
independent script risked the two features clobbering each other's state on
the same `<svg>`. Persona Lens reuses the *visual convention* (identical
opacity values) but owns its own attribute names and its own tiny CSS/script,
scoped entirely inside this renderer's own output — **zero new markup, CSS,
or script in `assets/template.html` for the feature itself.**

The one genuinely shared-file change this phase made: `assets/template.html`'s
existing canonical-export/print attribute-stripping pass (which already
strips `data-lens-*`, `data-focus-*`, `data-route-*`, etc. before producing a
durable artifact) now also strips `data-persona-active`/`data-persona-match`
— an additive, three-line extension of an existing list, closing the same
runtime-state-never-survives-export guarantee already established for every
other transient view state. It does not change behavior for the other five
diagram types, which never emit these attributes.

**Not implemented in Phase 12:** multiple simultaneous Personas, Persona
comparison, Persona-specific path highlighting beyond the applicable/
non-applicable binary above, and any visual theming beyond the existing
opacity convention.

## Outcome styling: conversion vs dropoff (Phase 13)

Phase 10 already stamps each Stage's optional `outcome` (`conversion` |
`dropoff`) onto its node as `data-node-kind="conversion"|"dropoff"` — the
same generic hook the Semantic Passport already reads for its `kind` slot
(`viewerKindLabel()` in `assets/template.html` title-cases the raw value, so
the Passport already read "Conversion"/"Dropoff" textually before this
phase, with zero code change required). A Stage with no `outcome` gets no
`data-node-kind` attribute at all and keeps the plain default node
appearance — there is no third outcome and no synthetic "normal" value.

Phase 13 gives that existing hook a distinct visual treatment: a small
`<style>` block emitted inline inside this renderer's own `<svg>` output
(`renderOutcomeStyles()`) keys off `[data-node-kind="conversion"]` and
`[data-node-kind="dropoff"]` to tint each Stage's existing `.c-mask`
background rect and give it a colored stroke — conversion gets a solid
stroke, dropoff gets the same treatment plus a `stroke-dasharray`, so the
pair remains structurally distinguishable even without color perception.

The colors themselves are not new: they reuse `assets/template.html`'s
existing `--database-fill`/`--database-stroke` and `--security-fill`/
`--security-stroke` CSS custom properties — the same tokens that file's own
`.overview-map-node[data-kind="success"]` / `[data-kind="failure"]` rules
already alias onto for an analogous semantic-state-to-color mapping. Because
these are variable references rather than hard-coded hex values, every
existing visual preset (`signal-flow`, `blueprint`, `editorial`, classic),
both themes, and the print stylesheet already defined for those tokens
apply to outcome styling automatically — Phase 13 added no new preset,
theme, or print rule anywhere.

This is presentation only: the rule lives entirely inside this renderer's
own inline `<style>`, scoped to `#funnel-overview-svg`, so it changes
nothing about `funnel.schema.json`, `data-node-kind` itself, node/edge
identity, or any other diagram type (no other renderer's `kind` vocabulary
uses the strings `"conversion"`/`"dropoff"`). It composes with Persona Lens
by construction rather than competing with it: Persona Lens dims the
Stage's `<g>` via `opacity`, while outcome styling colors the `.c-mask`
`<rect>` inside that `<g>` — independent CSS properties on different
elements, so a dimmed conversion/dropoff Stage keeps its color faintly
visible (the same `opacity: 0.11` used for every other dimmed node) rather
than losing its outcome identity, and clearing the Persona filter restores
full-opacity outcome styling exactly as before. Explore/Passport detail
groups are entirely unaffected — outcome is deliberately not duplicated
into a detail group (see Explore, above) and this phase adds no new one.

**Not implemented in Phase 13:** any broader visual-style/theme/preset
system, animation, on-canvas outcome icons/badges beyond the existing
Passport text and CSS shape treatment, and styling for any other Funnel
entity (Action, Touchpoint, Transition role) — outcome is the one hook this
phase makes visible.

## Transition role styling: primary vs alternative vs loop (Phase 14)

Phase 10 already stamps each Transition's optional `role`
(`primary`/`alternative`/`loop`) onto its edge as `data-edge-role`. Phase 14
gives that existing hook distinct line/arrowhead treatment by reusing the
**exact mechanism every other Archify renderer already uses for its own
edges**: `geometry.mjs`'s shared `arrowClassMap`, a four-way lookup table
pairing a CSS class with a matching SVG `<marker>` id (`default`, `emphasis`,
`security`, `dashed`), selected via the `entity.variant || 'default'` idiom
that Architecture/Workflow/Lifecycle/Dataflow's own connection/edge/
transition/flow renderers already use. Funnel was the only renderer still
hardcoded to `arrowClassMap.default` for every edge; Phase 14 makes it
variant-aware like its siblings.

Since `role` is a customer-journey semantic field and `variant` is a
presentation concept, Phase 14 does **not** add a `variant` field to
`funnel.schema.json` or to the Transition object. Instead, `render-funnel.mjs`
derives a variant locally, per edge, purely for the render step
(`transitionVariant(transition)`, a two-entry `{ alternative: 'dashed', loop:
'emphasis' }` lookup, `'default'` otherwise) — `role` remains the only
serialized semantic field, and the mapping is presentation-layer logic that
is never written back anywhere:

- no role, or `role: "primary"` → `arrowClassMap.default` (`a-default` /
  `#arrowhead`) — the exact unchanged appearance every Transition already had
  before this phase.
- `role: "alternative"` → `arrowClassMap.dashed` (`a-dashed` /
  `#arrowhead-dashed`) — the same variant this repository's own
  `agent-tool-call.workflow.json` example already uses for a labeled
  `role: "branch"` edge.
- `role: "loop"` → `arrowClassMap.emphasis` (`a-emphasis` /
  `#arrowhead-emphasis`, plus a slightly thicker stroke, mirroring the
  `edge.variant === 'emphasis'` stroke-width bump Lifecycle/Workflow/
  Dataflow/Architecture already apply) — the same variant this repository's
  own `agent-run.lifecycle.json` example already uses for a retry/re-entry
  transition.

No new CSS or `<marker>` definitions were needed: `renderDefinitions()`
(`renderers/shared/utils.mjs`), already called by every renderer including
Funnel, unconditionally emits all four markers and their matching `.a-*`/
`.m-*` classes already live in `assets/template.html` — Funnel's SVG has
always shipped them, just unused for `emphasis`/`security`/`dashed` until
now. This phase is therefore a pure logic change confined to
`render-funnel.mjs`; it does not touch `assets/template.html` at all.
Alternative (dashed) and loop (solid-but-thicker/differently-colored) differ
structurally, not only by hue, so the pair stays distinguishable without
relying on color perception. An authored Transition `label`, if present,
keeps its position and text unchanged — only its accent color now follows
the same `variantAccent(variant)` call every sibling renderer's edge label
already makes; no `[primary]`/`[alternative]`/`[loop]` text is ever added.

This composes with both Phase 12 and Phase 13 by construction: Persona Lens
matches and dims edges purely via `data-edge-from`/`data-edge-to`, with no
awareness of `data-edge-role`, `class`, or marker at all, so a dimmed
alternative/loop edge still fades to the same `opacity: 0.11` and restores
exactly as before on Clear; and Stage outcome styling (Phase 13) lives
entirely on node `<g>`/`.c-mask` elements, never on edges, so the two
dimensions — `Stage.outcome` → node presentation, `Transition.role` → edge
presentation — remain fully independent, verified by rendering a document
with both present.

**Not implemented in Phase 14:** any broader visual-style/theme/preset
system, animation, new graph geometry/routing for loop edges (a `loop`-role
Transition still renders as the same straight line described in Stage
positioning below — this phase never assumes `from === to` or draws a
distinct loop-back glyph), a new Passport group for role, and styling for
any other Funnel entity (Action, Touchpoint).

## Persona visual identity (Phase 16)

`renderers/funnel/persona-focus.mjs`'s `personaVisualToken(personaId)` derives
a stable, deterministic presentation identity for a Persona from its authored
id — a hash into one of the seven existing brand stroke custom properties
(`--frontend-stroke`, `--backend-stroke`, `--database-stroke`,
`--cloud-stroke`, `--security-stroke`, `--messagebus-stroke`,
`--external-stroke`), the same tokens already used elsewhere in this codebase
for Architecture component kind and Phase 13's outcome styling. No author
ever picks a color, no field is added to the Persona semantic object, and
the same Persona id always yields the same token everywhere it is consulted.

The same token now appears in two places: a small dot before each Persona
Lens filter button's label, and a matching swatch before that Persona's name
in Explore's Personas detail group (`renderers/shared/generated-validators.mjs`
is untouched; `assets/template.html`'s `renderDetailGroups()` gained one more
generic, optional item field, `swatch`, alongside Phase 15's `tag` — an
allowlisted CSS-custom-property name, never arbitrary CSS, rendered via
`element.style.setProperty`). The swatch is `aria-hidden`; the Persona's
authored label remains the sole accessible identifier, so identity is never
color-only.

## Transition role in the Stage Passport (Phase 16)

Phase 14 made Transition `role` visually distinct on the Overview graph.
Phase 16 exposes the same fact in the Stage Passport: every Stage's Explore
detail now includes a "Transitions" group listing each Transition touching
it — `→ <neighbor>` for an outgoing Transition, `← <neighbor>` for an
incoming one, each with a role tag (an omitted role reads as "Primary",
matching the Overview's own default-appearance rule). This deliberately does
**not** make edges independently focusable, and adds no new Passport
section or component — it reuses Phase 15's exact `{title, items:
[{text, tag}]}` generic shape, attached to the Stage that already owns a
Passport, not a Transition-specific one. A Stage touched by no Transition
gets no Transitions group, matching every other optional-detail group.

## Cross-Link (Phase 16)

Cross-Link — `schemas/cross-link.schema.json` — is a **separate** artifact
linking a Funnel Stage to an Architecture component at a given HLD/LLD
level. It is never embedded in a Funnel or Architecture document, and
neither of those documents ever references it back; a Funnel document
renders completely on its own whether or not any Cross-Link document
exists, or is even aware of one. `renderers/shared/cross-link.mjs` holds
every pure function (duplicate-id and reference validation — reusing
`projection/architecture-projection.mjs`'s existing `projectArchitecture()`
to check a component is actually visible at the named level — plus forward
`linksForStage()` and reverse `linksForComponent()` lookups and a strict
`safeCrossLinkHref()` allowlist limiting a resolved href to a relative local
`.html` file with an optional `#focus=<id>` fragment, reusing the viewer's
existing deep-link convention rather than building new navigation).

This renderer's own integration is entirely opt-in, via an extra
`--cross-link <path.json>` CLI flag (`renderers/funnel/cross-link-context.mjs`)
— every invocation without that flag, including every existing example,
test, and golden fixture, renders byte-identically to before Cross-Link
existed. When present, it validates the Cross-Link document and its
referenced Architecture document(s), then attaches an "Architecture"
detail group (Phase 15's generic shape again, now with an optional `href`
Phase 16 also added to `renderDetailGroups()`, validated both server- and
client-side against the same relative-`.html`-only pattern) to each linked
Stage's Passport — a real, working hyperlink to the related Architecture
component's rendered HTML, deep-linked via `#focus=`.

**The reverse direction (an Architecture component's Passport linking back
to the customer journeys it supports) is implemented and tested as a pure
function — `linksForComponent()`/`resolveFunnelHref()` — but deliberately
not wired into `render-architecture.mjs`'s own CLI in this phase.** That
renderer is significantly larger and more heavily depended upon than
Funnel's; wiring live Cross-Link rendering into it warrants its own focused,
lower-risk phase rather than a rushed addition here. See the Phase 16
report's Scope Compliance section for the full reasoning.

## Story mode (Phase 16)

Every other diagram type has always been able to author `meta.views`
(`common.schema.json#/$defs/guidedViews`) to drive `assets/template.html`'s
existing, fully generic Guided View / Story player — chapters, beats,
play/pause/replay, a story trail, reduced-motion handling, share-card
export. `renderers/shared/cli.mjs`'s `validateGuidedViews()` was already
wired for Funnel since Phase 9 (`SEMANTIC_COLLECTIONS.funnel = 'stages'`),
but `funnel.schema.json`'s `meta` never actually declared `views` — nor
`locale`, nor `output`, nor `animation`, nor `visual_preset`, all of which
shared code (`writeDiagram`, every `translateMessage(funnel.meta.locale, ...)`
call) already read unconditionally. This was a genuine, previously
undetected gap discovered during this phase's baseline audit: an authored
`meta.locale: "zh-CN"` was schema-rejected for Funnel specifically, and
Story mode could never be authored at all. Phase 16 adds the same five
`meta` properties every other diagram type's schema already has — no new
concept, no new player, just completing an existing, established shape
Funnel had simply never received (and, for `animation`/`visual_preset`,
referencing the same shared `common.schema.json` `$defs` most other diagram
schemas already reference, rather than duplicating an enum inline).
`examples/first-purchase.funnel.json` now authors two Guided Views to
demonstrate this end to end with zero new rendering code.

Story playback state (current step, playing/paused) lives entirely in the
existing viewer's own runtime script, exactly as it already does for every
other diagram type — never in `funnel.schema.json`, never serialized.

## Stage positioning

`funnel.schema.json` has no `x`/`y`/`row`/`col`/`lane` field, and Phase 10
does not add one. Unlike the other five renderers (which all use *authored*
discrete positions), this renderer computes every stage's position itself,
fresh on each render, from the transition graph shape:

1. Multi-source BFS from every stage with no incoming transition assigns
   each stage a level = its shortest distance (in transitions) from a root.
   A visited-set guard makes this safe for branching, reconvergence, and
   cycles/loops — every stage is assigned a level at most once, so a
   `"loop"`-role transition back to an earlier stage can never cause
   revisiting or infinite recursion. A fully cyclic graph (no stage with
   zero in-degree) falls back to the first authored stage as the sole root.
   A stage in an isolated cycle unreachable from any root gets the next
   level after the current maximum, in authored order — still deterministic.
2. Stages sharing a level become one column, ordered by authored array
   order, and are spaced in a fixed-size grid (columns left-to-right by
   level, rows top-to-bottom within a level, shorter columns centered
   against the tallest).

This was chosen over adding authored positions to the schema because
Phase 9 deliberately left positioning unresolved pending evidence, and no
evidence justifies encoding presentation coordinates into customer-experience
semantic truth for a document that is small enough (a graph of stages) to
lay out purely mechanically. It was chosen over a generic automatic
graph-layout engine because none exists elsewhere in this repository and
building one would be a far larger change than this phase's graph.

**Known limitation:** routing is intentionally the simplest possible straight
line between two stage anchors (`geometry.mjs`'s existing `anchor`/
`defaultFromSide`/`defaultToSide`, with no `via` routing). A backward/loop
edge therefore renders as a plain line crossing whatever sits between the two
stages, not a distinct routed loop glyph, and a self-referencing transition
(`from === to`) renders as a line through its own node rather than a loop-back
arc. Both are visually crude but render deterministically and never crash.
Revisiting either is future work, not required for this phase's Overview.

## Identity

Authored `Stage.id`/`Transition.from`/`Transition.to` values are canonical
and unchanged by rendering. They flow through the same `id="node-<id>"`,
`data-node-id`, `data-edge-from`, `data-edge-to` convention every other
renderer already uses (`focusNodeAttrs`/`focusEdgeAttrs` in
`renderers/shared/cli.mjs`, reused here as-is). Action and Touchpoint do not
receive DOM identity in this renderer, since they are not graph nodes here —
open question for whichever future phase renders them.

## Input

Funnel JSON files must set:

```json
{
  "schema_version": 1,
  "diagram_type": "funnel",
  "meta": { "title": "First purchase" },
  "stages": [],
  "transitions": []
}
```

A complete worked example lives at
`archify/examples/first-purchase.funnel.json`. The schema lives at
`archify/schemas/funnel.schema.json`.

## What is out of scope for this phase

No Cards, Guided Views, animation, focus/spotlight, persona filtering,
drill-down, visual theming, or Cross-Link — see `schemas/README.md` for the
progressive-disclosure model these belong to. This renderer establishes the
graph substrate they will eventually layer on top of, without implementing
any of them.
