import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { create } from 'fontkit';
import { FONT_CATALOG, fontDefinition } from '../../dist/domain/fonts.js';
import { PALETTES, paperHex, textHex, contrastRatio } from '../../dist/domain/colors.js';
import { defaultStyle, validateStyle, advance } from '../../dist/domain/style.js';
import { createBook } from '../../dist/domain/book.js';
import { serializeProject, restoreProject } from '../../dist/domain/project.js';
import { typesetPublication } from '../../dist/typesetting/publication.js';
import { layoutInput } from '../../dist/domain/layout-input.js';
import { renderPageSVG } from '../../dist/render/svg.js';
import { fontData } from '../../dist/render/font-data.js';
import { bookFonts, pageFonts } from '../../dist/domain/font-use.js';
import { applyLocalStyle } from '../../dist/domain/styles.js';
import { sourceOf } from '../../dist/domain/publication.js';
import { execFileSync } from 'node:child_process';

test('book fonts and colors survive validation, project round trip and every rendered page', async () => {
  const source = await readFile(new URL('../../fixtures/book/appearance.md', import.meta.url), 'utf8');
  for (const font of FONT_CATALOG) {
    const book = createBook(source); book.style = validateStyle({ ...book.style, fontFamily: font.family, paperColor: '#24324b', textColor: '#f4f0e7' });
    const restored = restoreProject(serializeProject(book)); assert.equal(restored.style.fontFamily, font.family); assert.equal(restored.style.textColor, '#f4f0e7'); assert.equal(restored.source, source);
    const result = typesetPublication(layoutInput(restored)); assert.ok(result.pages.length > 1);
    for (const page of result.pages) {
      const svg = renderPageSVG(page, book.style);
      assert.ok(svg.includes('fill="#24324b"')); assert.ok(svg.includes('color="#f4f0e7"')); assert.ok(svg.includes(font.family));
      assert.ok(!svg.includes('NaN'));
    }
  }
  assert.throws(() => validateStyle({ ...defaultStyle(), fontFamily: 'Uninstalled Font' }));
  for (const value of ['red', 'url(https://example.invalid/)', '#12', '#000000\"']) {
    assert.throws(() => validateStyle({ ...defaultStyle(), paperColor: value }));
    assert.throws(() => validateStyle({ ...defaultStyle(), textColor: value }));
  }
  assert.equal(paperHex(defaultStyle().paperColor), '#ffffff'); assert.equal(textHex(defaultStyle().textColor), '#282b28');
  for (const palette of PALETTES) assert.ok(contrastRatio(paperHex(palette.paper), palette.ink) >= 4.5, palette.name);
});

test('each bundled font uses its own pinned glyph outlines, vertical origin and Latin advances', async () => {
  for (const entry of FONT_CATALOG) {
    const bytes = await readFile(new URL('../../public/' + entry.path, import.meta.url)), font = create(bytes), data = fontData(entry.family);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.equal(data.units, font.unitsPerEm);
    for (const char of ['「','」','、','。','ぁ','ー','…']) {
      const glyph = font.layout(char, ['vert']).glyphs[0];
      assert.equal(data.glyphs[char][0], glyph.path.toSVG(), entry.name + ': ' + char);
    }
    for (const char of ['A','W','i','0',' ']) assert.equal(advance(char, entry.family), font.glyphForCodePoint(char.codePointAt(0)).advanceWidth / font.unitsPerEm);
    assert.equal(fontDefinition(entry.family).path, entry.path);
  }
});

test('part fonts inherit, reset, project into manuscript and keep ruby in the same face', () => {
  const book=createBook('# 章\n｜活字《かつじ》と[文字]{fontFamily="Book Mincho"}\n## 節\n本文\n### 小見出し\n本文\n:::free id="free"');
  book.style.fontFamily='Noto Sans JP';book.style.folio.fontFamily='Zen Maru Gothic';
  for(const [id,font]of [['body','Shippori Mincho'],['chapter','GenEi Koburi Mincho'],['section','Zen Old Mincho'],['small-heading','Zen Kaku Gothic New']]){
    book.styles.characters.push({id:'type-'+id,name:id,basedOn:'text',properties:{fontFamily:font}});
    [...book.styles.paragraphs,...book.styles.headings].find(style=>style.id===id).characterStyleId='type-'+id;
  }
  book.specialPages[0].elements=[{id:'free-text',kind:'text',text:'自由なページ',xMm:20,yMm:20,widthMm:60,heightMm:20,fontPt:10,fontFamily:'Book Mincho',fontWeight:400,alignment:'start',direction:'horizontal'}];
  let restored=restoreProject(serializeProject(book)),result=typesetPublication(layoutInput(restored));
  const runs=result.pages.flatMap(page=>page.lines).flatMap(line=>line.runs),svg=result.pages.map(page=>renderPageSVG(page,restored.style)).join('');
  for(const font of ['Shippori Mincho','GenEi Koburi Mincho','Zen Old Mincho','Zen Kaku Gothic New'])assert.ok(runs.some(run=>run.fontFamily===font),font);
  assert.match(svg, /font-family="'Shippori Mincho','Book Mincho',serif" data-ruby="reading"/u);
  assert.deepEqual(new Set(bookFonts(restored)),new Set(FONT_CATALOG.map(font=>font.family)));
  delete restored.styles.characters.find(style=>style.id==='type-chapter').properties.fontFamily;
  result=typesetPublication(layoutInput(restored));assert.equal(result.pages[0].lines.find(line=>line.heading).runs[0].fontFamily,undefined);
  const block=restored.document.children[0].children.find(block=>block.kind==='paragraph');
  restored.document=applyLocalStyle(restored.document,block.id,{character:{fontFamily:'Zen Old Mincho'}});
  const projected=sourceOf(restored.document,restored.syntax);assert.match(projected,/fontFamily="Zen Old Mincho"/u);
  assert.equal(createBook(projected).document.children[0].children.find(block=>block.kind==='paragraph').localStyle.character.fontFamily,'Zen Old Mincho');
});

test('generated font data is reproducible from the licensed bundled files', () => {
  execFileSync(process.execPath,['scripts/font-catalog.mjs','--check'],{cwd:new URL('../../',import.meta.url)});
});

test('Japanese vertical origins match independently decoded vhea and vmtx metrics', () => {
  for(const [family,origin]of [['Shippori Mincho',880],['GenEi Koburi Mincho',901],['Zen Old Mincho',880],['Zen Kaku Gothic New',880],['Zen Maru Gothic',880],['Noto Sans JP',880]]){
    const data=fontData(family);
    for(const char of Array.from('書体と色活字で本を作る静か 　 '))assert.equal(data.origins[char]??data.origin,origin,family+': '+char);
  }
});

test('coverage lookup preserves supplementary characters and chooses the bundled fallback only when needed', async () => {
  for(const font of FONT_CATALOG){
    const decoded=create(await readFile(new URL('../../public/'+font.path,import.meta.url))),coverage=new Set(decoded.characterSet);
    for(const text of ['文字','AB12','𠮷','🦊','　\u00a0\r']){
      const style={...defaultStyle(),fontFamily:font.family,folio:{...defaultStyle().folio,enabled:false}};
      const page={kind:'flow',number:1,lines:[{blockId:'coverage',runs:[{kind:'text',text}]}]};
      const expected=new Set([font.family]);if(font.family!=='Book Mincho'&&Array.from(text).some(char=>char.codePointAt(0)>32&&!coverage.has(char.codePointAt(0))))expected.add('Book Mincho');
      assert.deepEqual(new Set(pageFonts(page,style)),expected,font.name+': '+text);
    }
  }
  const book=createBook('本文の書体を確かめる。'.repeat(40000)),source=book.source;
  for(const [i,font]of FONT_CATALOG.entries())book.styles.characters.push({id:'referenced-font-'+i,name:font.name,properties:{fontFamily:font.family}});
  assert.deepEqual(new Set(bookFonts(book)),new Set(FONT_CATALOG.map(font=>font.family)));assert.equal(book.source,source);
});
