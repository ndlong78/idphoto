function appendText(doc, parent, tag, className, text) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function ensureStylesheet(doc) {
  if (doc.getElementById('manual-review-stylesheet')) return;
  const link = doc.createElement('link');
  link.id = 'manual-review-stylesheet';
  link.rel = 'stylesheet';
  link.href = './manual-review.css';
  doc.head?.appendChild(link);
}

export function ensureManualReviewPanel(doc = globalThis.document) {
  if (!doc) return null;
  ensureStylesheet(doc);
  const existing = doc.getElementById('manual-review-panel');
  if (existing) return existing;

  const downloadCard = doc.querySelector('.ctrl-dl');
  if (!downloadCard) return null;

  const panel = doc.createElement('section');
  panel.id = 'manual-review-panel';
  panel.className = 'manual-review-panel';
  panel.setAttribute('aria-labelledby', 'manual-review-title');

  const top = doc.createElement('div');
  top.className = 'manual-review-top';
  const heading = appendText(doc, top, 'strong', '', 'Checklist & audit');
  heading.id = 'manual-review-title';
  const status = appendText(doc, top, 'span', 'manual-review-status', '0/0 đã đối chiếu');
  status.id = 'manual-review-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  panel.appendChild(top);

  const intro = appendText(
    doc,
    panel,
    'p',
    'manual-review-intro',
    'Đánh dấu sau khi bạn đã tự đọc và đối chiếu từng yêu cầu thủ công.',
  );
  intro.id = 'manual-review-intro';

  const toolbar = doc.createElement('div');
  toolbar.className = 'manual-review-toolbar';
  const markAll = appendText(doc, toolbar, 'button', '', 'Đánh dấu tất cả');
  markAll.type = 'button';
  markAll.dataset.action = 'mark-all';
  const clearAll = appendText(doc, toolbar, 'button', '', 'Bỏ chọn');
  clearAll.type = 'button';
  clearAll.dataset.action = 'clear-all';
  panel.appendChild(toolbar);

  const list = doc.createElement('div');
  list.id = 'manual-review-list';
  list.className = 'manual-review-list';
  panel.appendChild(list);

  const auditLabel = doc.createElement('label');
  auditLabel.className = 'manual-review-audit-toggle';
  const auditInput = doc.createElement('input');
  auditInput.type = 'checkbox';
  auditInput.id = 'manual-review-audit-enabled';
  auditInput.dataset.action = 'audit-toggle';
  auditLabel.appendChild(auditInput);
  const auditText = doc.createElement('span');
  appendText(doc, auditText, 'strong', '', 'Tải kèm bản kiểm tra JSON');
  appendText(
    doc,
    auditText,
    'small',
    '',
    'Không chứa ảnh, tọa độ khuôn mặt hoặc tên file gốc. Trình duyệt có thể hỏi quyền tải nhiều file.',
  );
  auditLabel.appendChild(auditText);
  panel.appendChild(auditLabel);

  const disclaimer = appendText(
    doc,
    panel,
    'small',
    'manual-review-disclaimer',
    'Dấu chọn chỉ ghi nhận bạn đã tự đối chiếu; không phải chứng nhận ảnh hợp lệ.',
  );
  disclaimer.id = 'manual-review-disclaimer';

  const readinessPanel = downloadCard.querySelector('#export-readiness-panel');
  const renote = downloadCard.querySelector('#renote');
  if (readinessPanel?.nextSibling) downloadCard.insertBefore(panel, readinessPanel.nextSibling);
  else downloadCard.insertBefore(panel, renote ?? null);
  return panel;
}

function setText(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

function createChecklistRow(doc, item) {
  const label = doc.createElement('label');
  label.className = `manual-review-item${item.reviewed ? ' is-reviewed' : ''}`;
  const input = doc.createElement('input');
  input.type = 'checkbox';
  input.checked = Boolean(item.reviewed);
  input.dataset.reviewKey = item.reviewKey;
  input.setAttribute('aria-label', `Đã tự đối chiếu: ${item.label}`);
  label.appendChild(input);

  const text = doc.createElement('span');
  appendText(doc, text, 'strong', '', item.label);
  appendText(doc, text, 'small', '', item.message || item.sectionLabel || 'Yêu cầu kiểm tra thủ công.');
  label.appendChild(text);
  return label;
}

export function renderManualReviewPanel(
  readiness,
  { auditEnabled = false } = {},
  doc = globalThis.document,
) {
  const panel = ensureManualReviewPanel(doc);
  if (!panel) return null;

  const items = Array.isArray(readiness?.manualItems) ? readiness.manualItems : [];
  const reviewed = items.filter((item) => item.reviewed).length;
  setText(doc.getElementById('manual-review-status'), `${reviewed}/${items.length} đã đối chiếu`);
  setText(
    doc.getElementById('manual-review-intro'),
    items.length
      ? 'Đánh dấu sau khi bạn đã tự đọc và đối chiếu từng yêu cầu thủ công.'
      : 'Preset này không có checklist thủ công trong registry hiện tại.',
  );

  const list = doc.getElementById('manual-review-list');
  if (list) {
    list.replaceChildren();
    if (!items.length) {
      appendText(doc, list, 'p', 'manual-review-empty', 'Không có mục cần đánh dấu.');
    } else {
      for (const item of items) list.appendChild(createChecklistRow(doc, item));
    }
  }

  const markAll = panel.querySelector('[data-action="mark-all"]');
  const clearAll = panel.querySelector('[data-action="clear-all"]');
  if (markAll) markAll.disabled = !items.length || reviewed === items.length;
  if (clearAll) clearAll.disabled = !items.length || reviewed === 0;
  const auditInput = doc.getElementById('manual-review-audit-enabled');
  if (auditInput) auditInput.checked = Boolean(auditEnabled);
  return panel;
}

export function bindManualReviewPanel({
  documentRef = globalThis.document,
  onToggle = () => {},
  onToggleAll = () => {},
  onAuditPreference = () => {},
} = {}) {
  const panel = ensureManualReviewPanel(documentRef);
  if (!panel || panel.dataset.bound === 'true') return panel;
  panel.dataset.bound = 'true';

  panel.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof documentRef.defaultView.HTMLInputElement)) return;
    if (target.dataset.reviewKey) {
      onToggle({ reviewKey: target.dataset.reviewKey, reviewed: target.checked });
      return;
    }
    if (target.dataset.action === 'audit-toggle') {
      onAuditPreference({ enabled: target.checked });
    }
  });

  panel.addEventListener('click', (event) => {
    const button = event.target.closest?.('button[data-action]');
    if (!button) return;
    if (button.dataset.action === 'mark-all') onToggleAll({ reviewed: true });
    if (button.dataset.action === 'clear-all') onToggleAll({ reviewed: false });
  });
  return panel;
}
