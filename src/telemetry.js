const MAX_EVENTS = 200;
const STORAGE_KEY = 'idphoto.telemetry.events';
const LOG_LEVEL_RANK = {
  silent: 0,
  error:  1,
  warn:   2,
  info:   3,
};
const SAFE_TELEMETRY_PROTOCOLS = new Set(['https:']);
const SAFE_TELEMETRY_LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
]);
const SENSITIVE_PAYLOAD_KEYS = new Set([
  'fileName',
  'mimeType',
]);

function nowIso() {
  return new Date().toISOString();
}

function canUseLocalStorage() {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function loadBuffer() {
  if (!canUseLocalStorage()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveBuffer(events) {
  if (!canUseLocalStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch {
    // Quota full hoặc privacy mode: bỏ qua, không làm hỏng luồng chính.
  }
}

const baseContext = {
  app:     'idphoto-mvp',
  version: '0.2.0',
};

let runtimeContext = {
  userAgent:           typeof navigator !== 'undefined' ? navigator.userAgent   : 'unknown',
  platform:            typeof navigator !== 'undefined' ? navigator.platform    : 'unknown',
  language:            typeof navigator !== 'undefined' ? navigator.language    : 'unknown',
  deviceMemory:        typeof navigator !== 'undefined' ? navigator.deviceMemory        ?? null : null,
  hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? null : null,
};

/**
 * Cập nhật context bổ sung cho các event telemetry (ví dụ: page, timezone).
 *
 * @param {Record<string, unknown>} [context={}] - Các trường context cần bổ sung
 */
export function setTelemetryContext(context = {}) {
  runtimeContext = { ...runtimeContext, ...context };
}

// FIX [WARNING]: runtimeContext chứa các trường fingerprinting
// (userAgent, platform, deviceMemory, hardwareConcurrency) — được ghi vào
// localStorage cho MỌI event. Sau khi user xóa ảnh, fingerprint vẫn tồn tại.
//
// Giải pháp: tách context thành hai phần:
//   - localContext: chỉ lưu type/level/payload (không có fingerprint)
//   - fullContext:  gửi lên endpoint (nếu có) kèm fingerprint đầy đủ
//
// Khi không có endpoint được cấu hình, fingerprint không cần lưu local.

/** Trả về phần context an toàn để lưu localStorage (không fingerprint). */
function buildLocalContext() {
  return {
    ...baseContext,
    // Chỉ giữ page và timezone từ runtimeContext — không có UA, platform, memory
    ...(runtimeContext.page     ? { page:     runtimeContext.page }     : {}),
    ...(runtimeContext.timezone ? { timezone: runtimeContext.timezone } : {}),
  };
}

/** Trả về full context để gửi lên endpoint (nếu có). */
function buildFullContext() {
  return { ...baseContext, ...runtimeContext };
}

function sendToEndpoint(event) {
  const endpoint = globalThis?.__IDPHOTO_CONFIG__?.telemetryEndpoint;
  if (!endpoint || typeof endpoint !== 'string') return;
  if (!isAllowedTelemetryEndpoint(endpoint)) return;

  try {
    const body = JSON.stringify(event);
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(endpoint, blob);
      return;
    }

    if (typeof fetch === 'function') {
      void fetch(endpoint, {
        method:    'POST',
        headers:   { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      });
    }
  } catch {
    // Best-effort telemetry: không throw.
  }
}

function isAllowedTelemetryEndpoint(endpoint) {
  try {
    const parsed = new URL(endpoint);
    if (SAFE_TELEMETRY_PROTOCOLS.has(parsed.protocol)) return true;
    if (parsed.protocol !== 'http:') return false;
    return SAFE_TELEMETRY_LOCAL_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function resolveConsoleLevel() {
  const configured = globalThis?.__IDPHOTO_CONFIG__?.telemetryConsoleLevel;
  if (typeof configured !== 'string') return 'error';
  const normalized = configured.toLowerCase();
  return Object.hasOwn(LOG_LEVEL_RANK, normalized) ? normalized : 'error';
}

function shouldLogToConsole(level) {
  const wanted     = resolveConsoleLevel();
  const eventRank  = LOG_LEVEL_RANK[level]  ?? LOG_LEVEL_RANK.info;
  const wantedRank = LOG_LEVEL_RANK[wanted] ?? LOG_LEVEL_RANK.error;
  return eventRank <= wantedRank;
}

function truncateText(value, max = 500) {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function shouldAllowSensitiveTelemetry() {
  return globalThis?.__IDPHOTO_CONFIG__?.allowSensitiveTelemetry === true;
}

function sanitizeTelemetryPayload(payload) {
  if (shouldAllowSensitiveTelemetry()) return payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;

  const sanitized = { ...payload };
  for (const key of SENSITIVE_PAYLOAD_KEYS) {
    if (Object.hasOwn(sanitized, key)) {
      sanitized[key] = '[redacted]';
    }
  }
  return sanitized;
}

/**
 * Serialize error an toàn để đưa vào telemetry, tránh log raw object nhạy cảm.
 * Chỉ lấy một số trường chuẩn (name/message/stack/code/status/cause).
 *
 * @param {unknown} err
 * @param {{ fallbackMessage?: string }} [options]
 * @returns {{name: string, message: string, stack?: string, code?: string, status?: number, cause?: object, type?: string}}
 */
export function serializeErrorForTelemetry(err, options = {}) {
  const fallbackMessage = options.fallbackMessage || 'Unexpected error';

  if (err instanceof Error) {
    const base = {
      name:    truncateText(err.name || 'Error', 120),
      message: truncateText(err.message || fallbackMessage),
    };

    if (typeof err.stack === 'string' && err.stack.length > 0) {
      base.stack = truncateText(err.stack, 1200);
    }

    const maybeCode = /** @type {unknown} */ (err.code);
    if (typeof maybeCode === 'string' || typeof maybeCode === 'number') {
      base.code = truncateText(maybeCode, 80);
    }

    const maybeStatus = /** @type {unknown} */ (err.status);
    if (typeof maybeStatus === 'number') {
      base.status = maybeStatus;
    }

    const cause = /** @type {unknown} */ (err.cause);
    if (cause instanceof Error) {
      base.cause = {
        name:    truncateText(cause.name || 'Error', 120),
        message: truncateText(cause.message || fallbackMessage),
      };
    }

    return base;
  }

  return {
    name:    'NonError',
    type:    typeof err,
    message: truncateText(err == null ? fallbackMessage : String(err)),
  };
}

/**
 * Ghi một event telemetry vào localStorage và tùy chọn gửi lên endpoint.
 * Context lưu localStorage không chứa fingerprinting; endpoint nhận full context.
 *
 * @param {string} type - Tên event (ví dụ: 'pipeline.completed')
 * @param {Record<string, unknown>} [payload={}] - Dữ liệu kèm theo
 * @param {'info'|'warn'|'error'} [level='info'] - Mức độ nghiêm trọng
 * @returns {object} Event đã ghi
 */
export function logEvent(type, payload = {}, level = 'info') {
  const id = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const sanitizedPayload = sanitizeTelemetryPayload(payload);

  // Event lưu localStorage: dùng localContext (không fingerprint)
  const localEvent = {
    id,
    type,
    level,
    ts:      nowIso(),
    context: buildLocalContext(),
    payload: sanitizedPayload,
  };

  const events = loadBuffer();
  events.push(localEvent);
  saveBuffer(events);

  if (shouldLogToConsole(level)) {
    if (level === 'error')      console.error('[telemetry]', localEvent);
    else if (level === 'warn')  console.warn('[telemetry]',  localEvent);
    else                        console.info('[telemetry]',  localEvent);
  }

  // Gửi endpoint: dùng fullContext (kèm fingerprint) — chỉ khi có endpoint
  const hasEndpoint = typeof globalThis?.__IDPHOTO_CONFIG__?.telemetryEndpoint === 'string';
  if (hasEndpoint) {
    const fullEvent = { ...localEvent, context: buildFullContext() };
    sendToEndpoint(fullEvent);
  }

  return localEvent;
}

/**
 * Lấy toàn bộ event telemetry từ localStorage.
 *
 * @returns {object[]} Mảng các event đã ghi
 */
export function getTelemetryEvents() {
  return loadBuffer();
}

/**
 * Xóa toàn bộ event telemetry khỏi localStorage.
 */
export function clearTelemetryEvents() {
  saveBuffer([]);
}
