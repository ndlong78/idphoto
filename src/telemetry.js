const MAX_EVENTS = 200;
const STORAGE_KEY = 'idphoto.telemetry.events';
const LOG_LEVEL_RANK = {
  silent: 0,
  error:  1,
  warn:   2,
  info:   3,
};

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

export function logEvent(type, payload = {}, level = 'info') {
  const id = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // Event lưu localStorage: dùng localContext (không fingerprint)
  const localEvent = {
    id,
    type,
    level,
    ts:      nowIso(),
    context: buildLocalContext(),
    payload,
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

export function getTelemetryEvents() {
  return loadBuffer();
}

export function clearTelemetryEvents() {
  saveBuffer([]);
}
