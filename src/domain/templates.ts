import type { BookStyle } from './contracts.js';
import type { PageElement, SpecialPageDefinition } from './model.js';
import { elementTextLines } from './element-layout.js';
export interface TocEntry { title: string; page: number | string; level?: 1 | 2 | 3; blockId?: string }
/** Entry geometry depends on titles, not the final folio values, so pagination is stable. */
export function templatePages(page: SpecialPageDefinition, style: BookStyle, toc: readonly TocEntry[] = []): PageElement[][] {
  if (page.role !== 'toc') return [templateElements(page, style, toc)];
  const w = style.page.widthMm, h = style.page.heightMm, width = Math.max(20, w - 30), fontPt = page.toc?.fontPt ?? 9, fontMm = fontPt * 25.4 / 72, pitch = fontMm * 1.65;
  const bottom = h - 15, start = Math.max(Math.min(39, h * .3), Math.min(20, h * .15) + 16), perPage = Math.max(1, Math.floor((bottom - start - fontMm - .2) / pitch) + 1);
  const pages: PageElement[][] = []; let elements: PageElement[] = [], y = start;
  const fresh = () => {
    elements = [{id:'t-title',kind:'text',xMm:15,yMm:Math.min(20,h*.15),widthMm:width,heightMm:12,text:page.fields.title || '目次',fontPt:16,fontWeight:400,alignment:'start',direction:'horizontal'}];
    pages.push(elements); y = start;
  };
  fresh();
  for (const [index, entry] of toc.entries()) {
    const inset = Math.min(width - 15 - fontMm, ((entry.level ?? 1) - 1) * (page.toc?.indentMm ?? 3));
    const lines = elementTextLines(entry.title, Math.max(1, (width - 15 - inset) / fontMm),style.fontFamily);
    for (let at = 0; at < lines.length;) {
      const available = bottom - y < 9 ? 0 : Math.max(0, Math.floor((bottom - y - fontMm - .2) / pitch) + 1);
      if (!available) { fresh(); continue; }
      const count = Math.min(lines.length - at, available, perPage), part = lines.slice(at, at + count).join('\n'), height = Math.max(9, fontMm + (count - 1) * pitch + .2), suffix = at ? `-${at}` : '';
      elements.push({id:`t-toc-${index}${suffix}`,kind:'text',xMm:15+inset,yMm:y,widthMm:width-15-inset,heightMm:height,text:part,fontPt,fontWeight:400,alignment:'start',direction:'horizontal'});
      if (!at) elements.push({id:`t-num-${index}`,kind:'text',xMm:w-25,yMm:y,widthMm:10,heightMm:9,text:String(entry.page),fontPt,fontWeight:400,alignment:'end',direction:'horizontal'});
      const ruleWidth = count === 1 ? Math.max(0, width - Math.min(width - 12, inset + Array.from(part).length * 3.2 * fontPt / 9) - 15) : 0;
      if (ruleWidth > 3) elements.push({id:`t-leader-${index}${suffix}`,kind:'line',xMm:w-28-ruleWidth,yMm:y+5,widthMm:ruleWidth,heightMm:.1,color:'#b3b3aa',strokeMm:.1});
      y += height + 3; at += count;
      if (at < lines.length) fresh();
    }
  }
  return pages;
}
/** Templates generate finite page elements, never source coordinates. */
export function templateElements(page: SpecialPageDefinition, style: BookStyle, toc: readonly TocEntry[] = []): PageElement[] {
  if (page.role === 'toc') return templatePages(page, style, toc)[0]!;
  const w = style.page.widthMm, h = style.page.heightMm, left = 15, width = Math.max(20, w - 30), fields = page.fields, list: PageElement[] = [];
  const text = (id: string, value: string, y: number, size: number, height = 12, align: 'start' | 'center' = 'start') => { list.push({ id: `t-${id}`, kind: 'text', xMm: left, yMm: y, widthMm: width, heightMm: height, text: value, fontPt: size, fontWeight: 400, alignment: align, direction: 'horizontal' }); };
  if (page.role === 'title' || page.role === 'chapter-title') {
    text('title', fields.title || '', h * .34, page.template === 'minimal' ? 16 : 20, h * .24, 'center');
    if (fields.subtitle) text('subtitle', fields.subtitle, h * .56, 10, 18, 'center');
    if (fields.author) text('author', fields.author, h * .75, 11, 15, 'center');
  } else if (page.role === 'colophon') {
    const fieldCount = ['author', 'date', 'circle', 'printer', 'url'].filter(k => fields[k]).length;
    const top = Math.max(15, Math.min(h * (page.template === 'minimal' ? .45 : .52), h - 20 - fieldCount * 9 - (fields.note ? 26 : 10)));
    text('title', fields.title || '', top, 14, 16);
    if (page.template === 'standard') list.push({ id: 't-rule', kind: 'line', xMm: left, yMm: top + 15, widthMm: width, heightMm: .2, color: '#555555', strokeMm: .15 });
    let y = top + 20;
    for (const [key, label] of [['author', '著者'], ['date', '発行'], ['circle', '制作'], ['printer', '印刷'], ['url', 'URL']]) {
      if (fields[key!]) { text(key!, `${label}　${fields[key!]}`, y, 8.5, 9); y += 9; }
    }
    if (fields.note) text('note', fields.note, y + 6, 8, Math.max(8, h - y - 18));
  }
  return list;
}
