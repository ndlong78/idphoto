import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { readJpegDpi } from '../src/image-metadata.js';

const AI_STUB = `
export async function warmupAi() { return false; }
export async function loadFaceModels() { return false; }
export async function runBackgroundRemoval() { return null; }
`;

const FACE_STUB = `
export async function detectFacesWithLandmarks() { return null; }
`;

async function installOfflineProcessingStubs(page) {
  await page.route('**/src/ai.js', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript; charset=utf-8',
    body: AI_STUB,
  }));
  await page.route('**/src/face-detection.js', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript; charset=utf-8',
    body: FACE_STUB,
  }));
  await page.route(/^https:\/\//, (route) => route.abort());
}

async function uploadGeneratedPortrait(page, filename = 'e2e-portrait.png') {
  await page.locator('#file-input').evaluate(async (input, uploadName) => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Không tạo được canvas fixture.');

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#dbeafe');
    gradient.addColorStop(1, '#eff6ff');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#1e3a5f';
    ctx.fillRect(68, 330, 184, 150);
    ctx.fillStyle = '#f2c9a5';
    ctx.beginPath();
    ctx.ellipse(160, 205, 73, 94, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b1d17';
    ctx.beginPath();
    ctx.ellipse(160, 125, 78, 54, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#172033';
    ctx.beginPath();
    ctx.arc(132, 202, 6, 0, Math.PI * 2);
    ctx.arc(188, 202, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#9a5f4a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(160, 245, 25, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error('Không tạo được PNG fixture.')),
        'image/png',
      );
    });
    const file = new File([blob], uploadName, {
      type: 'image/png',
      lastModified: 1_786_000_000_000,
    });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, filename);
}

async function waitForEditor(page) {
  await expect(page.locator('#editor-section')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#upload-section')).toBeHidden();
  await expect(page.locator('#s3')).toHaveClass(/active/);
  await expect(page.locator('#export-readiness-panel')).toBeVisible();
  await expect(page.locator('#manual-review-panel')).toBeVisible();
  await expect(page.locator('#export-readiness-note')).toContainText('Nút tải sẽ mở bước xác nhận');

  const canvasState = await page.locator('#result-canvas').evaluate((canvas) => ({
    width: canvas.width,
    height: canvas.height,
  }));
  expect(canvasState.width).toBeGreaterThan(0);
  expect(canvasState.height).toBeGreaterThan(0);
}

async function waitForUiRendering(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await page.waitForTimeout(100);
}

async function confirmAndCaptureDownload(page, triggerSelector) {
  await page.locator(triggerSelector).click();
  const dialog = page.locator('#export-readiness-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Không có alpha mask AI');
  await expect(dialog).toContainText('Checklist thủ công');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Vẫn tải xuống' }).click();
  return downloadPromise;
}

async function readDownloadBytes(download) {
  const path = await download.path();
  if (!path) throw new Error('Playwright không cung cấp đường dẫn file tải.');
  return new Uint8Array(await readFile(path));
}

function readJpegDimensions(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const sofMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3,
    0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb,
    0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    const payloadOffset = offset + 2;
    if (sofMarkers.has(marker) && payloadOffset + 5 <= bytes.length) {
      return {
        height: (bytes[payloadOffset + 1] << 8) | bytes[payloadOffset + 2],
        width: (bytes[payloadOffset + 3] << 8) | bytes[payloadOffset + 4],
      };
    }
    offset += segmentLength;
  }
  return null;
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

test.beforeEach(async ({ page }) => {
  await installOfflineProcessingStubs(page);
  await page.goto('/');
});

test('upload → editor → chỉnh preset → xác nhận → tải JPG thật với kích thước và DPI đúng', async ({ page }) => {
  await uploadGeneratedPortrait(page);
  await waitForEditor(page);

  await page.locator('button[data-fmt="us-visa"]').click();
  await expect(page.locator('#size-badge')).toHaveText('51 × 51 mm');
  await page.locator('button.sw[data-c="201,223,240"]').click();
  await page.locator('#bright').evaluate((input) => {
    input.value = '12';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#bv')).toHaveText('12');
  await expect(page.locator('button.sw[data-c="201,223,240"]')).toHaveClass(/active/);
  await waitForUiRendering(page);

  const download = await confirmAndCaptureDownload(page, '#btn-jpg-300');
  const expectedFilename = 'photovisa_us-visa_602x602_300dpi.jpeg';
  expect(download.suggestedFilename()).toBe(expectedFilename);

  const bytes = await readDownloadBytes(download);
  expect(bytes.length).toBeGreaterThan(1_000);
  expect(readJpegDimensions(bytes)).toEqual({ width: 602, height: 602 });
  const dpi = readJpegDpi(bytes);
  expect(dpi?.unit).toBe('dpi');
  expect(dpi?.x).toBe(300);
  expect(dpi?.y).toBe(300);

  await expect(page.locator('#export-receipt-badge')).toHaveText('Ảnh đơn');
  await expect(page.locator('#export-receipt-filename')).toHaveText(expectedFilename);
  await expect(page.locator('#export-receipt-meta')).toContainText('300 DPI');
  await expect(page.locator('#s4')).toHaveClass(/active/);
});

test('upload → checklist → bật audit → xác nhận → tải ZIP chứa ảnh thật và audit đầy đủ', async ({ page }) => {
  await uploadGeneratedPortrait(page, 'private-source-name.png');
  await waitForEditor(page);

  const markAll = page.getByRole('button', { name: 'Đánh dấu tất cả' });
  await expect(markAll).toBeEnabled();
  await markAll.click();
  const checklistStatus = await page.locator('#manual-review-status').textContent();
  const counts = checklistStatus?.match(/^(\d+)\/(\d+)/);
  expect(counts).not.toBeNull();
  expect(Number(counts?.[1])).toBeGreaterThan(0);
  expect(counts?.[1]).toBe(counts?.[2]);

  await page.locator('#manual-review-audit-enabled').check();
  await expect(page.locator('#manual-review-audit-enabled')).toBeChecked();

  const download = await confirmAndCaptureDownload(page, '#btn-jpg-300');
  const imageFilename = 'photovisa_passport-vn_472x709_300dpi.jpeg';
  const bundleFilename = 'photovisa_passport-vn_472x709_300dpi.bundle.zip';
  expect(download.suggestedFilename()).toBe(bundleFilename);

  const entries = parseStoredZipEntries(await readDownloadBytes(download));
  expect(entries).toHaveLength(2);
  expect(entries.every((entry) => entry.method === 0)).toBe(true);
  expect(entries[0].name).toBe(imageFilename);
  expect(entries[1].name).toBe('photovisa_passport-vn_472x709_300dpi.audit.json');

  expect(readJpegDimensions(entries[0].data)).toEqual({ width: 472, height: 709 });
  const dpi = readJpegDpi(entries[0].data);
  expect(dpi?.x).toBe(300);
  expect(dpi?.y).toBe(300);

  const audit = JSON.parse(new TextDecoder().decode(entries[1].data));
  expect(audit.kind).toBe('idphoto-export-audit');
  expect(audit.source.mimeType).toBe('image/png');
  expect(audit.export.imageFilename).toBe(imageFilename);
  expect(audit.export.delivery).toBe('bundle-zip');
  expect(audit.profile.formatKey).toBe('passport-vn');
  expect(audit.readiness.userConfirmed).toBe(true);
  expect(audit.readiness.manualTotal).toBeGreaterThan(0);
  expect(audit.readiness.manualReviewed).toBe(audit.readiness.manualTotal);
  expect(audit.readiness.manualPending).toBe(0);
  expect(audit.privacy.containsImageData).toBe(false);
  expect(audit.privacy.containsFaceGeometry).toBe(false);
  expect(audit.privacy.containsOriginalFilename).toBe(false);
  expect(JSON.stringify(audit)).not.toContain('private-source-name.png');

  await expect(page.locator('#export-receipt-badge')).toHaveText('Gói ZIP');
  await expect(page.locator('#export-receipt-filename')).toHaveText(bundleFilename);
  await expect(page.locator('#export-receipt-entries li')).toHaveCount(2);
  await expect(page.locator('#s4')).toHaveClass(/active/);
});
