import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { readJpegDpi, readPngDpi } from '../src/image-metadata.js';

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

async function uploadGeneratedPortrait(page, filename = 'mobile-portrait.png') {
  await page.locator('#file-input').evaluate(async (input, uploadName) => {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 450;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Không tạo được canvas fixture.');

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#dbeafe');
    gradient.addColorStop(1, '#eff6ff');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#1e3a5f';
    ctx.fillRect(64, 310, 172, 140);
    ctx.fillStyle = '#f2c9a5';
    ctx.beginPath();
    ctx.ellipse(150, 190, 68, 88, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b1d17';
    ctx.beginPath();
    ctx.ellipse(150, 116, 73, 50, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#172033';
    ctx.beginPath();
    ctx.arc(124, 188, 6, 0, Math.PI * 2);
    ctx.arc(176, 188, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#9a5f4a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(150, 229, 23, 0.15 * Math.PI, 0.85 * Math.PI);
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

async function waitForMobileEditor(page) {
  await expect(page.locator('#editor-section')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#upload-section')).toBeHidden();
  await expect(page.locator('#s3')).toHaveClass(/active/);
  await expect(page.locator('#export-readiness-panel')).toBeVisible();
  await expect(page.locator('#manual-review-panel')).toBeVisible();

  const panels = await page.locator('.panel-card').evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, right: box.right };
  }));
  expect(panels).toHaveLength(2);
  expect(panels[1].y).toBeGreaterThan(panels[0].y);

  await assertNoHorizontalOverflow(page);
}

async function assertNoHorizontalOverflow(page) {
  const layout = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    bodyScrollWidth: document.body.scrollWidth,
    rootScrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.bodyScrollWidth).toBeLessThanOrEqual(layout.innerWidth + 1);
  expect(layout.rootScrollWidth).toBeLessThanOrEqual(layout.innerWidth + 1);
}

async function getCropState(page) {
  return page.evaluate(async () => {
    const { state } = await import('/src/state.js');
    return {
      x: state.crop.x,
      y: state.crop.y,
      scale: state.crop.scale,
    };
  });
}

async function exerciseTouchCrop(page) {
  const canvas = page.locator('#crop-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Không xác định được vị trí crop canvas.');

  const client = await page.context().newCDPSession(page);
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const point = (x, y, id) => ({ x, y, id, radiusX: 6, radiusY: 6, force: 1 });

  const beforeDrag = await getCropState(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [point(centerX, centerY, 1)],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [point(centerX + 34, centerY - 22, 1)],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(150);

  const afterDrag = await getCropState(page);
  expect(Math.abs(afterDrag.x - beforeDrag.x)).toBeGreaterThan(20);
  expect(Math.abs(afterDrag.y - beforeDrag.y)).toBeGreaterThan(10);

  const beforePinch = await getCropState(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      point(centerX - 30, centerY, 1),
      point(centerX + 30, centerY, 2),
    ],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      point(centerX - 55, centerY, 1),
      point(centerX + 55, centerY, 2),
    ],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(180);
  await client.detach();

  const afterPinch = await getCropState(page);
  expect(afterPinch.scale).toBeGreaterThan(beforePinch.scale * 1.25);
  await expect(page.locator('#zoom-lbl')).not.toHaveText('100%');
}

async function assertMobileReadinessDialog(page) {
  const dialog = page.locator('#export-readiness-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Không có alpha mask AI');
  await page.waitForFunction(() => (
    [...document.styleSheets].some((sheet) => (
      sheet.href?.endsWith('/export-readiness.css') && sheet.cssRules.length > 0
    ))
  ));

  const geometry = await dialog.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const card = element.querySelector('.export-readiness-dialog-card');
    return {
      left: box.left,
      right: box.right,
      viewportWidth: window.innerWidth,
      cardClientWidth: card?.clientWidth ?? 0,
      cardScrollWidth: card?.scrollWidth ?? 0,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.cardScrollWidth).toBeLessThanOrEqual(geometry.cardClientWidth + 1);

  const buttons = await dialog.locator('footer button').evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { y: box.y, width: box.width, height: box.height };
  }));
  expect(buttons).toHaveLength(2);
  expect(Math.abs(buttons[1].y - buttons[0].y)).toBeGreaterThan(20);
  expect(Math.abs(buttons[0].width - buttons[1].width)).toBeLessThanOrEqual(2);
  expect(buttons.every((button) => button.height >= 40)).toBe(true);
  await assertNoHorizontalOverflow(page);
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

function readPngDimensions(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((value, index) => bytes[index] === value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
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

async function openDownloadDialog(page, buttonSelector) {
  await page.locator(buttonSelector).scrollIntoViewIfNeeded();
  await page.locator(buttonSelector).click();
  await assertMobileReadinessDialog(page);
}

test.beforeEach(async ({ page }) => {
  await installOfflineProcessingStubs(page);
  await page.goto('/');
});

test('mobile upload → touch drag/pinch → dialog → JPG 300 DPI', async ({ page }) => {
  await uploadGeneratedPortrait(page);
  await waitForMobileEditor(page);
  await exerciseTouchCrop(page);

  await page.locator('button[data-fmt="cccd"]').scrollIntoViewIfNeeded();
  await page.locator('button[data-fmt="cccd"]').click();
  await expect(page.locator('#size-badge')).toHaveText('30 × 40 mm');

  await openDownloadDialog(page, '#btn-jpg-300');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Vẫn tải xuống' }).click();
  const download = await downloadPromise;

  const expectedFilename = 'photovisa_cccd_354x472_300dpi.jpeg';
  expect(download.suggestedFilename()).toBe(expectedFilename);
  const bytes = await readDownloadBytes(download);
  expect(bytes.length).toBeGreaterThan(1_000);
  expect(readJpegDimensions(bytes)).toEqual({ width: 354, height: 472 });
  const dpi = readJpegDpi(bytes);
  expect(dpi?.x).toBe(300);
  expect(dpi?.y).toBe(300);

  await expect(page.locator('#export-receipt-badge')).toHaveText('Ảnh đơn');
  await expect(page.locator('#export-receipt-filename')).toHaveText(expectedFilename);
  await expect(page.locator('#export-receipt-meta')).toContainText('300 DPI');
  await expect(page.locator('#s4')).toHaveClass(/active/);
  await assertNoHorizontalOverflow(page);
});

test('mobile upload → checklist/audit → dialog → ZIP chứa PNG 600 DPI', async ({ page }) => {
  await uploadGeneratedPortrait(page, 'private-mobile-source.png');
  await waitForMobileEditor(page);

  await page.locator('button[data-fmt="cccd"]').scrollIntoViewIfNeeded();
  await page.locator('button[data-fmt="cccd"]').click();
  const markAll = page.getByRole('button', { name: 'Đánh dấu tất cả' });
  await markAll.scrollIntoViewIfNeeded();
  await expect(markAll).toBeEnabled();
  await markAll.click();
  await page.locator('#manual-review-audit-enabled').check();

  await openDownloadDialog(page, '#btn-png-600');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Vẫn tải xuống' }).click();
  const download = await downloadPromise;

  const imageFilename = 'photovisa_cccd_709x945_600dpi.png';
  const bundleFilename = 'photovisa_cccd_709x945_600dpi.bundle.zip';
  expect(download.suggestedFilename()).toBe(bundleFilename);

  const entries = parseStoredZipEntries(await readDownloadBytes(download));
  expect(entries).toHaveLength(2);
  expect(entries.every((entry) => entry.method === 0)).toBe(true);
  expect(entries[0].name).toBe(imageFilename);
  expect(entries[1].name).toBe('photovisa_cccd_709x945_600dpi.audit.json');
  expect(readPngDimensions(entries[0].data)).toEqual({ width: 709, height: 945 });
  const dpi = readPngDpi(entries[0].data);
  expect(dpi?.x).toBeCloseTo(600, 1);
  expect(dpi?.y).toBeCloseTo(600, 1);

  const audit = JSON.parse(new TextDecoder().decode(entries[1].data));
  expect(audit.kind).toBe('idphoto-export-audit');
  expect(audit.profile.formatKey).toBe('cccd');
  expect(audit.export.delivery).toBe('bundle-zip');
  expect(audit.readiness.userConfirmed).toBe(true);
  expect(audit.readiness.manualPending).toBe(0);
  expect(audit.privacy.containsImageData).toBe(false);
  expect(audit.privacy.containsFaceGeometry).toBe(false);
  expect(audit.privacy.containsOriginalFilename).toBe(false);
  expect(JSON.stringify(audit)).not.toContain('private-mobile-source.png');

  await expect(page.locator('#export-receipt-badge')).toHaveText('Gói ZIP');
  await expect(page.locator('#export-receipt-filename')).toHaveText(bundleFilename);
  await expect(page.locator('#export-receipt-entries li')).toHaveCount(2);
  await expect(page.locator('#s4')).toHaveClass(/active/);
  await assertNoHorizontalOverflow(page);
});
