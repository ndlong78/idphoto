const MIN_CROP_SCALE = 0.04;
const MAX_CROP_SCALE = 25;
const FACE_MARGIN_RATIO = 0.025;
const MATCH_EPSILON = 1e-4;

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function clamp(value, min, max) {
  if (min > max) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

function normalizeFrame(frame) {
  if (!frame) return null;
  const x = finite(frame.x);
  const y = finite(frame.y);
  const width = finite(frame.w ?? frame.width);
  const height = finite(frame.h ?? frame.height);
  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
}

function normalizeBox(box) {
  if (!box) return null;
  const x = finite(box.x);
  const y = finite(box.y);
  const width = finite(box.width ?? box.w);
  const height = finite(box.height ?? box.h);
  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
}

function targetFromRange(range) {
  if (!range) return null;
  if (Number.isFinite(range.target)) return range.target;
  if (Number.isFinite(range.min) && Number.isFinite(range.max)) {
    return (range.min + range.max) / 2;
  }
  return null;
}

function valuesClose(a, b, epsilon = MATCH_EPSILON) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= epsilon;
}

/**
 * Snapshot tối thiểu để hoàn tác một lần sau khi căn tự động.
 */
export function captureCompositionState(snapshot) {
  return {
    imageRef: snapshot?.origImg ?? null,
    formatKey: snapshot?.curFmt ?? null,
    crop: {
      x: finite(snapshot?.crop?.x) ?? 0,
      y: finite(snapshot?.crop?.y) ?? 0,
      scale: finite(snapshot?.crop?.scale) ?? 1,
    },
    faceAdjust: {
      yOffsetPct: finite(snapshot?.faceAdjust?.yOffsetPct) ?? 0,
    },
    resultFaceOffsetPct: {
      x: finite(snapshot?.resultFaceOffsetPct?.x) ?? 0,
      y: finite(snapshot?.resultFaceOffsetPct?.y) ?? 0,
    },
  };
}

/**
 * Kiểm tra bố cục hiện tại còn đúng trạng thái sau auto-fix hay đã bị chỉnh tay.
 */
export function compositionStateMatches(snapshot, expected, epsilon = MATCH_EPSILON) {
  if (!expected || snapshot?.origImg !== expected.imageRef || snapshot?.curFmt !== expected.formatKey) {
    return false;
  }
  const current = captureCompositionState(snapshot);
  return valuesClose(current.crop.x, expected.crop.x, epsilon)
    && valuesClose(current.crop.y, expected.crop.y, epsilon)
    && valuesClose(current.crop.scale, expected.crop.scale, epsilon)
    && valuesClose(current.faceAdjust.yOffsetPct, expected.faceAdjust.yOffsetPct, epsilon)
    && valuesClose(current.resultFaceOffsetPct.x, expected.resultFaceOffsetPct.x, epsilon)
    && valuesClose(current.resultFaceOffsetPct.y, expected.resultFaceOffsetPct.y, epsilon);
}

/**
 * Tạo kế hoạch căn chỉnh từ face box/eye line nguồn và profile hiện tại.
 * Chỉ dùng dữ liệu có thể đo; không suy đoán head box.
 */
export function buildAutoCompositionPlan({ snapshot, profile } = {}) {
  const frame = normalizeFrame(snapshot?.frame);
  const faceBox = normalizeBox(snapshot?.faceData?.box);
  const headBox = normalizeBox(snapshot?.faceData?.headBox);
  const currentScale = finite(snapshot?.crop?.scale);
  const faceCount = Number.isInteger(snapshot?.faceData?.faceCount)
    ? snapshot.faceData.faceCount
    : faceBox
      ? 1
      : 0;

  if (!snapshot?.origImg || !frame || !faceBox || currentScale === null || currentScale <= 0) {
    return {
      ok: false,
      code: 'missing-geometry',
      message: 'Chưa có đủ dữ liệu khuôn mặt để căn tự động.',
    };
  }
  if (faceCount !== 1) {
    return {
      ok: false,
      code: faceCount === 0 ? 'no-face' : 'multiple-faces',
      message: faceCount === 0
        ? 'Chưa nhận diện được khuôn mặt để căn tự động.'
        : 'Căn tự động chỉ hoạt động với ảnh có đúng một khuôn mặt.',
    };
  }

  const changes = [];
  const limitations = [];
  let scale = currentScale;
  let scaleSource = 'preserve';

  const faceAreaTarget = targetFromRange(profile?.faceAreaRange);
  const headHeightTarget = targetFromRange(profile?.headHeightRange);
  if (Number.isFinite(faceAreaTarget) && faceAreaTarget > 0) {
    scale = Math.sqrt(
      (faceAreaTarget * frame.width * frame.height) / (faceBox.width * faceBox.height),
    );
    scaleSource = 'face-area';
    changes.push('scale-face-area');
  } else if (headBox && Number.isFinite(headHeightTarget) && headHeightTarget > 0) {
    scale = (headHeightTarget * frame.height) / headBox.height;
    scaleSource = 'head-height';
    changes.push('scale-head-height');
  } else if (profile?.headHeightRange && !headBox) {
    limitations.push('Chiều cao đầu chưa được tự động điều chỉnh vì chưa có vùng đỉnh đầu–cằm đáng tin cậy.');
  } else {
    limitations.push('Preset này chưa có tỷ lệ zoom tự động; mức zoom hiện tại được giữ lại.');
  }

  const horizontalMargin = frame.width * FACE_MARGIN_RATIO;
  const verticalMargin = frame.height * FACE_MARGIN_RATIO;
  const maxFaceScale = Math.min(
    (frame.width - horizontalMargin * 2) / faceBox.width,
    (frame.height - verticalMargin * 2) / faceBox.height,
  );
  scale = clamp(scale, MIN_CROP_SCALE, Math.min(MAX_CROP_SCALE, maxFaceScale));

  const desiredFaceCenterX = frame.x + frame.width / 2;
  let cropX = desiredFaceCenterX - (faceBox.x + faceBox.width / 2) * scale;
  changes.push('center-horizontal');

  const sourceEyeLineY = finite(snapshot?.faceData?.eyeLineY);
  const eyeLineTarget = targetFromRange(profile?.eyeLineFromTopRange);
  let cropY;
  let verticalMode;
  if (sourceEyeLineY !== null && Number.isFinite(eyeLineTarget)) {
    cropY = frame.y + eyeLineTarget * frame.height - sourceEyeLineY * scale;
    verticalMode = 'eye-line';
    changes.push('align-eye-line');
  } else {
    cropY = frame.y + frame.height / 2 - (faceBox.y + faceBox.height / 2) * scale;
    verticalMode = 'face-center';
    changes.push('center-vertical');
    if (profile?.eyeLineFromTopRange && sourceEyeLineY === null) {
      limitations.push('Vị trí mắt chưa được tự động điều chỉnh vì thiếu landmarks mắt.');
    }
  }

  const minCropX = frame.x + horizontalMargin - faceBox.x * scale;
  const maxCropX = frame.x + frame.width - horizontalMargin - (faceBox.x + faceBox.width) * scale;
  const minCropY = frame.y + verticalMargin - faceBox.y * scale;
  const maxCropY = frame.y + frame.height - verticalMargin - (faceBox.y + faceBox.height) * scale;
  cropX = clamp(cropX, minCropX, maxCropX);
  cropY = clamp(cropY, minCropY, maxCropY);

  const next = {
    crop: { x: cropX, y: cropY, scale },
    faceAdjust: { yOffsetPct: 0 },
    resultFaceOffsetPct: { x: 0, y: 0 },
  };
  const current = captureCompositionState(snapshot);
  const changed = !valuesClose(next.crop.x, current.crop.x)
    || !valuesClose(next.crop.y, current.crop.y)
    || !valuesClose(next.crop.scale, current.crop.scale)
    || !valuesClose(current.faceAdjust.yOffsetPct, 0)
    || !valuesClose(current.resultFaceOffsetPct.x, 0)
    || !valuesClose(current.resultFaceOffsetPct.y, 0);

  if (current.resultFaceOffsetPct.x !== 0 || current.resultFaceOffsetPct.y !== 0) {
    changes.push('reset-result-offset');
  }

  const messageParts = ['Đã căn khuôn mặt về tâm'];
  if (scaleSource === 'face-area') messageParts.push('điều chỉnh tỷ lệ khuôn mặt');
  if (scaleSource === 'head-height') messageParts.push('điều chỉnh chiều cao đầu');
  if (verticalMode === 'eye-line') messageParts.push('đưa đường mắt về vị trí mục tiêu');

  return {
    ok: true,
    code: changed ? 'applied' : 'already-aligned',
    changed,
    next,
    changes: [...new Set(changes)],
    limitations,
    message: changed
      ? `${messageParts.join(', ')}.`
      : 'Bố cục hiện đã gần với các mục tiêu tự động có dữ liệu.',
  };
}

/** Áp dụng kế hoạch vào shared state của editor. */
export function applyAutoCompositionPlan(snapshot, plan) {
  if (!plan?.ok || !plan.next) return false;
  snapshot.crop = { ...plan.next.crop };
  snapshot.faceAdjust = { ...plan.next.faceAdjust };
  snapshot.resultFaceOffsetPct = { ...plan.next.resultFaceOffsetPct };
  return true;
}

/** Khôi phục snapshot trước auto-fix nếu vẫn cùng ảnh và preset. */
export function restoreCompositionState(snapshot, captured) {
  if (!captured || snapshot?.origImg !== captured.imageRef || snapshot?.curFmt !== captured.formatKey) {
    return false;
  }
  snapshot.crop = { ...captured.crop };
  snapshot.faceAdjust = { ...captured.faceAdjust };
  snapshot.resultFaceOffsetPct = { ...captured.resultFaceOffsetPct };
  return true;
}
