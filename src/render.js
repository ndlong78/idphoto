import { FMTS, state } from './state.js';
import { getControls } from './ui.js';

export async function renderResult(scale = 1) {
  const fmt = FMTS[state.curFmt];
  const out = document.createElement('canvas');
  out.width = Math.round(fmt.w * scale);
  out.height = Math.round(fmt.h * scale);
  const ctx = out.getContext('2d');
  if (!ctx || !state.origImg) return out;

  const crop = getCropRect();
  ctx.drawImage(state.origImg, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);

  const imageData = ctx.getImageData(0, 0, out.width, out.height);
  const bg = state.bgColor;

  if (state.aiMaskImg) {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = out.width;
    maskCanvas.height = out.height;
    const mctx = maskCanvas.getContext('2d');
    if (mctx) {
      mctx.drawImage(state.aiMaskImg, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);
      const mask = mctx.getImageData(0, 0, out.width, out.height).data;
      blendWithMask(imageData.data, mask, bg);
    }
  } else {
    const mask = floodFill(imageData, 44);
    featherMask(mask, out.width, out.height, getControls().feather.valueAsNumber);
    applyMask(imageData.data, mask, bg);
  }

  applyAdjustments(imageData);
  ctx.putImageData(imageData, 0, 0);
  return out;
}

export async function renderToPreview() {
  const preview = document.getElementById('result-canvas');
  const output = await renderResult(1);
  preview.width = output.width;
  preview.height = output.height;
  preview.getContext('2d')?.drawImage(output, 0, 0);
}

function getCropRect() {
  return {
    x: (state.frame.x - state.crop.x) / state.crop.scale,
    y: (state.frame.y - state.crop.y) / state.crop.scale,
    w: state.frame.w / state.crop.scale,
    h: state.frame.h / state.crop.scale,
  };
}

function blendWithMask(data, mask, bg) {
  for (let i = 0; i < data.length; i += 4) {
    const alpha = mask[i + 3] / 255;
    const inv = 1 - alpha;
    data[i] = Math.round(data[i] * alpha + bg.r * inv);
    data[i + 1] = Math.round(data[i + 1] * alpha + bg.g * inv);
    data[i + 2] = Math.round(data[i + 2] * alpha + bg.b * inv);
  }
}

function applyAdjustments(imageData) {
  const { bright, contrast, sharp } = getControls();
  const b = bright.valueAsNumber;
  const c = contrast.valueAsNumber;
  const s = sharp.valueAsNumber / 100;
  const d = imageData.data;

  const factor = (259 * (c + 255)) / (255 * (259 - c));
  for (let i = 0; i < d.length; i += 4) {
    d[i] = clamp(factor * (d[i] - 128) + 128 + b);
    d[i + 1] = clamp(factor * (d[i + 1] - 128) + 128 + b);
    d[i + 2] = clamp(factor * (d[i + 2] - 128) + 128 + b);
  }

  if (s <= 0) return;
  unsharpMask(imageData, 1.2, s * 1.2);
}

function unsharpMask(imageData, radius, amount) {
  const { width, height, data } = imageData;
  const copy = new Uint8ClampedArray(data);
  const r = Math.max(1, Math.round(radius));

  for (let y = r; y < height - r; y++) {
    for (let x = r; x < width - r; x++) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let count = 0;
        for (let yy = -r; yy <= r; yy++) {
          for (let xx = -r; xx <= r; xx++) {
            const ni = ((y + yy) * width + (x + xx)) * 4 + c;
            sum += copy[ni];
            count++;
          }
        }
        const blur = sum / count;
        data[i + c] = clamp(copy[i + c] + (copy[i + c] - blur) * amount);
      }
    }
  }
}

function floodFill(imgData, tol) {
  const d = imgData.data;
  const W = imgData.width;
  const H = imgData.height;
  const mask = new Uint8Array(W * H);
  const queue = [];
  let head = 0;

  const bg = sampleBackground(d, W, H);
  const visit = (x, y) => {
    const idx = y * W + x;
    if (mask[idx]) return;
    const p = getPixel(d, x, y, W);
    if (colorDistance(p, bg) <= tol) {
      mask[idx] = 255;
      queue.push(idx);
    }
  };

  for (let x = 0; x < W; x += 2) {
    visit(x, 0);
    visit(x, H - 1);
  }
  for (let y = 0; y < H; y += 2) {
    visit(0, y);
    visit(W - 1, y);
  }

  while (head < queue.length) {
    const i = queue[head++];
    const x = i % W;
    const y = Math.floor(i / W);
    const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    neighbors.forEach(([nx, ny]) => {
      if (nx >= 0 && nx < W && ny >= 0 && ny < H) visit(nx, ny);
    });
  }

  return mask;
}

function featherMask(mask, W, H, radius) {
  if (radius <= 0) return;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (mask[i] !== 255) continue;
      const edge = mask[i - 1] === 0 || mask[i + 1] === 0 || mask[i - W] === 0 || mask[i + W] === 0;
      if (edge) mask[i] = 180;
    }
  }
}

function applyMask(data, mask, bg) {
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 0) continue;
    const alpha = mask[i] / 255;
    const di = i * 4;
    data[di] = Math.round(data[di] * (1 - alpha) + bg.r * alpha);
    data[di + 1] = Math.round(data[di + 1] * (1 - alpha) + bg.g * alpha);
    data[di + 2] = Math.round(data[di + 2] * (1 - alpha) + bg.b * alpha);
  }
}

function getPixel(data, x, y, W) {
  const i = (y * W + x) * 4;
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
}

function sampleBackground(data, W, H) {
  const points = [getPixel(data, 0, 0, W), getPixel(data, W - 1, 0, W), getPixel(data, 0, H - 1, W), getPixel(data, W - 1, H - 1, W)];
  return {
    r: Math.round(points.reduce((s, p) => s + p.r, 0) / points.length),
    g: Math.round(points.reduce((s, p) => s + p.g, 0) / points.length),
    b: Math.round(points.reduce((s, p) => s + p.b, 0) / points.length),
  };
}

function colorDistance(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 * 0.299 + (a.g - b.g) ** 2 * 0.587 + (a.b - b.b) ** 2 * 0.114);
}

function clamp(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}
