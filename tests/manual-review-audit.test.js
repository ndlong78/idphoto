import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildExportAudit,
  buildExportAuditFilename,
  serializeExportAudit,
} from '../src/export-audit.js';
import { buildExportReadiness } from '../src/export-readiness.js';
import {
  buildManualReviewChecklist,
  createManualReviewStore,
  getManualReviewKey,
} from '../src/manual-review.js';

const manual = (id, label = id) => ({
  sectionKey: 'composition',
  sectionLabel: 'Bố cục hồ sơ',
  id,
  label,
  status: 'manual',
  message: 'Tự đối chiếu yêu cầu.',
});

function cleanReadiness(completedKeys) {
  return buildExportReadiness({
    imageQualityResult: {
      automatedStatus: 'no-automatic-warning',
      checks: [{ id: 'sharpness', label: 'Độ nét', status: 'pass', message: 'Không cảnh báo.' }],
    },
    backgroundQualityResult: {
      automatedStatus: 'no-warning',
      checks: [{ id: 'mask-edge', label: 'Viền mask', status: 'pass', message: 'Không cảnh báo.' }],
    },
    complianceResult: {
      formatKey: 'us-visa',
      profileKey: 'us-visa',
      automatedStatus: 'no-automatic-warning',
      checks: [
        { id: 'face-count', label: 'Số khuôn mặt', status: 'pass', message: 'Một khuôn mặt.' },
        manual('recent', 'Ảnh mới chụp'),
        manual('background', 'Phông nền'),
      ],
    },
    profile: {
      key: 'us-visa',
      supportLevel: 'official',
      sourceUrl: 'https://example.gov/photo',
      scopeNotice: 'Nguồn chính thức thử nghiệm.',
    },
    manualReviewCompletedKeys: completedKeys,
  });
}

test('manual review key ổn định theo section và id', () => {
  assert.equal(getManualReviewKey(manual('recent')), 'composition:recent');
  assert.equal(getManualReviewKey({ id: 'pose' }), 'manual:pose');
});

test('buildManualReviewChecklist loại trùng và tính đúng tiến độ', () => {
  const checklist = buildManualReviewChecklist(
    [manual('recent'), manual('recent'), manual('background')],
    new Set(['composition:recent']),
  );
  assert.equal(checklist.counts.total, 2);
  assert.equal(checklist.counts.reviewed, 1);
  assert.equal(checklist.counts.pending, 1);
  assert.equal(checklist.allReviewed, false);
});

test('store tách checklist theo preset và reset khi đổi ảnh', () => {
  const store = createManualReviewStore();
  const firstFile = {};
  const secondFile = {};
  store.setItem(firstFile, 'us-visa', 'composition:recent', true);
  store.setItem(firstFile, 'japan', 'composition:background', true);
  assert.deepEqual([...store.getCompletedKeys(firstFile, 'us-visa')], ['composition:recent']);
  assert.deepEqual([...store.getCompletedKeys(firstFile, 'japan')], ['composition:background']);
  assert.equal(store.getCompletedKeys(secondFile, 'us-visa').size, 0);
  assert.equal(store.getCompletedKeys(firstFile, 'japan').size, 0);
});

test('store quản lý đánh dấu tất cả và tùy chọn audit trong cùng ảnh', () => {
  const store = createManualReviewStore();
  const file = {};
  store.setAll(file, 'schengen', ['composition:recent', 'composition:pose'], true);
  store.setAuditEnabled(file, true);
  assert.equal(store.getCompletedKeys(file, 'schengen').size, 2);
  assert.equal(store.isAuditEnabled(file), true);
  store.setAll(file, 'schengen', ['composition:recent'], false);
  assert.deepEqual([...store.getCompletedKeys(file, 'schengen')], ['composition:pose']);
});

test('checklist chưa hoàn tất yêu cầu xác nhận nhưng không tạo warning giả', () => {
  const readiness = cleanReadiness(new Set(['composition:recent']));
  assert.equal(readiness.requiresConfirmation, true);
  assert.equal(readiness.manualReviewIncomplete, true);
  assert.equal(readiness.counts.warning, 0);
  assert.equal(readiness.counts.manualReviewed, 1);
  assert.equal(readiness.counts.manualPending, 1);
  assert.match(readiness.summary, /1 mục thủ công chưa đối chiếu/);
});

test('checklist hoàn tất bỏ yêu cầu xác nhận và giữ trạng thái tự đối chiếu', () => {
  const readiness = cleanReadiness(new Set([
    'composition:recent',
    'composition:background',
  ]));
  assert.equal(readiness.requiresConfirmation, false);
  assert.equal(readiness.manualReviewIncomplete, false);
  assert.equal(readiness.tone, 'manual');
  assert.equal(readiness.counts.manualReviewed, 2);
  assert.match(readiness.statusLabel, /2\/2/);
  assert.equal(readiness.manualItems.every((item) => item.reviewed), true);
});

test('audit không chứa tên file gốc hoặc hình học khuôn mặt', () => {
  const readiness = cleanReadiness(new Set(['composition:recent']));
  const audit = buildExportAudit({
    readiness,
    exportResult: {
      filename: 'photovisa_us-visa_1205x1205_600dpi.jpeg',
      mimeType: 'image/jpeg',
      width: 1205,
      height: 1205,
      targetDpi: 600,
      blobSize: 456789,
    },
    format: { mmW: 51, mmH: 51 },
    mode: 'jpeg600',
    sourceFile: {
      name: 'full-name-passport.jpg',
      type: 'image/jpeg',
      size: 123456,
    },
    generatedAt: '2026-08-04T12:00:00.000Z',
    userConfirmed: true,
  });

  assert.equal(audit.generatedAt, '2026-08-04T12:00:00.000Z');
  assert.equal(audit.privacy.containsImageData, false);
  assert.equal(audit.privacy.containsFaceGeometry, false);
  assert.equal(audit.privacy.containsOriginalFilename, false);
  assert.equal(audit.source.mimeType, 'image/jpeg');
  assert.equal(audit.source.sizeBytes, 123456);
  assert.equal(Object.hasOwn(audit.source, 'name'), false);
  assert.equal(JSON.stringify(audit).includes('full-name-passport.jpg'), false);
  assert.equal(audit.readiness.manualReviewed, 1);
  assert.equal(audit.readiness.manualPending, 1);
});

test('audit filename và JSON được tạo ổn định', () => {
  assert.equal(
    buildExportAuditFilename('photovisa_japan_827x1063_600dpi.png'),
    'photovisa_japan_827x1063_600dpi.audit.json',
  );
  assert.equal(buildExportAuditFilename(''), 'photovisa-export.audit.json');
  const serialized = serializeExportAudit({ schemaVersion: 1, kind: 'test' });
  assert.equal(serialized.endsWith('\n'), true);
  assert.deepEqual(JSON.parse(serialized), { schemaVersion: 1, kind: 'test' });
});
