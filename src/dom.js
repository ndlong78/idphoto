import { state } from './state.js';

/**
 * Trả về các HTMLInputElement của thanh điều chỉnh ảnh.
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
 * Nguồn duy nhất cho syncZoomUI — dùng bởi crop.js.
 * ui.js KHÔNG export hàm này để tránh circular import.
 */
export function syncZoomUI() {
  const percent = Math.round(state.crop.scale * 100);
  document.getElementById('zoom-lbl').textContent = `${percent}%`;
  document.getElementById('zoom-range').value      = `${Math.max(5, Math.min(2500, percent))}`;
}
