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

export function isAllowedRemoteUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_ORIGINS.has(parsed.origin);
  } catch {
    return false;
  }
}

export function assertAllowedRemoteUrl(url, context = 'remote_resource') {
  if (!isAllowedRemoteUrl(url)) {
    logEvent('security.remote_url_blocked', { url, context }, 'error');
    throw new Error(`Blocked non-allowlisted remote URL: ${url}`);
  }
}

export function getAllowedOrigins() {
  return [...ALLOWED_ORIGINS];
}
