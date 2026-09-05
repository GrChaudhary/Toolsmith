#!/usr/bin/env node

// Toolsmith is the primary CLI identity. This entry point carries no
// independent implementation: it forwards argv/stdio/exit-code to the real
// dispatcher in archify.mjs, which some existing tooling installs and copies
// as a single self-contained file. See NOTICE.md for the Toolsmith/Archify
// identity relationship.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const result = spawnSync(
  process.execPath,
  [path.join(__dirname, 'archify.mjs'), ...process.argv.slice(2)],
  { stdio: 'inherit' },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
