export function downloadBlobFile(
  blob,
  filename,
  {
    documentRef = globalThis.document,
    urlApi = globalThis.URL,
    windowRef = globalThis.window,
  } = {},
) {
  if (!(blob instanceof Blob)) throw new TypeError('Download blob không hợp lệ.');
  if (typeof filename !== 'string' || !filename) throw new TypeError('Download filename là bắt buộc.');
  if (!documentRef || !urlApi?.createObjectURL) {
    throw new Error('Trình duyệt không hỗ trợ tải file.');
  }

  const objectUrl = urlApi.createObjectURL(blob);
  const link = documentRef.createElement('a');
  link.download = filename;
  link.href = objectUrl;
  link.hidden = true;
  documentRef.body?.appendChild(link);
  link.click();
  link.remove();
  windowRef?.setTimeout?.(() => urlApi.revokeObjectURL(objectUrl), 30_000);
  return { filename, sizeBytes: blob.size };
}
