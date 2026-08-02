import {
  evaluatePhotoCompliance,
  projectBoxToOutput,
  projectHorizontalLineToOutput,
} from './compliance.js';
import { FMTS, state } from './state.js';

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

/**
 * Tính crop rect trong hệ tọa độ ảnh gốc từ state của editor.
 * Công thức phải đồng nhất với getCropRect() trong render.js.
 *
 * @param {object} snapshot
 * @returns {{x:number,y:number,width:number,height:number}}
 */
export function deriveCropRect(snapshot) {
  const image = snapshot?.origImg;
  const frame = snapshot?.frame;
  const crop = snapshot?.crop;
  const scale = crop?.scale;

  if (!image || !Number.isFinite(image.width) || !Number.isFinite(image.height)) {
    throw new TypeError('Thiếu kích thước ảnh gốc để tính crop rect.');
  }

  if (!Number.isFinite(scale) || scale <= 0) {
    return { x: 0, y: 0, width: image.width, height: image.height };
  }

  if (
    !frame
    || !Number.isFinite(frame.x)
    || !Number.isFinite(frame.y)
    || !Number.isFinite(frame.w)
    || !Number.isFinite(frame.h)
    || frame.w <= 0
    || frame.h <= 0
    || !Number.isFinite(crop.x)
    || !Number.isFinite(crop.y)
  ) {
    return { x: 0, y: 0, width: image.width, height: image.height };
  }

  return {
    x: (frame.x - crop.x) / scale,
    y: (frame.y - crop.y) / scale,
    width: frame.w / scale,
    height: frame.h / scale,
  };
}

/**
 * Chuyển face geometry sang hệ tọa độ ảnh xuất rồi chạy rule engine.
 * Hàm thuần để có thể unit test mà không phụ thuộc DOM/state toàn cục.
 *
 * @param {object} options
 * @returns {ReturnType<typeof evaluatePhotoCompliance>}
 */
export function evaluateDetectedPhotoCompliance({
  formatKey,
  outputSize,
  cropRect,
  resultOffsetPct = { x: 0, y: 0 },
  faceData = null,
}) {
  const faceCount = Number.isInteger(faceData?.faceCount)
    ? faceData.faceCount
    : faceData?.box
      ? 1
      : 0;

  const faceBox = faceData?.box
    ? projectBoxToOutput({
        box: faceData.box,
        cropRect,
        outputSize,
        resultOffsetPct,
      })
    : null;

  const headBox = faceData?.headBox
    ? projectBoxToOutput({
        box: faceData.headBox,
        cropRect,
        outputSize,
        resultOffsetPct,
      })
    : null;

  const sourceEyeLineY = finiteOrNull(faceData?.eyeLineY);
  const eyeLineY = sourceEyeLineY === null
    ? null
    : projectHorizontalLineToOutput({
        sourceY: sourceEyeLineY,
        cropRect,
        outputSize,
        resultOffsetPct,
      });

  return evaluatePhotoCompliance({
    formatKey,
    photoSize: outputSize,
    faceCount,
    faceBox,
    headBox,
    eyeLineY,
  });
}

/**
 * Cập nhật state.complianceResult sau khi pipeline đã có ảnh, crop và face data.
 * Chưa hiển thị lên UI trong PR #33.
 *
 * @returns {ReturnType<typeof evaluatePhotoCompliance>|null}
 */
export function refreshComplianceResult() {
  const format = FMTS[state.curFmt];
  if (!format || !state.origImg) {
    state.complianceResult = null;
    return null;
  }

  const cropRect = deriveCropRect(state);
  const result = evaluateDetectedPhotoCompliance({
    formatKey: state.curFmt,
    outputSize: { width: format.w, height: format.h },
    cropRect,
    resultOffsetPct: state.resultFaceOffsetPct,
    faceData: state.faceData,
  });

  state.complianceResult = result;
  return result;
}
