# Test suite gap analysis (2026-04-03)

## Snapshot
- Current run shows 97 tests passing (`node --test`), with overall line coverage ~56.84%.
- Largest gaps are orchestration-heavy modules: `main.js`, `ui.js`, `crop.js`, and async-heavy `ai.js`.

## Priority gaps
1. `main.js`: end-to-end pipeline/race flows are minimally covered (mainly input guard tests).
2. `ai.js`: timeout/retry/degraded mode branches are largely untested.
3. `ui.js`/`crop.js`: behavior coverage is shallow (`doesNotThrow` style), little assertion of visible outcomes.

## Immediate next tests
- Add tests for AI warmup timeout to flood-fill fallback behavior.
- Add tests for concurrent upload run cancellation (`activeRunId` stale run drop).
- Add tests for `reprocessAI()` busy-guard toast path.
- Add tests for hi-res export while preview render lock is active.
- Add tests for repeated `initCrop()` listener cleanup (no duplicate handlers).
