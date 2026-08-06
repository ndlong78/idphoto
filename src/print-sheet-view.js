import {
  computePrintSheetLayout,
  PRINT_SHEET_PAPERS,
} from './print-sheet-layout.js';
import { FMTS, state } from './state.js';

function appendText(doc, parent, tag, className, text) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function scheduleMicrotask(callback) {
  if (typeof globalThis.queueMicrotask === 'function') {
    globalThis.queueMicrotask(callback);
    return;
  }
  Promise.resolve().then(callback);
}

function ensureStylesheet(doc) {
  if (doc.getElementById('print-sheet-stylesheet')) return;
  const link = doc.createElement('link');
  link.id = 'print-sheet-stylesheet';
  link.rel = 'stylesheet';
  link.href = './print-sheet.css';
  doc.head?.appendChild(link);
}

function createSelectField(doc, parent, { id, label, options }) {
  const field = doc.createElement('label');
  field.className = 'print-sheet-field';
  field.htmlFor = id;
  appendText(doc, field, 'span', '', label);
  const select = doc.createElement('select');
  select.id = id;
  for (const option of options) {
    const element = doc.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    select.appendChild(element);
  }
  field.appendChild(select);
  parent.appendChild(field);
  return select;
}

export function ensurePrintSheetPanel(doc = globalThis.document) {
  if (!doc) return null;
  ensureStylesheet(doc);
  const existing = doc.getElementById('print-sheet-panel');
  if (existing) return existing;

  const downloadCard = doc.querySelector('.ctrl-dl');
  const actionGroup = downloadCard?.querySelector('.abtn-group');
  if (!downloadCard || !actionGroup) return null;

  const panel = doc.createElement('section');
  panel.id = 'print-sheet-panel';
  panel.className = 'print-sheet-panel';
  panel.setAttribute('aria-labelledby', 'print-sheet-title');

  const heading = appendText(doc, panel, 'h5', '', '🖨️ Tờ in nhiều ảnh');
  heading.id = 'print-sheet-title';
  appendText(
    doc,
    panel,
    'p',
    'print-sheet-help',
    'Xếp nhiều bản đúng kích thước lên giấy 10 × 15 cm hoặc A4, xuất JPEG 300 DPI.',
  );

  const controls = doc.createElement('div');
  controls.className = 'print-sheet-controls';
  panel.appendChild(controls);

  const paperSelect = createSelectField(doc, controls, {
    id: 'print-sheet-paper',
    label: 'Khổ giấy',
    options: Object.values(PRINT_SHEET_PAPERS).map((paper) => ({
      value: paper.key,
      label: paper.label,
    })),
  });

  createSelectField(doc, controls, {
    id: 'print-sheet-copies',
    label: 'Số bản',
    options: [{ value: 'max', label: 'Tối đa' }],
  });

  const gapSelect = createSelectField(doc, controls, {
    id: 'print-sheet-gap',
    label: 'Khoảng cách',
    options: [2, 3, 4, 5].map((value) => ({ value: String(value), label: `${value} mm` })),
  });
  gapSelect.value = String(PRINT_SHEET_PAPERS[paperSelect.value].defaultGapMm);

  const cropMarksLabel = doc.createElement('label');
  cropMarksLabel.className = 'print-sheet-check';
  const cropMarks = doc.createElement('input');
  cropMarks.type = 'checkbox';
  cropMarks.id = 'print-sheet-crop-marks';
  cropMarks.checked = true;
  cropMarksLabel.appendChild(cropMarks);
  appendText(doc, cropMarksLabel, 'span', '', 'Dấu cắt');
  controls.appendChild(cropMarksLabel);

  const summary = appendText(doc, panel, 'p', 'print-sheet-summary', '');
  summary.id = 'print-sheet-summary';
  summary.setAttribute('aria-live', 'polite');

  const button = appendText(doc, panel, 'button', 'print-sheet-button', 'Tải tờ in 300 DPI');
  button.type = 'button';
  button.id = 'btn-print-sheet';

  actionGroup.insertAdjacentElement('afterend', panel);
  return panel;
}

function orientationLabel(orientation) {
  return orientation === 'landscape' ? 'ngang' : 'dọc';
}

function readSelectedOptions(doc) {
  const paperKey = doc.getElementById('print-sheet-paper')?.value ?? 'photo-10x15';
  const copiesValue = doc.getElementById('print-sheet-copies')?.value ?? 'max';
  const gapValue = doc.getElementById('print-sheet-gap')?.value;
  return {
    paperKey,
    copies: copiesValue === 'max' ? 'max' : Number(copiesValue),
    gapMm: Number(gapValue ?? PRINT_SHEET_PAPERS[paperKey].defaultGapMm),
    drawCropMarks: Boolean(doc.getElementById('print-sheet-crop-marks')?.checked),
  };
}

function populateCopyOptions(doc, capacity, preferredValue = 'max') {
  const select = doc.getElementById('print-sheet-copies');
  if (!select) return;
  const normalizedPreferred = preferredValue === 'max'
    ? 'max'
    : String(Math.min(Math.max(1, Number(preferredValue) || capacity), capacity));
  select.replaceChildren();

  const maximum = doc.createElement('option');
  maximum.value = 'max';
  maximum.textContent = `Tối đa (${capacity})`;
  select.appendChild(maximum);

  for (let count = 1; count <= capacity; count += 1) {
    const option = doc.createElement('option');
    option.value = String(count);
    option.textContent = String(count);
    select.appendChild(option);
  }
  select.value = normalizedPreferred;
}

export function refreshPrintSheetPanel(doc = globalThis.document, {
  resetPaperDefaults = false,
} = {}) {
  const panel = ensurePrintSheetPanel(doc);
  if (!panel) return null;
  const paperSelect = doc.getElementById('print-sheet-paper');
  const copiesSelect = doc.getElementById('print-sheet-copies');
  const gapSelect = doc.getElementById('print-sheet-gap');
  const summary = doc.getElementById('print-sheet-summary');
  const format = FMTS[state.curFmt];
  if (!paperSelect || !copiesSelect || !gapSelect || !summary || !format) return null;

  const paper = PRINT_SHEET_PAPERS[paperSelect.value];
  if (resetPaperDefaults) gapSelect.value = String(paper.defaultGapMm);
  const previousCopies = copiesSelect.value || 'max';
  const capacityLayout = computePrintSheetLayout({
    paperKey: paper.key,
    photoWidthMm: format.mmW,
    photoHeightMm: format.mmH,
    copies: 'max',
    gapMm: Number(gapSelect.value),
  });
  populateCopyOptions(doc, capacityLayout.capacity, previousCopies);

  const options = readSelectedOptions(doc);
  const selectedLayout = computePrintSheetLayout({
    paperKey: options.paperKey,
    photoWidthMm: format.mmW,
    photoHeightMm: format.mmH,
    copies: options.copies,
    gapMm: options.gapMm,
  });
  summary.textContent = [
    selectedLayout.paperLabel,
    orientationLabel(selectedLayout.orientation),
    `${selectedLayout.copies}/${selectedLayout.capacity} ảnh`,
    `${selectedLayout.columns} cột × ${selectedLayout.rowsUsed} hàng`,
    `${format.mmW} × ${format.mmH} mm mỗi ảnh`,
  ].join(' · ');
  return { options, layout: selectedLayout };
}

let activeController = null;
let activeUiObserver = null;

export function startPrintSheetView({
  documentRef = globalThis.document,
  onExport = async () => {},
} = {}) {
  const panel = ensurePrintSheetPanel(documentRef);
  if (!panel) return () => {};
  activeController?.abort();
  activeUiObserver?.disconnect();
  activeController = new AbortController();
  const { signal } = activeController;

  const refresh = (options) => refreshPrintSheetPanel(documentRef, options);
  refresh();

  documentRef.getElementById('print-sheet-paper')?.addEventListener('change', () => {
    refresh({ resetPaperDefaults: true });
  }, { signal });
  documentRef.getElementById('print-sheet-copies')?.addEventListener('change', () => refresh(), { signal });
  documentRef.getElementById('print-sheet-gap')?.addEventListener('change', () => refresh(), { signal });

  // Event delegation survives any future replacement of preset buttons. The
  // microtask remains a harmless fallback, while the size badge observer below
  // is the authoritative signal that ui.js committed the new preset.
  documentRef.addEventListener('click', (event) => {
    if (!event.target?.closest?.('.fbtn')) return;
    scheduleMicrotask(() => refresh());
  }, { signal });

  const MutationObserverRef = documentRef.defaultView?.MutationObserver
    ?? globalThis.MutationObserver;
  const editorSection = documentRef.getElementById('editor-section');
  const sizeBadge = documentRef.getElementById('size-badge');
  if (typeof MutationObserverRef === 'function') {
    activeUiObserver = new MutationObserverRef(() => refresh());
    if (editorSection) {
      activeUiObserver.observe(editorSection, {
        attributes: true,
        attributeFilter: ['style'],
      });
    }
    if (sizeBadge) {
      activeUiObserver.observe(sizeBadge, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
  }

  const exportButton = documentRef.getElementById('btn-print-sheet');
  exportButton?.addEventListener('click', async () => {
    if (exportButton.disabled) return;
    const current = refresh();
    if (!current) return;
    exportButton.disabled = true;
    panel.setAttribute('aria-busy', 'true');
    try {
      await onExport(current.options, current.layout);
    } finally {
      exportButton.disabled = false;
      panel.setAttribute('aria-busy', 'false');
    }
  }, { signal });

  return () => {
    activeController?.abort();
    activeUiObserver?.disconnect();
    activeUiObserver = null;
  };
}
