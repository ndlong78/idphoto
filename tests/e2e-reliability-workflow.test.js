import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const [ciWorkflow, reliabilityWorkflow, playwrightConfig] = await Promise.all([
  readFile(`${repositoryRoot}.github/workflows/ci.yml`, 'utf8'),
  readFile(`${repositoryRoot}.github/workflows/e2e-reliability.yml`, 'utf8'),
  readFile(`${repositoryRoot}playwright.config.js`, 'utf8'),
]);

test('reliability workflow schedules the nightly run and safe manual repeat choices', () => {
  assert.match(reliabilityWorkflow, /cron: '17 18 \* \* \*'/);
  assert.match(reliabilityWorkflow, /default: '5'/);
  assert.match(reliabilityWorkflow, /options:\n\s+- '3'\n\s+- '5'\n\s+- '10'/);
  assert.match(reliabilityWorkflow, /REPEAT_EACH: .*inputs\.repeat_each.*'5'/);
  assert.match(reliabilityWorkflow, /\^\(3\|5\|10\)\$/);
});

test('reliability matrix repeats exactly four representative projects', () => {
  const projects = [...reliabilityWorkflow.matchAll(/project: '--project=([^']+)'/g)]
    .map((match) => match[1]);
  assert.deepEqual(projects, [
    'chromium-desktop',
    'cross-firefox',
    'cross-webkit',
    'webkit-iphone-13',
  ]);

  assert.match(reliabilityWorkflow, /upload-export-journey\.desktop\.spec\.js/);
  assert.match(reliabilityWorkflow, /cross-browser-export\.cross\.spec\.js/);
  assert.match(reliabilityWorkflow, /iphone-webkit-upload-export\.iphone\.spec\.js/);
  assert.match(reliabilityWorkflow, /--repeat-each="\$REPEAT_EACH"/);
});

test('pull-request and nightly workflows enforce zero failed and zero flaky tests', () => {
  for (const workflow of [ciWorkflow, reliabilityWorkflow]) {
    assert.match(workflow, /--fail-on-flaky-tests/);
    assert.match(workflow, /--max-failed=0/);
    assert.match(workflow, /--max-flaky=0/);
    assert.match(workflow, /--require-complete/);
    assert.match(workflow, /--forbid-unmapped/);
    assert.match(workflow, /--forbid-unexpected/);
  }
});

test('Playwright retains retry evidence without increasing per-shard workers', () => {
  assert.match(playwrightConfig, /workers: isCi \? 1 : undefined/);
  assert.match(playwrightConfig, /retain-on-failure-and-retries/);
  assert.match(playwrightConfig, /trace: retainedEvidenceMode/);
  assert.match(playwrightConfig, /video: retainedEvidenceMode/);
  assert.match(playwrightConfig, /screenshot: 'only-on-failure'/);
});
