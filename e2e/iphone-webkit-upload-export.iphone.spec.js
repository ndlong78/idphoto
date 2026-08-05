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

async function createPortraitBytes(page) {
  return page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Không tạo được canvas fixture.');

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#dbeafe');
    gradient.addColorStop(1, '#f8fafc');
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

    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error('Không tạo được PNG fixture.')),
      'image/png',
    ));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
}

async function uploadGeneratedPortrait(page, filename = 'iphone-webkit-portrait.png') {
  const bytes = await createPortraitBytes(page);
  await page.locator('#file-input').setInputFiles({
    name: filename,
    mimeType: 'image/png',
    buffer: Buffer.from(bytes),
  });
}

async function waitForEditor(page) {
  await expect(page.locator('#editor-section')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#upload-section')).toBeHidden();
  await expect(page.locator('#s3')).toHaveClass(/active/);
  await expect(page.locator('#export-readiness-panel')).toBeVisible();
  await expect(page.locator('#manual-review-panel')).toBeVisible();

  const canvas = await page.locator('#result-canvas').evaluate((element) => ({
    width: element.width,
    height: element.height,
  }));
  expect(canvas.width).toBeGreaterThan(0);
  expect(canvas.height).toBeGreaterThan(0);
}

async function waitForUiRendering(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await page.waitForTimeout(100);
}

async function assertIphoneWebKitContext(page) {
  const capabilities = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    coarsePointer: matchMedia('(pointer: coarse)').matches,
  }));
  expect(capabilities.userAgent).toContain('iPhone');
  expect(capabilities.maxTouchPoints).toBeGreaterThan(0);
  expect(capabilities.coarsePointer).toBe(true);
}

async function assertNoHorizontalOverflow(page) {
  const geometry = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    rootScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(geometry.rootScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
}

async function assertCropCanvasInsideViewport(page) {
  const geometry = await page.locator('#crop-canvas').evaluate((canvas) => {
    const box = canvas.getBoundingClientRect();
    const panel = canvas.closest('.panel-card')?.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      width: box.width,
      panelLeft: panel?.left ?? 0,
      panelRight: panel?.right ?? 0,
      panelWidth: panel?.width ?? 0,
      viewportWidth: window.innerWidth,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(geometry.panelLeft - 1);
  expect(geometry.right).toBeLessThanOrEqual(geometry.panelRight + 1);
  expect(geometry.width).toBeLessThanOrEqual(geometry.panelWidth + 1);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
}

async function sessionSnapshot(page) {
  return page.evaluate(async () => {
    const { manualReviewStore } = await import('/src/manual-review.js');
    const { state } = await import('/src/state.js');
    return {
      formatKey: state.curFmt,
      crop: { x: state.crop.x, y: state.crop.y, scale: state.crop.scale },
      completedKeys: [...manualReviewStore.getCompletedKeys(state.origFile, state.curFmt)].sort(),
      auditEnabled: manualReviewStore.isAuditEnabled(state.origFile),
    };
  });
}

function expectSessionPreserved(actual, expected) {
  expect(actual.formatKey).toBe(expected.formatKey);
  expect(actual.completedKeys).toEqual(expected.completedKeys);
  expect(actual.auditEnabled).toBe(expected.auditEnabled);
  expect(actual.crop.x).toBeCloseTo(expected.crop.x, 6);
  expect(actual.crop.y).toBeCloseTo(expected.crop.y, 6);
  expect(actual.crop.scale).toBeCloseTo(expected.crop.scale, 8);
}

async function assertMobileDialog(page) {
  const dialog = page.locator('#export-readiness-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Không có alpha mask AI');
  await expect(dialog).toContainText('Checklist thủ công');

  const geometry = await dialog.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const card = element.querySelector('.export-readiness-dialog-card');
    return {
      top: box.top,
      bottom: box.bottom,
      left: box.left,
      right: box.right,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      cardClientWidth: card?.clientWidth ?? 0,
      cardScrollWidth: card?.scrollWidth ?? 0,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  expect(geometry.cardScrollWidth).toBeLessThanOrEqual(geometry.cardClientWidth + 1);

  const proceed = page.getByRole('button', { name: 'Vẫn tải xuống' });
  const cancel = page.getByRole('button', { name: 'Quay lại chỉnh sửa' });
  await proceed.scrollIntoViewIfNeeded();
  await expect(proceed).toBeVisible();
  await expect(cancel).toBeVisible();

  const buttons = await dialog.locator('footer button').evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { width: box.width, height: box.height, y: box.y };
  }));
  expect(buttons).toHaveLength(2);
  expect(buttons.every((button) => button.height >= 40)).toBe(true);
  expect(Math.abs(buttons[0].width - buttons[1].width)).toBeLessThanOrEqual(2);
  expect(Math.abs(buttons[0].y - buttons[1].y)).toBeGreaterThan(20);
}

async function confirmAndCaptureDownload(page, triggerSelector) {
  const trigger = page.locator(triggerSelector);
  await trigger.scrollIntoViewIfNeeded();
  await trigger.tap();
  await assertMobileDialog(page);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Vẫn tải xuống' }).tap();
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
  await assertIphoneWebKitContext(page);
});

test('iPhone WebKit upload → rotation → JPG 300 DPI giữ nguyên session', async ({ page }) => {
  await uploadGeneratedPortrait(page);
  await waitForEditor(page);
  await assertNoHorizontalOverflow(page);
  await assertCropCanvasInsideViewport(page);

  const visa = page.locator('button[data-fmt="us-visa"]');
  await visa.scrollIntoViewIfNeeded();
  await visa.tap();
  await expect(page.locator('#size-badge')).toHaveText('51 × 51 mm');
  await waitForUiRendering(page);

  const portrait = await sessionSnapshot(page);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Không đọc được viewport iPhone.');

  await page.setViewportSize({ width: viewport.height, height: viewport.width });
  await page.waitForFunction(() => window.innerWidth > window.innerHeight);
  await page.waitForTimeout(120);
  await assertNoHorizontalOverflow(page);
  await assertCropCanvasInsideViewport(page);
  expectSessionPreserved(await sessionSnapshot(page), portrait);

  await page.setViewportSize(viewport);
  await page.waitForFunction(() => window.innerHeight > window.innerWidth);
  await page.waitForTimeout(120);
  await assertNoHorizontalOverflow(page);
  await assertCropCanvasInsideViewport(page);
  expectSessionPreserved(await sessionSnapshot(page), portrait);

  const download = await confirmAndCaptureDownload(page, '#btn-jpg-300');
  const expectedFilename = 'photovisa_us-visa_602x602_300dpi.jpeg';
  expect(download.suggestedFilename()).toBe(expectedFilename);

  const bytes = await readDownloadBytes(download);
  expect(bytes.length).toBeGreaterThan(1_000);
  expect(readJpegDimensions(bytes)).toEqual({ width: 602, height: 602 });
  const dpi = readJpegDpi(bytes);
  expect(dpi?.x).toBe(300);
  expect(dpi?.y).toBe(300);

  await expect(page.locator('#export-receipt-badge')).toHaveText('Ảnh đơn');
  await expect(page.locator('#export-receipt-filename')).toHaveText(expectedFilename);
  await expect(page.locator('#s4')).toHaveClass(/active/);
  await assertNoHorizontalOverflow(page);
});

test('iPhone WebKit tap checklist → ZIP audit → receipt không tràn viewport', async ({ page }) => {
  await uploadGeneratedPortrait(page, 'private-iphone-source.png');
  await waitForEditor(page);
  await assertNoHorizontalOverflow(page);

  const cccd = page.locator('button[data-fmt="cccd"]');
  await cccd.scrollIntoViewIfNeeded();
  await cccd.tap();

  const markAll = page.getByRole('button', { name: 'Đánh dấu tất cả' });
  await markAll.scrollIntoViewIfNeeded();
  await markAll.tap();
  await page.locator('#manual-review-audit-enabled').tap();
  await expect(page.locator('#manual-review-audit-enabled')).toBeChecked();

  const reviewed = await sessionSnapshot(page);
  expect(reviewed.formatKey).toBe('cccd');
  expect(reviewed.completedKeys.length).toBeGreaterThan(0);
  expect(reviewed.auditEnabled).toBe(true);

  const download = await confirmAndCaptureDownload(page, '#btn-jpg-300');
  const imageFilename = 'photovisa_cccd_354x472_300dpi.jpeg';
  const bundleFilename = 'photovisa_cccd_354x472_300dpi.bundle.zip';
  expect(download.suggestedFilename()).toBe(bundleFilename);

  const entries = parseStoredZipEntries(await readDownloadBytes(download));
  expect(entries).toHaveLength(2);
  expect(entries.every((entry) => entry.method === 0)).toBe(true);
  expect(entries[0].name).toBe(imageFilename);
  expect(entries[1].name).toBe('photovisa_cccd_354x472_300dpi.audit.json');
  expect(readJpegDimensions(entries[0].data)).toEqual({ width: 354, height: 472 });

  const dpi = readJpegDpi(entries[0].data);
  expect(dpi?.x).toBe(300);
  expect(dpi?.y).toBe(300);

  const audit = JSON.parse(new TextDecoder().decode(entries[1].data));
  expect(audit.kind).toBe('idphoto-export-audit');
  expect(audit.profile.formatKey).toBe('cccd');
  expect(audit.readiness.userConfirmed).toBe(true);
  expect(audit.readiness.manualPending).toBe(0);
  expect(audit.privacy.containsImageData).toBe(false);
  expect(audit.privacy.containsFaceGeometry).toBe(false);
  expect(audit.privacy.containsOriginalFilename).toBe(false);
  expect(JSON.stringify(audit)).not.toContain('private-iphone-source.png');

  await expect(page.locator('#export-receipt-badge')).toHaveText('Gói ZIP');
  await expect(page.locator('#export-receipt-filename')).toHaveText(bundleFilename);
  await expect(page.locator('#export-receipt-entries li')).toHaveCount(2);
  await expect(page.locator('#s4')).toHaveClass(/active/);
  await assertNoHorizontalOverflow(page);
});
