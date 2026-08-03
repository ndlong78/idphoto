import {
  evaluatePhotoCompliance,
  getComplianceProfile,
  projectBoxToOutput,
  projectHorizontalLineToOutput,
} from './compliance.js';
import {
  ensureCompositionGuides,
  renderCompositionGuides,
} from './composition-guides.js';
import { FMTS, state } from './state.js';
import {
  ensureCompliancePanel,
  getComplianceGeometrySignature,
  renderCompliancePanel,
} from './compliance-view.js';

let complianceLiveTimerId = 0;
let complianceLiveWindow = null;
let lastComplianceGeometrySignature = '';

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
 * Chiếu toàn bộ geometry nhận diện sang hệ tọa độ ảnh xuất.
 * Checker và visual guides cùng dùng hàm này để không lệch tọa độ.
 */
export function projectDetectedPhotoGeometry({
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

  return {
    formatKey,
    outputSize: { width: outputSize.width, height: outputSize.height },
    faceCount,
    faceBox,
    headBox,
    eyeLineY,
  };
}

/**
 * Chuyển face geometry sang hệ tọa độ ảnh xuất rồi chạy rule engine.
 * Hàm thuần để có thể unit test mà không phụ thuộc DOM/state toàn cục.
 *
 * @param {object} options
 * @returns {ReturnType<typeof evaluatePhotoCompliance>}
 */
export function evaluateDetectedPhotoCompliance(options) {
  const geometry = projectDetectedPhotoGeometry(options);
  return evaluatePhotoCompliance({
    formatKey: geometry.formatKey,
    photoSize: geometry.outputSize,
    faceCount: geometry.faceCount,
    faceBox: geometry.faceBox,
    headBox: geometry.headBox,
    eyeLineY: geometry.eyeLineY,
  });
}

function buildCurrentComplianceSnapshot() {
  const format = FMTS[state.curFmt];
  if (!format || !state.origImg) {
    state.complianceResult = null;
    return { geometry: null, profile: null, result: null };
  }

  const cropRect = deriveCropRect(state);
  const geometry = projectDetectedPhotoGeometry({
    formatKey: state.curFmt,
    outputSize: { width: format.w, height: format.h },
    cropRect,
    resultOffsetPct: state.resultFaceOffsetPct,
    faceData: state.faceData,
  });
  const result = evaluatePhotoCompliance({
    formatKey: geometry.formatKey,
    photoSize: geometry.outputSize,
    faceCount: geometry.faceCount,
    faceBox: geometry.faceBox,
    headBox: geometry.headBox,
    eyeLineY: geometry.eyeLineY,
  });

  state.complianceResult = result;
  return {
    geometry,
    profile: getComplianceProfile(state.curFmt),
    result,
  };
}

/**
 * Cập nhật state.complianceResult sau khi pipeline đã có ảnh, crop và face data.
 *
 * @returns {ReturnType<typeof evaluatePhotoCompliance>|null}
 */
export function refreshComplianceResult() {
  return buildCurrentComplianceSnapshot().result;
}

/**
 * Tính lại compliance, render panel và cập nhật visual guides hiện tại.
 *
 * @param {Document} documentRef
 * @returns {ReturnType<typeof evaluatePhotoCompliance>|null}
 */
export function refreshComplianceView(documentRef = globalThis.document) {
  const snapshot = buildCurrentComplianceSnapshot();
  if (documentRef) {
    renderCompliancePanel(snapshot.result, documentRef);
    renderCompositionGuides(snapshot, documentRef);
  }
  return snapshot.result;
}

/**
 * Dừng vòng theo dõi geometry của editor.
 */
export function stopComplianceLiveUpdates() {
  if (complianceLiveTimerId && complianceLiveWindow) {
    complianceLiveWindow.clearInterval(complianceLiveTimerId);
  }
  complianceLiveTimerId = 0;
  complianceLiveWindow = null;
  lastComplianceGeometrySignature = '';
}

/**
 * Theo dõi thay đổi hình học của editor và chỉ tính lại checker khi signature đổi.
 * Không chạy lại face detection hoặc background removal.
 *
 * @param {object} options
 * @param {number} [options.intervalMs=120]
 * @param {Window} [options.windowRef]
 * @param {Document} [options.documentRef]
 * @returns {function(): void}
 */
export function startComplianceLiveUpdates({
  intervalMs = 120,
  windowRef = globalThis.window,
  documentRef = globalThis.document,
} = {}) {
  if (!windowRef || !documentRef) return () => {};
  if (!Number.isFinite(intervalMs) || intervalMs < 50) {
    throw new RangeError('intervalMs phải là số hữu hạn và không nhỏ hơn 50ms.');
  }

  ensureCompliancePanel(documentRef);
  ensureCompositionGuides(documentRef);
  if (complianceLiveTimerId) return stopComplianceLiveUpdates;

  const tick = () => {
    if (state.section !== 'editor') {
      lastComplianceGeometrySignature = '';
      return;
    }

    const signature = getComplianceGeometrySignature(state);
    if (signature === lastComplianceGeometrySignature) return;

    try {
      refreshComplianceView(documentRef);
      lastComplianceGeometrySignature = signature;
    } catch {
      lastComplianceGeometrySignature = '';
      state.complianceResult = null;
      renderCompliancePanel(null, documentRef);
      renderCompositionGuides({}, documentRef);
    }
  };

  complianceLiveWindow = windowRef;
  tick();
  complianceLiveTimerId = windowRef.setInterval(tick, intervalMs);
  return stopComplianceLiveUpdates;
}

function autoStartComplianceLiveUpdates() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const start = () => startComplianceLiveUpdates({ windowRef: window, documentRef: document });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}

autoStartComplianceLiveUpdates();
