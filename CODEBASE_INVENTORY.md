# Codebase Inventory – idphoto

## 1. Project Overview

- **Tên dự án:** `idphoto-mvp` (web app xử lý ảnh thẻ/visa chạy 100% trên trình duyệt, không upload ảnh lên server).
- **Kiểu dự án:** Vanilla JavaScript (ES Modules), không dùng bundler/build step.
- **Mục tiêu chính:** Upload ảnh người dùng → nhận diện khuôn mặt + tách nền (AI/fallback) → chỉnh sửa/crop → export ảnh đúng chuẩn kích thước/DPI.
- **Runtime:** Browser (front-end only).
- **Test runner:** `node --test` cho unit/integration style tests.
- **Lint:** ESLint cấu hình cho `src/` và `tests/`.

### Assumptions / giới hạn phân tích

- Repo hiện tại **không có** thư mục `.github/workflows/`, `scripts/`, và **không có file AGENTS.md trong filesystem repo**.
- Phân tích dependency/callers được dựng từ import graph tĩnh + luồng gọi hàm trong code hiện tại.
- Một số “internal helper” trong file rất nhiều; tài liệu liệt kê đầy đủ helper quan trọng (đặc biệt ở `render.js`, `ui.js`, `ai.js`).

---

## 2. Architecture Summary

### Kiến trúc module (high-level)

- **Entry/UI orchestration:** `src/main.js`
- **State + config dữ liệu cốt lõi:** `src/state.js`, `src/constants.js`, `src/pipeline.js`
- **AI layer:** `src/ai.js`
- **Rendering/processing pixel:** `src/render.js`
- **Crop/zoom interaction:** `src/crop.js`
- **DOM adapter nhỏ:** `src/dom.js`
- **UI event wiring + export:** `src/ui.js`
- **Security guard (CDN allowlist):** `src/security.js`
- **Observability/telemetry:** `src/telemetry.js`

### Tính chất thiết kế nổi bật

- **Client-only processing** + CSP chặt (nhưng có `unsafe-eval` do ràng buộc onnxruntime-web).
- **AI graceful degradation:** nếu warmup/model fail thì fallback flood-fill thay nền.
- **Render concurrency guard:** có lock/pending/version để tránh stale frame.
- **UI resilience:** nhiều guard khi thiếu DOM node, giảm crash hard.
- **Test coverage trải rộng:** state validation, pipeline enum, security allowlist, render math/pixel logic, async ordering, ui guard, smoke imports, user journey.

---

## 3. File Inventory by Directory

## Root

- `package.json`: scripts + devDependencies.
- `package-lock.json`: lock dependency.
- `README.md`: mô tả sản phẩm, hướng dẫn chạy/test/lint, network/security notes.
- `PRODUCTION_REVIEW.md`: review kỹ thuật + risk list + đề xuất test bổ sung.
- `index.html`: cấu trúc UI + CSP + script entry (`./src/main.js`).
- `style.css`: toàn bộ styling/layout của app.
- `eslint.config.js`: cấu hình lint.

## `src/`

- `main.js`: điều phối end-to-end pipeline.
- `ai.js`: load external AI libs, face detection, background removal.
- `render.js`: render output canvas (AI/fallback), chỉnh ảnh, smoothing, feather, shadow.
- `crop.js`: crop canvas interactions (drag/wheel/pinch), frame math.
- `ui.js`: bind event UI, section state, toast, download/copy/lightbox.
- `state.js`: global state + formats + file validation.
- `constants.js`: hằng số tune thuật toán/UX.
- `pipeline.js`: pipeline step enum/helper.
- `dom.js`: adapter đọc input controls + sync zoom label.
- `security.js`: URL allowlist assertion.
- `telemetry.js`: local telemetry buffer + endpoint dispatch.

## `tests/`

- `ai-version.test.js`
- `dom.test.js`
- `main-guards.test.js`
- `pipeline.test.js`
- `render-async-ordering.test.js`
- `render.test.js`
- `security.test.js`
- `smoke-imports.test.js`
- `telemetry.test.js`
- `ui.test.js`
- `user-journey.test.js`
- `validation.test.js`

---

## 4. Detailed File Breakdown

### 4.1 `package.json`
- **Role:** Khai báo metadata dự án, scripts test/lint.
- **Imports/Exports:** N/A.
- **Key scripts:**
  - `test`, `test:watch`, `test:coverage`
  - `lint`, `lint:fix`
- **Dependencies:** Dev-only ESLint stack.
- **Risks/Notes:** Không có build script; app chạy trực tiếp từ static server.

### 4.2 `README.md`
- **Role:** Tài liệu sử dụng/chạy app, tính năng, network requirements, privacy/security posture.
- **I/O:** Tài liệu hướng dẫn con người, không runtime.
- **Risks/Notes:** Có note rõ CSP `unsafe-eval` là bắt buộc cho dependency AI.

### 4.3 `index.html`
- **Role:** HTML shell + toàn bộ DOM IDs/classes mà JS modules phụ thuộc.
- **Public API:** Không export, nhưng là **DOM contract** cho `ui.js/crop.js/render.js/main.js`.
- **Side effects:** CSP meta, tải font ngoài, mount script `src/main.js`.
- **Dependencies:** `style.css`, fonts, CSP allowlisted CDNs.
- **Callers/Users:** Browser loader.
- **Risks:** Sai ID DOM có thể gây degrade hoặc missing-feature (đã có guard ở `ui.js`, nhưng vẫn cần đồng bộ cẩn thận).

### 4.4 `style.css`
- **Role:** Styling cho upload/loading/editor, controls, lightbox, responsive layout.
- **Public API:** CSS selectors như `#upload-section`, `.fbtn`, `.sw`, `#result-canvas`.
- **Risks:** Ràng buộc chặt với markup IDs/classes; refactor HTML/CSS lệch nhau sẽ ảnh hưởng behavior UI.

### 4.5 `eslint.config.js`
- **Role:** Quy tắc lint cho source + test.
- **Risks:** Rule tương đối nhẹ, chủ yếu correctness/style cơ bản.

### 4.6 `src/state.js`
- **Role:** Single source of truth cho formats (`FMTS`) + mutable global `state` + reset/validate file.
- **Imports:** None.
- **Exports chính (public API):** `FMTS`, `state`, `resetState`, `validateImageFile`.
- **Function inventory:**
  - `resetState` (**public**, sync, side effect): reset hầu hết state runtime, giữ `aiReady`.
  - `validateImageFile` (**public**, sync): validate `File` shape/mime/ext/size.
- **Async/Event handler:** Không.
- **Dependencies:** Được dùng gần như toàn bộ module.
- **Callers:** `main.js`, `ui.js`, `crop.js`, `render.js`, `dom.js`, `ai.js`, tests.
- **I/O dữ liệu chính:** in: `File`; out: `{ok,error?}`; in-memory state object.
- **Risk:** Global mutable state nên dễ tạo coupling/race nếu tăng độ phức tạp.

### 4.7 `src/constants.js`
- **Role:** Hằng số tuning cho crop, AI, flood fill, skin/shadow, debounce.
- **Exports:** nhiều const (`CROP_*`, `FACE_*`, `AI_TIMEOUT_MS`, `FLOOD_FILL_TOLERANCE`, ...).
- **Function inventory:** Không có function.
- **Public API:** toàn bộ const exports.
- **Dependencies:** `ai.js`, `crop.js`, `render.js`, `ui.js`.
- **Risk:** Magic number tuning nhạy cảm UX/chất lượng ảnh; thay đổi cần test hình ảnh thực tế.

### 4.8 `src/pipeline.js`
- **Role:** Enum bước + helper chuyển bước.
- **Imports:** None.
- **Exports:** `STEPS`, `nextStep`, `isValidStep`.
- **Functions:**
  - `nextStep` (**public**, sync): state machine tuyến tính, terminal ở `RENDER_DONE`.
  - `isValidStep` (**public**, sync).
- **Risk:** Đơn giản, low risk.

### 4.9 `src/security.js`
- **Role:** Guard URL từ remote resource theo allowlist HTTPS.
- **Imports:** `logEvent` từ `telemetry.js`.
- **Exports:** `isAllowedRemoteUrl`, `assertAllowedRemoteUrl`, `getAllowedOrigins`.
- **Functions:**
  - `isAllowedRemoteUrl` (**public**, sync helper).
  - `assertAllowedRemoteUrl` (**public**, sync, side effect: telemetry + throw).
  - `getAllowedOrigins` (**public**, sync).
- **Dependencies:** dùng ở `ai.js`.
- **Risk:** Nếu thêm CDN mới quên cập nhật cả CSP + allowlist sẽ fail runtime.

### 4.10 `src/telemetry.js`
- **Role:** Logging event cục bộ + optional gửi endpoint; serialize error an toàn.
- **Imports:** None.
- **Exports:** `setTelemetryContext`, `serializeErrorForTelemetry`, `logEvent`, `getTelemetryEvents`, `clearTelemetryEvents`.
- **Functions quan trọng:**
  - `serializeErrorForTelemetry` (**public**, sync): lọc field an toàn.
  - `logEvent` (**public**, sync+best effort async send): ghi localStorage + console + sendBeacon/fetch.
  - `setTelemetryContext`, `getTelemetryEvents`, `clearTelemetryEvents` (**public**).
  - Internal helpers: `buildLocalContext`, `buildFullContext`, `sendToEndpoint`, ...
- **Async:** `sendToEndpoint` dùng async API kiểu fire-and-forget.
- **Side effects:** localStorage, console, network POST.
- **Risk:** telemetry có thể tăng noise nếu payload lớn; đã có truncate.

### 4.11 `src/dom.js`
- **Role:** Lấy controls DOM an toàn và sync zoom UI.
- **Imports:** `state`.
- **Exports:** `getControls`, `syncZoomUI`.
- **Functions:**
  - `getControls` (**public**, sync): trả input hoặc fallback object khi thiếu DOM.
  - `syncZoomUI` (**public**, sync, side effect DOM).
  - Internal: `fallbackInput`, `getNumericInput`.
- **Risk:** fallback giúp non-crash nhưng có thể che lỗi markup.

### 4.12 `src/ai.js`
- **Role:** Tải module tách nền + face-api script/model; chạy detect face và remove background.
- **Imports chính:** `state`, constants AI/face, `assertAllowedRemoteUrl`, telemetry helpers.
- **Exports:** `validateAiSourceVersions`, `warmupAi`, `loadFaceModels`, `detectFace`, `runBackgroundRemoval`.
- **Function inventory (quan trọng):**
  - `validateAiSourceVersions` (**public**, sync): fail-fast nếu URL không pin đúng version.
  - `warmupAi` (**public**, async): import dynamic module tách nền, set `state.aiReady`.
  - `loadFaceModels` (**public**, async): idempotent + chống concurrent duplicate load.
  - `detectFace` (**public**, async): detect 1 face trên canvas.
  - `runBackgroundRemoval` (**public**, async): chạy AI remove BG, timeout, convert blob→img.
  - Internal helpers: `withTimeout`, `loadScriptSequentially`, `normalizeWarmupErrorMessage`, ...
- **Event handlers:** script `onload/onerror` nội bộ.
- **Side effects:** import remote module/script, update state, telemetry.
- **Dependencies:** `security.js`, `telemetry.js`, `state.js`, `constants.js`.
- **Callers:** `main.js`, tests.
- **I/O:** Input `File`/`canvas`; output `HTMLImageElement|null`/face detection object.
- **Risk:** timeout không cancel tác vụ nền thật sự (được nêu trong review); phụ thuộc mạng/CDN/CSP.

### 4.13 `src/crop.js`
- **Role:** Điều khiển crop canvas tương tác + tính frame theo format.
- **Imports:** `state/FMTS`, `renderToPreview`, `syncZoomUI`, constants crop.
- **Exports:** `initCrop`, `cleanupCropEvents`, `computeFrame`, `fitImage`, `centerFace`, `applyZoom`, `shiftCropByPercent`.
- **Function inventory:**
  - `initCrop` (**public**, sync, side effect lớn): bind toàn bộ mouse/touch/wheel listeners + RAF loop.
  - `cleanupCropEvents` (**public**, sync): abort listeners + cancel RAF.
  - `computeFrame`, `fitImage`, `centerFace`, `applyZoom`, `shiftCropByPercent` (**public**; nhiều hàm trigger render).
  - Internal: `drawCrop`, `distance`.
- **Async:** Không, nhưng gọi `void renderToPreview()` bất đồng bộ.
- **Event handlers:** mousedown/mousemove/mouseup/wheel/touchstart/touchmove/touchend.
- **Side effects:** mutate `state.crop/state.frame`; DOM canvas draw; add/remove listeners.
- **Risk:** module tương tác trực tiếp input events dày đặc, dễ phát sinh performance/race UX.

### 4.14 `src/render.js`
- **Role:** lõi xử lý ảnh pixel + tổng hợp layers để preview/export.
- **Imports:** `state/FMTS`, `getControls`, constants render.
- **Exports (public API):**
  - Runtime: `renderResult`, `renderResultParts`, `renderToPreview`
  - Test hooks: `__setPreviewRenderPartsForTest`, `__resetPreviewRenderStateForTest`
  - Utility tested: `featherMask`, `colorDistance`, `isSkinPixel`, `isSkinPixelForShadow`, `applyFaceShadowCorrection`, `clamp`
- **Function inventory (quan trọng):**
  - `renderResult` (**public**, async): render canvas theo scale.
  - `renderResultParts` (**public**, async): tạo 3 lớp `composed/background/faceCutout`.
  - `renderToPreview` (**public**, async): render vào `#result-canvas`, có lock/pending/version chống stale.
  - Internal core: `composeResultLayers`, `getCropRect`, `mapCropRect`, `applyAdjustments`, `floodFill`, `blendAiAlpha`, `applyFloodFillAlpha`, `applySkinSmoothing`, `unsharpMask`, `boxBlurRGB`.
- **Async:** `renderResult`, `renderResultParts`, `renderToPreview`.
- **Side effects:** canvas mutations, đọc controls DOM, state-dependent output.
- **Dependencies:** heavily called by `ui.js`, `crop.js`, `main.js`, tests.
- **I/O:** Input từ `state` + DOM sliders; output canvas/layers.
- **Risk cao:** thuật toán pixel + performance + concurrent preview/export.

### 4.15 `src/ui.js`
- **Role:** trung tâm binding UI events + section/status cập nhật + download/copy/lightbox.
- **Imports:** crop APIs, render APIs, state/FMTS/reset, constants debounce, telemetry.
- **Exports:** `initUI`, `setSection`, `setSteps`, `setLoad`, `setProgress`, `setLoadStep`, `setFaceStatus`, `setAiInfoBar`, `toast`, `download`, `copyToClipboard`, `mountEditor`.
- **Function inventory (điểm chính):**
  - `initUI` (**public**, sync, side effect lớn): bind tất cả event handlers.
  - `download` (**public**, async): export ảnh theo mode/DPI.
  - `copyToClipboard` (**public**, async): clipboard API fallback new tab.
  - `mountEditor` (**public**, sync): chuyển section + init crop.
  - `set*` nhóm status/UI update (**public**, sync).
  - Internal helpers: `safeRender`, `bindClick`, `bindAsyncClick`, lightbox funcs, result frame transform funcs.
- **Event handlers:** upload drag/drop/change/click; zoom/drag result; sliders; format buttons; swatches; window resize; lightbox controls.
- **Async:** `safeRender`, async click wrappers, `download`, `copyToClipboard`.
- **Side effects:** DOM updates/listeners, state mutation, telemetry, window.open/clipboard.
- **Dependencies:** gọi sâu sang `crop.js` và `render.js`; phụ thuộc DOM contract nhiều nhất.
- **Risk cao:** module lớn, responsibilities rộng; dễ regression khi sửa UI.

### 4.16 `src/main.js`
- **Role:** entry point + orchestration pipeline upload→AI→render→UI status.
- **Imports:** ai/pipeline/render/state/telemetry/ui.
- **Exports:** `assertBrowserFileInput`.
- **Function inventory:**
  - `assertBrowserFileInput` (**public**, sync guard).
  - Internal orchestration: `processFile`, `reprocessAI`, `handleFile`, `loadImageFromFile`, `withTimeoutFallback`, `getOrigCanvasOrThrow`, `assertReadyForReprocess`.
- **Async:** `processFile`, `reprocessAI`, `handleFile`, `withTimeoutFallback`.
- **Event handlers:** `DOMContentLoaded` + callbacks truyền cho `initUI`.
- **Side effects:** state mutation, UI step updates, telemetry logs, toasts.
- **Dependencies:** gần như toàn bộ module runtime.
- **Risk:** orchestration async phức tạp nhất (guard concurrency, fallback paths).

### 4.17 `tests/*`

> Nhóm test không export API, nhưng là tài liệu sống về behavior kỳ vọng.

- `validation.test.js`: boundary validation file upload.
- `pipeline.test.js`: enum + transition correctness.
- `security.test.js`: allowlist và assert throw.
- `telemetry.test.js`: console level + error serialization privacy.
- `dom.test.js`: fallback DOM adapter.
- `main-guards.test.js`: guard `assertBrowserFileInput`.
- `render.test.js`: clamp/colorDistance/skin detection/feather/shadow correction.
- `render-async-ordering.test.js`: chống stale render commit.
- `ui.test.js`: resilience khi thiếu DOM node.
- `smoke-imports.test.js`: import all modules không crash top-level.
- `user-journey.test.js`: flow upload→render→download ở mức integration.
- `ai-version.test.js`: version pinning consistency cho AI URLs.

---

## 5. Main Application Flow

## Entry point

1. `index.html` load `<script type="module" src="./src/main.js">`.
2. `main.js` đăng ký `DOMContentLoaded`.
3. Trong callback: set telemetry context + gọi `initUI({...handlers...})`.

## Luồng chính upload → xử lý → render → export

1. **Upload trigger**
   - Event từ `ui.js` (`drop/change/click`) gọi `handleFile(file)` trong `main.js`.
2. **Validation + load image**
   - `assertBrowserFileInput` → `validateImageFile` → `loadImageFromFile`.
3. **Pipeline processing (`processFile`)**
   - `warmupAi()` + `loadFaceModels()` chạy song song có timeout fallback.
   - vẽ ảnh gốc lên `#orig-canvas`.
   - `detectFace()` nếu face model sẵn sàng.
   - `runBackgroundRemoval()` nếu AI ready; nếu fail dùng fallback flood-fill.
4. **Mount editor + preview**
   - `mountEditor()` -> `initCrop()`.
   - `renderToPreview()` để hiển thị `#result-canvas`.
5. **Interactive edit**
   - Crop/zoom kéo ảnh (`crop.js`, `ui.js`) + sliders/swatches/format -> gọi `renderToPreview()`.
6. **Export**
   - `download(mode)` -> `renderResult(scale)` hi-res -> `toDataURL` + click `<a>`.
   - Hoặc `copyToClipboard()` qua Clipboard API/fallback tab mới.

---

## 6. Key Modules

### Nhóm UI
- `src/ui.js`
- `src/dom.js`
- `index.html`
- `style.css`

### Nhóm state
- `src/state.js`
- `src/pipeline.js`
- `src/constants.js`

### Nhóm render/crop
- `src/render.js`
- `src/crop.js`

### Nhóm AI
- `src/ai.js`
- `src/security.js` (guard URL cho remote AI assets)

### Nhóm test
- Toàn bộ `tests/*.test.js`.

### Shared utilities / cross-cutting
- `src/telemetry.js`
- `src/security.js`
- `src/constants.js`

---

## 7. Top 10 Important Files

1. `src/main.js` — orchestrator tổng.
2. `src/ui.js` — toàn bộ event/UI/export.
3. `src/render.js` — lõi xử lý ảnh.
4. `src/ai.js` — tích hợp AI + network/CDN.
5. `src/crop.js` — crop interactions & geometry.
6. `src/state.js` — state contract + formats.
7. `src/constants.js` — tuning constants cốt lõi.
8. `index.html` — DOM contract + CSP.
9. `tests/render.test.js` — mô tả chính xác behavior pixel helpers.
10. `tests/user-journey.test.js` — flow E2E logic (mocked) quan trọng.

---

## 8. Top 10 Important Functions

1. `processFile` (`src/main.js`) — pipeline end-to-end.
2. `handleFile` (`src/main.js`) — upload entry guard + trigger.
3. `initUI` (`src/ui.js`) — wiring tất cả UI events.
4. `renderResultParts` (`src/render.js`) — dựng lớp ảnh compositing.
5. `renderToPreview` (`src/render.js`) — render async có stale protection.
6. `runBackgroundRemoval` (`src/ai.js`) — AI background removal runtime.
7. `loadFaceModels` (`src/ai.js`) — model loading idempotent/concurrency-safe.
8. `detectFace` (`src/ai.js`) — face detection ảnh gốc.
9. `initCrop` (`src/crop.js`) — crop event lifecycle + RAF loop.
10. `download` (`src/ui.js`) — export hi-res output.

---

## 9. Risky or Complex Areas

1. **`src/render.js`**
   - Thuật toán pixel dày đặc + path AI/fallback + performance-sensitive blur/flood fill.
   - Có concurrency guard nhưng vẫn cần test regression khi thay đổi pipeline.

2. **`src/ui.js`**
   - Module lớn, nhiều responsibilities (binding, layout sync, export, lightbox, state mutation).
   - Rủi ro coupling cao với DOM IDs/CSS.

3. **`src/main.js`**
   - Orchestration async nhiều nhánh fallback; thay đổi dễ ảnh hưởng UX step/progress.

4. **`src/ai.js`**
   - Phụ thuộc CDN/CSP/network; timeout không hủy tác vụ nền thực sự (được nêu trong review).

5. **`index.html` + CSP**
   - CSP sai nhẹ có thể làm AI fail hard; cần đồng bộ với allowlist trong `security.js`.

---

## 10. Suggested Reading Order

### Lộ trình đọc cho developer mới

1. `README.md` (bối cảnh sản phẩm + cách chạy)
2. `index.html` (DOM contract + sections)
3. `src/state.js` + `src/constants.js` + `src/pipeline.js` (nền dữ liệu/state machine)
4. `src/main.js` (pipeline tổng)
5. `src/ui.js` (event wiring và hành vi người dùng)
6. `src/crop.js` (hành vi kéo/zoom/căn mặt)
7. `src/render.js` (core thuật toán ảnh)
8. `src/ai.js` + `src/security.js` (AI/network/security)
9. `src/telemetry.js` (quan sát lỗi/rủi ro production)
10. `tests/` theo thứ tự: `validation` → `pipeline` → `render` → `render-async-ordering` → `user-journey` → còn lại.

---

## 11. Public API vs Internal Helper (tóm tắt theo module)

- **Public API rõ ràng:**
  - `main.js`: `assertBrowserFileInput`
  - `ai.js`: `validateAiSourceVersions`, `warmupAi`, `loadFaceModels`, `detectFace`, `runBackgroundRemoval`
  - `render.js`: `renderResult`, `renderResultParts`, `renderToPreview`, test hooks + exported utils
  - `crop.js`: các hàm export crop lifecycle/geometry
  - `ui.js`: `initUI`, `set*`, `toast`, `download`, `copyToClipboard`, `mountEditor`
  - `state.js`: `FMTS`, `state`, `resetState`, `validateImageFile`
  - `dom.js`: `getControls`, `syncZoomUI`
  - `security.js`: `isAllowedRemoteUrl`, `assertAllowedRemoteUrl`, `getAllowedOrigins`
  - `telemetry.js`: `setTelemetryContext`, `serializeErrorForTelemetry`, `logEvent`, `getTelemetryEvents`, `clearTelemetryEvents`
  - `pipeline.js`: `STEPS`, `nextStep`, `isValidStep`

- **Internal helper tiêu biểu (không export):**
  - `main.js`: `processFile`, `reprocessAI`, `handleFile`, ...
  - `ai.js`: `withTimeout`, `loadScriptSequentially`, ...
  - `render.js`: `composeResultLayers`, `floodFill`, `boxBlurRGB`, ...
  - `ui.js`: `safeRender`, `bindClick`, `openLightbox`, ...
  - `crop.js`: `drawCrop`, `distance`

---

## 12. Modules thiếu test / nên refactor

### Có thể refactor

- **`src/ui.js`**: tách thành các submodule (`ui-binding`, `ui-status`, `ui-export`, `ui-lightbox`) để giảm kích thước file và cô lập rủi ro.
- **`src/main.js`**: tách pipeline runner thành service thuần logic để test dễ hơn (không dính DOM).
- **`src/render.js`**: cân nhắc tách `mask`, `adjustments`, `compositor`, `blur` thành modules nhỏ hơn.

### Khu vực nên tăng test

- Tăng integration test cho `main.js` flow lỗi (AI fail + face fail + retry AI).
- Test UI behavior sâu hơn: drag result face offset, lightbox flow, resize synchronization.
- Test performance regression cơ bản cho `render.js` (không cần benchmark chính xác, chỉ check không timeout ở dataset mẫu).
- Test cancellation/single-flight ở `ai.js` khi timeout + retry liên tiếp.

---

## 13. Self-check theo yêu cầu

- [x] Đã bao phủ các file chính trong `src/` và `tests/`.
- [x] Đã mô tả vai trò từng file quan trọng.
- [x] Đã liệt kê hàm quan trọng/public/internal, async, event-driven, side effects.
- [x] Đã có phần luồng hệ thống và thứ tự đọc repo.
- [x] Đã ghi rõ assumption ở phần đầu (những mục không tồn tại trong repo hiện tại).
