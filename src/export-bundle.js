import { createStoredZipBytes, ZIP_MIME_TYPE } from './zip.js';

export function buildExportBundleFilename(imageFilename) {
  const safeName = typeof imageFilename === 'string' && imageFilename
    ? imageFilename
    : 'photovisa-export';
  const base = safeName.replace(/\.[^.]+$/, '');
  return `${base}.bundle.zip`;
}

export function createExportBundle({
  imageFilename,
  imageBytes,
  auditFilename,
  auditContent,
} = {}) {
  if (typeof imageFilename !== 'string' || !imageFilename) {
    throw new TypeError('imageFilename là bắt buộc.');
  }
  if (!(imageBytes instanceof Uint8Array)) {
    throw new TypeError('imageBytes phải là Uint8Array.');
  }
  if (typeof auditFilename !== 'string' || !auditFilename) {
    throw new TypeError('auditFilename là bắt buộc.');
  }
  if (typeof auditContent !== 'string') {
    throw new TypeError('auditContent phải là JSON string.');
  }

  const bytes = createStoredZipBytes([
    { name: imageFilename, data: imageBytes },
    { name: auditFilename, data: auditContent },
  ]);
  const blob = new Blob([bytes], { type: ZIP_MIME_TYPE });
  return {
    blob,
    filename: buildExportBundleFilename(imageFilename),
    sizeBytes: blob.size,
    entries: Object.freeze([
      Object.freeze({ name: imageFilename, sizeBytes: imageBytes.length }),
      Object.freeze({ name: auditFilename, sizeBytes: new TextEncoder().encode(auditContent).length }),
    ]),
  };
}
