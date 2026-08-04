import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const IMAGE_FILENAME = 'photovisa_e2e_1205x1205_600dpi.jpeg';
const IMAGE_BYTES = [0xff, 0xd8, 0xff, 0xd9];

async function openExportSurface(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    document.body.innerHTML = `
      <main>
        <section class="ctrl-dl">
          <div id="manual-review-panel"></div>
          <div id="renote"></div>
        </section>
      </main>
    `;
    const { startExportReceiptView } = await import('/src/export-receipt-view.js');
    const {
      downloadRecoveryImage,
      retryExportBundle,
    } = await import('/src/export-recovery.js');
    startExportReceiptView({
      documentRef: document,
      onRetryBundle: () => retryExportBundle(),
      onDownloadImage: () => downloadRecoveryImage(),
    });
  });
  await expect(page.locator('#export-receipt-panel')).toBeVisible();
}

async function readDownloadBytes(download) {
  const path = await download.path();
  if (!path) throw new Error('Playwright không cung cấp đường dẫn file tải.');
  return new Uint8Array(await readFile(path));
}

function parseStoredZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries = [];
  let offset = 0;

  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + size;
    entries.push({
      name: decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)),
      method,
      data: bytes.slice(dataStart, dataEnd),
    });
    offset = dataEnd;
  }

  return entries;
}

async function downloadBundle(page) {
  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(async ({ imageFilename, imageBytes }) => {
    const { stageExportForBundle } = await import('/src/export-delivery-session.js');
    const { downloadExportAudit } = await import('/src/export-audit.js');
    stageExportForBundle({
      filename: imageFilename,
      bytes: new Uint8Array(imageBytes),
      mimeType: 'image/jpeg',
      width: 1205,
      height: 1205,
      targetDpi: 600,
    });
    downloadExportAudit({
      schemaVersion: 1,
      kind: 'idphoto-export-audit',
      export: {
        imageFilename,
        mode: 'jpeg600',
        widthPx: 1205,
        heightPx: 1205,
        dpi: 600,
      },
      profile: { formatKey: 'us-visa' },
    });
  }, { imageFilename: IMAGE_FILENAME, imageBytes: IMAGE_BYTES });
  return downloadPromise;
}

async function triggerRetryableFallback(page) {
  const fallbackDownloadPromise = page.waitForEvent('download');
  await page.evaluate(async ({ imageFilename, imageBytes }) => {
    const { stageExportForBundle } = await import('/src/export-delivery-session.js');
    const { downloadExportAudit } = await import('/src/export-audit.js');
    stageExportForBundle({
      filename: imageFilename,
      bytes: new Uint8Array(imageBytes),
      mimeType: 'image/jpeg',
      width: 1205,
      height: 1205,
      targetDpi: 600,
    });

    const objectTypes = new Map();
    const urlApi = {
      createObjectURL(blob) {
        const objectUrl = URL.createObjectURL(blob);
        objectTypes.set(objectUrl, blob.type);
        return objectUrl;
      },
      revokeObjectURL(objectUrl) {
        objectTypes.delete(objectUrl);
        URL.revokeObjectURL(objectUrl);
      },
    };
    const documentRef = {
      body: document.body,
      createElement(tagName) {
        const element = document.createElement(tagName);
        if (tagName === 'a') {
          const actualClick = element.click.bind(element);
          element.click = () => {
            if (objectTypes.get(element.href) === 'application/zip') {
              throw new Error('Simulated browser ZIP delivery failure');
            }
            actualClick();
          };
        }
        return element;
      },
    };

    try {
      downloadExportAudit({
        schemaVersion: 1,
        kind: 'idphoto-export-audit',
        export: {
          imageFilename,
          mode: 'jpeg600',
          widthPx: 1205,
          heightPx: 1205,
          dpi: 600,
        },
        profile: { formatKey: 'us-visa' },
      }, { documentRef, urlApi, windowRef: window });
    } catch (error) {
      if (!error?.imageFallbackDownloaded) throw error;
    }
  }, { imageFilename: IMAGE_FILENAME, imageBytes: IMAGE_BYTES });
  return fallbackDownloadPromise;
}

test.beforeEach(async ({ page }) => {
  await openExportSurface(page);
});

test('tải ảnh đơn và cập nhật receipt bằng download event thật', async ({ page }) => {
  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(async ({ imageFilename, imageBytes }) => {
    const { downloadBlobFile } = await import('/src/download.js');
    const { recordExportReceipt } = await import('/src/export-receipt.js');
    const blob = new Blob([new Uint8Array(imageBytes)], { type: 'image/jpeg' });
    downloadBlobFile(blob, imageFilename);
    recordExportReceipt({
      delivery: 'image',
      filename: imageFilename,
      sizeBytes: blob.size,
      mimeType: blob.type,
      mode: 'jpeg600',
      formatKey: 'us-visa',
      widthPx: 1205,
      heightPx: 1205,
      dpi: 600,
    });
  }, { imageFilename: IMAGE_FILENAME, imageBytes: IMAGE_BYTES });

  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(IMAGE_FILENAME);
  expect([...await readDownloadBytes(download)]).toEqual(IMAGE_BYTES);
  await expect(page.locator('#export-receipt-badge')).toHaveText('Ảnh đơn');
  await expect(page.locator('#export-receipt-filename')).toHaveText(IMAGE_FILENAME);
  await expect(page.locator('#export-receipt-meta')).toContainText('600 DPI');
});

test('ZIP chứa đúng ảnh và audit JSON, receipt liệt kê hai entry', async ({ page }) => {
  const download = await downloadBundle(page);
  expect(download.suggestedFilename()).toBe('photovisa_e2e_1205x1205_600dpi.bundle.zip');

  const entries = parseStoredZipEntries(await readDownloadBytes(download));
  expect(entries).toHaveLength(2);
  expect(entries.every((entry) => entry.method === 0)).toBe(true);
  expect(entries[0].name).toBe(IMAGE_FILENAME);
  expect([...entries[0].data]).toEqual(IMAGE_BYTES);
  expect(entries[1].name).toBe('photovisa_e2e_1205x1205_600dpi.audit.json');
  const audit = JSON.parse(new TextDecoder().decode(entries[1].data));
  expect(audit.kind).toBe('idphoto-export-audit');
  expect(audit.export.imageFilename).toBe(IMAGE_FILENAME);

  await expect(page.locator('#export-receipt-badge')).toHaveText('Gói ZIP');
  await expect(page.locator('#export-receipt-entries li')).toHaveCount(2);
  await expect(page.locator('#export-receipt-entries')).toContainText(IMAGE_FILENAME);
});

test('browser từ chối ZIP: tải ảnh fallback rồi thử lại ZIP thành công', async ({ page }) => {
  const fallbackDownload = await triggerRetryableFallback(page);
  expect(fallbackDownload.suggestedFilename()).toBe(IMAGE_FILENAME);
  expect([...await readDownloadBytes(fallbackDownload)]).toEqual(IMAGE_BYTES);

  await expect(page.locator('#export-receipt-badge')).toHaveText('Ảnh fallback');
  await expect(page.getByRole('button', { name: 'Thử lại ZIP' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tải lại ảnh đơn' })).toBeVisible();

  const retryDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Thử lại ZIP' }).click();
  const retryDownload = await retryDownloadPromise;
  expect(retryDownload.suggestedFilename()).toBe('photovisa_e2e_1205x1205_600dpi.bundle.zip');
  expect(parseStoredZipEntries(await readDownloadBytes(retryDownload))).toHaveLength(2);

  await expect(page.locator('#export-receipt-badge')).toHaveText('Gói ZIP');
  await expect(page.locator('#export-receipt-actions')).toBeHidden();
  await expect(page.locator('#export-receipt-action-status')).toContainText('Đã gửi lại gói ZIP');
});

test('browser từ chối ZIP: người dùng có thể tải lại ảnh đơn', async ({ page }) => {
  await triggerRetryableFallback(page);
  const imageDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Tải lại ảnh đơn' }).click();
  const imageDownload = await imageDownloadPromise;

  expect(imageDownload.suggestedFilename()).toBe(IMAGE_FILENAME);
  expect([...await readDownloadBytes(imageDownload)]).toEqual(IMAGE_BYTES);
  await expect(page.locator('#export-receipt-badge')).toHaveText('Ảnh đơn');
  await expect(page.locator('#export-receipt-actions')).toBeHidden();
  await expect(page.locator('#export-receipt-action-status')).toContainText('Đã gửi lại ảnh đơn');
});
