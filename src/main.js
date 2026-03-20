import { detectFace, loadFaceModels, runBackgroundRemoval, warmupAi } from './ai.js';
import { initCrop } from './crop.js';
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

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = String(e.target?.result ?? '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function processFile(file) {
  setSection('loading');
  setProgress(5);
  setLoadStep(1, 'active');
  setLoad('Đang tải thư viện...', '');

  pipelineStep = nextStep(pipelineStep);
  await warmupAi();
  await loadFaceModels();
  setLoadStep(1, 'done');
  setProgress(20);

  const oc = document.getElementById('orig-canvas');
  oc.width = state.origImg.width;
  oc.height = state.origImg.height;
  oc.getContext('2d')?.drawImage(state.origImg, 0, 0);

  setLoadStep(2, 'active');
  setLoad('Nhận dạng khuôn mặt...', '');
  pipelineStep = nextStep(pipelineStep);
  state.faceData = await detectFace(oc);
  setLoadStep(2, 'done');
  setProgress(35);

  setLoadStep(3, 'active');
  setLoad('AI đang tách nền...', 'Lần đầu có thể mất 20–40 giây để tải model');
  pipelineStep = nextStep(pipelineStep);
  state.aiMaskImg = await runBackgroundRemoval(file, (current, total) => {
    if (total > 0) setProgress(35 + Math.round((current / total) * 50));
  });
  setLoadStep(3, 'done');

  setLoadStep(4, 'active');
  setLoad('Hoàn thiện...', '');
  pipelineStep = nextStep(pipelineStep);
  mountEditor();
  initCrop();
  await renderToPreview();
  setLoadStep(4, 'done');
  setProgress(100);
  setSteps(3);

  setFaceStatus(state.faceData?.score ?? null);
  setAiInfoBar(Boolean(state.aiMaskImg));
  toast(state.aiMaskImg ? '✅ AI tách nền thành công!' : '✅ Xử lý xong (flood fill)', 'ok');
}

async function handleFile(file) {
  const validation = validateImageFile(file);
  if (!validation.ok) {
    toast(validation.error, 'err');
    return;
  }

  state.origFile = file;
  state.origImg = await loadImageFromFile(file);
  await processFile(file);
}

async function reprocessAI() {
  if (!state.origFile) {
    toast('Chưa có ảnh', 'err');
    return;
  }
  state.aiMaskImg = await runBackgroundRemoval(state.origFile);
  setAiInfoBar(Boolean(state.aiMaskImg));
  await renderToPreview();
}

document.addEventListener('DOMContentLoaded', () => {
  initUI({
    onPickFile: () => document.getElementById('file-input').click(),
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
