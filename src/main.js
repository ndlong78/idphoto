import { detectFace, loadFaceModels, runBackgroundRemoval, warmupAi } from './ai.js';
import { nextStep, STEPS } from './pipeline.js';
import { renderToPreview } from './render.js';
import { state, validateImageFile } from './state.js';
import { logEvent, setTelemetryContext } from './telemetry.js';
import {
  copyToClipboard,
  download,
  initUI,
  mountEditor,
  setAiInfoBar,
  setFaceStatus,
  setLoad,
  setLoadStep,
  setProgress,
  setSection,
  setSteps,
  toast,
} from './ui.js';

let pipelineStep = STEPS.IDLE;
let isProcessing = false;

/**
 * Chặn treo vô hạn cho các promise phụ thuộc mạng/CDN.
 * Nếu quá thời gian, trả về fallbackValue để pipeline vẫn tiếp tục.
 */
async function withTimeoutFallback(promise, timeoutMs, fallbackValue) {
  let timerId = 0;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timerId = window.setTimeout(() => resolve(fallbackValue), timeoutMs);
      }),
    ]);
  } finally {
    if (timerId) window.clearTimeout(timerId);
  }
}

/**
 * Đọc file ảnh từ thiết bị thành HTMLImageElement.
 */
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = () => {
        const isHeic = /\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type);
        reject(new Error(
          isHeic
            ? 'Trình duyệt này không hỗ trợ HEIC/HEIF. Vui lòng chuyển ảnh sang JPG hoặc PNG trước khi upload (dùng app Ảnh trên iOS hoặc công cụ chuyển đổi online).'
            : 'Không đọc được ảnh từ thiết bị. Hãy thử đổi ảnh sang JPG hoặc PNG.',
        ));
      };
      img.src = String(e.target?.result ?? '');
    };
    reader.onerror = () => reject(new Error('Không thể đọc file ảnh.'));
    reader.readAsDataURL(file);
  });
}

async function processFile(file) {
  const pipelineStartedAt = performance.now();
  setSection('loading');
  setProgress(5);
  setLoadStep(1, 'active');
  setLoad('Đang tải thư viện...', '');

  pipelineStep = nextStep(pipelineStep);

  const [aiReadyRaw, faceReadyRaw] = await Promise.all([
    withTimeoutFallback(warmupAi(), 25_000, false),
    withTimeoutFallback(loadFaceModels(), 15_000, false),
  ]);
  const aiReady = Boolean(aiReadyRaw);
  const faceReady = Boolean(faceReadyRaw);
  setLoadStep(1, 'done');
  setProgress(20);

  const oc = document.getElementById('orig-canvas');
  oc.width  = state.origImg.width;
  oc.height = state.origImg.height;
  oc.getContext('2d')?.drawImage(state.origImg, 0, 0);

  setLoadStep(2, 'active');
  setLoad('Nhận dạng khuôn mặt...', '');
  pipelineStep = nextStep(pipelineStep);
  try {
    state.faceData = faceReady ? await detectFace(oc) : null;
  } catch {
    state.faceData = null;
  }
  setLoadStep(2, 'done');
  setProgress(35);

  setLoadStep(3, 'active');
  setLoad('AI đang tách nền...', 'Lần đầu có thể mất 20–40 giây để tải model');
  pipelineStep = nextStep(pipelineStep);
  try {
    state.aiMaskImg = aiReady
      ? await runBackgroundRemoval(file, (current, total) => {
          if (total > 0) setProgress(35 + Math.round((current / total) * 50));
        })
      : null;
  } catch {
    state.aiMaskImg = null;
  }
  setLoadStep(3, 'done');

  setLoadStep(4, 'active');
  setLoad('Hoàn thiện...', '');
  pipelineStep = nextStep(pipelineStep);
  mountEditor();
  await renderToPreview();
  setLoadStep(4, 'done');
  setProgress(100);
  setSteps(3);

  setFaceStatus(state.faceData?.score ?? null);
  setAiInfoBar(Boolean(state.aiMaskImg), state.aiError);

  logEvent('pipeline.completed', {
    fileName: file.name,
    fileSize: file.size,
    format: state.curFmt,
    aiReady,
    faceReady,
    hasFace: Boolean(state.faceData),
    hasAiMask: Boolean(state.aiMaskImg),
    aiError: state.aiError || null,
    durationMs: Math.round(performance.now() - pipelineStartedAt),
  });

  if (!faceReady && !aiReady) {
    toast('✅ Đã vào trình chỉnh sửa (thiếu AI do mạng/trình duyệt)', 'ok');
  } else {
    toast(state.aiMaskImg ? '✅ AI tách nền thành công!' : '✅ Xử lý xong (flood fill)', 'ok');
  }
}

async function reprocessAI() {
  if (!state.origFile) {
    toast('Chưa có ảnh', 'err');
    return;
  }

  const startedAt = performance.now();
  if (!state.aiReady) {
    setLoad('Đang tải AI...', 'Đang thử lại mô-đun tách nền');
    const aiReady = await warmupAi();
    if (!aiReady) {
      toast('⚠️ Chưa tải được AI. Vui lòng kiểm tra mạng và thử lại.', 'err');
      setAiInfoBar(false, state.aiError);
      return;
    }
  }

  state.aiMaskImg = await runBackgroundRemoval(state.origFile);
  if (!state.aiMaskImg) {
    toast('⚠️ AI chưa xử lý được ảnh này. Đang giữ chế độ Flood Fill.', 'err');
  }
  setAiInfoBar(Boolean(state.aiMaskImg), state.aiError);
  await renderToPreview();

  logEvent('pipeline.reprocess_ai', {
    fileName: state.origFile?.name ?? null,
    success: Boolean(state.aiMaskImg),
    aiError: state.aiError || null,
    durationMs: Math.round(performance.now() - startedAt),
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setTelemetryContext({
    page: 'main',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  const openFilePicker = () => {
    const input = document.getElementById('file-input');
    if (!(input instanceof HTMLInputElement)) return;
    input.click();
  };

  initUI({
    onPickFile:    openFilePicker,
    onReprocessAI: reprocessAI,
    onDownload: async (mode) => {
      await download(mode);
      setSteps(4);
      toast('✅ Đã tải ảnh thành công', 'ok');
      logEvent('asset.download', { mode, format: state.curFmt });
    },
    onCopy: async () => {
      const result = await copyToClipboard();
      if (result.method === 'clipboard') {
        toast('📋 Đã sao chép!', 'ok');
      } else {
        toast('🖼️ Trình duyệt không hỗ trợ sao chép — đã mở ảnh trong tab mới.', 'ok');
      }
      logEvent('asset.copy', { method: result.method });
    },
    onFileDrop:  (file) => void handleFile(file),
    onFileInput: (file) => void handleFile(file),
  });
});

async function handleFile(file) {
  if (isProcessing) {
    toast('Đang xử lý ảnh trước đó, vui lòng đợi...', 'err');
    return;
  }

  const validation = validateImageFile(file);
  if (!validation.ok) {
    toast(validation.error, 'err');
    logEvent('upload.validation_failed', {
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      error: validation.error,
    }, 'error');
    return;
  }

  try {
    isProcessing   = true;
    pipelineStep   = STEPS.IDLE;
    state.origFile = file;
    state.origImg  = await loadImageFromFile(file);
    await processFile(file);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Upload thất bại. Vui lòng thử lại.';
    toast(msg, 'err');
    setSection('upload');
    logEvent('pipeline.failed', {
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      error: msg,
    }, 'error');
  } finally {
    isProcessing = false;
  }
}
