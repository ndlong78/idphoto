const MAX_EVENTS = 200;
const STORAGE_KEY = 'idphoto.telemetry.events';

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
  app: 'idphoto-mvp',
  version: '0.2.0',
};

let runtimeContext = {
  userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
  platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
  language: typeof navigator !== 'undefined' ? navigator.language : 'unknown',
  deviceMemory: typeof navigator !== 'undefined' ? navigator.deviceMemory ?? null : null,
  hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? null : null,
};

export function setTelemetryContext(context = {}) {
  runtimeContext = { ...runtimeContext, ...context };
}

function sendToEndpoint(event) {
  const endpoint = globalThis?.__IDPHOTO_CONFIG__?.telemetryEndpoint;
  if (!endpoint || typeof endpoint !== 'string') return;

  // Chỉ gửi POST, best-effort, không block UI.
  try {
    const body = JSON.stringify(event);
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(endpoint, blob);
      return;
    }

    if (typeof fetch === 'function') {
      void fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      });
    }
  } catch {
    // Best-effort telemetry: không throw.
  }
}

export function logEvent(type, payload = {}, level = 'info') {
  const event = {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    level,
    ts: nowIso(),
    context: { ...baseContext, ...runtimeContext },
    payload,
  };

  const events = loadBuffer();
  events.push(event);
  saveBuffer(events);

  if (level === 'error') {
    console.error('[telemetry]', event);
  } else {
    console.info('[telemetry]', event);
  }

  sendToEndpoint(event);
  return event;
}

export function getTelemetryEvents() {
  return loadBuffer();
}

export function clearTelemetryEvents() {
  saveBuffer([]);
}
