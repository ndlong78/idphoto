import {
  applyZoom,
  centerFace,
  cleanupCropEvents,
  computeFrame,
  fitImage,
  initCrop,
  shiftCropByPercent,
} from './crop.js';
import { renderResult, renderToPreview } from './render.js';
import { FMTS, resetState, state } from './state.js';
import { SKIN_DEBOUNCE_MS, FEATHER_DEBOUNCE_MS, SHADOW_DEBOUNCE_MS } from './constants.js';
import { logEvent } from './telemetry.js';

let toastTimer = null;
let uiController = null;
let resultResizeRaf = 0;
let resultFaceDragging = false;
let resultFaceLastPoint = { x: 0, y: 0 };

// FIX [WARNING]: Khai báo debounce timer ở module scope để có thể clear
// khi initUI() được gọi lại (ví dụ sau resetState()).
// Nếu không clear, timer cũ có thể fire sau khi state.origImg = null
// và gây crash trong renderToPreview().
let skinDebounceTimer    = 0;
let featherDebounceTimer = 0;
let shadowDebounceTimer  = 0;
const missingDomNodes = new Set();

/**
 * Khởi tạo toàn bộ event listener của UI. Có thể gọi lại sau resetState().
 * Clear timer debounce cũ trước khi bind để tránh stale callback.
 *
 * @param {{
 *   onPickFile: function(): void,
 *   onReprocessAI: function(): void,
 *   onDownload: function(string): Promise<void>,
 *   onCopy: function(): Promise<void>,
 *   onFileDrop: function(File): void,
 *   onFileInput: function(File): void,
 * }} actions - Callback handlers từ main.js
 */
export function initUI(actions) {
  uiController?.abort();
  uiController = new AbortController();
  const { signal } = uiController;

  // FIX [WARNING]: Clear timer cũ trước khi re-bind listener mới.
  // initUI() có thể được gọi lại sau resetState() — timer cũ vẫn pending
  // và nếu fire sau khi origImg = null sẽ crash renderToPreview().
  clearTimeout(skinDebounceTimer);
  clearTimeout(featherDebounceTimer);
  clearTimeout(shadowDebounceTimer);
  skinDebounceTimer    = 0;
  featherDebounceTimer = 0;
  shadowDebounceTimer  = 0;

  const uploadZone = mustGetEl('upload-zone', 'initUI');
  const fileInput  = mustGetEl('file-input', 'initUI');
  if (!uploadZone || !fileInput) return;

  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag');
  }, { signal });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag'), { signal });
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag');
    const file = e.dataTransfer?.files?.[0];
    if (file) actions.onFileDrop(file);
  }, { signal });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) actions.onFileInput(file);
  }, { signal });

  uploadZone.addEventListener('click', (e) => {
    const target = e.target;
    if (target instanceof HTMLElement && target.closest('#btn-pick')) return;
    actions.onPickFile();
  }, { signal });

  bindAsyncClick('btn-reprocess', actions.onReprocessAI, signal);
  bindClick('btn-reset-face', () => {
    state.faceAdjust.yOffsetPct = 0;
    state.resultFaceOffsetPct = { x: 0, y: 0 };
    syncFaceAdjustUI();
    if (state.faceData) {
      centerFace();
      void safeRender();
    } else {
      fitImage(true);
    }
  }, signal);
  bindClick('btn-fit', () => fitImage(true), signal);
  bindClick('btn-zoom-minus', () => applyZoom(0.85, state.cW / 2, state.cH / 2), signal);
  bindClick('btn-zoom-plus',  () => applyZoom(1.15, state.cW / 2, state.cH / 2), signal);

  bindClick('btn-result-minus', () => zoomFromSource(-1), signal);
  bindClick('btn-result-plus',  () => zoomFromSource(1),  signal);
  bindClick('btn-result-fit',   () => fitFromSource(), signal);

  const prevWrap = mustGetEl('prev-wrap', 'initUI');
  if (!prevWrap) return;
  updateResultFrameSize();

  prevWrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomFromSource(e.deltaY < 0 ? 1 : -1);
  }, { passive: false, signal });

  prevWrap.addEventListener('mousedown', (e) => {
    resultFaceDragging = true;
    resultFaceLastPoint = { x: e.clientX, y: e.clientY };
    prevWrap.classList.add('dragging-face');
    e.preventDefault();
  }, { signal });

  window.addEventListener('mousemove', (e) => {
    if (!resultFaceDragging) return;
    updateResultFaceOffsetByDelta(e.clientX - resultFaceLastPoint.x, e.clientY - resultFaceLastPoint.y);
    resultFaceLastPoint = { x: e.clientX, y: e.clientY };
  }, { signal });

  window.addEventListener('mouseup', () => {
    if (!resultFaceDragging) return;
    resultFaceDragging = false;
    prevWrap.classList.remove('dragging-face');
  }, { signal });

  prevWrap.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    resultFaceDragging = true;
    resultFaceLastPoint = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    prevWrap.classList.add('dragging-face');
  }, { passive: true, signal });

  window.addEventListener('touchmove', (e) => {
    if (!resultFaceDragging || e.touches.length !== 1) return;
    const touch = e.touches[0];
    updateResultFaceOffsetByDelta(touch.clientX - resultFaceLastPoint.x, touch.clientY - resultFaceLastPoint.y);
    resultFaceLastPoint = { x: touch.clientX, y: touch.clientY };
  }, { passive: true, signal });

  window.addEventListener('touchend', () => {
    if (!resultFaceDragging) return;
    resultFaceDragging = false;
    prevWrap.classList.remove('dragging-face');
  }, { signal });

  window.addEventListener('resize', () => {
    if (resultResizeRaf) cancelAnimationFrame(resultResizeRaf);
    resultResizeRaf = requestAnimationFrame(() => {
      updateResultFrameSize();
      resultResizeRaf = 0;
    });
  }, { signal });

  bindClick('btn-open-lightbox', () => openLightbox(), signal);
  bindClick('btn-lb-close',  () => closeLightbox(),  signal);
  bindClick('btn-lb-minus',  () => lightboxZoom(-1), signal);
  bindClick('btn-lb-plus',   () => lightboxZoom(1),  signal);
  bindClick('btn-lb-fit',    () => lightboxZoomFit(), signal);

  bindAsyncClick('btn-jpg-600', () => actions.onDownload('jpeg600'), signal);
  bindAsyncClick('btn-png-600', () => actions.onDownload('png600'),  signal);
  bindAsyncClick('btn-jpg-300', () => actions.onDownload('jpeg300'), signal);
  bindAsyncClick('btn-copy',    actions.onCopy, signal);

  bindClick('btn-reset-app', () => {
    // FIX [WARNING]: Clear pending debounce timer trước khi reset state.
    // Nếu không clear, timer có thể fire SAU khi origImg = null.
    clearTimeout(skinDebounceTimer);
    clearTimeout(featherDebounceTimer);
    clearTimeout(shadowDebounceTimer);
    skinDebounceTimer    = 0;
    featherDebounceTimer = 0;
    shadowDebounceTimer  = 0;

    cleanupCropEvents();
    resetState();
    syncFaceAdjustUI();
    const resetInput = getOptionalEl('file-input');
    if (resetInput) resetInput.value = '';
    setSection('upload');
  }, signal);

  document.querySelectorAll('.fbtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.fbtn').forEach((x) => x.classList.remove('active'));
      btn.classList.add('active');
      state.curFmt = btn.dataset.fmt;
      state.faceAdjust.yOffsetPct = 0;
      state.resultFaceOffsetPct = { x: 0, y: 0 };
      syncFaceAdjustUI();
      computeFrame();
      fitImage(false);
      if (state.faceData) centerFace();
      updateResultFrameSize();
      applyResultTransform();
      void safeRender();
      const sizeBadge = getOptionalEl('size-badge');
      if (sizeBadge) sizeBadge.textContent = FMTS[state.curFmt].lbl;
    }, { signal });
  });

  const faceShiftInput = document.getElementById('face-y-offset');
  if (faceShiftInput) {
    faceShiftInput.addEventListener('input', () => {
      const prevOffset = state.faceAdjust.yOffsetPct;
      state.faceAdjust.yOffsetPct = faceShiftInput.valueAsNumber;
      const lbl = getOptionalEl('face-yv');
      if (lbl) lbl.textContent = `${state.faceAdjust.yOffsetPct > 0 ? '+' : ''}${state.faceAdjust.yOffsetPct}%`;
      // FIX [IMPORTANT]: Không gọi centerFace() tại đây.
      // Lý do:
      // - centerFace() sẽ reset lại x/y/scale theo bbox khuôn mặt.
      // - Nếu user đã kéo/zoom thủ công ở khung ảnh gốc, việc reset làm
      //   preview bên phải "nhảy lệch", tạo cảm giác khung nền không giữ nguyên.
      // - Slider "Khoảng trống đỉnh đầu" cần hoạt động như nudge tương đối,
      //   chỉ dịch lên/xuống từ vị trí hiện tại.
      const deltaPct = state.faceAdjust.yOffsetPct - prevOffset;
      shiftCropByPercent(deltaPct, false);
      void safeRender();
    }, { signal });
  }
  syncFaceAdjustUI();

  document.querySelectorAll('.sw').forEach((sw) => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('.sw').forEach((x) => x.classList.remove('active'));
      sw.classList.add('active');
      const [r, g, b] = (sw.dataset.c ?? '255,255,255').split(',').map(Number);
      state.bgColor = { r, g, b };
      void safeRender();
    }, { signal });
  });

  [['bright', 'bv'], ['contrast', 'cv'], ['sharp', 'sv'], ['skin', 'skv'], ['feather', 'fv'], ['shadow', 'shadv']].forEach(([id, lblId]) => {
    const input = getOptionalEl(id);
    if (!input) {
      reportMissingDomNode(id, { critical: true, context: 'initUI.slider' });
      return;
    }
    input.addEventListener('input', () => {
      const lbl = getOptionalEl(lblId);
      if (lbl) lbl.textContent = input.value;

      if (id === 'skin') {
        clearTimeout(skinDebounceTimer);
        skinDebounceTimer = window.setTimeout(() => void safeRender(), SKIN_DEBOUNCE_MS);
      } else if (id === 'feather') {
        clearTimeout(featherDebounceTimer);
        featherDebounceTimer = window.setTimeout(() => void safeRender(), FEATHER_DEBOUNCE_MS);
      } else if (id === 'shadow') {
        clearTimeout(shadowDebounceTimer);
        shadowDebounceTimer = window.setTimeout(() => void safeRender(), SHADOW_DEBOUNCE_MS);
      } else {
        void safeRender();
      }
    }, { signal });
  });

  const zoomRange = getOptionalEl('zoom-range');
  if (zoomRange) {
    zoomRange.addEventListener('input', (e) => {
      const value = e.target.valueAsNumber / 100;
      applyZoom(value / state.crop.scale, state.cW / 2, state.cH / 2);
    }, { signal });
  } else {
    reportMissingDomNode('zoom-range', { critical: true, context: 'initUI' });
  }

  const resultLightbox = getOptionalEl('result-lightbox');
  if (resultLightbox) {
    resultLightbox.addEventListener('click', closeLightbox, { signal });
  } else {
    reportMissingDomNode('result-lightbox', { critical: true, context: 'initUI' });
  }

  const lightboxInner = document.querySelector('.lightbox-inner');
  if (lightboxInner) {
    lightboxInner.addEventListener('click', (e) => e.stopPropagation(), { signal });
  } else {
    reportMissingDomNode('.lightbox-inner', { context: 'initUI' });
  }

  setSection('upload');
}

function getOptionalEl(id) {
  return document.getElementById(id);
}

function mustGetEl(id, context) {
  const el = getOptionalEl(id);
  if (!el) reportMissingDomNode(id, { critical: true, context });
  return el;
}

function reportMissingDomNode(id, { critical = false, context = 'ui' } = {}) {
  const key = `${context}:${id}`;
  if (missingDomNodes.has(key)) return;
  missingDomNodes.add(key);
  logEvent('ui.dom_node_missing', { id, context, critical }, critical ? 'error' : 'warn');
}

// ─── Safe render ──────────────────────────────────────────────────────────────

async function safeRender() {
  try {
    await renderToPreview();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Lỗi render không xác định';
    toast(`⚠️ Lỗi hiển thị: ${msg}`, 'err');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bindClick(id, fn, signal) {
  const el = getOptionalEl(id);
  if (el) el.addEventListener('click', fn, { signal });
}

function bindAsyncClick(id, fn, signal) {
  const el = getOptionalEl(id);
  if (!el) return;
  el.addEventListener('click', async () => {
    el.disabled = true;
    try {
      await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Lỗi thao tác không xác định';
      logEvent('ui.async_action_failed', { id, error: message }, 'error');
      toast(`⚠️ ${message}`, 'err');
    } finally {
      el.disabled = false;
    }
  }, { signal });
}

function syncFaceAdjustUI() {
  const input = getOptionalEl('face-y-offset');
  const label = getOptionalEl('face-yv');
  if (!input || !label) return;
  input.value = String(state.faceAdjust.yOffsetPct ?? 0);
  const current = Number(input.value) || 0;
  label.textContent = `${current > 0 ? '+' : ''}${current}%`;
}

// ─── Section management ───────────────────────────────────────────────────────

/**
 * Chuyển đổi section hiển thị ('upload' | 'loading' | 'editor').
 *
 * @param {'upload'|'loading'|'editor'} section
 */
export function setSection(section) {
  state.section = section;
  ['upload', 'loading', 'editor'].forEach((s) => {
    const sectionEl = getOptionalEl(`${s}-section`);
    if (sectionEl) sectionEl.style.display = 'none';
  });

  if (section === 'upload') {
    const uploadSection = getOptionalEl('upload-section');
    if (uploadSection) uploadSection.style.display = 'flex';
    setSteps(1);
  } else if (section === 'loading') {
    const loadingSection = getOptionalEl('loading-section');
    if (loadingSection) loadingSection.style.display = 'flex';
    setSteps(2);
  } else {
    const editorSection = getOptionalEl('editor-section');
    if (editorSection) editorSection.style.display = 'block';
  }
}

/**
 * Cập nhật trạng thái thanh tiến trình bước (s1–s4).
 *
 * @param {number} active - Bước đang active (1–4)
 */
export function setSteps(active) {
  for (let i = 1; i <= 4; i++) {
    const el = getOptionalEl(`s${i}`);
    if (!el) continue;
    el.className = 'step';
    if (i < active)       el.classList.add('done');
    else if (i === active) el.classList.add('active');
  }
}

/**
 * Cập nhật tiêu đề và phụ đề của màn hình loading.
 *
 * @param {string} title - Tiêu đề chính
 * @param {string} sub - Phụ đề (có thể rỗng)
 */
export function setLoad(title, sub) {
  const loadTitle = getOptionalEl('load-title');
  const loadSub = getOptionalEl('load-sub');
  if (loadTitle) loadTitle.textContent = title;
  if (loadSub) loadSub.textContent = sub;
}

/**
 * Cập nhật thanh tiến trình loading (0–100%).
 *
 * @param {number} percent - Phần trăm hoàn thành (0–100)
 */
export function setProgress(percent) {
  const pfill = getOptionalEl('pfill');
  if (pfill) pfill.style.width = `${percent}%`;
}

/**
 * Cập nhật trạng thái bước loading (ls1–ls4).
 *
 * @param {number} step - Số bước (1–4)
 * @param {'active'|'done'|''} status - Trạng thái hiển thị
 */
export function setLoadStep(step, status) {
  const el = getOptionalEl(`ls${step}`);
  if (!el) return;
  el.className = `ls ${status}`;
}

/**
 * Cập nhật thanh trạng thái nhận diện khuôn mặt.
 *
 * @param {number|null} score - Điểm tin cậy (0–1), null nếu không tìm thấy mặt
 */
export function setFaceStatus(score) {
  const bar = getOptionalEl('face-bar');
  const txt = getOptionalEl('face-txt');
  if (!bar || !txt) return;
  if (score !== null) {
    bar.className   = 'fstatus ok';
    txt.textContent = `Nhận dạng khuôn mặt (${Math.round(score * 100)}%)`;
  } else {
    bar.className   = 'fstatus warn';
    txt.textContent = 'Không tìm thấy khuôn mặt — căn giữa tự động';
  }
}

/**
 * Cập nhật thanh thông tin AI (thành công hoặc fallback flood fill).
 *
 * @param {boolean} success - true nếu AI tách nền thành công
 * @param {string} [reason=''] - Lý do thất bại (nếu có)
 */
export function setAiInfoBar(success, reason = '') {
  const bar = getOptionalEl('ai-info-bar');
  if (!bar) return;
  bar.replaceChildren();

  if (success) {
    const tag = document.createElement('div');
    tag.className = 'ai-tag';
    const dot = document.createElement('div');
    dot.className = 'dot';
    const txt = document.createElement('span');
    txt.textContent = 'AI ISNet — Tách nền chính xác';
    tag.append(dot, txt);

    const hint = document.createElement('span');
    hint.style.fontSize = '10px';
    hint.style.color    = '#4a5568';
    hint.textContent    = '🔄 Bạn có thể bấm AI để xử lý lại';
    bar.append(tag, hint);
  } else {
    const warn = document.createElement('span');
    warn.style.fontSize = '11px';
    warn.style.color    = '#fbbf24';
    const detail = reason ? ` (${reason})` : '';
    warn.textContent    = `⚠️ Chưa tải được AI — dùng Flood Fill. Có thể thử lại AI${detail}.`;
    bar.appendChild(warn);
  }
}

/**
 * Hiển thị thông báo toast trong 3.5 giây.
 *
 * @param {string} message - Nội dung thông báo
 * @param {'ok'|'err'} [type='ok'] - Loại thông báo (màu sắc)
 */
export function toast(message, type = 'ok') {
  const el = getOptionalEl('toast');
  if (!el) return;
  el.textContent = message;
  el.className   = `show ${type}`;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.className = ''; }, 3500);
}

// ─── Result panel zoom ────────────────────────────────────────────────────────

function applyResultTransform() {
  updateResultFrameSize();
  const canvas = getOptionalEl('result-canvas');
  if (!canvas) return;
  canvas.style.transform = 'translate(0px, 0px) scale(1)';
  const zoomOutLabel = getOptionalEl('zoom-out-lbl');
  if (zoomOutLabel) zoomOutLabel.textContent = `${Math.round(state.crop.scale * 100)}%`;
}

/**
 * Đồng bộ khung kết quả theo đúng "khung cắt" bên trái và tỉ lệ format hiện tại.
 * Mục tiêu:
 * - Không méo ảnh preview khi đổi format visa (30x40, 35x45, 51x51...)
 * - Khung "Ảnh gốc" và "Kết quả" có cảm giác 1:1 khi so sánh trực quan.
 */
function updateResultFrameSize() {
  const wrap = getOptionalEl('prev-wrap');
  const frame = getOptionalEl('result-visa-frame');
  const canvas = getOptionalEl('result-canvas');
  const fmt = FMTS[state.curFmt];
  if (!wrap || !frame || !canvas) return;

  // Ưu tiên dùng đúng kích thước khung crop đang hiển thị ở panel trái.
  // Nếu chưa có frame (lúc init sớm), fallback theo tỉ lệ format hiện tại.
  const fallbackW = wrap.clientWidth || 1;
  const fallbackH = Math.round(fallbackW / Math.max(1e-6, fmt.w / fmt.h));
  const frameW = Math.round(state.frame?.w ?? fallbackW);
  const frameH = Math.round(state.frame?.h ?? fallbackH);
  if (!frameW || !frameH) return;

  // Khóa khung kết quả theo đúng kích thước/tỉ lệ frame trái.
  frame.style.width = `${frameW}px`;
  frame.style.height = `${frameH}px`;
  frame.style.minHeight = `${frameH}px`;
  frame.style.maxHeight = `${frameH}px`;
  frame.style.aspectRatio = `${frameW} / ${frameH}`;

  // Canvas preview giữ đầy khung để không bị "stretch" sai tỉ lệ theo panel.
  canvas.style.width = '100%';
  canvas.style.height = '100%';
}

function zoomFromSource(dir) {
  const factor = dir > 0 ? 1.15 : 0.85;
  applyZoom(factor, state.cW / 2, state.cH / 2);
  void safeRender();
}

function fitFromSource() {
  fitImage(true);
  void safeRender();
}

function updateResultFaceOffsetByDelta(deltaX, deltaY) {
  const previewFrame = getOptionalEl('result-visa-frame');
  if (!previewFrame) return;
  const frameW = previewFrame.clientWidth || 1;
  const frameH = previewFrame.clientHeight || 1;

  state.resultFaceOffsetPct.x = clamp(
    (state.resultFaceOffsetPct?.x ?? 0) + (deltaX / frameW) * 100,
    -100,
    100,
  );
  state.resultFaceOffsetPct.y = clamp(
    (state.resultFaceOffsetPct?.y ?? 0) + (deltaY / frameH) * 100,
    -100,
    100,
  );
  void safeRender();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────

function openLightbox() {
  const src = getOptionalEl('result-canvas');
  if (!src || !src.width) {
    toast('Chưa có ảnh để xem', 'err');
    return;
  }

  const dst = mustGetEl('lightbox-canvas', 'openLightbox');
  if (!dst) return;
  dst.width  = src.width;
  dst.height = src.height;
  dst.getContext('2d')?.drawImage(src, 0, 0);

  const maxW = window.innerWidth  * 0.88;
  const maxH = window.innerHeight * 0.78;
  state.lb.scale = Math.min(1, maxW / src.width, maxH / src.height);
  state.lb.tx    = 0;
  state.lb.ty    = 0;
  applyLightboxTransform();

  const resultLightbox = mustGetEl('result-lightbox', 'openLightbox');
  if (resultLightbox) resultLightbox.classList.add('open');
}

function closeLightbox() {
  const resultLightbox = getOptionalEl('result-lightbox');
  if (resultLightbox) resultLightbox.classList.remove('open');
}

function lightboxZoom(dir) {
  state.lb.scale = Math.max(0.1, Math.min(12, state.lb.scale * (dir > 0 ? 1.4 : 0.71)));
  applyLightboxTransform();
}

function lightboxZoomFit() {
  const c = getOptionalEl('lightbox-canvas');
  if (!c) return;
  const maxW = window.innerWidth  * 0.88;
  const maxH = window.innerHeight * 0.78;
  state.lb.scale = Math.min(1, maxW / c.width, maxH / c.height);
  state.lb.tx    = 0;
  state.lb.ty    = 0;
  applyLightboxTransform();
}

function applyLightboxTransform() {
  const c = getOptionalEl('lightbox-canvas');
  if (!c) return;
  c.style.width     = `${Math.round(c.width  * state.lb.scale)}px`;
  c.style.height    = `${Math.round(c.height * state.lb.scale)}px`;
  c.style.transform = `translate(${state.lb.tx}px, ${state.lb.ty}px)`;
  const lbLabel = getOptionalEl('lb-lbl');
  if (lbLabel) lbLabel.textContent = `${Math.round(state.lb.scale * 100)}%`;
}

// ─── Download ─────────────────────────────────────────────────────────────────

/**
 * Xuất ảnh kết quả dưới dạng file download.
 *
 * @param {'jpeg600'|'jpeg300'|'png'} mode - Định dạng và DPI xuất
 * @returns {Promise<void>}
 */
export async function download(mode) {
  const fmt       = FMTS[state.curFmt];
  const baseDpi   = fmt.dpi;
  const targetDpi = mode === 'jpeg300' ? baseDpi : baseDpi * 2;
  const scale     = targetDpi / baseDpi;
  const ext  = mode.includes('png') ? 'png'       : 'jpeg';
  const mime = ext === 'png'        ? 'image/png'  : 'image/jpeg';

  const hiRes = await renderResult(scale);
  const link  = document.createElement('a');
  link.download = `photovisa_${state.curFmt}_${fmt.w * scale}x${fmt.h * scale}_${targetDpi}dpi.${ext}`;
  link.href     = hiRes.toDataURL(mime, 1);
  link.click();
}

/**
 * Sao chép ảnh kết quả vào clipboard (PNG).
 * Fallback: mở ảnh trong tab mới nếu Clipboard API không được hỗ trợ.
 *
 * @returns {Promise<{method: 'clipboard'|'newtab'}>}
 */
export async function copyToClipboard() {
  const canvas = mustGetEl('result-canvas', 'copyToClipboard');
  if (!canvas) throw new Error('Thiếu vùng kết quả để sao chép');
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Không thể tạo blob')), 'image/png');
  });

  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return { method: 'clipboard' };
  } catch {
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return { method: 'newtab' };
  }
}

/**
 * Chuyển sang màn hình editor và khởi tạo canvas crop.
 */
export function mountEditor() {
  setSection('editor');
  initCrop();
  updateResultFrameSize();
}
