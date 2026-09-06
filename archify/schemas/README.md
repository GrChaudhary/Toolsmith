# Archify JSON IR Schemas

Each typed renderer consumes a JSON intermediate representation (IR) validated
against one of the schemas in this folder before any layout work happens.

## Files

| Schema | Governs | Structural arrays |
|--------|---------|-------------------|
| `workflow.schema.json` | `diagram_type: "workflow"` | `lanes`, `phases`, `groups`, `mainPath`, `nodes`, `edges` |
| `sequence.schema.json` | `diagram_type: "sequence"` | `participants`, `segments`, `messages`, `activations` |
| `dataflow.schema.json` | `diagram_type: "dataflow"` | `stages`, `nodes`, `flows` |
| `lifecycle.schema.json` | `diagram_type: "lifecycle"` | `lanes`, `states`, `transitions` |
| `architecture.schema.json` | `diagram_type: "architecture"` | `components`, `boundaries`, `connections` |
| `funnel.schema.json` | `diagram_type: "funnel"` | `personas`, `stages`, `actions`, `touchpoints`, `transitions` |
| `common.schema.json` | shared `$defs` only (no top-level document) | — |

Every diagram schema requires `schema_version`, `diagram_type`, `meta` (with
`title`), and its structural arrays — except `segments`, `activations`, and
`cards`, which are optional, and Funnel's `personas`, `actions`, and
`touchpoints`, which are likewise optional (only `stages` and `transitions`
are required) — and sets `additionalProperties: false` at every level, so
unknown fields are rejected rather than silently ignored.

Every `meta` object also accepts `animation: "trace"` for opt-in SVG/CSS motion
in generated HTML. Omit it, or set `"none"`, for the default static output.
It also accepts `locale: "en" | "zh-CN"`. The field selects the fixed Viewer
UI, renderer-owned default legend and accessibility copy, document-title
suffix, and `<html lang>` value; it does not translate authored strings.
Omitting it preserves legacy behavior and resolves to English. Unsupported
locale values fail schema validation instead of being guessed or silently
rewritten.
`visual_preset` accepts `classic` (the stable default), `signal-flow` (luminous
motion-forward presentation), `blueprint` (high-contrast engineering review),
`editorial` (warm publication-style design review and documentation), or
`contrast` (a minimal, near-black/near-white, single-accent preset for
maximum-legibility review contexts). Presets change only viewer styling; they
do not alter semantic IDs or geometry.

Every `meta` object also accepts `effects`, an array drawn from `glow`,
`grain`, and `depth`. Effects are a second, independent presentation axis —
composable with any preset and either theme rather than encoded as one more
preset combination (e.g. `visual_preset: "blueprint"` with
`effects: ["glow", "depth"]` is valid and does not require a
"blueprint-glow-depth" preset to exist). `glow` adds a soft highlight to
emphasis-role connections and their arrowheads (`.a-emphasis`/`.m-emphasis`,
the same classes `arrowClassMap` already assigns); it is present in both the
live viewer and a standalone exported SVG. `depth` adds elevation shading to
the diagram panel and info cards. `grain` adds a subtle, static (non-random,
fixed-seed) noise texture to the diagram panel background. `depth` and
`grain` are page-chrome treatments, like the existing toolbar/card styling,
and are intentionally absent from standalone SVG export — the same boundary
`assets/template.html`'s export pipeline already draws around toolbar CSS.
Omitting `effects`, or leaving it empty, renders identically to every
document written before this field existed. Effects style existing
diagram-type-agnostic structural classes; no renderer branches on diagram
type to apply them.

The reader-facing style picker in the toolbar (`Archify.preset`,
`assets/template.html`) also offers `contrast` as a fifth try-on option,
alongside the four existing presets — it reads its own list from a single
array plus one `[data-preset-value]` menu entry per style, so adding a style
there is a small, bounded, mechanical change with no new interaction model.
`effects` deliberately has no equivalent live toolbar toggle: it is
authored-only, set in the document's own `meta.effects`. Building an
accessible multi-select "Effects" menu — with its own keyboard navigation,
ARIA state, and session-only try-on persistence — would mean substantially
extending the same large, heavily-tested toolbar script the style picker
already lives in, for a presentation axis that (unlike style, which every
reader may want to try live) is more naturally an authoring-time choice a
diagram's owner makes once. If a live effects toggle is wanted later, the
style picker's own array-plus-menu-item structure is the template to follow.

Sequence `meta` additionally accepts `column_fit`. The default `fixed` keeps
the historical 108px column gap and 86px participant boxes, so an authored
diagram renders at the same coordinates no matter how wide its viewBox is.
`spread` derives the gap and box width from the viewBox instead, which turns a
wide canvas into column distance and label room rather than empty space on the
right. Lane order, IDs, and message semantics are unchanged either way.

It may also include up to five guided `views`. Each view has a unique `id`, a
reader-facing `label`, a non-empty `focus` list of existing semantic node IDs,
and an optional short `note`.

### Legend presentation contract

Every `meta` object accepts the same optional legend shape without changing
the schema version already selected for that renderer:

```json
"legend": {
  "mode": "auto",
  "entries": {
    "security": { "label": "restricted data", "visible": true }
  }
}
```

`mode` is `auto` (the default), `all`, or `hidden`. `auto` includes only kinds
present in typed IR; `all` includes the renderer's full stable catalog;
`hidden` removes the complete legend and takes precedence over entry overrides.
Architecture documents that omit an explicit `viewBox` size that automatic
viewBox from the same measured resolved legend footprint used for final SVG
layout. Across all renderers, legacy documents that omit `meta.legend` use a
compatibility-safe implicit `auto`: if the resolved legend cannot fit an
explicit authored viewBox without overlap, Archify omits the complete legend
instead of turning a previously valid schema-v1 document into a hard failure.
Once an author adds `meta.legend` (including explicit `mode: "auto"`), the
layout is intentional and unfit labels or bands fail with a path-prefixed
diagnostic. An entry may set a non-empty, bounded `label`, boolean `visible`,
or both.
`visible: false` removes a resolved entry and `visible: true` forces a supported
but unused kind into the visual legend. Unknown kinds and properties fail
strict validation.

Supported keys are renderer-owned:

| Renderer | `meta.legend.entries` keys |
|---|---|
| Architecture | `frontend`, `backend`, `database`, `cloud`, `security`, `messagebus`, `external` |
| Workflow | `frontend`, `backend`, `security`, `messagebus`, `database`, `cloud`, `external` |
| Sequence | `emphasis`, `return`, `security`, `dashed`, `default` |
| Dataflow | `emphasis`, `security`, `dashed`, `database`, `default` |
| Lifecycle | `start`, `active`, `waiting`, `decision`, `success`, `failure`, `neutral`, `external` |

Labels are presentation only: they do not rename the stable kind, change
nodes/relationships, or create Semantic Lens edge facts. Sequence message and
Dataflow flow-variant entries are visual keys. Component/state entries backed
by exact compiled node facts receive the interactive Semantic Legend bridge;
this includes Dataflow `database` when a real `nodes[].type: "database"` fact
exists.

Every relationship collection (`connections`, `edges`, `messages`, `flows`, and
`transitions`) accepts an optional author-controlled `id` using the shared ID
pattern. The renderer keeps its source-order runtime key separately, while the
authored ID enables a stable `#relation=<id>` viewer link that survives array
reordering. ID-less documents remain valid and their relationship pins stay
local to the current page.

Every semantic node collection (`components`, `nodes`, `participants`, and
`states`) also accepts one optional `brand`: either a canonical string returned
by `archify brands --json`, or a digest-pinned `{ "url", "sha256" }` object
returned by `archify brands capture <url> --json`. Known IDs and known-brand
domains use the bundled vector catalogue. Unknown URLs must be captured in that
explicit command before authoring; render and validate never perform an
unpinned network capture. Unsafe, unavailable, changed, or unsupported content
fails closed with a brand diagnostic. Omitted `brand` preserves the prior
output.

## Enterprise `kind` taxonomy (architecture, pilot)

Architecture `components[]` accept an optional `kind`, scoped for now to three
pilot values: `queue`, `cache`, `identity-provider`. This is the beginning of
a broader enterprise semantic taxonomy layered on top of — not instead of —
the existing `componentType` (`type`). The two fields answer different
questions and both remain independently optional:

- `type` (`componentType`) is the legacy, renderer-facing classification that
  drives color/legend/icon. It is unchanged and required exactly as before.
- `kind` is a finer-grained semantic label that does not affect rendering in
  this phase. It exists so an architecture description can say a component
  is specifically a queue, a cache, or an identity provider, independent of
  which broader `type` bucket the renderer groups it under.

A document that omits `kind` entirely is unaffected — `kind` is optional at
every level and adds no new required fields. The conventional pairing is:

| `kind` | conventionally paired `type` |
|---|---|
| `queue` | `messagebus` |
| `cache` | `database` |
| `identity-provider` | `security` |

This pairing is documentation, not a validation rule: schema validation never
checks it, and any schema-valid `type` may be combined with any pilot `kind`.
The informational `archify review architecture` command (see the repository
root's CLI usage) checks this pairing and reports pass/warning findings; it
never fails `validate` or `deliver`. See `archify/review/architecture-review.mjs`.

`kind` is scoped to `architecture.schema.json` only. The other four diagram
schemas are unchanged in this phase.

### Enterprise metadata (architecture, pilot)

Architecture `components[]` also accept four independent, optional metadata
objects, each `additionalProperties: false` and `minProperties: 1` (an
authored empty object is rejected — omit the field entirely instead):

| Field | Shape | Answers |
|---|---|---|
| `technology` | `{ name?, vendor? }` | which concrete technology this component runs, e.g. `{ "name": "Redis" }` |
| `security` | `{ auth_method? }` | how this component authenticates, e.g. `{ "auth_method": "OAuth2.0" }` |
| `ownership` | `{ team?, status?: "active"\|"deprecated"\|"planned" }` | who owns this component and its lifecycle stage |
| `deployment` | `{ provider? }` | which infrastructure provider hosts this component |

These fields are purely informational: no renderer reads them, so an
otherwise-identical document renders byte-identical HTML whether or not they
are present. They are independent of `kind` and `type` and of each other;
any combination, including none, is valid.

`ownership.team` is unrelated to the existing `tag` field that
`engineering_profile: "deployment-ownership"` already reads as an owner
name — both remain valid, independently, and neither is derived from the
other in this phase.

Like `kind`, these fields are scoped to `architecture.schema.json` only.

### Component hierarchy and HLD / LLD projection (architecture, pilot)

Architecture `components[]` also accept an optional `children`: a non-empty
array of other component ids in the same document that this component
groups. This is the one and only new fact Phase 3 adds — everything else
about "abstraction level" is derived from it, not authored:

```json
{ "id": "documentProcessing", "type": "backend", "label": "Document Processing Service",
  "children": ["uploadApi", "objectStore", "processingQueue", "processingWorker", "documentDb"] }
```

**Hierarchy rules**, enforced as cross-collection checks (the same pass that
already catches duplicate view/relationship ids), not by the JSON Schema
alone: every id in `children` must refer to a real component in the same
document; an id may be claimed by at most one parent; a component may not
list itself; duplicate ids within one `children` list are rejected; and the
hierarchy as a whole must be acyclic.

**HLD and LLD are projections of this one document, not separate schemas or
separate source data.** `archify project architecture <input.json> hld|lld
[output.json]` is the explicit, opt-in command that produces one:

- **HLD** keeps every component that is not itself a `children` member of
  another component (top-level and standalone components), hides everything
  absorbed into a group, and derives connections/boundaries/guided-view
  focus lists accordingly: a connection whose endpoints both lift to the
  same HLD-visible ancestor is fully internal to that group and is dropped;
  a connection whose lifted endpoints differ contributes to exactly one
  merged HLD connection per directed pair. A single contributing connection
  keeps its authored id/label unchanged. Multiple contributing connections
  receive a deterministic synthesized id (`<from>__<to>`) and no label —
  projection never fabricates a merged description from several authored
  ones.
- **LLD** keeps every component that does not itself have a `children` list
  (every leaf and standalone component), excludes group/parent components,
  and leaves every authored connection untouched — LLD performs no lifting
  or merging.

A document that never uses `children` projects to a document deeply equal to
itself for both `hld` and `lld` — flat documents (everything authored today)
are unaffected and remain HLD/LLD-equivalent by construction, with no
special casing required.

Projection output is a normal, schema-valid `architecture.schema.json`
document — the existing renderer, layout, and visual system consume it
unmodified, exactly as they consume any hand-authored document. Projection
is never invoked by `render`, `validate`, or `deliver`; it is only ever run
by the explicit `project` command. Component ids are never renamed by
projection, so the same id refers to the same underlying entity whether
viewed via HLD, LLD, or the unprojected source document.

Like `kind`, `children` is scoped to `architecture.schema.json` only.

## schema_version policy

Workflow supports schema versions 1 and 2. Version 1 remains the fixed-layout
compatibility contract; version 2 opts into the readable workflow compiler and
can be produced explicitly with `archify migrate workflow ... --to-schema 2`.
The other four diagram schemas keep `schema_version` pinned to `1`.

Workflow also accepts optional `semanticChecks`. `allowedRoots` and
`allowedTerminals` close the set of intentional graph sources and sinks;
`requiredEdges` requires exact authored relationships; and `requiredPaths`
requires directed reachability while allowing intermediate nodes. The compiler
evaluates these facts before layout and returns typed `workflow/*` diagnostics.
The field is additive and geometry-neutral: omitting it preserves existing
workflow behavior and including a satisfied contract does not change SVG or
layout-receipt bytes.

A file that validates today must keep validating and rendering within its
declared version throughout the 2.x release line. Additive viewer,
accessibility, and presentation improvements may enhance generated HTML, but
they must not reinterpret authored IR or turn a previously valid profile-less
v1 file into a new hard layout failure. Breaking IR changes require a new
version; additive, backwards-compatible fields do not.

## Funnel semantic model (customer experience, pilot)

`funnel.schema.json` is a sibling semantic domain to Architecture, not an
extension of it — `diagram_type: "funnel"` documents are validated against
their own schema and share nothing with `architecture.schema.json` except
`common.schema.json#/$defs/id`. There is no `componentType`, `children`, or
other Architecture vocabulary anywhere in the funnel schema, and Architecture
is unaware `funnel.schema.json` exists.

**Funnel IR describes customer-observable experience: personas, journey
stages, the actions a customer takes, the touchpoints they act through, and
the transitions between stages.** It has no `type`, `service`, `API`,
`database`, or other Architecture/technical vocabulary — a stage's `outcome`
is `"conversion"` or `"dropoff"` (a result a customer experiences), never
`"failure"` (a technical/infrastructure concept, which does not appear
anywhere in this schema). Structural arrays: `personas` (optional),
`stages` (required, at least two), `actions` (optional), `touchpoints`
(optional), `transitions` (required). A stage may carry an `outcome` while
still being the source of further outgoing transitions — dropoff and
conversion describe a customer-observable result reachable at a stage, not
that stage's structural terminal-ness; the graph itself allows branching,
reconvergence, and cycles (e.g. a `"loop"`-role transition back to an earlier
stage) and is never required to be acyclic.

**Semantic truth vs. presentation is an explicit, deliberate boundary.** The
schema intentionally does not include `views`, `cards`, `animation`, focus,
viewport, or visual-styling fields, even though sibling schemas accept some
of these in their own `meta` — Funnel's product principle is that the
semantic IR holds the complete customer-experience truth, and presentation is
a progressive-disclosure layer on top of it (clean default view → optionally
reveal Actions/Touchpoints/Personas/Friction/Decisions/Outcomes → optionally
enable Cards/Guided Views/animation/focus/persona filtering/drill-down) that
never mutates or is encoded into the semantic document. Something's absence
from `funnel.schema.json` does not mean Toolsmith won't eventually support
richer Funnel presentation — it means that capability belongs in a
presentation/renderer layer once one exists, the same way `cards` and
`views` already sit in `meta` as optional presentation contracts for the
other five diagram types rather than being load-bearing semantic facts.

Three layers stay conceptually distinct, and none of them is Funnel semantic
truth:

- **Presentation configuration** answers "how should this document be
  presented?" — e.g. `meta.views` (which reader paths exist), `meta.cards`
  (what a summary card shows), `meta.animation`/`meta.visual_preset`. These
  are author-set, schema-validated, and part of the document today for the
  other five types.
- **Runtime interaction state** answers "what is happening in the viewer
  right now?" — e.g. which node is focused, which guided-view step is
  active, current zoom/pan, animation progress. This is never authored and
  never part of any schema. `assets/template.html`'s canonical-export path
  explicitly strips `data-focus-active`, `data-route-*`, `data-story-*`, and
  `data-lens-*` attributes before producing an exported artifact — direct
  repository evidence that this layer is already kept out of anything
  durable, let alone semantic IR.
- **Generic presentation infrastructure** is the reusable machinery neither
  of the above needs to reimplement per diagram type — `focusNodeAttrs`/
  `focusEdgeAttrs`, the guided-view/relationship-id registries below, and the
  template's Reading Depth / zoom / export mechanics, none of which contain
  `diagram_type`-specific logic.

Funnel does not yet have presentation configuration of its own (no
`meta.views`/`meta.cards` in `funnel.schema.json`); it participates only in
the generic infrastructure layer today (see the registry paragraph below).
Adding Funnel-specific presentation configuration is future, separately
justified work, not assumed by this phase.

Referential integrity across Funnel's collections — `Stage.personas[]`,
`Action.stage`, `Action.touchpoint`, and `Transition.from`/`Transition.to`
each resolving to a real id elsewhere in the document, plus duplicate ids
within any one collection — is enforced by `validateFunnelReferences()` in
`renderers/shared/cli.mjs`, the same cross-collection-checks pattern
`validateComponentHierarchy()` established for Architecture's `children`.
Unlike that check, it never rejects a cycle. Funnel's `transitions` are also
registered in the shared `RELATIONSHIP_COLLECTIONS` registry (duplicate
transition ids) and `stages` in `SEMANTIC_COLLECTIONS` (a no-op today, since
the schema has no `meta.views` yet, but ready if Funnel adds guided-view
support later) — the same generic registries every other renderer's loader
already uses, extended by a one-line entry each rather than new
funnel-specific logic.

Funnel has a renderer as of Phase 10 — `renderers/funnel/render-funnel.mjs`,
invoked directly (`node renderers/funnel/render-funnel.mjs input.json
output.html`) exactly like the other five, see `renderers/funnel/README.md`
for its Overview-only scope and Stage-positioning strategy. As of Phase 11
that renderer also populates an Explore layer: focusing a Stage node reveals
its Decision/Actions/Touchpoints/Personas/Friction through the existing
Semantic Passport's new, generic, optional detail-groups section — the same
progressive-disclosure principle above, now with a working default→explore
path. Nothing here is written back into the Funnel document; see
`renderers/funnel/README.md`'s Explore section and
`renderers/funnel/explore-detail.mjs` for the read-only projection this is
built on. As of Phase 12, the same renderer also offers Persona Lens: a
read-only presentation filter (one button per `funnel.personas` entry) that
dims Stages/Transitions not applicable to the selected Persona — one graph,
no lanes, no per-Persona copy — leaving the Funnel document and Explore both
completely unchanged. See `renderers/funnel/README.md`'s Persona Lens
section and `renderers/funnel/persona-focus.mjs` for the one pure rule
(`isStageApplicableToPersona`) it's built on. As of Phase 13, the Stage
`outcome` values `conversion`/`dropoff` — already surfaced since Phase 10
through `data-node-kind` — receive distinct CSS-only visual treatment (a
color-token pairing plus a stroke-dasharray, so the pair is distinguishable
without relying on hue alone), reusing the same "alias a semantic kind onto
an existing brand color token" convention `assets/template.html` already
uses for its own state kinds; no schema field, renderer attribute, or
Passport/Persona Lens behavior changed. See `renderers/funnel/README.md`'s
Outcome styling section. As of Phase 14, Transition `role` values
`primary`/`alternative`/`loop` — already surfaced since Phase 10 through
`data-edge-role` — likewise receive distinct visual treatment, by making the
renderer variant-aware of the same shared `arrowClassMap` (class + marker
pairs) every other Archify renderer's edges already use, selected from a
renderer-local derivation of `role` rather than any new schema or IR field.
Node outcome styling (Phase 13) and edge role styling (Phase 14) are
independent presentation dimensions that compose without collision. See
`renderers/funnel/README.md`'s Transition role styling section. As of
Phase 15, Explore's Actions/Touchpoints detail (Phase 11) gained a small,
still fully generic, visual cue: the shared Passport's detail-group item
contract now accepts an optional `{text, tag}` shape alongside its original
plain-string shape, letting `explore-detail.mjs` attach a neutral tag — an
Action's `optional` boolean as "Optional", a Touchpoint's required `type`
humanized (`web` → "Web", `mobile-app` → "Mobile App", …) — without the
generic Passport renderer gaining any diagram-type awareness, without a
Funnel-specific Passport component, and without any new schema field. See
`renderers/funnel/README.md`'s Explore detail visual semantics section.
`archify
render`/`validate` (the `archify` CLI's own dispatch in `bin/archify.mjs`)
still do not know about `diagram_type: "funnel"` — there is no
`archify render funnel` command. As of Phase 16, `funnel.schema.json`'s
`meta` also gained `locale`/`output`/`animation`/`visual_preset`/`views` —
the same five properties every other diagram type's `meta` already declared
(the last two via the same shared `common.schema.json#/$defs/animation` and
`#/$defs/visualPreset` most other diagram schemas already reference, rather
than duplicating the enum inline) — and shared
code (`writeDiagram`, `translateMessage`) already read unconditionally. This
closes a genuine, previously undetected gap (an authored `meta.locale` was
schema-rejected for Funnel specifically) and lets Funnel author `meta.views`
to drive the existing, fully generic Guided View/Story player every other
diagram type already had access to — no new player, no new schema concept,
just parity. Two more small, generic Passport extensions landed in the same
phase: a Persona gets a deterministic presentation identity (a hash of its
id into one of the seven existing brand tokens, consistent across the
Persona Lens buttons and Explore's Personas group), and Transition `role`
now also appears in the Stage Passport via the same `{text, tag}` shape
Phase 15 established. See `renderers/funnel/README.md`'s Persona visual
identity and Transition role in the Stage Passport sections.

Funnel and Architecture also gained their first relationship: **Cross-Link**
(`schemas/cross-link.schema.json`) is a separate artifact linking a Funnel
Stage to an Architecture component at a given HLD/LLD level — never embedded
in either document, so both remain independently valid whether or not any
Cross-Link document exists. See "Cross-Link" below and
`renderers/funnel/README.md`'s Cross-Link section for the full model,
validation, and the one explicitly deferred piece (a live reverse-lookup
wiring into `render-architecture.mjs`).

## Cross-Link

`schemas/cross-link.schema.json` defines a document of `links[]`, each
naming a Funnel Stage (`{document, stageId}`) and an Architecture component
at a level (`{document, componentId, level: "hld"|"lld"}`). Neither Funnel
nor Architecture ever references a Cross-Link document or the other domain
directly — `test/cross-link.test.mjs` asserts this invariant by checking
neither schema's serialized text contains the string `"cross-link"`.

`renderers/shared/cross-link.mjs` holds every pure function: structural
validation (duplicate link ids), reference validation (a Stage id actually
exists in the named Funnel document; a component id is actually visible at
the named level in the named Architecture document — reusing
`projection/architecture-projection.mjs`'s existing `projectArchitecture()`
rather than reimplementing HLD/LLD visibility), forward lookup
(`linksForStage`) and reverse lookup (`linksForComponent`), and a strict
href allowlist (`safeCrossLinkHref`) limiting any resolved navigation link
to a relative local `.html` file with an optional `#focus=<id>` fragment —
reusing the viewer's existing deep-link convention, never a new navigation
mechanism, and never an absolute URL, `javascript:`, or `data:` scheme.

`renderers/funnel/render-funnel.mjs` integrates this behind an opt-in
`--cross-link <path.json>` flag: every invocation without it, including
every existing example/test/golden fixture, is byte-for-byte unaffected.
The reverse direction (an Architecture component's Passport linking back to
the customer journeys it supports) is implemented and tested as a pure
function but deliberately not yet wired into `render-architecture.mjs`'s
own CLI — that renderer is substantially larger and more heavily depended
upon than Funnel's, and wiring live rendering into it is left to a future,
more narrowly scoped phase rather than rushed here.

## Shared definitions (common.schema.json)

The six diagram schemas reference `common.schema.json#/$defs/...`:

- `id` — element identifiers, pattern `^[a-zA-Z][a-zA-Z0-9_-]*$`
- `point` — an `[x, y]` pair of numbers (used by `via` and `labelAt`)
- `componentType` — `frontend`, `backend`, `database`, `cloud`, `security`,
  `messagebus`, `external`
- `locale` — the bounded renderer locale, `en` or `zh-CN`
- `brandMark` — one optional built-in brand ID or explicit HTTP(S) site URL
- `variant` — `default`, `emphasis`, `security`, `dashed` (sequence messages
  extend this list locally with `return`)
- `legendMode` and `legendEntry` — the shared strict mode and label/visibility
  override shapes used by each renderer-owned key map
- `guidedViews` — the bounded, read-only reader paths accepted by `meta.views`
- `cards` — the summary-card blocks rendered below the SVG

Lifecycle state `type` is mode-specific (`start`/`active`/`waiting`/...) and
stays in `lifecycle.schema.json`.

## Runtime validation

At development time, `scripts/generate-validators.mjs` compiles all six
schemas with ajv's draft 2020-12 standalone generator using `strict: true` and
`allErrors: true`. The generated `renderers/shared/generated-validators.mjs`
is committed and shipped with the skill, so runtime validation has no npm or
network dependency. `renderers/shared/validator.mjs` applies the matching
standalone validator before the renderer's own layout checks.
The shared loader then checks cross-collection facts that JSON Schema cannot
express cleanly here: duplicate view IDs, duplicate focus IDs, focus IDs that do
not exist in the diagram's semantic collection, and duplicate authored
relationship IDs within the mode's relationship collection. Funnel has no
renderer or CLI wiring yet, so its equivalent checks
(`validateFunnelReferences`, plus its `SEMANTIC_COLLECTIONS`/
`RELATIONSHIP_COLLECTIONS` registrations — see the Funnel section above) are
exercised directly by `test/funnel-references.test.mjs` rather than through
`loadDiagram`.

Architecture additionally supports opt-in, revision-pinned repository evidence.
`meta.repository` names a public GitHub URL and full commit SHA; a component may
carry one to three `sources` with repo-relative POSIX paths, optional line
ranges, and optional labels. Shape is schema-checked, then the renderer requires
`--repo-root`: the local Git origin must match, and Git must prove the commit,
blobs, and requested lines. Verified evidence is embedded outside the canonical
SVG for the Semantic Passport and Node Finder; ordinary documents and visual
exports carry no repository evidence.

## Visual quality and engineering truth

`meta.quality_profile` and `meta.engineering_profile` answer different
questions. `quality_profile` is available in all five modes and controls how
strictly Archify judges composition. `engineering_profile` is an optional
Architecture-only semantic contract; omitting it preserves the ordinary v1
behavior.

The first engineering profile is `deployment-ownership`. Enable it only when
the user wants a fail-closed deployment review and the source facts are known.
It requires every non-external component to name an owner in `tag` and belong
to exactly one `region`; the document must contain both `region` and
`security-group` boundaries; every `database` must be inside a
`security-group`; each security group must contain members from one shared
region; and every connection whose region or security-group membership changes
must name the real crossing mechanism in `label`.

The profile validates only authored IR. It does not discover infrastructure,
infer owners, or prove that a diagram matches a live environment. If a fact is
unknown, leave the profile unset or obtain the fact instead of inventing it.

`npm test` runs the generator in check mode and fails when the committed
validators drift from their schemas.

## Error format

Schema violations exit non-zero. Each ajv error is reported on its own line as
the instance path — annotated with the nearest enclosing element's `id` or
`label` — followed by the message and parameters:

```text
workflow schema validation failed:
  /nodes/3 (id/label: "router") must NOT have additional properties {"additionalProperty":"colour"}
```

Schemas catch shape errors (types, enums, ranges, unknown fields); geometry
problems such as overlaps and label collisions are the renderers' job.
