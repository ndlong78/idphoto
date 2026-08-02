import assert from 'node:assert/strict';
import test from 'node:test';

import { getComplianceProfile } from '../src/compliance.js';
import { buildCompositionGuideModel } from '../src/composition-guides.js';

function check(id, status, value = null, extra = {}) {
  return { id, status, value, ...extra };
}

function geometry(overrides = {}) {
  return {
    formatKey: 'passport-vn',
    outputSize: { width: 400, height: 600 },
    faceCount: 1,
    faceBox: { x: 80, y: 120, width: 240, height: 360 },
    headBox: null,
    eyeLineY: 240,
    ...overrides,
  };
}

function result(checks) {
  return { checks };
}

test('returns unavailable model when output geometry is missing', () => {
  const model = buildCompositionGuideModel();
  assert.equal(model.available, false);
  assert.match(model.action.text, /Chưa có dữ liệu/);
});

test('builds Vietnam center band, eye band and normalized face geometry', () => {
  const model = buildCompositionGuideModel({
    geometry: geometry(),
    profile: getComplianceProfile('passport-vn'),
    result: result([
      check('face-clipping', 'pass'),
      check('horizontal-centering', 'pass'),
      check('face-area', 'pass', 0.36),
      check('eye-line', 'pass', 0.4),
    ]),
  });

  assert.equal(model.available, true);
  assert.deepEqual(model.centerBand, { left: 0.42, width: 0.16, target: 0.5 });
  assert.deepEqual(model.eyeBand, {
    top: 0.35,
    height: 0.10000000000000003,
    target: 0.4,
    approximate: true,
  });
  assert.deepEqual(model.faceBox, {
    left: 0.2,
    top: 0.2,
    width: 0.6,
    height: 0.6,
    centerX: 0.5,
    centerY: 0.5,
    tone: 'ok',
  });
  assert.equal(model.eyeLine.top, 0.4);
  assert.equal(model.eyeLine.tone, 'ok');
});

test('suggests dragging right when the detected face is left of center', () => {
  const model = buildCompositionGuideModel({
    geometry: geometry({ faceBox: { x: 20, y: 120, width: 200, height: 360 } }),
    profile: getComplianceProfile('passport-vn'),
    result: result([
      check('face-count', 'pass'),
      check('face-clipping', 'pass'),
      check('horizontal-centering', 'warning', 0.2),
    ]),
  });

  assert.equal(model.action.tone, 'warning');
  assert.match(model.action.text, /sang phải/);
});

test('suggests dragging left when the detected face is right of center', () => {
  const model = buildCompositionGuideModel({
    geometry: geometry({ faceBox: { x: 210, y: 120, width: 180, height: 360 } }),
    profile: getComplianceProfile('passport-vn'),
    result: result([
      check('face-count', 'pass'),
      check('face-clipping', 'pass'),
      check('horizontal-centering', 'warning', 0.2),
    ]),
  });

  assert.match(model.action.text, /sang trái/);
});

test('suggests zooming in or out from the face-area warning', () => {
  const baseChecks = [
    check('face-count', 'pass'),
    check('face-clipping', 'pass'),
    check('horizontal-centering', 'pass'),
  ];
  const small = buildCompositionGuideModel({
    geometry: geometry(),
    profile: getComplianceProfile('passport-vn'),
    result: result([
      ...baseChecks,
      check('face-area', 'warning', 0.5, { min: 0.65, max: 0.85 }),
    ]),
  });
  const large = buildCompositionGuideModel({
    geometry: geometry(),
    profile: getComplianceProfile('passport-vn'),
    result: result([
      ...baseChecks,
      check('face-area', 'warning', 0.9, { min: 0.65, max: 0.85 }),
    ]),
  });

  assert.match(small.action.text, /Zoom vào/);
  assert.match(large.action.text, /Zoom ra/);
});

test('suggests the correct vertical direction for eye-line warnings', () => {
  const baseChecks = [
    check('face-count', 'pass'),
    check('face-clipping', 'pass'),
    check('horizontal-centering', 'pass'),
    check('face-area', 'pass', 0.75, { min: 0.65, max: 0.85 }),
  ];
  const tooHigh = buildCompositionGuideModel({
    geometry: geometry(),
    profile: getComplianceProfile('passport-vn'),
    result: result([
      ...baseChecks,
      check('eye-line', 'warning', 0.3, { min: 0.35, max: 0.45 }),
    ]),
  });
  const tooLow = buildCompositionGuideModel({
    geometry: geometry(),
    profile: getComplianceProfile('passport-vn'),
    result: result([
      ...baseChecks,
      check('eye-line', 'warning', 0.5, { min: 0.35, max: 0.45 }),
    ]),
  });

  assert.match(tooHigh.action.text, /Kéo ảnh xuống/);
  assert.match(tooLow.action.text, /Kéo ảnh lên/);
});

test('prioritizes clipping guidance before centering and scale guidance', () => {
  const model = buildCompositionGuideModel({
    geometry: geometry(),
    profile: getComplianceProfile('passport-vn'),
    result: result([
      check('face-count', 'pass'),
      check('face-clipping', 'warning'),
      check('horizontal-centering', 'warning', 0.2),
      check('face-area', 'warning', 0.5, { min: 0.65, max: 0.85 }),
    ]),
  });

  assert.match(model.action.text, /nằm trọn trong khung/);
});

test('generic profiles keep center guidance but do not invent an eye band', () => {
  const model = buildCompositionGuideModel({
    geometry: geometry({ formatKey: 'schengen' }),
    profile: getComplianceProfile('schengen'),
    result: result([
      check('face-clipping', 'pass'),
      check('horizontal-centering', 'pass'),
    ]),
  });

  assert.equal(model.available, true);
  assert.equal(model.eyeBand, null);
  assert.equal(model.centerBand.target, 0.5);
});

test('does not create a face guide from invalid projected coordinates', () => {
  const model = buildCompositionGuideModel({
    geometry: geometry({ faceBox: { x: Number.NaN, y: 10, width: 100, height: 100 } }),
    profile: getComplianceProfile('passport-vn'),
    result: result([]),
  });

  assert.equal(model.faceBox, null);
});
