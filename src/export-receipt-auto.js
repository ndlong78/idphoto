import {
  downloadRecoveryImage,
  retryExportBundle,
} from './export-recovery.js';
import { startExportReceiptView } from './export-receipt-view.js';

function hasMountableDocument(doc) {
  return Boolean(
    doc
    && typeof doc.createElement === 'function'
    && typeof doc.getElementById === 'function'
    && typeof doc.querySelector === 'function'
  );
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
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
