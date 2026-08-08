import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const [
  ciWorkflow,
  reliabilityWorkflow,
  playwrightConfig,
  durationBudgetConfig,
] = await Promise.all([
  readFile(`${repositoryRoot}.github/workflows/ci.yml`, 'utf8'),
  readFile(`${repositoryRoot}.github/workflows/e2e-reliability.yml`, 'utf8'),
  readFile(`${repositoryRoot}playwright.config.js`, 'utf8'),
  readFile(`${repositoryRoot}config/playwright-duration-budgets.json`, 'utf8')
    .then((content) => JSON.parse(content)),
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

test('pull-request and nightly workflows enforce reliability and duration guardrails', () => {
  for (const workflow of [ciWorkflow, reliabilityWorkflow]) {
    assert.match(workflow, /PLAYWRIGHT_DURATION_BUDGETS: config\/playwright-duration-budgets\.json/);
    assert.match(workflow, /--duration-budgets="\$PLAYWRIGHT_DURATION_BUDGETS"/);
    assert.match(workflow, /--fail-on-flaky-tests/);
    assert.match(workflow, /--max-failed=0/);
    assert.match(workflow, /--max-flaky=0/);
    assert.match(workflow, /--require-complete/);
    assert.match(workflow, /--forbid-unmapped/);
    assert.match(workflow, /--forbid-unexpected/);
  }
});

test('pull-request unified report does not run when browser matrix was skipped or cancelled', () => {
  assert.match(
    ciWorkflow,
    /merge-browser-reports:[\s\S]*if: \$\{\{ always\(\) && !cancelled\(\) && \(needs\.browser-e2e\.result == 'success' \|\| needs\.browser-e2e\.result == 'failure'\) \}\}/,
  );
});

test('duration budget config covers every Playwright project with safe headroom', () => {
  const expectedProjects = [
    'chromium-desktop',
    'chromium-mobile',
    'cross-chromium',
    'cross-firefox',
    'cross-webkit',
    'webkit-iphone-se',
    'webkit-iphone-13',
  ];

  assert.equal(durationBudgetConfig.schemaVersion, 1);
  assert.equal(durationBudgetConfig.warningRatio, 0.75);
  assert.deepEqual(Object.keys(durationBudgetConfig.projects), expectedProjects);

  for (const [projectName, budget] of Object.entries(durationBudgetConfig.projects)) {
    assert.ok(budget.baselineAverageTestDurationMs > 0, `${projectName} baseline must be positive`);
    assert.ok(
      budget.maxAverageTestDurationMs > budget.baselineAverageTestDurationMs,
      `${projectName} average budget must exceed the measured baseline`,
    );
    assert.ok(
      budget.maxSingleTestDurationMs > budget.maxAverageTestDurationMs,
      `${projectName} single-test budget must exceed the average budget`,
    );
    assert.ok(
      budget.maxSingleTestDurationMs < 30_000,
      `${projectName} single-test budget must remain below the Playwright timeout`,
    );
  }
});

test('Playwright retains retry evidence without increasing per-shard workers', () => {
  assert.match(playwrightConfig, /workers: isCi \? 1 : undefined/);
  assert.match(playwrightConfig, /retain-on-failure-and-retries/);
  assert.match(playwrightConfig, /trace: retainedEvidenceMode/);
  assert.match(playwrightConfig, /video: retainedEvidenceMode/);
  assert.match(playwrightConfig, /screenshot: 'only-on-failure'/);
});

test('observability job runs after failures with narrowly scoped write permissions', () => {
  assert.match(reliabilityWorkflow, /reliability-observability:\n\s+name: Reliability \/ Trend and incident/);
  assert.match(reliabilityWorkflow, /if: \$\{\{ always\(\) && !cancelled\(\) \}\}/);
  assert.match(reliabilityWorkflow, /needs: merge-reliability-reports/);
  assert.match(reliabilityWorkflow, /permissions:\n\s+actions: read\n\s+contents: read\n\s+issues: write/);
  assert.match(reliabilityWorkflow, /RELIABILITY_JOB_RESULT: \$\{\{ needs\.merge-reliability-reports\.result \}\}/);
});

test('scheduled history is persistent while manual runs remain isolated previews', () => {
  assert.match(reliabilityWorkflow, /RELIABILITY_HISTORY_MAX_ENTRIES: '30'/);
  assert.match(reliabilityWorkflow, /RELIABILITY_TREND_WINDOW: '14'/);
  assert.match(reliabilityWorkflow, /artifact\.name === 'playwright-reliability-history'/);
  assert.match(reliabilityWorkflow, /event: 'schedule'/);
  assert.match(reliabilityWorkflow, /playwright-reliability-history' \|\| 'playwright-reliability-history-manual'/);
  assert.match(reliabilityWorkflow, /retention-days: 90/);
  assert.match(reliabilityWorkflow, /github-token: \$\{\{ github\.token \}\}/);
  assert.match(reliabilityWorkflow, /run-id: \$\{\{ steps\.previous_history\.outputs\.result \}\}/);
});

test('incident automation uses Node 24 github-script and only runs for schedules', () => {
  assert.equal((reliabilityWorkflow.match(/actions\/github-script@v9/g) ?? []).length, 2);
  assert.match(reliabilityWorkflow, /Manage scheduled reliability incident issue\n\s+if: \$\{\{ github\.event_name == 'schedule' \}\}/);
  assert.match(reliabilityWorkflow, /Automated nightly browser reliability incident/);
  assert.match(reliabilityWorkflow, /state_reason: 'completed'/);
  assert.match(reliabilityWorkflow, /plan\.runMarker/);
});
