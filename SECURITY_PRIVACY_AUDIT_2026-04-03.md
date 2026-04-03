# Security & Privacy Audit Notes (2026-04-03)

## Scope
- CSP/allowlist alignment
- CDN supply-chain risks
- Client-side image privacy and telemetry data flow
- File input validation and attack surface

## High-level findings
1. CSP and JS allowlist are mostly aligned for AI/CDN origins, but `img-src` lacks `https://esm.sh` even though `esm.sh` appears in runtime sources.
2. `unsafe-eval` is currently required by AI runtime dependencies; this materially increases XSS blast radius if script execution is gained.
3. Telemetry payload includes file metadata (`fileName`, `mimeType`, `fileSize`) and can be sent to configured endpoint.
4. Validation checks file object shape/type/size but cannot guarantee actual binary content safety.
