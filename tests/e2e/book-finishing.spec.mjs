import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { absolute, fingerprint, hash } from '../../scripts/lib.mjs';
import { createBook } from '../../dist/domain/book.js';
import { BookUI } from './ui-driver.mjs';

test('@flow white paper and margin layout rules do not silently change other settings',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await page.goto('/');const ui=new BookUI(page);await ui.paste('原稿の本文。');
  await expect(page.locator('.paper:not(.blank) svg > rect').first()).toHaveAttribute('fill','#ffffff');
  await ui.tab('設定');await expect(page.getByRole('combobox',{name:'ページの組み方',exact:true})).toBeVisible();await expect(page.locator('#page-layout option')).toHaveText(['見開きで組む','一枚ずつ組む']);await page.locator('#detail-layout > summary').click();await page.locator('#detail-appearance > summary').click();await page.locator('#appearance-custom > summary').click();await expect(page.locator('#paper-color')).toHaveValue('white');
  await page.locator('#paper-color').selectOption('warm');await ui.ready();await page.locator('#detail-folio > summary').click();await page.locator('#folio-enabled').uncheck();await ui.ready();
  await page.locator('#page-layout').selectOption('uniform');await ui.ready();await expect(page.locator('#view-spread')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#folio-enabled')).not.toBeChecked();await expect(page.locator('#paper-color')).toHaveValue('warm');await expect(page.locator('#margin-inner')).toHaveValue('17');await expect(page.locator('#margin-outer')).toHaveValue('13');
  await page.locator('#page-layout').selectOption('book');await ui.ready();await expect(page.locator('#folio-enabled')).not.toBeChecked();await expect(page.locator('#paper-color')).toHaveValue('warm');await expect(ui.manuscript()).toHaveValue('原稿の本文。');
});

test('@flow left binding, heading depth and real PDF navigation share the final pages',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await page.goto('/');const ui=new BookUI(page),source=await readFile(absolute('fixtures/book/finishing.md'),'utf8');
  await ui.importTxt({name:'book.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(createBook(source)))});await ui.tab('設定');await page.locator('#detail-layout > summary').click();await page.locator('#page-binding').selectOption('left');await ui.ready();await expect(page.locator('#page-writing')).toHaveValue('vertical-rl');
  await page.locator('.paper[data-page-number="1"]').click();await page.locator('#edit-selection').click();await page.locator('#toc-depth').selectOption('3');await ui.ready();
  await page.getByText('目次の文字と字下げ',{exact:true}).click();await page.locator('#toc-font').fill('10');await page.locator('#toc-font').press('Tab');await ui.ready();await page.locator('#toc-indent').fill('4');await page.locator('#toc-indent').press('Tab');await ui.ready();
  await expect(page.locator('.paper[data-page-number="1"]')).toHaveAttribute('data-side','right');expect(await ui.pageCount()).toBe(7);await page.locator('#page-select').fill('4');await expect(page.locator('.paper[data-page-number="4"]')).toHaveAttribute('data-side','left');await expect(page.locator('.paper[data-page-number="5"]')).toHaveAttribute('data-side','right');
  const next=await page.locator('#next-page').boundingBox(),previous=await page.locator('#previous-page').boundingBox();expect(next.x).toBeGreaterThan(previous.x);
  await page.locator('#view-spread').press('ArrowRight');await expect(page.locator('#page-select')).toHaveValue('6');await expect(page.locator('#next-page')).toBeDisabled();await page.locator('#view-spread').press('ArrowLeft');await expect(page.locator('#page-select')).toHaveValue('4');
  const dir='output/book-finishing';await mkdir(absolute(dir),{recursive:true});await ui.download('export-png',absolute(dir+'/page-004.png'));await ui.download('export-pdf',absolute(dir+'/book.pdf'));await ui.download('export-png-all',absolute(dir+'/pages.zip'));await ui.download('export-spread',absolute(dir+'/spread.png'));await ui.download('export-project',absolute(dir+'/book.book.json'));
  const outlines=[{title:'第一章',page:3,depth:1},{title:'節',page:4,depth:2},{title:'小節',page:5,depth:3},{title:'第二章',page:7,depth:1}];
  await page.locator('#open-export').click();await page.locator('#export-scope').selectOption('range');await page.locator('#export-from').fill('1');await page.locator('#export-to').fill('5');await page.locator('#close-export').click();await ui.download('export-pdf',absolute(dir+'/range.pdf'));
  await page.locator('#open-export').click();await page.locator('#export-from').fill('4');await page.locator('#export-to').fill('5');await page.locator('#close-export').click();await ui.download('export-pdf',absolute(dir+'/nested-range.pdf'));
  const navigation={outlines,linkTargets:[3,3,4,4,5,5,7,7],direction:'L2R'},ranges=[{pdf:'range.pdf',pages:[1,2,3,4,5],navigation:{outlines:outlines.slice(0,3),linkTargets:[3,3,4,4,5,5],direction:'L2R'}},{pdf:'nested-range.pdf',pages:[4,5],navigation:{outlines:[{title:'節',page:1,depth:1},{title:'小節',page:2,depth:2}],linkTargets:[],direction:'L2R'}}];
  await writeFile(absolute(dir+'/manifest.json'),JSON.stringify({schemaVersion:1,phase:'mvp',sourceFingerprint:await fingerprint(),inputSha256:hash(source),expectedPages:7,pngPageNumber:4,dpi:300,pageMm:[105,148],png:'page-004.png',pdf:'book.pdf',zip:'pages.zip',spread:'spread.png',spreadPages:{left:4,right:5},colorSamples:[{page:3,position:[.02,.02],rgb:[255,255,255]}],navigation,navigationRanges:ranges},null,2));
  await page.reload();await ui.ready();await ui.tab('設定');await page.locator('#detail-layout > summary').click();await expect(page.locator('#page-binding')).toHaveValue('left');await ui.tab('プレビュー');await page.locator('#page-select').fill('1');await page.locator('.paper[data-page-number="1"]').click();await page.locator('#edit-selection').click();await expect(page.locator('#toc-depth')).toHaveValue('3');
});
