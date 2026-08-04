let pendingConfirmation = null;

function appendText(doc, parent, tag, className, text) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function ensureStylesheet(doc) {
  if (doc.getElementById('export-readiness-stylesheet')) return;
  const link = doc.createElement('link');
  link.id = 'export-readiness-stylesheet';
  link.rel = 'stylesheet';
  link.href = './export-readiness.css';
  doc.head?.appendChild(link);
}

export function buildExportReadinessViewModel(readiness) {
  if (!readiness) {
    return {
      tone: 'neutral',
      statusLabel: 'Đang chờ kiểm tra',
      title: 'Chưa có kết quả kiểm tra cuối',
      summary: 'Bước kiểm tra cuối sẽ tổng hợp các checker trước khi tải xuống.',
      warningCount: 0,
      manualCount: 0,
      requiresConfirmation: true,
    };
  }
  return {
    tone: readiness.tone,
    statusLabel: readiness.statusLabel,
    title: readiness.title,
    summary: readiness.summary,
    warningCount: readiness.counts?.warning ?? 0,
    manualCount: readiness.counts?.manual ?? 0,
    requiresConfirmation: Boolean(readiness.requiresConfirmation),
  };
}

export function ensureExportReadinessPanel(doc = globalThis.document) {
  if (!doc) return null;
  ensureStylesheet(doc);
  const existing = doc.getElementById('export-readiness-panel');
  if (existing) return existing;

  const downloadCard = doc.querySelector('.ctrl-dl');
  if (!downloadCard) return null;

  const panel = doc.createElement('section');
  panel.id = 'export-readiness-panel';
  panel.className = 'export-readiness-panel is-neutral';
  panel.setAttribute('aria-labelledby', 'export-readiness-title');

  const top = doc.createElement('div');
  top.className = 'export-readiness-top';
  const heading = appendText(doc, top, 'strong', '', 'Kiểm tra cuối');
  heading.id = 'export-readiness-title';
  const status = appendText(doc, top, 'span', 'export-readiness-status', 'Đang chờ kiểm tra');
  status.id = 'export-readiness-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  panel.appendChild(top);

  const summary = appendText(
    doc,
    panel,
    'p',
    'export-readiness-summary',
    'Bước kiểm tra cuối sẽ tổng hợp các checker trước khi tải xuống.',
  );
  summary.id = 'export-readiness-summary';

  const counters = doc.createElement('div');
  counters.className = 'export-readiness-counters';
  const warning = appendText(doc, counters, 'span', '', '0 cảnh báo');
  warning.id = 'export-readiness-warning-count';
  const manual = appendText(doc, counters, 'span', '', '0 thủ công');
  manual.id = 'export-readiness-manual-count';
  panel.appendChild(counters);

  const note = appendText(
    doc,
    panel,
    'small',
    'export-readiness-note',
    'Cảnh báo không khóa cứng việc tải; bạn có thể xác nhận để tiếp tục.',
  );
  note.id = 'export-readiness-note';

  const renote = downloadCard.querySelector('#renote');
  downloadCard.insertBefore(panel, renote ?? null);
  return panel;
}

function setText(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

export function renderExportReadinessPanel(readiness, doc = globalThis.document) {
  const panel = ensureExportReadinessPanel(doc);
  if (!panel) return null;
  const model = buildExportReadinessViewModel(readiness);
  panel.className = `export-readiness-panel is-${model.tone}`;
  setText(doc.getElementById('export-readiness-status'), model.statusLabel);
  setText(doc.getElementById('export-readiness-summary'), model.summary);
  setText(doc.getElementById('export-readiness-warning-count'), `${model.warningCount} cảnh báo`);
  setText(doc.getElementById('export-readiness-manual-count'), `${model.manualCount} thủ công`);
  setText(
    doc.getElementById('export-readiness-note'),
    model.requiresConfirmation
      ? 'Nút tải sẽ mở bước xác nhận; ảnh vẫn có thể được tải xuống.'
      : 'Không cần xác nhận thêm; nút tải sẽ hoạt động ngay.',
  );
  return panel;
}

function ensureDialog(doc) {
  ensureStylesheet(doc);
  const existing = doc.getElementById('export-readiness-dialog');
  if (existing) return existing;

  const dialog = doc.createElement('dialog');
  dialog.id = 'export-readiness-dialog';
  dialog.className = 'export-readiness-dialog';
  dialog.setAttribute('aria-labelledby', 'export-readiness-dialog-title');
  dialog.setAttribute('aria-describedby', 'export-readiness-dialog-summary');

  const card = doc.createElement('div');
  card.className = 'export-readiness-dialog-card';
  const header = doc.createElement('header');
  appendText(doc, header, 'span', 'export-readiness-dialog-icon', '!');
  const headerText = doc.createElement('div');
  const title = appendText(doc, headerText, 'h2', '', 'Kiểm tra lại trước khi tải');
  title.id = 'export-readiness-dialog-title';
  const summary = appendText(doc, headerText, 'p', '', 'Ảnh còn điểm cần xác nhận.');
  summary.id = 'export-readiness-dialog-summary';
  header.appendChild(headerText);
  card.appendChild(header);

  const scope = doc.createElement('div');
  scope.id = 'export-readiness-dialog-scope';
  scope.className = 'export-readiness-dialog-scope';
  scope.hidden = true;
  card.appendChild(scope);

  const warningSection = doc.createElement('section');
  warningSection.id = 'export-readiness-dialog-warning-section';
  appendText(doc, warningSection, 'h3', '', 'Cảnh báo tự động');
  const warningList = doc.createElement('ul');
  warningList.id = 'export-readiness-dialog-warnings';
  warningSection.appendChild(warningList);
  card.appendChild(warningSection);

  const missingSection = doc.createElement('section');
  missingSection.id = 'export-readiness-dialog-missing-section';
  appendText(doc, missingSection, 'h3', '', 'Dữ liệu chưa kiểm tra được');
  const missingList = doc.createElement('ul');
  missingList.id = 'export-readiness-dialog-missing';
  missingSection.appendChild(missingList);
  card.appendChild(missingSection);

  const manualSection = doc.createElement('details');
  manualSection.id = 'export-readiness-dialog-manual-section';
  const manualSummary = appendText(doc, manualSection, 'summary', '', 'Checklist thủ công');
  manualSummary.id = 'export-readiness-dialog-manual-summary';
  const manualList = doc.createElement('ul');
  manualList.id = 'export-readiness-dialog-manual';
  manualSection.appendChild(manualList);
  card.appendChild(manualSection);

  const disclaimer = appendText(doc, card, 'p', 'export-readiness-dialog-disclaimer', '');
  disclaimer.id = 'export-readiness-dialog-disclaimer';

  const actions = doc.createElement('footer');
  const cancel = appendText(doc, actions, 'button', 'export-readiness-cancel', 'Quay lại chỉnh sửa');
  cancel.type = 'button';
  cancel.dataset.action = 'cancel';
  const proceed = appendText(doc, actions, 'button', 'export-readiness-proceed', 'Vẫn tải xuống');
  proceed.type = 'button';
  proceed.dataset.action = 'proceed';
  card.appendChild(actions);
  dialog.appendChild(card);
  doc.body?.appendChild(dialog);
  return dialog;
}

function renderList(doc, list, items, emptyText) {
  list.replaceChildren();
  if (!items.length) {
    appendText(doc, list, 'li', 'is-empty', emptyText);
    return;
  }
  for (const item of items) {
    const row = doc.createElement('li');
    appendText(doc, row, 'strong', '', `${item.sectionLabel}: ${item.label}`);
    appendText(doc, row, 'span', '', item.message);
    list.appendChild(row);
  }
}

function renderDialog(readiness, doc, dialog) {
  setText(doc.getElementById('export-readiness-dialog-summary'), readiness.summary);
  setText(doc.getElementById('export-readiness-dialog-disclaimer'), readiness.disclaimer);

  const scope = doc.getElementById('export-readiness-dialog-scope');
  if (scope) {
    scope.replaceChildren();
    scope.hidden = !readiness.scopeNotice;
    if (readiness.scopeNotice) {
      appendText(doc, scope, 'strong', '', 'Phạm vi preset');
      appendText(doc, scope, 'p', '', readiness.scopeNotice);
      if (readiness.sourceUrl) {
        const link = appendText(doc, scope, 'a', '', 'Xem nguồn quy định');
        link.href = readiness.sourceUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    }
  }

  const warnings = doc.getElementById('export-readiness-dialog-warnings');
  const warningSection = doc.getElementById('export-readiness-dialog-warning-section');
  if (warnings && warningSection) {
    warningSection.hidden = readiness.warnings.length === 0;
    renderList(doc, warnings, readiness.warnings, 'Không có cảnh báo tự động.');
  }

  const missingItems = readiness.missingSections.map((section) => ({
    sectionLabel: section.label,
    label: 'Chưa có kết quả',
    message: 'Checker chưa tạo được kết quả cho nhóm này.',
  }));
  if (readiness.backgroundUnavailable) {
    missingItems.push({
      sectionLabel: 'Chất lượng tách nền',
      label: 'Không có alpha mask AI',
      message: 'Ảnh đang dùng chế độ suy giảm; cần kiểm tra thủ công tóc, tai, vai và viền nền.',
    });
  }
  const missing = doc.getElementById('export-readiness-dialog-missing');
  const missingSection = doc.getElementById('export-readiness-dialog-missing-section');
  if (missing && missingSection) {
    missingSection.hidden = missingItems.length === 0;
    renderList(doc, missing, missingItems, 'Không có dữ liệu bị thiếu.');
  }

  const manual = doc.getElementById('export-readiness-dialog-manual');
  const manualSection = doc.getElementById('export-readiness-dialog-manual-section');
  const manualSummary = doc.getElementById('export-readiness-dialog-manual-summary');
  if (manual && manualSection && manualSummary) {
    setText(manualSummary, `Checklist thủ công · ${readiness.manualItems.length}`);
    manualSection.hidden = readiness.manualItems.length === 0;
    renderList(doc, manual, readiness.manualItems, 'Không có checklist thủ công.');
  }
  return dialog;
}

function openDialog(dialog) {
  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.hidden = false;
    dialog.setAttribute('open', '');
    dialog.classList.add('is-fallback-open');
  }
}

function closeDialog(dialog, value, doc) {
  if (typeof dialog.close === 'function') {
    dialog.close(value);
  } else {
    dialog.returnValue = value;
    dialog.hidden = true;
    dialog.removeAttribute('open');
    dialog.classList.remove('is-fallback-open');
    const EventConstructor = doc.defaultView?.Event ?? globalThis.Event;
    dialog.dispatchEvent(new EventConstructor('close'));
  }
}

export function confirmExportReadiness(readiness, doc = globalThis.document) {
  if (!readiness?.requiresConfirmation) return Promise.resolve(true);
  if (!doc) return Promise.resolve(false);
  if (pendingConfirmation) return pendingConfirmation;

  const dialog = renderDialog(readiness, doc, ensureDialog(doc));
  const cancelButton = dialog.querySelector('[data-action="cancel"]');
  const proceedButton = dialog.querySelector('[data-action="proceed"]');

  pendingConfirmation = new Promise((resolve) => {
    const cleanup = () => {
      dialog.onclose = null;
      dialog.oncancel = null;
      if (cancelButton) cancelButton.onclick = null;
      if (proceedButton) proceedButton.onclick = null;
    };
    const settle = (allowed) => {
      cleanup();
      pendingConfirmation = null;
      resolve(allowed);
    };

    dialog.onclose = () => settle(dialog.returnValue === 'proceed');
    dialog.oncancel = (event) => {
      event.preventDefault();
      closeDialog(dialog, 'cancel', doc);
    };
    if (cancelButton) cancelButton.onclick = () => closeDialog(dialog, 'cancel', doc);
    if (proceedButton) proceedButton.onclick = () => closeDialog(dialog, 'proceed', doc);

    try {
      openDialog(dialog);
    } catch {
      settle(false);
    }
  });
  return pendingConfirmation;
}
