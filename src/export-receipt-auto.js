import { startExportReceiptView } from './export-receipt-view.js';

function start() {
  startExportReceiptView({
    documentRef: globalThis.document,
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
