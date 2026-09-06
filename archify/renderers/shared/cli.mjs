import fs from 'node:fs';
import path from 'node:path';
import { applyTemplate, renderCards, esc, normalizeVisualEffects } from './utils.mjs';
import { validateSchema } from './validator.mjs';
import { verifyRepositoryEvidence } from './repository-evidence.mjs';
import { installRendererDiagnosticBoundary, throwDiagnosticProblems } from './diagnostics.mjs';
import { validateEngineeringProfile } from './engineering-profiles.mjs';
import { resolveOutputPath } from './output-path.mjs';
import { prepareDiagramBrandMarks } from './brand-marks.mjs';
import { resolveLocale, translateMessage } from './i18n.mjs';

installRendererDiagnosticBoundary();

const outputPathGuards = new Map();

// Common CLI head: node render-<type>.mjs [input.json] [output.html]
// Keep this synchronous because callers also use it to establish the guarded
// output path before testing a last-moment filesystem alias change.
export function loadDiagram({ rendererDir, diagramType, defaultExample, argv = process.argv }) {
  const skillRoot = path.resolve(rendererDir, '../..');
  const inputPath = path.resolve(argv[2] || path.join(skillRoot, 'examples', defaultExample));
  const diagram = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  validateSchema(diagramType, diagram);
  validateGuidedViews(diagramType, diagram);
  validateRelationshipIds(diagramType, diagram);
  validateComponentHierarchy(diagramType, diagram);
  validateFunnelReferences(diagramType, diagram);
  validateEngineeringProfile(diagramType, diagram);
  const sourceEvidence = verifyRepositoryEvidence(diagramType, diagram, process.env.ARCHIFY_REPO_ROOT);
  const template = fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8');
  const outputRequest = {
    requestedOutput: argv[3],
    authoredOutput: diagram.meta?.output,
    defaultOutput: `${diagramType}.html`,
    inputPaths: [inputPath],
    cwd: process.cwd(),
  };
  const { outputPath: outPath } = resolveOutputPath(outputRequest);
  outputPathGuards.set(outPath, outputRequest);
  // inputPath: additive (Phase 16) so a caller that needs to identify "this
  // document" by filename — e.g. Cross-Link matching a link's
  // funnel.document string — doesn't need to re-derive argv[2] itself.
  // Every existing caller destructures only the keys it already used.
  return { diagram, template, outPath, sourceEvidence, inputPath };
}

// Brand URL capture is the only asynchronous authoring step. Typed renderers
// opt into it through this wrapper without changing loadDiagram's long-lived
// synchronous safety contract.
export async function loadDiagramWithBrandMarks(options) {
  const loaded = loadDiagram(options);
  await prepareDiagramBrandMarks(options.diagramType, loaded.diagram);
  return loaded;
}

const START_TYPES = new Set(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle', 'funnel']);

// Common CLI tail: fill the template and write the standalone HTML file.
export function writeDiagram({ outPath, template, diagramType, meta, svg, cards, sourceEvidence = null }) {
  if (!START_TYPES.has(diagramType)) throw new Error(`writeDiagram: unknown diagram type ${JSON.stringify(diagramType)}`);
  const outputGuard = outputPathGuards.get(outPath);
  if (outputGuard) resolveOutputPath(outputGuard);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, applyTemplate(template, {
    title: meta.title,
    subtitle: meta.subtitle,
    svg,
    cards: renderCards(cards),
    locale: meta.locale,
    visualPreset: meta.visual_preset || 'classic',
    visualEffects: meta.effects || [],
    guidedViews: meta.views || [],
    sourceEvidence,
  }));
  outputPathGuards.delete(outPath);
  console.log(outPath);
}

const SEMANTIC_COLLECTIONS = {
  architecture: 'components',
  workflow: 'nodes',
  sequence: 'participants',
  dataflow: 'nodes',
  lifecycle: 'states',
  funnel: 'stages',
};

const RELATIONSHIP_COLLECTIONS = {
  architecture: 'connections',
  workflow: 'edges',
  sequence: 'messages',
  dataflow: 'flows',
  lifecycle: 'transitions',
  funnel: 'transitions',
};

// Relationship IDs are optional for backwards compatibility, but once an
// author supplies one it becomes the durable identity used by viewer links.
// Keep uniqueness enforcement in the shared zero-install path so every typed
// renderer fails the same way even when development dependencies are absent.
export function validateRelationshipIds(diagramType, diagram) {
  const collection = RELATIONSHIP_COLLECTIONS[diagramType];
  const relationships = collection && Array.isArray(diagram[collection]) ? diagram[collection] : [];
  const seen = new Set();
  const problems = [];

  relationships.forEach((relationship, index) => {
    if (relationship.id === undefined || relationship.id === null || relationship.id === '') return;
    if (seen.has(relationship.id)) {
      problems.push(`/${collection}/${index}/id duplicates relationship id ${JSON.stringify(relationship.id)}`);
    }
    seen.add(relationship.id);
  });

  if (problems.length) {
    throwDiagnosticProblems('Relationship identity validation failed', problems, {
      code: 'relationship/duplicate-id',
      subject: { diagramType, collection },
    });
  }
}

// JSON Schema keeps the view object bounded; this pass checks facts that span
// collections. Keeping it here makes the same contract apply to all five
// renderers, including the zero-install standalone-validator path.
export function validateGuidedViews(diagramType, diagram) {
  const views = diagram.meta?.views;
  if (!Array.isArray(views) || views.length === 0) return;
  const collection = SEMANTIC_COLLECTIONS[diagramType];
  const semanticIds = new Set((diagram[collection] || []).map((item) => item.id));
  const seen = new Set();
  const problems = [];

  views.forEach((view, index) => {
    if (seen.has(view.id)) problems.push(`/meta/views/${index}/id duplicates view id ${JSON.stringify(view.id)}`);
    seen.add(view.id);
    const seenFocus = new Set();
    (view.focus || []).forEach((id, focusIndex) => {
      if (seenFocus.has(id)) {
        problems.push(`/meta/views/${index}/focus/${focusIndex} duplicates semantic id ${JSON.stringify(id)}`);
      }
      seenFocus.add(id);
      if (!semanticIds.has(id)) {
        problems.push(`/meta/views/${index}/focus/${focusIndex} references unknown semantic id ${JSON.stringify(id)}`);
      }
    });
  });

  if (problems.length) {
    throwDiagnosticProblems('Guided view validation failed', problems, {
      code: 'guided-view/invalid',
      subject: { diagramType, collection: 'meta.views' },
    });
  }
}

// `children` (Phase 3, architecture only) expresses composition: a parent/
// group component's HLD summary decomposes into these leaf components at
// LLD. JSON Schema can check each id's shape, but not that ids exist, are
// claimed by at most one parent, or form a forest rather than a cycle —
// those are cross-collection facts, checked here alongside the other
// cross-collection passes (duplicate view/relationship ids) rather than in
// a new, parallel validation framework.
export function validateComponentHierarchy(diagramType, diagram) {
  if (diagramType !== 'architecture') return;
  const components = Array.isArray(diagram.components) ? diagram.components : [];
  const componentIds = new Set(components.map((component) => component.id));
  const parentOf = new Map();
  const problems = [];

  components.forEach((component, index) => {
    if (!Array.isArray(component.children)) return;
    const seenInList = new Set();
    component.children.forEach((childId, childIndex) => {
      if (seenInList.has(childId)) {
        problems.push(`/components/${index}/children/${childIndex} duplicates child id ${JSON.stringify(childId)} within the same parent`);
        return;
      }
      seenInList.add(childId);

      if (childId === component.id) {
        problems.push(`/components/${index}/children/${childIndex} references its own parent ${JSON.stringify(component.id)} (self-reference)`);
        return;
      }
      if (!componentIds.has(childId)) {
        problems.push(`/components/${index}/children/${childIndex} references unknown component id ${JSON.stringify(childId)}`);
        return;
      }
      if (parentOf.has(childId) && parentOf.get(childId) !== component.id) {
        problems.push(`/components/${index}/children/${childIndex} claims child ${JSON.stringify(childId)}, which is already a child of ${JSON.stringify(parentOf.get(childId))}`);
        return;
      }
      parentOf.set(childId, component.id);
    });
  });

  // Cycle detection over the id-valid, non-self-referential edges above —
  // a standard three-color DFS. Multiple-parent claims are already reported
  // separately; this only needs one edge per (parent, child) pair to find a
  // cycle, so it tolerates the rejected duplicate/second-parent edges being
  // present in the raw `children` arrays.
  const childrenOf = new Map(components.map((component) => [
    component.id,
    Array.isArray(component.children)
      ? component.children.filter((id) => componentIds.has(id) && id !== component.id)
      : [],
  ]));
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map(components.map((component) => [component.id, WHITE]));

  function visit(id, path) {
    color.set(id, GRAY);
    path.push(id);
    for (const childId of childrenOf.get(id) || []) {
      const childColor = color.get(childId);
      if (childColor === GRAY) {
        const cycleStart = path.indexOf(childId);
        problems.push(`components hierarchy contains a cycle: ${[...path.slice(cycleStart), childId].join(' -> ')}`);
      } else if (childColor === WHITE) {
        visit(childId, path);
      }
    }
    path.pop();
    color.set(id, BLACK);
  }

  for (const component of components) {
    if (color.get(component.id) === WHITE) visit(component.id, []);
  }

  if (problems.length) {
    throwDiagnosticProblems('Component hierarchy validation failed', problems, {
      code: 'hierarchy/invalid',
      subject: { diagramType, collection: 'components' },
    });
  }
}

// Funnel (Phase 9): `stages`/`transitions` form the required customer-journey
// graph; `personas`/`touchpoints`/`actions` are optional supporting
// collections. JSON Schema bounds each collection's own item shape but not
// cross-collection facts — id uniqueness within a collection, and every
// reference (Stage.personas, Action.stage, Action.touchpoint,
// Transition.from/to) resolving to a real id elsewhere in the document.
// Checked here alongside the other cross-collection passes (duplicate view
// ids via validateGuidedViews, duplicate transition ids via
// validateRelationshipIds now that funnel is registered in
// RELATIONSHIP_COLLECTIONS) rather than in a new, parallel validation
// framework. Branching, reconvergence, and cycles are valid Funnel semantics
// — a stage may carry `outcome: "conversion"` or `"dropoff"` and still be the
// source of an outgoing transition — so, unlike validateComponentHierarchy's
// containment graph, this never rejects a cycle.
export function validateFunnelReferences(diagramType, diagram) {
  if (diagramType !== 'funnel') return;
  const problems = [];

  function collectIds(collectionName) {
    const items = Array.isArray(diagram[collectionName]) ? diagram[collectionName] : [];
    const ids = new Set();
    const seen = new Set();
    items.forEach((item, index) => {
      if (seen.has(item.id)) {
        problems.push(`/${collectionName}/${index}/id duplicates ${collectionName} id ${JSON.stringify(item.id)}`);
      }
      seen.add(item.id);
      ids.add(item.id);
    });
    return ids;
  }

  const personaIds = collectIds('personas');
  const stageIds = collectIds('stages');
  const touchpointIds = collectIds('touchpoints');
  collectIds('actions');

  (diagram.stages || []).forEach((stage, index) => {
    (stage.personas || []).forEach((personaId, personaIndex) => {
      if (!personaIds.has(personaId)) {
        problems.push(`/stages/${index}/personas/${personaIndex} references unknown persona id ${JSON.stringify(personaId)}`);
      }
    });
  });

  (diagram.actions || []).forEach((action, index) => {
    if (!stageIds.has(action.stage)) {
      problems.push(`/actions/${index}/stage references unknown stage id ${JSON.stringify(action.stage)}`);
    }
    if (action.touchpoint !== undefined && !touchpointIds.has(action.touchpoint)) {
      problems.push(`/actions/${index}/touchpoint references unknown touchpoint id ${JSON.stringify(action.touchpoint)}`);
    }
  });

  (diagram.transitions || []).forEach((transition, index) => {
    if (!stageIds.has(transition.from)) {
      problems.push(`/transitions/${index}/from references unknown stage id ${JSON.stringify(transition.from)}`);
    }
    if (!stageIds.has(transition.to)) {
      problems.push(`/transitions/${index}/to references unknown stage id ${JSON.stringify(transition.to)}`);
    }
  });

  if (problems.length) {
    throwDiagnosticProblems('Funnel reference validation failed', problems, {
      code: 'funnel/invalid-reference',
      subject: { diagramType, collection: 'stages/transitions/actions/touchpoints/personas' },
    });
  }
}

// Accessible name for the generated diagram SVG.
export function svgRootAttrs(meta) {
  const animation = meta.animation === 'trace' ? ' data-animation="trace"' : '';
  const preset = ` data-preset="${esc(meta.visual_preset || 'classic')}"`;
  const effectsAttr = normalizeVisualEffects(meta.effects).join(' ');
  const effects = effectsAttr ? ` data-effects="${esc(effectsAttr)}"` : '';
  const engineeringProfile = meta.engineering_profile
    ? ` data-engineering-profile="${esc(meta.engineering_profile)}"`
    : '';
  const requestedProfile = process.env.ARCHIFY_QUALITY_PROFILE || meta.quality_profile;
  const qualityProfile = requestedProfile === 'showcase' ? 'showcase' : 'standard';
  const advisory = requestedProfile ? '' : ' data-quality-gates="advisory"';
  return `role="img" lang="${esc(resolveLocale(meta.locale))}" aria-labelledby="archify-diagram-title archify-diagram-description"${animation}${preset}${effects}${engineeringProfile} data-quality-profile="${esc(qualityProfile)}"${advisory}`;
}

// Keep the accessible name inside the SVG so it survives standalone SVG
// export and embedding. The fixed IDs are deterministic because an Archify
// artifact intentionally contains one primary diagram SVG.
export function svgAccessibleText(meta, kind) {
  const description = meta.subtitle || translateMessage(meta.locale, `diagram.description.${kind}`);
  return `        <title id="archify-diagram-title">${esc(meta.title)}</title>\n        <desc id="archify-diagram-description">${esc(description)}</desc>`;
}

export function animateAttr(meta, kind, step) {
  if (meta.animation !== 'trace') return '';
  // Ambient trace must finish inside the fixed six-second WebM capture. The
  // cap affects visual delay only; authored order and semantic identity stay
  // untouched in the JSON, DOM, Story, and relationship contracts.
  const safeStep = Number.isFinite(step) && step >= 0 ? Math.min(12, Math.floor(step)) : 0;
  return ` data-animate="${kind}" style="--step:${safeStep}"`;
}

// Stable semantic hooks for the standalone HTML explorer. IDs already pass
// the schema's conservative identifier pattern; escape again at the markup
// boundary so these helpers remain safe if that contract expands later.
export function focusNodeAttrs(id, label, metadata = {}, locale) {
  const optional = [
    ['data-node-kind', metadata.kind],
    ['data-node-sublabel', metadata.sublabel],
    ['data-node-tag', metadata.tag],
    ['data-node-context', metadata.context],
    ['data-node-brand', metadata.brand],
    ['data-node-brand-id', metadata.brandId],
    ['data-node-brand-status', metadata.brandStatus],
    ['data-node-brand-source', metadata.brandSource],
    // Generic, optional: a JSON-serialized array of {title, items[]} groups a
    // renderer wants the Semantic Passport to reveal on focus, beyond the
    // fixed kind/sublabel/tag/context/brand slots above. No renderer other
    // than Funnel (Phase 11) currently sets this, so existing output is
    // unaffected unless a caller passes it.
    ['data-node-detail-groups', metadata.detailGroups],
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([name, value]) => ` ${name}="${esc(String(value))}"`)
    .join('');
  const detail = [metadata.sublabel, metadata.context, metadata.brand]
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
    .join(', ');
  const aria = detail
    ? translateMessage(locale, 'node.focus.detail', { label, detail })
    : translateMessage(locale, 'node.focus', { label });
  return `id="node-${esc(id)}" data-node-id="${esc(id)}" data-node-label="${esc(label)}" tabindex="0" role="button" aria-label="${esc(aria)}" aria-pressed="false"${optional}`;
}

// Native SVG titles preserve a compact details-on-demand fallback when the
// canonical SVG is embedded inline outside the full Archify viewer.
export function focusNodeTitle(label, metadata = {}) {
  const parts = [label, metadata.sublabel, metadata.context, metadata.tag, metadata.brand]
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '');
  return `<title>${esc(parts.join(' · '))}</title>`;
}

export function focusEdgeAttrs(from, to, label, key, id) {
  const named = label ? ` data-edge-label="${esc(label)}"` : '';
  const keyed = key !== undefined && key !== null ? ` data-edge-key="${esc(String(key))}"` : '';
  const identified = id !== undefined && id !== null && String(id).trim() !== ''
    ? ` data-edge-id="${esc(String(id))}"`
    : '';
  return `data-edge-from="${esc(from)}" data-edge-to="${esc(to)}"${named}${keyed}${identified}`;
}
