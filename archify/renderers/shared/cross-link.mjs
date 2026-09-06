// Phase 16 (Workstream D): Cross-Link is a separate relationship artifact —
// schemas/cross-link.schema.json — never embedded in a Funnel or
// Architecture document, and neither of those documents ever references it
// back. Everything here is a pure function over already-loaded documents:
// no filesystem access, no rendering, so both the forward (Funnel Stage ->
// Architecture component) and reverse (Architecture component -> Funnel
// Stage) directions can be tested identically to how validateFunnelReferences
// and architecture-projection.mjs are already tested in this repository.
//
// A Cross-Link document is meaningless without the Funnel/Architecture
// documents it names, but that dependency runs one way: Funnel and
// Architecture rendering never requires a Cross-Link document to exist, and
// never fails because one is absent (Task 20's "resolution strategy" and
// the "independently valid" requirement).

import { projectArchitecture } from '../../projection/architecture-projection.mjs';

export function findDuplicateLinkIds(crossLink) {
  const seen = new Set();
  const problems = [];
  (crossLink.links || []).forEach((link, index) => {
    if (seen.has(link.id)) {
      problems.push(`/links/${index}/id duplicates link id ${JSON.stringify(link.id)}`);
    }
    seen.add(link.id);
  });
  return problems;
}

// `funnelDocuments`/`architectureDocuments` are plain objects keyed by the
// exact string a link's `funnel.document`/`architecture.document` names —
// the caller decides what that string means (a file path, a logical name);
// this function never touches the filesystem itself.
export function validateCrossLinkReferences(crossLink, { funnelDocuments = {}, architectureDocuments = {} } = {}) {
  const problems = [...findDuplicateLinkIds(crossLink)];

  (crossLink.links || []).forEach((link, index) => {
    const funnelDoc = funnelDocuments[link.funnel.document];
    if (!funnelDoc) {
      problems.push(`/links/${index}/funnel/document references unknown Funnel document ${JSON.stringify(link.funnel.document)}`);
    } else if (!(funnelDoc.stages || []).some((stage) => stage.id === link.funnel.stageId)) {
      problems.push(`/links/${index}/funnel/stageId references unknown Stage id ${JSON.stringify(link.funnel.stageId)} in ${JSON.stringify(link.funnel.document)}`);
    }

    const architectureDoc = architectureDocuments[link.architecture.document];
    if (!architectureDoc) {
      problems.push(`/links/${index}/architecture/document references unknown Architecture document ${JSON.stringify(link.architecture.document)}`);
      return;
    }
    const projection = projectArchitecture(architectureDoc, link.architecture.level);
    const visible = projection.ok
      && (projection.document.components || []).some((component) => component.id === link.architecture.componentId);
    if (!visible) {
      problems.push(
        `/links/${index}/architecture/componentId references component id ${JSON.stringify(link.architecture.componentId)} `
        + `not present at level ${JSON.stringify(link.architecture.level)} in ${JSON.stringify(link.architecture.document)}`,
      );
    }
  });

  return problems;
}

// Forward: what does this Stage connect to? A Stage may legitimately have
// zero, one, or several links (Task 18: many-to-many is not over-constrained).
export function linksForStage(crossLink, funnelDocumentName, stageId) {
  return (crossLink.links || []).filter(
    (link) => link.funnel.document === funnelDocumentName && link.funnel.stageId === stageId,
  );
}

// Reverse: what customer journeys does this Architecture component support?
// An Architecture component may equally support several journeys/Stages.
export function linksForComponent(crossLink, architectureDocumentName, componentId, level) {
  return (crossLink.links || []).filter((link) => (
    link.architecture.document === architectureDocumentName
    && link.architecture.componentId === componentId
    && (level === undefined || link.architecture.level === level)
  ));
}

// The only href shape Cross-Link navigation ever produces or accepts: a
// relative local .html file with an optional #focus=<id> fragment reusing
// the viewer's existing deep-link convention (assets/template.html already
// parses location.hash for `focus` on load). No scheme, no host, no query
// string, no javascript:/data: URL can ever match this — Task 44's
// "must not become arbitrary executable URLs" guarantee, enforced once,
// here, rather than trusted to every caller.
const SAFE_HREF_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_\-./]*\.html(#focus=[A-Za-z0-9_-]+)?$/;

export function safeCrossLinkHref(href) {
  return typeof href === 'string' && SAFE_HREF_PATTERN.test(href) ? href : null;
}

function outputBasename(documentName, doc) {
  const authored = doc && doc.meta && typeof doc.meta.output === 'string' ? doc.meta.output : null;
  const source = authored || documentName;
  const base = source.split('/').pop().replace(/\.json$/, '.html');
  return base.endsWith('.html') ? base : `${base}.html`;
}

// Resolves the forward href a Funnel Stage's Passport can link to: the
// referenced Architecture document's own rendered output filename (falling
// back to its source filename), plus a #focus= fragment for the specific
// component — reusing the viewer's existing deep-link mechanism instead of
// building a new navigation system.
export function resolveArchitectureHref(link, architectureDocuments) {
  const doc = architectureDocuments[link.architecture.document];
  const href = `${outputBasename(link.architecture.document, doc)}#focus=${encodeURIComponent(link.architecture.componentId)}`;
  return safeCrossLinkHref(href);
}

// The reverse of resolveArchitectureHref, for an Architecture component's
// own Passport to link back to the Funnel Stage(s) it supports.
export function resolveFunnelHref(link, funnelDocuments) {
  const doc = funnelDocuments[link.funnel.document];
  const href = `${outputBasename(link.funnel.document, doc)}#focus=${encodeURIComponent(link.funnel.stageId)}`;
  return safeCrossLinkHref(href);
}
