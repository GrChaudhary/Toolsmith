// Part 2 (Workstream A): the render-time integration point between
// render-architecture.mjs and Cross-Link — the exact mirror of
// renderers/funnel/cross-link-context.mjs's forward direction, reusing every
// pure function from renderers/shared/cross-link.mjs unchanged (no second
// implementation of lookup/validation/href-safety logic). This module is the
// ONLY place render-architecture.mjs knows Cross-Link exists.
//
// Cross-Link is entirely opt-in via an extra CLI flag (`--cross-link
// <path.json>`), never a positional argument, so every existing
// `node render-architecture.mjs input.json output.html` invocation —
// including every example, test, and golden fixture already checked in —
// renders byte-identically whether or not this flag is ever used. An
// Architecture document remains fully valid and renders completely on its
// own with no Cross-Link document present, exactly like the Funnel side.
import fs from 'node:fs';
import path from 'node:path';
import { validateSchema } from '../shared/validator.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { translateMessage } from '../shared/i18n.mjs';
import {
  linksForComponent,
  resolveFunnelHref,
  validateCrossLinkReferences,
} from '../shared/cross-link.mjs';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Returns a `crossLinkGroupFor(componentId)` function (never null, mirroring
// the Funnel side) that yields a generic {title, items:[{text, tag, href}]}
// group or `null` when a component has no links. When `--cross-link` was not
// passed, every call returns null: zero behavior change.
//
// A component may appear at both HLD and LLD in the links that name it — the
// level is not used to filter here (unlike the Funnel side's validation,
// which checks a specific level) because a single render-architecture.mjs
// invocation renders one flat document with no notion of "the current
// level"; `bin/archify.mjs project architecture <hld|lld>` produces that
// projected document as a separate, earlier step. Every link naming this
// component id therefore surfaces, tagged with the level it was authored
// against, so the reader can tell HLD- from LLD-authored relationships.
export function loadCrossLinkContext({ argv, inputPath, architecture, locale }) {
  const flagIndex = argv.indexOf('--cross-link');
  if (flagIndex === -1) return { crossLinkGroupFor: () => null };
  const crossLinkPath = argv[flagIndex + 1];
  if (!crossLinkPath) {
    throwDiagnosticProblems('Cross-Link loading failed', ['--cross-link requires a file path argument'], {
      code: 'cross-link/missing-argument',
      subject: {},
    });
  }

  const crossLinkAbsolutePath = path.resolve(crossLinkPath);
  const crossLinkDir = path.dirname(crossLinkAbsolutePath);
  const crossLink = readJson(crossLinkAbsolutePath);
  validateSchema('crossLink', crossLink);

  const architectureDocumentName = path.basename(inputPath);
  const relevantLinks = (crossLink.links || []).filter((link) => link.architecture.document === architectureDocumentName);

  const funnelDocuments = {};
  for (const link of relevantLinks) {
    const documentName = link.funnel.document;
    if (funnelDocuments[documentName]) continue;
    const funnelPath = path.resolve(crossLinkDir, documentName);
    if (!fs.existsSync(funnelPath)) continue; // surfaced below as a reference problem
    funnelDocuments[documentName] = readJson(funnelPath);
  }

  // The Architecture-side reference (componentId visible at level) is
  // checked against the document actually being rendered, not a re-read
  // copy — it is already loaded and already schema/reference-validated by
  // loadDiagramWithBrandMarks.
  const problems = validateCrossLinkReferences(
    { links: relevantLinks },
    { funnelDocuments, architectureDocuments: { [architectureDocumentName]: architecture } },
  );
  if (problems.length) {
    throwDiagnosticProblems('Cross-Link reference validation failed', problems, {
      code: 'cross-link/invalid-reference',
      subject: { crossLinkPath: crossLinkAbsolutePath },
    });
  }

  return {
    crossLinkGroupFor(componentId) {
      const links = linksForComponent({ links: relevantLinks }, architectureDocumentName, componentId);
      if (!links.length) return null;
      const items = links
        .map((link) => {
          const href = resolveFunnelHref(link, funnelDocuments);
          if (!href) return null;
          return { text: link.note || link.funnel.stageId, tag: link.architecture.level.toUpperCase(), href };
        })
        .filter(Boolean);
      if (!items.length) return null;
      return { title: translateMessage(locale, 'crosslink.detail.customerJourneys'), items };
    },
  };
}
