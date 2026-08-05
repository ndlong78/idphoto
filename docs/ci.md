# Continuous Integration

## Runtime

GitHub Actions and local development use Node.js 24. Run `nvm use` from the repository root to select the version declared in `.nvmrc`.

The workflow uses the Node 24 generations of the official GitHub actions:

- `actions/checkout@v6`
- `actions/setup-node@v6`
- `actions/upload-artifact@v7`
- `actions/download-artifact@v8`

Workflow permissions are read-only (`contents: read`). A concurrency group cancels an older run when a newer commit is pushed to the same pull request or branch.

## Dependency cache

`actions/setup-node` caches npm's global package cache using `package-lock.json` as the dependency key. Jobs still run `npm ci`; `node_modules` is never cached.

Playwright Test is pinned once through `PLAYWRIGHT_VERSION` in `.github/workflows/ci.yml`. Browser and report-merging jobs install that exact test-runner version without changing `package.json` or `package-lock.json`.

## Browser binaries

Browser binaries are deliberately not stored in the GitHub Actions cache. Playwright's CI guidance notes that restoring browser caches often takes about as long as downloading them. Each matrix shard therefore installs only the engine it needs:

- Chromium shard: Chromium
- Firefox shard: Firefox
- WebKit desktop shard: WebKit
- iPhone WebKit shard: WebKit

This keeps the cache deterministic and avoids caching operating-system dependencies. The two WebKit shards remain separate so their reports and failures are isolated.

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

## Unified report

`Browser E2E / Unified report` runs after all four matrix shards, including when a shard reports test failures. The job:

1. downloads every `playwright-blob-*` artifact into one directory with `actions/download-artifact@v8`;
2. runs `playwright merge-reports` to create one HTML report and one JSON report;
3. runs `scripts/playwright-report-summary.mjs` to group results into Chromium, Firefox, WebKit desktop and iPhone WebKit;
4. writes passed, flaky, failed, skipped, total and cumulative test time to the GitHub Actions job summary;
5. uploads `playwright-report-unified` for seven days.

The unified artifact contains:

- `playwright-report/` — merged interactive HTML report;
- `playwright-summary.json` — Playwright's merged JSON output;
- `playwright-summary.compact.json` — compact engine-group totals;
- `playwright-summary.md` — the same table shown in the workflow summary.

If a browser job fails before producing a blob report, the summary marks the corresponding Playwright projects as missing instead of reporting a false pass.
