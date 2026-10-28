import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PDFDocument, rgb } from '../../public/vendor/pdf-lib.js';
import { absolute, fingerprint } from '../../scripts/lib.mjs';
import { BookUI } from './ui-driver.mjs';
const dir=absolute('output/press-2026-10-22');
for(const width of [1440,320])test('@flow structure menus keep copy delete move and keyboard actions beside their items at '+width,async({page})=>{
  await page.setViewportSize({width,height:1000});await page.goto('/');const ui=new BookUI(page);await ui.paste('# 第一章\n保存する本文。\n# 第二章\n次の本文。');await ui.tab('原稿');await page.locator('#tab-structure').click();
  await expect(page.locator('#item-up, #item-down, #outline-actions')).toHaveCount(0);
  const first=await page.locator('.outline-row[data-kind=chapter]').first().getAttribute('data-item-id'),second=await page.locator('.outline-row[data-kind=chapter]').nth(1).getAttribute('data-item-id');
  await expect(page.locator('.outline-grip').first()).not.toHaveCSS('mask-image','none');
  const trigger=page.getByRole('button',{name:'第一章の操作',exact:true});await trigger.click();await expect(page.getByRole('menu',{name:'構成の操作'})).toBeVisible();await expect(page.locator('#item-copy')).toBeFocused();
  await page.locator('#item-copy').press('ArrowDown');await expect(page.locator('#item-move')).toBeFocused();await page.locator('#item-move').press('End');await expect(page.locator('#item-delete')).toBeFocused();await page.locator('#item-delete').press('Escape');await expect(trigger).toBeFocused();
  await trigger.click();await page.getByRole('menuitem',{name:'複製',exact:true}).click();await ui.ready();await expect(page.locator('.outline-row[data-kind=chapter]')).toHaveCount(3);await expect(page.locator('#left-structure')).toBeVisible();expect(await page.locator('#manuscript').inputValue()).toContain('第一章の複製');
  await page.getByRole('button',{name:'第一章の複製の操作',exact:true}).click();await page.getByRole('menuitem',{name:'削除',exact:true}).click();await ui.ready();await expect(page.locator('.outline-row[data-kind=chapter]')).toHaveCount(2);
  await page.keyboard.press('Control+z');await ui.ready();await expect(page.locator('.outline-row[data-kind=chapter]')).toHaveCount(3);
  await page.getByRole('button',{name:'第二章の操作',exact:true}).click();await page.getByRole('menuitem',{name:'移動先…',exact:true}).click();await page.locator('#move-item-target').selectOption(first);await page.locator('#move-item-position').selectOption('before');await page.locator('#confirm-move-item').click();await ui.ready();await expect(page.locator('.outline-row[data-kind=chapter]').first()).toHaveAttribute('data-item-id',second);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>globalThis.innerWidth)).toBe(false);
  await page.getByRole('button',{name:'第二章の操作',exact:true}).click();await mkdir(dir,{recursive:true});await page.screenshot({path:dir+'/structure-'+width+'.png'});await page.locator('#item-copy').press('Escape');
});
test('@flow icon alignment updates manuscript, mixed values and shared styles',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await page.goto('/');const ui=new BookUI(page);await ui.paste('最初の文章。\n次の文章。');await ui.tab('原稿');await ui.manuscript().press('Control+a');await page.locator('#select-block-style').click();
  await page.locator('#block-align').getByRole('button',{name:'中央揃え',exact:true}).click();await ui.ready();expect(await page.locator('#manuscript').inputValue()).toContain('alignment="center"');await expect(page.locator('#block-align').getByRole('button',{name:'中央揃え',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.locator('#block-weight').getByRole('button',{name:'太字',exact:true}).click();await ui.ready();expect(await page.locator('#manuscript').inputValue()).toContain('fontWeight="700"');
  await page.locator('#block-align').getByRole('button',{name:'書式を継承',exact:true}).click();await ui.ready();expect(await page.locator('#manuscript').inputValue()).not.toContain('alignment="center"');expect(await page.locator('#manuscript').inputValue()).toContain('fontWeight="700"');
  await page.locator('#typography-target').selectOption('body');await page.locator('#type-paragraph-alignment').getByRole('button',{name:'中央揃え',exact:true}).click();await ui.ready();await expect(page.locator('#type-paragraph-alignment').getByRole('button',{name:'中央揃え',exact:true})).toHaveAttribute('aria-pressed','true');
  await mkdir(dir,{recursive:true});await page.screenshot({path:dir+'/icons-desktop.png'});
});
test('@flow print PDFs preserve trim and page order with bleed grayscale marks and source vectors',async({page})=>{
  test.setTimeout(120000);await mkdir(dir,{recursive:true});
  const original=await PDFDocument.create(),pt=72/25.4,sheet=original.addPage([111*pt,154*pt]);
  sheet.drawRectangle({x:0,y:0,width:111*pt,height:154*pt,color:rgb(1,0,0)});sheet.drawRectangle({x:3*pt,y:3*pt,width:105*pt,height:148*pt,color:rgb(0,0,1)});
  sheet.drawRectangle({x:30.48*pt,y:50.8*pt,width:5.08*pt,height:5.08*pt,color:rgb(1,1,1)});for(let stripe=0;stripe<60;stripe++)sheet.drawRectangle({x:(30.48+stripe*2*25.4/600)*pt,y:50.8*pt,width:25.4/600*pt,height:5.08*pt,color:rgb(0,0,0)});
  const originalBytes=Buffer.from(await original.save());await writeFile(dir+'/bleed-source.pdf',originalBytes);
  await page.setViewportSize({width:1440,height:1000});await page.goto('/');const ui=new BookUI(page);await ui.paste(await readFile(absolute('fixtures/book/print.md'),'utf8'));
  await page.locator('#tab-assets').click();await page.locator('#asset-file').setInputFiles({name:'bleed.pdf',mimeType:'application/pdf',buffer:originalBytes});await expect(page.locator('.asset-card')).toHaveCount(1);await page.locator('.asset-card').getByRole('button',{name:'ページとして挿入'}).click();await ui.ready();
  await page.locator('#special-image-mode').selectOption('bleed');await ui.ready();await page.locator('#special-fit').selectOption('cover');await ui.ready();await page.locator('#special-bleed').fill('3');await page.locator('#special-bleed').blur();await ui.ready();
  const source=await page.locator('#manuscript').inputValue(),count=await ui.pageCount();expect(count).toBe(3);
  await page.locator('#open-export').click();await page.locator('#export-pdf-preset').selectOption('mono');await ui.ready();await page.getByText('PDFの詳細',{exact:true}).click();await expect(page.locator('#export-sheet-info')).toContainText('111 × 154 mm');await expect(page.locator('#export-print-proof > svg')).toHaveCount(1);expect(await page.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(el=>el.id);return ids.length===new Set(ids).size;})).toBe(true);await page.locator('#close-export').click();await expect(page.locator('#export-print-proof svg')).toHaveCount(0);
  await ui.download('export-pdf',dir+'/mono.pdf');
  await page.locator('#open-export').click();await page.locator('#export-marks').selectOption('all');await ui.ready();await expect(page.locator('#export-sheet-info')).toContainText('125 × 168 mm');await page.screenshot({path:dir+'/print-settings.png'});await page.locator('#close-export').click();await ui.download('export-pdf',dir+'/mono-marks.pdf');
  await page.locator('#open-export').click();await page.locator('#export-pdf-preset').selectOption('color');await ui.ready();await page.locator('#export-marks').selectOption('all');await ui.ready();await page.locator('#export-pdf-mode').selectOption('preserve');await ui.ready();await expect(page.locator('#export-result')).toBeHidden();await page.locator('#close-export').click();await ui.download('export-pdf',dir+'/color-vectors.pdf');
  await ui.download('export-project',dir+'/print.book.json');const saved=JSON.parse(await readFile(dir+'/print.book.json','utf8'));expect(saved.printSettings).toEqual({purpose:'print',bleedMm:3,marks:'all',dpi:350,color:'rgb',pdfSource:'preserve'});expect(saved.source).toBe(source);
  await page.locator('#open-export').click();await page.locator('#export-scope').selectOption('range');await page.locator('#export-from').fill('3');await page.locator('#export-to').fill('3');await page.locator('#close-export').click();await ui.download('export-pdf',dir+'/range.pdf');
  await page.locator('#open-export').click();await page.locator('#export-color').selectOption('gray');await ui.ready();await page.locator('#export-pdf').click();await expect(page.locator('#output-error')).toContainText('画像として出力');await expect(page.locator('#export-result')).toBeHidden();
  await page.locator('#export-pdf-preset').selectOption('screen');await ui.ready();await page.locator('#export-scope').selectOption('all');await page.locator('#close-export').click();await ui.download('export-pdf',dir+'/screen.pdf');
  expect(await page.locator('#manuscript').inputValue()).toBe(source);expect(await ui.pageCount()).toBe(count);
  await writeFile(dir+'/manifest.json',JSON.stringify({sourceFingerprint:await fingerprint(),pages:count,pageMm:[105,148],bleedMm:3,files:['mono.pdf','mono-marks.pdf','color-vectors.pdf','range.pdf','screen.pdf'],grayscaleDpi:600,colorDpi:350,screenDpi:300},null,2));
});

for(const item of [{id:'b6-mono',size:'b6',preset:'mono',bleed:'3'},{id:'a5-color',size:'a5',preset:'color',bleed:'0'}])test('@flow printed '+item.id+' uses its own trim and corner marks',async({page})=>{
  await mkdir(dir,{recursive:true});await page.setViewportSize({width:1440,height:1000});await page.goto('/');const ui=new BookUI(page);
  await ui.paste('# 本文\n異なる判型でも本文の位置と頁を保ちます。');await ui.control('page-size',item.size);const source=await page.locator('#manuscript').inputValue();expect(await ui.pageCount()).toBe(1);
  await page.locator('#open-export').click();await page.locator('#export-pdf-preset').selectOption(item.preset);await ui.ready();await page.getByText('PDFの詳細',{exact:true}).click();await page.locator('#export-bleed').fill(item.bleed);
  // A disclosure update can refresh the dialog before the numeric edit is committed.
  await page.locator('#export-pdf-details').dispatchEvent('toggle');await expect(page.locator('#export-bleed')).toHaveValue(item.bleed);
  await page.locator('#export-bleed').blur();await ui.ready();await page.locator('#export-marks').selectOption('corners');await ui.ready();await expect(page.locator('#export-bleed')).toHaveValue(item.bleed);await page.locator('#close-export').click();
  await ui.download('export-pdf',dir+'/'+item.id+'.pdf');expect(await page.locator('#manuscript').inputValue()).toBe(source);expect(await ui.pageCount()).toBe(1);
  await writeFile(dir+'/'+item.id+'.json',JSON.stringify({sourceFingerprint:await fingerprint(),file:item.id+'.pdf',pages:1}));
});
