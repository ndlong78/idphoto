# Continuous Integration

## Runtime

GitHub Actions and local development use Node.js 24. Run `nvm use` from the repository root to select the version declared in `.nvmrc`.

The workflows use the Node 24 generations of the official GitHub actions:

- `actions/checkout@v6`
- `actions/setup-node@v6`
- `actions/upload-artifact@v7`
- `actions/download-artifact@v8`
- `actions/github-script@v9`

Workflow permissions are read-only (`contents: read`) by default. Pull-request CI cancels an older run when a newer commit is pushed to the same pull request or branch. Nightly reliability runs are not cancelled by a later manual or scheduled run.

Only the nightly observability job receives additional permissions:

- `actions: read` to find and download the previous scheduled history artifact;
- `issues: write` to manage one automated reliability incident issue;
- `contents: read` to check out the repository.

Browser execution and report-merging jobs do not receive issue write access.

## Dependency cache

`actions/setup-node` caches npm's global package cache using `package-lock.json` as the dependency key. Jobs still run `npm ci`; `node_modules` is never cached.

Playwright Test is pinned through `PLAYWRIGHT_VERSION` in each workflow. Browser and report-merging jobs install that exact test-runner version without changing `package.json` or `package-lock.json`.

## Browser binaries

Browser binaries are deliberately not stored in the GitHub Actions cache. Playwright's CI guidance notes that restoring browser caches often takes about as long as downloading them. Each matrix shard therefore installs only the engine it needs:

- Chromium shard: Chromium
- Firefox shard: Firefox
- WebKit desktop shard: WebKit
- iPhone WebKit shard: WebKit

This keeps the cache deterministic and avoids caching operating-system dependencies. The two WebKit shards remain separate so their reports and failures are isolated.

## Flaky-test policy

CI allows one retry so the report can distinguish three outcomes:

- **passed** — passed on the first attempt;
- **flaky** — failed first and passed on retry;
- **failed** — failed the first attempt and every retry.

A retry is diagnostic, not an acceptance rule. Browser commands use `--fail-on-flaky-tests`, and the unified report enforces all of these limits:

- failed tests: maximum `0`;
- flaky tests: maximum `0`;
- required Playwright projects: all must be present;
- unmapped projects: `0`;
- projects outside the workflow's declared selection: `0`.

`scripts/playwright-report-summary.mjs` writes the Markdown and compact JSON results before returning a failing exit code. This means a red reliability check still leaves a readable workflow summary and downloadable evidence.

## Failure and retry evidence

On CI, Playwright uses `retain-on-failure-and-retries` for traces and videos. Successful first attempts do not retain those files. A failed attempt or retry does retain evidence, including a retry that later passes and is classified as flaky.

Screenshots remain `only-on-failure`. Browser artifacts include `test-results/`, so retained traces, videos and screenshots are available beside the HTML report.

Each shard still uses one Playwright worker. PR #55 does not increase worker concurrency inside a browser shard.

## Per-engine reports

Each browser shard produces three reporters on CI:

- GitHub annotations for immediate failure context;
- an HTML report for engine-specific investigation;
- a Playwright blob report that can be merged after the matrix finishes.

The engine-specific HTML artifacts are retained for seven days:

- `playwright-report-chromium`
- `playwright-report-firefox`
- `playwright-report-webkit`
- `playwright-report-iphone-webkit`

Blob artifacts use the prefix `playwright-blob-` and are retained for one day because they are intermediate merge inputs.

## Unified pull-request report

`Browser E2E / Unified report` runs after all four matrix shards, including when a shard reports test failures or flaky tests. The job:

1. downloads every `playwright-blob-*` artifact into one directory with `actions/download-artifact@v8`;
2. runs `playwright merge-reports` to create one HTML report and one JSON report;
3. runs `scripts/playwright-report-summary.mjs` to group results into Chromium, Firefox, WebKit desktop and iPhone WebKit;
4. writes passed, flaky, failed, skipped, total and cumulative test time to the GitHub Actions job summary;
5. enforces the zero-failed and zero-flaky guardrails;
6. uploads `playwright-report-unified` for seven days.

The unified artifact contains:

- `playwright-report/` — merged interactive HTML report;
- `playwright-summary.json` — Playwright's merged JSON output;
- `playwright-summary.compact.json` — engine-group totals and guardrail results;
- `playwright-summary.md` — the same table shown in the workflow summary.

If a browser job fails before producing a blob report, the summary marks the corresponding Playwright projects as missing instead of reporting a false pass.

## Nightly E2E reliability

`.github/workflows/e2e-reliability.yml` runs daily at `18:17 UTC`, which is `01:17` in Vietnam. GitHub may start scheduled workflows later during periods of high Actions load. The same workflow can be started manually with `3`, `5` or `10` repetitions per test.

The default five-repeat run covers four critical upload-to-export journeys:

| Engine group | Project | Spec | Tests per repeat |
| --- | --- | --- | ---: |
| Chromium desktop | `chromium-desktop` | `upload-export-journey.desktop.spec.js` | 2 |
| Firefox | `cross-firefox` | `cross-browser-export.cross.spec.js` | 2 |
| WebKit desktop | `cross-webkit` | `cross-browser-export.cross.spec.js` | 2 |
| iPhone 13 WebKit | `webkit-iphone-13` | `iphone-webkit-upload-export.iphone.spec.js` | 2 |

At the default setting this produces 40 journey executions: four shards × two tests × five repetitions. Shards may run in parallel, but each shard remains at one Playwright worker.

The nightly command also uses one retry and `--fail-on-flaky-tests`. Its unified summary expects exactly these four projects and applies the same zero-failed, zero-flaky, complete and mapped guardrails as pull-request CI.

Nightly artifacts are retained longer for investigation:

- per-engine reports: 14 days;
- `playwright-reliability-report-unified`: 14 days;
- intermediate `playwright-reliability-blob-*` inputs: 2 days.

## Reliability history

`Reliability / Trend and incident` runs after the unified nightly job with `always()`, except when the workflow is cancelled. It therefore still records an incident when browser execution, blob merge or summary generation fails.

`scripts/reliability-history.mjs` reads the current compact summary and the most recent official history artifact. It:

1. converts the current run into `passed`, `failed` or `incomplete`;
2. deduplicates the same workflow run and attempt;
3. keeps the latest 30 scheduled runs;
4. calculates the recent pass rate and current status streak;
5. writes a 14-run Markdown trend table;
6. creates a deterministic incident plan and issue body.

If the unified compact JSON is missing or malformed, the current run is recorded as `incomplete`. Expected projects are listed as missing and the merge-job result is included as a violation. The observability job does not silently turn an infrastructure failure into a pass.

Official scheduled history is uploaded as `playwright-reliability-history` for 90 days. It contains:

- `reliability-history.json` — up to 30 normalized scheduled runs;
- `reliability-trend.md` — the recent trend shown in the Actions summary;
- `reliability-incident-body.md` — the deterministic managed issue body;
- `reliability-incident-plan.json` — the action and idempotency markers for issue automation.

Manual `workflow_dispatch` runs upload `playwright-reliability-history-manual`. They create a standalone preview and never become the input for official scheduled history.

## Reliability incident issue

Only scheduled runs manage the issue titled `[E2E Reliability] Nightly browser reliability incident` with label `e2e-reliability`.

Lifecycle:

1. The first `failed` or `incomplete` scheduled run creates the issue.
2. Later failed runs update the same issue and add at most one comment per workflow run attempt.
3. A closed incident is reopened if a later scheduled run fails.
4. The first clean scheduled run updates the issue, adds one recovery comment and closes it as completed.
5. A clean scheduled run with no open incident performs no issue mutation.

Stable HTML markers in the body and comments make reruns idempotent. Manual runs cannot open, update, reopen or close the incident issue.
