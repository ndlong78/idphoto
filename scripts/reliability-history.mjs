import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RELIABILITY_HISTORY_SCHEMA_VERSION = 1;
export const RELIABILITY_INCIDENT_TITLE = '[E2E Reliability] Nightly browser reliability incident';
export const RELIABILITY_INCIDENT_LABEL = 'e2e-reliability';
export const RELIABILITY_INCIDENT_MARKER = '<!-- idphoto-e2e-reliability-incident -->';

const VALID_STATUSES = new Set(['passed', 'failed', 'incomplete']);

function toNonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => String(item).trim())
    .filter(Boolean))].sort();
}

function normalizeRecordedAt(value) {
  const date = value == null ? new Date() : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function normalizeTotal(total) {
  return {
    passed: toNonNegativeInteger(total?.passed),
    flaky: toNonNegativeInteger(total?.flaky),
    failed: toNonNegativeInteger(total?.failed),
    skipped: toNonNegativeInteger(total?.skipped),
    total: toNonNegativeInteger(total?.total),
    durationMs: toNonNegativeInteger(total?.durationMs),
  };
}

function synthesizeViolations(summary, status, sourceError) {
  const violations = normalizeStringArray(summary?.guardrails?.violations);
  const total = normalizeTotal(summary?.total);
  const missingProjects = normalizeStringArray(summary?.missingProjects);
  const unknownProjects = normalizeStringArray(summary?.unknownProjects);
  const unexpectedProjects = normalizeStringArray(summary?.unexpectedProjects);

  if (sourceError) violations.push(sourceError);
  if (total.failed > 0) violations.push(`${total.failed} failed test(s)`);
  if (total.flaky > 0) violations.push(`${total.flaky} flaky test(s)`);
  if (missingProjects.length > 0) violations.push(`missing projects: ${missingProjects.join(', ')}`);
  if (unknownProjects.length > 0) violations.push(`unmapped projects: ${unknownProjects.join(', ')}`);
  if (unexpectedProjects.length > 0) violations.push(`unexpected projects: ${unexpectedProjects.join(', ')}`);
  if (status !== 'passed' && violations.length === 0) {
    violations.push('Reliability guardrails did not pass');
  }
  return [...new Set(violations)];
}

function deriveRunUrl(context) {
  if (context.runUrl) return String(context.runUrl);
  const serverUrl = String(context.serverUrl ?? 'https://github.com').replace(/\/$/, '');
  const repository = String(context.repository ?? '').replace(/^\/+|\/+$/g, '');
  const runId = String(context.runId ?? '');
  return repository && runId ? `${serverUrl}/${repository}/actions/runs/${runId}` : '';
}

export function createReliabilityEntry(summary, context = {}) {
  const hasSummary = Boolean(summary && typeof summary === 'object' && summary.total);
  const total = normalizeTotal(summary?.total);
  const missingProjects = hasSummary
    ? normalizeStringArray(summary?.missingProjects)
    : normalizeStringArray(context.expectedProjects);
  const unknownProjects = normalizeStringArray(summary?.unknownProjects);
  const unexpectedProjects = normalizeStringArray(summary?.unexpectedProjects);
  const guardrailsPassed = summary?.guardrails?.passed === true;

  let status = 'passed';
  if (!hasSummary || missingProjects.length > 0) {
    status = 'incomplete';
  } else if (
    !guardrailsPassed
    || total.failed > 0
    || total.flaky > 0
    || unknownProjects.length > 0
    || unexpectedProjects.length > 0
  ) {
    status = 'failed';
  }

  const sourceError = context.sourceError
    || (!hasSummary
      ? `Unified reliability summary was unavailable; merge job result: ${context.jobResult ?? 'unknown'}`
      : '');

  return {
    schemaVersion: RELIABILITY_HISTORY_SCHEMA_VERSION,
    runId: String(context.runId ?? ''),
    runAttempt: Math.max(1, toNonNegativeInteger(context.runAttempt, 1)),
    runNumber: toNonNegativeInteger(context.runNumber),
    eventName: String(context.eventName ?? ''),
    branch: String(context.branch ?? ''),
    sha: String(context.sha ?? ''),
    recordedAt: normalizeRecordedAt(context.recordedAt),
    runUrl: deriveRunUrl(context),
    repeatEach: Math.max(1, toNonNegativeInteger(context.repeatEach, 1)),
    status,
    guardrailsPassed: status === 'passed' && guardrailsPassed,
    total,
    missingProjects,
    unknownProjects,
    unexpectedProjects,
    violations: synthesizeViolations(summary, status, sourceError),
  };
}

function normalizeHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const runId = String(entry.runId ?? '').trim();
  const status = String(entry.status ?? '');
  if (!runId || !VALID_STATUSES.has(status)) return null;

  return {
    schemaVersion: RELIABILITY_HISTORY_SCHEMA_VERSION,
    runId,
    runAttempt: Math.max(1, toNonNegativeInteger(entry.runAttempt, 1)),
    runNumber: toNonNegativeInteger(entry.runNumber),
    eventName: String(entry.eventName ?? ''),
    branch: String(entry.branch ?? ''),
    sha: String(entry.sha ?? ''),
    recordedAt: normalizeRecordedAt(entry.recordedAt),
    runUrl: String(entry.runUrl ?? ''),
    repeatEach: Math.max(1, toNonNegativeInteger(entry.repeatEach, 1)),
    status,
    guardrailsPassed: Boolean(entry.guardrailsPassed),
    total: normalizeTotal(entry.total),
    missingProjects: normalizeStringArray(entry.missingProjects),
    unknownProjects: normalizeStringArray(entry.unknownProjects),
    unexpectedProjects: normalizeStringArray(entry.unexpectedProjects),
    violations: normalizeStringArray(entry.violations),
  };
}

export function mergeReliabilityHistory(previousHistory, currentEntry, options = {}) {
  const maxEntries = Math.max(1, toNonNegativeInteger(options.maxEntries, 30));
  const normalizedCurrent = normalizeHistoryEntry(currentEntry);
  if (!normalizedCurrent) throw new TypeError('Current reliability entry is invalid');

  const previousEntries = Array.isArray(previousHistory?.entries)
    ? previousHistory.entries.map(normalizeHistoryEntry).filter(Boolean)
    : [];
  const keyFor = (entry) => `${entry.runId}:${entry.runAttempt}`;
  const seen = new Set();
  const entries = [];

  for (const entry of [normalizedCurrent, ...previousEntries]) {
    const key = keyFor(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
    if (entries.length >= maxEntries) break;
  }

  return {
    schemaVersion: RELIABILITY_HISTORY_SCHEMA_VERSION,
    generatedAt: normalizedCurrent.recordedAt,
    maxEntries,
    entries,
  };
}

export function calculateReliabilityTrend(history, options = {}) {
  const windowSize = Math.max(1, toNonNegativeInteger(options.windowSize, 14));
  const entries = Array.isArray(history?.entries) ? history.entries.slice(0, windowSize) : [];
  const counts = {
    passed: entries.filter((entry) => entry.status === 'passed').length,
    failed: entries.filter((entry) => entry.status === 'failed').length,
    incomplete: entries.filter((entry) => entry.status === 'incomplete').length,
    total: entries.length,
  };
  const currentStatus = entries[0]?.status ?? 'unknown';
  let currentStreak = 0;
  for (const entry of entries) {
    if (entry.status !== currentStatus) break;
    currentStreak += 1;
  }

  return {
    windowSize,
    counts,
    passRate: counts.total > 0 ? counts.passed / counts.total : 0,
    currentStatus,
    currentStreak,
    flakyRuns: entries.filter((entry) => entry.total.flaky > 0).length,
    failedTestRuns: entries.filter((entry) => entry.total.failed > 0).length,
    entries,
  };
}

function formatDuration(durationMs) {
  const seconds = Math.max(0, Number(durationMs) || 0) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${(seconds - (minutes * 60)).toFixed(1)}s`;
}

function statusLabel(status) {
  if (status === 'passed') return '✅ Passed';
  if (status === 'failed') return '❌ Failed';
  if (status === 'incomplete') return '⚠️ Incomplete';
  return '❔ Unknown';
}

function formatRunLink(entry) {
  const label = entry.runNumber > 0 ? `#${entry.runNumber}` : entry.runId;
  return entry.runUrl ? `[${label}](${entry.runUrl})` : label;
}

export function renderReliabilityTrendMarkdown(history, options = {}) {
  const trend = calculateReliabilityTrend(history, options);
  const title = options.title ?? 'Nightly E2E reliability trend';
  const scopeNote = options.scopeNote ?? 'Latest scheduled runs are shown first.';
  const percentage = `${(trend.passRate * 100).toFixed(1)}%`;
  const lines = [
    `## ${title}`,
    '',
    scopeNote,
    '',
    `Current status: **${statusLabel(trend.currentStatus)}** · Current streak: **${trend.currentStreak}** · Pass rate: **${percentage}** over **${trend.counts.total}** run(s).`,
    '',
    '| Run | Recorded (UTC) | Status | Passed | Flaky | Failed | Missing | Test time | Repeat |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const entry of trend.entries) {
    lines.push(`| ${formatRunLink(entry)} | ${entry.recordedAt.replace('T', ' ').replace('.000Z', 'Z')} | ${statusLabel(entry.status)} | ${entry.total.passed} | ${entry.total.flaky} | ${entry.total.failed} | ${entry.missingProjects.length} | ${formatDuration(entry.total.durationMs)} | ${entry.repeatEach}× |`);
  }

  if (trend.entries.length === 0) {
    lines.push('| — | — | ❔ No history | 0 | 0 | 0 | 0 | 0.0s | — |');
  }

  lines.push(
    '',
    `Window totals: **${trend.counts.passed} passed**, **${trend.counts.failed} failed**, **${trend.counts.incomplete} incomplete**, **${trend.flakyRuns} run(s) with flaky tests**.`,
    '',
  );
  return lines.join('\n');
}

function runMarker(entry) {
  return `<!-- idphoto-e2e-reliability-run:${entry.runId}:${entry.runAttempt} -->`;
}

export function buildReliabilityIncidentPlan(history, options = {}) {
  const current = history?.entries?.[0];
  if (!current) throw new TypeError('Reliability history must contain a current entry');
  const manageIncident = Boolean(options.manageIncident);
  const action = !manageIncident
    ? 'none'
    : current.status === 'passed'
      ? 'resolve'
      : 'open-or-update';
  const marker = runMarker(current);
  const status = statusLabel(current.status);
  const link = current.runUrl ? `[workflow run ${current.runNumber || current.runId}](${current.runUrl})` : `workflow run ${current.runNumber || current.runId}`;
  const comment = current.status === 'passed'
    ? `${marker}\n✅ Nightly E2E reliability recovered on ${link}. The automated incident can be closed.`
    : `${marker}\n${status} on ${link}. Failed: **${current.total.failed}**, flaky: **${current.total.flaky}**, missing projects: **${current.missingProjects.length}**.`;

  return {
    schemaVersion: RELIABILITY_HISTORY_SCHEMA_VERSION,
    manageIncident,
    action,
    title: RELIABILITY_INCIDENT_TITLE,
    label: RELIABILITY_INCIDENT_LABEL,
    marker: RELIABILITY_INCIDENT_MARKER,
    runMarker: marker,
    currentStatus: current.status,
    runId: current.runId,
    runAttempt: current.runAttempt,
    runUrl: current.runUrl,
    comment,
  };
}

export function renderReliabilityIncidentBody(history, options = {}) {
  const current = history?.entries?.[0];
  if (!current) throw new TypeError('Reliability history must contain a current entry');
  const trendMarkdown = renderReliabilityTrendMarkdown(history, {
    windowSize: options.windowSize,
    title: 'Recent nightly trend',
    scopeNote: 'This table is updated by the scheduled reliability workflow.',
  });
  const violations = current.violations.length > 0
    ? current.violations.map((violation) => `- ${violation}`).join('\n')
    : '- None';
  const runLink = current.runUrl ? `[Open workflow run](${current.runUrl})` : 'Workflow run link unavailable';

  return [
    RELIABILITY_INCIDENT_MARKER,
    runMarker(current),
    '# Nightly browser reliability incident',
    '',
    `Current status: **${statusLabel(current.status)}**`,
    '',
    `${runLink} · Commit: \`${current.sha.slice(0, 12) || 'unknown'}\` · Repeat: **${current.repeatEach}×**`,
    '',
    '| Passed | Flaky | Failed | Skipped | Missing projects |',
    '| ---: | ---: | ---: | ---: | ---: |',
    `| ${current.total.passed} | ${current.total.flaky} | ${current.total.failed} | ${current.total.skipped} | ${current.missingProjects.length} |`,
    '',
    '## Current guardrail violations',
    '',
    violations,
    '',
    trendMarkdown,
    'This issue is managed automatically by `.github/workflows/e2e-reliability.yml`. Repeated failures update this issue; the first clean scheduled run closes it.',
    '',
  ].join('\n');
}

async function readJsonIfAvailable(path, options = {}) {
  if (!path) return { value: null, error: '' };
  try {
    return { value: JSON.parse(await readFile(path, 'utf8')), error: '' };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { value: null, error: options.missingMessage ?? '' };
    }
    return {
      value: null,
      error: `${options.invalidMessage ?? 'JSON input could not be read'}: ${error.message}`,
    };
  }
}

function parseCliArguments(args) {
  const positional = args.filter((argument) => !argument.startsWith('--'));
  const flags = args.filter((argument) => argument.startsWith('--'));
  const options = { maxEntries: 30, windowSize: 14 };

  for (const flag of flags) {
    if (flag.startsWith('--max-entries=')) {
      options.maxEntries = Math.max(1, toNonNegativeInteger(flag.slice('--max-entries='.length), 30));
    } else if (flag.startsWith('--window-size=')) {
      options.windowSize = Math.max(1, toNonNegativeInteger(flag.slice('--window-size='.length), 14));
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }

  return {
    currentSummaryPath: resolve(positional[0] ?? 'playwright-reliability-summary.compact.json'),
    previousHistoryPath: resolve(positional[1] ?? 'previous-history/reliability-history.json'),
    historyOutputPath: resolve(positional[2] ?? 'reliability-observability/reliability-history.json'),
    trendOutputPath: resolve(positional[3] ?? 'reliability-observability/reliability-trend.md'),
    incidentBodyOutputPath: resolve(positional[4] ?? 'reliability-observability/reliability-incident-body.md'),
    incidentPlanOutputPath: resolve(positional[5] ?? 'reliability-observability/reliability-incident-plan.json'),
    options,
  };
}

async function runCli() {
  const paths = parseCliArguments(process.argv.slice(2));
  const currentResult = await readJsonIfAvailable(paths.currentSummaryPath, {
    missingMessage: `Unified reliability summary was not found at ${paths.currentSummaryPath}`,
    invalidMessage: 'Unified reliability summary is invalid',
  });
  const previousResult = await readJsonIfAvailable(paths.previousHistoryPath, {
    invalidMessage: 'Previous reliability history is invalid',
  });
  if (previousResult.error) console.warn(previousResult.error);

  const expectedProjects = String(process.env.EXPECTED_PROJECTS ?? '')
    .split(',')
    .map((project) => project.trim())
    .filter(Boolean);
  const eventName = process.env.GITHUB_EVENT_NAME ?? '';
  const entry = createReliabilityEntry(currentResult.value, {
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    runNumber: process.env.GITHUB_RUN_NUMBER,
    eventName,
    branch: process.env.GITHUB_REF_NAME,
    sha: process.env.GITHUB_SHA,
    serverUrl: process.env.GITHUB_SERVER_URL,
    repository: process.env.GITHUB_REPOSITORY,
    repeatEach: process.env.REPEAT_EACH,
    expectedProjects,
    jobResult: process.env.RELIABILITY_JOB_RESULT,
    sourceError: currentResult.error,
    recordedAt: process.env.RELIABILITY_RECORDED_AT,
  });
  const history = mergeReliabilityHistory(previousResult.value, entry, {
    maxEntries: paths.options.maxEntries,
  });
  const isScheduled = eventName === 'schedule';
  const trend = renderReliabilityTrendMarkdown(history, {
    windowSize: paths.options.windowSize,
    title: isScheduled ? 'Nightly E2E reliability trend' : 'E2E reliability trend preview',
    scopeNote: isScheduled
      ? 'Latest scheduled runs are shown first.'
      : 'Manual runs are previews and do not manage the official incident issue.',
  });
  const incidentPlan = buildReliabilityIncidentPlan(history, {
    manageIncident: isScheduled,
  });
  const incidentBody = renderReliabilityIncidentBody(history, {
    windowSize: paths.options.windowSize,
  });

  await Promise.all([
    paths.historyOutputPath,
    paths.trendOutputPath,
    paths.incidentBodyOutputPath,
    paths.incidentPlanOutputPath,
  ].map((path) => mkdir(dirname(path), { recursive: true })));

  await Promise.all([
    writeFile(paths.historyOutputPath, `${JSON.stringify(history, null, 2)}\n`, 'utf8'),
    writeFile(paths.trendOutputPath, trend, 'utf8'),
    writeFile(paths.incidentBodyOutputPath, incidentBody, 'utf8'),
    writeFile(paths.incidentPlanOutputPath, `${JSON.stringify(incidentPlan, null, 2)}\n`, 'utf8'),
  ]);

  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, trend, 'utf8');
  } else {
    process.stdout.write(trend);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  runCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
