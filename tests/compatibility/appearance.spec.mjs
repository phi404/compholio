/* global Image, document, crypto */
import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { absolute, fingerprint } from '../../scripts/lib.mjs';
import { FONT_CATALOG } from '../../dist/domain/fonts.js';
import { BookUI } from '../e2e/ui-driver.mjs';
import { createHash } from 'node:crypto';
import { unzlibSync } from '../../public/vendor/fflate.js';
import { PDFDocument, PDFName, PDFRawStream } from '../../public/vendor/pdf-lib.js';

test('book and part fonts, color presets, RGB edits, history and exports share one appearance', async ({ page, browser }, testInfo) => {
  const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
  await page.goto('/');const ui=new BookUI(page),source=await readFile(absolute('fixtures/book/appearance.md'),'utf8');await ui.paste(source);
  await ui.tab('設定');await page.locator('#detail-appearance > summary').click();
  const folder=absolute('output/appearance/'+testInfo.project.name);await mkdir(folder,{recursive:true});
  for(const font of FONT_CATALOG){
    await page.locator('#book-font').selectOption(font.family);await ui.ready();
    await ui.tab('プレビュー');await page.screenshot({path:folder+'/'+font.path.split('/').at(-1)+'.png'});
    const raster=await page.evaluate(async({source,family})=>{
      const {createBook}=await import('/domain/book.js'),{layoutInput}=await import('/domain/layout-input.js'),{typesetPublication}=await import('/typesetting/publication.js'),{rasterize}=await import('/io/raster.js');
      const book=createBook(source);book.style.fontFamily=family;const canvas=await rasterize(typesetPublication(layoutInput(book)).pages[0],book.style,false,{dpi:150});return canvas.toDataURL();
    },{source,family:font.family});
    await writeFile(folder+'/'+font.path.split('/').at(-1)+'-paper.png',Buffer.from(raster.split(',')[1],'base64'));await ui.tab('設定');
  }
  await page.locator('#book-font').selectOption('Noto Sans JP');await ui.ready();
  await page.locator('#palette-button').click();await page.locator('[data-palette=navy]').click();await ui.ready();
  await expect(page.locator('#contrast-warning')).toBeHidden();
  await page.locator('#inspect-styles').click();await page.locator('#typography-target').selectOption('chapter');
  await page.locator('#type-character-fontFamily').selectOption('GenEi Koburi Mincho');await ui.ready();
  await page.locator('#inspect-book').click();await page.locator('#detail-folio > summary').click();
  await page.locator('#folio-font').selectOption('Zen Old Mincho');await ui.ready();
  if(await page.locator('#detail-appearance').getAttribute('open')===null)await page.locator('#detail-appearance > summary').click();
  await page.locator('#appearance-custom summary').click();
  await page.locator('#paper-rgb').fill('#f7ecd1');await page.locator('#paper-rgb').press('Tab');await ui.ready();await expect(page.locator('#contrast-warning')).toBeVisible();
  await page.locator('#fix-contrast').click();await ui.ready();await expect(page.locator('#contrast-warning')).toBeHidden();
  await page.locator('#undo').click();await ui.ready();await expect(page.locator('#contrast-warning')).toBeVisible();await page.locator('#redo').click();await ui.ready();
  await page.locator('#palette-button').click();await page.locator('[data-palette=navy]').click();await ui.ready();
  await expect(page.locator('#save-state')).toHaveText('保存済み');await page.reload();await ui.ready();await ui.tab('プレビュー');
  await page.screenshot({path:folder+'/mixed.png'});
  const svg=ui.preview().locator('svg').first();await expect(svg.locator('[data-heading]').first()).toHaveAttribute('font-family', /GenEi Koburi Mincho/u);
  await expect(svg.locator('[data-testid=folio]')).toHaveAttribute('font-family', /Zen Old Mincho/u);
  await ui.download('export-project',folder+'/book.json');await ui.download('export-png',folder+'/page.png');await ui.download('export-pdf',folder+'/book.pdf');
  const raster=await page.evaluate(async data=>{
    const image=new Image();image.src=data;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data,rgb=new Uint8Array(canvas.width*canvas.height*3);let light=0;
    for(let i=0,j=0;i<rgba.length;i+=4){rgb[j++]=rgba[i];rgb[j++]=rgba[i+1];rgb[j++]=rgba[i+2];if(rgba[i]>200&&rgba[i+1]>200&&rgba[i+2]>200)light++;}
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',rgb))).map(v=>v.toString(16).padStart(2,'0')).join('');return {width:canvas.width,height:canvas.height,paper:[...rgb.slice(0,3)],light,hash};
  },'data:image/png;base64,'+(await readFile(folder+'/page.png')).toString('base64'));
  expect(raster.paper).toEqual([36,50,75]);expect(raster.light).toBeGreaterThan(200);
  const pdf=await PDFDocument.load(await readFile(folder+'/book.pdf'),{updateMetadata:false});expect(pdf.getPageCount()).toBe(await ui.pageCount());
  const images=[...pdf.context.indirectObjects.values()].filter(object=>object instanceof PDFRawStream&&object.dict.get(PDFName.of('Subtype'))?.toString()==='/Image');
  expect(images.length).toBe(pdf.getPageCount());expect(createHash('sha256').update(unzlibSync(images[0].getContents())).digest('hex')).toBe(raster.hash);
  const book=JSON.parse(await readFile(folder+'/book.json','utf8'));expect(book.style.fontFamily).toBe('Noto Sans JP');expect(book.style.paperColor).toBe('#24324b');expect(book.style.textColor).toBe('#f4f0e7');expect(book.style.folio.fontFamily).toBe('Zen Old Mincho');
  expect(book.styles.characters.find(style=>style.id==='type-chapter').properties.fontFamily).toBe('GenEi Koburi Mincho');
  expect(requests.filter(url=>!url.startsWith(new URL(testInfo.project.use.baseURL??'http://127.0.0.1:5174').origin)&&!url.startsWith('data:')&&!url.startsWith('blob:'))).toEqual([]);
  expect(await page.evaluate(()=>globalThis.document.documentElement.scrollWidth-globalThis.document.documentElement.clientWidth)).toBeLessThanOrEqual(1);expect(errors).toEqual([]);
  await writeFile(folder+'/result.json',JSON.stringify({project:testInfo.project.name,browser:browser.version(),sourceFingerprint:await fingerprint(),fonts:book.style.fontFamily,heading:'GenEi Koburi Mincho',folio:book.style.folio.fontFamily,colors:[book.style.paperColor,book.style.textColor],pageErrors:errors},null,2)+'\n');
});
