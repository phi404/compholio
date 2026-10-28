import { isDashText } from '../domain/text-symbols.js';
import type { BookStyle, DecorationPosition, BookPage } from '../domain/contracts.js';
import { advance, geometry, graphemes, pageMargins } from '../domain/style.js';
import { decorationSide, folioNumber, headsForPage } from '../domain/decoration.js';
import { renderElements } from './elements.js';
import { renderFlowLine } from './flow.js';
import { verticalText } from './text.js';
import { emphasisMarks as emphasis } from './emphasis.js';
import { fontDefinition } from '../domain/fonts.js';
import { paperHex, textHex } from '../domain/colors.js';

export function escapeXML(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, char => String.fromCodePoint(0x2400 + char.charCodeAt(0))).replace(/[\uFFFE\uFFFF\uD800-\uDFFF]/gu, '〓')
    .replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
}
const n = (value: number) => Number(value.toFixed(5));

function position(style: BookStyle, number: number, value: DecorationPosition, inset: number) {
  const margins = pageMargins(style, number), side = decorationSide(style.pageLayout, number, value, style.binding);
  return { x: side === 'center' ? style.page.widthMm / 2 : side === 'left' ? margins.left : style.page.widthMm - margins.right,
    y: value.startsWith('top-') ? inset : style.page.heightMm - inset, anchor: side === 'center' ? 'middle' : side === 'left' ? 'start' : 'end' };
}
/** One renderer for preview, PNG and PDF. Coordinates are derived only from semantic rules. */
export function renderPageSVG(page: BookPage, style: BookStyle, fontData?: string | Readonly<Record<string,string>>, transparent = false, options: { bleedMm?: number; blackText?: boolean; idPrefix?: string } = {}): string {
  style=page.style??style;
  const width = (text: string, family = style.fontFamily) => graphemes(text).reduce((sum,g)=>sum+advance(g,family),0);
  const vertical=(text:string,x:number,y:number,size:number,attrs='')=>verticalText(text,x,y,size,escapeXML,attrs,'mixed',style.fontFamily);
  const familyAttr=(family:string|undefined)=>family?` font-family="'${escapeXML(family)}','Book Mincho',serif"`:'';
  const grid = geometry(style), margins = pageMargins(style, page.number), pieces: string[] = [];
  page.lines.forEach((line, index) => {
    if(line.xMm!==undefined){pieces.push(renderFlowLine(line,style,escapeXML));return;}
    const x = style.page.widthMm - margins.right - grid.lineMm / 2 - (line.column ?? index) * grid.lineMm, size = grid.fontMm * (line.fontScale ?? 1);
    const used = line.indentEm + line.runs.reduce((sum, run) => sum + (run.advanceEm ?? width(run.kind === 'text' ? run.text : run.base)), 0);
    const shift = Math.max(0, grid.chars * grid.fontMm - used * size) * (line.alignment === 'center' ? .5 : line.alignment === 'end' ? 1 : 0);
    let y = style.margins.topMm + line.indentEm * size + shift;
    pieces.push(`<g data-block-id="${escapeXML(line.blockId)}">`);
    for (let i = 0; i < line.runs.length; i++) {
      const run = line.runs[i]!, span = run.advanceEm ?? width(run.kind === 'text' ? run.text : run.base);
      if (run.kind === 'text' && isDashText(run.text)) {
        let length = span;
        while (line.runs[i + 1]?.kind === 'text' && isDashText((line.runs[i + 1] as { text: string }).text) && line.runs[i + 1]!.emphasis === run.emphasis && line.runs[i + 1]!.fontWeight === run.fontWeight) length += line.runs[++i]!.advanceEm ?? 1;
        pieces.push(`<line data-dash="continuous" x1="${n(x)}" x2="${n(x)}" y1="${n(y)}" y2="${n(y + length * size)}" stroke="currentColor" stroke-width="${n(size * (run.fontWeight === 700 ? .06 : .045))}"/>`);
        pieces.push(emphasis(run, '―'.repeat(Math.round(length)), x, y, size)); y += length * size; continue;
      }
      if (run.kind === 'ruby') {
        const baseY = y + Math.max(0, (span - width(run.base)) * size / 2);
        let baseOffset = 0;
        for (const g of graphemes(run.base)) { pieces.push(vertical(g, x, baseY + baseOffset * size, size, `data-body="ruby-base"${run.fontWeight === 700 ? ' font-weight="700"' : ''}`)); baseOffset += advance(g,style.fontFamily); }
        const readingSize = size * Math.min(.5, span / Math.max(1, width(run.reading))), readingY = y + Math.max(0, span * size - width(run.reading) * readingSize) / 2;
        let rubyOffset = 0;
        for (const g of graphemes(run.reading)) { pieces.push(vertical(g, x + size * .76, readingY + rubyOffset * readingSize, readingSize, 'data-ruby="reading"')); rubyOffset += advance(g,style.fontFamily); }
        pieces.push(emphasis(run, run.base, x, baseY, size));
      } else { pieces.push(vertical(run.text, x, y, size, `data-body="text"${run.fontWeight === 700 ? ' font-weight="700"' : ''}${line.heading ? ' data-heading="true"' : ''}`)); pieces.push(emphasis(run, run.text, x, y, size)); }
      y += span * size;
    }
    pieces.push('</g>');
  });
  if(page.kind==='flow')for(const e of page.elements??[])pieces.push(`<g data-block-id="${escapeXML(e.blockId??'')}" data-image-placement="${escapeXML(e.imagePlacement??'flow')}">${renderElements([e],escapeXML,`${options.idPrefix ?? 'page'}-${page.number}`,style.fontFamily)}</g>`);
  if (page.kind !== 'flow') pieces.push(`<g data-special-page="${escapeXML(page.pageId)}" data-block-id="${escapeXML(page.blockId)}">${renderElements(page.elements, escapeXML, `${options.idPrefix ?? 'page'}-${page.number}`,style.fontFamily)}</g>`);
  const f = style.folio, number = page.folioVisible === false ? null : page.folioLabel !== undefined ? page.folioLabel : folioNumber(f, page.number);
  if (f && number !== null) { const p = position(style, page.number, f.position, f.insetMm); pieces.push(`<text data-testid="folio"${familyAttr(f.fontFamily)} x="${n(p.x)}" y="${n(p.y)}" font-size="${n(f.fontPt * 25.4 / 72)}" text-anchor="${p.anchor}">${number}</text>`); }
  const heads = page.hideHeads ? [] : headsForPage(style, page.number), occupied = heads.length + (number !== null && f?.position.startsWith('top-') ? 1 : 0);
  for (const h of heads) {
    const p = position(style, page.number, h.position, h.insetMm), text = h.text.replaceAll('{見出し}', page.heading ?? '').replaceAll('{ページ}', String(page.number));
    const size = h.fontPt * 25.4 / 72, available = (style.page.widthMm - margins.left - margins.right) / (occupied > 1 ? occupied + .3 : 1);
    pieces.push(`<text data-running-head="true"${familyAttr(h.fontFamily)} x="${n(p.x)}" y="${n(p.y)}" font-size="${n(size)}" text-anchor="${p.anchor}"${width(text,h.fontFamily) * size > available ? ` textLength="${n(available)}" lengthAdjust="spacingAndGlyphs"` : ''}>${escapeXML(text)}</text>`);
  }
  for (const e of page.hideHeads ? [] : page.runningElements ?? []) {
    const p = position(style, page.number, e.position, e.insetMm), size = e.fontPt * 25.4 / 72;
    const occupied = (page.runningElements ?? []).filter(other => other.position.split('-')[0] === e.position.split('-')[0]).length + (e.position.startsWith('top-') ? heads.length : 0) + (number !== null && f?.position.split('-')[0] === e.position.split('-')[0] ? 1 : 0);
    const available = (style.page.widthMm - margins.left - margins.right) / (occupied > 1 ? occupied + .3 : 1);
    pieces.push(`<text data-running-element="${escapeXML(e.id)}"${familyAttr(e.fontFamily)} x="${n(p.x)}" y="${n(p.y)}" font-size="${n(size)}" text-anchor="${p.anchor}"${width(e.text,e.fontFamily) * size > available ? ` textLength="${n(available)}" lengthAdjust="spacingAndGlyphs"` : ''}>${escapeXML(e.text)}</text>`);
  }
  const faces: [string,string][] = !fontData ? [] : typeof fontData === 'string' ? [[style.fontFamily,fontData]] : Object.entries(fontData);
  const fontCSS = faces.length ? '<style>'+faces.map(([family,url])=>`@font-face{font-family:'${escapeXML(family)}';src:url('${url}') format('${fontDefinition(family).format}');font-weight:400}`).join('')+'</style>' : '';
  const { widthMm: w, heightMm: h } = style.page, bleed = options.bleedMm ?? 0, ink = options.blackText && textHex(style.textColor)==='#282b28' ? '#000000' : textHex(style.textColor);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w + 2 * bleed}mm" height="${h + 2 * bleed}mm" viewBox="${-bleed} ${-bleed} ${w + 2 * bleed} ${h + 2 * bleed}" role="img" aria-label="${page.number}ページ" lang="ja">${fontCSS}<rect x="${-bleed}" y="${-bleed}" width="${w + 2 * bleed}" height="${h + 2 * bleed}" fill="${transparent ? 'none' : paperHex(page.paperColor ?? style.paperColor)}"/><g fill="${ink}" color="${ink}" font-family="'${escapeXML(style.fontFamily)}','Book Mincho',serif" font-weight="400" style="font-kerning:none;font-feature-settings:'palt' 0,'vpal' 0">${pieces.join('')}</g></svg>`;
}
