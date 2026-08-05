import test from 'node:test';
import assert from 'node:assert/strict';

import {
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

  assert.deepEqual(summary.missingProjects, []);
  assert.deepEqual(summary.unknownProjects, []);
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
  assert.match(markdown, /playwright-report-unified/);
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
