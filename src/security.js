import { logEvent } from './telemetry.js';

// FIX: thêm https://esm.sh vào allowlist.
//
// Lý do: @imgly/background-removal@1.5.5 trên jsdelivr (dist/index.mjs)
// có dynamic import nội bộ hard-code đến esm.sh — dù ta không gọi esm.sh
// trực tiếp, trình duyệt vẫn cần quyền CSP để tải dependency đó.
//
// Ngoài ra, esm.sh?bundle được dùng làm nguồn ưu tiên trong ai.js vì
// nó tạo ra bundle tự chứa hoàn toàn (không có bare import phụ thuộc bên ngoài),
// giúp tránh chuỗi load lồng nhau.
const ALLOWED_ORIGINS = new Set([
  'https://cdn.jsdelivr.net',
  'https://staticimgly.com',
  'https://esm.sh',
]);

/**
 * Kiểm tra URL có nằm trong allowlist HTTPS không.
 *
 * @param {string} url - URL cần kiểm tra
 * @returns {boolean} true nếu URL hợp lệ và được phép
 */
export function isAllowedRemoteUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_ORIGINS.has(parsed.origin);
  } catch {
    return false;
  }
}

/**
 * Kiểm tra URL và throw nếu không nằm trong allowlist.
 * Ghi log telemetry khi bị chặn.
 *
 * @param {string} url - URL cần kiểm tra
 * @param {string} [context='remote_resource'] - Ngữ cảnh để log
 * @throws {Error} Nếu URL không được phép
 */
export function assertAllowedRemoteUrl(url, context = 'remote_resource') {
  if (!isAllowedRemoteUrl(url)) {
    logEvent('security.remote_url_blocked', { url, context }, 'error');
    throw new Error(`Blocked non-allowlisted remote URL: ${url}`);
  }
}

/**
 * Trả về danh sách các origin được phép tải tài nguyên.
 *
 * @returns {string[]} Mảng các origin HTTPS được phép
 */
export function getAllowedOrigins() {
  return [...ALLOWED_ORIGINS];
}
