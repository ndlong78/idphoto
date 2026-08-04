import { expect, test } from '@playwright/test';

async function openMobileRecoverySurface(page) {
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
      recordRetryableExportFallback,
      stageExportRecovery,
    } = await import('/src/export-recovery.js');
    startExportReceiptView({
      documentRef: document,
      onRetryBundle: () => {},
      onDownloadImage: () => {},
    });
    stageExportRecovery({
      imageFilename: 'photovisa_mobile_1205x1205_600dpi.jpeg',
      imageBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      imageMimeType: 'image/jpeg',
      auditFilename: 'photovisa_mobile_1205x1205_600dpi.audit.json',
      auditContent: '{"kind":"idphoto-export-audit"}\n',
      mode: 'jpeg600',
      formatKey: 'us-visa',
      widthPx: 1205,
      heightPx: 1205,
      dpi: 600,
    });
    recordRetryableExportFallback();
  });
}

test('recovery actions xếp dọc, không tràn viewport và có trạng thái accessible', async ({ page }) => {
  await openMobileRecoverySurface(page);

  const panel = page.locator('#export-receipt-panel');
  const retryButton = page.getByRole('button', { name: 'Thử lại ZIP' });
  const imageButton = page.getByRole('button', { name: 'Tải lại ảnh đơn' });
  await expect(panel).toBeVisible();
  await expect(retryButton).toBeVisible();
  await expect(imageButton).toBeVisible();
  await expect(panel).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#export-receipt-action-status')).toHaveAttribute('role', 'status');

  const layout = await page.locator('#export-receipt-actions button').evaluateAll((buttons) => (
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, right: box.right };
    })
  ));
  expect(layout).toHaveLength(2);
  expect(layout[1].y).toBeGreaterThan(layout[0].y);
  expect(Math.abs(layout[0].width - layout[1].width)).toBeLessThanOrEqual(2);

  const viewport = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.innerWidth);
  expect(layout.every((box) => box.x >= 0 && box.right <= viewport.innerWidth + 1)).toBe(true);
});
