import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluatePlaywrightDurationBudgets,
  evaluatePlaywrightGuardrails,
  formatDuration,
  renderPlaywrightSummaryMarkdown,
  summarizePlaywrightReport,
} from '../scripts/playwright-report-summary.mjs';

function reportWithTests(tests) {
  return {
    suites: [
      {
        title: 'root',
        specs: [
          {
            title: 'journeys',
            tests,
          },
        ],
        suites: [],
      },
    ],
  };
}

function result(status, duration) {
  return { status, duration };
}

function durationBudgetConfig(projects, warningRatio = 0.75) {
  return {
    schemaVersion: 1,
    warningRatio,
    projects,
  };
}

test('summarizePlaywrightReport groups projects and preserves flaky retries', () => {
  const summary = summarizePlaywrightReport(reportWithTests([
    {
      projectName: 'chromium-desktop',
      status: 'expected',
      results: [result('passed', 1000)],
    },
    {
      projectName: 'chromium-mobile',
      status: 'flaky',
      results: [result('failed', 400), result('passed', 600)],
    },
    {
      projectName: 'cross-chromium',
      status: 'unexpected',
      results: [result('timedOut', 30000)],
    },
    {
      projectName: 'cross-firefox',
      status: 'skipped',
      results: [result('skipped', 0)],
    },
    {
      projectName: 'cross-webkit',
      status: 'expected',
      results: [result('passed', 1200)],
    },
    {
      projectName: 'webkit-iphone-se',
      status: 'expected',
      results: [result('passed', 1800)],
    },
    {
      projectName: 'webkit-iphone-13',
      status: 'expected',
      results: [result('passed', 2000)],
    },
  ]));

  assert.deepEqual(summary.total, {
    passed: 4,
    flaky: 1,
    failed: 1,
    skipped: 1,
    total: 7,
    durationMs: 37000,
  });

  const chromium = summary.groups.find((group) => group.id === 'chromium');
  assert.deepEqual({
    passed: chromium.passed,
    flaky: chromium.flaky,
    failed: chromium.failed,
    total: chromium.total,
    durationMs: chromium.durationMs,
    missingProjects: chromium.missingProjects,
  }, {
    passed: 1,
    flaky: 1,
    failed: 1,
    total: 3,
    durationMs: 32000,
    missingProjects: [],
  });

  assert.deepEqual(summary.projectTimings.find((timing) => (
    timing.projectName === 'chromium-mobile'
  )), {
    projectName: 'chromium-mobile',
    tests: 1,
    durationMs: 1000,
    averageTestDurationMs: 1000,
    maxTestDurationMs: 1000,
  });
  assert.deepEqual(summary.projectTimings.find((timing) => (
    timing.projectName === 'cross-firefox'
  )), {
    projectName: 'cross-firefox',
    tests: 0,
    durationMs: 0,
    averageTestDurationMs: 0,
    maxTestDurationMs: 0,
  });
  assert.deepEqual(summary.missingProjects, []);
  assert.deepEqual(summary.unknownProjects, []);
  assert.deepEqual(summary.unexpectedProjects, []);
});

test('summarizePlaywrightReport reports missing and unmapped projects', () => {
  const summary = summarizePlaywrightReport(reportWithTests([
    {
      projectName: 'chromium-desktop',
      results: [result('passed', 250)],
    },
    {
      projectName: 'future-browser',
      results: [result('failed', 500), result('passed', 300)],
    },
  ]));

  const chromium = summary.groups.find((group) => group.id === 'chromium');
  const other = summary.groups.find((group) => group.id === 'other');

  assert.deepEqual(chromium.missingProjects, ['chromium-mobile', 'cross-chromium']);
  assert.equal(other.flaky, 1, 'fallback classification detects pass after a failed retry');
  assert.deepEqual(summary.unknownProjects, ['future-browser']);
  assert.ok(summary.missingProjects.includes('cross-firefox'));
  assert.ok(summary.missingProjects.includes('webkit-iphone-13'));
});

test('summarizePlaywrightReport supports a nightly subset without false missing projects', () => {
  const expectedProjects = [
    'chromium-desktop',
    'cross-firefox',
    'cross-webkit',
    'webkit-iphone-13',
  ];
  const summary = summarizePlaywrightReport(reportWithTests(expectedProjects.map((projectName) => ({
    projectName,
    status: 'expected',
    results: [result('passed', 100)],
  }))), { expectedProjects });

  assert.deepEqual(summary.expectedProjects, expectedProjects);
  assert.deepEqual(summary.missingProjects, []);
  assert.deepEqual(summary.unexpectedProjects, []);
  assert.equal(summary.groups.length, 4);
  assert.deepEqual(
    summary.groups.map((group) => group.projects),
    [
      ['chromium-desktop'],
      ['cross-firefox'],
      ['cross-webkit'],
      ['webkit-iphone-13'],
    ],
  );
});

test('summarizePlaywrightReport rejects unknown expected projects', () => {
  assert.throws(
    () => summarizePlaywrightReport(reportWithTests([]), {
      expectedProjects: ['future-browser'],
    }),
    /Unknown expected Playwright projects/,
  );
});

test('evaluatePlaywrightDurationBudgets passes below warning threshold', () => {
  const summary = summarizePlaywrightReport(reportWithTests([
    {
      projectName: 'chromium-desktop',
      status: 'expected',
      results: [result('passed', 1000)],
    },
    {
      projectName: 'chromium-desktop',
      status: 'expected',
      results: [result('passed', 1500)],
    },
  ]), { expectedProjects: ['chromium-desktop'] });
  const performance = evaluatePlaywrightDurationBudgets(summary, durationBudgetConfig({
    'chromium-desktop': {
      maxAverageTestDurationMs: 4000,
      maxSingleTestDurationMs: 5000,
    },
  }));

  assert.equal(performance.status, 'passed');
  assert.equal(performance.passed, true);
  assert.equal(performance.projects[0].averageTestDurationMs, 1250);
  assert.equal(performance.projects[0].maxTestDurationMs, 1500);
  assert.equal(performance.maxUtilizationRatio, 0.3125);
  assert.deepEqual(performance.warnings, []);
  assert.deepEqual(performance.violations, []);
});

test('evaluatePlaywrightDurationBudgets warns near a hard limit without failing', () => {
  const summary = summarizePlaywrightReport(reportWithTests([
    {
      projectName: 'cross-webkit',
      status: 'expected',
      results: [result('passed', 16000)],
    },
  ]), { expectedProjects: ['cross-webkit'] });
  const performance = evaluatePlaywrightDurationBudgets(summary, durationBudgetConfig({
    'cross-webkit': {
      maxAverageTestDurationMs: 20000,
      maxSingleTestDurationMs: 25000,
    },
  }));
  const guardrails = evaluatePlaywrightGuardrails(summary, {
    maxFailed: 0,
    maxFlaky: 0,
    durationBudgets: performance,
  });

  assert.equal(performance.status, 'warning');
  assert.equal(performance.passed, true);
  assert.ok(performance.warnings.some((warning) => warning.includes('80.0%')));
  assert.equal(guardrails.passed, true, 'warnings remain non-blocking');
});

test('evaluatePlaywrightDurationBudgets fails average and single-test regressions', () => {
  const summary = summarizePlaywrightReport(reportWithTests([
    {
      projectName: 'cross-firefox',
      status: 'expected',
      results: [result('passed', 9000)],
    },
    {
      projectName: 'cross-firefox',
      status: 'expected',
      results: [result('passed', 17000)],
    },
  ]), { expectedProjects: ['cross-firefox'] });
  const performance = evaluatePlaywrightDurationBudgets(summary, durationBudgetConfig({
    'cross-firefox': {
      maxAverageTestDurationMs: 8000,
      maxSingleTestDurationMs: 15000,
    },
  }));
  const guardrails = evaluatePlaywrightGuardrails(summary, {
    maxFailed: 0,
    maxFlaky: 0,
    durationBudgets: performance,
  });

  assert.equal(performance.status, 'failed');
  assert.equal(performance.passed, false);
  assert.equal(performance.violations.length, 2);
  assert.ok(performance.violations.some((violation) => violation.includes('average test duration')));
  assert.ok(performance.violations.some((violation) => violation.includes('slowest test')));
  assert.equal(guardrails.passed, false);
  assert.ok(guardrails.violations.some((violation) => violation.includes('cross-firefox')));
});

test('evaluatePlaywrightDurationBudgets reports a missing expected-project budget', () => {
  const summary = summarizePlaywrightReport(reportWithTests([
    {
      projectName: 'chromium-desktop',
      status: 'expected',
      results: [result('passed', 1000)],
    },
  ]), { expectedProjects: ['chromium-desktop'] });
  const performance = evaluatePlaywrightDurationBudgets(summary, durationBudgetConfig({}));

  assert.equal(performance.status, 'failed');
  assert.equal(performance.projects[0].status, 'missing-budget');
  assert.deepEqual(performance.violations, ['missing duration budget for chromium-desktop']);
});

test('evaluatePlaywrightDurationBudgets rejects unknown projects and invalid warning ratios', () => {
  const summary = summarizePlaywrightReport(reportWithTests([]), {
    expectedProjects: ['chromium-desktop'],
  });

  assert.throws(
    () => evaluatePlaywrightDurationBudgets(summary, durationBudgetConfig({
      'future-browser': {
        maxAverageTestDurationMs: 1000,
        maxSingleTestDurationMs: 2000,
      },
    })),
    /Unknown Playwright duration budget project/,
  );
  assert.throws(
    () => evaluatePlaywrightDurationBudgets(summary, durationBudgetConfig({
      'chromium-desktop': {
        maxAverageTestDurationMs: 1000,
        maxSingleTestDurationMs: 2000,
      },
    }, 1)),
    /warning ratio/,
  );
});

test('evaluatePlaywrightGuardrails rejects flaky, missing, unmapped and unexpected projects', () => {
  const summary = summarizePlaywrightReport(reportWithTests([
    {
      projectName: 'chromium-desktop',
      status: 'flaky',
      results: [result('failed', 100), result('passed', 100)],
    },
    {
      projectName: 'chromium-mobile',
      status: 'expected',
      results: [result('passed', 100)],
    },
    {
      projectName: 'future-browser',
      status: 'expected',
      results: [result('passed', 100)],
    },
  ]), { expectedProjects: ['chromium-desktop', 'cross-firefox'] });

  const guardrails = evaluatePlaywrightGuardrails(summary, {
    maxFailed: 0,
    maxFlaky: 0,
    requireComplete: true,
    forbidUnmapped: true,
    forbidUnexpected: true,
  });

  assert.equal(guardrails.passed, false);
  assert.ok(guardrails.violations.some((violation) => violation.includes('flaky tests 1')));
  assert.ok(guardrails.violations.some((violation) => violation.includes('missing projects: cross-firefox')));
  assert.ok(guardrails.violations.some((violation) => violation.includes('unmapped projects: future-browser')));
  assert.ok(guardrails.violations.some((violation) => violation.includes('unexpected projects: chromium-mobile')));
});

test('evaluatePlaywrightGuardrails accepts an explicit flaky allowance', () => {
  const summary = summarizePlaywrightReport(reportWithTests([
    {
      projectName: 'chromium-desktop',
      status: 'flaky',
      results: [result('failed', 100), result('passed', 100)],
    },
  ]), { expectedProjects: ['chromium-desktop'] });

  const guardrails = evaluatePlaywrightGuardrails(summary, {
    maxFailed: 0,
    maxFlaky: 1,
    requireComplete: true,
    forbidUnmapped: true,
  });

  assert.equal(guardrails.passed, true);
  assert.deepEqual(guardrails.violations, []);
});

test('renderPlaywrightSummaryMarkdown includes totals and incomplete warnings', () => {
  const summary = summarizePlaywrightReport(reportWithTests([
    {
      projectName: 'chromium-desktop',
      status: 'expected',
      results: [result('passed', 61000)],
    },
  ]));

  const markdown = renderPlaywrightSummaryMarkdown(summary, { sha: '1234567890abcdef' });

  assert.match(markdown, /Browser E2E summary/);
  assert.match(markdown, /Commit: `1234567890ab`/);
  assert.match(markdown, /1m 1\.0s/);
  assert.match(markdown, /⚠️ Incomplete/);
  assert.match(markdown, /Missing projects:/);
  assert.match(markdown, /unified Playwright artifact/);
});

test('renderPlaywrightSummaryMarkdown includes duration budget status and table', () => {
  const summary = summarizePlaywrightReport(reportWithTests([
    {
      projectName: 'chromium-desktop',
      status: 'expected',
      results: [result('passed', 8000)],
    },
  ]), { expectedProjects: ['chromium-desktop'] });
  const performance = evaluatePlaywrightDurationBudgets(summary, durationBudgetConfig({
    'chromium-desktop': {
      maxAverageTestDurationMs: 10000,
      maxSingleTestDurationMs: 12000,
    },
  }));
  const guardrails = evaluatePlaywrightGuardrails(summary, {
    maxFailed: 0,
    maxFlaky: 0,
    durationBudgets: performance,
  });
  const markdown = renderPlaywrightSummaryMarkdown(summary, {
    durationBudgets: performance,
    guardrails,
  });

  assert.match(markdown, /E2E duration budgets/);
  assert.match(markdown, /Warning threshold: \*\*75\.0%\*\*/);
  assert.match(markdown, /chromium-desktop \| 1 \| 8\.0s \| 10\.0s/);
  assert.match(markdown, /⚠️ Warning/);
  assert.match(markdown, /Duration budgets: \*\*warning\*\*/);
});

test('renderPlaywrightSummaryMarkdown includes strict guardrail status', () => {
  const summary = summarizePlaywrightReport(reportWithTests([
    {
      projectName: 'chromium-desktop',
      status: 'flaky',
      results: [result('failed', 100), result('passed', 100)],
    },
  ]), { expectedProjects: ['chromium-desktop'] });
  const guardrails = evaluatePlaywrightGuardrails(summary, {
    maxFailed: 0,
    maxFlaky: 0,
    requireComplete: true,
    forbidUnmapped: true,
  });

  const markdown = renderPlaywrightSummaryMarkdown(summary, {
    title: 'Nightly E2E reliability summary',
    note: 'Repeated journey run.',
    guardrails,
  });

  assert.match(markdown, /Nightly E2E reliability summary/);
  assert.match(markdown, /Repeated journey run/);
  assert.match(markdown, /Reliability guardrails/);
  assert.match(markdown, /Status: ❌ Failed/);
  assert.match(markdown, /Flaky tests: \*\*1\*\*; limit: \*\*0\*\*/);
});

test('formatDuration handles seconds, minutes and invalid input', () => {
  assert.equal(formatDuration(950), '0.9s');
  assert.equal(formatDuration(61250), '1m 1.3s');
  assert.equal(formatDuration(Number.NaN), '0.0s');
});

test('summarizePlaywrightReport rejects malformed input', () => {
  assert.throws(
    () => summarizePlaywrightReport({}),
    /must contain a suites array/,
  );
});
