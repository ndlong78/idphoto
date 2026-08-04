const DEFAULT_THRESHOLDS = Object.freeze({
  foregroundMin: 0.08,
  foregroundMax: 0.94,
  backgroundSampleMin: 0.04,
  backgroundLumaStdMax: 24,
  backgroundColorStdMax: 34,
  backgroundQuadrantRangeMax: 38,
  faceMissingRatioMax: 0.025,
  holeAreaRatioMax: 0.012,
  largestHoleRatioMax: 0.004,
  detachedForegroundRatioMax: 0.008,
  wideFringePerBoundaryMax: 2.8,
  semiTransparentRatioMax: 0.12,
  edgeRoughnessMax: 3.5,
  hardEdgeSoftnessMax: 0.35,
  topTouchRatioMax: 0.08,
  sideTouchRatioMax: 0.08,
});

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function validateImageDataLike(imageData, label) {
  if (
    !imageData
    || !Number.isInteger(imageData.width)
    || !Number.isInteger(imageData.height)
    || imageData.width <= 0
    || imageData.height <= 0
    || !imageData.data
    || imageData.data.length !== imageData.width * imageData.height * 4
  ) {
    throw new TypeError(`${label} không phải ImageData hợp lệ.`);
  }
}

function forEachNeighbor4(index, width, height, callback) {
  const x = index % width;
  const y = Math.floor(index / width);
  if (x > 0) callback(index - 1);
  if (x < width - 1) callback(index + 1);
  if (y > 0) callback(index - width);
  if (y < height - 1) callback(index + width);
}

function analyzeForegroundComponents(foreground, width, height) {
  const visited = new Uint8Array(foreground.length);
  const queue = new Int32Array(foreground.length);
  let componentCount = 0;
  let largest = 0;

  for (let start = 0; start < foreground.length; start++) {
    if (!foreground[start] || visited[start]) continue;
    componentCount += 1;
    let head = 0;
    let tail = 0;
    let size = 0;
    visited[start] = 1;
    queue[tail++] = start;

    while (head < tail) {
      const index = queue[head++];
      size += 1;
      forEachNeighbor4(index, width, height, (neighbor) => {
        if (!foreground[neighbor] || visited[neighbor]) return;
        visited[neighbor] = 1;
        queue[tail++] = neighbor;
      });
    }
    if (size > largest) largest = size;
  }

  return { componentCount, largest };
}

function markExternalBackground(foreground, width, height) {
  const external = new Uint8Array(foreground.length);
  const queue = new Int32Array(foreground.length);
  let head = 0;
  let tail = 0;

  const enqueue = (index) => {
    if (foreground[index] || external[index]) return;
    external[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x++) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head++];
    forEachNeighbor4(index, width, height, enqueue);
  }
  return external;
}

function analyzeHoles(foreground, width, height) {
  const external = markExternalBackground(foreground, width, height);
  const visited = new Uint8Array(foreground.length);
  const queue = new Int32Array(foreground.length);
  let holeCount = 0;
  let totalHolePixels = 0;
  let largestHolePixels = 0;

  for (let start = 0; start < foreground.length; start++) {
    if (foreground[start] || external[start] || visited[start]) continue;
    holeCount += 1;
    let head = 0;
    let tail = 0;
    let size = 0;
    visited[start] = 1;
    queue[tail++] = start;

    while (head < tail) {
      const index = queue[head++];
      size += 1;
      forEachNeighbor4(index, width, height, (neighbor) => {
        if (foreground[neighbor] || external[neighbor] || visited[neighbor]) return;
        visited[neighbor] = 1;
        queue[tail++] = neighbor;
      });
    }
    totalHolePixels += size;
    if (size > largestHolePixels) largestHolePixels = size;
  }

  return { holeCount, totalHolePixels, largestHolePixels };
}

function isDeepBackground(alpha, index, width, height) {
  if (alpha[index] > 8) return false;
  const x = index % width;
  const y = Math.floor(index / width);
  for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) {
    for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) {
      if (alpha[yy * width + xx] > 8) return false;
    }
  }
  return true;
}

function computeBackgroundStats(originalData, alpha, width, height) {
  let count = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumL = 0;
  let sumL2 = 0;
  const quadrantSum = [0, 0, 0, 0];
  const quadrantCount = [0, 0, 0, 0];

  for (let index = 0; index < alpha.length; index++) {
    if (!isDeepBackground(alpha, index, width, height)) continue;
    const offset = index * 4;
    const r = originalData[offset];
    const g = originalData[offset + 1];
    const b = originalData[offset + 2];
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    const x = index % width;
    const y = Math.floor(index / width);
    const quadrant = (y >= height / 2 ? 2 : 0) + (x >= width / 2 ? 1 : 0);

    count += 1;
    sumR += r;
    sumG += g;
    sumB += b;
    sumL += luminance;
    sumL2 += luminance * luminance;
    quadrantSum[quadrant] += luminance;
    quadrantCount[quadrant] += 1;
  }

  if (count === 0) {
    return {
      count: 0,
      lumaStd: null,
      colorStd: null,
      quadrantRange: null,
    };
  }

  const meanR = sumR / count;
  const meanG = sumG / count;
  const meanB = sumB / count;
  const meanL = sumL / count;
  let colorVariance = 0;

  for (let index = 0; index < alpha.length; index++) {
    if (!isDeepBackground(alpha, index, width, height)) continue;
    const offset = index * 4;
    colorVariance += (
      (originalData[offset] - meanR) ** 2
      + (originalData[offset + 1] - meanG) ** 2
      + (originalData[offset + 2] - meanB) ** 2
    );
  }

  const quadrantMeans = quadrantSum
    .map((sum, index) => (quadrantCount[index] > 0 ? sum / quadrantCount[index] : null))
    .filter(Number.isFinite);

  return {
    count,
    lumaStd: Math.sqrt(Math.max(0, sumL2 / count - meanL * meanL)),
    colorStd: Math.sqrt(Math.max(0, colorVariance / count)),
    quadrantRange: quadrantMeans.length >= 2
      ? Math.max(...quadrantMeans) - Math.min(...quadrantMeans)
      : null,
  };
}

function computeFaceMissingRatio(alpha, width, height, faceBox) {
  if (!faceBox) return { ratio: null, samplePixels: 0 };
  const x = finite(faceBox.x);
  const y = finite(faceBox.y);
  const boxWidth = finite(faceBox.width ?? faceBox.w);
  const boxHeight = finite(faceBox.height ?? faceBox.h);
  if (
    x === null || y === null || boxWidth === null || boxHeight === null
    || boxWidth <= 0 || boxHeight <= 0
  ) {
    return { ratio: null, samplePixels: 0 };
  }

  const left = clamp(Math.floor(x + boxWidth * 0.2), 0, width - 1);
  const right = clamp(Math.ceil(x + boxWidth * 0.8), left + 1, width);
  const top = clamp(Math.floor(y + boxHeight * 0.18), 0, height - 1);
  const bottom = clamp(Math.ceil(y + boxHeight * 0.82), top + 1, height);
  let samplePixels = 0;
  let missingPixels = 0;

  for (let yy = top; yy < bottom; yy++) {
    for (let xx = left; xx < right; xx++) {
      samplePixels += 1;
      if (alpha[yy * width + xx] < 64) missingPixels += 1;
    }
  }

  return {
    ratio: samplePixels > 0 ? missingPixels / samplePixels : null,
    samplePixels,
  };
}

export function buildBackgroundQualityMetrics({
  originalImageData,
  maskImageData,
  faceBox = null,
}) {
  validateImageDataLike(originalImageData, 'originalImageData');
  validateImageDataLike(maskImageData, 'maskImageData');
  if (
    originalImageData.width !== maskImageData.width
    || originalImageData.height !== maskImageData.height
  ) {
    throw new RangeError('Ảnh gốc và mask phải có cùng kích thước mẫu.');
  }

  const width = originalImageData.width;
  const height = originalImageData.height;
  const pixelCount = width * height;
  const alpha = new Uint8Array(pixelCount);
  const foreground = new Uint8Array(pixelCount);
  let foregroundPixels = 0;
  let semiTransparentPixels = 0;
  let boundaryPixels = 0;
  let perimeter = 0;
  let topTouch = 0;
  let leftTouch = 0;
  let rightTouch = 0;

  for (let index = 0; index < pixelCount; index++) {
    const value = maskImageData.data[index * 4 + 3];
    alpha[index] = value;
    if (value > 16 && value < 239) semiTransparentPixels += 1;
    if (value >= 128) {
      foreground[index] = 1;
      foregroundPixels += 1;
    }
  }

  for (let index = 0; index < pixelCount; index++) {
    if (!foreground[index]) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    let isBoundary = false;

    if (x === 0) {
      perimeter += 1;
      isBoundary = true;
      leftTouch += 1;
    } else if (!foreground[index - 1]) {
      perimeter += 1;
      isBoundary = true;
    }
    if (x === width - 1) {
      perimeter += 1;
      isBoundary = true;
      rightTouch += 1;
    } else if (!foreground[index + 1]) {
      perimeter += 1;
      isBoundary = true;
    }
    if (y === 0) {
      perimeter += 1;
      isBoundary = true;
      topTouch += 1;
    } else if (!foreground[index - width]) {
      perimeter += 1;
      isBoundary = true;
    }
    if (y === height - 1 || !foreground[index + width]) {
      perimeter += 1;
      isBoundary = true;
    }
    if (isBoundary) boundaryPixels += 1;
  }

  const components = analyzeForegroundComponents(foreground, width, height);
  const holes = analyzeHoles(foreground, width, height);
  const background = computeBackgroundStats(
    originalImageData.data,
    alpha,
    width,
    height,
  );
  const face = computeFaceMissingRatio(alpha, width, height, faceBox);
  const idealPerimeter = foregroundPixels > 0
    ? 2 * Math.sqrt(Math.PI * foregroundPixels)
    : null;

  return {
    sampleWidth: width,
    sampleHeight: height,
    foregroundRatio: foregroundPixels / pixelCount,
    foregroundComponentCount: components.componentCount,
    detachedForegroundRatio: foregroundPixels > 0
      ? Math.max(0, foregroundPixels - components.largest) / foregroundPixels
      : null,
    holeCount: holes.holeCount,
    holeAreaRatio: foregroundPixels > 0
      ? holes.totalHolePixels / foregroundPixels
      : null,
    largestHoleRatio: foregroundPixels > 0
      ? holes.largestHolePixels / foregroundPixels
      : null,
    semiTransparentRatio: semiTransparentPixels / pixelCount,
    semiTransparentPerBoundary: boundaryPixels > 0
      ? semiTransparentPixels / boundaryPixels
      : null,
    edgeRoughness: idealPerimeter
      ? perimeter / idealPerimeter
      : null,
    topTouchRatio: topTouch / width,
    sideTouchRatio: (leftTouch + rightTouch) / (2 * height),
    backgroundSampleRatio: background.count / pixelCount,
    backgroundLumaStd: background.lumaStd,
    backgroundColorStd: background.colorStd,
    backgroundQuadrantRange: background.quadrantRange,
    faceMissingRatio: face.ratio,
    faceSamplePixels: face.samplePixels,
  };
}

function createCheck(id, label, status, message, approximate = true) {
  return { id, label, status, message, approximate };
}

export function evaluateBackgroundQuality({
  metrics = null,
  hasAiMask = Boolean(metrics),
  aiError = '',
  thresholds = DEFAULT_THRESHOLDS,
} = {}) {
  if (!hasAiMask || !metrics) {
    const detail = aiError
      ? `AI tách nền chưa sẵn sàng: ${aiError}`
      : 'Chưa có alpha mask AI để phân tích.';
    return {
      automatedStatus: 'unavailable',
      checks: [
        createCheck('mask-availability', 'Alpha mask AI', 'unavailable', detail, false),
        createCheck('source-background', 'Nền gốc quanh chủ thể', 'unavailable', 'Cần alpha mask để tách vùng nền khỏi chủ thể.'),
        createCheck('face-integrity', 'Tính toàn vẹn vùng mặt', 'unavailable', 'Chưa có mask để kiểm tra vùng bị xóa nhầm.'),
        createCheck('mask-holes', 'Lỗ thủng trong mask', 'unavailable', 'Chưa có mask để kiểm tra.'),
        createCheck('mask-fragments', 'Mảnh mask rời', 'unavailable', 'Chưa có mask để kiểm tra.'),
        createCheck('mask-edge', 'Chất lượng viền mask', 'unavailable', 'Chưa có mask để kiểm tra.'),
        createCheck('frame-contact', 'Chủ thể chạm biên', 'unavailable', 'Chưa có mask để kiểm tra.'),
      ],
      disclaimer: 'Checker chỉ phân tích alpha mask AI và ảnh gốc trên thiết bị; chế độ Flood Fill cần kiểm tra thủ công.',
    };
  }

  const checks = [];
  const coverageWarning = (
    metrics.foregroundRatio < thresholds.foregroundMin
    || metrics.foregroundRatio > thresholds.foregroundMax
  );
  checks.push(createCheck(
    'mask-coverage',
    'Phạm vi chủ thể',
    coverageWarning ? 'warning' : 'pass',
    coverageWarning
      ? `Mask đang chiếm ${(metrics.foregroundRatio * 100).toFixed(1)}% ảnh mẫu; hãy kiểm tra AI có bỏ sót hoặc giữ nhầm nền.`
      : `Mask chiếm ${(metrics.foregroundRatio * 100).toFixed(1)}% ảnh mẫu, chưa thấy tỷ lệ bất thường rõ.`,
  ));

  const backgroundUnavailable = (
    metrics.backgroundSampleRatio < thresholds.backgroundSampleMin
    || !Number.isFinite(metrics.backgroundLumaStd)
    || !Number.isFinite(metrics.backgroundColorStd)
  );
  const backgroundWarning = !backgroundUnavailable && (
    metrics.backgroundLumaStd > thresholds.backgroundLumaStdMax
    || metrics.backgroundColorStd > thresholds.backgroundColorStdMax
    || (
      Number.isFinite(metrics.backgroundQuadrantRange)
      && metrics.backgroundQuadrantRange > thresholds.backgroundQuadrantRangeMax
    )
  );
  checks.push(createCheck(
    'source-background',
    'Nền gốc quanh chủ thể',
    backgroundUnavailable ? 'unavailable' : backgroundWarning ? 'warning' : 'pass',
    backgroundUnavailable
      ? 'Vùng nền tách biệt quá ít để đo độ đồng đều.'
      : backgroundWarning
        ? 'Nền gốc có độ sáng hoặc màu thay đổi mạnh; bóng và vật thể phía sau có thể làm viền tách nền kém ổn định.'
        : 'Vùng nền gốc ngoài mask tương đối đồng đều trong mẫu phân tích.',
  ));

  const faceUnavailable = !Number.isFinite(metrics.faceMissingRatio) || metrics.faceSamplePixels < 16;
  const faceWarning = !faceUnavailable && metrics.faceMissingRatio > thresholds.faceMissingRatioMax;
  checks.push(createCheck(
    'face-integrity',
    'Tính toàn vẹn vùng mặt',
    faceUnavailable ? 'unavailable' : faceWarning ? 'warning' : 'pass',
    faceUnavailable
      ? 'Chưa có đúng một face box để kiểm tra vùng mặt trong mask.'
      : faceWarning
        ? `${(metrics.faceMissingRatio * 100).toFixed(1)}% vùng trung tâm khuôn mặt có alpha rất thấp; có thể có phần bị xóa nhầm.`
        : 'Vùng trung tâm khuôn mặt chưa thấy lỗ alpha đáng kể.',
  ));

  const holesWarning = (
    metrics.holeAreaRatio > thresholds.holeAreaRatioMax
    && metrics.largestHoleRatio > thresholds.largestHoleRatioMax
  );
  checks.push(createCheck(
    'mask-holes',
    'Lỗ thủng trong mask',
    holesWarning ? 'warning' : 'pass',
    holesWarning
      ? `Phát hiện ${metrics.holeCount} vùng trong suốt khép kín; vùng lớn nhất chiếm ${(metrics.largestHoleRatio * 100).toFixed(2)}% chủ thể.`
      : 'Chưa thấy lỗ trong suốt khép kín có diện tích đáng kể.',
  ));

  const fragmentsWarning = (
    metrics.foregroundComponentCount > 1
    && metrics.detachedForegroundRatio > thresholds.detachedForegroundRatioMax
  );
  checks.push(createCheck(
    'mask-fragments',
    'Mảnh mask rời',
    fragmentsWarning ? 'warning' : 'pass',
    fragmentsWarning
      ? `${(metrics.detachedForegroundRatio * 100).toFixed(2)}% vùng foreground nằm ngoài thành phần chính; có thể còn mảnh nền hoặc chi tiết rời.`
      : 'Các pixel foreground chủ yếu thuộc một vùng liên tục.',
  ));

  const wideFringe = (
    metrics.semiTransparentPerBoundary > thresholds.wideFringePerBoundaryMax
    || metrics.semiTransparentRatio > thresholds.semiTransparentRatioMax
  );
  const hardJaggedEdge = (
    metrics.edgeRoughness > thresholds.edgeRoughnessMax
    && metrics.semiTransparentPerBoundary < thresholds.hardEdgeSoftnessMax
  );
  checks.push(createCheck(
    'mask-edge',
    'Chất lượng viền mask',
    wideFringe || hardJaggedEdge ? 'warning' : 'pass',
    wideFringe
      ? 'Viền có vùng bán trong suốt rộng; khi đổi nền có thể xuất hiện halo hoặc viền mờ.'
      : hardJaggedEdge
        ? 'Biên mask gồ ghề và ít chuyển tiếp alpha; có thể thấy răng cưa ở tóc hoặc vai.'
        : 'Độ rộng chuyển tiếp alpha và độ gồ ghề của viền chưa có cảnh báo rõ.',
  ));

  const contactWarning = (
    metrics.topTouchRatio > thresholds.topTouchRatioMax
    || metrics.sideTouchRatio > thresholds.sideTouchRatioMax
  );
  checks.push(createCheck(
    'frame-contact',
    'Chủ thể chạm biên ảnh gốc',
    contactWarning ? 'warning' : 'pass',
    contactWarning
      ? 'Mask chạm mép trên hoặc hai cạnh bên ở mức đáng kể; tóc, tai hoặc vai có thể đã bị cắt từ ảnh gốc.'
      : 'Mask chưa chạm mép trên hoặc cạnh bên ở mức đáng kể.',
  ));

  const warningCount = checks.filter((check) => check.status === 'warning').length;
  return {
    automatedStatus: warningCount > 0 ? 'warning' : 'no-warning',
    checks,
    disclaimer: 'Các ngưỡng viền, lỗ và độ đồng đều là ước lượng kỹ thuật; hãy phóng to ảnh để kiểm tra tóc, tai và vai trước khi tải.',
  };
}

function scaleFaceBox(faceData, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  if (!faceData?.box || (faceData.faceCount ?? 1) !== 1) return null;
  const box = faceData.box;
  return {
    x: box.x * targetWidth / sourceWidth,
    y: box.y * targetHeight / sourceHeight,
    width: (box.width ?? box.w) * targetWidth / sourceWidth,
    height: (box.height ?? box.h) * targetHeight / sourceHeight,
  };
}

export function analyzeBackgroundQuality(
  originalCanvas,
  maskImage,
  faceData = null,
  { maxSampleSize = 256 } = {},
) {
  if (
    !originalCanvas
    || !Number.isFinite(originalCanvas.width)
    || !Number.isFinite(originalCanvas.height)
    || originalCanvas.width <= 0
    || originalCanvas.height <= 0
  ) {
    throw new TypeError('originalCanvas không hợp lệ.');
  }
  if (!maskImage) return null;
  if (!Number.isFinite(maxSampleSize) || maxSampleSize < 32) {
    throw new RangeError('maxSampleSize phải là số hữu hạn và không nhỏ hơn 32.');
  }

  const scale = Math.min(1, maxSampleSize / Math.max(originalCanvas.width, originalCanvas.height));
  const width = Math.max(1, Math.round(originalCanvas.width * scale));
  const height = Math.max(1, Math.round(originalCanvas.height * scale));
  const doc = originalCanvas.ownerDocument ?? globalThis.document;
  if (!doc) throw new Error('Không có document để tạo canvas phân tích.');

  const sourceCanvas = doc.createElement('canvas');
  const maskCanvas = doc.createElement('canvas');
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  maskCanvas.width = width;
  maskCanvas.height = height;
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceContext || !maskContext) {
    throw new Error('Không lấy được CanvasRenderingContext2D để phân tích mask.');
  }

  sourceContext.drawImage(originalCanvas, 0, 0, width, height);
  maskContext.clearRect(0, 0, width, height);
  maskContext.drawImage(maskImage, 0, 0, width, height);

  return buildBackgroundQualityMetrics({
    originalImageData: sourceContext.getImageData(0, 0, width, height),
    maskImageData: maskContext.getImageData(0, 0, width, height),
    faceBox: scaleFaceBox(
      faceData,
      originalCanvas.width,
      originalCanvas.height,
      width,
      height,
    ),
  });
}

export { DEFAULT_THRESHOLDS as BACKGROUND_QUALITY_THRESHOLDS };
