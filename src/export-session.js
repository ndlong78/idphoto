import {
  clearStagedExportForBundle,
  hasStagedExportForBundle,
} from './export-delivery-session.js';
import {
  clearExportRecovery,
  hasExportRecovery,
} from './export-recovery.js';
import {
  clearExportReceipt,
  exportReceiptStore,
} from './export-receipt.js';

/**
 * Xóa toàn bộ dữ liệu tạm của một phiên xuất ảnh.
 *
 * Dữ liệu này chỉ nằm trong RAM nhưng phải được dọn đồng bộ khi người dùng
 * chọn ảnh nguồn mới hoặc quay lại màn hình upload, tránh hiển thị receipt
 * hay recovery action của ảnh trước.
 */
export function clearExportSession() {
  clearStagedExportForBundle();
  clearExportRecovery();
  clearExportReceipt();
}

export function getExportSessionSnapshot() {
  return Object.freeze({
    hasStagedBundle: hasStagedExportForBundle(),
    hasRecovery: hasExportRecovery(),
    hasReceipt: Boolean(exportReceiptStore.get()),
  });
}
