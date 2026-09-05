# Notice

This file explains how the current product identity, "Toolsmith," relates to
the code this repository is built on. It is a plain-language provenance
note, not a license. It does not replace, modify, or supersede `LICENSE` or
`THIRD_PARTY_NOTICES.md`, and it grants no rights beyond what those files
already state.

## Identity

"Toolsmith" is the current active product identity for this skill and CLI.
It is presented under that name in `package.json`, `SKILL.md`, and the CLI's
own help and diagnostic output. The `archify` command name, and internal
technical identifiers described below, remain in place unchanged.

## Provenance

This repository was originally published as "Archify" by tt-a1i
(`https://github.com/tt-a1i/archify`), and Archify's own project metadata
(`SKILL.md`) states that it is itself based on
`Cocoon-AI/architecture-diagram-generator` (MIT, v1.0). Toolsmith is built
directly on that Archify codebase: most of the schema, rendering, validation,
and CLI logic in this repository originates from Archify and, through it,
potentially from the Cocoon-AI project it is based on.

Toolsmith-specific work in this repository consists of separately developed
additions and modifications layered on top of that foundation — for example,
the enterprise semantic metadata fields, the HLD/LLD projection module, and
the architecture review module. Where Toolsmith code has been added to a file
that already contained Archify-derived code, that file remains a mix of both;
adding to a file does not, by itself, change who holds copyright in the
pre-existing parts of it.

This notice does not attempt to state a precise, file-by-file division of
authorship between tt-a1i's Archify work and any earlier Cocoon-AI work. Where
that division cannot be established from this repository's own history, it is
left unresolved here rather than asserted.

## License and attribution

- The MIT copyright and permission notice in `LICENSE` applies to the
  inherited codebase and is preserved unchanged, including both copyright
  lines it already carries.
- Third-party assets (including bundled brand marks and their individual
  licenses) remain governed by `THIRD_PARTY_NOTICES.md` and by their own
  upstream licenses, exactly as recorded there.
- Nothing in the Toolsmith identity or in this notice implies that
  Toolsmith-specific additions carry a different license than the rest of the
  repository, and nothing here implies sole or original authorship of the
  inherited Archify/Cocoon-AI codebase.
