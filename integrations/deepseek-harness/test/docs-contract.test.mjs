import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('DSH 0.1.0 documentation keeps its released Skill snapshot immutable', () => {
  const integration = read('integrations/deepseek-harness/README.md');
  assert.match(integration, /Archify 2\.14 snapshot/);
  assert.match(integration, /archify-dsh-v0\.1\.0/);
  assert.match(integration, /update notifier[\s\S]*intentionally excluded/);
});

test('DSH integration docs cover install, invoke, uninstall, community wording, and Produced Files', () => {
  // README.md was deliberately reframed to describe this fork as its own
  // standalone repository and no longer advertises the tt-a1i-scoped DSH
  // package at all (see the root installation table) — that content now
  // lives solely in the DSH integration's own README.
  const integration = read('integrations/deepseek-harness/README.md');

  assert.match(integration, /@tt-a1i\/archify-dsh@0\.1\.0/);
  assert.match(integration, /@deepseek-ai\/dsh@0\.1\.0-rc\.6/);
  assert.match(integration.replaceAll('\\|', '|'), /\^22\.19\.0 \|\| >=24\.0\.0/);
  assert.match(integration, /dsh plugin --profile web add @tt-a1i\/archify-dsh@0\.1\.0/);
  assert.match(integration, /dsh plugin --profile web remove @tt-a1i\/archify-dsh/);
  assert.match(integration, /Use the archify skill to map this repository's runtime architecture/);
  assert.doesNotMatch(integration, /dsh plugin[^\n]*github:tt-a1i\/archify/);
  assert.doesNotMatch(integration, /allowBuilds:\s*true/);
  assert.doesNotMatch(integration, /npm install github:/);

  assert.match(integration, /community[\s\S]{0,20}integration/i);
  assert.match(integration, /developer-preview/i);
  assert.match(integration, /not\*{0,2} an official DeepSeek/i);
  assert.match(integration, /Produced Files/i);
  assert.match(integration, /exact workspace paths/);
  assert.match(integration, /no telemetry/i);
});

test('README documents the standalone clone install and keeps Quick start as the default main path', () => {
  // Cursor, Codex, Claude Code, and OpenCode installs are documented via the
  // "Installation options" table rather than a single npx command now that
  // the README describes cloning this fork directly.
  const english = read('README.md');
  assert.match(english, /^```bash\ngit clone https:\/\/github\.com\/GrChaudhary\/Toolsmith\.git\n```$/m);
  assert.match(english, /## Quick start/);
  assert.match(english, /## Installation options/);
  assert.doesNotMatch(english, /DeepSeek Harness/, 'the root README should no longer advertise the tt-a1i-scoped DSH package');
});
