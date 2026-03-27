import { state } from './state.js';

function fallbackInput(value = 0) {
  return { valueAsNumber: value, value: String(value) };
}

function getNumericInput(id, fallback = 0) {
  const el = document.getElementById(id);
  if (el && typeof el.valueAsNumber === 'number') return el;
  return fallbackInput(fallback);
}

/**
 * Trả về các HTMLInputElement của thanh điều chỉnh ảnh.
 *
 * @returns {{bright: HTMLInputElement|{valueAsNumber:number,value:string}, contrast: HTMLInputElement|{valueAsNumber:number,value:string}, sharp: HTMLInputElement|{valueAsNumber:number,value:string}, skin: HTMLInputElement|{valueAsNumber:number,value:string}, feather: HTMLInputElement|{valueAsNumber:number,value:string}, shadow: HTMLInputElement|{valueAsNumber:number,value:string}}}
 */
export function getControls() {
  return {
    bright:   getNumericInput('bright', 0),
    contrast: getNumericInput('contrast', 0),
    sharp:    getNumericInput('sharp', 0),
    skin:     getNumericInput('skin', 0),
    feather:  getNumericInput('feather', 0),
    shadow:   getNumericInput('shadow', 0),
  };
}

/**
 * Đồng bộ label % zoom và thanh range slider từ state.crop.scale.
 * Nguồn duy nhất cho syncZoomUI — dùng bởi crop.js.
 * ui.js KHÔNG export hàm này để tránh circular import.
 */
export function syncZoomUI() {
  const percent = Math.round(state.crop.scale * 100);
  const zoomLbl = document.getElementById('zoom-lbl');
  const zoomRange = document.getElementById('zoom-range');
  if (zoomLbl) zoomLbl.textContent = `${percent}%`;
  if (zoomRange) zoomRange.value = `${Math.max(5, Math.min(2500, percent))}`;
}
