import { detectFace, loadFaceModels, runBackgroundRemoval, warmupAi } from './ai.js';
import { nextStep, STEPS } from './pipeline.js';
import { renderToPreview } from './render.js';
import { state, validateImageFile } from './state.js';
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
 *
 * FIX: Phiên bản cũ trả về thông báo lỗi generic cho mọi img.onerror.
 * HEIC/HEIF silent fail trên Chrome/Firefox (browser không decode natively)
 * khiến user không hiểu nguyên nhân lỗi.
 *
 * Fix: detect định dạng HEIC/HEIF qua tên file và mime type,
 * trả về thông báo hướng dẫn cụ thể thay vì "Hãy thử đổi ảnh sang JPG".
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
  setSection('loading');
  setProgress(5);
  setLoadStep(1, 'active');
  setLoad('Đang tải thư viện...', '');

  pipelineStep = nextStep(pipelineStep);  // idle → loading_libs

  // warmupAi/loadFaceModels phụ thuộc mạng CDN, có thể treo request ở một số
  // mạng công ty/vpn/proxy. Dùng timeout để luôn thoát khỏi bước loading.
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
  pipelineStep = nextStep(pipelineStep);  // loading_libs → detect_face
  try {
    state.faceData = faceReady ? await detectFace(oc) : null;
  } catch {
    state.faceData = null;
  }
  setLoadStep(2, 'done');
  setProgress(35);

  setLoadStep(3, 'active');
  setLoad('AI đang tách nền...', 'Lần đầu có thể mất 20–40 giây để tải model');
  pipelineStep = nextStep(pipelineStep);  // detect_face → remove_bg
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
  pipelineStep = nextStep(pipelineStep);  // remove_bg → render_done
  mountEditor();
  await renderToPreview();
  setLoadStep(4, 'done');
  setProgress(100);
  setSteps(3);

  setFaceStatus(state.faceData?.score ?? null);
  setAiInfoBar(Boolean(state.aiMaskImg), state.aiError);
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

  if (!state.aiReady) {
    setLoad('Đang tải AI...', 'Đang thử lại mô-đun tách nền');
    // warmupAi idempotent: nếu đã load rồi, trả về true ngay
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
}

document.addEventListener('DOMContentLoaded', () => {
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
    },
    // FIX: copyToClipboard() giờ trả về { method: 'clipboard' | 'newtab' }
    // thay vì throw khi browser không hỗ trợ ClipboardItem API.
    // Toast message thay đổi theo method để user biết chuyện gì đã xảy ra.
    onCopy: async () => {
      const result = await copyToClipboard();
      if (result.method === 'clipboard') {
        toast('📋 Đã sao chép!', 'ok');
      } else {
        toast('🖼️ Trình duyệt không hỗ trợ sao chép — đã mở ảnh trong tab mới.', 'ok');
      }
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
  } finally {
    isProcessing = false;
  }
}
