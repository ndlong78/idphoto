export const FMTS = {
  'passport-vn': { w: 413, h: 531, lbl: '35 × 45 mm', dpi: 300 },
  cccd: { w: 354, h: 472, lbl: '30 × 40 mm', dpi: 300 },
  'us-visa': { w: 600, h: 600, lbl: '51 × 51 mm', dpi: 300 },
  schengen: { w: 413, h: 531, lbl: '35 × 45 mm', dpi: 300 },
  'uk-visa': { w: 413, h: 531, lbl: '35 × 45 mm', dpi: 300 },
  japan: { w: 413, h: 531, lbl: '35 × 45 mm', dpi: 300 },
};

export const state = {
  origImg: null,
  origFile: null,
  aiMaskImg: null,
  faceData: null,
  bgColor: { r: 255, g: 255, b: 255 },
  curFmt: 'passport-vn',
  aiReady: false,
  cW: 0,
  cH: 0,
  frame: { x: 0, y: 0, w: 0, h: 0 },
  crop: { x: 0, y: 0, scale: 1 },
  rv: { scale: 1, tx: 0, ty: 0 },
  lb: { scale: 1, tx: 0, ty: 0 },
  section: 'upload',
};

export function resetState() {
  state.origImg = null;
  state.origFile = null;
  state.aiMaskImg = null;
  state.faceData = null;
  state.bgColor = { r: 255, g: 255, b: 255 };
  state.curFmt = 'passport-vn';
  state.rv = { scale: 1, tx: 0, ty: 0 };
  state.lb = { scale: 1, tx: 0, ty: 0 };
}

export function validateImageFile(file) {
  if (!file.type.startsWith('image/')) return { ok: false, error: 'Vui lòng chọn file ảnh!' };
  if (file.size > 15 * 1024 * 1024) return { ok: false, error: 'File quá lớn (tối đa 15MB)' };
  return { ok: true };
}
