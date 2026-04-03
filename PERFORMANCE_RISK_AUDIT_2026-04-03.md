# Performance risk audit (2026-04-03)

## Focus
- Main-thread hotspots for large images (>5MB, >3000px)
- Memory behavior under repeated edit/reset/export
- RAF/debounce responsiveness
- Network/warmup worst-case UX

## Key findings
1. Main-thread hotspots remain in pixel loops (`applyAdjustments`, `floodFill`, `featherMask`, CPU blur fallback).
2. Canvas reuse strategy is generally safe; largest memory growth risk is retained module-level blur buffers sized by historical max image.
3. Crop loop uses dirty-flag pattern correctly, but 60ms debounce may feel laggy during fast slider drag.
4. Worst-case user wait can approach ~130s before fallback completion messaging.

## Fast fixes
- Move heavy blur/floodfill to Worker + OffscreenCanvas where available.
- Cap processing resolution for preview path; keep full-res for export only.
- Add explicit timeout-stage messaging and “continue without AI” CTA earlier.
