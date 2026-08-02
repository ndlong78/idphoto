export const COMPLIANCE_STATUS = Object.freeze({
  PASS: 'pass',
  WARNING: 'warning',
  MANUAL: 'manual',
  UNAVAILABLE: 'unavailable',
});

export const AUTOMATED_REVIEW_STATUS = Object.freeze({
  NO_WARNING: 'no-automatic-warning',
  REVIEW: 'review-needed',
});

const GENERIC_PROFILE = Object.freeze({
  key: 'generic',
  sourceUrl: null,
  horizontalCenterTolerance: 0.08,
  faceAreaRange: null,
  headHeightRange: null,
  eyeLineFromTopRange: null,
  manualChecks: Object.freeze([
    Object.freeze({ id: 'pose', label: 'Tư thế và biểu cảm', message: 'Kiểm tra người chụp nhìn thẳng, biểu cảm phù hợp và mắt nhìn rõ.' }),
    Object.freeze({ id: 'background', label: 'Phông nền', message: 'Kiểm tra màu nền, bóng đổ và vật thể phía sau theo yêu cầu hồ sơ.' }),
    Object.freeze({ id: 'appearance', label: 'Phụ kiện che mặt', message: 'Kiểm tra kính, tóc, mũ hoặc vật dụng không che các đặc điểm nhận dạng.' }),
  ]),
});

export const COMPLIANCE_PROFILES = Object.freeze({
  'passport-vn': Object.freeze({
    key: 'passport-vn',
    sourceUrl: 'https://dichvucong.bocongan.gov.vn/bocongan/tintuc/chitiet?matin=141',
    horizontalCenterTolerance: 0.08,
    // Nguồn chính thức nêu khuôn mặt chiếm khoảng 75% diện tích ảnh.
    // Dải ±10 điểm phần trăm là tolerance cảnh báo của ứng dụng, không phải
    // ngưỡng chấp nhận chính thức của cơ quan tiếp nhận.
    faceAreaRange: Object.freeze({ min: 0.65, max: 0.85, target: 0.75, approximate: true }),
    headHeightRange: null,
    // Từ yêu cầu: khoảng cách mắt→mép trên ≈ 2/3 khoảng cách mắt→mép dưới.
    // Suy ra eye line mục tiêu ≈ 40% chiều cao tính từ mép trên.
    eyeLineFromTopRange: Object.freeze({ min: 0.35, max: 0.45, target: 0.40, approximate: true }),
    manualChecks: Object.freeze([
      Object.freeze({ id: 'recent', label: 'Ảnh mới chụp', message: 'Ảnh cần được chụp trong vòng 6 tháng.' }),
      Object.freeze({ id: 'pose', label: 'Mặt nhìn thẳng', message: 'Kiểm tra mặt nhìn thẳng, lộ hai vành tai và đầu để trần.' }),
      Object.freeze({ id: 'glasses', label: 'Không đeo kính', message: 'Kiểm tra người chụp không đeo kính.' }),
      Object.freeze({ id: 'background', label: 'Phông nền trắng', message: 'Kiểm tra nền trắng, đồng đều và không có bóng hoặc vật thể.' }),
    ]),
  }),
  'us-visa': Object.freeze({
    key: 'us-visa',
    sourceUrl: 'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/photos/photo-composition-template.html',
    horizontalCenterTolerance: 0.08,
    faceAreaRange: null,
    headHeightRange: Object.freeze({ min: 0.50, max: 0.69, approximate: false }),
    // Nguồn quy định mắt cách đáy 56–69% chiều cao ảnh, tương đương
    // 31–44% tính từ mép trên.
    eyeLineFromTopRange: Object.freeze({ min: 0.31, max: 0.44, approximate: false }),
    manualChecks: Object.freeze([
      Object.freeze({ id: 'recent', label: 'Ảnh mới chụp', message: 'Ảnh cần được chụp trong vòng 6 tháng.' }),
      Object.freeze({ id: 'pose', label: 'Tư thế và biểu cảm', message: 'Kiểm tra mặt nhìn thẳng, biểu cảm trung tính và hai mắt mở.' }),
      Object.freeze({ id: 'glasses', label: 'Không đeo kính', message: 'Ảnh visa Mỹ thông thường không được đeo kính.' }),
      Object.freeze({ id: 'background', label: 'Nền trắng hoặc trắng ngà', message: 'Kiểm tra nền trơn, trắng hoặc trắng ngà, không có bóng.' }),
    ]),
  }),
});

function assertFiniteNumber(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} phải là số hữu hạn.`);
  return value;
}

function assertPositiveNumber(value, name) {
  assertFiniteNumber(value, name);
  if (value <= 0) throw new RangeError(`${name} phải lớn hơn 0.`);
  return value;
}

function normalizeSize(size, name = 'photoSize') {
  if (!size || typeof size !== 'object') throw new TypeError(`${name} không hợp lệ.`);
  return {
    width: assertPositiveNumber(size.width, `${name}.width`),
    height: assertPositiveNumber(size.height, `${name}.height`),
  };
}

function normalizeBox(box, name = 'box') {
  if (!box || typeof box !== 'object') throw new TypeError(`${name} không hợp lệ.`);
  const width = box.width ?? box.w;
  const height = box.height ?? box.h;
  return {
    x: assertFiniteNumber(box.x, `${name}.x`),
    y: assertFiniteNumber(box.y, `${name}.y`),
    width: assertPositiveNumber(width, `${name}.width`),
    height: assertPositiveNumber(height, `${name}.height`),
  };
}

function normalizeOffset(offset = {}) {
  return {
    x: assertFiniteNumber(offset.x ?? 0, 'resultOffsetPct.x'),
    y: assertFiniteNumber(offset.y ?? 0, 'resultOffsetPct.y'),
  };
}

function ratioInRange(value, range) {
  return value >= range.min && value <= range.max;
}

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

function makeRangeCheck({ id, label, value, range, passMessage, warningMessage }) {
  if (!range) {
    return {
      id,
      label,
      status: COMPLIANCE_STATUS.UNAVAILABLE,
      message: 'Preset hiện tại chưa có quy tắc tự động cho tiêu chí này.',
      value: null,
    };
  }
  if (!Number.isFinite(value)) {
    return {
      id,
      label,
      status: COMPLIANCE_STATUS.UNAVAILABLE,
      message: 'Không đủ dữ liệu để đánh giá tự động.',
      value: null,
      min: range.min,
      max: range.max,
      approximate: Boolean(range.approximate),
    };
  }
  const pass = ratioInRange(value, range);
  return {
    id,
    label,
    status: pass ? COMPLIANCE_STATUS.PASS : COMPLIANCE_STATUS.WARNING,
    message: pass ? passMessage(value, range) : warningMessage(value, range),
    value,
    min: range.min,
    max: range.max,
    target: range.target ?? null,
    approximate: Boolean(range.approximate),
  };
}

export function getComplianceProfile(formatKey) {
  return COMPLIANCE_PROFILES[formatKey] ?? GENERIC_PROFILE;
}

export function projectBoxToOutput({
  box,
  cropRect,
  outputSize,
  resultOffsetPct = { x: 0, y: 0 },
}) {
  const sourceBox = normalizeBox(box, 'box');
  const crop = normalizeBox(cropRect, 'cropRect');
  const output = normalizeSize(outputSize, 'outputSize');
  const offset = normalizeOffset(resultOffsetPct);
  const scaleX = output.width / crop.width;
  const scaleY = output.height / crop.height;
  const projected = {
    x: (sourceBox.x - crop.x) * scaleX + (offset.x / 100) * output.width,
    y: (sourceBox.y - crop.y) * scaleY + (offset.y / 100) * output.height,
    width: sourceBox.width * scaleX,
    height: sourceBox.height * scaleY,
  };
  return {
    ...projected,
    right: projected.x + projected.width,
    bottom: projected.y + projected.height,
    centerX: projected.x + projected.width / 2,
    centerY: projected.y + projected.height / 2,
  };
}

export function projectHorizontalLineToOutput({
  sourceY,
  cropRect,
  outputSize,
  resultOffsetPct = { x: 0, y: 0 },
}) {
  assertFiniteNumber(sourceY, 'sourceY');
  const crop = normalizeBox(cropRect, 'cropRect');
  const output = normalizeSize(outputSize, 'outputSize');
  const offset = normalizeOffset(resultOffsetPct);
  return (sourceY - crop.y) * (output.height / crop.height) + (offset.y / 100) * output.height;
}

export function evaluatePhotoCompliance({
  formatKey = 'generic',
  photoSize,
  faceCount,
  faceBox = null,
  headBox = null,
  eyeLineY = null,
}) {
  const photo = normalizeSize(photoSize);
  const profile = getComplianceProfile(formatKey);
  const normalizedFaceBox = faceBox ? normalizeBox(faceBox, 'faceBox') : null;
  const normalizedHeadBox = headBox ? normalizeBox(headBox, 'headBox') : null;
  const resolvedFaceCount = faceCount ?? (normalizedFaceBox ? 1 : 0);
  if (!Number.isInteger(resolvedFaceCount) || resolvedFaceCount < 0) {
    throw new RangeError('faceCount phải là số nguyên không âm.');
  }
  if (eyeLineY !== null) assertFiniteNumber(eyeLineY, 'eyeLineY');

  const checks = [];
  checks.push({
    id: 'face-count',
    label: 'Số khuôn mặt',
    status: resolvedFaceCount === 1 ? COMPLIANCE_STATUS.PASS : COMPLIANCE_STATUS.WARNING,
    message: resolvedFaceCount === 1
      ? 'Phát hiện đúng một khuôn mặt.'
      : resolvedFaceCount === 0
        ? 'Không phát hiện khuôn mặt để đánh giá bố cục.'
        : `Phát hiện ${resolvedFaceCount} khuôn mặt; ảnh hồ sơ thường chỉ được có một người.`,
    value: resolvedFaceCount,
  });

  let faceAreaRatio = null;
  let horizontalCenterDeviation = null;
  let faceClipped = null;
  if (normalizedFaceBox) {
    const right = normalizedFaceBox.x + normalizedFaceBox.width;
    const bottom = normalizedFaceBox.y + normalizedFaceBox.height;
    faceClipped = normalizedFaceBox.x < 0
      || normalizedFaceBox.y < 0
      || right > photo.width
      || bottom > photo.height;
    checks.push({
      id: 'face-clipping',
      label: 'Khuôn mặt trong khung',
      status: faceClipped ? COMPLIANCE_STATUS.WARNING : COMPLIANCE_STATUS.PASS,
      message: faceClipped
        ? 'Một phần vùng khuôn mặt nằm ngoài khung ảnh.'
        : 'Vùng khuôn mặt nằm trọn trong khung ảnh.',
      value: faceClipped,
    });

    horizontalCenterDeviation = Math.abs(
      (normalizedFaceBox.x + normalizedFaceBox.width / 2) / photo.width - 0.5,
    );
    const centered = horizontalCenterDeviation <= profile.horizontalCenterTolerance;
    checks.push({
      id: 'horizontal-centering',
      label: 'Căn giữa ngang',
      status: centered ? COMPLIANCE_STATUS.PASS : COMPLIANCE_STATUS.WARNING,
      message: centered
        ? 'Khuôn mặt nằm gần tâm ngang của ảnh.'
        : `Khuôn mặt lệch tâm ngang khoảng ${percent(horizontalCenterDeviation)} chiều rộng ảnh.`,
      value: horizontalCenterDeviation,
      max: profile.horizontalCenterTolerance,
      approximate: true,
    });

    faceAreaRatio = (normalizedFaceBox.width * normalizedFaceBox.height) / (photo.width * photo.height);
  } else {
    for (const [id, label] of [
      ['face-clipping', 'Khuôn mặt trong khung'],
      ['horizontal-centering', 'Căn giữa ngang'],
    ]) {
      checks.push({
        id,
        label,
        status: COMPLIANCE_STATUS.UNAVAILABLE,
        message: 'Không có vùng khuôn mặt để đánh giá.',
        value: null,
      });
    }
  }

  checks.push(makeRangeCheck({
    id: 'face-area',
    label: 'Tỷ lệ diện tích khuôn mặt',
    value: faceAreaRatio,
    range: profile.faceAreaRange,
    passMessage: (value) => `Diện tích vùng khuôn mặt khoảng ${percent(value)} diện tích ảnh.`,
    warningMessage: (value, range) => `Diện tích vùng khuôn mặt khoảng ${percent(value)}; vùng cảnh báo là ngoài ${percent(range.min)}–${percent(range.max)}.`,
  }));

  const headHeightRatio = normalizedHeadBox ? normalizedHeadBox.height / photo.height : null;
  checks.push(makeRangeCheck({
    id: 'head-height',
    label: 'Chiều cao đầu',
    value: headHeightRatio,
    range: profile.headHeightRange,
    passMessage: (value) => `Chiều cao đầu khoảng ${percent(value)} chiều cao ảnh.`,
    warningMessage: (value, range) => `Chiều cao đầu khoảng ${percent(value)}; yêu cầu của preset là ${percent(range.min)}–${percent(range.max)}.`,
  }));

  const eyeLineFromTopRatio = eyeLineY === null ? null : eyeLineY / photo.height;
  checks.push(makeRangeCheck({
    id: 'eye-line',
    label: 'Vị trí đường mắt',
    value: eyeLineFromTopRatio,
    range: profile.eyeLineFromTopRange,
    passMessage: (value) => `Đường mắt nằm khoảng ${percent(value)} chiều cao tính từ mép trên.`,
    warningMessage: (value, range) => `Đường mắt nằm khoảng ${percent(value)} từ mép trên; vùng cảnh báo là ngoài ${percent(range.min)}–${percent(range.max)}.`,
  }));

  for (const item of profile.manualChecks) {
    checks.push({
      ...item,
      status: COMPLIANCE_STATUS.MANUAL,
      value: null,
    });
  }

  const hasWarnings = checks.some((check) => check.status === COMPLIANCE_STATUS.WARNING);
  return {
    formatKey,
    profileKey: profile.key,
    sourceUrl: profile.sourceUrl,
    automatedStatus: hasWarnings
      ? AUTOMATED_REVIEW_STATUS.REVIEW
      : AUTOMATED_REVIEW_STATUS.NO_WARNING,
    hasWarnings,
    checks,
    metrics: {
      faceAreaRatio,
      headHeightRatio,
      eyeLineFromTopRatio,
      horizontalCenterDeviation,
      faceClipped,
    },
    disclaimer: 'Kết quả chỉ là cảnh báo hỗ trợ căn chỉnh, không phải xác nhận ảnh được cơ quan tiếp nhận chấp thuận.',
  };
}
