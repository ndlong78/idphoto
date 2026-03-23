import { logEvent } from './telemetry.js';

const ALLOWED_ORIGINS = new Set([
  'https://cdn.jsdelivr.net',
  'https://esm.sh',
  'https://staticimgly.com',
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
