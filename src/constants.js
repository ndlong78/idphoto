// ═══════════════════════════════════════════════════════════════
// constants.js — Hằng số dùng chung, thay thế magic numbers
//
// Lý do tách ra file riêng:
//   - Dễ tìm kiếm khi cần điều chỉnh tham số
//   - Tên rõ ràng hơn số thuần túy giúp đọc code không cần comment
//   - Test có thể import để kiểm tra range hợp lệ
// ═══════════════════════════════════════════════════════════════

// ── Crop / zoom ──────────────────────────────────────────────
/** Fit ảnh vào canvas với padding 6% mỗi phía */
export const CROP_FIT_MARGIN         = 0.94;

/**
 * Giới hạn zoom tối đa khi fit — ngăn ảnh thumbnail nhỏ (ví dụ 50×50)
 * bị phóng to cực kỳ lớn và gây mất kiểm soát crop.
 */
export const CROP_FIT_MAX_SCALE      = 8;

/** Khuôn mặt chiếm 65% chiều cao frame khi auto-center */
export const CROP_FACE_SCALE_FACTOR  = 0.65;

/**
 * Tâm khuôn mặt nằm ở 37% từ trên frame.
 * Ảnh hộ chiếu chuẩn quốc tế đặt mắt/mũi lên vùng trên-giữa.
 */
export const CROP_FACE_VERTICAL_BIAS = 0.37;

/**
 * Tỉ lệ khuôn mặt theo từng chuẩn giấy tờ.
 *
 * - faceScaleFactor: chiều cao mặt (bounding box AI) so với chiều cao khung.
 * - topPaddingRatio: khoảng cách từ đỉnh khung tới đỉnh bounding box khuôn mặt.
 *
 * Lưu ý: box của TinyFaceDetector thường không gồm toàn bộ tóc, nên cần chừa
 * khoảng đỉnh hợp lý để tránh cảm giác "chạm đầu" ở ảnh visa.
 */
export const CROP_FACE_LAYOUT_BY_FORMAT = {
  'passport-vn': { faceScaleFactor: 0.66, topPaddingRatio: 0.11 },
  cccd:          { faceScaleFactor: 0.64, topPaddingRatio: 0.12 },
  'us-visa':     { faceScaleFactor: 0.68, topPaddingRatio: 0.09 },
  schengen:      { faceScaleFactor: 0.66, topPaddingRatio: 0.11 },
  'uk-visa':     { faceScaleFactor: 0.66, topPaddingRatio: 0.11 },
  japan:         { faceScaleFactor: 0.65, topPaddingRatio: 0.12 },
};

// ── AI / face detection ───────────────────────────────────────
/**
 * Input size của TinyFaceDetector — phải là bội số 32.
 * 416 = 13 × 32, cân bằng tốt giữa tốc độ và độ chính xác.
 */
export const FACE_DETECT_INPUT_SIZE  = 416;

/** Score tối thiểu để nhận dạng khuôn mặt hợp lệ (0–1) */
export const FACE_DETECT_THRESHOLD   = 0.28;

/**
 * Timeout 90 giây cho CDN chậm hoặc model download bị treo.
 * Nếu vượt quá, caller nhận null và fallback về flood fill.
 */
export const AI_TIMEOUT_MS           = 90_000;

// ── Flood fill fallback ───────────────────────────────────────
/**
 * Ngưỡng color distance (Euclidean có trọng số luma) để
 * phân biệt foreground / background khi không có AI.
 * 44 ≈ ΔE 6–8 trong không gian sRGB — đủ nhạy với nền đồng màu.
 */
export const FLOOD_FILL_TOLERANCE    = 44;

// ── Skin smoothing ────────────────────────────────────────────
/**
 * Blend tối đa 88% low-frequency vào pixel da.
 * Giữ lại 12% micro-texture (lỗ chân lông, nếp nhăn nhỏ)
 * để kết quả không trông như da nhựa.
 */
export const SKIN_MAX_BLEND          = 0.88;

/** Bán kính blur tối đa (px) khi skin slider ở 100% */
export const SKIN_BLUR_RADIUS_MAX    = 8;

// ── Face shadow correction ────────────────────────────────────
/**
 * Mức tăng sáng tối đa (0–255) khi làm sáng vùng bóng tối trên khuôn mặt.
 * 80 ≈ nâng pixel tối (~30 luma) lên vùng trung bình (~110 luma) ở strength=1.
 */
export const SHADOW_LIFT_MAX         = 80;

// ── Debounce (ms) ─────────────────────────────────────────────
/**
 * Skin slider debounce — boxBlurRGB + getImageData/putImageData
 * có thể >50ms trên main thread (Chrome flag violation).
 */
export const SKIN_DEBOUNCE_MS        = 250;

/**
 * Feather slider debounce — distance transform O(W·H)
 * đủ nặng để cần debounce, nhưng nhẹ hơn skin nên threshold thấp hơn.
 */
export const FEATHER_DEBOUNCE_MS     = 150;

/**
 * Shadow slider debounce — hai vòng lặp O(W·H) tương tự skin,
 * dùng cùng ngưỡng để đảm bảo responsiveness.
 */
export const SHADOW_DEBOUNCE_MS      = 250;
