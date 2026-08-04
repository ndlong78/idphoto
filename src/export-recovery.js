import { downloadBlobFile } from './download.js';
import { createExportBundle } from './export-bundle.js';
import { recordExportReceipt } from './export-receipt.js';

let pendingRecovery = null;

function normalizeText(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${fieldName} phải là chuỗi không rỗng.`);
  }
  return value.trim();
}

function positiveIntegerOrNull(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function requirePendingRecovery() {
  if (!pendingRecovery) {
    throw new Error('Không còn dữ liệu xuất để khôi phục.');
  }
  return pendingRecovery;
}

function receiptGeometry(recovery) {
  return {
    mode: recovery.mode,
    formatKey: recovery.formatKey,
    widthPx: recovery.widthPx,
    heightPx: recovery.heightPx,
    dpi: recovery.dpi,
  };
}

export function stageExportRecovery({
  imageFilename,
  imageBytes,
  imageMimeType = 'application/octet-stream',
  auditFilename,
  auditContent,
  mode = null,
  formatKey = null,
  widthPx = null,
  heightPx = null,
  dpi = null,
} = {}) {
  if (!(imageBytes instanceof Uint8Array)) {
    throw new TypeError('imageBytes phải là Uint8Array.');
  }
  if (typeof auditContent !== 'string') {
    throw new TypeError('auditContent phải là JSON string.');
  }

  pendingRecovery = Object.freeze({
    imageFilename: normalizeText(imageFilename, 'imageFilename'),
    imageBytes: new Uint8Array(imageBytes),
    imageMimeType: typeof imageMimeType === 'string' && imageMimeType
      ? imageMimeType
      : 'application/octet-stream',
    auditFilename: normalizeText(auditFilename, 'auditFilename'),
    auditContent,
    mode: typeof mode === 'string' && mode ? mode : null,
    formatKey: typeof formatKey === 'string' && formatKey ? formatKey : null,
    widthPx: positiveIntegerOrNull(widthPx),
    heightPx: positiveIntegerOrNull(heightPx),
    dpi: positiveIntegerOrNull(dpi),
  });
  return getExportRecoverySnapshot();
}

export function clearExportRecovery() {
  pendingRecovery = null;
}

export function hasExportRecovery() {
  return pendingRecovery !== null;
}

export function getExportRecoverySnapshot() {
  if (!pendingRecovery) return null;
  return Object.freeze({
    imageFilename: pendingRecovery.imageFilename,
    imageSizeBytes: pendingRecovery.imageBytes.length,
    imageMimeType: pendingRecovery.imageMimeType,
    auditFilename: pendingRecovery.auditFilename,
    auditSizeBytes: new TextEncoder().encode(pendingRecovery.auditContent).length,
    ...receiptGeometry(pendingRecovery),
    privacy: Object.freeze({
      containsOriginalFilename: false,
      exposesImageBytes: false,
    }),
  });
}

export function recordRetryableExportFallback({ note } = {}) {
  const recovery = requirePendingRecovery();
  return recordExportReceipt({
    delivery: 'image-fallback',
    status: 'fallback',
    filename: recovery.imageFilename,
    sizeBytes: recovery.imageBytes.length,
    mimeType: recovery.imageMimeType,
    recoveryAvailable: true,
    ...receiptGeometry(recovery),
    note: note ?? 'Ảnh đã tải thành công. Bạn có thể thử lại ZIP hoặc tải lại ảnh đơn mà không xử lý lại ảnh.',
  });
}

export function retryExportBundle(downloadOptions = {}) {
  const recovery = requirePendingRecovery();
  try {
    const bundle = createExportBundle({
      imageFilename: recovery.imageFilename,
      imageBytes: recovery.imageBytes,
      auditFilename: recovery.auditFilename,
      auditContent: recovery.auditContent,
    });
    downloadBlobFile(bundle.blob, bundle.filename, downloadOptions);
    clearExportRecovery();
    recordExportReceipt({
      delivery: 'bundle-zip',
      filename: bundle.filename,
      sizeBytes: bundle.sizeBytes,
      mimeType: 'application/zip',
      entries: bundle.entries,
      ...receiptGeometry(recovery),
      note: 'Đã tạo và gửi lại gói ZIP tới trình duyệt mà không xử lý lại ảnh.',
    });
    return {
      filename: bundle.filename,
      sizeBytes: bundle.sizeBytes,
      entries: bundle.entries,
      recovered: true,
    };
  } catch (error) {
    recordRetryableExportFallback({
      note: 'Chưa thể gửi lại ZIP. Dữ liệu recovery vẫn được giữ để bạn thử lại hoặc tải ảnh đơn.',
    });
    throw error;
  }
}

export function downloadRecoveryImage(downloadOptions = {}) {
  const recovery = requirePendingRecovery();
  const blob = new Blob(
    [recovery.imageBytes],
    { type: recovery.imageMimeType },
  );
  downloadBlobFile(blob, recovery.imageFilename, downloadOptions);
  clearExportRecovery();
  recordExportReceipt({
    delivery: 'image',
    filename: recovery.imageFilename,
    sizeBytes: recovery.imageBytes.length,
    mimeType: recovery.imageMimeType,
    ...receiptGeometry(recovery),
    note: 'Đã tải lại ảnh đơn từ dữ liệu recovery; không chạy lại AI hoặc render.',
  });
  return {
    filename: recovery.imageFilename,
    sizeBytes: recovery.imageBytes.length,
    recovered: true,
  };
}
