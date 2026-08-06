import { refreshExportReadiness } from './compliance-pipeline.js';
import { confirmExportReadiness } from './export-readiness-view.js';
import {
  downloadRecoveryImage,
  retryExportBundle,
} from './export-recovery.js';
import { startExportReceiptView } from './export-receipt-view.js';
import { manualReviewStore } from './manual-review.js';
import { downloadPrintSheetPdf } from './print-sheet-pdf.js';
import { startPrintSheetPreviewView } from './print-sheet-preview-view.js';
import { downloadPrintSheet } from './print-sheet.js';
import { startPrintSheetView } from './print-sheet-view.js';
import { state } from './state.js';
import { logEvent, serializeErrorForTelemetry } from './telemetry.js';
import { setSteps, toast } from './ui.js';

function hasMountableDocument(doc) {
  return Boolean(
    doc
    && typeof doc.createElement === 'function'
    && typeof doc.getElementById === 'function'
    && typeof doc.querySelector === 'function'
  );
}

function scheduleAfterDomListeners(callback) {
  if (typeof globalThis.queueMicrotask === 'function') {
    globalThis.queueMicrotask(callback);
    return;
  }
  Promise.resolve().then(callback);
}

async function runPrintSheetDelivery({
  delivery,
  options,
  layout,
  pdfBatch = null,
  documentRef,
  downloadOptions,
}) {
  const readiness = refreshExportReadiness(documentRef);
  const confirmed = await confirmExportReadiness(readiness, documentRef);
  const auditEnabled = manualReviewStore.isAuditEnabled(state.origFile);
  logEvent('asset.print_sheet_readiness', {
    delivery,
    format: state.curFmt,
    paperKey: options.paperKey,
    copiesPerPage: layout.copies,
    totalCopies: delivery === 'pdf' ? pdfBatch?.totalCopies ?? layout.copies : layout.copies,
    pageCount: delivery === 'pdf' ? pdfBatch?.pageCount ?? 1 : 1,
    capacity: layout.capacity,
    confirmed,
    confirmationRequired: readiness.requiresConfirmation,
    warningCount: readiness.counts.warning,
    manualPendingCount: readiness.counts.manualPending,
    auditEnabled,
  });
  if (!confirmed) {
    toast('Đã quay lại chỉnh sửa ảnh.', 'ok');
    return null;
  }

  try {
    const download = delivery === 'pdf' ? downloadPrintSheetPdf : downloadPrintSheet;
    const deliveryOptions = delivery === 'pdf'
      ? { ...options, totalCopies: pdfBatch?.totalCopies ?? layout.copies }
      : options;
    const result = await download(deliveryOptions, downloadOptions);
    setSteps(4);
    const deliveryLabel = delivery === 'pdf'
      ? (result.pageCount > 1 ? `PDF ${result.pageCount} trang` : 'PDF đúng khổ')
      : 'tờ in JPEG';
    toast(
      auditEnabled
        ? `✅ Đã tải ${deliveryLabel}. Audit JSON chỉ áp dụng khi tải ảnh đơn.`
        : `✅ Đã tải ${deliveryLabel}.`,
      'ok',
    );
    logEvent('asset.print_sheet_download', {
      delivery,
      format: state.curFmt,
      paperKey: result.paperKey,
      orientation: result.orientation,
      copies: result.copies,
      copiesPerPage: result.copiesPerPage ?? result.copies,
      totalCopies: result.totalCopies ?? result.copies,
      pageCount: result.pageCount ?? 1,
      lastPageCopies: result.lastPageCopies ?? result.copies,
      uniqueSheetCount: result.uniqueSheetCount ?? 1,
      capacity: result.capacity,
      columns: result.columns,
      rows: result.rowsUsed,
      widthPx: result.width,
      heightPx: result.height,
      dpi: result.targetDpi,
      cropMarks: result.drawCropMarks,
      mimeType: result.mimeType,
      auditPreferenceIgnored: auditEnabled,
    });
    return result;
  } catch (error) {
    toast(
      delivery === 'pdf'
        ? 'Chưa tạo được PDF. Hãy giảm tổng số ảnh hoặc thử lại.'
        : 'Chưa tạo được tờ in. Vui lòng giảm số bản hoặc thử lại.',
      'err',
    );
    logEvent('asset.print_sheet_failed', {
      delivery,
      format: state.curFmt,
      paperKey: options.paperKey,
      totalCopies: delivery === 'pdf' ? pdfBatch?.totalCopies ?? null : null,
      error: serializeErrorForTelemetry(error, {
        fallbackMessage: delivery === 'pdf'
          ? 'Print sheet PDF batch export failed'
          : 'Print sheet export failed',
      }),
    }, 'error');
    return null;
  }
}

function start() {
  const documentRef = globalThis.document;
  if (!hasMountableDocument(documentRef)) return;
  const downloadOptions = {
    documentRef,
    urlApi: globalThis.URL,
    windowRef: globalThis.window,
  };
  startExportReceiptView({
    documentRef,
    onRetryBundle: () => retryExportBundle(downloadOptions),
    onDownloadImage: () => downloadRecoveryImage(downloadOptions),
  });

  scheduleAfterDomListeners(() => {
    startPrintSheetView({
      documentRef,
      onExport: (options, layout) => runPrintSheetDelivery({
        delivery: 'jpeg',
        options,
        layout,
        documentRef,
        downloadOptions,
      }),
      onExportPdf: (options, layout, pdfBatch) => runPrintSheetDelivery({
        delivery: 'pdf',
        options,
        layout,
        pdfBatch,
        documentRef,
        downloadOptions,
      }),
    });
    startPrintSheetPreviewView({
      documentRef,
      windowRef: globalThis.window,
    });
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
