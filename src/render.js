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
  const { bright, contrast, sharp, skin } = getControls();
  const b = bright.valueAsNumber;
  const c = contrast.valueAsNumber;
  const s = sharp.valueAsNumber / 100;
  const sk = skin.valueAsNumber;
  const d = imageData.data;

  // 1. Brightness & contrast
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = clamp(factor * (d[i]     - 128) + 128 + b);
    d[i + 1] = clamp(factor * (d[i + 1] - 128) + 128 + b);
    d[i + 2] = clamp(factor * (d[i + 2] - 128) + 128 + b);
  }

  // 2. Skin smoothing (frequency separation — chạy trước sharpening)
  if (sk > 0) applySkinSmoothing(imageData, sk);

  // 3. Unsharp mask (tăng nét sau khi làm mịn)
  if (s > 0) unsharpMask(imageData, 1.2, s * 1.2);
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

// ─── Skin Smoothing (Frequency Separation) ──────────────────────────────────
//
// Chiến lược:
//   1. Tạo lớp low-frequency (box blur) của toàn ảnh.
//   2. Với mỗi pixel được nhận diện là da, blend pixel gốc với lớp blurred.
//      Điều này làm phẳng màu sắc (low-freq) nhưng vẫn giữ lại một phần
//      kết cấu da (high-freq = gốc − blurred không bị xóa hoàn toàn).
//   3. Sharpening chạy SAU để phục hồi cạnh mắt, tóc, môi.
//
// Skin detection từ chối:
//   - Nền trắng / xám (r ≈ g ≈ b)
//   - Tóc tối (r < 60)
//   - Mắt tối (r < 60)
//   - Môi đỏ bão hòa cao (r − g > 80 khi r > 200)
//   - Vùng lạnh / xanh (b > g)

function applySkinSmoothing(imageData, amount) {
  if (amount <= 0) return;
  const { width, height, data } = imageData;
  const strength = amount / 100;
  // Bán kính blur tỷ lệ với cường độ: ~2px ở 10%, ~8px ở 100%
  const radius = Math.max(2, Math.round(strength * 8));
  const lowFreq = boxBlurRGB(data, width, height, radius);

  for (let i = 0; i < data.length; i += 4) {
    if (!isSkinPixel(data[i], data[i + 1], data[i + 2])) continue;
    // Blend tối đa 88% để không xóa hoàn toàn micro-texture
    const t = strength * 0.88;
    data[i]     = clamp(data[i]     * (1 - t) + lowFreq[i]     * t);
    data[i + 1] = clamp(data[i + 1] * (1 - t) + lowFreq[i + 1] * t);
    data[i + 2] = clamp(data[i + 2] * (1 - t) + lowFreq[i + 2] * t);
  }
}

// Nhận diện màu da — bao phủ từ da nhợt đến da ngăm đậm
function isSkinPixel(r, g, b) {
  if (r < 60 || r > 248) return false;                       // quá tối (tóc/mắt) hoặc quá sáng (nền)
  if (r <= g || r <= b) return false;                        // R phải chiếm ưu thế (ấm)
  if (r - Math.min(g, b) < 20) return false;                // phải có sắc ấm đủ mạnh
  if (Math.max(r, g, b) - Math.min(r, g, b) < 15) return false; // không phải xám đều
  if (b > g) return false;                                   // loại màu lạnh / xanh
  if (r > 200 && (r - g) > 80) return false;                // loại môi/má đỏ bão hòa
  return true;
}

// Box blur tách kênh RGB (H-pass rồi V-pass) — O(W·H·r), chính xác hơn moving-average
function boxBlurRGB(src, W, H, r) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);

  // Horizontal pass: src → tmp
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let rs = 0, gs = 0, bs = 0, n = 0;
      for (let dx = -r; dx <= r; dx++) {
        const nx = Math.max(0, Math.min(W - 1, x + dx));
        const i = (y * W + nx) * 4;
        rs += src[i]; gs += src[i + 1]; bs += src[i + 2]; n++;
      }
      const i = (y * W + x) * 4;
      tmp[i] = rs / n; tmp[i + 1] = gs / n; tmp[i + 2] = bs / n; tmp[i + 3] = src[i + 3];
    }
  }

  // Vertical pass: tmp → out
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let rs = 0, gs = 0, bs = 0, n = 0;
      for (let dy = -r; dy <= r; dy++) {
        const ny = Math.max(0, Math.min(H - 1, y + dy));
        const i = (ny * W + x) * 4;
        rs += tmp[i]; gs += tmp[i + 1]; bs += tmp[i + 2]; n++;
      }
      const i = (y * W + x) * 4;
      out[i] = rs / n; out[i + 1] = gs / n; out[i + 2] = bs / n; out[i + 3] = src[i + 3];
    }
  }

  return out;
}
// ─────────────────────────────────────────────────────────────────────────────

function clamp(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}
