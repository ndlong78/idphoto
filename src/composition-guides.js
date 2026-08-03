import { getComplianceProfile } from './compliance.js';
import {
  applyAutoCompositionPlan,
  buildAutoCompositionPlan,
  captureCompositionState,
  compositionStateMatches,
  restoreCompositionState,
} from './composition-fix.js';
import { state } from './state.js';

const GUIDE_TONE = Object.freeze({
  OK: 'ok',
  WARNING: 'warning',
  NEUTRAL: 'neutral',
});

let guidesVisible = true;
let autoCompositionUndo = null;
let compositionFixBusy = false;
let feedbackTimerId = 0;
let lastGuideContext = { geometry: null, result: null, profile: null };

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function normalizeBox(box, outputSize) {
  if (!box || !outputSize) return null;
  const width = finite(outputSize.width);
  const height = finite(outputSize.height);
  const boxX = finite(box.x);
  const boxY = finite(box.y);
  const boxWidth = finite(box.width ?? box.w);
  const boxHeight = finite(box.height ?? box.h);
  if (
    width === null
    || height === null
    || boxX === null
    || boxY === null
    || boxWidth === null
    || boxHeight === null
    || width <= 0
    || height <= 0
    || boxWidth <= 0
    || boxHeight <= 0
  ) return null;

  return {
    left: boxX / width,
    top: boxY / height,
    width: boxWidth / width,
    height: boxHeight / height,
    centerX: (boxX + boxWidth / 2) / width,
    centerY: (boxY + boxHeight / 2) / height,
  };
}

function getCheck(result, id) {
  return result?.checks?.find((check) => check.id === id) ?? null;
}

function toneForChecks(result, ids, hasGeometry) {
  const checks = ids.map((id) => getCheck(result, id)).filter(Boolean);
  if (checks.some((check) => check.status === 'warning')) return GUIDE_TONE.WARNING;
  if (hasGeometry && checks.some((check) => check.status === 'pass')) return GUIDE_TONE.OK;
  return GUIDE_TONE.NEUTRAL;
}

function deriveGuideAction({ result, geometry, profile }) {
  const faceCount = geometry?.faceCount ?? 0;
  const faceCountCheck = getCheck(result, 'face-count');
  if (faceCountCheck?.status === 'warning') {
    return faceCount === 0
      ? { tone: GUIDE_TONE.WARNING, text: 'Chưa nhận diện được khuôn mặt; hãy dùng ảnh rõ mặt hơn.' }
      : { tone: GUIDE_TONE.WARNING, text: 'Ảnh có nhiều khuôn mặt; hãy chọn ảnh chỉ có một người.' };
  }

  const clipping = getCheck(result, 'face-clipping');
  if (clipping?.status === 'warning') {
    return { tone: GUIDE_TONE.WARNING, text: 'Kéo hoặc thu nhỏ ảnh để khuôn mặt nằm trọn trong khung.' };
  }

  const centering = getCheck(result, 'horizontal-centering');
  if (centering?.status === 'warning' && geometry?.faceBox && geometry?.outputSize?.width) {
    const faceCenter = geometry.faceBox.x + geometry.faceBox.width / 2;
    const photoCenter = geometry.outputSize.width / 2;
    return faceCenter < photoCenter
      ? { tone: GUIDE_TONE.WARNING, text: 'Kéo ảnh sang phải để đưa khuôn mặt về đường tâm.' }
      : { tone: GUIDE_TONE.WARNING, text: 'Kéo ảnh sang trái để đưa khuôn mặt về đường tâm.' };
  }

  const faceArea = getCheck(result, 'face-area');
  if (faceArea?.status === 'warning' && Number.isFinite(faceArea.value)) {
    if (Number.isFinite(faceArea.min) && faceArea.value < faceArea.min) {
      return { tone: GUIDE_TONE.WARNING, text: 'Zoom vào để khuôn mặt lớn hơn trong khung.' };
    }
    if (Number.isFinite(faceArea.max) && faceArea.value > faceArea.max) {
      return { tone: GUIDE_TONE.WARNING, text: 'Zoom ra để khuôn mặt nhỏ hơn trong khung.' };
    }
  }

  const eyeLine = getCheck(result, 'eye-line');
  if (eyeLine?.status === 'warning' && Number.isFinite(eyeLine.value)) {
    if (Number.isFinite(eyeLine.min) && eyeLine.value < eyeLine.min) {
      return { tone: GUIDE_TONE.WARNING, text: 'Kéo ảnh xuống để đưa đường mắt vào vùng hướng dẫn.' };
    }
    if (Number.isFinite(eyeLine.max) && eyeLine.value > eyeLine.max) {
      return { tone: GUIDE_TONE.WARNING, text: 'Kéo ảnh lên để đưa đường mắt vào vùng hướng dẫn.' };
    }
  }

  const hasAutomaticGuide = Boolean(
    geometry?.faceBox
    || Number.isFinite(geometry?.eyeLineY)
    || profile?.eyeLineFromTopRange,
  );
  return hasAutomaticGuide
    ? { tone: GUIDE_TONE.OK, text: 'Bố cục hiện nằm trong các vùng hướng dẫn có dữ liệu.' }
    : { tone: GUIDE_TONE.NEUTRAL, text: 'Preset này chưa có đủ dữ liệu để vẽ hướng dẫn chi tiết.' };
}

/**
 * Chuyển geometry đã chiếu sang model hiển thị theo tỷ lệ 0–1.
 * Hàm thuần, không phụ thuộc DOM.
 */
export function buildCompositionGuideModel({ geometry = null, result = null, profile = null } = {}) {
  const outputSize = geometry?.outputSize;
  const outputWidth = finite(outputSize?.width);
  const outputHeight = finite(outputSize?.height);
  if (!outputWidth || !outputHeight || outputWidth <= 0 || outputHeight <= 0) {
    return {
      available: false,
      action: { tone: GUIDE_TONE.NEUTRAL, text: 'Chưa có dữ liệu bố cục để hiển thị.' },
    };
  }

  const centerTolerance = Number.isFinite(profile?.horizontalCenterTolerance)
    ? clamp(profile.horizontalCenterTolerance, 0, 0.5)
    : 0.08;
  const eyeRange = profile?.eyeLineFromTopRange ?? null;
  const faceBox = normalizeBox(geometry?.faceBox, outputSize);
  const headBox = normalizeBox(geometry?.headBox, outputSize);
  const eyeLine = Number.isFinite(geometry?.eyeLineY)
    ? geometry.eyeLineY / outputHeight
    : null;

  return {
    available: true,
    centerBand: {
      left: 0.5 - centerTolerance,
      width: centerTolerance * 2,
      target: 0.5,
    },
    eyeBand: eyeRange
      ? {
          top: clamp(eyeRange.min),
          height: clamp(eyeRange.max) - clamp(eyeRange.min),
          target: Number.isFinite(eyeRange.target) ? clamp(eyeRange.target) : null,
          approximate: Boolean(eyeRange.approximate),
        }
      : null,
    eyeLine: Number.isFinite(eyeLine)
      ? {
          top: eyeLine,
          tone: toneForChecks(result, ['eye-line'], true),
        }
      : null,
    faceBox: faceBox
      ? {
          ...faceBox,
          tone: toneForChecks(
            result,
            ['face-clipping', 'horizontal-centering', 'face-area'],
            true,
          ),
        }
      : null,
    headBox: headBox
      ? {
          ...headBox,
          tone: toneForChecks(result, ['head-height'], true),
        }
      : null,
    action: deriveGuideAction({ result, geometry, profile }),
  };
}

function ensureStylesheet(doc) {
  if (!doc.getElementById('composition-guides-stylesheet')) {
    const link = doc.createElement('link');
    link.id = 'composition-guides-stylesheet';
    link.rel = 'stylesheet';
    link.href = './composition-guides.css';
    doc.head?.appendChild(link);
  }
  if (!doc.getElementById('composition-fix-stylesheet')) {
    const link = doc.createElement('link');
    link.id = 'composition-fix-stylesheet';
    link.rel = 'stylesheet';
    link.href = './composition-fix.css';
    doc.head?.appendChild(link);
  }
}

function setPosition(el, values) {
  if (!el || !values) return;
  for (const [key, value] of Object.entries(values)) {
    el.style[key] = `${value * 100}%`;
  }
}

function setTone(el, tone) {
  if (!el) return;
  el.classList.remove('is-ok', 'is-warning', 'is-neutral');
  el.classList.add(`is-${tone ?? GUIDE_TONE.NEUTRAL}`);
}

function setHidden(el, hidden) {
  if (el) el.hidden = Boolean(hidden);
}

function createToolButton(doc, { id, text, title, className = '' }) {
  const button = doc.createElement('button');
  button.id = id;
  button.type = 'button';
  button.className = `composition-tool-btn ${className}`.trim();
  button.textContent = text;
  button.title = title;
  return button;
}

function syncCompositionControls(doc) {
  const faceOffset = doc.getElementById('face-y-offset');
  const faceOffsetLabel = doc.getElementById('face-yv');
  const value = Number(state.faceAdjust?.yOffsetPct) || 0;
  if (faceOffset) faceOffset.value = String(value);
  if (faceOffsetLabel) faceOffsetLabel.textContent = `${value > 0 ? '+' : ''}${value}%`;
}

function setFixFeedback(doc, text, tone = GUIDE_TONE.NEUTRAL) {
  const feedback = doc.getElementById('composition-fix-feedback');
  if (!feedback) return;
  const view = doc.defaultView ?? globalThis.window;
  if (feedbackTimerId && view) view.clearTimeout(feedbackTimerId);
  feedback.textContent = text;
  feedback.hidden = false;
  setTone(feedback, tone);
  if (view) {
    feedbackTimerId = view.setTimeout(() => {
      feedback.hidden = true;
      feedbackTimerId = 0;
    }, 5200);
  }
}

async function rerenderAfterCompositionChange(doc) {
  syncCompositionControls(doc);
  const [{ syncZoomUI }, { renderToPreview }] = await Promise.all([
    import('./dom.js'),
    import('./render.js'),
  ]);
  syncZoomUI();
  await renderToPreview();
}

function resolveCurrentProfile() {
  return lastGuideContext.profile ?? getComplianceProfile(state.curFmt);
}

function updateCompositionToolState(doc) {
  const autoButton = doc.getElementById('btn-auto-compose');
  const undoButton = doc.getElementById('btn-undo-compose');
  if (!autoButton || !undoButton) return;

  if (autoCompositionUndo && !compositionStateMatches(state, autoCompositionUndo.after)) {
    autoCompositionUndo = null;
  }

  const plan = buildAutoCompositionPlan({ snapshot: state, profile: resolveCurrentProfile() });
  autoButton.disabled = compositionFixBusy || !plan.ok;
  autoButton.title = plan.ok
    ? 'Căn giữa và điều chỉnh các tiêu chí có đủ dữ liệu'
    : plan.message;
  undoButton.disabled = compositionFixBusy || !autoCompositionUndo;
}

async function runAutoComposition(doc) {
  if (compositionFixBusy) return;
  const plan = buildAutoCompositionPlan({ snapshot: state, profile: resolveCurrentProfile() });
  if (!plan.ok) {
    setFixFeedback(doc, plan.message, GUIDE_TONE.WARNING);
    updateCompositionToolState(doc);
    return;
  }

  compositionFixBusy = true;
  updateCompositionToolState(doc);
  try {
    const before = captureCompositionState(state);
    applyAutoCompositionPlan(state, plan);
    const after = captureCompositionState(state);
    if (plan.changed) autoCompositionUndo = { before, after };
    await rerenderAfterCompositionChange(doc);
    const limitation = plan.limitations?.[0] ? ` ${plan.limitations[0]}` : '';
    setFixFeedback(
      doc,
      `${plan.message}${limitation}`,
      plan.changed ? GUIDE_TONE.OK : GUIDE_TONE.NEUTRAL,
    );
  } catch {
    setFixFeedback(doc, 'Không thể căn tự động lúc này. Hãy thử lại.', GUIDE_TONE.WARNING);
  } finally {
    compositionFixBusy = false;
    updateCompositionToolState(doc);
  }
}

async function runUndoComposition(doc) {
  if (compositionFixBusy || !autoCompositionUndo) return;
  if (!compositionStateMatches(state, autoCompositionUndo.after)) {
    autoCompositionUndo = null;
    setFixFeedback(
      doc,
      'Không thể hoàn tác vì bố cục đã được chỉnh thêm sau lần căn tự động.',
      GUIDE_TONE.WARNING,
    );
    updateCompositionToolState(doc);
    return;
  }

  compositionFixBusy = true;
  updateCompositionToolState(doc);
  try {
    const restored = restoreCompositionState(state, autoCompositionUndo.before);
    autoCompositionUndo = null;
    if (!restored) {
      setFixFeedback(doc, 'Không thể hoàn tác trên ảnh hoặc preset hiện tại.', GUIDE_TONE.WARNING);
      return;
    }
    await rerenderAfterCompositionChange(doc);
    setFixFeedback(doc, 'Đã hoàn tác lần căn tự động gần nhất.', GUIDE_TONE.OK);
  } catch {
    setFixFeedback(doc, 'Hoàn tác thất bại. Hãy chỉnh lại bố cục thủ công.', GUIDE_TONE.WARNING);
  } finally {
    compositionFixBusy = false;
    updateCompositionToolState(doc);
  }
}

function ensureCompositionTools(doc, overlay) {
  const controls = doc.querySelector('.panel-right .panel-header-right');
  if (!controls) return;

  let tools = doc.getElementById('composition-tools');
  if (!tools) {
    tools = doc.createElement('div');
    tools.id = 'composition-tools';
    tools.className = 'composition-tools';

    const autoButton = createToolButton(doc, {
      id: 'btn-auto-compose',
      text: '✨ Căn tự động',
      title: 'Căn giữa và điều chỉnh các tiêu chí có đủ dữ liệu',
      className: 'is-primary',
    });
    autoButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void runAutoComposition(doc);
    });

    const undoButton = createToolButton(doc, {
      id: 'btn-undo-compose',
      text: '↶ Hoàn tác',
      title: 'Hoàn tác lần căn tự động gần nhất',
    });
    undoButton.disabled = true;
    undoButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void runUndoComposition(doc);
    });

    const toggle = createToolButton(doc, {
      id: 'btn-toggle-guides',
      text: '◎ Hướng dẫn',
      title: 'Bật hoặc tắt đường hướng dẫn bố cục',
    });
    toggle.setAttribute('aria-controls', 'composition-guides');
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      guidesVisible = !guidesVisible;
      overlay.hidden = !guidesVisible;
      toggle.setAttribute('aria-pressed', String(guidesVisible));
      toggle.classList.toggle('is-active', guidesVisible);
    });

    tools.append(autoButton, undoButton, toggle);
    controls.prepend(tools);
  }

  const toggle = doc.getElementById('btn-toggle-guides');
  if (toggle) {
    toggle.setAttribute('aria-pressed', String(guidesVisible));
    toggle.classList.toggle('is-active', guidesVisible);
  }

  let feedback = doc.getElementById('composition-fix-feedback');
  if (!feedback) {
    const statusBar = doc.querySelector('.panel-right .result-status-bar');
    if (statusBar) {
      feedback = doc.createElement('div');
      feedback.id = 'composition-fix-feedback';
      feedback.className = 'composition-fix-feedback is-neutral';
      feedback.setAttribute('role', 'status');
      feedback.setAttribute('aria-live', 'polite');
      feedback.hidden = true;
      statusBar.appendChild(feedback);
    }
  }

  updateCompositionToolState(doc);
}

/**
 * Tạo overlay và bộ điều khiển. Overlay là sibling của canvas nên không đi vào file export.
 */
export function ensureCompositionGuides(doc = globalThis.document) {
  if (!doc) return null;
  ensureStylesheet(doc);

  const frame = doc.getElementById('result-visa-frame');
  if (!frame) return null;

  let overlay = doc.getElementById('composition-guides');
  if (!overlay) {
    overlay = doc.createElement('div');
    overlay.id = 'composition-guides';
    overlay.className = 'composition-guides';
    overlay.setAttribute('aria-hidden', 'true');

    const parts = [
      ['composition-center-band', 'composition-center-band'],
      ['composition-center-line', 'composition-center-line'],
      ['composition-eye-band', 'composition-eye-band'],
      ['composition-eye-target', 'composition-eye-target'],
      ['composition-eye-line', 'composition-eye-line'],
      ['composition-face-box', 'composition-face-box'],
      ['composition-head-box', 'composition-head-box'],
    ];
    for (const [id, className] of parts) {
      const part = doc.createElement('div');
      part.id = id;
      part.className = className;
      overlay.appendChild(part);
    }

    const legend = doc.createElement('div');
    legend.className = 'composition-guides-legend';
    legend.textContent = 'Tâm · vùng mắt · khuôn mặt AI';
    overlay.appendChild(legend);

    const hint = doc.createElement('div');
    hint.id = 'composition-guide-hint';
    hint.className = 'composition-guide-hint is-neutral';
    hint.textContent = 'Đang chuẩn bị hướng dẫn bố cục…';
    overlay.appendChild(hint);

    frame.appendChild(overlay);
  }

  ensureCompositionTools(doc, overlay);
  overlay.hidden = !guidesVisible;
  return overlay;
}

/**
 * Render hướng dẫn lên preview. Không thay đổi canvas ảnh hoặc file export.
 */
export function renderCompositionGuides({ geometry = null, result = null, profile = null } = {}, doc = globalThis.document) {
  lastGuideContext = { geometry, result, profile };
  const overlay = ensureCompositionGuides(doc);
  if (!overlay) return null;
  updateCompositionToolState(doc);

  const model = buildCompositionGuideModel({ geometry, result, profile });
  if (!model.available) {
    overlay.hidden = true;
    return overlay;
  }
  overlay.hidden = !guidesVisible;

  const centerBand = doc.getElementById('composition-center-band');
  const centerLine = doc.getElementById('composition-center-line');
  const eyeBand = doc.getElementById('composition-eye-band');
  const eyeTarget = doc.getElementById('composition-eye-target');
  const eyeLine = doc.getElementById('composition-eye-line');
  const faceBox = doc.getElementById('composition-face-box');
  const headBox = doc.getElementById('composition-head-box');
  const hint = doc.getElementById('composition-guide-hint');

  setPosition(centerBand, { left: model.centerBand.left, width: model.centerBand.width });
  setPosition(centerLine, { left: model.centerBand.target });

  setHidden(eyeBand, !model.eyeBand);
  setHidden(eyeTarget, !model.eyeBand || !Number.isFinite(model.eyeBand.target));
  if (model.eyeBand) {
    setPosition(eyeBand, { top: model.eyeBand.top, height: model.eyeBand.height });
    eyeBand.classList.toggle('is-approximate', model.eyeBand.approximate);
    if (Number.isFinite(model.eyeBand.target)) setPosition(eyeTarget, { top: model.eyeBand.target });
  }

  setHidden(eyeLine, !model.eyeLine);
  if (model.eyeLine) {
    setPosition(eyeLine, { top: model.eyeLine.top });
    setTone(eyeLine, model.eyeLine.tone);
  }

  setHidden(faceBox, !model.faceBox);
  if (model.faceBox) {
    setPosition(faceBox, {
      left: model.faceBox.left,
      top: model.faceBox.top,
      width: model.faceBox.width,
      height: model.faceBox.height,
    });
    setTone(faceBox, model.faceBox.tone);
  }

  setHidden(headBox, !model.headBox);
  if (model.headBox) {
    setPosition(headBox, {
      left: model.headBox.left,
      top: model.headBox.top,
      width: model.headBox.width,
      height: model.headBox.height,
    });
    setTone(headBox, model.headBox.tone);
  }

  if (hint) {
    hint.textContent = model.action.text;
    setTone(hint, model.action.tone);
  }

  return overlay;
}
