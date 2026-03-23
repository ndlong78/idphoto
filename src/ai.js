import { state } from './state.js';
import {
  AI_TIMEOUT_MS,
  FACE_DETECT_INPUT_SIZE,
  FACE_DETECT_THRESHOLD,
} from './constants.js';

let removeBackgroundFn = null;
let faceApi = null;
let faceApiScriptPromise = null;
let faceModelLoadPromise = null;
let faceModelsReady = false;

const FACE_MODEL_FALLBACK = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights';
const FACE_API_SCRIPT_SOURCES = [
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/dist/face-api.min.js',
  'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js',
  'https://unpkg.com/face-api.js@0.22.2/dist/face-api.min.js',
];

// LƯU Ý: @imgly/background-removal bundle ONNX Runtime riêng trong package của nó.
// Bundle này là một ES module độc lập với env object hoàn toàn tách biệt —
// không thể can thiệp từ bên ngoài qua globalThis.ort.
//
// Cảnh báo "env.wasm.numThreads is set to N, but this will not work unless
// crossOriginIsolated" xuất hiện vì SharedArrayBuffer không khả dụng trong môi
// trường không có COOP/COEP header. ORT tự động fallback về single-thread WASM.
// Đây là warning thông tin, KHÔNG ảnh hưởng chức năng — ảnh vẫn được xử lý đúng.

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

function loadScriptSequentially(urls) {
  if (faceApiScriptPromise) return faceApiScriptPromise;

  faceApiScriptPromise = (async () => {
    for (const url of urls) {
      try {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.async = true;
          script.crossOrigin = 'anonymous';
          script.src = url;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error(`Không tải được script: ${url}`));
          document.head.appendChild(script);
        });

        if (globalThis.faceapi) return globalThis.faceapi;
      } catch {
        // thử nguồn script tiếp theo
      }
    }
    return null;
  })();

  return faceApiScriptPromise;
}

/**
 * Khởi tạo module background removal.
 * Idempotent: nếu đã load thành công trước đó, trả về true ngay lập tức
 * mà không tải lại CDN. Điều này quan trọng khi người dùng bấm "🔄 AI"
 * để retry — không cần lặp lại toàn bộ vòng CDN fallback.
 */
export async function warmupAi() {
  // Guard idempotent: đã có removeBackgroundFn từ lần load trước
  if (removeBackgroundFn) {
    state.aiReady = true;
    state.aiError = '';
    return true;
  }

  const urls = [
    'https://esm.sh/@imgly/background-removal@1.5.5',
    'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/dist/index.mjs',
    'https://unpkg.com/@imgly/background-removal@1.5.5/dist/index.mjs',
  ];

  let lastError = '';
  for (const url of urls) {
    try {
      const mod = await import(url);
      removeBackgroundFn = mod.removeBackground || mod.default?.removeBackground || mod.default;
      if (typeof removeBackgroundFn === 'function') {
        state.aiReady = true;
        state.aiError = '';
        return true;
      }
      lastError = `Module AI không export hàm removeBackground (${url})`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : `Không thể import AI từ ${url}`;
    }
  }

  state.aiReady = false;
  state.aiError = lastError || 'Không tải được module AI từ CDN';
  return false;
}

export async function loadFaceModels() {
  if (faceModelsReady) return true;
  if (faceModelLoadPromise) return faceModelLoadPromise;

  faceModelLoadPromise = (async () => {
    if (!faceApi) {
      // Chỉ dùng UMD để tránh nạp trùng backend TFJS từ ESM/CDN khác nhau.
      faceApi = await loadScriptSequentially(FACE_API_SCRIPT_SOURCES);
      if (!faceApi) return false;
    }

    try {
      await Promise.all([
        faceApi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_FALLBACK),
        faceApi.nets.faceLandmark68TinyNet.loadFromUri(FACE_MODEL_FALLBACK),
      ]);
      faceModelsReady = true;
      return true;
    } catch {
      faceModelsReady = false;
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

  const attempts = [
    { publicPath: 'https://staticimgly.com/@imgly/background-removal-data/1.5.5/dist/', model: 'isnet_fp16' },
    { publicPath: 'https://cdn.jsdelivr.net/npm/@imgly/background-removal-data@1.5.5/dist/', model: 'isnet_fp16' },
    { publicPath: 'https://unpkg.com/@imgly/background-removal-data@1.5.5/dist/', model: 'isnet_fp16' },
    { publicPath: 'https://staticimgly.com/@imgly/background-removal-data/1.5.5/dist/', model: 'isnet' },
  ];

  let lastError = '';
  for (const attempt of attempts) {
    try {
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
      return image;
    } catch (err) {
      lastError = err instanceof Error ? err.message : `AI fail at ${attempt.publicPath}`;
    }
  }

  state.aiError = lastError || 'AI không thể tải model/background data';
  return null;
}
