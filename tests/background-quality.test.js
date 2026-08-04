import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBackgroundQualityMetrics,
  evaluateBackgroundQuality,
} from '../src/background-quality.js';

function imageData(width, height, pixelFn) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      const index = (y * width + x) * 4;
      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
      data[index + 3] = a;
    }
  }
  return { width, height, data };
}

function cleanFixture(width = 64, height = 64) {
  const original = imageData(width, height, (x, y) => {
    const inside = x >= 18 && x < 46 && y >= 8 && y < 64;
    return inside ? [120, 90, 70, 255] : [230, 232, 235, 255];
  });
  const mask = imageData(width, height, (x, y) => {
    const inside = x >= 18 && x < 46 && y >= 8 && y < 64;
    return [0, 0, 0, inside ? 255 : 0];
  });
  return { original, mask };
}

test('clean mask has one component, no holes and uniform background', () => {
  const { original, mask } = cleanFixture();
  const metrics = buildBackgroundQualityMetrics({
    originalImageData: original,
    maskImageData: mask,
    faceBox: { x: 24, y: 15, width: 16, height: 18 },
  });

  assert.equal(metrics.foregroundComponentCount, 1);
  assert.equal(metrics.holeCount, 0);
  assert.equal(metrics.detachedForegroundRatio, 0);
  assert.equal(metrics.faceMissingRatio, 0);
  assert.ok(metrics.backgroundLumaStd < 1);
});

test('detects a transparent hole inside the subject', () => {
  const { original } = cleanFixture();
  const mask = imageData(64, 64, (x, y) => {
    const inside = x >= 18 && x < 46 && y >= 8 && y < 64;
    const hole = x >= 28 && x < 36 && y >= 28 && y < 36;
    return [0, 0, 0, inside && !hole ? 255 : 0];
  });
  const metrics = buildBackgroundQualityMetrics({
    originalImageData: original,
    maskImageData: mask,
  });

  assert.equal(metrics.holeCount, 1);
  assert.ok(metrics.largestHoleRatio > 0.03);
  const result = evaluateBackgroundQuality({ metrics, hasAiMask: true });
  assert.equal(result.checks.find((check) => check.id === 'mask-holes').status, 'warning');
});

test('detects a detached foreground fragment', () => {
  const { original } = cleanFixture();
  const mask = imageData(64, 64, (x, y) => {
    const main = x >= 18 && x < 46 && y >= 8 && y < 64;
    const fragment = x >= 2 && x < 8 && y >= 2 && y < 8;
    return [0, 0, 0, main || fragment ? 255 : 0];
  });
  const metrics = buildBackgroundQualityMetrics({
    originalImageData: original,
    maskImageData: mask,
  });

  assert.equal(metrics.foregroundComponentCount, 2);
  assert.ok(metrics.detachedForegroundRatio > 0.01);
  const result = evaluateBackgroundQuality({ metrics, hasAiMask: true });
  assert.equal(result.checks.find((check) => check.id === 'mask-fragments').status, 'warning');
});

test('detects missing alpha in the central face region', () => {
  const { original, mask } = cleanFixture();
  for (let y = 20; y < 26; y++) {
    for (let x = 28; x < 36; x++) {
      mask.data[(y * 64 + x) * 4 + 3] = 0;
    }
  }
  const metrics = buildBackgroundQualityMetrics({
    originalImageData: original,
    maskImageData: mask,
    faceBox: { x: 24, y: 15, width: 16, height: 18 },
  });
  assert.ok(metrics.faceMissingRatio > 0.1);
  const result = evaluateBackgroundQuality({ metrics, hasAiMask: true });
  assert.equal(result.checks.find((check) => check.id === 'face-integrity').status, 'warning');
});

test('detects strongly varied source background', () => {
  const width = 64;
  const height = 64;
  const original = imageData(width, height, (x, y) => {
    const inside = x >= 20 && x < 44 && y >= 8;
    if (inside) return [120, 90, 70, 255];
    return x < width / 2 ? [20, 20, 20, 255] : [245, 240, 230, 255];
  });
  const mask = imageData(width, height, (x, y) => {
    const inside = x >= 20 && x < 44 && y >= 8;
    return [0, 0, 0, inside ? 255 : 0];
  });
  const metrics = buildBackgroundQualityMetrics({
    originalImageData: original,
    maskImageData: mask,
  });
  assert.ok(metrics.backgroundLumaStd > 50);
  const result = evaluateBackgroundQuality({ metrics, hasAiMask: true });
  assert.equal(result.checks.find((check) => check.id === 'source-background').status, 'warning');
});

test('detects a wide semi-transparent fringe', () => {
  const width = 64;
  const height = 64;
  const original = imageData(width, height, () => [220, 220, 220, 255]);
  const mask = imageData(width, height, (x, y) => {
    if (x >= 20 && x < 44 && y >= 10) return [0, 0, 0, 255];
    if (x >= 14 && x < 50 && y >= 4) return [0, 0, 0, 100];
    return [0, 0, 0, 0];
  });
  const metrics = buildBackgroundQualityMetrics({
    originalImageData: original,
    maskImageData: mask,
  });
  assert.ok(metrics.semiTransparentPerBoundary > 2.8);
  const result = evaluateBackgroundQuality({ metrics, hasAiMask: true });
  assert.equal(result.checks.find((check) => check.id === 'mask-edge').status, 'warning');
});

test('warns when mask touches the top edge', () => {
  const width = 64;
  const height = 64;
  const original = imageData(width, height, () => [220, 220, 220, 255]);
  const mask = imageData(width, height, (x, y) => {
    const inside = x >= 16 && x < 48 && y < 60;
    return [0, 0, 0, inside ? 255 : 0];
  });
  const metrics = buildBackgroundQualityMetrics({
    originalImageData: original,
    maskImageData: mask,
  });
  assert.ok(metrics.topTouchRatio > 0.08);
  const result = evaluateBackgroundQuality({ metrics, hasAiMask: true });
  assert.equal(result.checks.find((check) => check.id === 'frame-contact').status, 'warning');
});

test('returns unavailable checks without an AI mask', () => {
  const result = evaluateBackgroundQuality({
    metrics: null,
    hasAiMask: false,
    aiError: 'model unavailable',
  });
  assert.equal(result.automatedStatus, 'unavailable');
  assert.ok(result.checks.every((check) => check.status === 'unavailable'));
  assert.match(result.checks[0].message, /model unavailable/);
});

test('clean fixture has no warnings with conservative thresholds', () => {
  const { original, mask } = cleanFixture();
  const metrics = buildBackgroundQualityMetrics({
    originalImageData: original,
    maskImageData: mask,
    faceBox: { x: 24, y: 15, width: 16, height: 18 },
  });
  const result = evaluateBackgroundQuality({ metrics, hasAiMask: true });
  const warningIds = result.checks
    .filter((check) => check.status === 'warning')
    .map((check) => check.id);
  assert.deepEqual(warningIds, []);
});
