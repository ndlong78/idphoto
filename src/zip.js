const ZIP32_MAX = 0xffffffff;
const ZIP16_MAX = 0xffff;
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const DOS_TIME_MIDNIGHT = 0;
const DOS_DATE_1980_01_01 = 0x0021;
const encoder = new TextEncoder();

const CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC32_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  CRC32_TABLE[index] = value >>> 0;
}

function asBytes(value) {
  if (typeof value === 'string') return encoder.encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError('ZIP entry data phải là string, ArrayBuffer hoặc typed array.');
}

function normalizeEntryName(name) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new TypeError('ZIP entry name là bắt buộc.');
  }
  if (
    name.includes('\0')
    || name.includes('/')
    || name.includes('\\')
    || name === '.'
    || name === '..'
  ) {
    throw new RangeError('ZIP entry chỉ được dùng tên file ở thư mục gốc.');
  }
  const nameBytes = encoder.encode(name);
  if (nameBytes.length > ZIP16_MAX) {
    throw new RangeError('ZIP entry name vượt giới hạn ZIP32.');
  }
  return { name, nameBytes };
}

function localFileHeader(entry) {
  const bytes = new Uint8Array(30);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, UTF8_FLAG, true);
  view.setUint16(8, STORE_METHOD, true);
  view.setUint16(10, DOS_TIME_MIDNIGHT, true);
  view.setUint16(12, DOS_DATE_1980_01_01, true);
  view.setUint32(14, entry.crc, true);
  view.setUint32(18, entry.data.length, true);
  view.setUint32(22, entry.data.length, true);
  view.setUint16(26, entry.nameBytes.length, true);
  view.setUint16(28, 0, true);
  return bytes;
}

function centralDirectoryHeader(entry) {
  const bytes = new Uint8Array(46);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, UTF8_FLAG, true);
  view.setUint16(10, STORE_METHOD, true);
  view.setUint16(12, DOS_TIME_MIDNIGHT, true);
  view.setUint16(14, DOS_DATE_1980_01_01, true);
  view.setUint32(16, entry.crc, true);
  view.setUint32(20, entry.data.length, true);
  view.setUint32(24, entry.data.length, true);
  view.setUint16(28, entry.nameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, entry.localOffset, true);
  return bytes;
}

function endOfCentralDirectory(entryCount, centralSize, centralOffset) {
  const bytes = new Uint8Array(22);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  return bytes;
}

function totalLength(parts) {
  return parts.reduce((sum, part) => sum + part.length, 0);
}

function concatenate(parts) {
  const output = new Uint8Array(totalLength(parts));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function crc32(value) {
  const bytes = asBytes(value);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createStoredZipBytes(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new TypeError('ZIP cần ít nhất một entry.');
  }
  if (entries.length > ZIP16_MAX) {
    throw new RangeError('Số entry vượt giới hạn ZIP32.');
  }

  const seenNames = new Set();
  const prepared = entries.map((entry) => {
    const { name, nameBytes } = normalizeEntryName(entry?.name);
    if (seenNames.has(name)) throw new RangeError(`ZIP entry bị trùng: ${name}`);
    seenNames.add(name);
    const data = asBytes(entry?.data);
    if (data.length > ZIP32_MAX) throw new RangeError(`ZIP entry quá lớn: ${name}`);
    return {
      name,
      nameBytes,
      data,
      crc: crc32(data),
      localOffset: 0,
    };
  });

  const localParts = [];
  let localOffset = 0;
  for (const entry of prepared) {
    entry.localOffset = localOffset;
    const header = localFileHeader(entry);
    localParts.push(header, entry.nameBytes, entry.data);
    localOffset += header.length + entry.nameBytes.length + entry.data.length;
    if (localOffset > ZIP32_MAX) throw new RangeError('ZIP vượt giới hạn dung lượng ZIP32.');
  }

  const centralOffset = localOffset;
  const centralParts = [];
  for (const entry of prepared) {
    const header = centralDirectoryHeader(entry);
    centralParts.push(header, entry.nameBytes);
  }
  const centralSize = totalLength(centralParts);
  if (centralSize > ZIP32_MAX || centralOffset + centralSize > ZIP32_MAX) {
    throw new RangeError('Central directory vượt giới hạn ZIP32.');
  }

  return concatenate([
    ...localParts,
    ...centralParts,
    endOfCentralDirectory(prepared.length, centralSize, centralOffset),
  ]);
}

export const ZIP_MIME_TYPE = 'application/zip';
