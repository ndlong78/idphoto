import { expect, test } from '@playwright/test';

const AI_STUB = `
export async function warmupAi() { return false; }
export async function loadFaceModels() { return false; }
export async function runBackgroundRemoval() { return null; }
`;

const FACE_STUB = `
export async function detectFacesWithLandmarks() { return null; }
`;

async function installOfflineStubs(page) {
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

async function uploadPortrait(page, filename = 'rotation-source.png') {
  await page.locator('#file-input').evaluate(async (input, uploadName) => {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 450;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Không tạo được canvas fixture.');

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#dbeafe');
    gradient.addColorStop(1, '#f8fafc');
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

    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error('Không tạo được PNG fixture.')),
      'image/png',
    ));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], uploadName, {
      type: 'image/png',
      lastModified: 1_786_000_000_000,
    }));
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

async function panelBoxes(page) {
  return page.locator('.panel-card').evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, right: box.right };
  }));
}

async function assertStacked(page) {
  const panels = await panelBoxes(page);
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  expect(panels).toHaveLength(2);
  expect(panels[1].y).toBeGreaterThan(panels[0].y + 100);
  expect(panels.every((panel) => panel.x >= 0 && panel.right <= viewportWidth + 1)).toBe(true);
}

async function assertSideBySide(page) {
  const panels = await panelBoxes(page);
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  expect(panels).toHaveLength(2);
  expect(Math.abs(panels[1].y - panels[0].y)).toBeLessThanOrEqual(4);
  expect(panels[1].x).toBeGreaterThan(panels[0].x + panels[0].width);
  expect(panels.every((panel) => panel.x >= 0 && panel.right <= viewportWidth + 1)).toBe(true);
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
  expect(actual.auditEnabled).toBe(expected.auditEnabled);
  expect(actual.completedKeys).toEqual(expected.completedKeys);
  expect(actual.crop.x).toBeCloseTo(expected.crop.x, 6);
  expect(actual.crop.y).toBeCloseTo(expected.crop.y, 6);
  expect(actual.crop.scale).toBeCloseTo(expected.crop.scale, 8);
}

async function performTouchAdjustment(page) {
  const canvas = page.locator('#crop-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Không xác định được crop canvas.');

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const point = (px, py, id) => ({ x: px, y: py, id, radiusX: 6, radiusY: 6, force: 1 });
  const client = await page.context().newCDPSession(page);

  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [point(x, y, 1)],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [point(x + 28, y - 18, 1)],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [point(x - 28, y, 1), point(x + 28, y, 2)],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [point(x - 46, y, 1), point(x + 46, y, 2)],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
  await page.waitForTimeout(220);
}

async function assertCropCanvasInsidePanel(page) {
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

async function assertCompactDialog(page) {
  const dialog = page.locator('#export-readiness-dialog');
  await expect(dialog).toBeVisible();
  await page.waitForFunction(() => [...document.styleSheets].some((sheet) => (
    sheet.href?.endsWith('/export-readiness.css') && sheet.cssRules.length > 0
  )));

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
      cardClientHeight: card?.clientHeight ?? 0,
      cardScrollHeight: card?.scrollHeight ?? 0,
      cardClientWidth: card?.clientWidth ?? 0,
      cardScrollWidth: card?.scrollWidth ?? 0,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  expect(geometry.cardScrollWidth).toBeLessThanOrEqual(geometry.cardClientWidth + 1);
  expect(geometry.cardScrollHeight).toBeGreaterThan(geometry.cardClientHeight);

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

test.beforeEach(async ({ page }) => {
  await installOfflineStubs(page);
});

test('portrait → landscape → portrait giữ nguyên crop và review state', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto('/');
  await uploadPortrait(page);
  await waitForEditor(page);
  await assertStacked(page);

  await page.locator('button[data-fmt="cccd"]').scrollIntoViewIfNeeded();
  await page.locator('button[data-fmt="cccd"]').click();
  const markAll = page.getByRole('button', { name: 'Đánh dấu tất cả' });
  await markAll.scrollIntoViewIfNeeded();
  await markAll.click();
  await page.locator('#manual-review-audit-enabled').check();
  await performTouchAdjustment(page);

  const portrait = await sessionSnapshot(page);
  expect(portrait.formatKey).toBe('cccd');
  expect(portrait.auditEnabled).toBe(true);
  expect(portrait.completedKeys.length).toBeGreaterThan(0);

  await page.setViewportSize({ width: 915, height: 412 });
  await page.waitForFunction(() => matchMedia('(orientation: landscape)').matches);
  await page.waitForTimeout(120);
  await assertSideBySide(page);
  await assertCropCanvasInsidePanel(page);
  await assertNoHorizontalOverflow(page);
  expectSessionPreserved(await sessionSnapshot(page), portrait);

  await page.setViewportSize({ width: 412, height: 915 });
  await page.waitForFunction(() => matchMedia('(orientation: portrait)').matches);
  await page.waitForTimeout(120);
  await assertStacked(page);
  await assertCropCanvasInsidePanel(page);
  await assertNoHorizontalOverflow(page);
  expectSessionPreserved(await sessionSnapshot(page), portrait);

  await page.locator('#btn-jpg-300').scrollIntoViewIfNeeded();
  await page.locator('#btn-jpg-300').click();
  await expect(page.locator('#export-readiness-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Quay lại chỉnh sửa' }).click();
  await expect(page.locator('#export-readiness-dialog')).toBeHidden();
  expectSessionPreserved(await sessionSnapshot(page), portrait);
});

test('viewport 320px và chiều cao bị thu hẹp vẫn mở dialog và tải được ảnh', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await uploadPortrait(page, 'small-screen-source.png');
  await waitForEditor(page);
  await assertStacked(page);
  await assertCropCanvasInsidePanel(page);
  await assertNoHorizontalOverflow(page);

  await page.locator('button[data-fmt="cccd"]').scrollIntoViewIfNeeded();
  await page.locator('button[data-fmt="cccd"]').click();
  const beforeShrink = await sessionSnapshot(page);

  // Mô phỏng visual viewport bị bàn phím ảo chiếm chỗ bằng cách giảm chiều cao.
  await page.setViewportSize({ width: 320, height: 360 });
  await page.waitForTimeout(120);
  await assertNoHorizontalOverflow(page);
  expectSessionPreserved(await sessionSnapshot(page), beforeShrink);

  await page.locator('#btn-jpg-300').scrollIntoViewIfNeeded();
  await page.locator('#btn-jpg-300').click();
  await assertCompactDialog(page);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Vẫn tải xuống' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('photovisa_cccd_354x472_300dpi.jpeg');

  await expect(page.locator('#export-receipt-badge')).toHaveText('Ảnh đơn');
  await expect(page.locator('#export-receipt-filename')).toHaveText('photovisa_cccd_354x472_300dpi.jpeg');
  await expect(page.locator('#s4')).toHaveClass(/active/);
  await assertNoHorizontalOverflow(page);
});
