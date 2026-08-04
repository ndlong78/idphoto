import { clearExportRecovery } from './export-recovery.js';
import { clearExportReceipt } from './export-receipt.js';

function normalizeFormatKey(formatKey) {
  return typeof formatKey === 'string' && formatKey ? formatKey : 'generic';
}

export function getManualReviewKey(item) {
  const sectionKey = typeof item?.sectionKey === 'string' && item.sectionKey
    ? item.sectionKey
    : 'manual';
  const id = typeof item?.id === 'string' && item.id
    ? item.id
    : 'unknown';
  return `${sectionKey}:${id}`;
}

function normalizeCompletedKeys(completedKeys) {
  if (completedKeys instanceof Set) return completedKeys;
  if (Array.isArray(completedKeys)) return new Set(completedKeys);
  return new Set();
}

export function buildManualReviewChecklist(manualItems = [], completedKeys = new Set()) {
  const completed = normalizeCompletedKeys(completedKeys);
  const seen = new Set();
  const items = [];

  for (const item of Array.isArray(manualItems) ? manualItems : []) {
    const reviewKey = getManualReviewKey(item);
    if (seen.has(reviewKey)) continue;
    seen.add(reviewKey);
    items.push({
      ...item,
      reviewKey,
      reviewed: completed.has(reviewKey),
    });
  }

  const reviewed = items.filter((item) => item.reviewed).length;
  return {
    items,
    counts: {
      total: items.length,
      reviewed,
      pending: items.length - reviewed,
    },
    hasItems: items.length > 0,
    allReviewed: items.length > 0 && reviewed === items.length,
    disclaimer: 'Dấu chọn chỉ ghi nhận bạn đã tự đối chiếu tiêu chí; đây không phải xác nhận ảnh được cơ quan tiếp nhận chấp thuận.',
  };
}

export function createManualReviewStore() {
  let sourceToken = null;
  let auditEnabled = false;
  const completedByFormat = new Map();

  const syncSource = (source) => {
    if (sourceToken === source) return;
    sourceToken = source;
    auditEnabled = false;
    completedByFormat.clear();
  };

  const getSet = (formatKey) => {
    const key = normalizeFormatKey(formatKey);
    let completed = completedByFormat.get(key);
    if (!completed) {
      completed = new Set();
      completedByFormat.set(key, completed);
    }
    return completed;
  };

  return {
    reset(source = null) {
      sourceToken = source;
      auditEnabled = false;
      completedByFormat.clear();
    },

    getCompletedKeys(source, formatKey) {
      syncSource(source);
      return new Set(getSet(formatKey));
    },

    setItem(source, formatKey, reviewKey, reviewed) {
      syncSource(source);
      if (typeof reviewKey !== 'string' || !reviewKey) {
        throw new TypeError('reviewKey phải là chuỗi không rỗng.');
      }
      const completed = getSet(formatKey);
      if (reviewed) completed.add(reviewKey);
      else completed.delete(reviewKey);
      return new Set(completed);
    },

    setAll(source, formatKey, reviewKeys, reviewed) {
      syncSource(source);
      const completed = getSet(formatKey);
      for (const reviewKey of reviewKeys ?? []) {
        if (typeof reviewKey !== 'string' || !reviewKey) continue;
        if (reviewed) completed.add(reviewKey);
        else completed.delete(reviewKey);
      }
      return new Set(completed);
    },

    setAuditEnabled(source, enabled) {
      syncSource(source);
      auditEnabled = Boolean(enabled);
      return auditEnabled;
    },

    isAuditEnabled(source) {
      syncSource(source);
      return auditEnabled;
    },

    snapshot(source, formatKey, manualItems = []) {
      syncSource(source);
      return {
        ...buildManualReviewChecklist(manualItems, getSet(formatKey)),
        auditEnabled,
      };
    },
  };
}

const baseManualReviewStore = createManualReviewStore();

export const manualReviewStore = {
  ...baseManualReviewStore,
  reset(source = null) {
    clearExportRecovery();
    clearExportReceipt();
    return baseManualReviewStore.reset(source);
  },
};
