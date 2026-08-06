import { refreshExportReadiness } from './compliance-pipeline.js';
import { confirmExportReadiness } from './export-readiness-view.js';
import {
  downloadRecoveryImage,
  retryExportBundle,
} from './export-recovery.js';
import { startExportReceiptView } from './export-receipt-view.js';
import { manualReviewStore } from './manual-review.js';
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

  // export-receipt-auto.js được import trước khi main.js đăng ký DOMContentLoaded.
  // Trì hoãn việc bind nút preset sang microtask để listener của ui.js chạy trước,
  // cập nhật state.curFmt rồi print-sheet mới tính lại sức chứa.
  scheduleAfterDomListeners(() => {
    startPrintSheetView({
      documentRef,
      onExport: async (options, layout) => {
        const readiness = refreshExportReadiness(documentRef);
        const confirmed = await confirmExportReadiness(readiness, documentRef);
        const auditEnabled = manualReviewStore.isAuditEnabled(state.origFile);
        logEvent('asset.print_sheet_readiness', {
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
          return;
        }

        try {
          const result = await downloadPrintSheet(options, downloadOptions);
          setSteps(4);
          toast(
            auditEnabled
              ? '✅ Đã tải tờ in. Audit JSON chỉ áp dụng khi tải ảnh đơn.'
              : '✅ Đã tải tờ in nhiều ảnh.',
            'ok',
          );
          logEvent('asset.print_sheet_download', {
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
            auditPreferenceIgnored: auditEnabled,
          });
        } catch (error) {
          toast('Chưa tạo được tờ in. Vui lòng giảm số bản hoặc thử lại.', 'err');
          logEvent('asset.print_sheet_failed', {
            format: state.curFmt,
            paperKey: options.paperKey,
            error: serializeErrorForTelemetry(error, { fallbackMessage: 'Print sheet export failed' }),
          }, 'error');
        }
      },
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
