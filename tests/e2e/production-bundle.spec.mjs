import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createBook } from '../../dist/domain/book.js';
import { unzipSync, zipSync } from '../../public/vendor/fflate.js';
import { absolute } from '../../scripts/lib.mjs';
import { BookUI } from './ui-driver.mjs';
import { FONT_CATALOG } from '../../dist/domain/fonts.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
test('@flow production bundle contains originals and a complete font, restores, and rejects damaged copies', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/'); const ui = new BookUI(page);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=';
  const original = await readFile(absolute('fixtures/book/local-page.svg'));
  const book = createBook('# 持ち出す本\n｜原稿《げんこう》を残す。\n:::illustration id="art"');
  book.assets = [{ id: 'original-art', name: '持ち込んだ素材.svg', mediaType: 'image/svg+xml', original: 'data:image/svg+xml;base64,' + original.toString('base64'), bytes: original.length, images: [{ dataUrl: png, width: 1, height: 1 }] }];
  book.specialPages[0].assetId = 'original-art'; book.style.pageCountMultiple = 4;
  await ui.importTxt({ name: 'original.book.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(book)) });
  await mkdir(absolute('output/remaining-2026-10-22'), { recursive: true });
  await ui.download('export-bundle', absolute('output/remaining-2026-10-22/production.compholio.zip'));
  const bytes = await readFile(absolute('output/remaining-2026-10-22/production.compholio.zip')), files = unzipSync(bytes), manifest = JSON.parse(Buffer.from(files['manifest.json']).toString());
  expect(manifest.kind).toBe('compholio-production');
  for (const entry of manifest.files) { expect(files[entry.path].length).toBe(entry.bytes); expect(hash(files[entry.path])).toBe(entry.sha256); }
  expect(Buffer.from(files['assets/001-original-art.svg'])).toEqual(original);
  expect(hash(files['fonts/NotoSerifJP-Regular.otf'])).toBe(hash(await readFile(absolute('public/fonts/NotoSerifJP-Regular.otf'))));
  expect(Buffer.from(files['fonts/OFL.txt']).toString()).toContain('SIL OPEN FONT LICENSE');
  await ui.paste('別の原稿。'); await ui.importTxt({ name: 'production.compholio.zip', mimeType: 'application/zip', buffer: bytes });
  expect(await ui.pageCount()).toBe(4); await ui.tab('原稿'); expect(await ui.manuscript().inputValue()).toBe(book.source);
  await ui.download('export-project', absolute('output/remaining-2026-10-22/bundle-restored.book.json'));
  const restored = JSON.parse(await readFile(absolute('output/remaining-2026-10-22/bundle-restored.book.json'), 'utf8'));
  expect(restored.assets[0].original).toBe(book.assets[0].original); expect(restored.styles).toEqual(book.styles);
  const previousFiles={...files,'manifest.json':Buffer.from(JSON.stringify({...manifest,kind:'folaxis-production'}))};
  await ui.paste('改名前の保存を開く。');await ui.importTxt({name:'previous.folaxis.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync(previousFiles))});await expect(page.locator('#notice')).toContainText('未対応の制作データ');await ui.tab('原稿');expect(await ui.manuscript().inputValue()).toBe('改名前の保存を開く。');
  await ui.importTxt({name:'production.compholio.zip',mimeType:'application/zip',buffer:bytes});await ui.tab('原稿');expect(await ui.manuscript().inputValue()).toBe(book.source);
  const changedFont = { ...files, 'book.json': Buffer.from(JSON.stringify(createBook('別の書体では開かない原稿。'))), 'fonts/NotoSerifJP-Regular.otf': new Uint8Array([0, 1, 2, 3]) };
  changedFont['manifest.json'] = Buffer.from(JSON.stringify({ ...manifest, files: manifest.files.map(entry => ({ ...entry, bytes: changedFont[entry.path].length, sha256: hash(changedFont[entry.path]) })) }));
  await ui.importTxt({ name: 'different-font.compholio.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync(changedFont)) });
  await expect(page.locator('#notice')).toContainText('書体が現在のCompholioと異なります'); await ui.tab('原稿'); expect(await ui.manuscript().inputValue()).toBe(book.source);
  files['book.json'][0] ^= 1;
  await ui.importTxt({ name: 'damaged.compholio.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync(files)) });
  await expect(page.locator('#notice')).toContainText('変更または破損'); await ui.tab('原稿'); expect(await ui.manuscript().inputValue()).toBe(book.source);
  await ui.importTxt({ name: 'unsafe.compholio.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync({ '../outside': new Uint8Array([1]), 'manifest.json': files['manifest.json'] })) });
  await expect(page.locator('#notice')).toContainText('ファイル名'); await ui.tab('原稿'); expect(await ui.manuscript().inputValue()).toBe(book.source);
});

test('@flow a production bundle preserves every referenced typeface and its license',async({page})=>{
  await page.goto('/');const ui=new BookUI(page),book=createBook('# 書体を持ち出す\n｜活字《かつじ》を残す。');
  book.style.fontFamily='Noto Sans JP';book.style.paperColor='#24324b';book.style.textColor='#f4f0e7';
  for(const [index,font]of FONT_CATALOG.entries())book.styles.characters.push({id:'saved-font-'+index,name:font.name,basedOn:'text',properties:{fontFamily:font.family}});
  await ui.importTxt({name:'fonts.book.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(book))});
  const folder=absolute('output/appearance/bundle');await mkdir(folder,{recursive:true});await ui.download('export-bundle',folder+'/fonts.compholio.zip');
  const bytes=await readFile(folder+'/fonts.compholio.zip'),files=unzipSync(bytes),fonts=JSON.parse(Buffer.from(files['fonts.json']).toString());
  expect(fonts).toHaveLength(FONT_CATALOG.length);
  for(const font of FONT_CATALOG){expect(hash(files[font.path])).toBe(font.sha256);expect(Buffer.from(files[font.license]).toString()).toContain('SIL OPEN FONT LICENSE');}
  await ui.paste('別の原稿。');await ui.importTxt({name:'fonts.compholio.zip',mimeType:'application/zip',buffer:bytes});
  await ui.download('export-project',folder+'/restored.json');const restored=JSON.parse(await readFile(folder+'/restored.json','utf8'));
  expect(restored.source).toBe(book.source);expect(restored.styles).toEqual(book.styles);expect(restored.style.fontFamily).toBe('Noto Sans JP');expect(restored.style.textColor).toBe('#f4f0e7');
});
