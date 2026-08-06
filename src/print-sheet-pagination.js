export const PRINT_SHEET_PDF_MAX_TOTAL_COPIES = 60;

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new RangeError(`${label} phải là số nguyên dương.`);
  }
  return parsed;
}

export function normalizePrintSheetPdfTotalCopies(value, {
  fallback = 1,
  maximum = PRINT_SHEET_PDF_MAX_TOTAL_COPIES,
} = {}) {
  const max = positiveInteger(maximum, 'Giới hạn tổng số ảnh PDF');
  const fallbackValue = Math.min(positiveInteger(fallback, 'Số ảnh PDF mặc định'), max);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallbackValue;
  return Math.min(Math.max(1, Math.round(parsed)), max);
}

export function paginatePrintSheetCopies({
  totalCopies,
  copiesPerPage,
  maximum = PRINT_SHEET_PDF_MAX_TOTAL_COPIES,
} = {}) {
  const perPage = positiveInteger(copiesPerPage, 'Số ảnh mỗi trang');
  const total = normalizePrintSheetPdfTotalCopies(totalCopies, {
    fallback: perPage,
    maximum,
  });
  const pageCount = Math.ceil(total / perPage);
  const fullPageCount = Math.floor(total / perPage);
  const remainder = total % perPage;
  const lastPageCopies = remainder || perPage;
  const pageCopies = Array.from({ length: pageCount }, (_, index) => (
    index === pageCount - 1 ? lastPageCopies : perPage
  ));
  const uniquePageCopies = [...new Set(pageCopies)];

  return Object.freeze({
    totalCopies: total,
    copiesPerPage: perPage,
    pageCount,
    fullPageCount: remainder === 0 ? pageCount : fullPageCount,
    lastPageCopies,
    pageCopies: Object.freeze(pageCopies),
    uniquePageCopies: Object.freeze(uniquePageCopies),
    hasPartialLastPage: remainder !== 0,
  });
}

export function formatPrintSheetPageDistribution(pageCopies) {
  if (!Array.isArray(pageCopies) || pageCopies.length === 0) {
    throw new TypeError('Phân bổ trang PDF phải là mảng không rỗng.');
  }
  const normalized = pageCopies.map((value) => positiveInteger(value, 'Số ảnh trên trang'));
  if (normalized.length <= 6) return normalized.join(' + ');
  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  const allMiddleMatch = normalized.slice(0, -1).every((value) => value === first);
  if (allMiddleMatch) {
    return last === first
      ? `${first} × ${normalized.length} trang`
      : `${first} × ${normalized.length - 1} trang + ${last}`;
  }
  return `${normalized.slice(0, 3).join(' + ')} + … + ${last}`;
}
