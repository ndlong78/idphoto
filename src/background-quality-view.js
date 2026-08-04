const STATUS_LABELS = Object.freeze({
  pass: 'Không cảnh báo',
  warning: 'Cần xem lại',
  unavailable: 'Chưa đủ dữ liệu',
});

const STATUS_ICONS = Object.freeze({
  pass: '✓',
  warning: '!',
  unavailable: '—',
});

const STATUS_ORDER = Object.freeze({
  warning: 0,
  pass: 1,
  unavailable: 2,
});

function appendTextElement(doc, parent, tag, className, text) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function ensureStylesheet(doc) {
  if (doc.getElementById('background-quality-stylesheet')) return;
  const link = doc.createElement('link');
  link.id = 'background-quality-stylesheet';
  link.rel = 'stylesheet';
  link.href = './background-quality.css';
  doc.head?.appendChild(link);
}

export function buildBackgroundQualityViewModel(result) {
  if (!result) {
    return {
      tone: 'neutral',
      statusLabel: 'Đang chờ phân tích',
      title: 'Chưa có kết quả tách nền',
      summary: 'Checker sẽ phân tích alpha mask sau khi AI tách nền hoàn tất.',
      counts: { warning: 0, pass: 0, unavailable: 0 },
      checks: [],
      openDetails: false,
      disclaimer: 'Ảnh và alpha mask được phân tích cục bộ trong trình duyệt.',
    };
  }

  const counts = { warning: 0, pass: 0, unavailable: 0 };
  const checks = Array.isArray(result.checks)
    ? result.checks.map((check, index) => ({
        ...check,
        _index: index,
        statusLabel: STATUS_LABELS[check.status] ?? 'Chưa xác định',
        icon: STATUS_ICONS[check.status] ?? '?',
      }))
    : [];

  for (const check of checks) {
    if (Object.hasOwn(counts, check.status)) counts[check.status] += 1;
  }
  checks.sort((a, b) => (
    (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)
    || a._index - b._index
  ));

  const unavailable = result.automatedStatus === 'unavailable';
  const hasWarnings = counts.warning > 0;
  if (unavailable) {
    return {
      tone: 'neutral',
      statusLabel: 'Chưa có alpha mask AI',
      title: 'Chưa thể kiểm tra chất lượng tách nền',
      summary: 'Checker này cần alpha mask AI. Ảnh đang dùng Flood Fill vẫn có thể chỉnh sửa nhưng cần phóng to kiểm tra thủ công.',
      counts,
      checks,
      openDetails: false,
      disclaimer: result.disclaimer,
    };
  }

  return {
    tone: hasWarnings ? 'warning' : 'ok',
    statusLabel: hasWarnings ? `Cần xem lại · ${counts.warning}` : 'Không thấy cảnh báo rõ',
    title: hasWarnings ? 'Mask tách nền có điểm cần xem lại' : 'Mask tách nền chưa có cảnh báo rõ',
    summary: hasWarnings
      ? `${counts.warning} phép đo ước lượng cho thấy viền, nền gốc hoặc tính toàn vẹn mask cần được phóng to kiểm tra.`
      : 'Các phép đo hiện có chưa phát hiện lỗi rõ về viền, lỗ thủng, mảnh rời hoặc nền gốc.',
    counts,
    checks,
    openDetails: hasWarnings,
    disclaimer: result.disclaimer,
  };
}

export function ensureBackgroundQualityPanel(doc = globalThis.document) {
  if (!doc) return null;
  ensureStylesheet(doc);

  const existing = doc.getElementById('background-quality-panel');
  if (existing) return existing;

  const controlsRow = doc.querySelector('.controls-row');
  if (!controlsRow?.parentNode) return null;

  const panel = doc.createElement('section');
  panel.id = 'background-quality-panel';
  panel.className = 'background-quality-card';
  panel.setAttribute('aria-labelledby', 'background-quality-title');

  const header = doc.createElement('div');
  header.className = 'background-quality-header';
  const heading = doc.createElement('div');
  heading.className = 'background-quality-heading';
  appendTextElement(doc, heading, 'span', 'background-quality-heading-icon', '◈');
  const headingText = doc.createElement('div');
  appendTextElement(doc, headingText, 'h3', '', 'Chất lượng tách nền');
  appendTextElement(
    doc,
    headingText,
    'p',
    '',
    'Phân tích alpha mask AI và nền gốc; không chạy lại khi kéo, zoom hoặc đổi màu nền.',
  );
  heading.appendChild(headingText);

  const status = appendTextElement(
    doc,
    header,
    'span',
    'background-quality-status is-neutral',
    'Đang chờ phân tích',
  );
  status.id = 'background-quality-summary-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  header.insertBefore(heading, status);
  panel.appendChild(header);

  const intro = doc.createElement('div');
  intro.className = 'background-quality-intro';
  const introText = doc.createElement('div');
  const title = appendTextElement(doc, introText, 'strong', '', 'Chưa có kết quả tách nền');
  title.id = 'background-quality-title';
  const summary = appendTextElement(
    doc,
    introText,
    'p',
    '',
    'Checker sẽ phân tích alpha mask sau khi AI tách nền hoàn tất.',
  );
  summary.id = 'background-quality-summary';
  intro.appendChild(introText);
  panel.appendChild(intro);

  const counters = doc.createElement('div');
  counters.id = 'background-quality-counters';
  counters.className = 'background-quality-counters';
  panel.appendChild(counters);

  const details = doc.createElement('details');
  details.id = 'background-quality-details';
  details.className = 'background-quality-details';
  const detailsSummary = doc.createElement('summary');
  detailsSummary.id = 'background-quality-details-summary';
  detailsSummary.textContent = 'Xem chi tiết phép đo';
  details.appendChild(detailsSummary);
  const list = doc.createElement('div');
  list.id = 'background-quality-check-list';
  list.className = 'background-quality-check-list';
  details.appendChild(list);
  panel.appendChild(details);

  const footer = doc.createElement('div');
  footer.className = 'background-quality-footer';
  appendTextElement(
    doc,
    footer,
    'span',
    'background-quality-local',
    '🔒 Phân tích cục bộ · không tải mask lên server',
  );
  const disclaimer = appendTextElement(
    doc,
    footer,
    'p',
    'background-quality-disclaimer',
    'Các ngưỡng là ước lượng kỹ thuật; hãy phóng to tóc, tai và vai trước khi tải ảnh.',
  );
  disclaimer.id = 'background-quality-disclaimer';
  panel.appendChild(footer);

  const compliancePanel = doc.getElementById('compliance-panel');
  controlsRow.parentNode.insertBefore(panel, compliancePanel ?? controlsRow);
  return panel;
}

function setTextIfChanged(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

function renderCounters(doc, container, counts) {
  container.replaceChildren();
  for (const [status, label] of [
    ['warning', 'Cần xem lại'],
    ['pass', 'Không cảnh báo'],
    ['unavailable', 'Chưa đủ dữ liệu'],
  ]) {
    const item = doc.createElement('div');
    item.className = `background-quality-counter is-${status}`;
    appendTextElement(doc, item, 'strong', '', String(counts[status] ?? 0));
    appendTextElement(doc, item, 'span', '', label);
    container.appendChild(item);
  }
}

function renderChecks(doc, container, checks) {
  container.replaceChildren();
  if (checks.length === 0) {
    appendTextElement(
      doc,
      container,
      'p',
      'background-quality-empty',
      'Chưa có phép đo để hiển thị.',
    );
    return;
  }

  for (const check of checks) {
    const row = doc.createElement('article');
    row.className = `background-quality-check is-${check.status}`;
    appendTextElement(doc, row, 'span', 'background-quality-check-icon', check.icon);

    const body = doc.createElement('div');
    body.className = 'background-quality-check-body';
    const top = doc.createElement('div');
    top.className = 'background-quality-check-top';
    appendTextElement(doc, top, 'strong', '', check.label || 'Phép đo');
    appendTextElement(doc, top, 'span', 'background-quality-check-state', check.statusLabel);
    if (check.approximate) {
      appendTextElement(doc, top, 'span', 'background-quality-check-approx', 'Ước lượng');
    }
    body.appendChild(top);
    appendTextElement(doc, body, 'p', '', check.message || '');
    row.appendChild(body);
    container.appendChild(row);
  }
}

export function renderBackgroundQualityPanel(result, doc = globalThis.document) {
  const panel = ensureBackgroundQualityPanel(doc);
  if (!panel) return null;

  const model = buildBackgroundQualityViewModel(result);
  const status = doc.getElementById('background-quality-summary-status');
  const title = doc.getElementById('background-quality-title');
  const summary = doc.getElementById('background-quality-summary');
  const counters = doc.getElementById('background-quality-counters');
  const details = doc.getElementById('background-quality-details');
  const detailsSummary = doc.getElementById('background-quality-details-summary');
  const list = doc.getElementById('background-quality-check-list');
  const disclaimer = doc.getElementById('background-quality-disclaimer');

  if (status) {
    status.className = `background-quality-status is-${model.tone}`;
    setTextIfChanged(status, model.statusLabel);
  }
  setTextIfChanged(title, model.title);
  setTextIfChanged(summary, model.summary);
  if (counters) renderCounters(doc, counters, model.counts);

  if (details && detailsSummary && list) {
    const userHadOpened = details.open;
    setTextIfChanged(detailsSummary, `Xem chi tiết ${model.checks.length} phép đo`);
    renderChecks(doc, list, model.checks);
    details.open = model.openDetails || userHadOpened;
  }
  setTextIfChanged(disclaimer, model.disclaimer);
  return panel;
}
