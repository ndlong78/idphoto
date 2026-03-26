export const FMTS = {
  // FIX: US Visa 51×51mm tại 300DPI = 51/25.4×300 = 602.36 → 602px
  // Phiên bản cũ hardcode 600×600 (sai 2px), có thể bị từ chối ở một số
  // cổng kiểm tra kích thước ảnh tự động.
  'passport-vn': { w: 413, h: 531, lbl: '35 × 45 mm', dpi: 300 },
  cccd:          { w: 354, h: 472, lbl: '30 × 40 mm', dpi: 300 },
  'us-visa':     { w: 602, h: 602, lbl: '51 × 51 mm', dpi: 300 },
  schengen:      { w: 413, h: 531, lbl: '35 × 45 mm', dpi: 300 },
  'uk-visa':     { w: 413, h: 531, lbl: '35 × 45 mm', dpi: 300 },
  japan:         { w: 413, h: 531, lbl: '35 × 45 mm', dpi: 300 },
};

// FIX [IMPORTANT]: Kiểm tra contract FMTS tại load time.
//
// download() trong ui.js tính scale = targetDpi / fmt.dpi, với
// targetDpi ∈ {300, 600}. Logic này giả định fmt.dpi = 300:
//   - jpeg300 → scale = 300/300 = 1× (output = w×h px)
//   - jpeg600 → scale = 600/300 = 2× (output = 2w×2h px)
//
// Nếu thêm format mới với dpi ≠ 300, scale sẽ tính sai kích thước file
// và ảnh in ra sẽ không đúng mm. Throw ngay khi module load để fail fast
// thay vì xuất ảnh sai kích thước một cách âm thầm.
for (const [key, fmt] of Object.entries(FMTS)) {
  if (fmt.dpi !== 300) {
    throw new Error(
      `FMTS['${key}'].dpi phải là 300 (nhận được ${fmt.dpi}). ` +
      'Xem logic download() trong ui.js trước khi thêm format mới.',
    );
  }
}

export const state = {
  origImg:   null,
  origFile:  null,
  aiMaskImg: null,
  faceData:  null,
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
  state.aiError   = '';
  state.bgColor   = { r: 255, g: 255, b: 255 };
  state.curFmt    = 'passport-vn';
  state.rv        = { scale: 1, tx: 0, ty: 0 };
  state.lb        = { scale: 1, tx: 0, ty: 0 };

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
  const mime = String(file.type || '').toLowerCase();
  const hasImageMime = /^(image\/jpeg|image\/png|image\/webp|image\/heic|image\/heif)$/.test(mime);
  const hasImageExt  = /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
  // FIX: thêm HEIF vào error message (regex đã hỗ trợ nhưng message thiếu)
  if (!hasImageMime && !hasImageExt)
    return { ok: false, error: 'Vui lòng chọn file ảnh (JPG/PNG/WEBP/HEIC/HEIF)!' };
  if (file.size > 15 * 1024 * 1024)
    return { ok: false, error: 'File quá lớn (tối đa 15MB)' };
  return { ok: true };
}
