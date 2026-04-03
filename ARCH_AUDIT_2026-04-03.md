# Architecture audit notes (2026-04-03)

This document captures a point-in-time architecture/code-quality assessment of `idphoto-mvp`.

## Key risks

1. `ui.initUI` and `main.processFile` are orchestration-heavy and couple UI, domain state, and async flow.
2. Global mutable `state` is modified from multiple modules without a strict state-transition layer.
3. Error handling is mostly best-effort; several paths degrade silently by design (telemetry/storage/network fallback), reducing debuggability.

## Candidate refactors

- Introduce `appController` + explicit finite state machine for upload/loading/editor/reprocess flows.
- Add `state mutations` facade (`setCurrentFormat`, `setFaceOffset`, `setBgColor`, etc.) with invariant checks.
- Separate rendering pipeline into pure functions + side-effect adapters.
