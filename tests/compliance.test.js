import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTOMATED_REVIEW_STATUS,
  COMPLIANCE_STATUS,
  evaluatePhotoCompliance,
  getComplianceProfile,
  projectBoxToOutput,
  projectHorizontalLineToOutput,
} from '../src/compliance.js';

function byId(result, id) {
  return result.checks.find((check) => check.id === id);
}

test('projectBoxToOutput: chiếu box qua crop và offset kết quả', () => {
  const projected = projectBoxToOutput({
    box: { x: 120, y: 80, width: 200, height: 300 },
    cropRect: { x: 20, y: 30, width: 400, height: 600 },
    outputSize: { width: 200, height: 300 },
    resultOffsetPct: { x: 5, y: -10 },
  });

  assert.deepEqual(projected, {
    x: 60,
    y: -5,
    width: 100,
    height: 150,
    right: 160,
    bottom: 145,
    centerX: 110,
    centerY: 70,
  });
});

test('projectHorizontalLineToOutput: giữ cùng phép biến đổi dọc với box', () => {
  const y = projectHorizontalLineToOutput({
    sourceY: 270,
    cropRect: { x: 20, y: 30, width: 400, height: 600 },
    outputSize: { width: 200, height: 300 },
    resultOffsetPct: { x: 0, y: 10 },
  });
  assert.equal(y, 150);
});

test('passport-vn: không cảnh báo khi diện tích mặt, đường mắt và căn giữa nằm trong dải', () => {
  const result = evaluatePhotoCompliance({
    formatKey: 'passport-vn',
    photoSize: { width: 400, height: 600 },
    faceCount: 1,
    faceBox: { x: 20, y: 50, width: 360, height: 500 },
    eyeLineY: 240,
  });

  assert.equal(result.automatedStatus, AUTOMATED_REVIEW_STATUS.NO_WARNING);
  assert.equal(result.hasWarnings, false);
  assert.equal(byId(result, 'face-count').status, COMPLIANCE_STATUS.PASS);
  assert.equal(byId(result, 'face-area').status, COMPLIANCE_STATUS.PASS);
  assert.equal(byId(result, 'eye-line').status, COMPLIANCE_STATUS.PASS);
  assert.equal(byId(result, 'horizontal-centering').status, COMPLIANCE_STATUS.PASS);
  assert.equal(byId(result, 'background').status, COMPLIANCE_STATUS.MANUAL);
  assert.equal(result.metrics.faceAreaRatio, 0.75);
  assert.equal(result.metrics.eyeLineFromTopRatio, 0.4);
});

test('passport-vn: cảnh báo mặt nhỏ, lệch tâm, bị cắt và đường mắt sai vị trí', () => {
  const result = evaluatePhotoCompliance({
    formatKey: 'passport-vn',
    photoSize: { width: 400, height: 600 },
    faceCount: 1,
    faceBox: { x: -10, y: 30, width: 180, height: 260 },
    eyeLineY: 120,
  });

  assert.equal(result.automatedStatus, AUTOMATED_REVIEW_STATUS.REVIEW);
  assert.equal(byId(result, 'face-clipping').status, COMPLIANCE_STATUS.WARNING);
  assert.equal(byId(result, 'horizontal-centering').status, COMPLIANCE_STATUS.WARNING);
  assert.equal(byId(result, 'face-area').status, COMPLIANCE_STATUS.WARNING);
  assert.equal(byId(result, 'eye-line').status, COMPLIANCE_STATUS.WARNING);
});

test('thiếu landmarks/head box được ghi là unavailable, không giả vờ pass', () => {
  const vn = evaluatePhotoCompliance({
    formatKey: 'passport-vn',
    photoSize: { width: 400, height: 600 },
    faceBox: { x: 20, y: 50, width: 360, height: 500 },
  });
  assert.equal(byId(vn, 'eye-line').status, COMPLIANCE_STATUS.UNAVAILABLE);
  assert.equal(byId(vn, 'head-height').status, COMPLIANCE_STATUS.UNAVAILABLE);

  const us = evaluatePhotoCompliance({
    formatKey: 'us-visa',
    photoSize: { width: 600, height: 600 },
    faceBox: { x: 150, y: 120, width: 300, height: 330 },
  });
  assert.equal(byId(us, 'head-height').status, COMPLIANCE_STATUS.UNAVAILABLE);
  assert.equal(byId(us, 'eye-line').status, COMPLIANCE_STATUS.UNAVAILABLE);
});

test('nhiều khuôn mặt luôn tạo cảnh báo', () => {
  const result = evaluatePhotoCompliance({
    formatKey: 'passport-vn',
    photoSize: { width: 400, height: 600 },
    faceCount: 2,
    faceBox: { x: 20, y: 50, width: 360, height: 500 },
    eyeLineY: 240,
  });
  assert.equal(byId(result, 'face-count').status, COMPLIANCE_STATUS.WARNING);
  assert.equal(result.hasWarnings, true);
});

test('us-visa: áp dụng đúng dải chiều cao đầu và đường mắt chính thức', () => {
  const pass = evaluatePhotoCompliance({
    formatKey: 'us-visa',
    photoSize: { width: 600, height: 600 },
    faceCount: 1,
    faceBox: { x: 150, y: 120, width: 300, height: 330 },
    headBox: { x: 150, y: 100, width: 300, height: 360 },
    eyeLineY: 228,
  });
  assert.equal(byId(pass, 'head-height').status, COMPLIANCE_STATUS.PASS);
  assert.equal(byId(pass, 'eye-line').status, COMPLIANCE_STATUS.PASS);

  const fail = evaluatePhotoCompliance({
    formatKey: 'us-visa',
    photoSize: { width: 600, height: 600 },
    faceCount: 1,
    faceBox: { x: 150, y: 120, width: 300, height: 330 },
    headBox: { x: 150, y: 60, width: 300, height: 450 },
    eyeLineY: 300,
  });
  assert.equal(byId(fail, 'head-height').status, COMPLIANCE_STATUS.WARNING);
  assert.equal(byId(fail, 'eye-line').status, COMPLIANCE_STATUS.WARNING);
});

test('schengen: có profile nguồn chính thức nhưng không phát minh tỷ lệ hình học', () => {
  const profile = getComplianceProfile('schengen');
  assert.equal(profile.key, 'schengen-source-backed');
  assert.equal(profile.supportLevel, 'official-manual-only');
  assert.equal(profile.faceAreaRange, null);
  assert.equal(profile.headHeightRange, null);
  assert.equal(profile.eyeLineFromTopRange, null);

  const result = evaluatePhotoCompliance({
    formatKey: 'schengen',
    photoSize: { width: 413, height: 531 },
    faceBox: { x: 90, y: 70, width: 230, height: 330 },
  });
  assert.equal(result.profileKey, 'schengen-source-backed');
  assert.equal(result.profileSupportLevel, 'official-manual-only');
  assert.equal(byId(result, 'face-area').status, COMPLIANCE_STATUS.UNAVAILABLE);
  assert.equal(byId(result, 'head-height').status, COMPLIANCE_STATUS.UNAVAILABLE);
  assert.equal(byId(result, 'eye-line').status, COMPLIANCE_STATUS.UNAVAILABLE);
  assert.equal(byId(result, 'recent').status, COMPLIANCE_STATUS.MANUAL);
  assert.match(result.disclaimer, /35×45 mm/);
});

test('preset hoàn toàn chưa có registry vẫn dùng generic profile', () => {
  assert.equal(getComplianceProfile('unknown-format').key, 'generic');
  const result = evaluatePhotoCompliance({
    formatKey: 'unknown-format',
    photoSize: { width: 300, height: 400 },
    faceBox: { x: 60, y: 50, width: 180, height: 260 },
  });
  assert.equal(result.profileKey, 'generic');
  assert.equal(result.profileSupportLevel, 'generic');
  assert.equal(byId(result, 'face-area').status, COMPLIANCE_STATUS.UNAVAILABLE);
});

test('đầu vào hình học sai fail-fast', () => {
  assert.throws(
    () => evaluatePhotoCompliance({ photoSize: { width: 0, height: 600 } }),
    /photoSize\.width phải lớn hơn 0/,
  );
  assert.throws(
    () => evaluatePhotoCompliance({ photoSize: { width: 400, height: 600 }, faceCount: -1 }),
    /faceCount phải là số nguyên không âm/,
  );
  assert.throws(
    () => projectBoxToOutput({
      box: { x: 0, y: 0, width: 10, height: 10 },
      cropRect: { x: 0, y: 0, width: 0, height: 10 },
      outputSize: { width: 100, height: 100 },
    }),
    /cropRect\.width phải lớn hơn 0/,
  );
});
