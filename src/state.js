const MILLIMETERS_PER_INCH = 25.4;

/**
 * Chuyển kích thước vật lý (mm) sang pixel theo DPI, làm tròn tới pixel gần nhất.
 *
 * @param {number} millimeters
 * @param {number} [dpi=300]
 * @returns {number}
 */
export function mmToPixels(millimeters, dpi = 300) {
  if (!Number.isFinite(millimeters) || millimeters <= 0) {
    throw new RangeError('Kích thước millimeter phải là số dương hữu hạn.');
  }
  if (!Number.isFinite(dpi) || dpi <= 0) {
    throw new RangeError('DPI phải là số dương hữu hạn.');
  }
  return Math.round((millimeters / MILLIMETERS_PER_INCH) * dpi);
}

function createFormat(mmW, mmH, lbl, dpi = 300) {
  return Object.freeze({
    w: mmToPixels(mmW, dpi),
    h: mmToPixels(mmH, dpi),
    mmW,
    mmH,
    lbl,
    dpi,
  });
}

export const FMTS = Object.freeze({
  // Cổng Dịch vụ công Bộ Công an yêu cầu ảnh chân dung hộ chiếu Việt Nam 4×6 cm.
  'passport-vn': createFormat(40, 60, '40 × 60 mm'),
  cccd:          createFormat(30, 40, '30 × 40 mm'),
  'us-visa':     createFormat(51, 51, '51 × 51 mm'),
  schengen:      createFormat(35, 45, '35 × 45 mm'),
  'uk-visa':     createFormat(35, 45, '35 × 45 mm'),
  japan:         createFormat(35, 45, '35 × 45 mm'),
});

// Contract xuất ảnh hiện giả định mọi preset dùng mốc 300 DPI.
// src/export.js tính scale = targetDpi / fmt.dpi để tạo file 300/600 DPI.
// Đồng thời kiểm tra kích thước pixel luôn khớp với kích thước vật lý đã khai báo.
for (const [key, fmt] of Object.entries(FMTS)) {
  if (fmt.dpi !== 300) {
    throw new Error(
      `FMTS['${key}'].dpi phải là 300 (nhận được ${fmt.dpi}). ` +
      'Xem logic trong src/export.js trước khi thêm format mới.',
    );
  }
  if (fmt.w !== mmToPixels(fmt.mmW, fmt.dpi) || fmt.h !== mmToPixels(fmt.mmH, fmt.dpi)) {
    throw new Error(`FMTS['${key}'] có kích thước pixel không khớp kích thước vật lý.`);
  }
}

export const state = {
  origImg:   null,
  origFile:  null,
  aiMaskImg: null,
  faceData:  null,
  complianceResult: null,
  imageQualityMetrics: null,
  imageQualityResult: null,
  imageQualitySourceFile: null,
  bgColor:   { r: 255, g: 255, b: 255 },
  curFmt:    'passport-vn',
  aiReady:   false,
  aiError:   '',
  cW: 0,
  cH: 0,
  frame: { x: 0, y: 0, w: 0, h: 0 },
  crop:  { x: 0, y: 0, scale: 1 },
  rv:    { scale: 1, tx: 0, ty: 0 },
  lb:    { scale: 1, tx: 0, ty: 0 },
  faceAdjust: { yOffsetPct: 0 },
  // Dịch chuyển khuôn mặt trong khung kết quả (đơn vị % theo kích thước output).
  // Giữ theo % để export 600 DPI vẫn đúng bố cục như preview.
  resultFaceOffsetPct: { x: 0, y: 0 },
  section: 'upload',
};

/**
 * Đặt lại state về giá trị ban đầu sau khi user upload ảnh mới.
 * Lưu ý: state.aiReady không được reset (giữ nguyên model đã tải).
 */
export function resetState() {
  state.origImg   = null;
  state.origFile  = null;
  state.aiMaskImg = null;
  state.faceData  = null;
  state.complianceResult = null;
  state.imageQualityMetrics = null;
  state.imageQualityResult = null;
  state.imageQualitySourceFile = null;
  state.aiError   = '';
  state.bgColor   = { r: 255, g: 255, b: 255 };
  state.curFmt    = 'passport-vn';
  state.rv        = { scale: 1, tx: 0, ty: 0 };
  state.lb        = { scale: 1, tx: 0, ty: 0 };
  state.faceAdjust = { yOffsetPct: 0 };
  state.resultFaceOffsetPct = { x: 0, y: 0 };

  // Intentional: state.aiReady KHÔNG được reset.
  // AI module (ai.js) giữ nguyên removeBackgroundFn đã import và face model
  // đã load. Reset sang false sẽ khiến lần xử lý tiếp theo tốn thêm ~30s
  // tải lại model không cần thiết.
  // Xem thêm: warmupAi() trong ai.js — guard idempotent.
}

/**
 * Kiểm tra file ảnh hợp lệ (MIME type, extension, kích thước ≤ 15MB).
 *
 * @param {File} file - File cần kiểm tra
 * @returns {{ok: boolean, error?: string}} Kết quả kiểm tra
 */
export function validateImageFile(file) {
  if (!(file instanceof File)) {
    return { ok: false, error: '[state.validateImageFile] File input không hợp lệ hoặc chưa sẵn sàng.' };
  }

  const hasName = typeof file.name === 'string' && file.name.length > 0;
  const hasType = typeof file.type === 'string';
  const hasSize = typeof file.size === 'number' && Number.isFinite(file.size) && file.size >= 0;
  if (!hasName || !hasType || !hasSize) {
    return { ok: false, error: '[state.validateImageFile] File object không đúng shape chuẩn của browser.' };
  }

  const mime = String(file.type || '').toLowerCase();
  const hasImageMime = /^(image\/jpeg|image\/png|image\/webp|image\/heic|image\/heif)$/.test(mime);
  const hasImageExt  = /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
  if (!hasImageMime && !hasImageExt)
    return { ok: false, error: 'Vui lòng chọn file ảnh (JPG/PNG/WEBP/HEIC/HEIF)!' };
  if (file.size > 15 * 1024 * 1024)
    return { ok: false, error: 'File quá lớn (tối đa 15MB)' };
  return { ok: true };
}
