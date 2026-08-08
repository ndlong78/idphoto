import { createPrintSheetPreviewPage } from './print-sheet-preview-navigation.js';
import { renderPrintSheetPreview } from './print-sheet-preview.js';
import { refreshPrintSheetPanel } from './print-sheet-view.js';
import { state } from './state.js';

function appendText(doc, parent, tag, className, text) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function createNavigationButton(doc, parent, { id, label, direction }) {
  const button = appendText(doc, parent, 'button', 'print-sheet-preview-nav-button', label);
  button.id = id;
  button.type = 'button';
  button.dataset.previewDirection = direction;
  return button;
}

export function ensurePrintSheetPreview(doc = globalThis.document) {
  if (!doc) return null;
  const existing = doc.getElementById('print-sheet-preview');
  if (existing) return existing;

  refreshPrintSheetPanel(doc);
  const panel = doc.getElementById('print-sheet-panel');
  const summary = doc.getElementById('print-sheet-summary');
  if (!panel || !summary) return null;

  const figure = doc.createElement('figure');
  figure.id = 'print-sheet-preview';
  figure.className = 'print-sheet-preview';

  const stage = doc.createElement('div');
  stage.id = 'print-sheet-preview-stage';
  stage.className = 'print-sheet-preview-stage';
  const canvas = doc.createElement('canvas');
  canvas.id = 'print-sheet-preview-canvas';
  canvas.className = 'print-sheet-preview-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-describedby',
    'print-sheet-summary print-sheet-pdf-summary print-sheet-preview-page-indicator print-sheet-preview-caption',
  );
  canvas.setAttribute('aria-label', 'Bản xem trước tờ in nhiều ảnh');
  stage.appendChild(canvas);
  figure.appendChild(stage);

  const navigation = doc.createElement('nav');
  navigation.id = 'print-sheet-preview-navigation';
  navigation.className = 'print-sheet-preview-navigation';
  navigation.setAttribute('aria-label', 'Điều hướng các trang PDF');
  createNavigationButton(doc, navigation, {
    id: 'btn-print-sheet-preview-previous',
    label: '← Trang trước',
    direction: 'previous',
  });
  const indicator = appendText(
    doc,
    navigation,
    'span',
    'print-sheet-preview-page-indicator',
    'Trang 1/1 · 1 ảnh',
  );
  indicator.id = 'print-sheet-preview-page-indicator';
  indicator.setAttribute('aria-live', 'polite');
  createNavigationButton(doc, navigation, {
    id: 'btn-print-sheet-preview-next',
    label: 'Trang sau →',
    direction: 'next',
  });
  figure.appendChild(navigation);

  const status = appendText(
    doc,
    figure,
    'p',
    'print-sheet-preview-status',
    'Đang chờ ảnh kết quả để tạo bản xem trước.',
  );
  status.id = 'print-sheet-preview-status';
  status.setAttribute('aria-live', 'polite');

  const caption = appendText(
    doc,
    figure,
    'figcaption',
    'print-sheet-preview-caption',
    'Bản xem trước nhẹ theo đúng bố cục từng trang. File tải xuống vẫn được tạo riêng ở 300 DPI.',
  );
  caption.id = 'print-sheet-preview-caption';

  summary.insertAdjacentElement('afterend', figure);
  return figure;
}

function closestMatches(target, selector) {
  return Boolean(target?.closest?.(selector));
}

function updateNavigation(doc, page) {
  const navigation = doc.getElementById('print-sheet-preview-navigation');
  const previousButton = doc.getElementById('btn-print-sheet-preview-previous');
  const nextButton = doc.getElementById('btn-print-sheet-preview-next');
  const indicator = doc.getElementById('print-sheet-preview-page-indicator');
  if (navigation) {
    navigation.hidden = page.pageCount <= 1;
    navigation.dataset.currentPage = String(page.pageNumber);
    navigation.dataset.pageCount = String(page.pageCount);
    navigation.dataset.pageCopies = String(page.copies);
  }
  if (previousButton) previousButton.disabled = page.isFirstPage;
  if (nextButton) nextButton.disabled = page.isLastPage;
  if (indicator) indicator.textContent = page.label;
}

let activeController = null;
let activeObserver = null;
let activeTimers = [];
let activeAnimationFrame = 0;

export function startPrintSheetPreviewView({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
} = {}) {
  const figure = ensurePrintSheetPreview(documentRef);
  if (!figure) return () => {};

  activeController?.abort();
  activeObserver?.disconnect();
  activeTimers.forEach((timer) => windowRef?.clearTimeout?.(timer));
  activeTimers = [];
  if (activeAnimationFrame) windowRef?.cancelAnimationFrame?.(activeAnimationFrame);
  activeAnimationFrame = 0;

  activeController = new AbortController();
  const { signal } = activeController;
  const canvas = documentRef.getElementById('print-sheet-preview-canvas');
  const stage = documentRef.getElementById('print-sheet-preview-stage');
  const status = documentRef.getElementById('print-sheet-preview-status');
  let currentPageNumber = 1;

  const renderCurrentPreview = () => {
    const current = refreshPrintSheetPanel(documentRef);
    if (!current || !canvas) return null;
    const page = createPrintSheetPreviewPage({
      layout: current.layout,
      pdfBatch: current.pdfBatch,
      pageNumber: currentPageNumber,
    });
    currentPageNumber = page.pageNumber;
    updateNavigation(documentRef, page);

    const sourceCanvas = documentRef.getElementById('result-canvas');
    const availableWidth = Number(stage?.clientWidth) > 40
      ? Math.max(140, Math.min(320, Number(stage.clientWidth) - 24))
      : 300;
    const result = renderPrintSheetPreview(sourceCanvas, page.layout, {
      canvas,
      drawCropMarks: current.options.drawCropMarks,
      maxWidthCss: availableWidth,
      maxHeightCss: 320,
      devicePixelRatio: windowRef?.devicePixelRatio ?? 1,
    });
    if (canvas.dataset) {
      canvas.dataset.previewFormat = String(state.curFmt ?? '');
      canvas.dataset.previewPage = String(page.pageNumber);
      canvas.dataset.previewPageCount = String(page.pageCount);
    }
    canvas.setAttribute(
      'aria-label',
      `${page.label}, ${page.layout.paperLabel}, ${page.layout.columns} cột × ${page.layout.rowsUsed} hàng`,
    );
    if (status) {
      status.hidden = result.sourceReady;
      status.textContent = result.sourceReady
        ? ''
        : 'Đang chờ ảnh kết quả để tạo bản xem trước.';
    }
    return Object.freeze({ ...result, page });
  };

  const clearScheduledPreview = () => {
    activeTimers.forEach((timer) => windowRef?.clearTimeout?.(timer));
    activeTimers = [];
    if (activeAnimationFrame) windowRef?.cancelAnimationFrame?.(activeAnimationFrame);
    activeAnimationFrame = 0;
  };

  const schedulePreview = (delays = [0, 180, 650]) => {
    clearScheduledPreview();
    const run = () => {
      try {
        renderCurrentPreview();
      } catch {
        if (status) {
          status.hidden = false;
          status.textContent = 'Chưa tạo được bản xem trước. File tải xuống không bị ảnh hưởng.';
        }
      }
    };

    for (const delay of delays) {
      if (delay === 0 && typeof windowRef?.requestAnimationFrame === 'function') {
        activeAnimationFrame = windowRef.requestAnimationFrame(() => {
          activeAnimationFrame = 0;
          run();
        });
      } else if (typeof windowRef?.setTimeout === 'function') {
        const timer = windowRef.setTimeout(run, delay);
        activeTimers.push(timer);
      } else {
        run();
      }
    }
  };

  const printControlSelector = [
    '#print-sheet-paper',
    '#print-sheet-copies',
    '#print-sheet-orientation',
    '#print-sheet-margin',
    '#print-sheet-gap',
    '#print-sheet-crop-marks',
    '#print-sheet-pdf-total-copies',
  ].join(',');
  const layoutResetSelector = [
    '#print-sheet-paper',
    '#print-sheet-copies',
    '#print-sheet-orientation',
    '#print-sheet-margin',
    '#print-sheet-gap',
  ].join(',');

  documentRef.addEventListener('change', (event) => {
    if (!closestMatches(event.target, printControlSelector)) return;
    if (closestMatches(event.target, layoutResetSelector)) currentPageNumber = 1;
    schedulePreview([0, 120]);
  }, { signal });

  documentRef.addEventListener('input', (event) => {
    if (closestMatches(event.target, '#print-sheet-pdf-total-copies')) {
      schedulePreview([80, 180]);
      return;
    }
    if (!closestMatches(event.target, '#editor-section')) return;
    if (closestMatches(event.target, printControlSelector)) return;
    schedulePreview([80, 240]);
  }, { signal });

  documentRef.addEventListener('click', (event) => {
    const navigationButton = event.target?.closest?.('button[data-preview-direction]');
    if (navigationButton) {
      const direction = navigationButton.dataset.previewDirection;
      currentPageNumber += direction === 'previous' ? -1 : 1;
      schedulePreview([0]);
      return;
    }
    if (!closestMatches(
      event.target,
      '.fbtn, .sw, #btn-reprocess, #btn-reset-face, #btn-fit, #btn-zoom-minus, #btn-zoom-plus, #btn-result-minus, #btn-result-plus, #btn-result-fit',
    )) return;
    if (closestMatches(event.target, '.fbtn')) currentPageNumber = 1;
    schedulePreview();
  }, { signal });

  const scheduleAfterGesture = (event) => {
    if (closestMatches(event.target, '#crop-canvas, #prev-wrap')) schedulePreview([80, 240]);
  };
  documentRef.addEventListener('mouseup', scheduleAfterGesture, { signal });
  documentRef.addEventListener('touchend', scheduleAfterGesture, { passive: true, signal });
  documentRef.addEventListener('wheel', scheduleAfterGesture, { passive: true, signal });

  const MutationObserverRef = windowRef?.MutationObserver ?? globalThis.MutationObserver;
  const editorSection = documentRef.getElementById('editor-section');
  const sizeBadge = documentRef.getElementById('size-badge');
  if (typeof MutationObserverRef === 'function') {
    activeObserver = new MutationObserverRef(() => schedulePreview());
    if (editorSection) {
      activeObserver.observe(editorSection, {
        attributes: true,
        attributeFilter: ['style'],
      });
    }
    if (sizeBadge) {
      activeObserver.observe(sizeBadge, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
  }

  windowRef?.addEventListener?.('resize', () => schedulePreview([0]), { signal });
  schedulePreview();

  return () => {
    activeController?.abort();
    activeObserver?.disconnect();
    activeObserver = null;
    clearScheduledPreview();
  };
}
