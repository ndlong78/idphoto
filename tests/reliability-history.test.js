import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RELIABILITY_INCIDENT_MARKER,
  buildReliabilityIncidentPlan,
  calculateReliabilityTrend,
  createReliabilityEntry,
  mergeReliabilityHistory,
  renderReliabilityIncidentBody,
  renderReliabilityTrendMarkdown,
} from '../scripts/reliability-history.mjs';

function compactSummary(overrides = {}) {
  return {
    total: {
      passed: 40,
      flaky: 0,
      failed: 0,
      skipped: 0,
      total: 40,
      durationMs: 120_000,
      ...overrides.total,
    },
    missingProjects: overrides.missingProjects ?? [],
    unknownProjects: overrides.unknownProjects ?? [],
    unexpectedProjects: overrides.unexpectedProjects ?? [],
    guardrails: {
      passed: overrides.guardrailsPassed ?? true,
      violations: overrides.violations ?? [],
    },
  };
}

function context(runId, overrides = {}) {
  return {
    runId: String(runId),
    runAttempt: overrides.runAttempt ?? 1,
    runNumber: overrides.runNumber ?? Number(runId),
    eventName: overrides.eventName ?? 'schedule',
    branch: 'main',
    sha: overrides.sha ?? 'abcdef1234567890',
    recordedAt: overrides.recordedAt ?? `2026-08-${String(runId).padStart(2, '0')}T18:17:00Z`,
    repository: 'ndlong78/idphoto',
    serverUrl: 'https://github.com',
    repeatEach: overrides.repeatEach ?? 5,
    expectedProjects: [
      'chromium-desktop',
      'cross-firefox',
      'cross-webkit',
      'webkit-iphone-13',
    ],
    ...overrides,
  };
}

test('createReliabilityEntry records a clean scheduled run', () => {
  const entry = createReliabilityEntry(compactSummary(), context(5));

  assert.equal(entry.status, 'passed');
  assert.equal(entry.guardrailsPassed, true);
  assert.equal(entry.total.passed, 40);
  assert.equal(entry.repeatEach, 5);
  assert.equal(entry.runUrl, 'https://github.com/ndlong78/idphoto/actions/runs/5');
  assert.deepEqual(entry.violations, []);
});

test('createReliabilityEntry distinguishes failed tests from incomplete reports', () => {
  const failed = createReliabilityEntry(compactSummary({
    total: { passed: 39, failed: 1, total: 40 },
    guardrailsPassed: false,
    violations: ['failed tests 1 exceed limit 0'],
  }), context(6));
  const incomplete = createReliabilityEntry(compactSummary({
    total: { passed: 30, total: 30 },
    missingProjects: ['cross-webkit'],
    guardrailsPassed: false,
  }), context(7));

  assert.equal(failed.status, 'failed');
  assert.ok(failed.violations.some((violation) => violation.includes('1 failed test')));
  assert.equal(incomplete.status, 'incomplete');
  assert.deepEqual(incomplete.missingProjects, ['cross-webkit']);
});

test('createReliabilityEntry creates an infrastructure fallback when compact JSON is missing', () => {
  const entry = createReliabilityEntry(null, context(8, {
    jobResult: 'failure',
  }));

  assert.equal(entry.status, 'incomplete');
  assert.equal(entry.guardrailsPassed, false);
  assert.equal(entry.missingProjects.length, 4);
  assert.match(entry.violations[0], /merge job result: failure/);
});

test('mergeReliabilityHistory deduplicates reruns and trims the configured window', () => {
  const previousEntries = Array.from({ length: 5 }, (_, index) => createReliabilityEntry(
    compactSummary(),
    context(5 - index),
  ));
  const current = createReliabilityEntry(compactSummary({
    total: { passed: 41, total: 41 },
  }), context(5));

  const history = mergeReliabilityHistory({ entries: previousEntries }, current, {
    maxEntries: 3,
  });

  assert.equal(history.entries.length, 3);
  assert.deepEqual(history.entries.map((entry) => entry.runId), ['5', '4', '3']);
  assert.equal(history.entries[0].total.passed, 41, 'current rerun replaces the older snapshot');
});

test('calculateReliabilityTrend computes pass rate and current streak', () => {
  const entries = [
    createReliabilityEntry(compactSummary(), context(10)),
    createReliabilityEntry(compactSummary(), context(9)),
    createReliabilityEntry(compactSummary({
      total: { passed: 39, flaky: 1, total: 40 },
      guardrailsPassed: false,
    }), context(8)),
    createReliabilityEntry(compactSummary(), context(7)),
  ];
  const trend = calculateReliabilityTrend({ entries }, { windowSize: 4 });

  assert.deepEqual(trend.counts, {
    passed: 3,
    failed: 1,
    incomplete: 0,
    total: 4,
  });
  assert.equal(trend.passRate, 0.75);
  assert.equal(trend.currentStatus, 'passed');
  assert.equal(trend.currentStreak, 2);
  assert.equal(trend.flakyRuns, 1);
});

test('renderReliabilityTrendMarkdown links runs and shows aggregate status', () => {
  const history = mergeReliabilityHistory(null, createReliabilityEntry(
    compactSummary(),
    context(11, { runNumber: 91 }),
  ));
  const markdown = renderReliabilityTrendMarkdown(history);

  assert.match(markdown, /Nightly E2E reliability trend/);
  assert.match(markdown, /\[#91\]\(https:\/\/github\.com\/ndlong78\/idphoto\/actions\/runs\/11\)/);
  assert.match(markdown, /Pass rate: \*\*100\.0%\*\*/);
  assert.match(markdown, /40 \| 0 \| 0 \| 0 \| 2m 0\.0s \| 5×/);
});

test('buildReliabilityIncidentPlan opens on failure, resolves on recovery and ignores manual runs', () => {
  const failedHistory = mergeReliabilityHistory(null, createReliabilityEntry(
    compactSummary({
      total: { passed: 39, flaky: 1, total: 40 },
      guardrailsPassed: false,
    }),
    context(12),
  ));
  const passedHistory = mergeReliabilityHistory(failedHistory, createReliabilityEntry(
    compactSummary(),
    context(13),
  ));

  const openPlan = buildReliabilityIncidentPlan(failedHistory, { manageIncident: true });
  const resolvePlan = buildReliabilityIncidentPlan(passedHistory, { manageIncident: true });
  const manualPlan = buildReliabilityIncidentPlan(failedHistory, { manageIncident: false });

  assert.equal(openPlan.action, 'open-or-update');
  assert.match(openPlan.comment, /1.*flaky/i);
  assert.equal(resolvePlan.action, 'resolve');
  assert.match(resolvePlan.comment, /recovered/i);
  assert.equal(manualPlan.action, 'none');
});

test('renderReliabilityIncidentBody contains stable markers, violations and recent trend', () => {
  const history = mergeReliabilityHistory(null, createReliabilityEntry(
    compactSummary({
      total: { passed: 39, failed: 1, total: 40 },
      guardrailsPassed: false,
      violations: ['failed tests 1 exceed limit 0'],
    }),
    context(14),
  ));
  const body = renderReliabilityIncidentBody(history);

  assert.ok(body.startsWith(RELIABILITY_INCIDENT_MARKER));
  assert.match(body, /idphoto-e2e-reliability-run:14:1/);
  assert.match(body, /failed tests 1 exceed limit 0/);
  assert.match(body, /Recent nightly trend/);
  assert.match(body, /managed automatically/);
});
