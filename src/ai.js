import { state } from './state.js';

let removeBackgroundFn = null;
let faceApi = null;

const FACE_MODEL_FALLBACK = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights';

async function configureOnnxRuntime() {
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
      return;
    } catch {
      // thử nguồn ORT kế tiếp
    }
  }
}

export async function warmupAi() {
  await configureOnnxRuntime();

  const urls = [
    'https://esm.sh/@imgly/background-removal@1.5.5',
    'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/dist/index.mjs',
  ];

  for (const url of urls) {
    try {
      const mod = await import(url);
      removeBackgroundFn = mod.removeBackground || mod.default?.removeBackground || mod.default;
      if (typeof removeBackgroundFn === 'function') {
        state.aiReady = true;
        return true;
      }
    } catch {
      // thử URL tiếp theo
    }
  }
  state.aiReady = false;
  return false;
}

export async function loadFaceModels() {
  if (!faceApi) {
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.esm.js');
      faceApi = mod;
    } catch {
      faceApi = null;
      return false;
    }
  }

  try {
    await Promise.all([
      faceApi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_FALLBACK),
      faceApi.nets.faceLandmark68TinyNet.loadFromUri(FACE_MODEL_FALLBACK),
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function detectFace(canvas) {
  if (!faceApi) return null;
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
  try {
    const blob = await removeBackgroundFn(file, {
      publicPath: 'https://staticimgly.com/@imgly/background-removal-data/1.5.5/dist/',
      model: 'isnet_fp16',
      device: 'cpu',
      debug: false,
      proxyToWorker: false,
      output: { format: 'image/png', quality: 1 },
      progress: (_key, current, total) => {
        if (typeof progress === 'function') progress(current, total);
      },
    });

    return await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = reject;
      img.src = url;
    });
  } catch {
    return null;
  }
}
