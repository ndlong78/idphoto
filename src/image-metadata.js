const JPEG_SOI = [0xff, 0xd8];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JFIF_IDENTIFIER = [0x4a, 0x46, 0x49, 0x46, 0x00];
const PNG_PHYS_TYPE = [0x70, 0x48, 0x59, 0x73];
const MAX_JFIF_DENSITY = 0xffff;
const MAX_UINT32 = 0xffffffff;

function asUint8Array(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError('Expected ArrayBuffer or Uint8Array image data.');
}

function assertDpi(dpi, maxValue = Number.POSITIVE_INFINITY) {
  if (!Number.isFinite(dpi) || dpi <= 0) {
    throw new RangeError('DPI must be a positive finite number.');
  }
  const rounded = Math.round(dpi);
  if (rounded > maxValue) {
    throw new RangeError(`DPI must not exceed ${maxValue}.`);
  }
  return rounded;
}

function startsWithBytes(bytes, expected, offset = 0) {
  if (bytes.length < offset + expected.length) return false;
  return expected.every((value, index) => bytes[offset + index] === value);
}

function readUint32(bytes, offset) {
  return (
    bytes[offset] * 0x1000000
    + bytes[offset + 1] * 0x10000
    + bytes[offset + 2] * 0x100
    + bytes[offset + 3]
  ) >>> 0;
}

function writeUint32(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function bytesToAscii(bytes, offset, length) {
  let text = '';
  for (let i = 0; i < length; i++) text += String.fromCharCode(bytes[offset + i]);
  return text;
}

export function dpiToPixelsPerMeter(dpi) {
  const roundedDpi = assertDpi(dpi);
  const pixelsPerMeter = Math.round(roundedDpi / 0.0254);
  if (pixelsPerMeter > MAX_UINT32) {
    throw new RangeError('DPI is too large for PNG pHYs metadata.');
  }
  return pixelsPerMeter;
}

function createJfifSegment(dpi) {
  const density = assertDpi(dpi, MAX_JFIF_DENSITY);
  return new Uint8Array([
    0xff, 0xe0,
    0x00, 0x10,
    ...JFIF_IDENTIFIER,
    0x01, 0x02,
    0x01,
    (density >>> 8) & 0xff, density & 0xff,
    (density >>> 8) & 0xff, density & 0xff,
    0x00, 0x00,
  ]);
}

function findJfifSegment(bytes) {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) break;

    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;

    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    const segmentStart = offset - 2;
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;

    const payloadOffset = offset + 2;
    if (
      marker === 0xe0
      && segmentLength >= 16
      && startsWithBytes(bytes, JFIF_IDENTIFIER, payloadOffset)
    ) {
      return { segmentStart, payloadOffset };
    }
    offset += segmentLength;
  }
  return null;
}

export function embedJpegDpi(input, dpi) {
  const bytes = asUint8Array(input);
  if (!startsWithBytes(bytes, JPEG_SOI)) {
    throw new TypeError('Invalid JPEG data: missing SOI marker.');
  }

  const density = assertDpi(dpi, MAX_JFIF_DENSITY);
  const existing = findJfifSegment(bytes);
  if (existing) {
    const output = new Uint8Array(bytes);
    const unitsOffset = existing.payloadOffset + 7;
    output[unitsOffset] = 0x01;
    output[unitsOffset + 1] = (density >>> 8) & 0xff;
    output[unitsOffset + 2] = density & 0xff;
    output[unitsOffset + 3] = (density >>> 8) & 0xff;
    output[unitsOffset + 4] = density & 0xff;
    return output;
  }

  const jfif = createJfifSegment(density);
  const output = new Uint8Array(bytes.length + jfif.length);
  output.set(bytes.subarray(0, 2), 0);
  output.set(jfif, 2);
  output.set(bytes.subarray(2), 2 + jfif.length);
  return output;
}

export function readJpegDpi(input) {
  const bytes = asUint8Array(input);
  if (!startsWithBytes(bytes, JPEG_SOI)) return null;
  const jfif = findJfifSegment(bytes);
  if (!jfif) return null;

  const units = bytes[jfif.payloadOffset + 7];
  const xDensity = (bytes[jfif.payloadOffset + 8] << 8) | bytes[jfif.payloadOffset + 9];
  const yDensity = (bytes[jfif.payloadOffset + 10] << 8) | bytes[jfif.payloadOffset + 11];
  if (units === 1) return { x: xDensity, y: yDensity, unit: 'dpi' };
  if (units === 2) {
    return {
      x: xDensity * 2.54,
      y: yDensity * 2.54,
      unit: 'dpi',
    };
  }
  return { x: xDensity, y: yDensity, unit: 'aspect-ratio' };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createPngChunk(typeBytes, data) {
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

function createPhysChunk(dpi) {
  const pixelsPerMeter = dpiToPixelsPerMeter(dpi);
  const data = new Uint8Array(9);
  writeUint32(data, 0, pixelsPerMeter);
  writeUint32(data, 4, pixelsPerMeter);
  data[8] = 1;
  return createPngChunk(PNG_PHYS_TYPE, data);
}

function parsePngChunks(bytes) {
  if (!startsWithBytes(bytes, PNG_SIGNATURE)) {
    throw new TypeError('Invalid PNG data: missing PNG signature.');
  }

  const chunks = [];
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const end = offset + 12 + length;
    if (end > bytes.length) {
      throw new TypeError('Invalid PNG data: truncated chunk.');
    }
    const type = bytesToAscii(bytes, offset + 4, 4);
    chunks.push({ type, start: offset, end, dataOffset: offset + 8, length });
    offset = end;
    if (type === 'IEND') break;
  }
  return chunks;
}

export function embedPngDpi(input, dpi) {
  const bytes = asUint8Array(input);
  const chunks = parsePngChunks(bytes);
  const phys = createPhysChunk(dpi);
  const existing = chunks.find((chunk) => chunk.type === 'pHYs');

  if (existing) {
    const output = new Uint8Array(bytes.length - (existing.end - existing.start) + phys.length);
    output.set(bytes.subarray(0, existing.start), 0);
    output.set(phys, existing.start);
    output.set(bytes.subarray(existing.end), existing.start + phys.length);
    return output;
  }

  const ihdr = chunks.find((chunk) => chunk.type === 'IHDR');
  if (!ihdr) throw new TypeError('Invalid PNG data: missing IHDR chunk.');
  const insertAt = ihdr.end;
  const output = new Uint8Array(bytes.length + phys.length);
  output.set(bytes.subarray(0, insertAt), 0);
  output.set(phys, insertAt);
  output.set(bytes.subarray(insertAt), insertAt + phys.length);
  return output;
}

export function readPngDpi(input) {
  const bytes = asUint8Array(input);
  let chunks;
  try {
    chunks = parsePngChunks(bytes);
  } catch {
    return null;
  }
  const phys = chunks.find((chunk) => chunk.type === 'pHYs' && chunk.length === 9);
  if (!phys || bytes[phys.dataOffset + 8] !== 1) return null;
  const xPpm = readUint32(bytes, phys.dataOffset);
  const yPpm = readUint32(bytes, phys.dataOffset + 4);
  return {
    x: xPpm * 0.0254,
    y: yPpm * 0.0254,
    unit: 'dpi',
  };
}

export async function canvasToDpiBlob(canvas, mimeType, dpi, quality = 1) {
  if (!canvas || typeof canvas.toBlob !== 'function') {
    throw new TypeError('A canvas with toBlob() is required.');
  }
  if (mimeType !== 'image/jpeg' && mimeType !== 'image/png') {
    throw new TypeError(`Unsupported export MIME type: ${mimeType}`);
  }

  const sourceBlob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Canvas export returned an empty blob.')),
      mimeType,
      quality,
    );
  });
  const sourceBytes = new Uint8Array(await sourceBlob.arrayBuffer());
  const outputBytes = mimeType === 'image/jpeg'
    ? embedJpegDpi(sourceBytes, dpi)
    : embedPngDpi(sourceBytes, dpi);
  return new Blob([outputBytes], { type: mimeType });
}
