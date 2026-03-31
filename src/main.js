import { detectFace, loadFaceModels, runBackgroundRemoval, warmupAi } from './ai.js';
import { nextStep, STEPS } from './pipeline.js';
import { renderToPreview } from './render.js';
import { state, validateImageFile } from './state.js';
import { logEvent, serializeErrorForTelemetry, setTelemetryContext } from './telemetry.js';
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
let activeRunId = 0;


export function assertBrowserFileInput(file, context = 'main.handleFile') {
  if (!(file instanceof File)) {
    throw new TypeError(`[${context}] File input không hợp lệ (null/undefined/fake object).`);
  }

  const hasShape = typeof file.name === 'string'
    && typeof file.type === 'string'
    && typeof file.size === 'number'
    && Number.isFinite(file.size)
    && file.size >= 0;
  if (!hasShape) {
    throw new TypeError(`[${context}] File object không đúng shape chuẩn của browser.`);
  }

  return file;
}

function getOrigCanvasOrThrow() {
  const oc = document.getElementById('orig-canvas');
  if (!(oc instanceof HTMLCanvasElement)) {
    throw new Error('[main.processFile] State/UI chưa sẵn sàng: thiếu #orig-canvas hợp lệ.');
  }
  return oc;
}

function assertReadyForReprocess() {
  if (!(state.origFile instanceof File)) {
    throw new Error('[main.reprocessAI] State chưa sẵn sàng: chưa có file gốc hợp lệ.');
  }
}

async function withTimeoutFallback(promise, timeoutMs, fallbackValue, isCurrent = () => true) {
  let timerId = 0;
  try {
    const result = await Promise.race([
      promise,
      new Promise((resolve) => {
        timerId = window.setTimeout(() => resolve(fallbackValue), timeoutMs);
      }),
    ]);
    return isCurrent() ? result : fallbackValue;
  } finally {
    if (timerId) window.clearTimeout(timerId);
  }
}

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

async function processFile(file, runId) {
  const isCurrentRun = () => runId === activeRunId;
  const pipelineStartedAt = performance.now();
  setSection('loading');
  setProgress(5);
  setLoadStep(1, 'active');
  setLoad('Đang tải thư viện...', '');

  pipelineStep = nextStep(pipelineStep);

  const [aiReadyRaw, faceReadyRaw] = await Promise.all([
    withTimeoutFallback(warmupAi(), 25_000, false, isCurrentRun),
    withTimeoutFallback(loadFaceModels(), 15_000, false, isCurrentRun),
  ]);
  if (!isCurrentRun()) return;
  const aiReady   = Boolean(aiReadyRaw);
  const faceReady = Boolean(faceReadyRaw);
  setLoadStep(1, 'done');
  setProgress(20);

  const oc = getOrigCanvasOrThrow();
  if (!state.origImg) {
    throw new Error('[main.processFile] State chưa sẵn sàng: thiếu ảnh gốc đã load.');
  }
  oc.width  = state.origImg.width;
  oc.height = state.origImg.height;
  oc.getContext('2d')?.drawImage(state.origImg, 0, 0);

  setLoadStep(2, 'active');
  setLoad('Nhận dạng khuôn mặt...', '');
  pipelineStep = nextStep(pipelineStep);
  try {
    state.faceData = faceReady ? await detectFace(oc) : null;
  } catch (err) {
    state.faceData = null;
    logEvent('pipeline.face_detect_failed', {
      step:  'face_detection',
      error: serializeErrorForTelemetry(err, { fallbackMessage: 'Face detect failed' }),
    }, 'warn');
  }
  if (!isCurrentRun()) return;
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
  } catch (err) {
    state.aiMaskImg = null;
    logEvent('pipeline.bg_remove_failed_unhandled', {
      step:  'background_removal',
      error: serializeErrorForTelemetry(err, { fallbackMessage: 'Background removal failed' }),
    }, 'warn');
  }
  if (!isCurrentRun()) return;
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
    hasFace:   Boolean(state.faceData),
    hasAiMask: Boolean(state.aiMaskImg),
    aiError:   state.aiError || null,
    durationMs: Math.round(performance.now() - pipelineStartedAt),
  });

  if (!faceReady && !aiReady) {
    toast('✅ Đã vào trình chỉnh sửa (thiếu AI do mạng/trình duyệt)', 'ok');
  } else {
    toast(state.aiMaskImg ? '✅ AI tách nền thành công!' : '✅ Xử lý xong (flood fill)', 'ok');
  }
}

async function reprocessAI() {
  // FIX [CRITICAL]: Guard isProcessing — tránh reprocessAI() chạy đồng thời
  // với handleFile() hoặc với chính nó khi user click nhiều lần.
  if (isProcessing) {
    toast('Đang xử lý, vui lòng đợi...', 'err');
    return;
  }

  try {
    assertReadyForReprocess();
  } catch (err) {
    toast('Chưa có ảnh hợp lệ để xử lý lại.', 'err');
    logEvent('pipeline.reprocess_ai_guard_failed', {
      error: serializeErrorForTelemetry(err, { fallbackMessage: 'Reprocess guard failed' }),
    }, 'warn');
    return;
  }

  const startedAt = performance.now();
  const runId = ++activeRunId;
  const isCurrentRun = () => runId === activeRunId;
  isProcessing = true;
  try {
    if (!state.aiReady) {
      setLoad('Đang tải AI...', 'Đang thử lại mô-đun tách nền');
      const aiReady = await warmupAi();
      if (!isCurrentRun()) return;
      if (!aiReady) {
        toast('⚠️ Chưa tải được AI. Vui lòng kiểm tra mạng và thử lại.', 'err');
        setAiInfoBar(false, state.aiError);
        return;
      }
    }

    state.aiMaskImg = await runBackgroundRemoval(state.origFile);
    if (!isCurrentRun()) return;
    if (!state.aiMaskImg) {
      toast('⚠️ AI chưa xử lý được ảnh này. Đang giữ chế độ Flood Fill.', 'err');
    }
    setAiInfoBar(Boolean(state.aiMaskImg), state.aiError);
    await renderToPreview();

    logEvent('pipeline.reprocess_ai', {
      fileName:  state.origFile?.name ?? null,
      success:   Boolean(state.aiMaskImg),
      aiError:   state.aiError || null,
      durationMs: Math.round(performance.now() - startedAt),
    });
  } finally {
    isProcessing = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setTelemetryContext({
    page:     'main',
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

  let safeFile;
  try {
    safeFile = assertBrowserFileInput(file);
  } catch (err) {
    toast('Không tìm thấy file hợp lệ để xử lý.', 'err');
    logEvent('upload.guard_failed', {
      error: serializeErrorForTelemetry(err, { fallbackMessage: 'Upload guard failed' }),
      valueType: typeof file,
    }, 'warn');
    return;
  }

  const validation = validateImageFile(safeFile);
  if (!validation.ok) {
    toast(validation.error, 'err');
    logEvent('upload.validation_failed', {
      fileName: safeFile.name,
      fileSize: safeFile.size,
      mimeType: safeFile.type,
      error:    validation.error,
    }, 'error');
    return;
  }

  try {
    isProcessing   = true;
    const runId    = ++activeRunId;
    pipelineStep   = STEPS.IDLE;
    state.origFile = safeFile;
    state.origImg  = await loadImageFromFile(safeFile);
    if (runId !== activeRunId) return;
    await processFile(safeFile, runId);
  } catch (err) {
    toast('Upload thất bại. Vui lòng thử lại.', 'err');
    setSection('upload');
    logEvent('pipeline.failed', {
      fileName: safeFile.name,
      fileSize: safeFile.size,
      mimeType: safeFile.type,
      error:    serializeErrorForTelemetry(err, { fallbackMessage: 'Upload failed' }),
    }, 'error');
  } finally {
    isProcessing = false;
  }
}
