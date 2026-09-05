// Standalone, informational architecture review. This module is independent
// of schema validation (renderers/shared/validator.mjs) and of the
// validate/deliver pipeline (bin/archify.mjs): a finding here can never fail
// validation or block delivery. It reads the same IR those paths read, but
// only to produce advisory findings about the new enterprise `kind` taxonomy.
//
// Rules are plain objects in a registry (RULES) so additional rules can be
// added later without changing the CLI wiring in bin/archify.mjs.

// Expected `type` (the existing legacy componentType) for each pilot `kind`.
// This is informational guidance only, not a validation constraint: an
// author is free to pair `kind` with any `type` the schema allows, and doing
// so never fails validate/deliver. See archify/schemas/README.md for the
// coexistence contract this rule documents.
const EXPECTED_COMPONENT_TYPE = {
  queue: 'messagebus',
  cache: 'database',
  'identity-provider': 'security',
};

function componentSubject(component, index) {
  return {
    collection: 'components',
    index,
    ...(component?.id ? { id: component.id } : {}),
  };
}

const kindComponentTypeAlignment = {
  id: 'kind-componenttype-alignment',
  description:
    'Reports whether a component\'s enterprise `kind` is paired with its conventionally associated legacy `componentType`.',
  evaluate(diagram) {
    const components = Array.isArray(diagram?.components) ? diagram.components : [];
    const findings = [];
    components.forEach((component, index) => {
      const kind = component?.kind;
      if (!kind || !(kind in EXPECTED_COMPONENT_TYPE)) return;
      const expectedType = EXPECTED_COMPONENT_TYPE[kind];
      const subject = componentSubject(component, index);
      if (component.type === expectedType) {
        findings.push({
          rule: kindComponentTypeAlignment.id,
          status: 'pass',
          message: `Component ${JSON.stringify(component.id ?? index)} has kind "${kind}" paired with the expected componentType "${expectedType}".`,
          subject,
        });
      } else {
        findings.push({
          rule: kindComponentTypeAlignment.id,
          status: 'warning',
          message: `Component ${JSON.stringify(component.id ?? index)} has kind "${kind}" but componentType ${JSON.stringify(component.type)} (conventionally "${expectedType}").`,
          subject,
        });
      }
    });
    return findings;
  },
};

export const RULES = [kindComponentTypeAlignment];

export function runArchitectureReview(diagram) {
  const findings = RULES.flatMap((rule) => rule.evaluate(diagram));
  const summary = findings.reduce(
    (totals, finding) => {
      totals[finding.status] = (totals[finding.status] || 0) + 1;
      return totals;
    },
    { pass: 0, warning: 0, fail: 0 },
  );
  return { findings, summary };
}
