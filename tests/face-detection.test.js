import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFaceGeometry } from '../src/face-detection.js';

function detection({ box, score = 0.9, leftEye = [], rightEye = [], positions = null }) {
  const landmarks = positions
    ? { positions }
    : {
        getLeftEye: () => leftEye,
        getRightEye: () => rightEye,
      };
  return {
    detection: { box, score },
    landmarks,
  };
}

test('extractFaceGeometry: chọn khuôn mặt lớn nhất và giữ tổng số khuôn mặt', () => {
  const result = extractFaceGeometry([
    detection({
      box: { x: 10, y: 20, width: 80, height: 100 },
      score: 0.99,
      leftEye: [{ x: 30, y: 50 }],
      rightEye: [{ x: 60, y: 52 }],
    }),
    detection({
      box: { x: 100, y: 40, width: 160, height: 190 },
      score: 0.8,
      leftEye: [{ x: 145, y: 100 }, { x: 150, y: 102 }],
      rightEye: [{ x: 205, y: 98 }, { x: 210, y: 100 }],
    }),
  ]);

  assert.equal(result.faceCount, 2);
  assert.deepEqual(result.box, { x: 100, y: 40, width: 160, height: 190 });
  assert.equal(result.score, 0.8);
  assert.equal(result.eyeLineY, 100);
  assert.deepEqual(result.landmarks.leftEye, [{ x: 145, y: 100 }, { x: 150, y: 102 }]);
});

test('extractFaceGeometry: cùng diện tích thì ưu tiên confidence cao hơn', () => {
  const result = extractFaceGeometry([
    detection({ box: { x: 0, y: 0, width: 100, height: 100 }, score: 0.7 }),
    detection({ box: { x: 200, y: 0, width: 100, height: 100 }, score: 0.95 }),
  ]);
  assert.equal(result.box.x, 200);
  assert.equal(result.score, 0.95);
});

test('extractFaceGeometry: fallback landmarks.positions dùng index mắt 36–47', () => {
  const positions = Array.from({ length: 68 }, (_, index) => ({ x: index, y: index }));
  const result = extractFaceGeometry([
    detection({
      box: { x: 0, y: 0, width: 100, height: 120 },
      positions,
    }),
  ]);

  assert.equal(result.landmarks.leftEye.length, 6);
  assert.equal(result.landmarks.rightEye.length, 6);
  assert.equal(result.landmarks.leftEye[0].x, 36);
  assert.equal(result.landmarks.rightEye[5].x, 47);
  assert.equal(result.eyeLineY, 41.5);
});

test('extractFaceGeometry: thiếu eye landmarks không phát minh eye line', () => {
  const result = extractFaceGeometry([
    detection({ box: { x: 10, y: 20, width: 80, height: 100 } }),
  ]);
  assert.equal(result.eyeLineY, null);
  assert.deepEqual(result.landmarks, { leftEye: [], rightEye: [] });
});

test('extractFaceGeometry: bỏ detection có box lỗi và trả null khi không còn mặt hợp lệ', () => {
  assert.equal(extractFaceGeometry([]), null);
  assert.equal(extractFaceGeometry([
    detection({ box: { x: 0, y: 0, width: 0, height: 100 } }),
  ]), null);
});

test('extractFaceGeometry: fail-fast khi đầu vào không phải mảng', () => {
  assert.throws(() => extractFaceGeometry(null), /detections phải là một mảng/);
});
