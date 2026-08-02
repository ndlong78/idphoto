const STATUS_LABELS = Object.freeze({
  pass: 'Không cảnh báo',
  warning: 'Cần xem lại',
  manual: 'Kiểm tra thủ công',
  unavailable: 'Chưa đủ dữ liệu',
});

const STATUS_ICONS = Object.freeze({
  pass: '✓',
  warning: '!',
  manual: '👁',
  unavailable: '—',
});

const STATUS_ORDER = Object.freeze({
  warning: 0,
  pass: 1,
  unavailable: 2,
  manual: 3,
});

function finite(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

function compactBox(box) {
  if (!box) return null;
  return {
    x: finite(box.x),
    y: finite(box.y),
    width: finite(box.width ?? box.w),
    height: finite(box.height ?? box.h),
  };
}

/**
 * Tạo chữ ký chỉ từ dữ liệu hình học ảnh.
 * Các thay đổi màu nền, độ sáng hoặc làm mịn da không làm checker chạy lại.
 *
 * @param {object} snapshot
 * @returns {string}
 */
export function getComplianceGeometrySignature(snapshot) {
  return JSON.stringify({
    section: snapshot?.section ?? null,
    format: snapshot?.curFmt ?? null,
    image: snapshot?.origImg
      ? { width: finite(snapshot.origImg.width), height: finite(snapshot.origImg.height) }
      : null,
    face: snapshot?.faceData
      ? {
          count: Number.isInteger(snapshot.faceData.faceCount) ? snapshot.faceData.faceCount : null,
          score: finite(snapshot.faceData.score),
          box: compactBox(snapshot.faceData.box),
          headBox: compactBox(snapshot.faceData.headBox),
          eyeLineY: finite(snapshot.faceData.eyeLineY),
        }
      : null,
    frame: compactBox(snapshot?.frame),
    crop: snapshot?.crop
      ? {
          x: finite(snapshot.crop.x),
          y: finite(snapshot.crop.y),
          scale: finite(snapshot.crop.scale),
        }
      : null,
    resultOffsetPct: snapshot?.resultFaceOffsetPct
      ? {
          x: finite(snapshot.resultFaceOffsetPct.x),
          y: finite(snapshot.resultFaceOffsetPct.y),
        }
      : null,
  });
}

/**
 * Chuyển compliance result thành model hiển thị, không phụ thuộc DOM.
 *
 * @param {object|null} result
 */
export function buildComplianceViewModel(result) {
  if (!result) {
    return {
      tone: 'neutral',
      statusLabel: 'Đang chờ dữ liệu',
      title: 'Chưa có kết quả kiểm tra',
      summary: 'Checker sẽ cập nhật sau khi ảnh và bố cục sẵn sàng.',
      counts: { warning: 0, pass: 0, manual: 0, unavailable: 0 },
      checks: [],
      sourceUrl: null,
      disclaimer: 'Kết quả chỉ hỗ trợ căn chỉnh và không thay thế quyết định của cơ quan tiếp nhận.',
      openDetails: false,
    };
  }

  const counts = { warning: 0, pass: 0, manual: 0, unavailable: 0 };
  const checks = Array.isArray(result.checks) ? result.checks.map((check, index) => ({
    ...check,
    _index: index,
    statusLabel: STATUS_LABELS[check.status] ?? 'Chưa xác định',
    icon: STATUS_ICONS[check.status] ?? '?',
  })) : [];

  for (const check of checks) {
    if (Object.hasOwn(counts, check.status)) counts[check.status] += 1;
  }

  checks.sort((a, b) => {
    const orderA = STATUS_ORDER[a.status] ?? 99;
    const orderB = STATUS_ORDER[b.status] ?? 99;
    return orderA - orderB || a._index - b._index;
  });

  const hasWarnings = counts.warning > 0;
  const hasAutomaticEvidence = counts.pass > 0 || counts.warning > 0;
  let tone = 'neutral';
  let statusLabel = 'Chưa đủ dữ liệu tự động';
  let title = 'Cần kiểm tra thêm';
  let summary = 'Một số tiêu chí chưa có đủ dữ liệu để đánh giá tự động.';

  if (hasWarnings) {
    tone = 'warning';
    statusLabel = `Cần xem lại · ${counts.warning}`;
    title = 'Bố cục có điểm cần xem lại';
    summary = `${counts.warning} tiêu chí tự động đang nằm ngoài vùng khuyến nghị của checker.`;
  } else if (hasAutomaticEvidence) {
    tone = 'ok';
    statusLabel = 'Không thấy cảnh báo tự động';
    title = 'Bố cục hiện không có cảnh báo tự động';
    summary = 'Các phép đo có dữ liệu hiện chưa phát hiện điểm nằm ngoài vùng cảnh báo.';
  }

  return {
    tone,
    statusLabel,
    title,
    summary,
    counts,
    checks,
    sourceUrl: typeof result.sourceUrl === 'string' ? result.sourceUrl : null,
    disclaimer: result.disclaimer
      || 'Kết quả chỉ hỗ trợ căn chỉnh và không thay thế quyết định của cơ quan tiếp nhận.',
    openDetails: hasWarnings,
  };
}

function appendTextElement(doc, parent, tag, className, text) {
  const el = doc.createElement(tag);
  if (className) el.className = className;
  el.textContent = text;
  parent.appendChild(el);
  return el;
}

function ensureStylesheet(doc) {
  if (doc.getElementById('compliance-stylesheet')) return;
  const link = doc.createElement('link');
  link.id = 'compliance-stylesheet';
  link.rel = 'stylesheet';
  link.href = './compliance.css';
  doc.head?.appendChild(link);
}

/**
 * Tạo panel checker bên dưới khu vực ảnh trước/sau.
 *
 * @param {Document} doc
 * @returns {HTMLElement|null}
 */
export function ensureCompliancePanel(doc = globalThis.document) {
  if (!doc) return null;
  ensureStylesheet(doc);

  const existing = doc.getElementById('compliance-panel');
  if (existing) return existing;

  const controlsRow = doc.querySelector('.controls-row');
  if (!controlsRow?.parentNode) return null;

  const panel = doc.createElement('section');
  panel.id = 'compliance-panel';
  panel.className = 'compliance-card';
  panel.setAttribute('aria-labelledby', 'compliance-title');

  const header = doc.createElement('div');
  header.className = 'compliance-header';

  const headingWrap = doc.createElement('div');
  headingWrap.className = 'compliance-heading';
  appendTextElement(doc, headingWrap, 'span', 'compliance-heading-icon', '◎');
  const headingText = doc.createElement('div');
  appendTextElement(doc, headingText, 'h3', '', 'Kiểm tra bố cục ảnh');
  appendTextElement(doc, headingText, 'p', '', 'Cập nhật tự động khi bạn kéo, zoom hoặc đổi kích thước.');
  headingWrap.appendChild(headingText);

  const status = appendTextElement(doc, header, 'span', 'compliance-status is-neutral', 'Đang chờ dữ liệu');
  status.id = 'compliance-summary-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  header.insertBefore(headingWrap, status);
  panel.appendChild(header);

  const intro = doc.createElement('div');
  intro.className = 'compliance-intro';
  const introText = doc.createElement('div');
  const title = appendTextElement(doc, introText, 'strong', '', 'Chưa có kết quả kiểm tra');
  title.id = 'compliance-title';
  const summary = appendTextElement(doc, introText, 'p', '', 'Checker sẽ cập nhật sau khi ảnh và bố cục sẵn sàng.');
  summary.id = 'compliance-summary';
  intro.appendChild(introText);
  panel.appendChild(intro);

  const counters = doc.createElement('div');
  counters.id = 'compliance-counters';
  counters.className = 'compliance-counters';
  panel.appendChild(counters);

  const details = doc.createElement('details');
  details.id = 'compliance-details';
  details.className = 'compliance-details';
  const detailsSummary = doc.createElement('summary');
  detailsSummary.id = 'compliance-details-summary';
  detailsSummary.textContent = 'Xem chi tiết tiêu chí';
  details.appendChild(detailsSummary);
  const list = doc.createElement('div');
  list.id = 'compliance-check-list';
  list.className = 'compliance-check-list';
  details.appendChild(list);
  panel.appendChild(details);

  const footer = doc.createElement('div');
  footer.className = 'compliance-footer';
  const source = appendTextElement(doc, footer, 'a', 'compliance-source', 'Xem nguồn quy định');
  source.id = 'compliance-source';
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  source.hidden = true;
  const disclaimer = appendTextElement(
    doc,
    footer,
    'p',
    'compliance-disclaimer',
    'Kết quả chỉ hỗ trợ căn chỉnh và không thay thế quyết định của cơ quan tiếp nhận.',
  );
  disclaimer.id = 'compliance-disclaimer';
  panel.appendChild(footer);

  controlsRow.parentNode.insertBefore(panel, controlsRow);
  return panel;
}

function setTextIfChanged(el, value) {
  if (el && el.textContent !== value) el.textContent = value;
}

function renderCounters(doc, container, counts) {
  container.replaceChildren();
  const items = [
    ['warning', 'Cần xem lại'],
    ['pass', 'Không cảnh báo'],
    ['manual', 'Thủ công'],
    ['unavailable', 'Chưa đủ dữ liệu'],
  ];
  for (const [status, label] of items) {
    const item = doc.createElement('div');
    item.className = `compliance-counter is-${status}`;
    appendTextElement(doc, item, 'strong', '', String(counts[status] ?? 0));
    appendTextElement(doc, item, 'span', '', label);
    container.appendChild(item);
  }
}

function renderChecks(doc, container, checks) {
  container.replaceChildren();
  if (checks.length === 0) {
    appendTextElement(doc, container, 'p', 'compliance-empty', 'Chưa có tiêu chí để hiển thị.');
    return;
  }

  for (const check of checks) {
    const row = doc.createElement('article');
    row.className = `compliance-check is-${check.status}`;

    appendTextElement(doc, row, 'span', 'compliance-check-icon', check.icon);

    const body = doc.createElement('div');
    body.className = 'compliance-check-body';
    const top = doc.createElement('div');
    top.className = 'compliance-check-top';
    appendTextElement(doc, top, 'strong', '', check.label || 'Tiêu chí');
    appendTextElement(doc, top, 'span', 'compliance-check-state', check.statusLabel);
    if (check.approximate) {
      appendTextElement(doc, top, 'span', 'compliance-check-approx', 'Ước lượng');
    }
    body.appendChild(top);
    appendTextElement(doc, body, 'p', '', check.message || '');
    row.appendChild(body);
    container.appendChild(row);
  }
}

/**
 * Render model compliance vào panel.
 *
 * @param {object|null} result
 * @param {Document} doc
 */
export function renderCompliancePanel(result, doc = globalThis.document) {
  const panel = ensureCompliancePanel(doc);
  if (!panel) return null;

  const model = buildComplianceViewModel(result);
  const status = doc.getElementById('compliance-summary-status');
  const title = doc.getElementById('compliance-title');
  const summary = doc.getElementById('compliance-summary');
  const counters = doc.getElementById('compliance-counters');
  const details = doc.getElementById('compliance-details');
  const detailsSummary = doc.getElementById('compliance-details-summary');
  const checkList = doc.getElementById('compliance-check-list');
  const source = doc.getElementById('compliance-source');
  const disclaimer = doc.getElementById('compliance-disclaimer');

  if (status) {
    status.className = `compliance-status is-${model.tone}`;
    setTextIfChanged(status, model.statusLabel);
  }
  setTextIfChanged(title, model.title);
  setTextIfChanged(summary, model.summary);
  if (counters) renderCounters(doc, counters, model.counts);

  if (details && detailsSummary && checkList) {
    const userHadOpened = details.open;
    setTextIfChanged(detailsSummary, `Xem chi tiết ${model.checks.length} tiêu chí`);
    renderChecks(doc, checkList, model.checks);
    details.open = model.openDetails || userHadOpened;
  }

  if (source) {
    source.hidden = !model.sourceUrl;
    if (model.sourceUrl) source.href = model.sourceUrl;
    else source.removeAttribute('href');
  }
  setTextIfChanged(disclaimer, model.disclaimer);

  return panel;
}
