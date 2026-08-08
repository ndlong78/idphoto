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

async function uploadGeneratedPortrait(page) {
  await page.locator('#file-input').evaluate(async (input) => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Không tạo được canvas fixture.');
    ctx.fillStyle = '#e7f0fb';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#24466b';
    ctx.fillRect(60, 320, 200, 160);
    ctx.fillStyle = '#efc6a5';
    ctx.beginPath();
    ctx.ellipse(160, 205, 72, 94, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#241812';
    ctx.beginPath();
    ctx.ellipse(160, 128, 77, 54, 0, Math.PI, Math.PI * 2);
    ctx.fill();

    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error('Không tạo được fixture PNG.')),
      'image/png',
    ));
    const file = new File([blob], 'preview-source.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

test.beforeEach(async ({ page }) => {
  await installOfflineProcessingStubs(page);
  await page.goto('/');
  await uploadGeneratedPortrait(page);
  await expect(page.locator('#editor-section')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#print-sheet-preview')).toBeVisible();
});

test('live preview theo preset, số bản, khổ giấy và dấu cắt mà không tạo download', async ({ page }) => {
  const canvas = page.locator('#print-sheet-preview-canvas');
  await canvas.scrollIntoViewIfNeeded();
  await expect(canvas).toHaveAttribute('data-preview-source', 'image', { timeout: 15_000 });
  await expect(canvas).toHaveAttribute('data-preview-format', 'passport-vn');
  await expect(canvas).toHaveAttribute('data-preview-paper', 'photo-10x15');
  await expect(canvas).toHaveAttribute('data-preview-orientation', 'portrait');
  await expect(canvas).toHaveAttribute('data-preview-copies', '4');
  await expect(canvas).toHaveAttribute('data-preview-columns', '2');
  await expect(canvas).toHaveAttribute('data-preview-rows', '2');
  await expect(canvas).toHaveAttribute('data-preview-crop-marks', 'true');
  await expect(canvas).toHaveAttribute('data-preview-page', '1');
  await expect(canvas).toHaveAttribute('data-preview-page-count', '1');
  await expect(page.locator('#print-sheet-preview-navigation')).toBeHidden();

  const firstRevision = Number(await canvas.getAttribute('data-preview-revision'));
  expect(firstRevision).toBeGreaterThan(0);
  const intrinsicSize = await canvas.evaluate((node) => ({
    width: node.width,
    height: node.height,
  }));
  expect(intrinsicSize.width).toBeGreaterThan(100);
  expect(intrinsicSize.height).toBeGreaterThan(intrinsicSize.width);

  await page.locator('button[data-fmt="schengen"]').click();
  await expect(page.locator('#size-badge')).toContainText('35 × 45 mm');
  await expect(canvas).toHaveAttribute('data-preview-format', 'schengen');
  await expect(canvas).toHaveAttribute('data-preview-copies', '6');
  await expect(canvas).toHaveAttribute('data-preview-columns', '2');
  await expect(canvas).toHaveAttribute('data-preview-rows', '3');

  await page.locator('#print-sheet-copies').selectOption('5');
  await expect(canvas).toHaveAttribute('data-preview-copies', '5');
  await expect(canvas).toHaveAttribute('data-preview-rows', '3');

  await page.locator('#print-sheet-crop-marks').uncheck();
  await expect(canvas).toHaveAttribute('data-preview-crop-marks', 'false');

  await page.locator('#print-sheet-paper').selectOption('a4');
  await page.locator('#print-sheet-copies').selectOption('max');
  await expect(page.locator('#print-sheet-margin')).toHaveValue('10');
  await expect(page.locator('#print-sheet-gap')).toHaveValue('4');
  await expect(canvas).toHaveAttribute('data-preview-paper', 'a4');
  await expect(canvas).toHaveAttribute('data-preview-orientation', 'landscape');
  await expect(canvas).toHaveAttribute('data-preview-copies', '21');
  await expect(canvas).toHaveAttribute('data-preview-columns', '7');
  await expect(canvas).toHaveAttribute('data-preview-rows', '3');

  await expect.poll(async () => Number(await canvas.getAttribute('data-preview-revision')))
    .toBeGreaterThan(firstRevision);

  await page.setViewportSize({ width: 390, height: 844 });
  await canvas.scrollIntoViewIfNeeded();
  const [canvasBox, stageBox] = await Promise.all([
    canvas.boundingBox(),
    page.locator('#print-sheet-preview-stage').boundingBox(),
  ]);
  expect(canvasBox).not.toBeNull();
  expect(stageBox).not.toBeNull();
  expect(canvasBox.width).toBeLessThanOrEqual(stageBox.width);
  await expect(page.locator('#export-receipt')).toBeHidden();
});

test('preview batch duyệt tới trang cuối và clamp khi giảm tổng số ảnh', async ({ page }) => {
  const canvas = page.locator('#print-sheet-preview-canvas');
  const navigation = page.locator('#print-sheet-preview-navigation');
  const indicator = page.locator('#print-sheet-preview-page-indicator');
  const previousButton = page.locator('#btn-print-sheet-preview-previous');
  const nextButton = page.locator('#btn-print-sheet-preview-next');

  await page.locator('button[data-fmt="schengen"]').click();
  await expect(page.locator('#print-sheet-summary')).toContainText('6/6 ảnh');
  await page.locator('#print-sheet-pdf-total-copies').fill('14');
  await expect(page.locator('#print-sheet-pdf-summary')).toContainText('3 trang');
  await expect(page.locator('#print-sheet-pdf-summary')).toContainText('Dùng điều hướng');
  await expect(navigation).toBeVisible();
  await expect(indicator).toHaveText('Trang 1/3 · 6 ảnh');
  await expect(previousButton).toBeDisabled();
  await expect(nextButton).toBeEnabled();
  await expect(canvas).toHaveAttribute('data-preview-page', '1');
  await expect(canvas).toHaveAttribute('data-preview-page-count', '3');
  await expect(canvas).toHaveAttribute('data-preview-copies', '6');

  await nextButton.click();
  await expect(indicator).toHaveText('Trang 2/3 · 6 ảnh');
  await expect(canvas).toHaveAttribute('data-preview-page', '2');
  await expect(canvas).toHaveAttribute('data-preview-copies', '6');

  await nextButton.click();
  await expect(indicator).toHaveText('Trang 3/3 · 2 ảnh');
  await expect(canvas).toHaveAttribute('data-preview-page', '3');
  await expect(canvas).toHaveAttribute('data-preview-copies', '2');
  await expect(canvas).toHaveAttribute('data-preview-columns', '2');
  await expect(canvas).toHaveAttribute('data-preview-rows', '1');
  await expect(previousButton).toBeEnabled();
  await expect(nextButton).toBeDisabled();
  await expect(canvas).toHaveAttribute('aria-label', /Trang 3\/3 · 2 ảnh/);

  await page.locator('#print-sheet-pdf-total-copies').fill('8');
  await expect(indicator).toHaveText('Trang 2/2 · 2 ảnh');
  await expect(canvas).toHaveAttribute('data-preview-page', '2');
  await expect(canvas).toHaveAttribute('data-preview-page-count', '2');
  await expect(nextButton).toBeDisabled();

  await page.locator('#print-sheet-pdf-total-copies').fill('6');
  await expect(navigation).toBeHidden();
  await expect(canvas).toHaveAttribute('data-preview-page', '1');
  await expect(canvas).toHaveAttribute('data-preview-page-count', '1');
  await expect(canvas).toHaveAttribute('data-preview-copies', '6');
  await expect(page.locator('#export-receipt')).toBeHidden();
});

test('hướng giấy và lề tùy chỉnh cập nhật sức chứa và preview batch', async ({ page }) => {
  const canvas = page.locator('#print-sheet-preview-canvas');
  const summary = page.locator('#print-sheet-summary');
  const pdfSummary = page.locator('#print-sheet-pdf-summary');
  const indicator = page.locator('#print-sheet-preview-page-indicator');
  const nextButton = page.locator('#btn-print-sheet-preview-next');

  await page.locator('button[data-fmt="schengen"]').click();
  await expect(page.locator('#print-sheet-orientation')).toHaveValue('auto');
  await expect(page.locator('#print-sheet-margin')).toHaveValue('4');
  await expect(summary).toContainText('tự động → dọc');
  await expect(summary).toContainText('6/6 ảnh');
  await expect(summary).toContainText('lề 4 mm');

  await page.locator('#print-sheet-orientation').selectOption('landscape');
  await expect(summary).toContainText('ép ngang');
  await expect(summary).toContainText('3/3 ảnh');
  await expect(canvas).toHaveAttribute('data-preview-orientation', 'landscape');
  await expect(canvas).toHaveAttribute('data-preview-copies', '3');
  await expect(canvas).toHaveAttribute('data-preview-columns', '3');
  await expect(canvas).toHaveAttribute('data-preview-rows', '1');

  await page.locator('#print-sheet-pdf-total-copies').fill('5');
  await expect(pdfSummary).toContainText('2 trang');
  await expect(indicator).toHaveText('Trang 1/2 · 3 ảnh');

  await page.locator('#print-sheet-margin').selectOption('20');
  await expect(summary).toContainText('ép ngang');
  await expect(summary).toContainText('2/2 ảnh');
  await expect(summary).toContainText('lề 20 mm');
  await expect(pdfSummary).toContainText('3 trang');
  await expect(pdfSummary).toContainText('2 + 2 + 1 ảnh/trang');
  await expect(indicator).toHaveText('Trang 1/3 · 2 ảnh');
  await expect(canvas).toHaveAttribute('data-preview-page', '1');
  await expect(canvas).toHaveAttribute('data-preview-page-count', '3');
  await expect(canvas).toHaveAttribute('data-preview-copies', '2');
  await expect(canvas).toHaveAttribute('data-preview-columns', '2');

  await nextButton.click();
  await nextButton.click();
  await expect(indicator).toHaveText('Trang 3/3 · 1 ảnh');
  await expect(canvas).toHaveAttribute('data-preview-page', '3');
  await expect(canvas).toHaveAttribute('data-preview-copies', '1');
  await expect(canvas).toHaveAttribute('data-preview-columns', '2');
  await expect(canvas).toHaveAttribute('data-preview-rows', '1');

  await expect(page.locator('#export-receipt')).toBeHidden();
});
