import { downloadBlobFile } from './download.js';
import { createExportBundle } from './export-bundle.js';
import { consumeStagedExportForBundle } from './export-delivery-session.js';
import { recordExportReceipt } from './export-receipt.js';

function asIsoTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) throw new RangeError('generatedAt không hợp lệ.');
  return date.toISOString();
}

function sanitizeCheck(item) {
  return {
    section: item.sectionLabel ?? item.sectionKey ?? 'Tiêu chí',
    id: item.id ?? 'unknown',
    label: item.label ?? 'Tiêu chí',
    message: item.message ?? '',
    status: item.status ?? 'unknown',
    approximate: Boolean(item.approximate),
  };
}

function sanitizeManualItem(item) {
  return {
    section: item.sectionLabel ?? item.sectionKey ?? 'Checklist thủ công',
    id: item.id ?? 'unknown',
    label: item.label ?? 'Tiêu chí',
    message: item.message ?? '',
    reviewed: Boolean(item.reviewed),
  };
}

export function buildExportAudit({
  readiness,
  exportResult,
  format,
  mode,
  sourceFile = null,
  generatedAt = new Date(),
  userConfirmed = false,
} = {}) {
  if (!readiness || typeof readiness !== 'object') {
    throw new TypeError('readiness là bắt buộc.');
  }
  if (!exportResult || typeof exportResult.filename !== 'string') {
    throw new TypeError('exportResult hợp lệ là bắt buộc.');
  }

  const manualItems = Array.isArray(readiness.manualItems)
    ? readiness.manualItems.map(sanitizeManualItem)
    : [];
  const reviewedCount = manualItems.filter((item) => item.reviewed).length;

  return {
    schemaVersion: 1,
    kind: 'idphoto-export-audit',
    generatedAt: asIsoTimestamp(generatedAt),
    privacy: {
      containsImageData: false,
      containsFaceGeometry: false,
      containsOriginalFilename: false,
      note: 'Audit chỉ lưu trạng thái kiểm tra và thông tin file xuất; không chứa ảnh hoặc dữ liệu hình học khuôn mặt.',
    },
    source: {
      mimeType: typeof sourceFile?.type === 'string' ? sourceFile.type : null,
      sizeBytes: Number.isFinite(sourceFile?.size) ? sourceFile.size : null,
    },
    export: {
      mode: mode ?? null,
      delivery: 'bundle-zip',
      imageFilename: exportResult.filename,
      mimeType: exportResult.mimeType ?? null,
      widthPx: exportResult.width ?? null,
      heightPx: exportResult.height ?? null,
      dpi: exportResult.targetDpi ?? null,
      sizeBytes: exportResult.blobSize ?? null,
      physicalSizeMm: Number.isFinite(format?.mmW) && Number.isFinite(format?.mmH)
        ? { width: format.mmW, height: format.mmH }
        : null,
    },
    profile: {
      formatKey: readiness.formatKey ?? null,
      profileKey: readiness.profileKey ?? null,
      supportLevel: readiness.supportLevel ?? null,
      sourceUrl: readiness.sourceUrl ?? null,
      scopeNotice: readiness.scopeNotice ?? null,
    },
    readiness: {
      requiresConfirmation: Boolean(readiness.requiresConfirmation),
      userConfirmed: Boolean(userConfirmed),
      tone: readiness.tone ?? null,
      statusLabel: readiness.statusLabel ?? null,
      warningCount: readiness.counts?.warning ?? 0,
      unavailableCount: readiness.counts?.unavailable ?? 0,
      missingSectionCount: readiness.counts?.missingSections ?? 0,
      manualTotal: manualItems.length,
      manualReviewed: reviewedCount,
      manualPending: manualItems.length - reviewedCount,
    },
    automatedWarnings: (readiness.warnings ?? []).map(sanitizeCheck),
    unavailableChecks: (readiness.unavailableItems ?? []).map(sanitizeCheck),
    missingSections: (readiness.missingSections ?? []).map((section) => ({
      key: section.key ?? 'unknown',
      label: section.label ?? 'Nhóm kiểm tra',
    })),
    manualReview: {
      items: manualItems,
      disclaimer: 'Dấu reviewed chỉ ghi nhận người dùng đã tự đối chiếu tiêu chí, không phải chứng nhận đạt yêu cầu.',
    },
    disclaimer: readiness.disclaimer ?? 'Kết quả kiểm tra không thay thế quyết định của cơ quan tiếp nhận.',
  };
}

export function serializeExportAudit(audit) {
  if (!audit || typeof audit !== 'object') throw new TypeError('audit không hợp lệ.');
  return `${JSON.stringify(audit, null, 2)}\n`;
}

export function buildExportAuditFilename(imageFilename) {
  const safeName = typeof imageFilename === 'string' && imageFilename
    ? imageFilename
    : 'photovisa-export';
  const base = safeName.replace(/\.[^.]+$/, '');
  return `${base}.audit.json`;
}

export function downloadExportAudit(
  audit,
  {
    documentRef = globalThis.document,
    urlApi = globalThis.URL,
    windowRef = globalThis.window,
  } = {},
) {
  const content = serializeExportAudit(audit);
  const auditFilename = buildExportAuditFilename(audit?.export?.imageFilename);
  const stagedExport = consumeStagedExportForBundle();
  const downloadOptions = { documentRef, urlApi, windowRef };

  if (stagedExport) {
    try {
      const bundle = createExportBundle({
        imageFilename: stagedExport.filename,
        imageBytes: stagedExport.bytes,
        auditFilename,
        auditContent: content,
      });
      downloadBlobFile(bundle.blob, bundle.filename, downloadOptions);
      recordExportReceipt({
        delivery: 'bundle-zip',
        filename: bundle.filename,
        sizeBytes: bundle.sizeBytes,
        mimeType: 'application/zip',
        mode: audit?.export?.mode,
        formatKey: audit?.profile?.formatKey,
        widthPx: audit?.export?.widthPx,
        heightPx: audit?.export?.heightPx,
        dpi: audit?.export?.dpi,
        entries: bundle.entries,
        note: 'Gói ZIP chứa ảnh xuất và audit JSON.',
      });
      return {
        filename: bundle.filename,
        sizeBytes: bundle.sizeBytes,
        bundled: true,
        entries: bundle.entries,
      };
    } catch (error) {
      const fallbackBlob = new Blob(
        [stagedExport.bytes],
        { type: stagedExport.mimeType ?? 'application/octet-stream' },
      );
      downloadBlobFile(fallbackBlob, stagedExport.filename, downloadOptions);
      recordExportReceipt({
        delivery: 'image-fallback',
        status: 'fallback',
        filename: stagedExport.filename,
        sizeBytes: stagedExport.bytes.length,
        mimeType: stagedExport.mimeType,
        mode: audit?.export?.mode,
        formatKey: audit?.profile?.formatKey,
        widthPx: stagedExport.width,
        heightPx: stagedExport.height,
        dpi: stagedExport.targetDpi,
        note: 'Ảnh đã tải thành công, nhưng gói ZIP và audit JSON chưa được tạo.',
      });
      if (error && typeof error === 'object') {
        error.imageFallbackDownloaded = true;
        error.fallbackFilename = stagedExport.filename;
      }
      throw error;
    }
  }

  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  downloadBlobFile(blob, auditFilename, downloadOptions);
  recordExportReceipt({
    delivery: 'audit-json',
    filename: auditFilename,
    sizeBytes: blob.size,
    mimeType: 'application/json',
    mode: audit?.export?.mode,
    formatKey: audit?.profile?.formatKey,
    note: 'Audit JSON đã được gửi tới trình duyệt để tải xuống.',
  });
  return { filename: auditFilename, sizeBytes: blob.size, bundled: false };
}
