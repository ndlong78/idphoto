// ═══════════════════════════════════════════════════════════════
// pipeline.js — Tên bước xử lý & state machine tuyến tính
//
// Vai trò:
//   Cung cấp tên bước (STEPS) và hàm chuyển bước (nextStep) để
//   main.js có thể log tiến trình mà không cần hardcode chuỗi.
//
// Lưu ý: pipeline KHÔNG kiểm soát luồng thực thi — đó là việc
//   của main.js với async/await. Pipeline chỉ là enum + helper.
// ═══════════════════════════════════════════════════════════════

/** Enum các bước xử lý theo thứ tự tuyến tính */
export const STEPS = /** @type {const} */ ({
  IDLE:         'idle',
  LOADING_LIBS: 'loading_libs',
  DETECT_FACE:  'detect_face',
  REMOVE_BG:    'remove_bg',
  RENDER_DONE:  'render_done',
});

const STEP_ORDER = /** @type {string[]} */ (Object.values(STEPS));

/**
 * Trả về bước tiếp theo trong pipeline.
 * Nếu đã ở bước cuối (RENDER_DONE) thì giữ nguyên.
 * Nếu step không hợp lệ thì reset về IDLE.
 *
 * @param {string} step - Bước hiện tại
 * @returns {string} Bước tiếp theo
 */
export function nextStep(step) {
  const idx = STEP_ORDER.indexOf(step);
  if (idx === -1) return STEPS.IDLE;
  return STEP_ORDER[Math.min(idx + 1, STEP_ORDER.length - 1)];
}

/**
 * Kiểm tra một chuỗi có phải bước hợp lệ không.
 * Hữu ích cho guard trong tests.
 *
 * @param {string} step
 * @returns {boolean}
 */
export function isValidStep(step) {
  return STEP_ORDER.includes(step);
}
