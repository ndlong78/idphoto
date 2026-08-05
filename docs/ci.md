# Continuous Integration

## Runtime

GitHub Actions and local development use Node.js 24. Run `nvm use` from the repository root to select the version declared in `.nvmrc`.

The workflow uses the Node 24 generations of the official GitHub actions:

- `actions/checkout@v6`
- `actions/setup-node@v6`
- `actions/upload-artifact@v7`

Workflow permissions are read-only (`contents: read`). A concurrency group cancels an older run when a newer commit is pushed to the same pull request or branch.

## Dependency cache

`actions/setup-node` caches npm's global package cache using `package-lock.json` as the dependency key. Jobs still run `npm ci`; `node_modules` is never cached.

Playwright Test is pinned once through `PLAYWRIGHT_VERSION` in `.github/workflows/ci.yml`. Browser jobs install that exact test-runner version without changing `package.json` or `package-lock.json`.

## Browser binaries

Browser binaries are deliberately not stored in the GitHub Actions cache. Playwright's CI guidance notes that restoring browser caches often takes about as long as downloading them. Each matrix shard therefore installs only the engine it needs:

- Chromium shard: Chromium
- Firefox shard: Firefox
- WebKit desktop shard: WebKit
- iPhone WebKit shard: WebKit

This keeps the cache deterministic and avoids caching operating-system dependencies. The two WebKit shards remain separate so their reports and failures are isolated.

## Reports

Each browser shard uploads its own seven-day artifact:

- `playwright-report-chromium`
- `playwright-report-firefox`
- `playwright-report-webkit`
- `playwright-report-iphone-webkit`
