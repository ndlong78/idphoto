import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSinglePageJpegPdf,
  millimetersToPdfPoints,
} from '../src/pdf-jpeg.js';

const SAMPLE_JPEG = Uint8Array.from([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
  0xff, 0xd9,
]);

function asAscii(bytes) {
  return new TextDecoder('latin1').decode(bytes);
}

function findBytes(haystack, needle) {
  outer: for (let offset = 0; offset <= haystack.length - needle.length; offset += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[offset + index] !== needle[index]) continue outer;
    }
    return offset;
  }
  return -1;
}

test('millimeter được chuyển sang PDF point chính xác', () => {
  assert.ok(Math.abs(millimetersToPdfPoints(100) - 283.4645669) < 0.0001);
  assert.ok(Math.abs(millimetersToPdfPoints(297) - 841.8897638) < 0.0001);
});

test('PDF 10x15 chứa một JPEG full-page và xref trỏ đúng object', () => {
  const result = createSinglePageJpegPdf({
    jpegBytes: SAMPLE_JPEG,
    imageWidthPx: 1181,
    imageHeightPx: 1772,
    pageWidthMm: 100,
    pageHeightMm: 150,
  });
  const text = asAscii(result.bytes);

  assert.equal(text.startsWith('%PDF-1.4\n%'), true);
  assert.match(text, /\/MediaBox \[0 0 283\.4646 425\.1969\]/);
  assert.match(text, /\/Width 1181 \/Height 1772/);
  assert.match(text, /\/Filter \/DCTDecode/);
  assert.equal(findBytes(result.bytes, SAMPLE_JPEG) >= 0, true);
  assert.equal(result.objectOffsets.length, 5);

  result.objectOffsets.forEach((offset, index) => {
    assert.equal(
      asAscii(result.bytes.slice(offset, offset + 12)).startsWith(`${index + 1} 0 obj`),
      true,
    );
  });
  assert.equal(asAscii(result.bytes.slice(result.xrefOffset, result.xrefOffset + 4)), 'xref');
  assert.match(text, new RegExp(`startxref\\n${result.xrefOffset}\\n%%EOF`));
});

test('PDF A4 ngang giữ đúng page box và ma trận vẽ', () => {
  const result = createSinglePageJpegPdf({
    jpegBytes: SAMPLE_JPEG,
    imageWidthPx: 3508,
    imageHeightPx: 2480,
    pageWidthMm: 297,
    pageHeightMm: 210,
  });
  const text = asAscii(result.bytes);

  assert.match(text, /\/MediaBox \[0 0 841\.8898 595\.2756\]/);
  assert.match(text, /841\.8898 0 0 595\.2756 0 0 cm/);
  assert.equal(result.pageWidthPt > result.pageHeightPt, true);
});

test('PDF writer từ chối JPEG, pixel hoặc page size không hợp lệ', () => {
  assert.throws(() => createSinglePageJpegPdf({
    jpegBytes: new Uint8Array([1, 2, 3]),
    imageWidthPx: 100,
    imageHeightPx: 100,
    pageWidthMm: 100,
    pageHeightMm: 150,
  }), /JPEG không hợp lệ/);
  assert.throws(() => createSinglePageJpegPdf({
    jpegBytes: SAMPLE_JPEG,
    imageWidthPx: 0,
    imageHeightPx: 100,
    pageWidthMm: 100,
    pageHeightMm: 150,
  }), /Chiều rộng ảnh/);
  assert.throws(() => createSinglePageJpegPdf({
    jpegBytes: SAMPLE_JPEG,
    imageWidthPx: 100,
    imageHeightPx: 100,
    pageWidthMm: -1,
    pageHeightMm: 150,
  }), /millimeter/);
});
