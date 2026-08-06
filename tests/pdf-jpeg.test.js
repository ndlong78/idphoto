import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMultiPageJpegPdf,
  createSinglePageJpegPdf,
  millimetersToPdfPoints,
} from '../src/pdf-jpeg.js';

const SAMPLE_JPEG = Uint8Array.from([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
  0xff, 0xd9,
]);
const PARTIAL_JPEG = Uint8Array.from([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x05, 0x00, 0x01, 0x02,
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

function assertXrefOffsets(result) {
  result.objectOffsets.forEach((offset, index) => {
    assert.equal(
      asAscii(result.bytes.slice(offset, offset + 14)).startsWith(`${index + 1} 0 obj`),
      true,
    );
  });
  assert.equal(asAscii(result.bytes.slice(result.xrefOffset, result.xrefOffset + 4)), 'xref');
  assert.match(asAscii(result.bytes), new RegExp(`startxref\\n${result.xrefOffset}\\n%%EOF`));
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
  assert.equal(result.pageCount, 1);
  assert.equal(result.uniqueImageCount, 1);
  assertXrefOffsets(result);
});

test('PDF ba trang tái sử dụng JPEG cho hai trang đầy giống nhau', () => {
  const result = createMultiPageJpegPdf({
    images: [
      { id: 'full', jpegBytes: SAMPLE_JPEG, imageWidthPx: 1181, imageHeightPx: 1772 },
      { id: 'partial', jpegBytes: PARTIAL_JPEG, imageWidthPx: 1181, imageHeightPx: 1772 },
    ],
    pages: [
      { imageId: 'full' },
      { imageId: 'full' },
      { imageId: 'partial' },
    ],
    pageWidthMm: 100,
    pageHeightMm: 150,
  });
  const text = asAscii(result.bytes);

  assert.equal(result.pageCount, 3);
  assert.equal(result.uniqueImageCount, 2);
  assert.deepEqual(result.pageObjectNumbers, [3, 4, 5]);
  assert.equal(result.contentObjectNumber, 6);
  assert.deepEqual(result.imageObjectNumbers, { full: 7, partial: 8 });
  assert.match(text, /\/Kids \[3 0 R 4 0 R 5 0 R\] \/Count 3/);
  assert.equal((text.match(/\/Subtype \/Image/g) ?? []).length, 2);
  assert.equal((text.match(/\/Im0 7 0 R/g) ?? []).length, 2);
  assert.equal((text.match(/\/Im0 8 0 R/g) ?? []).length, 1);
  assert.equal((text.match(/\/Contents 6 0 R/g) ?? []).length, 3);
  assert.equal(result.objectOffsets.length, 8);
  assertXrefOffsets(result);
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

test('PDF writer từ chối JPEG, pixel, page hoặc image reference không hợp lệ', () => {
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
  assert.throws(() => createMultiPageJpegPdf({
    images: [
      { id: 'same', jpegBytes: SAMPLE_JPEG, imageWidthPx: 100, imageHeightPx: 100 },
      { id: 'same', jpegBytes: PARTIAL_JPEG, imageWidthPx: 100, imageHeightPx: 100 },
    ],
    pages: [{ imageId: 'same' }],
    pageWidthMm: 100,
    pageHeightMm: 150,
  }), /bị trùng/);
  assert.throws(() => createMultiPageJpegPdf({
    images: [{ id: 'full', jpegBytes: SAMPLE_JPEG, imageWidthPx: 100, imageHeightPx: 100 }],
    pages: [{ imageId: 'missing' }],
    pageWidthMm: 100,
    pageHeightMm: 150,
  }), /không tồn tại/);
});
