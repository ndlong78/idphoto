import { FMTS, state } from './state.js';
import { renderToPreview } from './render.js';
import { syncZoomUI } from './dom.js';
import {
  CROP_FIT_MARGIN,
  CROP_FIT_MAX_SCALE,
  CROP_FACE_SCALE_FACTOR,
  CROP_FACE_VERTICAL_BIAS,
} from './constants.js';

let cropController = null;
let animId = null;
let dragging = false;
let lastPoint = { x: 0, y: 0 };
let lastPinch = 0;
let needDraw = false;

/**
 * Khởi tạo canvas crop: thiết lập kích thước, sự kiện chuột/cảm ứng, và vòng lặp animationFrame.
 * Tự động gọi computeFrame(), fitImage(), và centerFace() nếu có dữ liệu khuôn mặt.
 */
export function initCrop() {
  const canvas = document.getElementById('crop-canvas');
  if (!canvas || !state.origImg) return;

  // cleanupCropEvents() huỷ animation loop cũ (cancelAnimationFrame + animId = null)
  // và abort toàn bộ event listener qua AbortController.
  // Đây là điểm duy nhất cần cancel animId — không cần cancel lại bên dưới.
  cleanupCropEvents();
  cropController = new AbortController();
  const { signal } = cropController;

  const dpr    = window.devicePixelRatio || 1;
  const panel  = canvas.closest('.panel-card');
  const cw     = panel?.clientWidth ?? 500;
  const ch     = Math.round(Math.min(Math.max(cw * 0.85, 340), 520));

  canvas.style.width  = `${cw}px`;
  canvas.style.height = `${ch}px`;
  canvas.width  = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  state.cW = cw;
  state.cH = ch;

  computeFrame();
  fitImage(false);
  if (state.faceData) centerFace();

  canvas.addEventListener('mousedown', (e) => {
    dragging = true;
    const rect = canvas.getBoundingClientRect();
    lastPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.preventDefault();
  }, { signal });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    state.crop.x += mx - lastPoint.x;
    state.crop.y += my - lastPoint.y;
    lastPoint = { x: mx, y: my };
    needDraw = true;
    void renderToPreview();
  }, { signal });

  window.addEventListener('mouseup', () => { dragging = false; }, { signal });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    applyZoom(e.deltaY < 0 ? 1.09 : 0.92, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false, signal });

  canvas.addEventListener('touchstart', (e) => {
    if (e.cancelable) e.preventDefault();
    if (e.touches.length === 1) {
      dragging = true;
      lastPoint = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      dragging = false;
      lastPinch = distance(e.touches[0], e.touches[1]);
    }
  }, { passive: false, signal });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && dragging) {
      state.crop.x += e.touches[0].clientX - lastPoint.x;
      state.crop.y += e.touches[0].clientY - lastPoint.y;
      lastPoint = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      needDraw = true;
      void renderToPreview();
    } else if (e.touches.length === 2) {
      const d = distance(e.touches[0], e.touches[1]);
      if (lastPinch > 0) {
        const rect = canvas.getBoundingClientRect();
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        applyZoom(d / lastPinch, mx, my);
      }
      lastPinch = d;
    }
  }, { passive: false, signal });

  canvas.addEventListener('touchend', () => { dragging = false; lastPinch = 0; }, { signal });

  // animId đã được set null bởi cleanupCropEvents() ở trên.
  // Bắt đầu loop mới — mỗi frame chỉ vẽ lại khi needDraw = true (dirty flag).
  const loop = () => {
    if (needDraw) {
      drawCrop();
      needDraw = false;
    }
    animId = requestAnimationFrame(loop);
  };
  loop();

  syncZoomUI();
  needDraw = true;
}

/**
 * Huỷ toàn bộ event listener và dừng animation loop của crop canvas.
 */
export function cleanupCropEvents() {
  cropController?.abort();
  cropController = null;
  if (animId) {
    cancelAnimationFrame(animId);
    animId = null;
  }
}

/**
 * Tính toán và cập nhật state.frame.
 */
export function computeFrame() {
  const fmt = FMTS[state.curFmt];
  const asp = fmt.w / fmt.h;
  const pad = 32;
  let fw, fh;

  if (asp >= state.cW / state.cH) {
    fw = state.cW - pad * 2;
    fh = fw / asp;
  } else {
    fh = state.cH - pad * 2;
    fw = fh * asp;
  }

  state.frame = { x: (state.cW - fw) / 2, y: (state.cH - fh) / 2, w: fw, h: fh };
  needDraw = true;
}

/**
 * Fit ảnh gốc vào canvas crop.
 *
 * @param {boolean} rerender - true để trigger renderToPreview ngay sau
 */
export function fitImage(rerender) {
  if (!state.origImg) return;

  const rawScale = Math.min(
    state.cW / state.origImg.width,
    state.cH / state.origImg.height,
  ) * CROP_FIT_MARGIN;

  state.crop.scale = Math.max(1e-6, Math.min(CROP_FIT_MAX_SCALE, rawScale));
  state.crop.x = (state.cW - state.origImg.width  * state.crop.scale) / 2;
  state.crop.y = (state.cH - state.origImg.height * state.crop.scale) / 2;
  needDraw = true;
  syncZoomUI();
  if (rerender) void renderToPreview();
}

/**
 * Tự động căn chỉnh frame để khuôn mặt nằm đúng vị trí chuẩn hộ chiếu.
 */
export function centerFace() {
  if (!state.faceData) return;
  const b = state.faceData.box;
  state.crop.scale = (state.frame.h * CROP_FACE_SCALE_FACTOR) / b.height;
  state.crop.x = state.frame.x + state.frame.w / 2 - (b.x + b.width / 2) * state.crop.scale;
  state.crop.y = state.frame.y + state.frame.h * CROP_FACE_VERTICAL_BIAS - (b.y + b.height / 2) * state.crop.scale;
  needDraw = true;
  syncZoomUI();
}

/**
 * Zoom ảnh theo hệ số factor, tâm zoom tại điểm (px, py).
 *
 * @param {number} factor
 * @param {number} px
 * @param {number} py
 */
export function applyZoom(factor, px, py) {
  const ns = Math.max(0.04, Math.min(25, state.crop.scale * factor));
  const sf = ns / state.crop.scale;
  state.crop.x = px - (px - state.crop.x) * sf;
  state.crop.y = py - (py - state.crop.y) * sf;
  state.crop.scale = ns;
  needDraw = true;
  syncZoomUI();
  void renderToPreview();
}

function drawCrop() {
  const canvas = document.getElementById('crop-canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx || !state.origImg) return;

  const dpr = window.devicePixelRatio || 1;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const ts = 11;
  for (let y = 0; y < state.cH; y += ts) {
    for (let x = 0; x < state.cW; x += ts) {
      ctx.fillStyle = (Math.floor(x / ts) + Math.floor(y / ts)) % 2 === 0 ? '#1a2438' : '#141c2e';
      ctx.fillRect(x, y, ts, ts);
    }
  }

  const src = state.aiMaskImg || state.origImg;
  ctx.drawImage(src, state.crop.x, state.crop.y, state.origImg.width * state.crop.scale, state.origImg.height * state.crop.scale);

  const { x, y, w, h } = state.frame;
  ctx.fillStyle = 'rgba(0,0,0,.6)';
  ctx.fillRect(0, 0, state.cW, y);
  ctx.fillRect(0, y + h, state.cW, state.cH - y - h);
  ctx.fillRect(0, y, x, h);
  ctx.fillRect(x + w, y, state.cW - x - w, h);
  ctx.strokeStyle = 'rgba(212,175,80,.6)';
  ctx.strokeRect(x, y, w, h);
}

function distance(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}
