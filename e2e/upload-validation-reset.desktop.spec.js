import { expect, test } from '@playwright/test';

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

async function submitRawFile(page, {
  name,
  type,
  byteLength,
}) {
  await page.locator('#file-input').evaluate((input, options) => {
    const file = new File(
      [new Uint8Array(options.byteLength)],
      options.name,
      { type: options.type, lastModified: 1_786_000_000_000 },
    );
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { name, type, byteLength });
}

async function submitGeneratedPortrait(page, filename) {
  await page.locator('#file-input').evaluate(async (input, uploadName) => {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Không tạo được canvas fixture.');

    ctx.fillStyle = '#e0f2fe';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1e3a5f';
    ctx.fillRect(48, 250, 144, 110);
    ctx.fillStyle = '#f2c9a5';
    ctx.beginPath();
    ctx.ellipse(120, 150, 54, 72, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b1d17';
    ctx.beginPath();
    ctx.ellipse(120, 92, 58, 42, 0, Math.PI, Math.PI * 2);
    ctx.fill();

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
  await expect(page.locator('#export-receipt-panel')).toBeVisible();
}

async function seedExportSession(page) {
  await page.evaluate(async () => {
    const { stageExportForBundle } = await import('/src/export-delivery-session.js');
    const { stageExportRecovery } = await import('/src/export-recovery.js');
    const { recordExportReceipt } = await import('/src/export-receipt.js');
    const { manualReviewStore } = await import('/src/manual-review.js');
    const { state } = await import('/src/state.js');

    const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    stageExportForBundle({
      filename: 'photovisa_seed.jpeg',
      bytes: imageBytes,
    });
    stageExportRecovery({
      imageFilename: 'photovisa_seed.jpeg',
      imageBytes,
      imageMimeType: 'image/jpeg',
      auditFilename: 'photovisa_seed.audit.json',
      auditContent: '{"kind":"idphoto-export-audit"}\n',
      mode: 'jpeg300',
      formatKey: state.curFmt,
      widthPx: 472,
      heightPx: 709,
      dpi: 300,
    });
    recordExportReceipt({
      delivery: 'image-fallback',
      status: 'fallback',
      filename: 'photovisa_seed.jpeg',
      sizeBytes: imageBytes.length,
      mimeType: 'image/jpeg',
      recoveryAvailable: true,
    });
    manualReviewStore.setAuditEnabled(state.origFile, true);
  });
  await expect(page.locator('#export-receipt-badge')).toHaveText('Ảnh fallback');
  await expect(page.getByRole('button', { name: 'Thử lại ZIP' })).toBeVisible();
}

async function readRuntimeState(page) {
  return page.evaluate(async () => {
    const { getExportSessionSnapshot } = await import('/src/export-session.js');
    const { manualReviewStore } = await import('/src/manual-review.js');
    const { state } = await import('/src/state.js');
    return {
      exportSession: getExportSessionSnapshot(),
      sourceName: state.origFile?.name ?? null,
      formatKey: state.curFmt,
      background: { ...state.bgColor },
      auditEnabled: manualReviewStore.isAuditEnabled(state.origFile),
    };
  });
}

test.beforeEach(async ({ page }) => {
  await installOfflineProcessingStubs(page);
  await page.goto('/');
});

test('file sai định dạng bị từ chối và không rời màn upload', async ({ page }) => {
  await submitRawFile(page, {
    name: 'not-an-image.txt',
    type: 'text/plain',
    byteLength: 32,
  });

  await expect(page.locator('#toast')).toContainText('Vui lòng chọn file ảnh');
  await expect(page.locator('#upload-section')).toBeVisible();
  await expect(page.locator('#loading-section')).toBeHidden();
  await expect(page.locator('#editor-section')).toBeHidden();
  await expect(page.locator('#s1')).toHaveClass(/active/);
  expect((await readRuntimeState(page)).sourceName).toBeNull();
});

test('file lớn hơn 15MB bị từ chối trước khi pipeline bắt đầu', async ({ page }) => {
  await submitRawFile(page, {
    name: 'oversized.png',
    type: 'image/png',
    byteLength: 15 * 1024 * 1024 + 1,
  });

  await expect(page.locator('#toast')).toContainText('File quá lớn');
  await expect(page.locator('#upload-section')).toBeVisible();
  await expect(page.locator('#loading-section')).toBeHidden();
  await expect(page.locator('#editor-section')).toBeHidden();
  expect((await readRuntimeState(page)).sourceName).toBeNull();
});

test('hủy dialog readiness không tải file và giữ nguyên editor', async ({ page }) => {
  await submitGeneratedPortrait(page, 'cancel-confirmation.png');
  await waitForEditor(page);

  let downloadSeen = false;
  page.once('download', () => {
    downloadSeen = true;
  });

  await page.locator('#btn-jpg-300').click();
  const dialog = page.locator('#export-readiness-dialog');
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Quay lại chỉnh sửa' }).click();

  await expect(dialog).not.toBeVisible();
  await expect(page.locator('#toast')).toContainText('Đã quay lại chỉnh sửa ảnh');
  await expect(page.locator('#btn-jpg-300')).toBeEnabled();
  await page.waitForTimeout(400);
  expect(downloadSeen).toBe(false);
  await expect(page.locator('#export-receipt-badge')).toHaveText('Chưa tải');
  await expect(page.locator('#s3')).toHaveClass(/active/);
  await expect(page.locator('#editor-section')).toBeVisible();
});

test('file thay thế không hợp lệ không phá source và export session hiện tại', async ({ page }) => {
  await submitGeneratedPortrait(page, 'current-source.png');
  await waitForEditor(page);
  await seedExportSession(page);

  await submitRawFile(page, {
    name: 'replacement.txt',
    type: 'text/plain',
    byteLength: 16,
  });

  await expect(page.locator('#toast')).toContainText('Vui lòng chọn file ảnh');
  await expect(page.locator('#editor-section')).toBeVisible();
  await expect(page.locator('#export-receipt-badge')).toHaveText('Ảnh fallback');
  const runtime = await readRuntimeState(page);
  expect(runtime.sourceName).toBe('current-source.png');
  expect(runtime.auditEnabled).toBe(true);
  expect(runtime.exportSession).toEqual({
    hasStagedBundle: true,
    hasRecovery: true,
    hasReceipt: true,
  });
});

test('Ảnh khác xóa source, checklist, audit preference và toàn bộ export session', async ({ page }) => {
  await submitGeneratedPortrait(page, 'first-source.png');
  await waitForEditor(page);
  await seedExportSession(page);

  await page.getByRole('button', { name: /Ảnh khác/ }).click();

  await expect(page.locator('#upload-section')).toBeVisible();
  await expect(page.locator('#editor-section')).toBeHidden();
  await expect(page.locator('#s1')).toHaveClass(/active/);
  await expect(page.locator('#export-receipt-badge')).toHaveText('Chưa tải');
  await expect(page.locator('#file-input')).toHaveValue('');

  const runtime = await readRuntimeState(page);
  expect(runtime.sourceName).toBeNull();
  expect(runtime.formatKey).toBe('passport-vn');
  expect(runtime.background).toEqual({ r: 255, g: 255, b: 255 });
  expect(runtime.auditEnabled).toBe(false);
  expect(runtime.exportSession).toEqual({
    hasStagedBundle: false,
    hasRecovery: false,
    hasReceipt: false,
  });
});

test('source hợp lệ mới tự xóa receipt, recovery và staged ZIP của source trước', async ({ page }) => {
  await submitGeneratedPortrait(page, 'first-source.png');
  await waitForEditor(page);
  await seedExportSession(page);

  await submitGeneratedPortrait(page, 'second-source.png');
  await waitForEditor(page);

  await expect(page.locator('#export-receipt-badge')).toHaveText('Chưa tải');
  await expect(page.locator('#export-receipt-actions')).toBeHidden();
  const runtime = await readRuntimeState(page);
  expect(runtime.sourceName).toBe('second-source.png');
  expect(runtime.auditEnabled).toBe(false);
  expect(runtime.exportSession).toEqual({
    hasStagedBundle: false,
    hasRecovery: false,
    hasReceipt: false,
  });
});
