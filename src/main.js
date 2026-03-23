import { detectFace, loadFaceModels, runBackgroundRemoval, warmupAi } from './ai.js';
import { nextStep } from './pipeline.js';
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

let pipelineStep = 'idle';
let isProcessing = false;

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Không đọc được ảnh từ thiết bị. Hãy thử đổi ảnh sang JPG hoặc PNG.'));
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

  pipelineStep = nextStep(pipelineStep);

  // FIX 1: warmupAi và loadFaceModels độc lập nhau — chạy song song
  // giảm thời gian khởi động ~1-3 giây so với chạy tuần tự.
  const [aiReady, faceReady] = await Promise.all([warmupAi(), loadFaceModels()]);
  setLoadStep(1, 'done');
  setProgress(20);

  const oc = document.getElementById('orig-canvas');
  oc.width = state.origImg.width;
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
  // mountEditor() đã gọi initCrop() bên trong — không gọi lại để tránh
  // đăng ký event listener trùng và tạo rAF loop thứ hai.
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

    // showPicker yêu cầu user gesture rất chặt; click() ổn định hơn giữa các trình duyệt
    input.click();
  };

  initUI({
    onPickFile: openFilePicker,
    onReprocessAI: reprocessAI,
    onDownload: async (mode) => {
      await download(mode);
      setSteps(4);
      toast('✅ Đã tải ảnh thành công', 'ok');
    },
    onCopy: async () => {
      await copyToClipboard();
      toast('📋 Đã sao chép!', 'ok');
    },
    onFileDrop: (file) => void handleFile(file),
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
    isProcessing = true;
    state.origFile = file;
    state.origImg = await loadImageFromFile(file);
    await processFile(file);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Upload thất bại. Vui lòng thử lại.';
    toast(msg, 'err');
    setSection('upload');
  } finally {
    isProcessing = false;
  }
}
