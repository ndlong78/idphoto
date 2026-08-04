import { exportReceiptStore, formatByteSize } from './export-receipt.js';

const DELIVERY_LABELS = Object.freeze({
  image: 'Ảnh đơn',
  'bundle-zip': 'Gói ZIP',
  'audit-json': 'Audit JSON',
  'image-fallback': 'Ảnh fallback',
});

function appendText(doc, parent, tag, className, text) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function ensureStylesheet(doc) {
  if (doc.getElementById('export-receipt-stylesheet')) return;
  const link = doc.createElement('link');
  link.id = 'export-receipt-stylesheet';
  link.rel = 'stylesheet';
  link.href = './export-receipt.css';
  doc.head?.appendChild(link);
}

export function buildExportReceiptViewModel(receipt, {
  locale = 'vi-VN',
  timeZone = undefined,
} = {}) {
  if (!receipt) {
    return {
      tone: 'neutral',
      badge: 'Chưa tải',
      title: 'Chưa có lượt tải trong phiên này',
      filename: null,
      meta: [],
      entries: [],
      note: 'Sau khi tải, thông tin file gần nhất sẽ xuất hiện tại đây.',
    };
  }

  const date = new Date(receipt.generatedAt);
  const time = Number.isNaN(date.getTime())
    ? 'Không rõ thời gian'
    : new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone,
      }).format(date);

  const meta = [formatByteSize(receipt.sizeBytes), time];
  if (receipt.widthPx && receipt.heightPx) meta.unshift(`${receipt.widthPx} × ${receipt.heightPx} px`);
  if (receipt.dpi) meta.unshift(`${receipt.dpi} DPI`);

  return {
    tone: receipt.status === 'fallback' ? 'fallback' : 'success',
    badge: DELIVERY_LABELS[receipt.delivery] ?? 'Đã tải',
    title: receipt.status === 'fallback'
      ? 'Ảnh đã tải bằng phương án dự phòng'
      : 'Đã gửi yêu cầu tải xuống',
    filename: receipt.filename,
    meta,
    entries: receipt.entries.map((entry) => ({
      name: entry.name,
      sizeLabel: formatByteSize(entry.sizeBytes),
    })),
    note: receipt.note ?? (
      receipt.delivery === 'bundle-zip'
        ? 'Gói ZIP chứa ảnh xuất và audit JSON.'
        : 'Trình duyệt quyết định vị trí lưu file trên thiết bị.'
    ),
  };
}

export function ensureExportReceiptPanel(doc = globalThis.document) {
  if (!doc) return null;
  ensureStylesheet(doc);
  const existing = doc.getElementById('export-receipt-panel');
  if (existing) return existing;

  const downloadCard = doc.querySelector('.ctrl-dl');
  if (!downloadCard) return null;

  const panel = doc.createElement('section');
  panel.id = 'export-receipt-panel';
  panel.className = 'export-receipt-panel is-neutral';
  panel.setAttribute('aria-labelledby', 'export-receipt-title');
  panel.setAttribute('aria-live', 'polite');
  panel.setAttribute('aria-atomic', 'true');

  const top = doc.createElement('div');
  top.className = 'export-receipt-top';
  const heading = appendText(doc, top, 'strong', '', 'Lần tải gần nhất');
  heading.id = 'export-receipt-title';
  const badge = appendText(doc, top, 'span', 'export-receipt-badge', 'Chưa tải');
  badge.id = 'export-receipt-badge';
  panel.appendChild(top);

  const summary = appendText(doc, panel, 'p', 'export-receipt-summary', 'Chưa có lượt tải trong phiên này');
  summary.id = 'export-receipt-summary';

  const filename = appendText(doc, panel, 'code', 'export-receipt-filename', '');
  filename.id = 'export-receipt-filename';
  filename.hidden = true;

  const meta = doc.createElement('div');
  meta.id = 'export-receipt-meta';
  meta.className = 'export-receipt-meta';
  panel.appendChild(meta);

  const entries = doc.createElement('ul');
  entries.id = 'export-receipt-entries';
  entries.className = 'export-receipt-entries';
  entries.hidden = true;
  panel.appendChild(entries);

  const note = appendText(doc, panel, 'small', 'export-receipt-note', 'Sau khi tải, thông tin file gần nhất sẽ xuất hiện tại đây.');
  note.id = 'export-receipt-note';

  const manualPanel = downloadCard.querySelector('#manual-review-panel');
  const renote = downloadCard.querySelector('#renote');
  if (manualPanel?.nextSibling) downloadCard.insertBefore(panel, manualPanel.nextSibling);
  else downloadCard.insertBefore(panel, renote ?? null);
  return panel;
}

function setText(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

export function renderExportReceipt(receipt, doc = globalThis.document) {
  const panel = ensureExportReceiptPanel(doc);
  if (!panel) return null;
  const model = buildExportReceiptViewModel(receipt);
  panel.className = `export-receipt-panel is-${model.tone}`;
  setText(doc.getElementById('export-receipt-badge'), model.badge);
  setText(doc.getElementById('export-receipt-summary'), model.title);

  const filename = doc.getElementById('export-receipt-filename');
  if (filename) {
    filename.hidden = !model.filename;
    setText(filename, model.filename ?? '');
  }

  const meta = doc.getElementById('export-receipt-meta');
  if (meta) {
    meta.replaceChildren();
    for (const item of model.meta) appendText(doc, meta, 'span', '', item);
  }

  const entries = doc.getElementById('export-receipt-entries');
  if (entries) {
    entries.replaceChildren();
    entries.hidden = model.entries.length === 0;
    for (const entry of model.entries) {
      const row = doc.createElement('li');
      appendText(doc, row, 'code', '', entry.name);
      appendText(doc, row, 'span', '', entry.sizeLabel);
      entries.appendChild(row);
    }
  }

  setText(doc.getElementById('export-receipt-note'), model.note);
  return panel;
}

let stopSubscription = null;

export function startExportReceiptView({
  documentRef = globalThis.document,
  store = exportReceiptStore,
} = {}) {
  if (!documentRef) return () => {};
  ensureExportReceiptPanel(documentRef);
  if (stopSubscription) stopSubscription();
  stopSubscription = store.subscribe((receipt) => renderExportReceipt(receipt, documentRef));
  return () => {
    stopSubscription?.();
    stopSubscription = null;
  };
}
