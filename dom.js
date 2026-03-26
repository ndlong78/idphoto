// ═══════════════════════════════════════════════════════════════
// dom.js — DOM utilities dùng chung, tách khỏi ui.js
//
// Lý do tách ra:
//   ui.js import crop.js và render.js.
//   crop.js cần syncZoomUI, render.js cần getControls.
//   Nếu cả hai import ngược lại từ ui.js → circular import:
//     ui → crop → ui  (syncZoomUI)
//     ui → render → ui (getControls)
//
//   dom.js chỉ phụ thuộc state.js (không vòng), cắt toàn bộ cycle.
// ═══════════════════════════════════════════════════════════════

import { state } from './state.js';

/**
 * Trả về các HTMLInputElement của thanh điều chỉnh ảnh.
 * Dùng bởi render.js để đọc giá trị slider khi render.
 *
 * @returns {{bright: HTMLInputElement, contrast: HTMLInputElement, sharp: HTMLInputElement, skin: HTMLInputElement, feather: HTMLInputElement, shadow: HTMLInputElement}}
 */
export function getControls() {
  return {
    bright:   document.getElementById('bright'),
    contrast: document.getElementById('contrast'),
    sharp:    document.getElementById('sharp'),
    skin:     document.getElementById('skin'),
    feather:  document.getElementById('feather'),
    shadow:   document.getElementById('shadow'),
  };
}

/**
 * Đồng bộ label % zoom và thanh range slider từ state.crop.scale.
 * Dùng bởi crop.js sau mỗi thao tác zoom/drag.
 */
export function syncZoomUI() {
  const percent = Math.round(state.crop.scale * 100);
  document.getElementById('zoom-lbl').textContent = `${percent}%`;
  document.getElementById('zoom-range').value      = `${Math.max(5, Math.min(2500, percent))}`;
}
