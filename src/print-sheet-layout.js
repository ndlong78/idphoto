const DEFAULT_DPI = 300;

export const PRINT_SHEET_PAPERS = Object.freeze({
  'photo-10x15': Object.freeze({
    key: 'photo-10x15',
    label: '10 × 15 cm',
    widthMm: 100,
    heightMm: 150,
    defaultMarginMm: 5,
    defaultGapMm: 3,
    defaultOrientation: 'portrait',
  }),
  a4: Object.freeze({
    key: 'a4',
    label: 'A4',
    widthMm: 210,
    heightMm: 297,
    defaultMarginMm: 10,
    defaultGapMm: 4,
    defaultOrientation: 'portrait',
  }),
});

function positiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new RangeError(`${label} phải là số dương hữu hạn.`);
  }
  return parsed;
}

function nonNegativeNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new RangeError(`${label} phải là số không âm hữu hạn.`);
  }
  return parsed;
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new RangeError(`${label} phải là số nguyên dương.`);
  }
  return parsed;
}

function resolvePaper(paperKey) {
  const paper = PRINT_SHEET_PAPERS[paperKey];
  if (!paper) throw new RangeError(`Khổ giấy không được hỗ trợ: ${paperKey}`);
  return paper;
}

function createOrientationCandidate(paper, orientation, photoWidthMm, photoHeightMm, marginMm, gapMm) {
  const portrait = orientation === 'portrait';
  const paperWidthMm = portrait ? paper.widthMm : paper.heightMm;
  const paperHeightMm = portrait ? paper.heightMm : paper.widthMm;
  const usableWidthMm = paperWidthMm - (marginMm * 2);
  const usableHeightMm = paperHeightMm - (marginMm * 2);
  const columns = usableWidthMm > 0
    ? Math.max(0, Math.floor((usableWidthMm + gapMm) / (photoWidthMm + gapMm)))
    : 0;
  const rows = usableHeightMm > 0
    ? Math.max(0, Math.floor((usableHeightMm + gapMm) / (photoHeightMm + gapMm)))
    : 0;
  const capacity = columns * rows;
  const usedWidthMm = columns > 0
    ? (columns * photoWidthMm) + ((columns - 1) * gapMm)
    : 0;
  const usedHeightMm = rows > 0
    ? (rows * photoHeightMm) + ((rows - 1) * gapMm)
    : 0;

  return {
    orientation,
    paperWidthMm,
    paperHeightMm,
    columns,
    rows,
    capacity,
    unusedAreaMm2: Math.max(0, (usableWidthMm * usableHeightMm) - (usedWidthMm * usedHeightMm)),
  };
}

function chooseOrientation(paper, photoWidthMm, photoHeightMm, marginMm, gapMm, requestedOrientation) {
  const allowed = new Set(['auto', 'portrait', 'landscape']);
  if (!allowed.has(requestedOrientation)) {
    throw new RangeError(`Hướng giấy không được hỗ trợ: ${requestedOrientation}`);
  }

  const portrait = createOrientationCandidate(
    paper,
    'portrait',
    photoWidthMm,
    photoHeightMm,
    marginMm,
    gapMm,
  );
  const landscape = createOrientationCandidate(
    paper,
    'landscape',
    photoWidthMm,
    photoHeightMm,
    marginMm,
    gapMm,
  );
  if (requestedOrientation === 'portrait') return portrait;
  if (requestedOrientation === 'landscape') return landscape;

  return [portrait, landscape].sort((left, right) => {
    if (right.capacity !== left.capacity) return right.capacity - left.capacity;
    if (left.unusedAreaMm2 !== right.unusedAreaMm2) return left.unusedAreaMm2 - right.unusedAreaMm2;
    return left.orientation === paper.defaultOrientation ? -1 : 1;
  })[0];
}

function resolveCopyCount(requestedCopies, capacity) {
  if (capacity <= 0) return 0;
  if (requestedCopies == null || requestedCopies === 'max') return capacity;
  const copies = positiveInteger(requestedCopies, 'Số bản in');
  if (copies > capacity) {
    throw new RangeError(`Số bản in ${copies} vượt sức chứa ${capacity} của khổ giấy.`);
  }
  return copies;
}

function buildPositions({
  copies,
  columns,
  paperWidthMm,
  paperHeightMm,
  photoWidthMm,
  photoHeightMm,
  gapMm,
}) {
  if (copies === 0) return [];
  const rowsUsed = Math.ceil(copies / columns);
  const totalHeightMm = (rowsUsed * photoHeightMm) + ((rowsUsed - 1) * gapMm);
  const topMm = (paperHeightMm - totalHeightMm) / 2;
  const positions = [];

  for (let row = 0; row < rowsUsed; row += 1) {
    const remaining = copies - positions.length;
    const itemsInRow = Math.min(columns, remaining);
    const rowWidthMm = (itemsInRow * photoWidthMm) + ((itemsInRow - 1) * gapMm);
    const leftMm = (paperWidthMm - rowWidthMm) / 2;

    for (let column = 0; column < itemsInRow; column += 1) {
      positions.push(Object.freeze({
        index: positions.length,
        row,
        column,
        xMm: leftMm + (column * (photoWidthMm + gapMm)),
        yMm: topMm + (row * (photoHeightMm + gapMm)),
        widthMm: photoWidthMm,
        heightMm: photoHeightMm,
      }));
    }
  }
  return positions;
}

export function computePrintSheetLayout({
  paperKey = 'photo-10x15',
  photoWidthMm,
  photoHeightMm,
  copies = 'max',
  marginMm = null,
  gapMm = null,
  orientation = 'auto',
  dpi = DEFAULT_DPI,
} = {}) {
  const paper = resolvePaper(paperKey);
  const normalizedPhotoWidthMm = positiveNumber(photoWidthMm, 'Chiều rộng ảnh');
  const normalizedPhotoHeightMm = positiveNumber(photoHeightMm, 'Chiều cao ảnh');
  const normalizedMarginMm = marginMm == null
    ? paper.defaultMarginMm
    : nonNegativeNumber(marginMm, 'Lề giấy');
  const normalizedGapMm = gapMm == null
    ? paper.defaultGapMm
    : nonNegativeNumber(gapMm, 'Khoảng cách ảnh');
  const normalizedDpi = positiveInteger(dpi, 'DPI');
  const candidate = chooseOrientation(
    paper,
    normalizedPhotoWidthMm,
    normalizedPhotoHeightMm,
    normalizedMarginMm,
    normalizedGapMm,
    orientation,
  );
  const resolvedCopies = resolveCopyCount(copies, candidate.capacity);
  if (candidate.capacity === 0) {
    throw new RangeError(
      `Ảnh ${normalizedPhotoWidthMm} × ${normalizedPhotoHeightMm} mm không vừa khổ ${paper.label}.`,
    );
  }

  const positions = buildPositions({
    copies: resolvedCopies,
    columns: candidate.columns,
    paperWidthMm: candidate.paperWidthMm,
    paperHeightMm: candidate.paperHeightMm,
    photoWidthMm: normalizedPhotoWidthMm,
    photoHeightMm: normalizedPhotoHeightMm,
    gapMm: normalizedGapMm,
  });

  return Object.freeze({
    schemaVersion: 1,
    paperKey,
    paperLabel: paper.label,
    orientation: candidate.orientation,
    paperWidthMm: candidate.paperWidthMm,
    paperHeightMm: candidate.paperHeightMm,
    marginMm: normalizedMarginMm,
    gapMm: normalizedGapMm,
    dpi: normalizedDpi,
    photoWidthMm: normalizedPhotoWidthMm,
    photoHeightMm: normalizedPhotoHeightMm,
    columns: candidate.columns,
    rows: candidate.rows,
    capacity: candidate.capacity,
    copies: resolvedCopies,
    rowsUsed: resolvedCopies === 0 ? 0 : Math.ceil(resolvedCopies / candidate.columns),
    positions: Object.freeze(positions),
  });
}

export function buildPrintSheetFilename({
  paperKey,
  formatKey,
  copies,
  widthPx,
  heightPx,
  dpi = DEFAULT_DPI,
} = {}) {
  const safePaper = String(paperKey ?? '').trim();
  const safeFormat = String(formatKey ?? '').trim();
  if (!safePaper || !safeFormat) throw new TypeError('paperKey và formatKey là bắt buộc.');
  const normalizedCopies = positiveInteger(copies, 'Số bản in');
  const normalizedWidth = positiveInteger(widthPx, 'Chiều rộng pixel');
  const normalizedHeight = positiveInteger(heightPx, 'Chiều cao pixel');
  const normalizedDpi = positiveInteger(dpi, 'DPI');
  return [
    'photovisa',
    'sheet',
    safePaper,
    safeFormat,
    `${normalizedCopies}copies`,
    `${normalizedWidth}x${normalizedHeight}`,
    `${normalizedDpi}dpi.jpeg`,
  ].join('_');
}
