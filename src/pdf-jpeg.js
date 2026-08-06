const POINTS_PER_INCH = 72;
const MILLIMETERS_PER_INCH = 25.4;
const PDF_HEADER = Uint8Array.from([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a,
  0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
]);

function positiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new RangeError(`${label} phải là số dương hữu hạn.`);
  }
  return parsed;
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new RangeError(`${label} phải là số nguyên dương.`);
  }
  return parsed;
}

function asJpegBytes(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value ?? 0);
  if (
    bytes.length < 4
    || bytes[0] !== 0xff
    || bytes[1] !== 0xd8
    || bytes[bytes.length - 2] !== 0xff
    || bytes[bytes.length - 1] !== 0xd9
  ) {
    throw new TypeError('Dữ liệu JPEG không hợp lệ.');
  }
  return bytes;
}

function encodeAscii(value) {
  return new TextEncoder().encode(String(value));
}

function concatenateBytes(parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function formatPdfNumber(value) {
  return Number(value.toFixed(4)).toString();
}

function objectBytes(objectNumber, bodyParts) {
  return concatenateBytes([
    encodeAscii(`${objectNumber} 0 obj\n`),
    ...bodyParts,
    encodeAscii('\nendobj\n'),
  ]);
}

function streamObjectBytes(objectNumber, dictionary, streamBytes) {
  return objectBytes(objectNumber, [
    encodeAscii(`<< ${dictionary} /Length ${streamBytes.length} >>\nstream\n`),
    streamBytes,
    encodeAscii('\nendstream'),
  ]);
}

export function millimetersToPdfPoints(millimeters) {
  return (positiveNumber(millimeters, 'Kích thước millimeter') / MILLIMETERS_PER_INCH)
    * POINTS_PER_INCH;
}

export function createSinglePageJpegPdf({
  jpegBytes,
  imageWidthPx,
  imageHeightPx,
  pageWidthMm,
  pageHeightMm,
} = {}) {
  const image = asJpegBytes(jpegBytes);
  const widthPx = positiveInteger(imageWidthPx, 'Chiều rộng ảnh');
  const heightPx = positiveInteger(imageHeightPx, 'Chiều cao ảnh');
  const pageWidthPt = millimetersToPdfPoints(pageWidthMm);
  const pageHeightPt = millimetersToPdfPoints(pageHeightMm);
  const widthToken = formatPdfNumber(pageWidthPt);
  const heightToken = formatPdfNumber(pageHeightPt);

  const contentStream = encodeAscii(
    `q\n${widthToken} 0 0 ${heightToken} 0 0 cm\n/Im0 Do\nQ\n`,
  );
  const objects = [
    objectBytes(1, [encodeAscii('<< /Type /Catalog /Pages 2 0 R >>')]),
    objectBytes(2, [encodeAscii('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')]),
    objectBytes(3, [encodeAscii(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthToken} ${heightToken}] `
      + '/Resources << /ProcSet [/PDF /ImageC] /XObject << /Im0 5 0 R >> >> '
      + '/Contents 4 0 R >>',
    )]),
    streamObjectBytes(4, '', contentStream),
    streamObjectBytes(
      5,
      `/Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} `
      + '/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode',
      image,
    ),
  ];

  const offsets = [0];
  let cursor = PDF_HEADER.length;
  for (const object of objects) {
    offsets.push(cursor);
    cursor += object.length;
  }
  const xrefOffset = cursor;
  const xrefLines = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `),
  ];
  const trailer = encodeAscii([
    ...xrefLines,
    'trailer',
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    'startxref',
    String(xrefOffset),
    '%%EOF',
    '',
  ].join('\n'));

  return Object.freeze({
    bytes: concatenateBytes([PDF_HEADER, ...objects, trailer]),
    pageWidthPt,
    pageHeightPt,
    imageWidthPx: widthPx,
    imageHeightPx: heightPx,
    objectOffsets: Object.freeze(offsets.slice(1)),
    xrefOffset,
  });
}

export const PDF_POINTS_PER_INCH = POINTS_PER_INCH;
