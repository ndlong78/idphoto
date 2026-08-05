import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BROWSER_GROUPS = Object.freeze([
  Object.freeze({
    id: 'chromium',
    label: 'Chromium',
    projects: Object.freeze(['chromium-desktop', 'chromium-mobile', 'cross-chromium']),
  }),
  Object.freeze({
    id: 'firefox',
    label: 'Firefox',
    projects: Object.freeze(['cross-firefox']),
  }),
  Object.freeze({
    id: 'webkit',
    label: 'WebKit desktop',
    projects: Object.freeze(['cross-webkit']),
  }),
  Object.freeze({
    id: 'iphone-webkit',
    label: 'iPhone WebKit',
    projects: Object.freeze(['webkit-iphone-se', 'webkit-iphone-13']),
  }),
]);

const FAILURE_RESULT_STATUSES = new Set(['failed', 'timedOut', 'interrupted']);
const KNOWN_PROJECTS = Object.freeze(BROWSER_GROUPS.flatMap((group) => group.projects));
const KNOWN_PROJECT_SET = new Set(KNOWN_PROJECTS);

function createCounter(group) {
  return {
    id: group.id,
    label: group.label,
    projects: [...group.projects],
    passed: 0,
    flaky: 0,
    failed: 0,
    skipped: 0,
    total: 0,
    durationMs: 0,
    seenProjects: new Set(),
    projectMetrics: new Map(),
    projectTimings: [],
    missingProjects: [],
  };
}

function createProjectMetric(projectName) {
  return {
    projectName,
    tests: 0,
    durationMs: 0,
    averageTestDurationMs: 0,
    maxTestDurationMs: 0,
  };
}

function walkSuites(suites, visitTest) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) visitTest(test);
    }
    walkSuites(suite.suites, visitTest);
  }
}

function classifyTest(test) {
  const results = Array.isArray(test.results) ? test.results : [];
  const finalResult = results.at(-1);
  const durationMs = results.reduce((sum, result) => {
    const duration = Number(result?.duration);
    return sum + (Number.isFinite(duration) && duration > 0 ? duration : 0);
  }, 0);

  if (test.status === 'flaky') return { bucket: 'flaky', durationMs };
  if (test.status === 'unexpected') return { bucket: 'failed', durationMs };
  if (test.status === 'skipped') return { bucket: 'skipped', durationMs };
  if (test.status === 'expected') return { bucket: 'passed', durationMs };

  if (finalResult?.status === 'skipped') return { bucket: 'skipped', durationMs };
  if (FAILURE_RESULT_STATUSES.has(finalResult?.status)) return { bucket: 'failed', durationMs };

  const failedBeforeFinalPass = finalResult?.status === 'passed'
    && results.slice(0, -1).some((result) => FAILURE_RESULT_STATUSES.has(result?.status));

  if (failedBeforeFinalPass) return { bucket: 'flaky', durationMs };
  return { bucket: 'passed', durationMs };
}

function normalizeExpectedProjects(expectedProjects) {
  if (expectedProjects == null) return null;
  if (!Array.isArray(expectedProjects)) {
    throw new TypeError('expectedProjects must be an array when provided');
  }

  const normalized = [...new Set(expectedProjects
    .map((project) => String(project).trim())
    .filter(Boolean))];
  const unknown = normalized.filter((project) => !KNOWN_PROJECT_SET.has(project));
  if (unknown.length > 0) {
    throw new RangeError(`Unknown expected Playwright projects: ${unknown.join(', ')}`);
  }
  return new Set(normalized);
}

function orderedProjectMetrics(counter) {
  const order = new Map(counter.projects.map((projectName, index) => [projectName, index]));
  return [...counter.projectMetrics.values()]
    .map((metric) => ({
      ...metric,
      averageTestDurationMs: metric.tests > 0
        ? Math.round(metric.durationMs / metric.tests)
        : 0,
    }))
    .sort((left, right) => {
      const leftIndex = order.get(left.projectName) ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = order.get(right.projectName) ?? Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex || left.projectName.localeCompare(right.projectName);
    });
}

function finalizeCounter(counter) {
  counter.missingProjects = counter.projects.filter((project) => !counter.seenProjects.has(project));
  counter.projectTimings = orderedProjectMetrics(counter);
  delete counter.seenProjects;
  delete counter.projectMetrics;
  return counter;
}

function addTest(counter, test) {
  const { bucket, durationMs } = classifyTest(test);
  counter[bucket] += 1;
  counter.total += 1;
  counter.durationMs += durationMs;

  const projectName = typeof test.projectName === 'string' ? test.projectName : '';
  if (!projectName) return;

  counter.seenProjects.add(projectName);
  const metric = counter.projectMetrics.get(projectName) ?? createProjectMetric(projectName);
  if (bucket !== 'skipped') {
    metric.tests += 1;
    metric.durationMs += durationMs;
    metric.maxTestDurationMs = Math.max(metric.maxTestDurationMs, durationMs);
  }
  counter.projectMetrics.set(projectName, metric);
}

export function summarizePlaywrightReport(report, options = {}) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.suites)) {
    throw new TypeError('Playwright JSON report must contain a suites array');
  }

  const expectedProjectSet = normalizeExpectedProjects(options.expectedProjects);
  const effectiveGroups = BROWSER_GROUPS.map((group) => ({
    ...group,
    projects: expectedProjectSet
      ? group.projects.filter((project) => expectedProjectSet.has(project))
      : [...group.projects],
  }));
  const counters = new Map(effectiveGroups.map((group) => [group.id, createCounter(group)]));
  const projectToGroup = new Map();
  for (const group of BROWSER_GROUPS) {
    for (const project of group.projects) projectToGroup.set(project, group.id);
  }

  const other = createCounter({ id: 'other', label: 'Other', projects: [] });
  const unknownProjects = new Set();
  const unexpectedProjects = new Set();

  walkSuites(report.suites, (test) => {
    const projectName = typeof test.projectName === 'string' ? test.projectName : '';
    const groupId = projectToGroup.get(projectName);
    const counter = groupId ? counters.get(groupId) : other;
    if (!groupId) {
      unknownProjects.add(projectName || '(missing project name)');
    } else if (expectedProjectSet && !expectedProjectSet.has(projectName)) {
      unexpectedProjects.add(projectName);
    }
    addTest(counter, test);
  });

  const groups = [...counters.values()]
    .filter((counter) => counter.projects.length > 0 || counter.total > 0)
    .map(finalizeCounter);
  if (other.total > 0) groups.push(finalizeCounter(other));

  const total = groups.reduce((aggregate, group) => {
    aggregate.passed += group.passed;
    aggregate.flaky += group.flaky;
    aggregate.failed += group.failed;
    aggregate.skipped += group.skipped;
    aggregate.total += group.total;
    aggregate.durationMs += group.durationMs;
    return aggregate;
  }, {
    passed: 0,
    flaky: 0,
    failed: 0,
    skipped: 0,
    total: 0,
    durationMs: 0,
  });

  return {
    groups,
    total,
    projectTimings: groups.flatMap((group) => group.projectTimings),
    expectedProjects: expectedProjectSet ? [...expectedProjectSet] : [...KNOWN_PROJECTS],
    unknownProjects: [...unknownProjects].sort(),
    unexpectedProjects: [...unexpectedProjects].sort(),
    missingProjects: groups.flatMap((group) => group.missingProjects),
  };
}

function normalizeLimit(value, label) {
  if (value == null) return Number.POSITIVE_INFINITY;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function normalizePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return parsed;
}

function normalizeWarningRatio(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
    throw new RangeError('duration warning ratio must be greater than 0 and less than 1');
  }
  return parsed;
}

function normalizeDurationBudgetConfig(config, options = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('Playwright duration budget config must be an object');
  }
  if (!config.projects || typeof config.projects !== 'object' || Array.isArray(config.projects)) {
    throw new TypeError('Playwright duration budget config must contain a projects object');
  }

  const warningRatio = normalizeWarningRatio(options.warningRatio ?? config.warningRatio ?? 0.75);
  const projects = new Map();
  for (const [projectName, rawBudget] of Object.entries(config.projects)) {
    if (!KNOWN_PROJECT_SET.has(projectName)) {
      throw new RangeError(`Unknown Playwright duration budget project: ${projectName}`);
    }
    if (!rawBudget || typeof rawBudget !== 'object' || Array.isArray(rawBudget)) {
      throw new TypeError(`Duration budget for ${projectName} must be an object`);
    }
    projects.set(projectName, {
      baselineAverageTestDurationMs: rawBudget.baselineAverageTestDurationMs == null
        ? null
        : normalizePositiveInteger(
          rawBudget.baselineAverageTestDurationMs,
          `${projectName}.baselineAverageTestDurationMs`,
        ),
      maxAverageTestDurationMs: normalizePositiveInteger(
        rawBudget.maxAverageTestDurationMs,
        `${projectName}.maxAverageTestDurationMs`,
      ),
      maxSingleTestDurationMs: normalizePositiveInteger(
        rawBudget.maxSingleTestDurationMs,
        `${projectName}.maxSingleTestDurationMs`,
      ),
    });
  }

  return {
    schemaVersion: Number(config.schemaVersion) || 1,
    warningRatio,
    projects,
  };
}

function durationViolation(projectName, metric, budget) {
  const violations = [];
  if (metric.averageTestDurationMs > budget.maxAverageTestDurationMs) {
    violations.push(
      `${projectName} average test duration ${formatDuration(metric.averageTestDurationMs)} exceeds budget ${formatDuration(budget.maxAverageTestDurationMs)}`,
    );
  }
  if (metric.maxTestDurationMs > budget.maxSingleTestDurationMs) {
    violations.push(
      `${projectName} slowest test ${formatDuration(metric.maxTestDurationMs)} exceeds budget ${formatDuration(budget.maxSingleTestDurationMs)}`,
    );
  }
  return violations;
}

function durationWarning(projectName, metric, budget, warningRatio) {
  const warnings = [];
  const averageWarningThreshold = budget.maxAverageTestDurationMs * warningRatio;
  const singleWarningThreshold = budget.maxSingleTestDurationMs * warningRatio;

  if (
    metric.averageTestDurationMs >= averageWarningThreshold
    && metric.averageTestDurationMs <= budget.maxAverageTestDurationMs
  ) {
    warnings.push(
      `${projectName} average test duration ${formatDuration(metric.averageTestDurationMs)} reached ${formatPercent(metric.averageTestDurationMs / budget.maxAverageTestDurationMs)} of budget`,
    );
  }
  if (
    metric.maxTestDurationMs >= singleWarningThreshold
    && metric.maxTestDurationMs <= budget.maxSingleTestDurationMs
  ) {
    warnings.push(
      `${projectName} slowest test ${formatDuration(metric.maxTestDurationMs)} reached ${formatPercent(metric.maxTestDurationMs / budget.maxSingleTestDurationMs)} of budget`,
    );
  }
  return warnings;
}

export function evaluatePlaywrightDurationBudgets(summary, config, options = {}) {
  if (!summary || typeof summary !== 'object' || !Array.isArray(summary.expectedProjects)) {
    throw new TypeError('Playwright summary must contain expectedProjects');
  }

  const normalized = normalizeDurationBudgetConfig(config, options);
  const timingByProject = new Map(
    (summary.projectTimings ?? []).map((timing) => [timing.projectName, timing]),
  );
  const projects = [];
  const warnings = [];
  const violations = [];
  let maxUtilizationRatio = 0;

  for (const projectName of summary.expectedProjects) {
    const budget = normalized.projects.get(projectName);
    if (!budget) {
      violations.push(`missing duration budget for ${projectName}`);
      projects.push({
        projectName,
        tests: 0,
        durationMs: 0,
        averageTestDurationMs: 0,
        maxTestDurationMs: 0,
        budget: null,
        averageUtilizationRatio: 0,
        maxTestUtilizationRatio: 0,
        utilizationRatio: 0,
        status: 'missing-budget',
      });
      continue;
    }

    const metric = timingByProject.get(projectName) ?? createProjectMetric(projectName);
    if (metric.tests === 0) {
      projects.push({
        ...metric,
        budget,
        averageUtilizationRatio: 0,
        maxTestUtilizationRatio: 0,
        utilizationRatio: 0,
        status: 'not-run',
      });
      continue;
    }

    const averageUtilizationRatio = metric.averageTestDurationMs / budget.maxAverageTestDurationMs;
    const maxTestUtilizationRatio = metric.maxTestDurationMs / budget.maxSingleTestDurationMs;
    const utilizationRatio = Math.max(averageUtilizationRatio, maxTestUtilizationRatio);
    maxUtilizationRatio = Math.max(maxUtilizationRatio, utilizationRatio);

    const projectViolations = durationViolation(projectName, metric, budget);
    const projectWarnings = projectViolations.length === 0
      ? durationWarning(projectName, metric, budget, normalized.warningRatio)
      : [];
    violations.push(...projectViolations);
    warnings.push(...projectWarnings);

    projects.push({
      ...metric,
      budget,
      averageUtilizationRatio,
      maxTestUtilizationRatio,
      utilizationRatio,
      status: projectViolations.length > 0
        ? 'failed'
        : projectWarnings.length > 0
          ? 'warning'
          : 'passed',
    });
  }

  return {
    schemaVersion: normalized.schemaVersion,
    passed: violations.length === 0,
    status: violations.length > 0
      ? 'failed'
      : warnings.length > 0
        ? 'warning'
        : 'passed',
    warningRatio: normalized.warningRatio,
    maxUtilizationRatio,
    projects,
    warnings,
    violations,
  };
}

export function evaluatePlaywrightGuardrails(summary, options = {}) {
  const maxFailed = normalizeLimit(options.maxFailed, 'maxFailed');
  const maxFlaky = normalizeLimit(options.maxFlaky, 'maxFlaky');
  const requireComplete = Boolean(options.requireComplete);
  const forbidUnmapped = Boolean(options.forbidUnmapped);
  const forbidUnexpected = options.forbidUnexpected == null
    ? forbidUnmapped
    : Boolean(options.forbidUnexpected);
  const durationBudgets = options.durationBudgets ?? null;
  const violations = [];

  if (summary.total.failed > maxFailed) {
    violations.push(`failed tests ${summary.total.failed} exceed limit ${maxFailed}`);
  }
  if (summary.total.flaky > maxFlaky) {
    violations.push(`flaky tests ${summary.total.flaky} exceed limit ${maxFlaky}`);
  }
  if (requireComplete && summary.missingProjects.length > 0) {
    violations.push(`missing projects: ${summary.missingProjects.join(', ')}`);
  }
  if (forbidUnmapped && summary.unknownProjects.length > 0) {
    violations.push(`unmapped projects: ${summary.unknownProjects.join(', ')}`);
  }
  if (forbidUnexpected && summary.unexpectedProjects.length > 0) {
    violations.push(`unexpected projects: ${summary.unexpectedProjects.join(', ')}`);
  }
  if (durationBudgets && !durationBudgets.passed) {
    violations.push(...durationBudgets.violations);
  }

  return {
    passed: violations.length === 0,
    limits: {
      maxFailed: Number.isFinite(maxFailed) ? maxFailed : null,
      maxFlaky: Number.isFinite(maxFlaky) ? maxFlaky : null,
      requireComplete,
      forbidUnmapped,
      forbidUnexpected,
      durationBudgets: Boolean(durationBudgets),
    },
    durationBudgets,
    violations,
  };
}

export function formatDuration(durationMs) {
  const milliseconds = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds - (minutes * 60);
  return `${minutes}m ${remainingSeconds.toFixed(1)}s`;
}

function formatPercent(ratio) {
  const value = Number.isFinite(ratio) && ratio >= 0 ? ratio : 0;
  return `${(value * 100).toFixed(1)}%`;
}

function groupStatus(group) {
  if (group.failed > 0) return '❌ Failed';
  if (group.missingProjects.length > 0) return '⚠️ Incomplete';
  if (group.flaky > 0) return '⚠️ Flaky';
  return '✅ Passed';
}

function durationStatus(status) {
  if (status === 'failed' || status === 'missing-budget') return '❌ Failed';
  if (status === 'warning') return '⚠️ Warning';
  if (status === 'not-run') return '➖ Not run';
  return '✅ Passed';
}

function limitLabel(value) {
  return value == null ? 'not enforced' : String(value);
}

function renderDurationBudgets(lines, durationBudgets) {
  if (!durationBudgets) return;

  lines.push(
    '### E2E duration budgets',
    '',
    `Status: ${durationBudgets.status === 'failed'
      ? '❌ Failed'
      : durationBudgets.status === 'warning'
        ? '⚠️ Warning'
        : '✅ Passed'} · Warning threshold: **${formatPercent(durationBudgets.warningRatio)}** · Highest utilization: **${formatPercent(durationBudgets.maxUtilizationRatio)}**.`,
    '',
    '| Project | Tests | Avg/test | Avg budget | Slowest test | Single-test budget | Utilization | Status |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  );

  for (const project of durationBudgets.projects) {
    const averageBudget = project.budget
      ? formatDuration(project.budget.maxAverageTestDurationMs)
      : '—';
    const singleBudget = project.budget
      ? formatDuration(project.budget.maxSingleTestDurationMs)
      : '—';
    const utilization = project.status === 'not-run' || project.status === 'missing-budget'
      ? '—'
      : formatPercent(project.utilizationRatio);
    lines.push(`| ${project.projectName} | ${project.tests} | ${formatDuration(project.averageTestDurationMs)} | ${averageBudget} | ${formatDuration(project.maxTestDurationMs)} | ${singleBudget} | ${utilization} | ${durationStatus(project.status)} |`);
  }

  lines.push('');
  if (durationBudgets.warnings.length > 0) {
    lines.push(...durationBudgets.warnings.map((warning) => `- ⚠️ ${warning}`), '');
  }
  if (durationBudgets.violations.length > 0) {
    lines.push(...durationBudgets.violations.map((violation) => `- ❌ ${violation}`), '');
  }
}

export function renderPlaywrightSummaryMarkdown(summary, context = {}) {
  const lines = [
    `## ${context.title || 'Browser E2E summary'}`,
    '',
  ];

  if (context.sha) lines.push(`Commit: \`${String(context.sha).slice(0, 12)}\``, '');
  if (context.note) lines.push(String(context.note), '');

  lines.push(
    '| Engine group | Projects | Passed | Flaky | Failed | Skipped | Total | Test time | Status |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  );

  for (const group of summary.groups) {
    const projects = group.projects.length > 0 ? group.projects.join(', ') : 'Unmapped';
    lines.push(`| ${group.label} | ${projects} | ${group.passed} | ${group.flaky} | ${group.failed} | ${group.skipped} | ${group.total} | ${formatDuration(group.durationMs)} | ${groupStatus(group)} |`);
  }

  const totalStatus = summary.total.failed > 0
    ? '❌ Failed'
    : summary.missingProjects.length > 0
      ? '⚠️ Incomplete'
      : summary.total.flaky > 0
        ? '⚠️ Flaky'
        : '✅ Passed';

  lines.push(
    `| **Total** | — | **${summary.total.passed}** | **${summary.total.flaky}** | **${summary.total.failed}** | **${summary.total.skipped}** | **${summary.total.total}** | **${formatDuration(summary.total.durationMs)}** | **${totalStatus}** |`,
    '',
  );

  if (summary.missingProjects.length > 0) {
    lines.push(`> Missing projects: ${summary.missingProjects.map((project) => `\`${project}\``).join(', ')}. A browser shard may have failed before producing a blob report.`, '');
  }

  if (summary.unknownProjects.length > 0) {
    lines.push(`> Unmapped projects: ${summary.unknownProjects.map((project) => `\`${project}\``).join(', ')}. Update \`BROWSER_GROUPS\` when adding a Playwright project.`, '');
  }

  if (summary.unexpectedProjects.length > 0) {
    lines.push(`> Unexpected projects: ${summary.unexpectedProjects.map((project) => `\`${project}\``).join(', ')}. Check the project selection used by this workflow.`, '');
  }

  renderDurationBudgets(lines, context.durationBudgets);

  if (context.guardrails) {
    const guardrails = context.guardrails;
    lines.push(
      '### Reliability guardrails',
      '',
      `Status: ${guardrails.passed ? '✅ Passed' : '❌ Failed'}`,
      '',
      `- Failed tests: **${summary.total.failed}**; limit: **${limitLabel(guardrails.limits.maxFailed)}**.`,
      `- Flaky tests: **${summary.total.flaky}**; limit: **${limitLabel(guardrails.limits.maxFlaky)}**.`,
      `- Required projects: **${summary.missingProjects.length === 0 ? 'complete' : `${summary.missingProjects.length} missing`}**.`,
      `- Unmapped projects: **${summary.unknownProjects.length}**; unexpected projects: **${summary.unexpectedProjects.length}**.`,
      `- Duration budgets: **${guardrails.durationBudgets
        ? guardrails.durationBudgets.status
        : 'not enforced'}**.`,
      '',
    );

    if (guardrails.violations.length > 0) {
      lines.push(...guardrails.violations.map((violation) => `- ❌ ${violation}`), '');
    }
  }

  lines.push('Download the unified Playwright artifact for the merged HTML report, JSON data and this summary.', '');
  return lines.join('\n');
}

function parseCliArguments(args) {
  const positional = args.filter((argument) => !argument.startsWith('--'));
  const flags = args.filter((argument) => argument.startsWith('--'));
  const options = {};

  for (const flag of flags) {
    if (flag.startsWith('--max-failed=')) {
      options.maxFailed = flag.slice('--max-failed='.length);
    } else if (flag.startsWith('--max-flaky=')) {
      options.maxFlaky = flag.slice('--max-flaky='.length);
    } else if (flag.startsWith('--expected-projects=')) {
      options.expectedProjects = flag
        .slice('--expected-projects='.length)
        .split(',')
        .map((project) => project.trim())
        .filter(Boolean);
    } else if (flag.startsWith('--duration-budgets=')) {
      options.durationBudgetsPath = resolve(flag.slice('--duration-budgets='.length));
    } else if (flag.startsWith('--duration-warning-ratio=')) {
      options.durationWarningRatio = flag.slice('--duration-warning-ratio='.length);
    } else if (flag === '--require-complete') {
      options.requireComplete = true;
    } else if (flag === '--forbid-unmapped') {
      options.forbidUnmapped = true;
    } else if (flag === '--forbid-unexpected') {
      options.forbidUnexpected = true;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }

  return {
    inputPath: resolve(positional[0] ?? 'playwright-summary.json'),
    markdownPath: resolve(positional[1] ?? 'playwright-summary.md'),
    compactJsonPath: resolve(positional[2] ?? 'playwright-summary.compact.json'),
    options,
  };
}

async function runCli() {
  const {
    inputPath,
    markdownPath,
    compactJsonPath,
    options,
  } = parseCliArguments(process.argv.slice(2));

  const report = JSON.parse(await readFile(inputPath, 'utf8'));
  const summary = summarizePlaywrightReport(report, {
    expectedProjects: options.expectedProjects,
  });
  const durationBudgetConfig = options.durationBudgetsPath
    ? JSON.parse(await readFile(options.durationBudgetsPath, 'utf8'))
    : null;
  const durationBudgets = durationBudgetConfig
    ? evaluatePlaywrightDurationBudgets(summary, durationBudgetConfig, {
      warningRatio: options.durationWarningRatio,
    })
    : null;
  const guardrails = evaluatePlaywrightGuardrails(summary, {
    ...options,
    durationBudgets,
  });
  const markdown = renderPlaywrightSummaryMarkdown(summary, {
    sha: process.env.GITHUB_SHA,
    title: process.env.PLAYWRIGHT_SUMMARY_TITLE,
    note: process.env.PLAYWRIGHT_SUMMARY_NOTE,
    durationBudgets,
    guardrails,
  });

  await Promise.all([
    writeFile(markdownPath, markdown, 'utf8'),
    writeFile(compactJsonPath, `${JSON.stringify({
      ...summary,
      performance: durationBudgets,
      guardrails,
    }, null, 2)}\n`, 'utf8'),
  ]);

  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown, 'utf8');
  } else {
    process.stdout.write(markdown);
  }

  if (!guardrails.passed) {
    throw new Error(`Playwright reliability guardrails failed: ${guardrails.violations.join('; ')}`);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  runCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
