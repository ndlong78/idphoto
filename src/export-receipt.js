const DELIVERY_TYPES = new Set([
  'image',
  'bundle-zip',
  'audit-json',
  'image-fallback',
]);

const RECEIPT_STATUSES = new Set(['success', 'fallback']);

function asIsoTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) throw new RangeError('generatedAt không hợp lệ.');
  return date.toISOString();
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function positiveIntegerOrNull(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function normalizeFilename(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError('filename phải là chuỗi không rỗng.');
  }
  return value.trim();
}

function normalizeEntries(entries) {
  if (!Array.isArray(entries)) return Object.freeze([]);
  return Object.freeze(entries.map((entry) => Object.freeze({
    name: normalizeFilename(entry?.name),
    sizeBytes: finiteOrNull(entry?.sizeBytes),
  })));
}

export function buildExportReceipt({
  delivery,
  status = 'success',
  filename,
  sizeBytes = null,
  mimeType = null,
  generatedAt = new Date(),
  mode = null,
  formatKey = null,
  widthPx = null,
  heightPx = null,
  dpi = null,
  entries = [],
  recoveryAvailable = false,
  note = null,
} = {}) {
  if (!DELIVERY_TYPES.has(delivery)) {
    throw new RangeError(`delivery không được hỗ trợ: ${delivery}`);
  }
  if (!RECEIPT_STATUSES.has(status)) {
    throw new RangeError(`status không được hỗ trợ: ${status}`);
  }

  return Object.freeze({
    schemaVersion: 1,
    kind: 'idphoto-export-receipt',
    delivery,
    status,
    filename: normalizeFilename(filename),
    sizeBytes: finiteOrNull(sizeBytes),
    mimeType: typeof mimeType === 'string' && mimeType ? mimeType : null,
    generatedAt: asIsoTimestamp(generatedAt),
    mode: typeof mode === 'string' && mode ? mode : null,
    formatKey: typeof formatKey === 'string' && formatKey ? formatKey : null,
    widthPx: positiveIntegerOrNull(widthPx),
    heightPx: positiveIntegerOrNull(heightPx),
    dpi: positiveIntegerOrNull(dpi),
    entries: normalizeEntries(entries),
    recoveryAvailable: Boolean(recoveryAvailable),
    note: typeof note === 'string' && note ? note : null,
    privacy: Object.freeze({
      containsImageData: false,
      containsFaceGeometry: false,
      containsOriginalFilename: false,
    }),
  });
}

export function formatByteSize(sizeBytes) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return 'Không rõ dung lượng';
  if (sizeBytes < 1024) return `${Math.round(sizeBytes)} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = sizeBytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

export function createExportReceiptStore() {
  let current = null;
  const listeners = new Set();

  const notify = () => {
    for (const listener of [...listeners]) listener(current);
  };

  return {
    record(input) {
      current = buildExportReceipt(input);
      notify();
      return current;
    },

    clear() {
      current = null;
      notify();
    },

    get() {
      return current;
    },

    subscribe(listener, { emitCurrent = true } = {}) {
      if (typeof listener !== 'function') throw new TypeError('listener phải là function.');
      listeners.add(listener);
      if (emitCurrent) listener(current);
      return () => listeners.delete(listener);
    },
  };
}

export const exportReceiptStore = createExportReceiptStore();
export const recordExportReceipt = (input) => exportReceiptStore.record(input);
export const clearExportReceipt = () => exportReceiptStore.clear();

export const EXPORT_RECEIPT_DELIVERY_TYPES = Object.freeze([...DELIVERY_TYPES]);
