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

async function uploadGeneratedPortrait(page) {
  await page.locator('#file-input').evaluate(async (input) => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Không tạo được canvas fixture.');
    ctx.fillStyle = '#eaf2fb';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1e3a5f';
    ctx.fillRect(70, 330, 180, 150);
    ctx.fillStyle = '#f0c8a4';
    ctx.beginPath();
    ctx.ellipse(160, 205, 72, 94, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#251913';
    ctx.beginPath();
    ctx.ellipse(160, 128, 77, 54, 0, Math.PI, Math.PI * 2);
    ctx.fill();

    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error('Không tạo được fixture PNG.')),
      'image/png',
    ));
    const file = new File([blob], 'print-sheet-source.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function waitForEditor(page) {
  await expect(page.locator('#editor-section')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#print-sheet-panel')).toBeVisible();
  await expect(page.locator('#btn-print-sheet')).toBeEnabled();
}

async function confirmPrintSheetDownload(page) {
  await page.locator('#btn-print-sheet').click();
  const dialog = page.locator('#export-readiness-dialog');
  await expect(dialog).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Vẫn tải xuống' }).click();
  return downloadPromise;
}

async function readDownloadBytes(download) {
  const path = await download.path();
  if (!path) throw new Error('Playwright không cung cấp file tải xuống.');
  return new Uint8Array(await readFile(path));
}

function readJpegDimensions(bytes) {
  const sofMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3,
    0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb,
    0xcd, 0xce, 0xcf,
  ]);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    const payloadOffset = offset + 2;
    if (sofMarkers.has(marker)) {
      return {
        height: (bytes[payloadOffset + 1] << 8) | bytes[payloadOffset + 2],
        width: (bytes[payloadOffset + 3] << 8) | bytes[payloadOffset + 4],
      };
    }
    offset += segmentLength;
  }
  return null;
}

test.beforeEach(async ({ page }) => {
  await installOfflineProcessingStubs(page);
  await page.goto('/');
  await uploadGeneratedPortrait(page);
  await waitForEditor(page);
});

test('xuất tờ 10x15 gồm sáu ảnh Schengen đúng pixel và 300 DPI', async ({ page }) => {
  await page.locator('button[data-fmt="schengen"]').click();
  await expect(page.locator('#size-badge')).toContainText('35 × 45 mm');
  await expect(page.locator('#print-sheet-summary')).toContainText('6/6 ảnh');
  await expect(page.locator('#print-sheet-summary')).toContainText('2 cột × 3 hàng');
  await expect(page.locator('#print-sheet-summary')).toContainText('35 × 45 mm mỗi ảnh');

  const download = await confirmPrintSheetDownload(page);
  const filename = 'photovisa_sheet_photo-10x15_schengen_6copies_1181x1772_300dpi.jpeg';
  expect(download.suggestedFilename()).toBe(filename);
  const bytes = await readDownloadBytes(download);
  expect(bytes.length).toBeGreaterThan(10_000);
  expect(readJpegDimensions(bytes)).toEqual({ width: 1181, height: 1772 });
  expect(readJpegDpi(bytes)).toMatchObject({ unit: 'dpi', x: 300, y: 300 });

  await expect(page.locator('#export-receipt-badge')).toHaveText('Tờ in');
  await expect(page.locator('#export-receipt-filename')).toHaveText(filename);
  await expect(page.locator('#export-receipt-meta')).toContainText('300 DPI');
  await expect(page.locator('#export-receipt-note')).toContainText('6 ảnh');
  await expect(page.locator('#export-receipt-note')).toContainText('có dấu cắt');
  await expect(page.locator('#s4')).toHaveClass(/active/);
});

test('xuất A4 ngang ba ảnh hộ chiếu và tắt dấu cắt', async ({ page }) => {
  await page.locator('#print-sheet-paper').selectOption('a4');
  await page.locator('#print-sheet-copies').selectOption('3');
  await page.locator('#print-sheet-crop-marks').uncheck();
  await expect(page.locator('#print-sheet-summary')).toContainText('A4 · ngang');
  await expect(page.locator('#print-sheet-summary')).toContainText('3/18 ảnh');
  await expect(page.locator('#print-sheet-summary')).toContainText('6 cột × 1 hàng');

  const download = await confirmPrintSheetDownload(page);
  const filename = 'photovisa_sheet_a4_passport-vn_3copies_3508x2480_300dpi.jpeg';
  expect(download.suggestedFilename()).toBe(filename);
  const bytes = await readDownloadBytes(download);
  expect(readJpegDimensions(bytes)).toEqual({ width: 3508, height: 2480 });
  expect(readJpegDpi(bytes)).toMatchObject({ unit: 'dpi', x: 300, y: 300 });

  await expect(page.locator('#export-receipt-badge')).toHaveText('Tờ in');
  await expect(page.locator('#export-receipt-note')).toContainText('A4');
  await expect(page.locator('#export-receipt-note')).toContainText('3 ảnh');
  await expect(page.locator('#export-receipt-note')).not.toContainText('có dấu cắt');
});
