export const IMAGE_QUALITY_STATUS = Object.freeze({
  PASS: 'pass',
  WARNING: 'warning',
  UNAVAILABLE: 'unavailable',
});

export const IMAGE_QUALITY_THRESHOLDS = Object.freeze({
  sampleMaxSide: 256,
  darkMean: 55,
  brightMean: 205,
  shadowClipRatio: 0.22,
  highlightClipRatio: 0.12,
  lowContrastStdDev: 24,
  blurLaplacianVariance: 90,
  minFaceShortSidePx: 180,
});

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeBox(box, canvas) {
  if (!box || !canvas) return null;
  const x = finite(box.x);
  const y = finite(box.y);
  const width = finite(box.width ?? box.w);
  const height = finite(box.height ?? box.h);
  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
    return null;
  }

  const left = clamp(x, 0, canvas.width);
  const top = clamp(y, 0, canvas.height);
  const right = clamp(x + width, 0, canvas.width);
  const bottom = clamp(y + height, 0, canvas.height);
  if (right - left < 3 || bottom - top < 3) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function makeCheck({ id, label, status, message, value = null, approximate = true }) {
  return { id, label, status, message, value, approximate };
}

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

function orientedSize(width, height) {
  return { short: Math.min(width, height), long: Math.max(width, height) };
}

export function computePixelQualityMetrics(data, width, height) {
  if (!(data instanceof Uint8ClampedArray) && !ArrayBuffer.isView(data)) {
    throw new TypeError('data phải là typed array RGBA.');
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3) {
    throw new RangeError('Kích thước mẫu phải là số nguyên và tối thiểu 3×3.');
  }
  if (data.length < width * height * 4) {
    throw new RangeError('Dữ liệu RGBA không đủ cho kích thước mẫu.');
  }

  const luminance = new Float64Array(width * height);
  let sum = 0;
  let sumSq = 0;
  let shadows = 0;
  let highlights = 0;

  for (let index = 0, pixel = 0; pixel < luminance.length; pixel += 1, index += 4) {
    const value = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
    luminance[pixel] = value;
    sum += value;
    sumSq += value * value;
    if (value <= 12) shadows += 1;
    if (value >= 245) highlights += 1;
  }

  const count = luminance.length;
  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);

  let lapSum = 0;
  let lapSumSq = 0;
  let lapCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const center = luminance[y * width + x];
      const laplacian = 4 * center
        - luminance[y * width + x - 1]
        - luminance[y * width + x + 1]
        - luminance[(y - 1) * width + x]
        - luminance[(y + 1) * width + x];
      lapSum += laplacian;
      lapSumSq += laplacian * laplacian;
      lapCount += 1;
    }
  }
  const lapMean = lapCount ? lapSum / lapCount : 0;
  const laplacianVariance = lapCount
    ? Math.max(0, lapSumSq / lapCount - lapMean * lapMean)
    : 0;

  return {
    width,
    height,
    luminanceMean: mean,
    luminanceStdDev: Math.sqrt(variance),
    shadowClipRatio: shadows / count,
    highlightClipRatio: highlights / count,
    laplacianVariance,
  };
}

function createSampleCanvas(sourceCanvas, width, height) {
  const doc = sourceCanvas?.ownerDocument ?? globalThis.document;
  if (!doc?.createElement) throw new Error('Không có document để tạo canvas lấy mẫu.');
  const canvas = doc.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function sampleCanvasRegion(sourceCanvas, region, maxSide = IMAGE_QUALITY_THRESHOLDS.sampleMaxSide) {
  if (!sourceCanvas || !Number.isFinite(sourceCanvas.width) || !Number.isFinite(sourceCanvas.height)) {
    throw new TypeError('Canvas nguồn không hợp lệ.');
  }

  const resolved = region ?? { x: 0, y: 0, width: sourceCanvas.width, height: sourceCanvas.height };
  const scale = Math.min(1, maxSide / Math.max(resolved.width, resolved.height));
  const width = Math.max(3, Math.round(resolved.width * scale));
  const height = Math.max(3, Math.round(resolved.height * scale));
  const sample = createSampleCanvas(sourceCanvas, width, height);
  const context = sample.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Không tạo được 2D context để phân tích ảnh.');

  context.drawImage(
    sourceCanvas,
    resolved.x,
    resolved.y,
    resolved.width,
    resolved.height,
    0,
    0,
    width,
    height,
  );
  const pixels = context.getImageData(0, 0, width, height);
  return computePixelQualityMetrics(pixels.data, width, height);
}

export function analyzeOriginalImageQuality(canvas, faceData = null) {
  if (!canvas || !Number.isFinite(canvas.width) || !Number.isFinite(canvas.height)
    || canvas.width <= 0 || canvas.height <= 0) {
    throw new TypeError('Canvas ảnh gốc chưa sẵn sàng.');
  }

  const faceBox = normalizeBox(faceData?.box, canvas);
  const faceCount = Number.isInteger(faceData?.faceCount)
    ? faceData.faceCount
    : faceBox
      ? 1
      : 0;

  return {
    imageSize: { width: canvas.width, height: canvas.height },
    fullFrame: sampleCanvasRegion(canvas, null),
    faceRegion: faceBox ? sampleCanvasRegion(canvas, faceBox) : null,
    faceBox: faceBox
      ? { x: faceBox.x, y: faceBox.y, width: faceBox.width, height: faceBox.height }
      : null,
    faceCount,
  };
}

export function evaluateImageQuality({
  metrics,
  format,
  formatKey = 'generic',
  thresholds = IMAGE_QUALITY_THRESHOLDS,
} = {}) {
  if (!metrics?.imageSize || !metrics?.fullFrame) return null;

  const checks = [];
  const source = orientedSize(metrics.imageSize.width, metrics.imageSize.height);
  const target = format?.w && format?.h ? orientedSize(format.w, format.h) : null;

  if (target) {
    const enoughResolution = source.short >= target.short && source.long >= target.long;
    checks.push(makeCheck({
      id: 'source-resolution',
      label: 'Độ phân giải ảnh gốc',
      status: enoughResolution ? IMAGE_QUALITY_STATUS.PASS : IMAGE_QUALITY_STATUS.WARNING,
      message: enoughResolution
        ? `Ảnh gốc ${metrics.imageSize.width} × ${metrics.imageSize.height} px đủ pixel gốc cho preset ${format.lbl ?? formatKey} ở mốc 300 DPI.`
        : `Ảnh gốc ${metrics.imageSize.width} × ${metrics.imageSize.height} px thấp hơn kích thước ${format.w} × ${format.h} px của preset; file xuất có thể phải phóng lớn.`,
      value: { source, target },
      approximate: false,
    }));
  } else {
    checks.push(makeCheck({
      id: 'source-resolution',
      label: 'Độ phân giải ảnh gốc',
      status: IMAGE_QUALITY_STATUS.UNAVAILABLE,
      message: 'Chưa có kích thước preset để đối chiếu độ phân giải.',
    }));
  }

  const frame = metrics.fullFrame;
  let exposureStatus = IMAGE_QUALITY_STATUS.PASS;
  let exposureMessage = `Độ sáng trung bình khoảng ${Math.round(frame.luminanceMean)}/255.`;
  if (frame.luminanceMean < thresholds.darkMean) {
    exposureStatus = IMAGE_QUALITY_STATUS.WARNING;
    exposureMessage = 'Ảnh có vẻ thiếu sáng; nên chụp lại ở nơi sáng đều và tránh tăng sáng quá mạnh bằng phần mềm.';
  } else if (frame.luminanceMean > thresholds.brightMean) {
    exposureStatus = IMAGE_QUALITY_STATUS.WARNING;
    exposureMessage = 'Ảnh có vẻ quá sáng; nên giảm ánh sáng trực diện và tránh vùng da bị mất chi tiết.';
  }
  checks.push(makeCheck({
    id: 'exposure',
    label: 'Mức sáng tổng thể',
    status: exposureStatus,
    message: exposureMessage,
    value: frame.luminanceMean,
  }));

  const clipped = frame.shadowClipRatio > thresholds.shadowClipRatio
    || frame.highlightClipRatio > thresholds.highlightClipRatio;
  checks.push(makeCheck({
    id: 'clipping',
    label: 'Chi tiết vùng sáng và tối',
    status: clipped ? IMAGE_QUALITY_STATUS.WARNING : IMAGE_QUALITY_STATUS.PASS,
    message: clipped
      ? `Khoảng ${percent(frame.shadowClipRatio)} vùng ảnh gần đen và ${percent(frame.highlightClipRatio)} gần trắng; một số chi tiết có thể đã mất.`
      : 'Không thấy tỷ lệ lớn pixel bị dồn sát đen hoặc trắng trong mẫu ảnh.',
    value: {
      shadowClipRatio: frame.shadowClipRatio,
      highlightClipRatio: frame.highlightClipRatio,
    },
  }));

  const lowContrast = frame.luminanceStdDev < thresholds.lowContrastStdDev;
  checks.push(makeCheck({
    id: 'contrast',
    label: 'Tương phản ảnh gốc',
    status: lowContrast ? IMAGE_QUALITY_STATUS.WARNING : IMAGE_QUALITY_STATUS.PASS,
    message: lowContrast
      ? 'Ảnh có tương phản thấp; khuôn mặt có thể thiếu khối và khó tách khỏi nền.'
      : 'Mẫu ảnh có mức biến thiên sáng tối đủ để không phát hiện cảnh báo tương phản thấp.',
    value: frame.luminanceStdDev,
  }));

  const sharpnessSample = metrics.faceRegion ?? metrics.fullFrame;
  const sharpnessScope = metrics.faceRegion ? 'vùng khuôn mặt' : 'toàn ảnh';
  const blurry = sharpnessSample.laplacianVariance < thresholds.blurLaplacianVariance;
  checks.push(makeCheck({
    id: 'sharpness',
    label: 'Độ nét ước lượng',
    status: blurry ? IMAGE_QUALITY_STATUS.WARNING : IMAGE_QUALITY_STATUS.PASS,
    message: blurry
      ? `Độ nét ước lượng trong ${sharpnessScope} thấp; nên dùng ảnh không rung, lấy nét đúng vào mắt và khuôn mặt.`
      : `Không thấy cảnh báo mờ rõ rệt trong ${sharpnessScope} theo phép đo cạnh ảnh.`,
    value: sharpnessSample.laplacianVariance,
  }));

  if (metrics.faceCount !== 1 || !metrics.faceBox) {
    checks.push(makeCheck({
      id: 'face-detail',
      label: 'Chi tiết khuôn mặt trong ảnh gốc',
      status: IMAGE_QUALITY_STATUS.UNAVAILABLE,
      message: metrics.faceCount > 1
        ? 'Có nhiều khuôn mặt nên chưa thể chọn vùng mặt để đánh giá lượng chi tiết.'
        : 'Chưa có vùng khuôn mặt để đánh giá lượng pixel gốc.',
    }));
  } else {
    const shortSide = Math.min(metrics.faceBox.width, metrics.faceBox.height);
    const smallFace = shortSide < thresholds.minFaceShortSidePx;
    checks.push(makeCheck({
      id: 'face-detail',
      label: 'Chi tiết khuôn mặt trong ảnh gốc',
      status: smallFace ? IMAGE_QUALITY_STATUS.WARNING : IMAGE_QUALITY_STATUS.PASS,
      message: smallFace
        ? `Cạnh ngắn vùng khuôn mặt chỉ khoảng ${Math.round(shortSide)} px; nên dùng ảnh chụp gần hơn hoặc có độ phân giải cao hơn.`
        : `Vùng khuôn mặt có cạnh ngắn khoảng ${Math.round(shortSide)} px, chưa phát hiện cảnh báo thiếu pixel gốc.`,
      value: shortSide,
    }));
  }

  const warningCount = checks.filter((check) => check.status === IMAGE_QUALITY_STATUS.WARNING).length;
  return {
    formatKey,
    automatedStatus: warningCount > 0 ? 'review-needed' : 'no-automatic-warning',
    hasWarnings: warningCount > 0,
    checks,
    metrics: {
      imageSize: metrics.imageSize,
      luminanceMean: frame.luminanceMean,
      luminanceStdDev: frame.luminanceStdDev,
      shadowClipRatio: frame.shadowClipRatio,
      highlightClipRatio: frame.highlightClipRatio,
      sharpnessScope,
      laplacianVariance: sharpnessSample.laplacianVariance,
    },
    disclaimer: 'Các phép đo chất lượng là ước lượng kỹ thuật của ứng dụng, không xác nhận ảnh chắc chắn được cơ quan tiếp nhận chấp thuận.',
  };
}
