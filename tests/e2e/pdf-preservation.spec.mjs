import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFNumber, StandardFonts, degrees, rgb, cmyk } from '../../public/vendor/pdf-lib.js';
import { absolute, fingerprint } from '../../scripts/lib.mjs';
import { BookUI } from './ui-driver.mjs';

test('@flow external PDF resources retain vectors, rotated crop geometry, and page order', async ({ page }) => {
  const dir = absolute('output/remaining-2026-10-22/pdf-preservation'); await mkdir(dir, { recursive: true });
  const source = await PDFDocument.create(), font = await source.embedFont(StandardFonts.Helvetica);
  for (const [index, angle] of [0, 90, 180, 270].entries()) {
    const sheet = source.addPage([160, 240]); sheet.setCropBox(20, 40, 100, 120); sheet.setRotation(degrees(angle));
    sheet.drawRectangle({ x: 25, y: 45, width: 90, height: 55, color: rgb(.9, .1, .1) });
    sheet.drawRectangle({ x: 25, y: 100, width: 90, height: 55, color: rgb(.1, .2, .9) });
    sheet.drawText(`VECTOR-${index + 1}`, { x: 24, y: 80, size: 8, font });
    sheet.drawRectangle({ x: 112, y: 42, width: 5, height: 5, color: cmyk(0, 1, 0, 0) });
    sheet.node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
    sheet.node.set(PDFName.of('Group'), source.context.obj({ Type: 'Group', S: 'Transparency', CS: 'DeviceRGB', I: true }));
  }
  const original = Buffer.from(await source.save()); await writeFile(dir + '/source.pdf', original);
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/'); const ui = new BookUI(page); await ui.paste('本文。');
  await page.locator('#detail-appearance > summary').click();await page.locator('#book-font').selectOption('Shippori Mincho');await page.locator('#palette-button').click();await page.locator('[data-palette=navy]').click();await ui.ready();
  await page.locator('#tab-assets').click(); await page.locator('#asset-file').setInputFiles({ name: 'rotated.pdf', mimeType: 'application/pdf', buffer: original });
  await expect(page.locator('.asset-card')).toHaveCount(1); await page.locator('.asset-card').getByRole('button', { name: 'ページとして挿入' }).click();
  await page.locator('#confirm-asset-insert').click(); await ui.ready();
  expect(await ui.pageCount()).toBe(5); await ui.download('export-png-all', dir + '/preview.zip');
  await page.locator('#open-export').click(); await page.getByText('PDFの詳細', { exact: true }).click(); await page.locator('#export-pdf-mode').selectOption('preserve'); await page.locator('#close-export').click();
  await ui.download('export-pdf', dir + '/preserved.pdf');
  await ui.download('export-project', dir + '/book.book.json');
  const pdf = await PDFDocument.load(await import('node:fs/promises').then(fs => fs.readFile(dir + '/preserved.pdf')), { updateMetadata: false });
  expect(pdf.getPageCount()).toBe(5); expect(pdf.getProducer()).toBe('Compholio');
  for (const sheet of pdf.getPages()) expect(sheet.getSize()).toEqual({ width: 105 * 72 / 25.4, height: 148 * 72 / 25.4 });
  await writeFile(dir + '/manifest.json', JSON.stringify({ sourceFingerprint: await fingerprint(), pageMm: [105, 148], pages: 5, paperRgb: [36,50,75], sourceBlankRgb: [255,255,255], rotations: [0, 90, 180, 270], source: 'source.pdf', pdf: 'preserved.pdf', preview: 'preview.zip' }, null, 2));
});

test('@flow annotated PDFs stop preservation explicitly and can still be exported as images', async ({ page }) => {
  const source = await PDFDocument.create(), sheet = source.addPage([200, 300]);
  sheet.drawText('ANNOTATED ORIGINAL', { x: 20, y: 200, size: 10 });
  sheet.node.addAnnot(source.context.register(source.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [20, 20, 40, 40], Contents: 'Note', Name: 'Comment' })));
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/'); const ui = new BookUI(page); await ui.paste('残す本文。');
  await page.locator('#tab-assets').click(); await page.locator('#asset-file').setInputFiles({ name: 'annotation.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await source.save()) });
  await expect(page.locator('.asset-card')).toHaveCount(1); await page.locator('.asset-card').getByRole('button', { name: 'ページとして挿入' }).click(); await ui.ready();
  await page.locator('#open-export').click(); await page.getByText('PDFの詳細', { exact: true }).click(); await page.locator('#export-pdf-mode').selectOption('preserve'); await page.locator('#export-pdf').click();
  await expect(page.locator('#output-error')).toContainText('注釈またはフォーム'); await expect(page.locator('#export-result')).toBeHidden();
  await page.locator('#export-pdf-mode').selectOption('raster'); await page.locator('#close-export').click();
  await mkdir(absolute('output/remaining-2026-10-22/pdf-preservation'), { recursive: true });
  await ui.download('export-pdf', absolute('output/remaining-2026-10-22/pdf-preservation/annotated-raster.pdf'));
  await ui.tab('原稿'); expect(await ui.manuscript().inputValue()).toContain('残す本文。');
});
