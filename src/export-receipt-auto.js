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
    copies: layout.copies,
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
    const result = await download(options, downloadOptions);
    setSteps(4);
    const deliveryLabel = delivery === 'pdf' ? 'PDF đúng khổ' : 'tờ in JPEG';
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
        ? 'Chưa tạo được PDF. Vui lòng thử lại hoặc tải JPEG.'
        : 'Chưa tạo được tờ in. Vui lòng giảm số bản hoặc thử lại.',
      'err',
    );
    logEvent('asset.print_sheet_failed', {
      delivery,
      format: state.curFmt,
      paperKey: options.paperKey,
      error: serializeErrorForTelemetry(error, {
        fallbackMessage: delivery === 'pdf'
          ? 'Print sheet PDF export failed'
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
      onExportPdf: (options, layout) => runPrintSheetDelivery({
        delivery: 'pdf',
        options,
        layout,
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
