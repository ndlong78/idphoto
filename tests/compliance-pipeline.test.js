import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveCropRect,
  evaluateDetectedPhotoCompliance,
  refreshComplianceResult,
} from '../src/compliance-pipeline.js';
import { state } from '../src/state.js';

function byId(result, id) {
  return result.checks.find((check) => check.id === id);
}

test('deriveCropRect: dùng cùng công thức crop với renderer', () => {
  const rect = deriveCropRect({
    origImg: { width: 1200, height: 1800 },
    frame: { x: 100, y: 80, w: 400, h: 600 },
    crop: { x: -100, y: -220, scale: 2 },
  });
  assert.deepEqual(rect, { x: 100, y: 150, width: 200, height: 300 });
});

test('deriveCropRect: fallback toàn ảnh khi frame hoặc scale chưa hợp lệ', () => {
  const image = { width: 1200, height: 1800 };
  assert.deepEqual(
    deriveCropRect({ origImg: image, frame: { x: 0, y: 0, w: 0, h: 0 }, crop: { x: 0, y: 0, scale: 1 } }),
    { x: 0, y: 0, width: 1200, height: 1800 },
  );
  assert.deepEqual(
    deriveCropRect({ origImg: image, frame: null, crop: { scale: 0 } }),
    { x: 0, y: 0, width: 1200, height: 1800 },
  );
});

test('evaluateDetectedPhotoCompliance: project face box và eye line vào output', () => {
  const result = evaluateDetectedPhotoCompliance({
    formatKey: 'passport-vn',
    outputSize: { width: 400, height: 600 },
    cropRect: { x: 100, y: 200, width: 400, height: 600 },
    faceData: {
      faceCount: 1,
      box: { x: 120, y: 250, width: 360, height: 500 },
      eyeLineY: 440,
    },
  });

  assert.equal(result.hasWarnings, false);
  assert.equal(result.metrics.faceAreaRatio, 0.75);
  assert.equal(result.metrics.eyeLineFromTopRatio, 0.4);
  assert.equal(byId(result, 'face-count').value, 1);
});

test('evaluateDetectedPhotoCompliance: truyền faceCount nhiều người vào checker', () => {
  const result = evaluateDetectedPhotoCompliance({
    formatKey: 'passport-vn',
    outputSize: { width: 400, height: 600 },
    cropRect: { x: 0, y: 0, width: 400, height: 600 },
    faceData: {
      faceCount: 3,
      box: { x: 20, y: 50, width: 360, height: 500 },
      eyeLineY: 240,
    },
  });
  assert.equal(byId(result, 'face-count').status, 'warning');
  assert.equal(byId(result, 'face-count').value, 3);
});

test('evaluateDetectedPhotoCompliance: offset kết quả được tính vào cảnh báo căn giữa', () => {
  const result = evaluateDetectedPhotoCompliance({
    formatKey: 'passport-vn',
    outputSize: { width: 400, height: 600 },
    cropRect: { x: 0, y: 0, width: 400, height: 600 },
    resultOffsetPct: { x: 20, y: 0 },
    faceData: {
      faceCount: 1,
      box: { x: 20, y: 50, width: 360, height: 500 },
      eyeLineY: 240,
    },
  });
  assert.equal(byId(result, 'horizontal-centering').status, 'warning');
});

test('evaluateDetectedPhotoCompliance: không có face data tạo cảnh báo không tìm thấy mặt', () => {
  const result = evaluateDetectedPhotoCompliance({
    formatKey: 'passport-vn',
    outputSize: { width: 400, height: 600 },
    cropRect: { x: 0, y: 0, width: 400, height: 600 },
    faceData: null,
  });
  assert.equal(byId(result, 'face-count').status, 'warning');
  assert.equal(byId(result, 'face-count').value, 0);
  assert.equal(byId(result, 'eye-line').status, 'unavailable');
});

test('refreshComplianceResult: lưu kết quả vào state sau pipeline', () => {
  const snapshot = {
    origImg: state.origImg,
    faceData: state.faceData,
    complianceResult: state.complianceResult,
    curFmt: state.curFmt,
    frame: { ...state.frame },
    crop: { ...state.crop },
    resultFaceOffsetPct: { ...state.resultFaceOffsetPct },
  };

  try {
    state.origImg = { width: 400, height: 600 };
    state.curFmt = 'passport-vn';
    state.frame = { x: 0, y: 0, w: 400, h: 600 };
    state.crop = { x: 0, y: 0, scale: 1 };
    state.resultFaceOffsetPct = { x: 0, y: 0 };
    state.faceData = {
      faceCount: 1,
      box: { x: 20, y: 50, width: 360, height: 500 },
      eyeLineY: 240,
    };

    const result = refreshComplianceResult();
    assert.equal(result, state.complianceResult);
    assert.equal(result.profileKey, 'passport-vn');
    assert.equal(result.hasWarnings, false);
  } finally {
    state.origImg = snapshot.origImg;
    state.faceData = snapshot.faceData;
    state.complianceResult = snapshot.complianceResult;
    state.curFmt = snapshot.curFmt;
    state.frame = snapshot.frame;
    state.crop = snapshot.crop;
    state.resultFaceOffsetPct = snapshot.resultFaceOffsetPct;
  }
});

test('refreshComplianceResult: thiếu ảnh gốc thì reset kết quả', () => {
  const previousImage = state.origImg;
  const previousResult = state.complianceResult;
  try {
    state.origImg = null;
    state.complianceResult = { stale: true };
    assert.equal(refreshComplianceResult(), null);
    assert.equal(state.complianceResult, null);
  } finally {
    state.origImg = previousImage;
    state.complianceResult = previousResult;
  }
});
