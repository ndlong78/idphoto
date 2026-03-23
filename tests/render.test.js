import test from 'node:test';
import assert from 'node:assert/strict';
import { clamp, isSkinPixel, colorDistance, featherMask } from '../src/render.js';

// ══════════════════════════════════════════════════════════════════════════════
// clamp
// ══════════════════════════════════════════════════════════════════════════════

test('clamp: giá trị trong khoảng [0,255] → giữ nguyên', () => {
  assert.equal(clamp(0),   0);
  assert.equal(clamp(128), 128);
  assert.equal(clamp(255), 255);
});

test('clamp: giá trị âm → 0', () => {
  assert.equal(clamp(-1),    0);
  assert.equal(clamp(-1000), 0);
});

test('clamp: giá trị vượt 255 → 255', () => {
  assert.equal(clamp(256),  255);
  assert.equal(clamp(9999), 255);
});

test('clamp: làm tròn số thực', () => {
  assert.equal(clamp(127.4), 127);
  assert.equal(clamp(127.6), 128);
});

test('clamp: NaN → 0 (Math.round(NaN) = NaN, clamp về 0)', () => {
  // Math.max(0, Math.min(255, Math.round(NaN))) = Math.max(0, NaN) = 0
  assert.equal(clamp(NaN), 0);
});

// ══════════════════════════════════════════════════════════════════════════════
// isSkinPixel
// ══════════════════════════════════════════════════════════════════════════════

// Các tông da hợp lệ
test('isSkinPixel: da sáng (Caucasian) → true', () => {
  assert.equal(isSkinPixel(220, 170, 140), true);
});

test('isSkinPixel: da trung bình (East Asian / Việt Nam) → true', () => {
  assert.equal(isSkinPixel(190, 145, 110), true);
});

test('isSkinPixel: da ngăm (South Asian) → true', () => {
  assert.equal(isSkinPixel(150, 100, 75), true);
});

test('isSkinPixel: da tối (African) → true', () => {
  assert.equal(isSkinPixel(100, 65, 50), true);
});

// Loại trừ nền trắng / sáng
test('isSkinPixel: pixel trắng → false (quá sáng)', () => {
  assert.equal(isSkinPixel(255, 255, 255), false);
});

test('isSkinPixel: pixel gần trắng (nền ảnh hộ chiếu) → false', () => {
  assert.equal(isSkinPixel(249, 248, 247), false);  // r > 248
});

// Loại trừ tóc/mắt tối
test('isSkinPixel: tóc tối → false (r < 60)', () => {
  assert.equal(isSkinPixel(40, 30, 25), false);
});

test('isSkinPixel: đồng tử đen → false', () => {
  assert.equal(isSkinPixel(20, 15, 12), false);
});

// Loại trừ màu lạnh
test('isSkinPixel: vùng xanh lam → false (b > g)', () => {
  assert.equal(isSkinPixel(180, 150, 200), false);
});

test('isSkinPixel: nền xanh nhạt (xanh chứng minh thư) → false', () => {
  assert.equal(isSkinPixel(168, 203, 232), false);
});

// Loại trừ xám đồng màu
test('isSkinPixel: xám trung tính → false (max-min < 15)', () => {
  assert.equal(isSkinPixel(150, 148, 146), false);
});

// Loại trừ môi đỏ bão hòa
test('isSkinPixel: môi đỏ bão hòa → false (r>200, r-g>80)', () => {
  assert.equal(isSkinPixel(210, 60, 70), false);
});

// R không chiếm ưu thế
test('isSkinPixel: G > R → false', () => {
  assert.equal(isSkinPixel(130, 160, 100), false);
});

test('isSkinPixel: B > R → false', () => {
  assert.equal(isSkinPixel(120, 100, 170), false);
});

// ══════════════════════════════════════════════════════════════════════════════
// colorDistance
// ══════════════════════════════════════════════════════════════════════════════

test('colorDistance: cùng màu → 0', () => {
  assert.equal(colorDistance({ r: 100, g: 150, b: 200 }, { r: 100, g: 150, b: 200 }), 0);
});

test('colorDistance: đen vs trắng → giá trị lớn', () => {
  const d = colorDistance({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
  assert.ok(d > 100, `Khoảng cách đen-trắng (${d}) phải > 100`);
});

test('colorDistance: không âm với mọi đầu vào', () => {
  const d = colorDistance({ r: 200, g: 50, b: 30 }, { r: 10, g: 180, b: 220 });
  assert.ok(d >= 0);
});

test('colorDistance: sai khác nhỏ trên cùng kênh → nhỏ hơn ngưỡng FLOOD_FILL_TOLERANCE', () => {
  // Hai màu gần nhau trong nền đơn sắc phải pass flood fill
  const d = colorDistance({ r: 240, g: 240, b: 240 }, { r: 245, g: 245, b: 245 });
  assert.ok(d < 44, `Distance (${d}) phải < FLOOD_FILL_TOLERANCE (44)`);
});

test('colorDistance: màu da vs nền trắng → vượt ngưỡng flood fill', () => {
  // Foreground skin pixel không được bị flood fill xóa nhầm
  const d = colorDistance({ r: 200, g: 155, b: 120 }, { r: 240, g: 240, b: 240 });
  assert.ok(d > 44, `Skin vs nền trắng (${d}) phải > FLOOD_FILL_TOLERANCE (44)`);
});

test('colorDistance: có trọng số luma (kênh G quan trọng hơn B)', () => {
  const dG = colorDistance({ r: 100, g: 200, b: 100 }, { r: 100, g: 100, b: 100 });
  const dB = colorDistance({ r: 100, g: 100, b: 200 }, { r: 100, g: 100, b: 100 });
  // G weight=0.587 > B weight=0.114 → sai lệch trên G tạo khoảng cách lớn hơn
  assert.ok(dG > dB, `Distance theo G (${dG.toFixed(2)}) phải > Distance theo B (${dB.toFixed(2)})`);
});

// ══════════════════════════════════════════════════════════════════════════════
// featherMask
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Helper: tạo mask 1D từ pattern 2D dễ đọc.
 * 1 = foreground (255), 0 = background.
 */
function makeMask(pattern2d) {
  const H = pattern2d.length;
  const W = pattern2d[0].length;
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      mask[y * W + x] = pattern2d[y][x] ? 255 : 0;
    }
  }
  return { mask, W, H };
}

test('featherMask: radius=0 → mask không thay đổi', () => {
  const { mask, W, H } = makeMask([
    [0, 0, 0],
    [0, 1, 0],
    [0, 0, 0],
  ]);
  const original = new Uint8Array(mask);
  featherMask(mask, W, H, 0);
  assert.deepEqual(mask, original);
});

test('featherMask: background pixel (0) luôn giữ nguyên = 0', () => {
  const { mask, W, H } = makeMask([
    [0, 0, 0, 0, 0],
    [0, 1, 1, 1, 0],
    [0, 1, 1, 1, 0],
    [0, 1, 1, 1, 0],
    [0, 0, 0, 0, 0],
  ]);
  featherMask(mask, W, H, 2);
  // Tất cả pixel nền (0) phải vẫn = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if ([0, 4].includes(y) || [0, 4].includes(x)) {
        assert.equal(mask[y * W + x], 0, `Background tại (${x},${y}) phải = 0`);
      }
    }
  }
});

test('featherMask: pixel trung tâm (xa biên) giữ alpha gần 255', () => {
  // 7×7 mask với foreground ở giữa — pixel tâm (3,3) cách biên 3 bước
  const pattern = Array.from({ length: 7 }, (_, y) =>
    Array.from({ length: 7 }, (_, x) =>
      x > 0 && x < 6 && y > 0 && y < 6 ? 1 : 0
    )
  );
  const { mask, W, H } = makeMask(pattern);
  featherMask(mask, W, H, 2);
  // Pixel tâm (3,3): khoảng cách đến biên = 2, dist/radius = 1 → alpha = 255
  assert.equal(mask[3 * W + 3], 255, 'Pixel trung tâm phải có alpha = 255');
});

test('featherMask: pixel sát biên có alpha < 255 (gradient mịn)', () => {
  const pattern = [
    [0, 0, 0, 0, 0],
    [0, 1, 1, 1, 0],
    [0, 1, 1, 1, 0],
    [0, 1, 1, 1, 0],
    [0, 0, 0, 0, 0],
  ];
  const { mask, W, H } = makeMask(pattern);
  featherMask(mask, W, H, 3);
  // Pixel (1,1): sát góc, khoảng cách đến background = sqrt(2) ≈ 1.414
  // alpha = 1.414/3 ≈ 0.47 → khoảng 120
  const cornerAlpha = mask[1 * W + 1];
  assert.ok(cornerAlpha > 0,   `Pixel góc (1,1) phải có alpha > 0`);
  assert.ok(cornerAlpha < 255, `Pixel góc (1,1) phải có alpha < 255 (gradient)`);
});

test('featherMask: radius lớn hơn kích thước mask → pixel trung tâm ≤ 255', () => {
  const { mask, W, H } = makeMask([
    [0, 0, 0],
    [0, 1, 0],
    [0, 0, 0],
  ]);
  featherMask(mask, W, H, 100);
  // Pixel duy nhất (1,1): dist đến biên = 1, alpha = 1/100 ≈ 2–3
  const alpha = mask[1 * W + 1];
  assert.ok(alpha >= 0,   'Alpha không được âm');
  assert.ok(alpha <= 255, 'Alpha không được vượt 255');
  assert.ok(alpha < 255,  'Với radius lớn, pixel gần biên phải có alpha < 255');
});

test('featherMask: mask toàn nền (không có foreground) → không thay đổi', () => {
  const mask = new Uint8Array(9); // toàn 0
  const original = new Uint8Array(mask);
  featherMask(mask, 3, 3, 2);
  assert.deepEqual(mask, original);
});

test('featherMask: gradient đơn điệu từ biên vào tâm', () => {
  // Mask 1×7 với foreground ở giữa (index 1–5), nền ở 0 và 6
  const mask = new Uint8Array([0, 255, 255, 255, 255, 255, 0]);
  featherMask(mask, 7, 1, 3);
  // Pixel gần biên (index 1) phải có alpha < pixel xa hơn (index 2)
  assert.ok(
    mask[1] <= mask[2],
    `Alpha tại index 1 (${mask[1]}) phải ≤ index 2 (${mask[2]})`,
  );
  assert.ok(
    mask[2] <= mask[3],
    `Alpha tại index 2 (${mask[2]}) phải ≤ index 3 (${mask[3]})`,
  );
});
