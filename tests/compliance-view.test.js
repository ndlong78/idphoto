import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildComplianceViewModel,
  getComplianceGeometrySignature,
} from '../src/compliance-view.js';

function resultWith(checks) {
  return {
    sourceUrl: 'https://example.test/rules',
    disclaimer: 'Chỉ là cảnh báo hỗ trợ.',
    checks,
  };
}

test('view model ưu tiên cảnh báo và không dùng ngôn ngữ xác nhận đạt chuẩn', () => {
  const model = buildComplianceViewModel(resultWith([
    { id: 'manual', status: 'manual', label: 'Kính', message: 'Kiểm tra thủ công.' },
    { id: 'pass', status: 'pass', label: 'Căn giữa', message: 'Nằm trong vùng.' },
    { id: 'warning', status: 'warning', label: 'Đường mắt', message: 'Ngoài vùng.' },
    { id: 'missing', status: 'unavailable', label: 'Chiều cao đầu', message: 'Thiếu dữ liệu.' },
  ]));

  assert.equal(model.tone, 'warning');
  assert.equal(model.counts.warning, 1);
  assert.equal(model.counts.pass, 1);
  assert.equal(model.counts.manual, 1);
  assert.equal(model.counts.unavailable, 1);
  assert.deepEqual(model.checks.map((check) => check.id), [
    'warning',
    'pass',
    'missing',
    'manual',
  ]);
  assert.equal(model.openDetails, true);
  assert.doesNotMatch(`${model.statusLabel} ${model.title} ${model.summary}`, /đạt chuẩn|chấp thuận/i);
});

test('không có warning chỉ hiển thị không phát hiện cảnh báo tự động', () => {
  const model = buildComplianceViewModel(resultWith([
    { id: 'pass', status: 'pass', label: 'Căn giữa', message: 'Nằm trong vùng.' },
    { id: 'manual', status: 'manual', label: 'Biểu cảm', message: 'Kiểm tra thủ công.' },
  ]));

  assert.equal(model.tone, 'ok');
  assert.equal(model.statusLabel, 'Không thấy cảnh báo tự động');
  assert.equal(model.openDetails, false);
  assert.doesNotMatch(`${model.title} ${model.summary}`, /đạt chuẩn|được duyệt|chấp thuận/i);
});

test('thiếu toàn bộ phép đo tự động dùng trạng thái trung lập', () => {
  const model = buildComplianceViewModel(resultWith([
    { id: 'manual', status: 'manual', label: 'Biểu cảm', message: 'Kiểm tra thủ công.' },
    { id: 'missing', status: 'unavailable', label: 'Đường mắt', message: 'Thiếu dữ liệu.' },
  ]));

  assert.equal(model.tone, 'neutral');
  assert.equal(model.statusLabel, 'Chưa đủ dữ liệu tự động');
});

test('null result tạo trạng thái chờ an toàn', () => {
  const model = buildComplianceViewModel(null);
  assert.equal(model.tone, 'neutral');
  assert.equal(model.checks.length, 0);
  assert.equal(model.sourceUrl, null);
});

test('geometry signature thay đổi theo preset, crop và offset kết quả', () => {
  const base = {
    section: 'editor',
    curFmt: 'passport-vn',
    origImg: { width: 1200, height: 1600 },
    faceData: {
      faceCount: 1,
      score: 0.9,
      box: { x: 300, y: 220, width: 500, height: 650 },
      eyeLineY: 430,
    },
    frame: { x: 30, y: 40, w: 300, h: 450 },
    crop: { x: -100, y: -80, scale: 0.4 },
    resultFaceOffsetPct: { x: 0, y: 0 },
    bgColor: { r: 255, g: 255, b: 255 },
  };

  const signature = getComplianceGeometrySignature(base);
  assert.notEqual(
    signature,
    getComplianceGeometrySignature({ ...base, curFmt: 'us-visa' }),
  );
  assert.notEqual(
    signature,
    getComplianceGeometrySignature({ ...base, crop: { ...base.crop, scale: 0.5 } }),
  );
  assert.notEqual(
    signature,
    getComplianceGeometrySignature({
      ...base,
      resultFaceOffsetPct: { x: 2, y: -3 },
    }),
  );
});

test('geometry signature bỏ qua màu nền và kết quả compliance cũ', () => {
  const base = {
    section: 'editor',
    curFmt: 'passport-vn',
    origImg: { width: 1200, height: 1600 },
    faceData: null,
    frame: { x: 30, y: 40, w: 300, h: 450 },
    crop: { x: -100, y: -80, scale: 0.4 },
    resultFaceOffsetPct: { x: 0, y: 0 },
    bgColor: { r: 255, g: 255, b: 255 },
    complianceResult: { hasWarnings: false },
  };

  const signature = getComplianceGeometrySignature(base);
  assert.equal(
    signature,
    getComplianceGeometrySignature({
      ...base,
      bgColor: { r: 10, g: 20, b: 30 },
      complianceResult: { hasWarnings: true },
    }),
  );
});
