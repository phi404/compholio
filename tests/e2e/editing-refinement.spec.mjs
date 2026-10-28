import { test, expect } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { absolute } from '../../scripts/lib.mjs';
import { BookUI } from './ui-driver.mjs';

async function saved(page) {
  await expect(page.getByTestId('save-state')).toHaveAttribute('data-state', 'saved');
  return page.evaluate(() => JSON.parse(globalThis.localStorage.getItem('bookmaker-slice-draft-v1')).project);
}
async function addPage(page, ui, template) {
  await ui.tab('原稿'); await page.locator('#tab-structure').click(); await page.locator('#add-book-item').click();
  await page.locator('#new-page-role').selectOption('layout'); await page.locator('#new-page-template').selectOption(template); await page.locator('#new-page-name').fill('試作ページ'); await page.locator('#confirm-add-page').click(); await ui.ready();
}
test('@flow range formatting roundtrips source, keeps identities and provides recto and emphasis keyboard entry', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/'); const ui = new BookUI(page);
  await ui.paste('# 章\n冒頭。\n｜薔薇《ばら》の文章。\n二行目。\n末尾。'); const before = await saved(page);
  await ui.tab('原稿'); await ui.manuscript().evaluate(editor => { const from = editor.value.indexOf('｜薔薇'), to = editor.value.indexOf('末尾'); editor.focus(); editor.setSelectionRange(from, to); });
  await page.locator('#select-block-style').click(); await expect(page.locator('#settings-heading')).toHaveText('選択範囲'); await page.locator('#block-local-details > summary').click(); await page.locator('#block-align').getByRole('button', { name: '中央揃え', exact: true }).click(); await ui.ready();
  const b = await saved(page); expect((b.source.match(/:::format/g) ?? []).length).toBe(1); expect(b.source).toContain('alignment="center"\n｜薔薇《ばら》の文章。\n二行目。\n:::');
  expect(b.document.children[0].children.map(b => b.id)).toEqual(before.document.children[0].children.map(b => b.id));
  await ui.tab('原稿'); await ui.manuscript().fill(b.source.replace('alignment="center"', 'alignment="end"')); await ui.ready(); expect((await saved(page)).document.children[0].children[2].localStyle.paragraph.alignment).toBe('end');
  await ui.manuscript().fill('# 章\n冒頭。\n｜薔薇《ばら》の文章。\n二行目。\n末尾。'); await ui.ready(); expect((await saved(page)).document.children[0].children[2].localStyle).toBeUndefined();
  await ui.manuscript().press('Control+End'); await ui.manuscript().press('Control+Shift+Enter'); await ui.manuscript().press('End'); await ui.manuscript().pressSequentially('次'); await ui.ready(); expect((await saved(page)).source).toContain(':::recto'); expect(await ui.pageCount()).toBe(3);
  await ui.manuscript().evaluate(e => { const at = e.value.indexOf('冒頭'); e.focus(); e.setSelectionRange(at, at + 2); }); await page.locator('#insert-emphasis-kind').selectOption('circle'); await page.locator('[data-insert=emphasis]').click(); await ui.ready(); expect((await saved(page)).source).toContain('[冒頭]{.circle}');
});

test('@flow shared typography edits all text and H1 H2 H3 through the same style catalog', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/'); const ui = new BookUI(page);
  await ui.paste('# 一\n本文。\n## 二\n本文。\n### 三\n本文。'); await page.locator('#inspect-styles').click(); await page.locator('#type-character-fontWeight').getByRole('button', { name: '太字', exact: true }).click(); await ui.ready();
  expect((await saved(page)).styles.characters.find(s => s.id === 'text').properties.fontWeight).toBe(700);
  for (const [id, size] of [['chapter', 14], ['section', 12], ['small-heading', 10]]) {
    await page.locator('#typography-target').selectOption(id); await page.locator('#type-character-fontPt').fill(String(size)); await page.locator('#type-character-fontPt').blur(); await ui.ready();
    await page.locator('#type-paragraph-alignment').getByRole('button', { name: '中央揃え', exact: true }).click(); await ui.ready();
  }
  const b = await saved(page); for (const [id, size] of [['chapter',14],['section',12],['small-heading',10]]) { const h=b.styles.headings.find(s=>s.id===id); expect(b.styles.characters.find(c=>c.id===h.characterStyleId).properties.fontPt).toBe(size); expect(h.properties.alignment).toBe('center'); }
  await page.reload(); await ui.ready(); await page.locator('#inspect-styles').click(); await page.locator('#typography-target').selectOption('section'); await expect(page.locator('#type-character-fontPt')).toHaveValue('12');
  await mkdir(absolute('output/editing-refinement'), { recursive: true }); await page.screenshot({ path: absolute('output/editing-refinement/typography.png') });
});

test('@flow chapter drag and keyboard reorder preserve chapter content and special page identity', async ({ page }) => {
  await page.setViewportSize({ width:1440,height:1000 }); await page.goto('/'); const ui=new BookUI(page);
  await ui.paste('# 甲\n甲の本文\n# 乙\n乙の本文\n# 丙\n丙の本文'); const before=await saved(page);
  await ui.tab('原稿');await page.locator('#tab-structure').click();
  const first=page.locator('.outline-row[data-kind=chapter]').nth(0), last=page.locator('.outline-row[data-kind=chapter]').nth(2);
  const targetBox=await last.boundingBox();expect(targetBox).not.toBeNull();
  await first.dragTo(last,{targetPosition:{x:targetBox.width/2,y:targetBox.height*.75}}); await ui.ready(); const dragged=await saved(page); expect(dragged.document.children.map(s=>s.id)).toEqual([before.document.children[1].id,before.document.children[2].id,before.document.children[0].id]); expect(dragged.source).toContain('# 甲\n甲の本文');
  await page.locator(`.outline-row[data-item-id="${before.document.children[0].id}"]`).press('Alt+ArrowUp'); await ui.ready(); expect((await saved(page)).document.children.map(s=>s.id)).toEqual([before.document.children[1].id,before.document.children[0].id,before.document.children[2].id]);
  await page.locator('#undo').click(); await ui.ready(); expect((await saved(page)).document.children.map(s=>s.id)).toEqual(dragged.document.children.map(s=>s.id));
  await addPage(page,ui,'title'); const b=await saved(page), p=b.specialPages.at(-1); expect(p.representation).toBe('layout');
  await page.locator('.outline-row[data-kind=special]').dragTo(page.locator('.outline-row[data-kind=chapter]').first(),{targetPosition:{x:20,y:3}}); await ui.ready(); const moved=await saved(page); expect(moved.source.startsWith(`:::title id="${p.id}"`)).toBe(true); expect(moved.specialPages.find(s=>s.id===p.id).elements).toEqual(p.elements);
});

test('@flow free page handles, keyboard, layer order, lock, undo and all-page PNG archive work', async ({ page }) => {
  await page.setViewportSize({width:1440,height:1000});await page.goto('/');const ui=new BookUI(page); await ui.paste('本文。');await addPage(page,ui,'title');await page.locator('#view-single').click();await ui.ready();
  const b=await saved(page), p=b.specialPages.at(-1), element=p.elements[0];
  await page.locator(`.element-list [data-element-row="${element.id}"]`).click(); await ui.ready();
  const paper=ui.preview().locator('.paper').first(); await paper.press('ArrowRight'); await ui.ready(); expect((await saved(page)).specialPages.at(-1).elements[0].xMm).toBe(element.xMm+1);
  await paper.press('ArrowRight'); await ui.ready(); expect((await saved(page)).specialPages.at(-1).elements[0].xMm).toBe(element.xMm+2);
  const handle=ui.preview().locator('.handle-se'), box=await handle.boundingBox(); expect(box).not.toBeNull(); await page.mouse.move(box.x+6,box.y+6);await page.mouse.down();await page.mouse.move(box.x+25,box.y+25);await page.mouse.up();await ui.ready(); const resized=await saved(page);expect(resized.specialPages.at(-1).elements[0].widthMm).toBeGreaterThan(element.widthMm);
  await paper.press('Control+d');await ui.ready();expect((await saved(page)).specialPages.at(-1).elements.length).toBe(p.elements.length+1);await page.locator('#element-back').click();await ui.ready();
  await page.locator('#lock-element').click();await ui.ready();const locked=await saved(page);expect(locked.specialPages.at(-1).elements.some(e=>e.locked)).toBe(true);await expect(ui.preview().locator('.element-handle')).toHaveCount(0);
  await paper.press('ArrowRight');await ui.ready();expect((await saved(page)).specialPages.at(-1).elements).toEqual(locked.specialPages.at(-1).elements);
  await page.locator('#lock-element').click();await ui.ready();await paper.press('Delete');await ui.ready();expect((await saved(page)).specialPages.at(-1).elements.length).toBe(p.elements.length);await page.locator('#undo').click();await ui.ready();expect((await saved(page)).specialPages.at(-1).elements.length).toBe(p.elements.length+1);
  await page.screenshot({path:absolute('output/editing-refinement/free-page.png')});await page.getByTestId('open-export').click();await expect(page.getByTestId('export-png-all')).toBeVisible();await ui.download('export-png-all',absolute('output/editing-refinement/all-pages.zip'));
  const {unzipSync}=await import('../../public/vendor/fflate.js');const entries=unzipSync(new Uint8Array(await readFile(absolute('output/editing-refinement/all-pages.zip'))));expect(Object.keys(entries).length).toBe(await ui.pageCount());expect(Object.keys(entries).every(name=>name.endsWith('.png'))).toBe(true);await writeFile(absolute('output/editing-refinement/archive-pages.json'),JSON.stringify(Object.keys(entries),null,2));
});

for (const width of [375, 320]) test(`@flow range, shared headings and canvas controls fit ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height:812 }); await page.goto('/'); const ui = new BookUI(page);
  await ui.paste('第一行\n第二行\n:::recto\n末尾'); await ui.tab('原稿'); await ui.manuscript().evaluate(e=>{e.focus();e.setSelectionRange(0,7);});
  await page.locator('#select-block-style').click();await page.locator('#block-local-details > summary').click();await page.locator('#block-align').getByRole('button', { name: '中央揃え', exact: true }).click();await ui.ready();
  await page.locator('#inspect-styles').click();await page.locator('#typography-target').selectOption('section');await page.locator('#type-character-fontPt').fill('12');await page.locator('#type-character-fontPt').blur();await ui.ready();
  await addPage(page,ui,'blank');await page.locator('#add-element-text').click();await page.locator('#element-text').fill('小さなページ');await page.locator('#element-text').blur();await ui.ready();await ui.tab('プレビュー');
  await expect(page.locator('#free-page-tools')).toBeVisible();await expect(ui.preview().locator('.paper')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1)).toBe(false);
  await page.screenshot({ path:absolute(`output/editing-refinement/mobile-${width}.png`) });
});

test('@visual range source and free page canvas at 1440px', async ({ page }) => {
  await page.setViewportSize({ width:1440, height:1000 }); await page.goto('/'); const ui = new BookUI(page);
  await ui.paste('# 本のかたち\n冒頭の文章。\n　｜雨音《あまおと》を聞いた。\n短い手紙を、ここに置く。\n:::recto\n## 次の節\n次の文章。');
  await ui.tab('原稿'); await ui.manuscript().evaluate(e => { const from=e.value.indexOf('　｜雨音'),to=e.value.indexOf(':::recto');e.focus();e.setSelectionRange(from,to); });
  await page.locator('#select-block-style').click();await page.locator('#block-local-details > summary').click();await page.locator('#block-align').getByRole('button', { name: '中央揃え', exact: true }).click();await ui.ready();await saved(page);await ui.manuscript().evaluate(e=>{e.scrollTop=0;e.blur();});
  await expect(page).toHaveScreenshot('range-source.png',{maxDiffPixels:0,animations:'disabled'});
  await addPage(page,ui,'title');await page.locator('#view-single').click();await page.locator('.element-list button').first().click();await ui.ready();await saved(page);
  await expect(page).toHaveScreenshot('free-canvas.png',{maxDiffPixels:0,animations:'disabled'});
});
