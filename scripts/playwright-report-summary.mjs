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
    missingProjects: [],
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

function finalizeCounter(counter) {
  counter.missingProjects = counter.projects.filter((project) => !counter.seenProjects.has(project));
  delete counter.seenProjects;
  return counter;
}

function addTest(counter, test) {
  const { bucket, durationMs } = classifyTest(test);
  counter[bucket] += 1;
  counter.total += 1;
  counter.durationMs += durationMs;
  if (test.projectName) counter.seenProjects.add(test.projectName);
}

export function summarizePlaywrightReport(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.suites)) {
    throw new TypeError('Playwright JSON report must contain a suites array');
  }

  const counters = new Map(BROWSER_GROUPS.map((group) => [group.id, createCounter(group)]));
  const projectToGroup = new Map();
  for (const group of BROWSER_GROUPS) {
    for (const project of group.projects) projectToGroup.set(project, group.id);
  }

  const other = createCounter({ id: 'other', label: 'Other', projects: [] });
  const unknownProjects = new Set();

  walkSuites(report.suites, (test) => {
    const projectName = typeof test.projectName === 'string' ? test.projectName : '';
    const groupId = projectToGroup.get(projectName);
    const counter = groupId ? counters.get(groupId) : other;
    if (!groupId) unknownProjects.add(projectName || '(missing project name)');
    addTest(counter, test);
  });

  const groups = [...counters.values()].map(finalizeCounter);
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
    unknownProjects: [...unknownProjects].sort(),
    missingProjects: groups.flatMap((group) => group.missingProjects),
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

function groupStatus(group) {
  if (group.failed > 0) return '❌ Failed';
  if (group.missingProjects.length > 0) return '⚠️ Incomplete';
  if (group.flaky > 0) return '⚠️ Flaky';
  return '✅ Passed';
}

export function renderPlaywrightSummaryMarkdown(summary, context = {}) {
  const lines = [
    '## Browser E2E summary',
    '',
  ];

  if (context.sha) lines.push(`Commit: \`${String(context.sha).slice(0, 12)}\``, '');

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

  lines.push('Download the `playwright-report-unified` artifact for the merged HTML report, JSON data and this summary.', '');
  return lines.join('\n');
}

async function runCli() {
  const inputPath = resolve(process.argv[2] ?? 'playwright-summary.json');
  const markdownPath = resolve(process.argv[3] ?? 'playwright-summary.md');
  const compactJsonPath = resolve(process.argv[4] ?? 'playwright-summary.compact.json');

  const report = JSON.parse(await readFile(inputPath, 'utf8'));
  const summary = summarizePlaywrightReport(report);
  const markdown = renderPlaywrightSummaryMarkdown(summary, { sha: process.env.GITHUB_SHA });

  await Promise.all([
    writeFile(markdownPath, markdown, 'utf8'),
    writeFile(compactJsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8'),
  ]);

  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown, 'utf8');
  } else {
    process.stdout.write(markdown);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  runCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
