// Phase 16 (Workstream D): the render-time integration point between this
// renderer and Cross-Link. This module is the ONLY place render-funnel.mjs
// knows Cross-Link exists — everything else (schema, validation, forward/
// reverse lookup, href safety) lives in renderers/shared/cross-link.mjs,
// which knows nothing about SVG or Funnel rendering.
//
// Cross-Link is entirely opt-in via an extra CLI flag (`--cross-link
// <path.json>`), never a positional argument, so every existing
// `node render-funnel.mjs input.json output.html` invocation — including
// every example, test, and golden fixture already checked in — renders
// byte-identically whether or not this flag is ever used. A Funnel document
// remains fully valid and renders completely on its own with no Cross-Link
// document present (Task 20's independent-validity requirement).
import fs from 'node:fs';
import path from 'node:path';
import { validateSchema } from '../shared/validator.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { translateMessage } from '../shared/i18n.mjs';
import {
  linksForStage,
  resolveArchitectureHref,
  validateCrossLinkReferences,
} from '../shared/cross-link.mjs';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Returns a `crossLinkGroupFor(stageId)` function (never null — it always
// exists, so callers never branch on whether Cross-Link is active) that
// yields a generic {title, items:[{text, tag, href}]} group or `null` when
// a Stage has no links. When `--cross-link` was not passed, every call
// returns null: zero behavior change, exactly Phase 15's established
// opt-in-only-when-there-is-data pattern.
export function loadCrossLinkContext({ argv, inputPath, funnel, locale }) {
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

  const funnelDocumentName = path.basename(inputPath);
  const relevantLinks = (crossLink.links || []).filter((link) => link.funnel.document === funnelDocumentName);

  const architectureDocuments = {};
  for (const link of relevantLinks) {
    const documentName = link.architecture.document;
    if (architectureDocuments[documentName]) continue;
    const architecturePath = path.resolve(crossLinkDir, documentName);
    if (!fs.existsSync(architecturePath)) continue; // surfaced below as a reference problem
    architectureDocuments[documentName] = readJson(architecturePath);
  }

  // The Funnel-side reference (stageId exists) is checked against the
  // document actually being rendered, not a re-read copy — it is already
  // loaded and already schema/reference-validated by loadDiagram.
  const problems = validateCrossLinkReferences(
    { links: relevantLinks },
    { funnelDocuments: { [funnelDocumentName]: funnel }, architectureDocuments },
  );
  if (problems.length) {
    throwDiagnosticProblems('Cross-Link reference validation failed', problems, {
      code: 'cross-link/invalid-reference',
      subject: { crossLinkPath: crossLinkAbsolutePath },
    });
  }

  return {
    crossLinkGroupFor(stageId) {
      const links = linksForStage({ links: relevantLinks }, funnelDocumentName, stageId);
      if (!links.length) return null;
      const items = links
        .map((link) => {
          const href = resolveArchitectureHref(link, architectureDocuments);
          if (!href) return null;
          return { text: link.note || link.architecture.componentId, tag: link.architecture.level.toUpperCase(), href };
        })
        .filter(Boolean);
      if (!items.length) return null;
      return { title: translateMessage(locale, 'crosslink.detail.architecture'), items };
    },
  };
}
