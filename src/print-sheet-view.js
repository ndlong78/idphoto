import {
  computePrintSheetLayout,
  PRINT_SHEET_PAPERS,
} from './print-sheet-layout.js';
import {
  formatPrintSheetPageDistribution,
  normalizePrintSheetPdfTotalCopies,
  paginatePrintSheetCopies,
  PRINT_SHEET_PDF_MAX_TOTAL_COPIES,
} from './print-sheet-pagination.js';
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

function createNumberField(doc, parent, {
  id,
  label,
  min,
  max,
}) {
  const field = doc.createElement('label');
  field.className = 'print-sheet-field';
  field.htmlFor = id;
  appendText(doc, field, 'span', '', label);
  const input = doc.createElement('input');
  input.id = id;
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = '1';
  input.inputMode = 'numeric';
  input.autocomplete = 'off';
  field.appendChild(input);
  parent.appendChild(field);
  return input;
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
    'Xếp nhiều bản đúng kích thước lên giấy 10 × 15 cm hoặc A4. JPEG tải một tờ; PDF có thể tự chia nhiều trang.',
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
    label: 'Số bản / trang',
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

  const pdfBatch = doc.createElement('div');
  pdfBatch.className = 'print-sheet-pdf-batch';
  panel.appendChild(pdfBatch);
  const totalCopies = createNumberField(doc, pdfBatch, {
    id: 'print-sheet-pdf-total-copies',
    label: 'Tổng ảnh PDF',
    min: 1,
    max: PRINT_SHEET_PDF_MAX_TOTAL_COPIES,
  });
  totalCopies.setAttribute('aria-describedby', 'print-sheet-pdf-summary');
  const pdfSummary = appendText(doc, pdfBatch, 'p', 'print-sheet-pdf-summary', '');
  pdfSummary.id = 'print-sheet-pdf-summary';
  pdfSummary.setAttribute('aria-live', 'polite');

  const actions = doc.createElement('div');
  actions.className = 'print-sheet-actions';
  panel.appendChild(actions);

  const jpegButton = appendText(doc, actions, 'button', 'print-sheet-button', 'Tải JPEG 300 DPI');
  jpegButton.type = 'button';
  jpegButton.id = 'btn-print-sheet';

  const pdfButton = appendText(doc, actions, 'button', 'print-sheet-button is-secondary', 'Tải PDF đúng khổ');
  pdfButton.type = 'button';
  pdfButton.id = 'btn-print-sheet-pdf';
  pdfButton.title = 'PDF tự chia nhiều trang. Khi in, chọn Actual size hoặc 100%.';

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

function refreshPdfBatch(doc, selectedLayout) {
  const input = doc.getElementById('print-sheet-pdf-total-copies');
  const summary = doc.getElementById('print-sheet-pdf-summary');
  if (!input || !summary) return null;
  const totalCopies = input.dataset.manual === 'true'
    ? normalizePrintSheetPdfTotalCopies(input.value, { fallback: selectedLayout.copies })
    : selectedLayout.copies;
  input.value = String(totalCopies);
  const batch = paginatePrintSheetCopies({
    totalCopies,
    copiesPerPage: selectedLayout.copies,
  });
  const distribution = formatPrintSheetPageDistribution(batch.pageCopies);
  summary.textContent = batch.pageCount === 1
    ? `PDF: ${batch.totalCopies} ảnh · 1 trang giống bản xem trước.`
    : `PDF: ${batch.totalCopies} ảnh · ${batch.pageCount} trang · ${distribution} ảnh/trang. Dùng điều hướng dưới bản xem trước để kiểm tra từng trang.`;
  summary.dataset.pageCount = String(batch.pageCount);
  summary.dataset.totalCopies = String(batch.totalCopies);
  summary.dataset.lastPageCopies = String(batch.lastPageCopies);
  return batch;
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
  const pdfBatch = refreshPdfBatch(doc, selectedLayout);
  return { options, layout: selectedLayout, pdfBatch };
}

function setExportBusy(panel, buttons, busy) {
  panel.setAttribute('aria-busy', busy ? 'true' : 'false');
  for (const button of buttons) {
    if (button) button.disabled = busy;
  }
}

let activeController = null;
let activeUiObserver = null;

export function startPrintSheetView({
  documentRef = globalThis.document,
  onExport = async () => {},
  onExportPdf = async () => {},
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
  const totalCopiesInput = documentRef.getElementById('print-sheet-pdf-total-copies');
  totalCopiesInput?.addEventListener('input', () => {
    totalCopiesInput.dataset.manual = 'true';
    if (totalCopiesInput.value) refresh();
  }, { signal });
  totalCopiesInput?.addEventListener('change', () => {
    totalCopiesInput.dataset.manual = 'true';
    refresh();
  }, { signal });

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

  const jpegButton = documentRef.getElementById('btn-print-sheet');
  const pdfButton = documentRef.getElementById('btn-print-sheet-pdf');
  const buttons = [jpegButton, pdfButton].filter(Boolean);

  const bindExport = (button, callback) => {
    button?.addEventListener('click', async () => {
      if (button.disabled) return;
      const current = refresh();
      if (!current) return;
      setExportBusy(panel, buttons, true);
      try {
        await callback(current.options, current.layout, current.pdfBatch);
      } finally {
        setExportBusy(panel, buttons, false);
      }
    }, { signal });
  };
  bindExport(jpegButton, onExport);
  bindExport(pdfButton, onExportPdf);

  return () => {
    activeController?.abort();
    activeUiObserver?.disconnect();
    activeUiObserver = null;
  };
}
