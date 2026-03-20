import { state } from './state.js';

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

async function configureOnnxRuntime() {
  // Không phụ thuộc crossOriginIsolated: chỉ cần ép numThreads=1
  // là tránh cảnh báo ORT tự set 8 threads trong môi trường non-isolated.
  const ortSources = [
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.min.js',
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/esm/ort.min.js',
  ];

  for (const url of ortSources) {
    try {
      const ort = await import(url);
      if (ort?.env?.wasm) {
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.proxy = false;
      }

      // Một số bundle chỉ đọc từ globalThis.ort nên đồng bộ cả 2 nơi.
      if (ort?.env) globalThis.ort = ort;
      if (globalThis.ort?.env?.wasm) {
        globalThis.ort.env.wasm.numThreads = 1;
        globalThis.ort.env.wasm.proxy = false;
      }
      return true;
    } catch {
      // thử nguồn ORT kế tiếp
    }
  }
  return false;
}

export async function warmupAi() {
  // Luôn thử warmup AI, kể cả khi không có COOP/COEP.
  // Trong môi trường không crossOriginIsolated, ORT có thể chạy chậm hơn
  // nhưng vẫn hoạt động và tốt hơn fallback Flood Fill.
  await configureOnnxRuntime();

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

      if (!faceApi) {
        return false;
      }
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
      .detectSingleFace(canvas, new faceApi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.28 }))
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
      const blob = await removeBackgroundFn(file, {
        publicPath: attempt.publicPath,
        model: attempt.model,
        device: 'cpu',
        debug: false,
        proxyToWorker: false,
        output: { format: 'image/png', quality: 1 },
        progress: (_key, current, total) => {
          if (typeof progress === 'function') progress(current, total);
        },
      });

      const image = await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          resolve(img);
        };
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
