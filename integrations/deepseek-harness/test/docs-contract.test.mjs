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

test('README docs cover install, invoke, uninstall, community wording, and Produced Files', () => {
  // README_EN.md/README_ZH.md were deliberately removed; README.md is the
  // single canonical, English-only README.
  const english = [read('README.md'), read('integrations/deepseek-harness/README.md')].join('\n');

  for (const source of [english, read('README.md')]) {
    assert.match(source, /@tt-a1i\/archify-dsh@0\.1\.0/);
    assert.match(source, /@deepseek-ai\/dsh@0\.1\.0-rc\.6/);
    assert.match(source.replaceAll('\\|', '|'), /\^22\.19\.0 \|\| >=24\.0\.0/);
    assert.match(source, /dsh plugin --profile web add @tt-a1i\/archify-dsh@0\.1\.0/);
    assert.match(source, /dsh plugin --profile web remove @tt-a1i\/archify-dsh/);
    assert.match(source, /Use the archify skill to map this repository's runtime architecture/);
    assert.doesNotMatch(source, /dsh plugin[^\n]*github:tt-a1i\/archify/);
    assert.doesNotMatch(source, /allowBuilds:\s*true/);
    assert.doesNotMatch(source, /npm install github:/);
  }

  assert.match(english, /community integration/i);
  assert.match(english, /developer-preview/i);
  assert.match(english, /not an official DeepSeek/i);
  assert.match(english, /Produced Files/i);
  assert.match(english, /exact workspace paths/);
  assert.match(english, /no telemetry/i);
});

test('Skills CLI, Cursor, Codex, Claude Code, OpenCode, and Raven remain the default main path', () => {
  const english = read('README.md');
  assert.match(english, /^```bash\nnpx skills add tt-a1i\/archify -g\n```$/m);
  assert.match(english, /## Quick start/);
  const dshEnglishIndex = english.indexOf('DeepSeek Harness');
  const quickStartIndex = english.indexOf('## Quick start');
  assert.ok(dshEnglishIndex > quickStartIndex, 'DSH docs must not precede the default quick start');
});
