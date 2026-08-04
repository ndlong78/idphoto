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
  if (doc.getElementById('image-quality-stylesheet')) return;
  const link = doc.createElement('link');
  link.id = 'image-quality-stylesheet';
  link.rel = 'stylesheet';
  link.href = './image-quality.css';
  doc.head?.appendChild(link);
}

export function buildImageQualityViewModel(result) {
  if (!result) {
    return {
      tone: 'neutral',
      statusLabel: 'Đang chờ phân tích',
      title: 'Chưa có kết quả chất lượng ảnh',
      summary: 'Checker sẽ lấy mẫu ảnh gốc sau khi ảnh và nhận diện khuôn mặt sẵn sàng.',
      counts: { warning: 0, pass: 0, unavailable: 0 },
      checks: [],
      openDetails: false,
      disclaimer: 'Ảnh được phân tích cục bộ trong trình duyệt.',
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

  const hasWarnings = counts.warning > 0;
  return {
    tone: hasWarnings ? 'warning' : 'ok',
    statusLabel: hasWarnings ? `Cần xem lại · ${counts.warning}` : 'Không thấy cảnh báo kỹ thuật',
    title: hasWarnings ? 'Ảnh gốc có điểm cần xem lại' : 'Ảnh gốc chưa có cảnh báo kỹ thuật',
    summary: hasWarnings
      ? `${counts.warning} phép đo đang nằm ngoài vùng hướng dẫn của ứng dụng.`
      : 'Các phép đo hiện có chưa phát hiện vấn đề rõ về pixel, sáng tối, tương phản hoặc độ nét.',
    counts,
    checks,
    openDetails: hasWarnings,
    disclaimer: result.disclaimer,
  };
}

export function ensureImageQualityPanel(doc = globalThis.document) {
  if (!doc) return null;
  ensureStylesheet(doc);

  const existing = doc.getElementById('image-quality-panel');
  if (existing) return existing;

  const controlsRow = doc.querySelector('.controls-row');
  if (!controlsRow?.parentNode) return null;

  const panel = doc.createElement('section');
  panel.id = 'image-quality-panel';
  panel.className = 'image-quality-card';
  panel.setAttribute('aria-labelledby', 'image-quality-title');

  const header = doc.createElement('div');
  header.className = 'image-quality-header';
  const heading = doc.createElement('div');
  heading.className = 'image-quality-heading';
  appendTextElement(doc, heading, 'span', 'image-quality-heading-icon', '◇');
  const headingText = doc.createElement('div');
  appendTextElement(doc, headingText, 'h3', '', 'Chất lượng ảnh gốc');
  appendTextElement(doc, headingText, 'p', '', 'Đo một lần trên ảnh tải lên; không thay đổi khi kéo, zoom hoặc chỉnh màu.');
  heading.appendChild(headingText);

  const status = appendTextElement(doc, header, 'span', 'image-quality-status is-neutral', 'Đang chờ phân tích');
  status.id = 'image-quality-summary-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  header.insertBefore(heading, status);
  panel.appendChild(header);

  const intro = doc.createElement('div');
  intro.className = 'image-quality-intro';
  const introText = doc.createElement('div');
  const title = appendTextElement(doc, introText, 'strong', '', 'Chưa có kết quả chất lượng ảnh');
  title.id = 'image-quality-title';
  const summary = appendTextElement(
    doc,
    introText,
    'p',
    '',
    'Checker sẽ lấy mẫu ảnh gốc sau khi ảnh và nhận diện khuôn mặt sẵn sàng.',
  );
  summary.id = 'image-quality-summary';
  intro.appendChild(introText);
  panel.appendChild(intro);

  const counters = doc.createElement('div');
  counters.id = 'image-quality-counters';
  counters.className = 'image-quality-counters';
  panel.appendChild(counters);

  const details = doc.createElement('details');
  details.id = 'image-quality-details';
  details.className = 'image-quality-details';
  const detailsSummary = doc.createElement('summary');
  detailsSummary.id = 'image-quality-details-summary';
  detailsSummary.textContent = 'Xem chi tiết phép đo';
  details.appendChild(detailsSummary);
  const list = doc.createElement('div');
  list.id = 'image-quality-check-list';
  list.className = 'image-quality-check-list';
  details.appendChild(list);
  panel.appendChild(details);

  const footer = doc.createElement('div');
  footer.className = 'image-quality-footer';
  appendTextElement(doc, footer, 'span', 'image-quality-local', '🔒 Xử lý cục bộ trong trình duyệt');
  const disclaimer = appendTextElement(
    doc,
    footer,
    'p',
    'image-quality-disclaimer',
    'Các phép đo là ước lượng kỹ thuật và không thay thế quyết định của cơ quan tiếp nhận.',
  );
  disclaimer.id = 'image-quality-disclaimer';
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
    item.className = `image-quality-counter is-${status}`;
    appendTextElement(doc, item, 'strong', '', String(counts[status] ?? 0));
    appendTextElement(doc, item, 'span', '', label);
    container.appendChild(item);
  }
}

function renderChecks(doc, container, checks) {
  container.replaceChildren();
  if (checks.length === 0) {
    appendTextElement(doc, container, 'p', 'image-quality-empty', 'Chưa có phép đo để hiển thị.');
    return;
  }

  for (const check of checks) {
    const row = doc.createElement('article');
    row.className = `image-quality-check is-${check.status}`;
    appendTextElement(doc, row, 'span', 'image-quality-check-icon', check.icon);

    const body = doc.createElement('div');
    body.className = 'image-quality-check-body';
    const top = doc.createElement('div');
    top.className = 'image-quality-check-top';
    appendTextElement(doc, top, 'strong', '', check.label || 'Phép đo');
    appendTextElement(doc, top, 'span', 'image-quality-check-state', check.statusLabel);
    if (check.approximate) appendTextElement(doc, top, 'span', 'image-quality-check-approx', 'Ước lượng');
    body.appendChild(top);
    appendTextElement(doc, body, 'p', '', check.message || '');
    row.appendChild(body);
    container.appendChild(row);
  }
}

export function renderImageQualityPanel(result, doc = globalThis.document) {
  const panel = ensureImageQualityPanel(doc);
  if (!panel) return null;

  const model = buildImageQualityViewModel(result);
  const status = doc.getElementById('image-quality-summary-status');
  const title = doc.getElementById('image-quality-title');
  const summary = doc.getElementById('image-quality-summary');
  const counters = doc.getElementById('image-quality-counters');
  const details = doc.getElementById('image-quality-details');
  const detailsSummary = doc.getElementById('image-quality-details-summary');
  const list = doc.getElementById('image-quality-check-list');
  const disclaimer = doc.getElementById('image-quality-disclaimer');

  if (status) {
    status.className = `image-quality-status is-${model.tone}`;
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
