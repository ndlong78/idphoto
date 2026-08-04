import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildExportReadiness,
  EXPORT_READINESS_SCOPE_CONFIRMATION_LEVELS,
} from '../src/export-readiness.js';

function result(checks, automatedStatus = 'no-automatic-warning') {
  return { checks, automatedStatus };
}

function profile(overrides = {}) {
  return {
    key: 'test-profile',
    supportLevel: 'official',
    sourceUrl: 'https://example.gov/photo',
    scopeNotice: 'Nguồn thử nghiệm.',
    ...overrides,
  };
}

const pass = (id, label = id) => ({ id, label, status: 'pass', message: 'Không cảnh báo.' });
const warning = (id, label = id) => ({ id, label, status: 'warning', message: 'Cần xem lại.' });
const manual = (id, label = id) => ({ id, label, status: 'manual', message: 'Tự kiểm tra.' });
const unavailable = (id, label = id) => ({ id, label, status: 'unavailable', message: 'Chưa đủ dữ liệu.' });

function cleanInputs(overrides = {}) {
  return {
    imageQualityResult: result([pass('sharpness')]),
    backgroundQualityResult: result([pass('mask-edge')], 'no-warning'),
    complianceResult: {
      ...result([pass('face-count'), manual('recent')], 'no-automatic-warning'),
      formatKey: 'us-visa',
      profileKey: 'us-visa',
    },
    profile: profile(),
    ...overrides,
  };
}

test('profile official sạch tải ngay nhưng vẫn giữ checklist thủ công', () => {
  const readiness = buildExportReadiness(cleanInputs());
  assert.equal(readiness.requiresConfirmation, false);
  assert.equal(readiness.tone, 'manual');
  assert.equal(readiness.counts.warning, 0);
  assert.equal(readiness.counts.manual, 1);
  assert.equal(readiness.manualItems[0].sectionLabel, 'Bố cục hồ sơ');
});

test('gom cảnh báo từ cả ba checker và yêu cầu xác nhận', () => {
  const readiness = buildExportReadiness(cleanInputs({
    imageQualityResult: result([warning('sharpness', 'Độ nét')], 'review-needed'),
    backgroundQualityResult: result([warning('mask-edge', 'Viền mask')], 'warning'),
    complianceResult: {
      ...result([warning('face-count', 'Số khuôn mặt')], 'review-needed'),
      formatKey: 'passport-vn',
      profileKey: 'passport-vn',
    },
  }));
  assert.equal(readiness.requiresConfirmation, true);
  assert.equal(readiness.counts.warning, 3);
  assert.deepEqual(
    readiness.warnings.map((item) => item.sectionKey),
    ['image-quality', 'background-quality', 'composition'],
  );
});

test('không có alpha mask AI vẫn yêu cầu xác nhận trước khi tải', () => {
  const readiness = buildExportReadiness(cleanInputs({
    backgroundQualityResult: result(
      [unavailable('mask-availability', 'Alpha mask AI')],
      'unavailable',
    ),
  }));
  assert.equal(readiness.backgroundUnavailable, true);
  assert.equal(readiness.requiresConfirmation, true);
  assert.match(readiness.summary, /alpha mask AI/);
});

test('preset reference-only yêu cầu xác nhận dù checker không cảnh báo', () => {
  const readiness = buildExportReadiness(cleanInputs({
    profile: profile({ supportLevel: 'reference-only' }),
  }));
  assert.equal(readiness.scopeRequiresConfirmation, true);
  assert.equal(readiness.requiresConfirmation, true);
});

test('preset không hỗ trợ như đầu ra chính thức yêu cầu xác nhận', () => {
  const readiness = buildExportReadiness(cleanInputs({
    profile: profile({ supportLevel: 'not-supported-as-official-output' }),
  }));
  assert.equal(readiness.requiresConfirmation, true);
  assert.match(readiness.summary, /giới hạn phạm vi/);
});

test('official-manual-only không bị biến thành lỗi tự động', () => {
  const readiness = buildExportReadiness(cleanInputs({
    profile: profile({ supportLevel: 'official-manual-only' }),
    complianceResult: {
      ...result([
        pass('face-count'),
        unavailable('head-height'),
        manual('recent'),
        manual('background'),
      ]),
      formatKey: 'schengen',
      profileKey: 'schengen-source-backed',
    },
  }));
  assert.equal(readiness.requiresConfirmation, false);
  assert.equal(readiness.counts.unavailable, 1);
  assert.equal(readiness.counts.manual, 2);
  assert.equal(readiness.tone, 'manual');
});

test('thiếu một nhóm kết quả yêu cầu xác nhận thay vì giả vờ sẵn sàng', () => {
  const readiness = buildExportReadiness(cleanInputs({ imageQualityResult: null }));
  assert.equal(readiness.missingCriticalResult, true);
  assert.equal(readiness.requiresConfirmation, true);
  assert.deepEqual(readiness.missingSections, [
    { key: 'image-quality', label: 'Chất lượng ảnh gốc' },
  ]);
});

test('danh sách support level cần xác nhận được công khai và bất biến theo giá trị', () => {
  assert.deepEqual(EXPORT_READINESS_SCOPE_CONFIRMATION_LEVELS, [
    'generic',
    'reference-only',
    'not-supported-as-official-output',
  ]);
  assert.equal(Object.isFrozen(EXPORT_READINESS_SCOPE_CONFIRMATION_LEVELS), true);
});
