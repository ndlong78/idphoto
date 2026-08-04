import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computePixelQualityMetrics,
  evaluateImageQuality,
} from '../src/image-quality.js';

function solidPixels(width, height, value) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }
  return data;
}

function checkerPixels(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = (x + y) % 2 === 0 ? 20 : 235;
      const index = (y * width + x) * 4;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  return data;
}

function metrics(overrides = {}) {
  return {
    imageSize: { width: 1200, height: 1600 },
    fullFrame: {
      width: 128,
      height: 128,
      luminanceMean: 128,
      luminanceStdDev: 45,
      shadowClipRatio: 0.01,
      highlightClipRatio: 0.01,
      laplacianVariance: 220,
    },
    faceRegion: {
      width: 96,
      height: 128,
      luminanceMean: 128,
      luminanceStdDev: 40,
      shadowClipRatio: 0,
      highlightClipRatio: 0,
      laplacianVariance: 180,
    },
    faceBox: { x: 300, y: 300, width: 500, height: 700 },
    faceCount: 1,
    ...overrides,
  };
}

const format = { w: 472, h: 709, lbl: '40 × 60 mm' };

test('computes luminance, clipping and low edge variance for a flat image', () => {
  const result = computePixelQualityMetrics(solidPixels(8, 8, 40), 8, 8);
  assert.ok(Math.abs(result.luminanceMean - 40) < 0.001);
  assert.equal(result.highlightClipRatio, 0);
  assert.equal(result.laplacianVariance, 0);
});

test('checker pattern has much higher edge variance than a flat image', () => {
  const flat = computePixelQualityMetrics(solidPixels(8, 8, 128), 8, 8);
  const detailed = computePixelQualityMetrics(checkerPixels(8, 8), 8, 8);
  assert.ok(detailed.laplacianVariance > flat.laplacianVariance);
  assert.ok(detailed.luminanceStdDev > flat.luminanceStdDev);
});

test('returns null when sampled metrics are unavailable', () => {
  assert.equal(evaluateImageQuality(), null);
});

test('passes a sufficiently large, balanced and sharp source image', () => {
  const result = evaluateImageQuality({ metrics: metrics(), format, formatKey: 'passport-vn' });
  assert.equal(result.hasWarnings, false);
  assert.equal(result.checks.filter((item) => item.status === 'warning').length, 0);
});

test('warns when source resolution is lower than the selected preset', () => {
  const result = evaluateImageQuality({
    metrics: metrics({ imageSize: { width: 300, height: 400 } }),
    format,
  });
  const check = result.checks.find((item) => item.id === 'source-resolution');
  assert.equal(check.status, 'warning');
  assert.match(check.message, /phóng lớn/);
});

test('warns for dark, clipped and low-contrast images', () => {
  const result = evaluateImageQuality({
    metrics: metrics({
      fullFrame: {
        width: 128,
        height: 128,
        luminanceMean: 35,
        luminanceStdDev: 12,
        shadowClipRatio: 0.4,
        highlightClipRatio: 0,
        laplacianVariance: 120,
      },
    }),
    format,
  });
  assert.equal(result.checks.find((item) => item.id === 'exposure').status, 'warning');
  assert.equal(result.checks.find((item) => item.id === 'clipping').status, 'warning');
  assert.equal(result.checks.find((item) => item.id === 'contrast').status, 'warning');
});

test('uses face-region sharpness before whole-frame sharpness', () => {
  const result = evaluateImageQuality({
    metrics: metrics({
      fullFrame: {
        width: 128,
        height: 128,
        luminanceMean: 128,
        luminanceStdDev: 50,
        shadowClipRatio: 0,
        highlightClipRatio: 0,
        laplacianVariance: 500,
      },
      faceRegion: {
        width: 80,
        height: 100,
        luminanceMean: 128,
        luminanceStdDev: 30,
        shadowClipRatio: 0,
        highlightClipRatio: 0,
        laplacianVariance: 20,
      },
    }),
    format,
  });
  const check = result.checks.find((item) => item.id === 'sharpness');
  assert.equal(check.status, 'warning');
  assert.match(check.message, /vùng khuôn mặt/);
});

test('warns when the detected face has too few native pixels', () => {
  const result = evaluateImageQuality({
    metrics: metrics({ faceBox: { x: 10, y: 10, width: 120, height: 160 } }),
    format,
  });
  const check = result.checks.find((item) => item.id === 'face-detail');
  assert.equal(check.status, 'warning');
  assert.match(check.message, /120 px/);
});

test('keeps face-detail unavailable when no single face can be selected', () => {
  const result = evaluateImageQuality({
    metrics: metrics({ faceCount: 2, faceBox: null, faceRegion: null }),
    format,
  });
  const check = result.checks.find((item) => item.id === 'face-detail');
  assert.equal(check.status, 'unavailable');
  assert.match(check.message, /nhiều khuôn mặt/);
});
