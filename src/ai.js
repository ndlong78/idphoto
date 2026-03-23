import { state } from './state.js';
import {
  AI_TIMEOUT_MS,
  FACE_DETECT_INPUT_SIZE,
  FACE_DETECT_THRESHOLD,
} from './constants.js';
import { assertAllowedRemoteUrl } from './security.js';
import { logEvent } from './telemetry.js';

let removeBackgroundFn = null;
let faceApi = null;
let faceApiScriptPromise = null;
let faceModelLoadPromise = null;
let faceModelsReady = false;

// Hardening: chỉ giữ danh sách CDN đã allowlist + pin version cụ thể.
const FACE_MODEL_FALLBACK = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights';
const FACE_API_SCRIPT_SOURCES = [
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/dist/face-api.min.js',
];

const BG_REMOVAL_MODULE_SOURCES = [
  'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/dist/index.mjs',
];

const BG_REMOVAL_DATA_SOURCES = [
  { publicPath: 'https://staticimgly.com/@imgly/background-removal-data/1.5.5/dist/', model: 'isnet_fp16' },
  { publicPath: 'https://cdn.jsdelivr.net/npm/@imgly/background-removal-data@1.5.5/dist/', model: 'isnet_fp16' },
];

/**
 * Bọc bất kỳ Promise nào với race condition thời gian.
 * Nếu CDN / model tải quá chậm, reject với message rõ ràng
 * thay vì spinner vô hạn.
 */
function withTimeout(promise, ms, message) {
  let timerId;
  const timer = new Promise((_, reject) => {
    timerId = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([
    promise.then(
      (v) => { clearTimeout(timerId); return v; },
      (e) => { clearTimeout(timerId); return Promise.reject(e); },
    ),
    timer,
  ]);
}

function safeScriptElement(url) {
  assertAllowedRemoteUrl(url, 'face_api_script');
  const script = document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.referrerPolicy = 'no-referrer';
  script.src = url;
  return script;
}

/**
 * Tải face-api.js script tuần tự qua danh sách CDN fallback.
 */
function loadScriptSequentially(urls) {
  if (faceApiScriptPromise) return faceApiScriptPromise;

  faceApiScriptPromise = (async () => {
    for (const url of urls) {
      try {
        const startedAt = performance.now();
        await new Promise((resolve, reject) => {
          const script = safeScriptElement(url);
          script.onload = () => resolve();
          script.onerror = () => reject(new Error(`Không tải được script: ${url}`));
          document.head.appendChild(script);
        });

        logEvent('ai.face_script_loaded', {
          url,
          durationMs: Math.round(performance.now() - startedAt),
        });

        if (globalThis.faceapi) return globalThis.faceapi;
      } catch (err) {
        logEvent('ai.face_script_failed', {
          url,
          error: err instanceof Error ? err.message : String(err),
        }, 'error');
      }
    }
    return null;
  })();

  return faceApiScriptPromise.then(
    (result) => { if (!result) faceApiScriptPromise = null; return result; },
    (err)    => { faceApiScriptPromise = null; return Promise.reject(err); },
  );
}

/**
 * Khởi tạo module background removal.
 * Idempotent: nếu đã load thành công trước đó, trả về true ngay lập tức
 * mà không tải lại CDN.
 */
export async function warmupAi() {
  if (removeBackgroundFn) {
    state.aiReady = true;
    state.aiError = '';
    return true;
  }

  let lastError = '';
  for (const url of BG_REMOVAL_MODULE_SOURCES) {
    try {
      assertAllowedRemoteUrl(url, 'bg_module');
      const startedAt = performance.now();
      const mod = await import(url);
      removeBackgroundFn = mod.removeBackground || mod.default?.removeBackground || mod.default;
      if (typeof removeBackgroundFn === 'function') {
        state.aiReady = true;
        state.aiError = '';
        logEvent('ai.warmup_success', {
          source: url,
          durationMs: Math.round(performance.now() - startedAt),
        });
        return true;
      }
      lastError = `Module AI không export hàm removeBackground (${url})`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : `Không thể import AI từ ${url}`;
      logEvent('ai.warmup_failed_attempt', { source: url, error: lastError }, 'error');
    }
  }

  state.aiReady = false;
  state.aiError = lastError || 'Không tải được module AI từ CDN';
  logEvent('ai.warmup_failed', { error: state.aiError }, 'error');
  return false;
}

export async function loadFaceModels() {
  if (faceModelsReady) return true;
  if (faceModelLoadPromise) return faceModelLoadPromise;

  faceModelLoadPromise = (async () => {
    if (!faceApi) {
      faceApi = await loadScriptSequentially(FACE_API_SCRIPT_SOURCES);
      if (!faceApi) return false;
    }

    try {
      assertAllowedRemoteUrl(FACE_MODEL_FALLBACK, 'face_model_weights');
      const startedAt = performance.now();
      await Promise.all([
        faceApi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_FALLBACK),
        faceApi.nets.faceLandmark68TinyNet.loadFromUri(FACE_MODEL_FALLBACK),
      ]);
      faceModelsReady = true;
      logEvent('ai.face_models_loaded', {
        source: FACE_MODEL_FALLBACK,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return true;
    } catch (err) {
      faceModelsReady = false;
      logEvent('ai.face_models_failed', {
        source: FACE_MODEL_FALLBACK,
        error: err instanceof Error ? err.message : String(err),
      }, 'error');
      return false;
    }
  })();

  try {
    return await faceModelLoadPromise;
  } finally {
    if (!faceModelsReady) faceModelLoadPromise = null;
  }
}

export async function detectFace(canvas) {
  const ready = faceModelsReady ? true : await loadFaceModels();
  if (!ready || !faceApi) return null;
  try {
    const det = await faceApi
      .detectSingleFace(
        canvas,
        new faceApi.TinyFaceDetectorOptions({
          inputSize:       FACE_DETECT_INPUT_SIZE,
          scoreThreshold:  FACE_DETECT_THRESHOLD,
        }),
      )
      .withFaceLandmarks(true);

    if (!det) return null;
    return { box: det.detection.box, score: det.detection.score };
  } catch {
    return null;
  }
}

export async function runBackgroundRemoval(file, progress) {
  if (!state.aiReady || !removeBackgroundFn) return null;

  let lastError = '';
  for (const attempt of BG_REMOVAL_DATA_SOURCES) {
    try {
      assertAllowedRemoteUrl(attempt.publicPath, 'bg_model_data');
      const startedAt = performance.now();
      const blob = await withTimeout(
        removeBackgroundFn(file, {
          publicPath:    attempt.publicPath,
          model:         attempt.model,
          device:        'cpu',
          debug:         false,
          proxyToWorker: false,
          output:        { format: 'image/png', quality: 1 },
          progress: (_key, current, total) => {
            if (typeof progress === 'function') progress(current, total);
          },
        }),
        AI_TIMEOUT_MS,
        `AI timeout (90s) tại ${attempt.publicPath} — kiểm tra kết nối mạng`,
      );

      const image = await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = reject;
        img.src = url;
      });
      state.aiError = '';
      logEvent('ai.bg_remove_success', {
        source: attempt.publicPath,
        model: attempt.model,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return image;
    } catch (err) {
      lastError = err instanceof Error ? err.message : `AI fail at ${attempt.publicPath}`;
      logEvent('ai.bg_remove_failed_attempt', {
        source: attempt.publicPath,
        model: attempt.model,
        error: lastError,
      }, 'error');
    }
  }

  state.aiError = lastError || 'AI không thể tải model/background data';
  logEvent('ai.bg_remove_failed', { error: state.aiError }, 'error');
  return null;
}
