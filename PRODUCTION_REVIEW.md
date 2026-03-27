# Production Code Review — idphoto

## Scope
- bug logic
- null/undefined edge cases
- race condition
- error handling
- missing tests

## Findings

### 1) HIGH — Crash khi thiếu DOM node (null dereference)
- **File/line:** `src/ui.js:49-64,84-87,171,219-225,272-332,339-397,423-428`
- **Vì sao có thể lỗi:** Nhiều chỗ gọi trực tiếp `addEventListener`, `.style`, `.className`, `.textContent` trên `document.getElementById(...)` mà không guard null. Chỉ cần lệch ID trong HTML, feature flag ẩn block UI, hoặc refactor giao diện là app có thể crash ngay lúc khởi tạo/interaction.
- **Đề xuất fix ngắn:** Tạo helper `mustGetEl` (throw lỗi có context) hoặc guard mềm `if (!el) { logEvent(...); return; }` cho toàn bộ node critical.

### 2) HIGH — Race condition “stale async result” khi render lại nhiều lần
- **File/line:** `src/render.js:140-160`, `src/ui.js:204-215`, `src/crop.js:65,94,206`
- **Vì sao có thể lỗi:** `renderToPreview()` dùng `_renderPending` để không drop frame, nhưng không có version token. Nếu state thay đổi liên tục (drag + slider + AI reprocess), render cũ có thể hoàn tất sau render mới và ghi đè output tạm thời (flicker / hiển thị không khớp control tại thời điểm cuối).
- **Đề xuất fix ngắn:** Thêm `renderVersion` (monotonic counter): mỗi lần request render tăng version, chỉ commit kết quả nếu version hiện tại còn khớp.

### 3) MEDIUM — Timeout không hủy tác vụ AI thật sự (background task leak)
- **File/line:** `src/ai.js:63-75`, `src/ai.js:322-336`
- **Vì sao có thể lỗi:** `withTimeout()` chỉ `Promise.race` và reject timeout, nhưng `removeBackgroundFn(...)` phía dưới vẫn tiếp tục chạy (không abort). Người dùng retry có thể tạo nhiều tác vụ AI chồng nhau, tăng CPU/memory/network.
- **Đề xuất fix ngắn:** Ưu tiên API có `AbortSignal`/cancellation; nếu thư viện chưa hỗ trợ, thêm cơ chế “single-flight” cho `runBackgroundRemoval` + bỏ qua kết quả tác vụ cũ.

### 4) MEDIUM — Error handling bị nuốt, thiếu telemetry debug
- **File/line:** `src/main.js:87-89,102-104`, `src/ai.js:302-304`, `src/ui.js:516-523`
- **Vì sao có thể lỗi:** Nhiều `catch { ... }` không log error gốc. Khi production gặp lỗi liên quan model/CDN/permission clipboard, team khó root-cause vì mất stack/message chi tiết.
- **Đề xuất fix ngắn:** Chuẩn hóa `catch (err)` + `logEvent(..., { error: serializeError(err) })`; giữ message user-friendly nhưng vẫn lưu raw error trong telemetry.

### 5) MEDIUM — Thiếu guard input contract ở boundary public functions
- **File/line:** `src/main.js:217-233`, `src/state.js:78-87`, `src/dom.js:8-16`
- **Vì sao có thể lỗi:** `handleFile`, `validateImageFile`, `getControls` giả định shape input và DOM luôn đúng. Trong production (test automation, embed context, refactor HTML), undefined/null input có thể gây lỗi runtime gián tiếp.
- **Đề xuất fix ngắn:** Thêm guard sớm (`instanceof File`, null-safe cho control), trả error có ngữ cảnh để fail fast.

## Missing tests (nên bổ sung)
1. **UI null DOM resilience**: test `initUI()/setSection()/setLoad...` khi thiếu 1-2 element quan trọng không làm crash toàn app.
2. **Render stale-result**: test async render nhiều lần liên tiếp và assert chỉ lần request cuối cùng được commit lên preview.
3. **AI timeout + retry**: test timeout xong retry không tạo hai job chạy song song (hoặc kết quả job cũ không overwrite state mới).
4. **Error telemetry quality**: test bắt buộc `logEvent` chứa `error` detail khi `detectFace/runBackgroundRemoval/copyToClipboard` fail.
5. **Boundary input**: test `handleFile(undefined)`/fake file object để đảm bảo trả lỗi graceful thay vì throw runtime.
