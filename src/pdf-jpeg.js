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

function normalizeImageId(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError('ID ảnh PDF phải là chuỗi không rỗng.');
  }
  return value.trim();
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
  const prefix = dictionary ? `${dictionary} ` : '';
  return objectBytes(objectNumber, [
    encodeAscii(`<< ${prefix}/Length ${streamBytes.length} >>\nstream\n`),
    streamBytes,
    encodeAscii('\nendstream'),
  ]);
}

function normalizeImages(images) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new TypeError('PDF phải có ít nhất một ảnh JPEG.');
  }
  const ids = new Set();
  return images.map((image, index) => {
    const id = normalizeImageId(image?.id ?? `image-${index + 1}`);
    if (ids.has(id)) throw new RangeError(`ID ảnh PDF bị trùng: ${id}`);
    ids.add(id);
    return Object.freeze({
      id,
      jpegBytes: asJpegBytes(image?.jpegBytes),
      imageWidthPx: positiveInteger(image?.imageWidthPx, 'Chiều rộng ảnh'),
      imageHeightPx: positiveInteger(image?.imageHeightPx, 'Chiều cao ảnh'),
    });
  });
}

function normalizePages(pages, imageIds) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new TypeError('PDF phải có ít nhất một trang.');
  }
  return pages.map((page) => {
    const imageId = normalizeImageId(page?.imageId);
    if (!imageIds.has(imageId)) {
      throw new RangeError(`Trang PDF tham chiếu ảnh không tồn tại: ${imageId}`);
    }
    return Object.freeze({ imageId });
  });
}

function assemblePdf(objects) {
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

  return {
    bytes: concatenateBytes([PDF_HEADER, ...objects, trailer]),
    objectOffsets: Object.freeze(offsets.slice(1)),
    xrefOffset,
  };
}

export function millimetersToPdfPoints(millimeters) {
  return (positiveNumber(millimeters, 'Kích thước millimeter') / MILLIMETERS_PER_INCH)
    * POINTS_PER_INCH;
}

export function createMultiPageJpegPdf({
  images,
  pages,
  pageWidthMm,
  pageHeightMm,
} = {}) {
  const normalizedImages = normalizeImages(images);
  const imageIds = new Set(normalizedImages.map((image) => image.id));
  const normalizedPages = normalizePages(pages, imageIds);
  const pageWidthPt = millimetersToPdfPoints(pageWidthMm);
  const pageHeightPt = millimetersToPdfPoints(pageHeightMm);
  const widthToken = formatPdfNumber(pageWidthPt);
  const heightToken = formatPdfNumber(pageHeightPt);
  const pageCount = normalizedPages.length;
  const contentObjectNumber = 3 + pageCount;
  const firstImageObjectNumber = contentObjectNumber + 1;
  const imageObjectNumbers = new Map(normalizedImages.map((image, index) => [
    image.id,
    firstImageObjectNumber + index,
  ]));
  const pageObjectNumbers = normalizedPages.map((_, index) => 3 + index);

  const contentStream = encodeAscii(
    `q\n${widthToken} 0 0 ${heightToken} 0 0 cm\n/Im0 Do\nQ\n`,
  );
  const kids = pageObjectNumbers.map((number) => `${number} 0 R`).join(' ');
  const objects = [
    objectBytes(1, [encodeAscii('<< /Type /Catalog /Pages 2 0 R >>')]),
    objectBytes(2, [encodeAscii(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`)]),
    ...normalizedPages.map((page, index) => objectBytes(pageObjectNumbers[index], [encodeAscii(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthToken} ${heightToken}] `
      + `/Resources << /ProcSet [/PDF /ImageC] /XObject << /Im0 ${imageObjectNumbers.get(page.imageId)} 0 R >> >> `
      + `/Contents ${contentObjectNumber} 0 R >>`,
    )])),
    streamObjectBytes(contentObjectNumber, '', contentStream),
    ...normalizedImages.map((image) => streamObjectBytes(
      imageObjectNumbers.get(image.id),
      `/Type /XObject /Subtype /Image /Width ${image.imageWidthPx} /Height ${image.imageHeightPx} `
      + '/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode',
      image.jpegBytes,
    )),
  ];
  const assembled = assemblePdf(objects);

  return Object.freeze({
    ...assembled,
    pageWidthPt,
    pageHeightPt,
    pageCount,
    uniqueImageCount: normalizedImages.length,
    pageObjectNumbers: Object.freeze(pageObjectNumbers),
    contentObjectNumber,
    imageObjectNumbers: Object.freeze(Object.fromEntries(imageObjectNumbers)),
  });
}

export function createSinglePageJpegPdf({
  jpegBytes,
  imageWidthPx,
  imageHeightPx,
  pageWidthMm,
  pageHeightMm,
} = {}) {
  const result = createMultiPageJpegPdf({
    images: [{
      id: 'single-page-image',
      jpegBytes,
      imageWidthPx,
      imageHeightPx,
    }],
    pages: [{ imageId: 'single-page-image' }],
    pageWidthMm,
    pageHeightMm,
  });
  return Object.freeze({
    ...result,
    imageWidthPx: positiveInteger(imageWidthPx, 'Chiều rộng ảnh'),
    imageHeightPx: positiveInteger(imageHeightPx, 'Chiều cao ảnh'),
  });
}

export const PDF_POINTS_PER_INCH = POINTS_PER_INCH;
