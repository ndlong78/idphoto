import { buildManualReviewChecklist } from './manual-review.js';

const SECTION_DEFINITIONS = Object.freeze([
  Object.freeze({ key: 'image-quality', label: 'Chất lượng ảnh gốc', resultKey: 'imageQualityResult' }),
  Object.freeze({ key: 'background-quality', label: 'Chất lượng tách nền', resultKey: 'backgroundQualityResult' }),
  Object.freeze({ key: 'composition', label: 'Bố cục hồ sơ', resultKey: 'complianceResult' }),
]);

const SCOPE_CONFIRMATION_LEVELS = new Set([
  'generic',
  'reference-only',
  'not-supported-as-official-output',
]);

function normalizeChecks(result) {
  return Array.isArray(result?.checks) ? result.checks : [];
}

function mapCheck(section, check) {
  return {
    sectionKey: section.key,
    sectionLabel: section.label,
    id: check.id ?? 'unknown',
    label: check.label ?? 'Tiêu chí',
    message: check.message ?? '',
    status: check.status ?? 'unavailable',
    approximate: Boolean(check.approximate),
  };
}

function buildSection(section, result) {
  const checks = normalizeChecks(result).map((check) => mapCheck(section, check));
  return {
    key: section.key,
    label: section.label,
    available: Boolean(result),
    automatedStatus: result?.automatedStatus ?? null,
    warnings: checks.filter((check) => check.status === 'warning'),
    manual: checks.filter((check) => check.status === 'manual'),
    unavailable: checks.filter((check) => check.status === 'unavailable'),
    checks,
  };
}

export function buildExportReadiness({
  imageQualityResult = null,
  backgroundQualityResult = null,
  complianceResult = null,
  profile = null,
  manualReviewCompletedKeys = null,
} = {}) {
  const source = { imageQualityResult, backgroundQualityResult, complianceResult };
  const sections = SECTION_DEFINITIONS.map((section) => buildSection(section, source[section.resultKey]));
  const warnings = sections.flatMap((section) => section.warnings);
  const rawManualItems = sections.flatMap((section) => section.manual);
  const unavailableItems = sections.flatMap((section) => section.unavailable);
  const missingSections = sections.filter((section) => !section.available);
  const manualReviewTrackingEnabled = manualReviewCompletedKeys !== null;
  const manualReview = buildManualReviewChecklist(
    rawManualItems,
    manualReviewTrackingEnabled ? manualReviewCompletedKeys : new Set(),
  );
  const manualItems = manualReviewTrackingEnabled
    ? manualReview.items
    : manualReview.items.map((item) => ({ ...item, reviewed: false }));

  const supportLevel = profile?.supportLevel ?? 'generic';
  const scopeRequiresConfirmation = SCOPE_CONFIRMATION_LEVELS.has(supportLevel);
  const backgroundUnavailable = backgroundQualityResult?.automatedStatus === 'unavailable';
  const missingCriticalResult = missingSections.length > 0;
  const manualReviewIncomplete = manualReviewTrackingEnabled && manualReview.counts.pending > 0;
  const requiresConfirmation = (
    warnings.length > 0
    || scopeRequiresConfirmation
    || backgroundUnavailable
    || missingCriticalResult
    || manualReviewIncomplete
  );

  let tone = 'ready';
  let statusLabel = 'Sẵn sàng tải';
  let title = 'Không thấy cảnh báo tự động';
  let summary = 'Các checker hiện có chưa phát hiện vấn đề cần xác nhận trước khi tải.';

  if (requiresConfirmation) {
    tone = 'review';
    statusLabel = `Cần xác nhận · ${warnings.length}`;
    title = 'Kiểm tra lại trước khi tải';
    const reasons = [];
    if (warnings.length > 0) reasons.push(`${warnings.length} cảnh báo tự động`);
    if (manualReviewIncomplete) reasons.push(`${manualReview.counts.pending} mục thủ công chưa đối chiếu`);
    if (backgroundUnavailable) reasons.push('chưa kiểm tra được alpha mask AI');
    if (missingCriticalResult) reasons.push(`${missingSections.length} nhóm chưa có kết quả`);
    if (scopeRequiresConfirmation) reasons.push('preset có giới hạn phạm vi sử dụng');
    summary = `${reasons.join(', ')}. Bạn vẫn có thể tải xuống sau khi xác nhận.`;
  } else if (manualItems.length > 0) {
    tone = 'manual';
    if (manualReviewTrackingEnabled && manualReview.allReviewed) {
      statusLabel = `Đã đối chiếu · ${manualReview.counts.reviewed}/${manualReview.counts.total}`;
      title = 'Checklist thủ công đã được đánh dấu';
      summary = 'Không thấy cảnh báo tự động. Dấu chọn chỉ ghi nhận bạn đã tự đối chiếu các yêu cầu thủ công.';
    } else {
      statusLabel = `Kiểm tra thủ công · ${manualItems.length}`;
      title = 'Có checklist cần tự đối chiếu';
      summary = 'Không thấy cảnh báo tự động, nhưng vẫn cần kiểm tra các yêu cầu không thể đo bằng phần mềm.';
    }
  }

  return {
    formatKey: complianceResult?.formatKey ?? profile?.key ?? null,
    profileKey: complianceResult?.profileKey ?? profile?.key ?? null,
    supportLevel,
    sourceUrl: profile?.sourceUrl ?? complianceResult?.sourceUrl ?? null,
    scopeNotice: profile?.scopeNotice ?? null,
    tone,
    statusLabel,
    title,
    summary,
    requiresConfirmation,
    scopeRequiresConfirmation,
    backgroundUnavailable,
    missingCriticalResult,
    manualReviewTrackingEnabled,
    manualReviewIncomplete,
    counts: {
      warning: warnings.length,
      manual: manualItems.length,
      manualReviewed: manualReviewTrackingEnabled ? manualReview.counts.reviewed : 0,
      manualPending: manualReviewTrackingEnabled ? manualReview.counts.pending : manualItems.length,
      unavailable: unavailableItems.length,
      missingSections: missingSections.length,
    },
    warnings,
    manualItems,
    unavailableItems,
    missingSections: missingSections.map((section) => ({ key: section.key, label: section.label })),
    sections,
    disclaimer: 'Bước kiểm tra cuối chỉ tổng hợp cảnh báo kỹ thuật, checklist tự đối chiếu và phạm vi profile; quyết định chấp nhận ảnh thuộc cơ quan tiếp nhận.',
  };
}

export const EXPORT_READINESS_SCOPE_CONFIRMATION_LEVELS = Object.freeze([
  ...SCOPE_CONFIRMATION_LEVELS,
]);
