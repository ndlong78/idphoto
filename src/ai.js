import { state } from './state.js';
import {
  AI_TIMEOUT_MS,
  FACE_DETECT_INPUT_SIZE,
  FACE_DETECT_THRESHOLD,
} from './constants.js';
import { assertAllowedRemoteUrl } from './security.js';
import { logEvent, serializeErrorForTelemetry } from './telemetry.js';

let removeBackgroundFn = null;
let faceApi = null;
let faceApiScriptPromise = null;
let faceModelLoadPromise = null;
let faceModelsReady = false;

// FIX [IMPORTANT]: Track các URL đã được inject vào DOM.
//
// Bug cũ: khi script inject thành công nhưng faceapi = null (file hỏng),
// faceApiScriptPromise bị reset → null. Lần sau:
//   1. isScriptAlreadyLoaded(url) → true
//   2. faceapi vẫn null → continue
//   3. Tất cả URL đều continue → return null → reset promise → vòng lặp vô hạn
//
// Fix: _triedScriptUrls lưu URL đã inject. Dù promise có bị reset,
// các URL đã thử sẽ bị skip ngay — không re-inject, không vòng lặp.
const _triedScriptUrls = new Set();
const BG_REMOVAL_VERSION = '1.5.5';

const FACE_MODEL_FALLBACK = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights';
const FACE_API_SCRIPT_SOURCES = [
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/dist/face-api.min.js',
];

const BG_REMOVAL_MODULE_SOURCES = [
  `https://esm.sh/@imgly/background-removal@${BG_REMOVAL_VERSION}?bundle`,
  `https://cdn.jsdelivr.net/npm/@imgly/background-removal@${BG_REMOVAL_VERSION}/dist/index.mjs`,
];

const BG_REMOVAL_DATA_SOURCES = [
  { publicPath: `https://staticimgly.com/@imgly/background-removal-data/${BG_REMOVAL_VERSION}/dist/`, model: 'isnet_fp16' },
];

/**
 * Validate version pinning cho tất cả CDN source liên quan background removal.
 * Fail-fast ở load time để tránh drift runtime giữa module URL và model data URL.
 */
export function validateAiSourceVersions() {
  for (const url of BG_REMOVAL_MODULE_SOURCES) {
    if (!url.includes(`@${BG_REMOVAL_VERSION}`)) {
      throw new Error(`BG_REMOVAL_MODULE_SOURCES phải pin @${BG_REMOVAL_VERSION}: ${url}`);
    }
    if (!/^https:\/\/(esm\.sh|cdn\.jsdelivr\.net)\//.test(url)) {
      throw new Error(`BG_REMOVAL_MODULE_SOURCES chỉ cho phép esm.sh hoặc cdn.jsdelivr.net: ${url}`);
    }
  }

  for (const source of BG_REMOVAL_DATA_SOURCES) {
    if (!source.publicPath.includes(`/${BG_REMOVAL_VERSION}/`)) {
      throw new Error(`BG_REMOVAL_DATA_SOURCES phải pin /${BG_REMOVAL_VERSION}/: ${source.publicPath}`);
    }
    if (!source.publicPath.startsWith('https://staticimgly.com/')) {
      throw new Error(`BG_REMOVAL_DATA_SOURCES chỉ cho phép staticimgly.com: ${source.publicPath}`);
    }
  }

  for (const url of FACE_API_SCRIPT_SOURCES) {
    if (!url.startsWith('https://cdn.jsdelivr.net/')) {
      throw new Error(`FACE_API_SCRIPT_SOURCES chỉ cho phép cdn.jsdelivr.net: ${url}`);
    }
    if (!url.includes('@0.22.2/')) {
      throw new Error(`FACE_API_SCRIPT_SOURCES phải pin @0.22.2: ${url}`);
    }
  }
}

validateAiSourceVersions();

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

function isScriptAlreadyLoaded(url) {
  return [...document.querySelectorAll('script')].some((s) => s.src === url);
}

function safeScriptElement(url) {
  assertAllowedRemoteUrl(url, 'face_api_script');
  const script = document.createElement('script');
  script.async         = true;
  script.crossOrigin   = 'anonymous';
  script.referrerPolicy = 'no-referrer';
  script.src           = url;
  return script;
}

function normalizeWarmupErrorMessage(rawMessage = '') {
  const msg = String(rawMessage || '').toLowerCase();
  if (
    msg.includes('failed to resolve module specifier')
    || msg.includes('relative references must start')
    || msg.includes('ndarray')
  ) {
    return 'CDN AI trả về module không tương thích trình duyệt (ESM bare import).';
  }
  if (msg.includes('wasm') || msg.includes('webassembly')) {
    return 'WebAssembly bị chặn bởi CSP — kiểm tra lại header server.';
  }
  return String(rawMessage || 'Không tải được module AI từ CDN');
}

/**
 * Khi trang chưa chạy ở crossOriginIsolated, onnxruntime-web không thể dùng
 * multi-thread wasm. Hạ numThreads về 1 để tránh cảnh báo noisy trên console.
 */
function enforceSingleThreadWasmIfNeeded(mod) {
  if (globalThis.crossOriginIsolated) return;
  try {
    const envCandidates = [
      mod?.env,
      mod?.default?.env,
      globalThis.ort?.env,
    ];
    for (const env of envCandidates) {
      if (env?.wasm && Number.isFinite(env.wasm.numThreads) && env.wasm.numThreads > 1) {
        env.wasm.numThreads = 1;
      }
    }
  } catch {
    // no-op: chỉ là tối ưu tránh warning, không làm fail luồng AI
  }
}

function loadScriptSequentially(urls) {
  if (faceApiScriptPromise) return faceApiScriptPromise;

  faceApiScriptPromise = (async () => {
    for (const url of urls) {
      // FIX [IMPORTANT]: Kiểm tra cả DOM lẫn _triedScriptUrls.
      // isScriptAlreadyLoaded đủ cho lần đầu, nhưng sau khi promise reset
      // về null, _triedScriptUrls ngăn không cho inject lại URL đã thử.
      if (isScriptAlreadyLoaded(url) || _triedScriptUrls.has(url)) {
        if (globalThis.faceapi) return globalThis.faceapi;
        // Script đã inject nhưng faceapi vẫn null — URL này không dùng được
        logEvent('ai.face_script_already_loaded_but_null', { url }, 'warn');
        continue;
      }

      // Đánh dấu URL trước khi inject, kể cả nếu sau đó bị lỗi.
      // Tránh re-inject trong mọi trường hợp (onerror, faceapi=null, etc.)
      _triedScriptUrls.add(url);

      try {
        const startedAt = performance.now();
        await new Promise((resolve, reject) => {
          const script = safeScriptElement(url);
          script.onload  = () => resolve();
          script.onerror = () => reject(new Error(`Không tải được script: ${url}`));
          document.head.appendChild(script);
        });

        logEvent('ai.face_script_loaded', {
          url,
          durationMs: Math.round(performance.now() - startedAt),
        });

        if (globalThis.faceapi) return globalThis.faceapi;

        // Script load OK nhưng faceapi vẫn null → file hỏng, thử URL tiếp theo
        logEvent('ai.face_script_loaded_but_null', { url }, 'warn');
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
    (result) => {
      // Chỉ reset promise nếu không có URL nào được inject.
      // Nếu đã inject (dù faceapi=null), _triedScriptUrls đã ngăn re-inject
      // → reset promise cũng an toàn, nhưng không cần thiết.
      // Reset để caller có thể gọi lại sau khi user reload network.
      if (!result) faceApiScriptPromise = null;
      return result;
    },
    (err) => { faceApiScriptPromise = null; return Promise.reject(err); },
  );
}

/**
 * Tải và khởi tạo module AI tách nền.
 * Idempotent: nếu đã tải thành công thì trả về true ngay.
 *
 * @returns {Promise<boolean>} true nếu AI sẵn sàng, false nếu tải thất bại
 */
export async function warmupAi() {
  if (removeBackgroundFn) {
    state.aiReady = true;
    state.aiError = '';
    return true;
  }

  let lastError    = '';
  let lastRawError = '';
  for (const url of BG_REMOVAL_MODULE_SOURCES) {
    try {
      assertAllowedRemoteUrl(url, 'bg_module');
      const startedAt = performance.now();
      const mod = await import(url);
      enforceSingleThreadWasmIfNeeded(mod);
      removeBackgroundFn = mod.removeBackground || mod.default?.removeBackground || mod.default;
      if (typeof removeBackgroundFn === 'function') {
        state.aiReady = true;
        state.aiError = '';
        logEvent('ai.warmup_success', {
          source:     url,
          durationMs: Math.round(performance.now() - startedAt),
        });
        return true;
      }
      lastError    = `Module AI không export hàm removeBackground (${url})`;
      lastRawError = lastError;
    } catch (err) {
      const rawError = err instanceof Error ? err.message : `Không thể import AI từ ${url}`;
      lastRawError   = rawError;
      lastError      = normalizeWarmupErrorMessage(rawError);
      logEvent('ai.warmup_failed_attempt', {
        source: url,
        error:  lastError,
        rawError,
      }, 'warn');
    }
  }

  state.aiReady = false;
  state.aiError = lastError || 'Không tải được module AI từ CDN';
  logEvent('ai.warmup_failed', {
    error:       state.aiError,
    rawError:    lastRawError || null,
    degradedMode: true,
  }, 'warn');
  return false;
}

/**
 * Tải mô hình nhận diện khuôn mặt (TinyFaceDetector + landmarks).
 * Idempotent và chống race condition.
 *
 * Concurrency contract:
 *   - Nếu có promise đang pending → trả về promise đó (không tạo mới)
 *   - Nếu đã thành công (faceModelsReady = true) → trả về true ngay
 *   - Nếu thất bại → reset faceModelLoadPromise = null để cho phép retry
 *     (hữu ích khi mạng khôi phục sau lần đầu thất bại)
 *
 * @returns {Promise<boolean>} true nếu tải thành công
 */
export async function loadFaceModels() {
  if (faceModelsReady) return true;

  // FIX [IMPORTANT]: Trả về promise đang pending thay vì tạo promise mới.
  // Nếu nhiều caller gọi loadFaceModels() đồng thời (ví dụ processFile chạy
  // warmupAi và loadFaceModels song song qua Promise.all), tất cả đều nhận
  // về cùng một promise — tránh tải model nhiều lần.
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
        source:     FACE_MODEL_FALLBACK,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return true;
    } catch (err) {
      faceModelsReady = false;
      logEvent('ai.face_models_failed', {
        source: FACE_MODEL_FALLBACK,
        error:  err instanceof Error ? err.message : String(err),
      }, 'error');
      return false;
    }
  })();

  try {
    return await faceModelLoadPromise;
  } finally {
    // Reset chỉ khi thất bại để cho phép retry sau khi mạng khôi phục.
    // Khi thành công (faceModelsReady = true), guard ở đầu hàm sẽ
    // short-circuit ngay — không cần giữ lại promise.
    if (!faceModelsReady) faceModelLoadPromise = null;
  }
}

/**
 * Nhận diện khuôn mặt đầu tiên trong canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<{box: object, score: number}|null>}
 */
export async function detectFace(canvas) {
  const ready = faceModelsReady ? true : await loadFaceModels();
  if (!ready || !faceApi) return null;
  try {
    const det = await faceApi
      .detectSingleFace(
        canvas,
        new faceApi.TinyFaceDetectorOptions({
          inputSize:      FACE_DETECT_INPUT_SIZE,
          scoreThreshold: FACE_DETECT_THRESHOLD,
        }),
      )
      .withFaceLandmarks(true);

    if (!det) return null;
    return { box: det.detection.box, score: det.detection.score };
  } catch (err) {
    logEvent('ai.face_detect_failed', {
      error: serializeErrorForTelemetry(err, { fallbackMessage: 'Face detection failed' }),
    }, 'warn');
    return null;
  }
}

/**
 * Chạy AI tách nền cho file ảnh.
 *
 * @param {File} file
 * @param {function(number, number): void} [progress]
 * @returns {Promise<HTMLImageElement|null>}
 */
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
        const cleanup = () => URL.revokeObjectURL(url);
        img.onload  = () => { cleanup(); resolve(img); };
        img.onerror = (err) => { cleanup(); reject(err); };
        img.src     = url;
      });
      state.aiError = '';
      logEvent('ai.bg_remove_success', {
        source:     attempt.publicPath,
        model:      attempt.model,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return image;
    } catch (err) {
      lastError = err instanceof Error ? err.message : `AI fail at ${attempt.publicPath}`;
      logEvent('ai.bg_remove_failed_attempt', {
        source: attempt.publicPath,
        model:  attempt.model,
        error:  lastError,
      }, 'warn');
    }
  }

  state.aiError = lastError || 'AI không thể tải model/background data';
  logEvent('ai.bg_remove_failed', { error: state.aiError, degradedMode: true }, 'warn');
  return null;
}
